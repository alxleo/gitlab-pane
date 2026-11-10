// What an MR's page says beyond the MR's own words: its ticket as Jira tells it, what stands before a merge, and, for a page
// opened on one person, who they are and where they stand. The page draws each as it comes. Pure.
import type { Badge } from './attention.ts'
import { LINK } from './drawing.ts'
import { REVIEW_STATE } from './face-model.ts'
import { plural } from './format.ts'
import { ticketUrl } from './jira.ts'
import { cardFacts } from './row-facts.ts'
import type { Tone } from './status.ts'

import type { MrCard, Note, Person, Problems, Ticket } from '../types'

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
        ? `${facts.ticket} · ${jira.type} · ${jira.status}: ${jira.summary}`
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
