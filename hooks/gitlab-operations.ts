// Every operation the pane sends GitLab, gathered from the modules that own them: each `ask-*.ts` module holds one question's
// documents, its request, its cost and how its answer reads. This file only adds them up, for the sender (which retries a read
// and never a write), the schema check (tools/gitlab_schema.ts) and the fakes in the tests.
import { ADD_REVIEWER_ASK } from './ask-add-reviewer.ts'
import type { AddReviewerOperations } from './ask-add-reviewer.ts'
import { AUTHORED_ASK } from './ask-authored.ts'
import type { AuthoredOperations } from './ask-authored.ts'
import { FAILURES_ASK } from './ask-failures.ts'
import type { FailuresOperations } from './ask-failures.ts'
import { INBOX_AUTHORED_ASK } from './ask-inbox-authored.ts'
import type { InboxAuthoredOperations } from './ask-inbox-authored.ts'
import { INBOX_BRIEF_ASK } from './ask-inbox-brief.ts'
import type { InboxBriefOperations } from './ask-inbox-brief.ts'
import { INBOX_FOLLOW_ASK } from './ask-inbox-follow.ts'
import type { InboxFollowOperations } from './ask-inbox-follow.ts'
import { INBOX_QUEUE_ASK } from './ask-inbox-queue.ts'
import type { InboxQueueOperations } from './ask-inbox-queue.ts'
import { INBOX_TODOS_ASK } from './ask-inbox-todos.ts'
import type { InboxTodosOperations } from './ask-inbox-todos.ts'
import { LANDED_ASK } from './ask-landed.ts'
import type { LandedOperations } from './ask-landed.ts'
import { MERGE_ASK } from './ask-merge.ts'
import type { MergeOperations } from './ask-merge.ts'
import { MERGE_STATUS_ASK } from './ask-merge-status.ts'
import type { MergeStatusOperations } from './ask-merge-status.ts'
import { MOVE_STATE_ASK } from './ask-move-state.ts'
import type { MoveStateOperations } from './ask-move-state.ts'
import { PINNED_ASK } from './ask-pinned.ts'
import type { PinnedOperations } from './ask-pinned.ts'
import { REPLY_ASK } from './ask-reply.ts'
import type { ReplyOperations } from './ask-reply.ts'
import { SUGGESTED_ASK } from './ask-suggested.ts'
import type { SuggestedOperations } from './ask-suggested.ts'
import { THREADS_ASK } from './ask-threads.ts'
import type { ThreadsOperations } from './ask-threads.ts'
import { USUAL_ASK } from './ask-usual.ts'
import type { UsualOperations } from './ask-usual.ts'

/** The operations the pane sends, by name, with what each takes and answers: the fakes in the tests key on this. */
export type Operations = AuthoredOperations &
  PinnedOperations &
  MergeStatusOperations &
  UsualOperations &
  FailuresOperations &
  ThreadsOperations &
  ReplyOperations &
  InboxTodosOperations &
  InboxQueueOperations &
  InboxAuthoredOperations &
  InboxBriefOperations &
  InboxFollowOperations &
  LandedOperations &
  MoveStateOperations &
  MergeOperations &
  SuggestedOperations &
  AddReviewerOperations

/** The documents that change GitLab: mutations, which are sent once and never scored, since scoring a document sends it. */
export const WRITES = [...MERGE_ASK.writes, ...REPLY_ASK.writes, ...ADD_REVIEWER_ASK.writes] as const satisfies readonly (keyof Operations)[]

type Reads = Exclude<keyof Operations, (typeof WRITES)[number]>

/** The text sent for each document, by operation name, for tools/gitlab_schema.ts to check against GitLab's schema. */
export const DOCUMENTS: { readonly [Name in keyof Operations]: string } = {
  ...AUTHORED_ASK.documents,
  ...PINNED_ASK.documents,
  ...MERGE_STATUS_ASK.documents,
  ...USUAL_ASK.documents,
  ...FAILURES_ASK.documents,
  ...THREADS_ASK.documents,
  ...REPLY_ASK.documents,
  ...INBOX_TODOS_ASK.documents,
  ...INBOX_QUEUE_ASK.documents,
  ...INBOX_AUTHORED_ASK.documents,
  ...INBOX_BRIEF_ASK.documents,
  ...INBOX_FOLLOW_ASK.documents,
  ...LANDED_ASK.documents,
  ...MOVE_STATE_ASK.documents,
  ...MERGE_ASK.documents,
  ...SUGGESTED_ASK.documents,
  ...ADD_REVIEWER_ASK.documents,
}

/**
 * What GitLab's `queryComplexity` scores each read, which `node tools/gitlab_schema.ts check` measures against gitlab.com,
 * with no sign-in. A query may cost no more than the limit, and the check also fails any document that scores other than
 * this, or more than COMPLEXITY_SHARE of the limit it reports, so a change to a document states its cost.
 */
export const COMPLEXITY: { readonly [Name in Reads]: number } = {
  ...AUTHORED_ASK.complexity,
  ...PINNED_ASK.complexity,
  ...MERGE_STATUS_ASK.complexity,
  ...USUAL_ASK.complexity,
  ...FAILURES_ASK.complexity,
  ...THREADS_ASK.complexity,
  ...INBOX_TODOS_ASK.complexity,
  ...INBOX_QUEUE_ASK.complexity,
  ...INBOX_AUTHORED_ASK.complexity,
  ...INBOX_BRIEF_ASK.complexity,
  ...INBOX_FOLLOW_ASK.complexity,
  ...LANDED_ASK.complexity,
  ...MOVE_STATE_ASK.complexity,
  ...SUGGESTED_ASK.complexity,
}

/** The most of GitLab's limit a document may score: the rest is room for a field to grow, and for the other queries of a read. */
export const COMPLEXITY_SHARE = 0.8

/** Whether a request changes GitLab, by the document it sends: such a request is sent once and never again on a failure. */
export function isWrite(request: { operation: keyof Operations }): boolean {
  const writes: readonly string[] = WRITES
  return writes.includes(request.operation)
}
