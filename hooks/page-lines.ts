// What an MR's page says beyond the MR's own words: its ticket as Jira tells it, what stands before a merge, and, for a page
// opened on one person, who they are and where they stand. The page draws each as it comes. Pure.
import type { Badge } from './attention'
import { LINK } from './drawing'
import { REVIEW_STATE } from './face-model'
import { drawnLine, excerpt, plural } from './format'
import { ticketUrl } from './jira'
import { cardFacts } from './row-facts'
import type { Tone } from './status'

import type { FailureKind, MrCard, Note, Person, Problems, Ticket, TicketDetail, Under } from '../types'

/** What a page draws beside the MR itself: what was read about its ticket, and whether Jira can be read here. */
export type PageContext = {
  tickets: Readonly<Record<string, Ticket>>
  /** The start of a ticket's link; empty while no Jira site is set. */
  browse: string
  failures: Problems
}

export type PageHead = {
  /** The ticket and what Jira says of it, as one link; null while the title names none or no Jira site is set. */
  ticket: { text: string; href: string } | null
  /** GitLab's verdict, unless a line of `standing` explains it, which then says it in its place. */
  verdict: { words: string; tone: Tone; bold: boolean } | null
  /** What stands before a merge that the page's own sections (failed jobs, threads) leave unsaid; a manual job to start links to it. */
  standing: { text: string; tone: Tone | undefined; href: string | null }[]
}

/** The first manual job the pipeline waits on, which a person starts on GitLab. */
const manualJob = (card: MrCard): string | null =>
  card.pipeline?.stages.flatMap(stage => stage.jobs).find(job => job.status === 'manual' && !job.allowFailure && card.pipeline?.blockedOn.includes(job.name) === true)?.url ?? null

/** A marker in words, or null for one the page says in a section of its own or a person's icon speaks for. */
function standingOf(card: MrCard, badge: Badge): string | null {
  switch (badge.kind) {
    case 'manual':
      return `Waiting on ${card.pipeline?.blockedOn.join(', ') ?? 'a manual job'}`
    case 'check':
      // The page's open threads, listed below, say this check.
      return badge.check === 'DISCUSSIONS_NOT_RESOLVED' ? null : badge.words
    case 'conflicts':
      return `Conflicts with ${card.branch.target}`
    case 'rebase':
      return `Needs a rebase onto ${card.branch.target}`
    case 'approvals':
      // "needs 1 approval" or "approved", with who can approve.
      return `${badge.words}${card.approvers.length > 0 ? `: ${card.approvers.join(', ')}` : ''}`
    case 'threads':
    case 'failed':
    case 'amber':
    case 'ready':
    case 'bots':
    case 'changes':
    default:
      return null
  }
}

export function pageHead(card: MrCard, ctx: PageContext): PageHead {
  const facts = cardFacts(card, {})
  const href = facts.ticket !== null ? ticketUrl(ctx.browse, facts.ticket) : null
  const jira = facts.ticket !== null ? ctx.tickets[facts.ticket] : undefined
  // Jira's tool is not installed here, so a ticket will not be filled in.
  const isJiraUnavailable = ctx.failures.jira?.kind === 'not-installed'
  const said =
    facts.ticket === null
      ? ''
      : jira !== undefined
        ? `${facts.ticket} · ${drawnLine(jira.type)} · ${drawnLine(jira.status)}: ${drawnLine(jira.summary)}`
        : `${facts.ticket}: ${isJiraUnavailable ? 'Jira is not available here' : 'not read from Jira yet'}`
  // Every marker the page has words for, the one GitLab's verdict is about too: the page says who can approve, which the
  // verdict's "needs 1 approval" does not.
  const explained = facts.row.flatMap(badge => {
    const words = standingOf(card, badge)
    return words !== null ? [{ badge, words }] : []
  })
  const { verdict } = facts
  const isExplained = verdict !== null && explained.some(({ badge }) => badge.check !== undefined && badge.check === verdict.check)
  return {
    ticket: href !== null ? { text: `${LINK.jira} ${said}`, href } : null,
    verdict: verdict !== null && !isExplained ? { words: verdict.words, tone: verdict.tone, bold: verdict.tone === 'success' } : null,
    standing: explained.map(({ badge, words }) => ({
      text: `${badge.glyph} ${words}`,
      tone: badge.tone === 'subtle' ? undefined : badge.tone,
      href: badge.kind === 'manual' ? manualJob(card) : null,
    })),
  }
}

/** The room a comment or a description opened under a card has: a glance, the whole a press further. */
const UNDER_ROOM = 320

/**
 * What opens under a card in place of a page. A person: where they stand, their newest comment, and the way on to all of
 * them on the MR's page. A ticket: its type and status, summary and assignee, and the start of its description.
 */
export type UnderBlock =
  | { kind: 'person'; heading: string; latest: { label: string; text: string } | null; more: string | null }
  | { kind: 'ticket'; heading: string; lines: string[]; isReading: boolean }

/**
 * A person's say on `card`. Their newest note leads once the MR is read whole (`isWhole`): the shared card keeps one note a
 * person, their open thread before their newest, so until then none is quoted.
 */
export function personUnder(card: MrCard, username: string, isWhole: boolean): UnderBlock {
  const page = personPage(card, username)
  const person = card.people.find(each => each.username === username)
  if (page === null || person === undefined) {
    // Left the MR since the panel opened: the panel says so, for `✕` to close, rather than stay open unseen.
    return { kind: 'person', heading: `${username} · no longer on this MR`, latest: null, more: null }
  }
  const newest = person.notes.reduce<Note | null>((best, note) => (best === null || note.at > best.at ? note : best), null)
  // The way on to their comments whole, on the MR's page: the one quoted here may be cut short.
  const more = person.noteCount > 1 ? `all ${plural(person.noteCount, 'comment')} ›` : newest !== null ? 'read it whole ›' : null
  return {
    kind: 'person',
    heading: page.heading,
    latest: newest !== null && isWhole ? { label: newest.isOpen ? 'open thread' : 'comment', text: excerpt(newest.body, UNDER_ROOM) } : null,
    more,
  }
}

/** The most panels open under cards at once: each is a whole MR or ticket read and kept, so past it the first opened closes. */
export const PANELS_MOST = 5

/**
 * What is open under the cards once `under` is pressed on `card`: it takes the place of what that card had open, or closes
 * when it is that; other cards keep theirs, the first opened closing past `PANELS_MOST`. Newest opened last.
 */
export function toggledUnders(unders: Readonly<Record<string, Under>>, card: string, under: Under): Record<string, Under> {
  const now = unders[card]
  const others = Object.entries(unders).filter(([key]) => key !== card)
  return Object.fromEntries(now !== undefined && now.kind === under.kind && now.id === under.id ? others : [...others, [card, under] as const].slice(-PANELS_MOST))
}

/** What a ticket's panel says when reading it failed: `/gitlab` says why, but nothing of an optional tool not installed. */
const failedSay = (failed: FailureKind): string => (failed === 'not-installed' ? 'Jira is not available here.' : 'Jira could not be read; /gitlab says why.')

/**
 * A ticket's say: what the quarter-hourly read knows at once, and what reading it whole adds, once that is in. While none
 * is in, it is being read; a read that failed says so (`failed`), for this ticket alone.
 */
export function ticketUnder(key: string, ticket: Ticket | undefined, detail: TicketDetail | undefined): UnderBlock {
  const heading = ticket !== undefined ? `${key} · ${drawnLine(ticket.type)} · ${drawnLine(ticket.status)}` : key
  const summary = drawnLine(ticket?.summary ?? '')
  const said =
    detail === undefined
      ? []
      : detail.failed !== undefined
        ? [failedSay(detail.failed)]
        : !detail.isFound
          ? ['Jira says nothing of this ticket to you.']
          : [...(detail.assignee !== '' ? [`Assigned to ${detail.assignee}`] : []), detail.description !== '' ? detail.description : 'No description.']
  const lines = [...(summary !== '' ? [summary] : []), ...said]
  return { kind: 'ticket', heading, lines, isReading: detail === undefined }
}

/** `bot`, `@handle`, or nothing where the name is written like the handle ("Mel.Northcote") and would say it twice. */
const tagOf = (person: Person): string => (person.isBot ? ' bot' : person.name.toLowerCase() === person.username.toLowerCase() ? '' : ` @${person.username}`)

/** A note on a page opened on its writer, its byline saying whether it is in an unresolved thread. */
export type PersonNote = { note: Note; label: 'open thread' | 'comment' }

/** A page opened on one person: who they are, where they stand, and all they wrote, open threads first. Null when they are not on the MR. */
export function personPage(card: MrCard, username: string): { heading: string; notes: PersonNote[] } | null {
  const person = card.people.find(each => each.username === username)
  if (person === undefined) {
    return null
  }
  const standing = [REVIEW_STATE[person.state], ...(person.openThreads > 0 ? [plural(person.openThreads, 'open thread')] : []), plural(person.noteCount, 'comment')]
  return {
    heading: `${person.name}${tagOf(person)} · ${standing.join(' · ')}`,
    notes: person.notes.map(note => ({ note, label: note.isOpen ? 'open thread' : 'comment' })),
  }
}
