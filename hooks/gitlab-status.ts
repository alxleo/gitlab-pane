import type { CheckStatus, CiStatus, ReviewState } from '../types'

const CI_STATUSES: Record<CiStatus, true> = {
  created: true,
  waiting_for_resource: true,
  preparing: true,
  waiting_for_callback: true,
  pending: true,
  running: true,
  success: true,
  failed: true,
  canceling: true,
  canceled: true,
  skipped: true,
  manual: true,
  scheduled: true,
  unknown: true,
}

const REVIEW_STATES: Record<ReviewState, true> = {
  unreviewed: true,
  reviewed: true,
  requested_changes: true,
  approved: true,
  unapproved: true,
  review_started: true,
  unknown: true,
}

const CHECK_STATUSES: Record<CheckStatus, true> = {
  success: true,
  checking: true,
  failed: true,
  warning: true,
  inactive: true,
  unknown: true,
}

// GitLab adds enum values without notice; one the pane does not know becomes `unknown`, drawn as such, and never a known one.
const isMember = <T extends string>(table: Record<T, true>, value: string): value is T => Object.hasOwn(table, value)
const known = <T extends string>(table: Record<T, true>, value: string): T | undefined => (isMember(table, value) ? value : undefined)

/** GitLab's `CiJobStatus` or `PipelineStatusEnum` (or a stage's status, a plain string), lower cased. */
export const ciStatusOf = (status: string): CiStatus => known(CI_STATUSES, status.toLowerCase()) ?? 'unknown'

/** `MergeRequestReviewState`, lower cased; none yet reads as unreviewed. */
export const reviewStateOf = (state: string | null | undefined): ReviewState => known(REVIEW_STATES, (state ?? 'unreviewed').toLowerCase()) ?? 'unknown'

/** GitLab's `MergeabilityCheckStatus`, lower cased. */
export const checkStatusOf = (status: string): CheckStatus => known(CHECK_STATUSES, status.toLowerCase()) ?? 'unknown'
