// Everything the MR list decides, as plain data: which rows, in what order, under which heading, with which words,
// colours and links, which are open, and how much of each fits the drawing's room. The draw files only map this to
// elements. Pure: the one thing it asks of the draw layer is `sizeOf`, how many characters a piece of a row draws to,
// which it asks once for each piece it needs and never for a piece it will not use.
import { hasLeft, rank } from './attention.ts'
import { firstDifference } from './order.ts'
import { LINK, titleKey } from './drawing.ts'
import { ago, pipelineTime, plural } from './format.ts'
import { shortHash } from './identity.ts'
import { firstRunLines } from './first-run.ts'
import { ticketUrl } from './jira.ts'
import { pinKey } from './mr-url.ts'
import { aboutLines, blockerLines, detailOf, personLines } from './row-lines.ts'
import type { DetailModel, Line, RowContext } from './row-lines.ts'
import { cardFacts } from './row-facts.ts'
import type { CardFacts, PersonFacts } from './row-facts.ts'
import { STAGE_COLOURS, type Tone } from './status.ts'
import { stripModel } from './strip-model.ts'
import type { StripModel } from './strip-model.ts'
import type { SvgSource } from './svg.ts'

import type { MrCard, Pinned, PollState, Problems } from '../types'

/** Past this many, the least pressing of Mine fold behind a button, so the pane's size stays bounded. */
export const MINE_SHOWN = 10

/** The least a row can draw to; with less room than this, no row is tried. */
const ROW_FLOOR = 300

type Link = { href: string; text: string }

export type PersonRow = {
  username: string
  /** The name beside the face, with the open threads they hold. */
  label: string
  scope: string
  tone: Tone
  /** The mark a surface without Svg draws. */
  glyph: string
  alt: string
  plain: SvgSource
  picture: SvgSource | null
  card: Line[]
}

export type RowModel = {
  key: string
  /** Short and unique among the rows; the key of the row's box. */
  boxKey: string
  titleKey: string
  /** `<iid>-<repo hash>`, which every key and scope of the row ends on. */
  suffix: string
  border: { style: 'bold' | 'round'; colour: string }
  canOpen: boolean
  isOpen: boolean
  title: string
  ago: string
  mr: Link
  ticket: { text: string; href: string | null } | null
  repo: Link | null
  strip: StripModel | null
  pipeline: Link | null
  verdict: { words: string; tone: Tone; bold: boolean; trailing: string | null } | null
  blocker: { text: string; tone: Tone } | null
  people: PersonRow[]
  /** Whether a face can be drawn with its picture. */
  hasPictures: boolean
  about: Line[] | null
  blocks: Line[] | null
  detail: DetailModel | null
  /** Whether the row opens onto a detail, drawn or not. */
  hasDetail: boolean
  /** What of the row fits the drawing. */
  fit: { isDrawn: boolean; hasCards: boolean; hasFaces: boolean; hasDetail: boolean }
}

/** A piece of a row whose size the drawing decides by: its two lines, the second alone, its hover cards, its faces with pictures, its detail. */
export type Piece = 'head' | 'line2' | 'cards' | 'faces' | 'detail'
export type SizeOf = (row: RowModel, piece: Piece) => number

export type PaneInput = {
  cards: readonly MrCard[]
  /** The small pictures kept by URL, which a face is drawn with where there is room. */
  avatars: Readonly<Record<string, string>>
  pinned: readonly Pinned[]
  tickets: RowContext['tickets']
  usual: RowContext['usual']
  browse: string
  expanded: readonly string[]
  chosen: Readonly<Record<string, string>>
  repoFilter: string
  /** Which view is drawn: only the MR list builds rows. */
  view: 'mine' | 'inbox' | 'reading'
  /** MRs with news in the inbox. */
  news: number
  poll: PollState
  /** Whether this session is reading GitLab now; the cards drawn meanwhile are those of the last read. */
  isReading: boolean
  isWaking: boolean
  /** What each source last failed with. */
  failures: Problems
}

export type PaneModel = {
  tabs: { mine: string; inbox: string; isInbox: boolean }
  repos: { all: { label: string; isActive: boolean }; each: { project: string; label: string; isActive: boolean }[] }
  session: RowModel[]
  mine: { heading: string; isEmpty: boolean; rows: RowModel[]; more: string | null; isMoreOpen: boolean }
  drafts: { label: string; isOpen: boolean; rows: RowModel[] } | null
  /** While nothing has been read and a source has failed: one line each, with what to do about it. */
  firstRun: string[]
  /** Said when rows are left out to stay within the room. */
  leftOut: string | null
  /** Beside the tabs, quietly: how old the cards are, and ↻ while a read is out. */
  status: { text: string; isWarning: boolean }
  /** What is wrong with the last read, or what it left out; empty when nothing is. */
  footer: { text: string; isWarning: boolean; wake: string }
}

const updatedLine = (age: string): string => (age === 'now' ? 'updated just now' : `updated ${age} ago`)

/** The mark beside the age while this session reads GitLab: the pane has no spinner, and a glyph draws on every surface. */
export const READING_MARK = '↻'

function statusOf(poll: PollState, isReading: boolean, now: number): PaneModel['status'] {
  const hasStale = poll.error !== null || Object.values(poll.hosts).some(status => status.error !== null)
  // Nothing read yet and nothing failed: a read is out, whether this session's or the leader's, which only it can mark.
  const age = poll.fetchedAt !== null ? updatedLine(ago(new Date(poll.fetchedAt).toISOString(), now)) : hasStale ? '' : 'reading GitLab…'
  return { text: isReading ? `${READING_MARK} ${age}`.trim() : age, isWarning: hasStale }
}

/** The first of these comparisons that tells two MRs apart: what needs you now, then the latest. */
const byRank = (ranks: ReadonlyMap<string, number>) => (a: MrCard, b: MrCard) =>
  firstDifference((ranks.get(a.key) ?? 3) - (ranks.get(b.key) ?? 3), b.updatedAt.localeCompare(a.updatedAt))

function footerOf(poll: PollState, isWaking: boolean, now: number): PaneModel['footer'] {
  const age = (at: number | null): string | null => (at !== null ? ago(new Date(at).toISOString(), now) : null)
  // A read that kept no status per host (nothing yet to say of any) speaks of GitLab as one.
  const statuses = Object.entries(Object.keys(poll.hosts).length > 0 ? poll.hosts : { '': { fetchedAt: poll.fetchedAt, error: poll.error } })
  const stale = statuses.filter(([, status]) => status.error !== null)
  const fresh = statuses.filter(([, status]) => status.error === null && status.fetchedAt !== null)
  const named = (host: string, text: string) => (statuses.length > 1 ? `${host}: ${text}` : text)
  const keptNote = (poll.kept ?? 0) > 0 ? `${plural(poll.kept ?? 0, 'MR')} kept from the last read` : ''
  const failed = stale.map(([host, status]) => {
    const old = age(status.fetchedAt)
    return `${named(host, status.error ?? '')}${old !== null ? `; showing ${old} old data` : ''}`
  })
  // With several hosts a stale one is told with the age of its own data, and the fresh ones beside it.
  const beside = statuses.length > 1 && fresh.length > 0 ? ` · ${fresh.map(([host, status]) => `${host} ${updatedLine(age(status.fetchedAt) ?? 'now')}`).join(', ')}` : ''
  // How old the cards are is said beside the tabs; down here only what went wrong, or what the read left out.
  const text = stale.length > 0 ? `GitLab read failed: ${failed.join('; ')}${beside}` : keptNote
  return { text, isWarning: stale.length > 0, wake: isWaking ? 'wake Claude: on' : 'wake Claude: off' }
}

/** A row's two lines, as data; the rest of it is added where the room allows. */
function headOf(card: MrCard, facts: CardFacts, input: PaneInput, home: string | undefined, hasSvg: boolean, now: number): RowModel {
  const isOpen = input.expanded.includes(card.key)
  const focus = isOpen ? facts.people.find(person => person.username === input.chosen[card.key]) : undefined
  const suffix = `${card.iid}-${shortHash(card.project)}`
  const pipeline = card.pipeline
  const ticketLink = facts.ticket !== null ? ticketUrl(input.browse, facts.ticket) : null
  const [blocker] = facts.row
  const [firstTrailing] = facts.trailing
  const names = facts.people.map(person => (hasSvg ? person.call : person.initials))
  // Beside a face that already shows the initials, a first name reads better; two of the same name keep initials.
  const callOf = (person: PersonFacts, i: number): string => (hasSvg && names.filter(name => name === names[i]).length > 1 ? person.initials : (names[i] ?? person.initials))
  const time = pipeline !== undefined ? pipelineTime(card, now, input.usual[card.project]) : ''
  return {
    key: card.key,
    boxKey: shortHash(card.key),
    titleKey: titleKey(card),
    suffix,
    border: { style: facts.rank === 0 ? 'bold' : 'round', colour: STAGE_COLOURS[facts.tone] },
    canOpen: facts.canOpen,
    isOpen,
    title: facts.title,
    ago: ago(card.updatedAt, now),
    mr: { href: card.url, text: `${LINK.mr} !${card.iid}` },
    ticket: facts.ticket !== null ? { text: ticketLink !== null ? `${LINK.jira} ${facts.ticket}` : facts.ticket, href: ticketLink } : null,
    repo: input.repoFilter === '' && card.project !== home ? { href: card.repo.url, text: `${LINK.repo} ${card.repo.name}` } : null,
    strip: pipeline !== undefined && pipeline.stages.length > 0 ? stripModel(pipeline.stages, now) : null,
    pipeline: pipeline !== undefined ? { href: pipeline.url, text: `${LINK.pipeline} ${time}` } : null,
    verdict:
      facts.verdict !== null
        ? {
            words: facts.verdict.words,
            tone: facts.verdict.tone,
            bold: facts.verdict.tone === 'success',
            trailing: firstTrailing !== undefined ? `· ${firstTrailing.words}${facts.trailing.length > 1 ? ` +${facts.trailing.length - 1}` : ''}` : null,
          }
        : null,
    blocker: blocker !== undefined ? { text: `${blocker.glyph} ${blocker.words}${facts.row.length > 1 ? ` +${facts.row.length - 1}` : ''}`, tone: blocker.tone } : null,
    people: facts.people.map((person, i) => ({
      username: person.username,
      label: `${callOf(person, i)}${person.openThreads > 0 ? ` ${person.openThreads}` : ''}`,
      scope: `p${shortHash(person.username)}-${suffix}`,
      tone: person.face.tone,
      glyph: person.face.badge ?? (focus?.username === person.username ? '◉' : '●'),
      alt: person.face.alt,
      plain: person.face.plain,
      picture: person.face.picture,
      card: [],
    })),
    hasPictures: facts.hasPictures,
    about: null,
    blocks: null,
    detail: null,
    hasDetail: isOpen && (facts.canOpen || focus !== undefined),
    fit: { isDrawn: false, hasCards: false, hasFaces: false, hasDetail: false },
  }
}

/**
 * The pane's list as data. Rows come in order of what needs you. Rows you opened take the room first, with their detail;
 * then the other rows in that order, then hover cards, then pictures on faces. Rows that do not fit at all are left out
 * and counted. `budget.room` is what the rows may draw to; `budget.sizeOf` measures a piece of a row, once.
 */
export function buildPane(input: PaneInput, now: number, surface: { hasSvg: boolean }, budget: { room: number; sizeOf: SizeOf }): PaneModel {
  // GitLab says an MR is no longer open before the authored list drops it.
  const rows = input.cards.filter(row => !hasLeft(row))
  const pinnedKeys = new Set(input.pinned.map(pinKey))
  const counts = rows.reduce((count, row) => count.set(row.project, (count.get(row.project) ?? 0) + 1), new Map<string, number>())
  const repos = [...counts].sort((a, b) => b[1] - a[1])
  const home = rows.find(row => pinnedKeys.has(row.key))?.project ?? repos[0]?.[0]
  const repoName = (project: string) => rows.find(row => row.project === project)?.repo.name ?? project
  const shown = rows.filter(row => input.repoFilter === '' || row.project === input.repoFilter)
  // Only the rank of every MR is worked out to put them in order; the rest of what a row says (its badges, words, faces) is
  // worked out below for the rows that are drawn, once each.
  const order = byRank(new Map(rows.map(row => [row.key, rank(row)])))
  const session = shown.filter(row => pinnedKeys.has(row.key)).sort(order)
  const mine = shown.filter(row => !pinnedKeys.has(row.key) && !row.isDraft).sort(order)
  const drafts = shown.filter(row => !pinnedKeys.has(row.key) && row.isDraft).sort(order)
  const showDrafts = input.expanded.includes('drafts')
  const showMore = input.expanded.includes('more')
  const mineShown = showMore ? mine : mine.slice(0, MINE_SHOWN)
  const isInbox = input.view === 'inbox'
  const context: RowContext = {
    tickets: input.tickets,
    usual: input.usual,
    browse: input.browse,
    homeRepo: home,
    isJiraUnavailable: input.failures.jira?.kind === 'not-installed',
  }

  const wanted = input.view === 'mine' ? [...session, ...mineShown, ...(showDrafts ? drafts : [])] : []
  const built = wanted.map(card => {
    const facts = cardFacts(card, input.avatars)
    return { card, facts, row: headOf(card, facts, input, home, surface.hasSvg, now) }
  })

  // Each piece is measured at most once, and a row not tried is never drawn.
  let room = budget.room
  const fits = (size: number, instead = 0): boolean => {
    const need = size - instead
    if (need > room) {
      return false
    }
    room -= need
    return true
  }
  const tried = (row: RowModel): boolean => room >= ROW_FLOOR && fits(budget.sizeOf(row, 'head'))
  const withCards = (row: RowModel, card: MrCard, facts: CardFacts): RowModel => ({
    ...row,
    about: aboutLines(card, facts, context, facts.ticket !== null ? ticketUrl(input.browse, facts.ticket) : null, now),
    blocks: facts.row.flatMap(badge => blockerLines(card, facts, badge, now)),
    people: row.people.flatMap((person, i) => {
      const facing = facts.people[i]
      return facing !== undefined ? [{ ...person, card: personLines(facing, now) }] : []
    }),
  })

  const opened = built.filter(part => part.row.hasDetail && tried(part.row))
  const detailed = new Map<string, RowModel>()
  for (const part of opened) {
    const focus = part.facts.people.find(person => person.username === input.chosen[part.card.key])
    const row = { ...part.row, detail: detailOf(part.card, part.facts, focus, now) }
    if (fits(budget.sizeOf(row, 'detail'))) {
      detailed.set(part.card.key, row)
    }
  }
  const drawn = new Set([...opened, ...built.filter(part => !part.row.hasDetail && tried(part.row))].map(part => part.card.key))
  const finished = new Map<string, RowModel>()
  for (const part of built) {
    if (!drawn.has(part.card.key)) {
      continue
    }
    const row = withCards(detailed.get(part.card.key) ?? part.row, part.card, part.facts)
    finished.set(part.card.key, { ...row, fit: { isDrawn: true, hasCards: fits(budget.sizeOf(row, 'cards')), hasFaces: false, hasDetail: detailed.has(part.card.key) } })
  }
  for (const [key, row] of finished) {
    if (row.hasPictures) {
      finished.set(key, { ...row, fit: { ...row.fit, hasFaces: fits(budget.sizeOf(row, 'faces'), budget.sizeOf(row, 'line2')) } })
    }
  }
  const rowsOf = (list: readonly MrCard[]): RowModel[] =>
    list.flatMap(card => {
      const row = finished.get(card.key) ?? built.find(part => part.card.key === card.key)?.row
      return row !== undefined ? [row] : []
    })

  return {
    tabs: {
      // Every MR the tab holds, as `All` counts them: this session's, the ready ones and the drafts add up to it.
      mine: `Mine · ${rows.length}`,
      inbox: input.news > 0 ? `Inbox · ${input.news} new` : 'Inbox',
      isInbox,
    },
    repos: {
      all: { label: `All ${rows.length}`, isActive: input.repoFilter === '' },
      each: repos.map(([project, count]) => ({ project, label: `${repoName(project)} ${count}`, isActive: input.repoFilter === project })),
    },
    firstRun: firstRunLines(input.failures, input.poll.fetchedAt !== null || rows.length > 0),
    session: rowsOf(session),
    mine: {
      // GitLab's word for an MR that is not a draft; the tab above already says Mine.
      heading: `Ready · ${mine.length}`,
      isEmpty: mine.length === 0,
      rows: rowsOf(mineShown),
      more: mine.length > MINE_SHOWN ? (showMore ? '▾ Show fewer' : `▸ ${mine.length - MINE_SHOWN} more`) : null,
      isMoreOpen: showMore,
    },
    drafts: drafts.length > 0 ? { label: `${showDrafts ? '▾' : '▸'} Drafts · ${drafts.length}`, isOpen: showDrafts, rows: showDrafts ? rowsOf(drafts) : [] } : null,
    leftOut: built.length - drawn.size > 0 ? `${plural(built.length - drawn.size, 'more MR')} left out to stay within what the app draws; pick a repo above to see them.` : null,
    status: statusOf(input.poll, input.isReading, now),
    footer: footerOf(input.poll, input.isWaking, now),
  }
}
