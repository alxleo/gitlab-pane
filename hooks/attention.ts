import type { MergeabilityCheckIdentifier } from './gitlab.generated.ts'
import { amberCount, failedCount, looseCount, plural, threadCount } from './format.ts'
import { firstDifference } from './order.ts'
import { isSettled, type Tone } from './status.ts'

import type { MergeCheck, MergeStatus, MrCard, Person } from '../types'

/** 0 needs you now, 1 is moving, 2 waits on others, 3 is ready. */
export function rank(card: MrCard): number {
  const status = card.pipeline?.status
  if (
    status === 'failed' ||
    (card.pipeline !== undefined && failedCount(card.pipeline) > 0) ||
    card.hasConflicts ||
    card.needsRebase ||
    card.changesRequestedBy.length > 0 ||
    threadCount(card) > 0
  ) {
    return 0
  }
  if (status !== undefined && !isSettled(status)) {
    return 1
  }
  return card.approvalsLeft > 0 || status === 'manual' || botsHolding(card).length > 0 ? 2 : 3
}

/** Bots with an open thread or a request for changes, either of which holds the merge. */
const botsHolding = (card: MrCard): Person[] => card.people.filter(person => person.isBot && (person.openThreads > 0 || person.state === 'requested_changes'))

export const byAttention = (a: MrCard, b: MrCard): number => firstDifference(rank(a) - rank(b), b.updatedAt.localeCompare(a.updatedAt))

/**
 * An MR card's border colour, its review: red while someone asked for changes or it cannot merge as it is (conflicts,
 * a failed pipeline, or a job that failed in one still running), green once approved, grey while it waits on a review.
 * Whether it needs you is the line's weight.
 */
export function reviewTone(card: MrCard): Tone {
  if (card.changesRequestedBy.length > 0 || card.hasConflicts || card.pipeline?.status === 'failed' || (card.pipeline !== undefined && failedCount(card.pipeline) > 0)) {
    return 'error'
  }
  // With no approvals required, approved means someone did approve.
  return card.approvalsLeft === 0 && (card.approvalsRequired > 0 || card.approvers.length > 0) ? 'success' : 'subtle'
}

type BadgeKind = 'failed' | 'check' | 'conflicts' | 'changes' | 'threads' | 'rebase' | 'manual' | 'amber' | 'bots' | 'approvals' | 'ready'

/**
 * One marker on a row's second line: a glyph and a count, its detail on the MR's page; `words` is what a model reads. `check` is
 * the GitLab merge check (by its identifier) that the marker is, or that it gives the detail of.
 */
export type Badge = { kind: BadgeKind; glyph: string; tone: Tone; count: string; words: string; check?: string }

const ACRONYMS = /\b(ci|lfs)\b/g

/** A check in words, from the identifier GitLab names it by (`CI_MUST_PASS`): a check GitLab adds later reads right with no change here. */
const checkWords = (id: string): string =>
  id
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(ACRONYMS, found => found.toUpperCase())

/** The checks that stop the merge or warn, GitLab's order within each: a failure before a warning. */
const standing = (checks: MergeStatus | null): MergeCheck[] => (['failed', 'warning'] as const).flatMap(status => (checks ?? []).filter(check => check.status === status))

/**
 * What each check asks of you when it fails, as a tone: red is yours to fix, amber is a smaller fix, grey is waiting on
 * others or on time. Typed over GitLab's identifiers, so a check GitLab adds does not compile until it has a tone.
 */
export const CHECK_TONE: Record<MergeabilityCheckIdentifier, Tone> = {
  CI_MUST_PASS: 'error',
  COMMITS_STATUS: 'error',
  CONFLICT: 'error',
  DISCUSSIONS_NOT_RESOLVED: 'warning',
  DRAFT_STATUS: 'subtle',
  JIRA_ASSOCIATION_MISSING: 'warning',
  LOCKED_LFS_FILES: 'error',
  LOCKED_PATHS: 'error',
  MERGE_REQUEST_BLOCKED: 'subtle',
  MERGE_TIME: 'subtle',
  NEED_REBASE: 'warning',
  NOT_APPROVED: 'subtle',
  NOT_OPEN: 'subtle',
  REQUESTED_CHANGES: 'error',
  SECURITY_POLICY_PIPELINE_CHECK: 'error',
  SECURITY_POLICY_VIOLATIONS: 'error',
  STATUS_CHECKS_MUST_PASS: 'subtle',
  TITLE_REGEX: 'warning',
}

const isKnownCheck = (id: string): id is MergeabilityCheckIdentifier => Object.hasOwn(CHECK_TONE, id)

/** A failing check's tone; one GitLab adds after this was written blocks the merge, so it is red until it has a tone. */
const failureTone = (id: string): Tone => (isKnownCheck(id) ? CHECK_TONE[id] : 'error')

/** A check in words; the approvals and the threads ones say how many, as the pane knows. */
function wordsFor(card: MrCard, id: string): string {
  if (id === 'NOT_APPROVED' && card.approvalsLeft > 0) {
    return `needs ${plural(card.approvalsLeft, 'approval')}`
  }
  if (id === 'DISCUSSIONS_NOT_RESOLVED' && threadCount(card) > 0) {
    return plural(threadCount(card), 'open thread')
  }
  return checkWords(id)
}

const checkBadge = (card: MrCard, check: MergeCheck): Badge => ({
  kind: 'check',
  glyph: check.status === 'failed' ? '✗' : '⚠',
  tone: check.status === 'failed' ? failureTone(check.id) : 'warning',
  count: '',
  words: wordsFor(card, check.id),
  check: check.id,
})

/** Whether GitLab says the MR can merge: none of its checks fails or is still being made, and one has passed. */
export const isMergeable = (checks: MergeStatus | null): boolean =>
  checks !== null && checks.some(check => check.status === 'success') && checks.every(check => ['success', 'inactive', 'warning'].includes(check.status))

/** GitLab says the MR is no longer open, which its authored list shows a read later. */
export const hasLeft = (card: MrCard): boolean => card.mergeStatus?.some(check => check.id === 'NOT_OPEN' && check.status === 'failed') === true

/**
 * What stands between the MR and a merge, worst first: the pipeline's failed jobs, then every check GitLab fails or warns
 * of, then what only the pane knows (who asked for changes, threads and approvals as people, manual and allowed-to-fail
 * jobs, bots). A marker that gives the detail of a check stands in its place. A host that gives no checks gets the pane's
 * own markers for conflicts and a rebase.
 */
export function badges(card: MrCard): Badge[] {
  const pipeline = card.pipeline
  const checks = card.mergeStatus
  const list: Badge[] = []
  const add = (kind: BadgeKind, glyph: string, tone: Tone, count: string, words: string, check?: string) =>
    list.push({ kind, glyph, tone, count, words, ...(check !== undefined ? { check } : {}) })
  if (pipeline !== undefined && failedCount(pipeline) > 0) {
    add('failed', '✗', 'error', String(failedCount(pipeline)), plural(failedCount(pipeline), 'job failed', 'jobs failed'), 'CI_MUST_PASS')
  }
  if (checks === null && card.hasConflicts) {
    add('conflicts', '⇄', 'error', '', 'conflicts')
  }
  if (card.changesRequestedBy.length > 0) {
    add('changes', '✋', 'error', String(card.changesRequestedBy.length), `changes requested by ${card.changesRequestedBy.join(', ')}`, 'REQUESTED_CHANGES')
  }
  if (threadCount(card) > 0) {
    add('threads', '💬', 'warning', String(threadCount(card)), plural(threadCount(card), 'open thread'), 'DISCUSSIONS_NOT_RESOLVED')
  }
  if (checks === null && card.needsRebase) {
    add('rebase', '↻', 'warning', '', 'needs rebase')
  }
  if (pipeline !== undefined && pipeline.blockedOn.length > 0) {
    add('manual', '⏸', 'warning', '', `waiting on ${pipeline.blockedOn.join(', ')}`)
  }
  if (pipeline !== undefined && amberCount(pipeline) > 0) {
    const left = pipeline.moreAmber > 0 ? ` +${pipeline.moreAmber} more` : ''
    add('amber', '⚠', 'warning', String(amberCount(pipeline)), `amber: ${pipeline.amber.map(job => job.name).join(', ')}${left}`)
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
      card.approvalsLeft > 0 ? `needs ${plural(card.approvalsLeft, 'approval')}` : 'approved',
      'NOT_APPROVED'
    )
  }
  const claimed = new Set(list.flatMap(badge => badge.check ?? []))
  const unsaid = standing(checks)
    .filter(check => !claimed.has(check.id))
    .map(check => checkBadge(card, check))
  const isReady = checks !== null ? isMergeable(checks) : card.approvalsLeft === 0 && pipeline?.status === 'success' && !card.isDraft
  const blocks = list.some(badge => badge.kind !== 'approvals')
  const ready: Badge[] = !blocks && isReady ? [{ kind: 'ready', glyph: '⤵', tone: 'success', count: '', words: 'ready to merge' }] : []
  return [...list.filter(badge => badge.kind === 'failed'), ...unsaid, ...list.filter(badge => badge.kind !== 'failed'), ...ready]
}

/**
 * The row's markers: each person's or bot's icon speaks for their change request and threads, so 💬 keeps only threads
 * no icon holds. A check GitLab fails for what an icon speaks for still shows, as the check.
 */
export function rowBadges(card: MrCard): Badge[] {
  const held = new Set(card.people.map(person => person.username))
  const loose = looseCount(card, held)
  const checkOf = (id: string): Badge[] =>
    standing(card.mergeStatus)
      .filter(check => check.id === id)
      .map(check => checkBadge(card, check))
  return badges(card).flatMap(badge => {
    if (badge.kind === 'changes') {
      return checkOf('REQUESTED_CHANGES')
    }
    if (badge.kind === 'bots') {
      return []
    }
    if (badge.kind === 'threads') {
      return loose > 0 ? [{ ...badge, count: String(loose), words: plural(loose, 'open thread') }] : checkOf('DISCUSSIONS_NOT_RESOLVED')
    }
    return [badge]
  })
}

/** GitLab's verdict in words: its first failing check, in its own order, else the one still being checked, else that the MR can merge. `check` is the one said. */
export type Verdict = { words: string; tone: Tone; check: string | null }

/** Null while no check was read, and while a check GitLab cannot say yet is of a status the pane has no name for. */
export function verdictOf(card: MrCard): Verdict | null {
  const failed = card.mergeStatus?.find(check => check.status === 'failed')
  if (failed !== undefined) {
    return { words: wordsFor(card, failed.id), tone: failureTone(failed.id), check: failed.id }
  }
  const checking = card.mergeStatus?.find(check => check.status === 'checking')
  if (checking !== undefined) {
    return { words: `${checkWords(checking.id)} (checking)`, tone: 'subtle', check: checking.id }
  }
  return isMergeable(card.mergeStatus) ? { words: '✓ mergeable', tone: 'success', check: null } : null
}

/** The row's markers that trail the verdict: those it does not already say, and none that repeats a passed check. */
export const trailingOf = (verdict: Verdict, row: readonly Badge[]): Badge[] =>
  row.filter(badge => badge.kind !== 'ready' && (verdict.check === null ? badge.kind === 'check' || badge.check === undefined : badge.check !== verdict.check))

/** A person's icon colour: asked for changes, open threads, approved, or nothing pending. */
export const personTone = (person: Person): Tone =>
  person.state === 'requested_changes' ? 'error' : person.openThreads > 0 ? 'warning' : person.state === 'approved' ? 'success' : 'subtle'
