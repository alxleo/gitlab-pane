// Everything the MR list decides, as plain data: which rows, in what order, under which heading, with which words,
// colours and links, and how much of each fits the drawing's room. The draw files only map this to elements. Pure: the
// one thing it asks of the draw layer is `sizeOf`, how many characters a piece of a row draws to, which it asks once for
// each piece it needs and never for a piece it will not use.
import { badges, hasLeft, rank } from './attention.ts'
import { firstDifference } from './order.ts'
import { LINK, titleKey } from './drawing.ts'
import { ago, pipelineTime, plural } from './format.ts'
import { shortHash } from './identity.ts'
import { firstRunLines } from './first-run.ts'
import { ticketUrl } from './jira.ts'
import { pinKey } from './mr-url.ts'
import { cardFacts } from './row-facts.ts'
import type { CardFacts, PersonFacts } from './row-facts.ts'
import { STAGE_COLOURS, type Tone } from './status.ts'
import { stripModel } from './strip-model.ts'
import type { StripModel } from './strip-model.ts'
import type { SvgSource } from './svg.ts'

import type { MrCard, Pinned, PollState, Problems, Usual } from '../types'

/** Past this many, the least pressing of Mine fold behind a button, so the pane's size stays bounded. */
export const MINE_SHOWN = 10

/** A ready MR untouched for this long, with no news in the inbox, folds under Parked until something moves on it. */
const PARKED_AFTER_MS = 7 * 86_400_000

/** The least a row can draw to; with less room than this, no row is tried. */
const ROW_FLOOR = 300

type Link = { href: string; text: string }

export type PersonRow = {
  username: string
  /** The name beside the face, with the open threads they hold. */
  label: string
  tone: Tone
  /** The mark a surface without Svg draws. */
  glyph: string
  alt: string
  plain: SvgSource
  picture: SvgSource | null
}

export type RowModel = {
  key: string
  /** Short and unique among the rows; the key of the row's box. */
  boxKey: string
  /** The title's key, which opens the MR's page and which the way back from it scrolls to. */
  titleKey: string
  /** `<iid>-<repo hash>`, which every key of the row ends on. */
  suffix: string
  border: { style: 'bold' | 'round'; colour: string }
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
  /** The latest open thread a person wrote, as the card's one line of words; pressed, it opens the page on them. */
  said: { label: string; username: string } | null
  /** Nothing to show past the title and verdict, so the row is one line: its title, its verdict and its age. */
  isQuiet: boolean
  /**
   * The press that puts the MR in this session or takes it out. None on an MR this session raised: taking that pin off
   * would stop its wakes. The label names the press; the mark is what is drawn, a star filled on an MR pinned here.
   */
  pin: { key: string; label: 'pin' | 'unpin'; mark: '☆' | '★'; mr: Pinned } | null
  /** Whether a face can be drawn with its picture. */
  hasPictures: boolean
  /** What of the row fits the drawing. */
  fit: { isDrawn: boolean; hasFaces: boolean }
}

/** A piece of a row whose size the drawing decides by: its lines, the second alone, its faces with pictures. */
export type Piece = 'head' | 'line2' | 'faces'
export type SizeOf = (row: RowModel, piece: Piece) => number

export type PaneInput = {
  cards: readonly MrCard[]
  /** The small pictures kept by URL, which a face is drawn with where there is room. */
  avatars: Readonly<Record<string, string>>
  pinned: readonly Pinned[]
  usual: Readonly<Record<string, Usual>>
  browse: string
  /** `drafts`, `more`, `parked` and `others` while those folds are open. */
  expanded: readonly string[]
  repoFilter: string
  /** Which view is drawn: only the MR list builds rows. */
  view: 'mine' | 'inbox' | 'reading'
  /** MRs with news: how many the inbox shows, and the keys of all of them, in every repo, Mine's or not. */
  news: { count: number; keys: readonly string[] }
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
  /** The MRs this session raised, watched or was given a pin, in the order they came. */
  session: RowModel[]
  /** While this session holds MRs, every other one folds behind this line; none when nothing folds. */
  others: { label: string; isOpen: boolean } | null
  mine: { heading: string; isEmpty: boolean; rows: RowModel[]; more: string | null; isMoreOpen: boolean }
  parked: { label: string; isOpen: boolean; rows: RowModel[] } | null
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

/** Markers that wait on others or say the MR can merge: neither is a thing to fix. */
const WAITING: readonly string[] = ['approvals', 'ready']

/**
 * Whether a row has nothing to show past its title and verdict: its pipeline passed, nothing stands before a merge but
 * approvals (no thread, request for changes or bot holds it, whatever face speaks for it), GitLab's verdict is neither red
 * nor amber, and no person's open thread is quoted on it.
 */
function isQuiet(card: MrCard, facts: CardFacts): boolean {
  return (
    card.pipeline?.status === 'success' &&
    facts.said === null &&
    badges(card).every(badge => WAITING.includes(badge.kind)) &&
    (facts.verdict === null || facts.verdict.tone === 'success' || facts.verdict.tone === 'subtle')
  )
}

/** What a row's pin press does: pin an MR not in this session, unpin one only watched there, nothing to one it raised. */
function pinOf(card: MrCard, pinned: Pinned | undefined, suffix: string): RowModel['pin'] {
  // The pin is made from the card's own host, project and number, so its key is the card's.
  const mr = { url: card.url, host: card.host, path: card.path, iid: card.iid }
  if (pinned === undefined) {
    return { key: `pin-${suffix}`, label: 'pin', mark: '☆', mr }
  }
  // A pin kept from before origins were recorded counts as raised, as it wakes.
  return pinned.origin === 'watched' ? { key: `pin-${suffix}`, label: 'unpin', mark: '★', mr } : null
}

/** A row as data; its faces take their pictures where the room allows. */
function headOf(card: MrCard, facts: CardFacts, input: PaneInput, home: string | undefined, hasSvg: boolean, now: number): RowModel {
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
      tone: person.face.tone,
      glyph: person.face.badge ?? '●',
      alt: person.face.alt,
      plain: person.face.plain,
      picture: person.face.picture,
    })),
    said: facts.said !== null ? { label: `${LINK.comment} ${facts.said.who}: ${facts.said.words}`, username: facts.said.username } : null,
    isQuiet: isQuiet(card, facts),
    pin: pinOf(
      card,
      input.pinned.find(one => pinKey(one) === card.key),
      suffix
    ),
    hasPictures: facts.hasPictures,
    fit: { isDrawn: false, hasFaces: false },
  }
}

/**
 * The pane's list as data. Rows come in order of what needs you, then pictures on faces where room is left. Rows that do
 * not fit at all are left out and counted. `budget.room` is what the rows may draw to; `budget.sizeOf` measures a piece of
 * a row, once.
 */
export function buildPane(input: PaneInput, now: number, surface: { hasSvg: boolean }, budget: { room: number; sizeOf: SizeOf }): PaneModel {
  // GitLab says an MR is no longer open before the authored list drops it.
  const rows = input.cards.filter(row => !hasLeft(row))
  const pinnedKeys = new Set(input.pinned.map(pinKey))
  const counts = rows.reduce((count, row) => count.set(row.project, (count.get(row.project) ?? 0) + 1), new Map<string, number>())
  const repos = [...counts].toSorted((a, b) => b[1] - a[1])
  const home = rows.find(row => pinnedKeys.has(row.key))?.project ?? repos[0]?.[0]
  const repoName = (project: string) => rows.find(row => row.project === project)?.repo.name ?? project
  const shown = rows.filter(row => input.repoFilter === '' || row.project === input.repoFilter)
  // Only the rank of every MR is worked out to put them in order; the rest of what a row says (its badges, words, faces) is
  // worked out below for the rows that are drawn, once each.
  const order = byRank(new Map(rows.map(row => [row.key, rank(row)])))
  // This session's MRs keep the order they came in, so what the person pinned stays where they put it.
  const pinOrder = new Map(input.pinned.map((pin, i) => [pinKey(pin), i]))
  const session = shown.filter(row => pinOrder.has(row.key)).toSorted((a, b) => (pinOrder.get(a.key) ?? 0) - (pinOrder.get(b.key) ?? 0))
  const news = new Set(input.news.keys)
  const rest = shown.filter(row => !pinOrder.has(row.key))
  // GitLab leaves an MR's updated time alone when its pipeline runs, so the pipeline's own times count as a move too; news
  // in the inbox brings a parked MR back whatever the times say.
  const lastMoved = (card: MrCard) =>
    Math.max(...[card.updatedAt, card.pipeline?.finishedAt ?? null, card.pipeline?.startedAt ?? null].flatMap(at => (at !== null ? [Date.parse(at)] : [])))
  const isParked = (card: MrCard) => !card.isDraft && now - lastMoved(card) >= PARKED_AFTER_MS && !news.has(card.key)
  const mine = rest.filter(row => !row.isDraft && !isParked(row)).toSorted(order)
  const parked = rest.filter(isParked).toSorted(order)
  const drafts = rest.filter(row => row.isDraft).toSorted(order)
  // While this session holds MRs the rest fold to one line, but not under a picked repo, which is how to see its MRs.
  const isFolding = session.length > 0 && rest.length > 0 && input.repoFilter === ''
  const showOthers = !isFolding || input.expanded.includes('others')
  const showDrafts = showOthers && input.expanded.includes('drafts')
  const showParked = showOthers && input.expanded.includes('parked')
  const showMore = input.expanded.includes('more')
  const mineShown = !showOthers ? [] : showMore ? mine : mine.slice(0, MINE_SHOWN)
  const isInbox = input.view === 'inbox'
  const newOthers = rest.filter(card => news.has(card.key)).length

  const wanted = input.view === 'mine' ? [...session, ...mineShown, ...(showParked ? parked : []), ...(showDrafts ? drafts : [])] : []
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
  const finished = new Map<string, RowModel>()
  for (const part of built) {
    if (tried(part.row)) {
      finished.set(part.card.key, { ...part.row, fit: { isDrawn: true, hasFaces: false } })
    }
  }
  for (const [key, row] of finished) {
    // A quiet row draws no faces, so it takes no pictures.
    if (row.hasPictures && !row.isQuiet) {
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
      // Every MR the tab holds, as `All` counts them: this session's, the ready, the parked and the drafts add up to it.
      mine: `Mine · ${rows.length}`,
      inbox: input.news.count > 0 ? `Inbox · ${input.news.count} new` : 'Inbox',
      isInbox,
    },
    repos: {
      all: { label: `All ${rows.length}`, isActive: input.repoFilter === '' },
      each: repos.map(([project, count]) => ({ project, label: `${repoName(project)} ${count}`, isActive: input.repoFilter === project })),
    },
    firstRun: firstRunLines(input.failures, input.poll.fetchedAt !== null || rows.length > 0),
    session: rowsOf(session),
    others: isFolding ? { label: `${showOthers ? '▾' : '▸'} ${plural(rest.length, 'other')}${newOthers > 0 ? ` · ${newOthers} new` : ''}`, isOpen: showOthers } : null,
    mine: {
      // GitLab's word for an MR that is not a draft; the tab above already says Mine.
      heading: `Ready · ${mine.length}`,
      // Parked MRs are open too, so Ready says nothing is open only when none is parked.
      isEmpty: mine.length === 0 && parked.length === 0,
      rows: rowsOf(mineShown),
      more: mine.length > MINE_SHOWN ? (showMore ? '▾ Show fewer' : `▸ ${mine.length - MINE_SHOWN} more`) : null,
      isMoreOpen: showMore,
    },
    parked:
      parked.length > 0 ? { label: `${showParked ? '▾' : '▸'} Parked, untouched for a week · ${parked.length}`, isOpen: showParked, rows: showParked ? rowsOf(parked) : [] } : null,
    drafts: drafts.length > 0 ? { label: `${showDrafts ? '▾' : '▸'} Drafts · ${drafts.length}`, isOpen: showDrafts, rows: showDrafts ? rowsOf(drafts) : [] } : null,
    leftOut:
      built.length - finished.size > 0 ? `${plural(built.length - finished.size, 'more MR')} left out to stay within what the app draws; pick a repo above to see them.` : null,
    status: statusOf(input.poll, input.isReading, now),
    footer: footerOf(input.poll, input.isWaking, now),
  }
}
