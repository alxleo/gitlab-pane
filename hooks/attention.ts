import { plural } from './format.ts'
import { firstDifference } from './order.ts'
import { isSettled, type Tone } from './status.ts'

import type { MergeStatus, MrCard, Person } from '../types'

/** 0 needs you now, 1 is moving, 2 waits on others, 3 is ready. */
export function rank(card: MrCard): number {
  const status = card.pipeline?.status
  if (
    status === 'failed' ||
    card.hasConflicts ||
    card.needsRebase ||
    card.changesRequestedBy.length > 0 ||
    card.openThreads.length > 0
  ) {
    return 0
  }
  if (status !== undefined && !isSettled(status)) {
    return 1
  }
  return card.approvalsLeft > 0 || status === 'manual' || botsHolding(card).length > 0 ? 2 : 3
}

/** Bots with an open thread or a request for changes, either of which holds the merge. */
const botsHolding = (card: MrCard): Person[] =>
  card.people.filter(person => person.isBot && (person.openThreads > 0 || person.state === 'requested_changes'))

export const byAttention = (a: MrCard, b: MrCard): number => firstDifference(rank(a) - rank(b), b.updatedAt.localeCompare(a.updatedAt))

/**
 * An MR card's border colour, its review: red while someone asked for changes or it cannot merge as it is (conflicts,
 * a failed pipeline), green once approved, grey while it waits on a review. Whether it needs you is the line's weight.
 */
export function reviewTone(card: MrCard): Tone {
  if (card.changesRequestedBy.length > 0 || card.hasConflicts || card.pipeline?.status === 'failed') {
    return 'error'
  }
  // With no approvals required, approved means someone did approve.
  return card.approvalsLeft === 0 && (card.approvalsRequired > 0 || card.approvers.length > 0) ? 'success' : 'subtle'
}

export type BadgeKind =
  | 'failed'
  | 'conflicts'
  | 'changes'
  | 'threads'
  | 'rebase'
  | 'manual'
  | 'amber'
  | 'bots'
  | 'approvals'
  | 'ready'

/** One marker on a row's second line: a glyph and a count, its detail on hover; `words` is what a model reads. */
export type Badge = { kind: BadgeKind; glyph: string; tone: Tone; count: string; words: string }

/** What stands between the MR and a merge, each from its own field, worst first. */
export function badges(card: MrCard): Badge[] {
  const pipeline = card.pipeline
  const list: Badge[] = []
  const add = (kind: BadgeKind, glyph: string, tone: Tone, count: string, words: string) =>
    list.push({ kind, glyph, tone, count, words })
  if (pipeline !== undefined && pipeline.failed.length > 0) {
    add('failed', '✗', 'error', String(pipeline.failed.length), plural(pipeline.failed.length, 'job failed', 'jobs failed'))
  }
  if (card.hasConflicts) {
    add('conflicts', '⇄', 'error', '', 'conflicts')
  }
  if (card.changesRequestedBy.length > 0) {
    add('changes', '✋', 'error', String(card.changesRequestedBy.length), `changes requested by ${card.changesRequestedBy.join(', ')}`)
  }
  if (card.openThreads.length > 0) {
    add('threads', '💬', 'warning', String(card.openThreads.length), plural(card.openThreads.length, 'open thread'))
  }
  if (card.needsRebase) {
    add('rebase', '↻', 'warning', '', 'needs rebase')
  }
  if (pipeline !== undefined && pipeline.blockedOn.length > 0) {
    add('manual', '⏸', 'warning', '', `waiting on ${pipeline.blockedOn.join(', ')}`)
  }
  if (pipeline !== undefined && pipeline.amber.length > 0) {
    add('amber', '⚠', 'warning', String(pipeline.amber.length), `amber: ${pipeline.amber.map(job => job.name).join(', ')}`)
  }
  const holding = botsHolding(card)
  if (holding.length > 0) {
    const threads = holding.reduce((sum, bot) => sum + bot.openThreads, 0)
    const asked = holding.filter(bot => bot.state === 'requested_changes').map(bot => bot.name)
    const held = [threads > 0 ? plural(threads, 'open thread') : '', asked.length > 0 ? `${asked.join(', ')} requested changes` : '']
    add('bots', '🤖', 'subtle', String(threads + asked.length), `bots hold the merge: ${held.filter(Boolean).join(', ')}`)
  }
  if (card.approvalsRequired > 0) {
    const given = Math.max(0, card.approvalsRequired - card.approvalsLeft)
    add(
      'approvals',
      '👤',
      card.approvalsLeft > 0 ? 'subtle' : 'success',
      `${given}/${card.approvalsRequired}`,
      card.approvalsLeft > 0 ? `needs ${plural(card.approvalsLeft, 'approval')}` : 'approved'
    )
  }
  const blocks = list.some(badge => badge.kind !== 'approvals') || card.approvalsLeft > 0
  if (!blocks && pipeline?.status === 'success' && !card.isDraft) {
    add('ready', '⤵', 'success', '', 'ready to merge')
  }
  return list
}

/**
 * The row's markers: each person's or bot's icon speaks for their change request and threads, so 💬 keeps only threads
 * no icon holds.
 */
export function rowBadges(card: MrCard): Badge[] {
  const held = new Set(card.people.map(person => person.username))
  const loose = card.openThreads.filter(note => !held.has(note.author)).length
  return badges(card).flatMap(badge => {
    if (badge.kind === 'changes' || badge.kind === 'bots') {
      return []
    }
    if (badge.kind === 'threads') {
      return loose > 0 ? [{ ...badge, count: String(loose), words: plural(loose, 'open thread') }] : []
    }
    return [badge]
  })
}

type Verdict = { words: string; tone: Tone; covers: readonly BadgeKind[] }

const said = (words: string, tone: Tone, covers: readonly BadgeKind[] = []): Verdict => ({ words, tone, covers })

/**
 * What each of GitLab's verdicts says, in words and a tone, with the pane's markers it already covers so they would only
 * repeat it. Null for one still being worked out by GitLab, or about an MR that has left: nothing worth saying.
 */
const VERDICT: Record<MergeStatus, (card: MrCard) => Verdict | null> = {
  MERGEABLE: () => said('✓ mergeable', 'success', ['ready', 'approvals']),
  NOT_APPROVED: card => said(card.approvalsLeft > 0 ? `needs ${plural(card.approvalsLeft, 'approval')}` : 'needs approval', 'subtle', ['approvals']),
  REQUESTED_CHANGES: () => said('changes requested', 'error', ['changes']),
  CONFLICT: () => said('conflicts', 'error', ['conflicts']),
  NEED_REBASE: () => said('needs rebase', 'warning', ['rebase']),
  CI_MUST_PASS: () => said('CI must pass', 'error', ['failed']),
  CI_STILL_RUNNING: () => said('CI running', 'subtle'),
  DISCUSSIONS_NOT_RESOLVED: () => said('threads open', 'warning', ['threads']),
  DRAFT_STATUS: () => said('draft', 'subtle'),
  COMMITS_STATUS: () => said('commits status', 'subtle'),
  BLOCKED_STATUS: () => said('blocked status', 'subtle'),
  EXTERNAL_STATUS_CHECKS: () => said('external status checks', 'subtle'),
  JIRA_ASSOCIATION: () => said('jira association', 'subtle'),
  LOCKED_PATHS: () => said('locked paths', 'subtle'),
  LOCKED_LFS_FILES: () => said('locked lfs files', 'subtle'),
  MERGE_TIME: () => said('merge time', 'subtle'),
  SECURITY_POLICIES_VIOLATIONS: () => said('security policies violations', 'subtle'),
  TITLE_NOT_MATCHING: () => said('title not matching', 'subtle'),
  SECURITY_POLICY_PIPELINE_CHECK: () => said('security policy pipeline check', 'subtle'),
  UNKNOWN: () => said('merge status unknown', 'subtle'),
  UNCHECKED: () => null,
  CHECKING: () => null,
  PREPARING: () => null,
  APPROVALS_SYNCING: () => null,
  NOT_OPEN: () => null,
}

/** GitLab's own verdict on whether the MR can merge (`detailedMergeStatus`); null while GitLab is deciding, or when it was not read. */
export const verdictOf = (card: MrCard): Verdict | null => (card.mergeStatus !== null ? VERDICT[card.mergeStatus](card) : null)

/** A person's icon colour: asked for changes, open threads, approved, or nothing pending. */
export const personTone = (person: Person): Tone =>
  person.state === 'requested_changes' ? 'error' : person.openThreads > 0 ? 'warning' : person.state === 'approved' ? 'success' : 'subtle'
