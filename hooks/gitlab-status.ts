import type { CiStatus, MergeStatus, ReviewState } from '../types'

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

const MERGE_STATUSES: Record<MergeStatus, true> = {
  UNCHECKED: true,
  CHECKING: true,
  MERGEABLE: true,
  COMMITS_STATUS: true,
  CI_MUST_PASS: true,
  CI_STILL_RUNNING: true,
  DISCUSSIONS_NOT_RESOLVED: true,
  DRAFT_STATUS: true,
  NOT_OPEN: true,
  NOT_APPROVED: true,
  BLOCKED_STATUS: true,
  EXTERNAL_STATUS_CHECKS: true,
  PREPARING: true,
  JIRA_ASSOCIATION: true,
  CONFLICT: true,
  NEED_REBASE: true,
  APPROVALS_SYNCING: true,
  LOCKED_PATHS: true,
  LOCKED_LFS_FILES: true,
  MERGE_TIME: true,
  SECURITY_POLICIES_VIOLATIONS: true,
  TITLE_NOT_MATCHING: true,
  REQUESTED_CHANGES: true,
  SECURITY_POLICY_PIPELINE_CHECK: true,
  UNKNOWN: true,
}

// GitLab adds enum values without notice; one the pane does not know becomes `unknown`, drawn as such, and never a known one.
const isMember = <T extends string>(table: Record<T, true>, value: string): value is T => Object.hasOwn(table, value)
const known = <T extends string>(table: Record<T, true>, value: string): T | undefined => (isMember(table, value) ? value : undefined)

/** GitLab's `CiJobStatus` or `PipelineStatusEnum` (or a stage's status, a plain string), lower cased. */
export const ciStatusOf = (status: string): CiStatus => known(CI_STATUSES, status.toLowerCase()) ?? 'unknown'

/** `MergeRequestReviewState`, lower cased; none yet reads as unreviewed. */
export const reviewStateOf = (state: string | null | undefined): ReviewState => known(REVIEW_STATES, (state ?? 'unreviewed').toLowerCase()) ?? 'unknown'

export const mergeStatusOf = (status: string): MergeStatus => known(MERGE_STATUSES, status) ?? 'UNKNOWN'
