// Every GraphQL document the pane sends (those on merging an MR are in merge-gitlab.ts, an MR page's own in
// page-documents.ts), and the requests built from them. tools/gitlab_schema.ts checks DOCUMENTS against GitLab;
// graphql-codegen reads all three files for gitlab.generated.ts.
import { MERGE, MERGE_STATUS, MOVE_STATE } from './merge-gitlab.ts'
import type { WRITES } from './merge-gitlab.ts'
import type {
  AuthoredPlainQuery,
  AuthoredPlainQueryVariables,
  AuthoredQuery,
  AuthoredQueryVariables,
  FailuresQuery,
  FailuresQueryVariables,
  InboxAuthoredQuery,
  InboxAuthoredQueryVariables,
  InboxBriefQuery,
  InboxBriefQueryVariables,
  InboxFollowProjectQuery,
  InboxFollowProjectQueryVariables,
  InboxFollowUserQuery,
  InboxFollowUserQueryVariables,
  InboxQueueQuery,
  InboxTodosPlainQuery,
  InboxTodosQuery,
  MergeMutation,
  MergeMutationVariables,
  MergeStatusQuery,
  MoveStateQuery,
  MoveStateQueryVariables,
  PinnedPlainQuery,
  PinnedQuery,
  PinnedQueryVariables,
  UsualQuery,
  UsualQueryVariables,
} from './gitlab.generated.ts'
import { PAGE_COMPLEXITY, PAGE_DOCUMENTS } from './page-documents.ts'
import type { PageOperations } from './page-documents.ts'

import type { HostFeatures, Pinned } from '../types'

/**
 * Every document the pane sends is a static GraphQL text with its values passed as variables, never spliced in. The
 * GraphQL comment before each is how the type generator finds it. A document names the fragments it uses and only
 * those, as GitLab refuses an unused one.
 */
const NOTE_FRAGMENT = /* GraphQL */ `
  fragment NoteFields on Note {
    body system url createdAt
    author { username name bot avatarUrl }
    position { filePath newLine oldLine }
  }
`

// Stage jobs leave out retried ones, so a job that failed then passed on retry reads as passed.
const MR_FRAGMENT = /* GraphQL */ `
  fragment MrFields on MergeRequest {
    iid state title webUrl draft conflicts shouldBeRebased approvalsLeft approvalsRequired updatedAt
    description sourceBranch targetBranch
    author { username }
    diffStatsSummary { additions deletions fileCount }
    project { fullPath name webUrl }
    approvedBy { nodes { username name bot avatarUrl } }
    headPipeline {
      id status duration startedAt finishedAt path
      stages { nodes { name status jobs { nodes { name status allowFailure startedAt finishedAt webPath } } } }
    }
    discussions(first: 100) { nodes { resolvable resolved notes(first: 20) { nodes { ...NoteFields } } } }
  }
`

// A reviewer's review state needs GitLab 16 or newer; a host without it gets the plain reviewer and the plain documents.
const REVIEWER_FRAGMENT = /* GraphQL */ `
  fragment ReviewerFields on MergeRequestReviewer {
    username name bot avatarUrl mergeRequestInteraction { reviewState }
  }
`

const REVIEWER_PLAIN_FRAGMENT = /* GraphQL */ `
  fragment ReviewerPlain on MergeRequestReviewer {
    username name bot avatarUrl
  }
`

const AUTHORED = /* GraphQL */ `
  query Authored($state: MergeRequestState, $after: Time) {
    currentUser { authoredMergeRequests(state: $state, updatedAfter: $after, first: 50, sort: UPDATED_DESC) { nodes { ...MrFields reviewers { nodes { ...ReviewerFields } } } } }
  }
`

const AUTHORED_PLAIN = /* GraphQL */ `
  query AuthoredPlain($state: MergeRequestState, $after: Time) {
    currentUser { authoredMergeRequests(state: $state, updatedAfter: $after, first: 50, sort: UPDATED_DESC) { nodes { ...MrFields reviewers { nodes { ...ReviewerPlain } } } } }
  }
`

const PINNED = /* GraphQL */ `
  query Pinned($path: ID!, $iid: String!) {
    project(fullPath: $path) { mergeRequest(iid: $iid) { ...MrFields reviewers { nodes { ...ReviewerFields } } } }
  }
`

const PINNED_PLAIN = /* GraphQL */ `
  query PinnedPlain($path: ID!, $iid: String!) {
    project(fullPath: $path) { mergeRequest(iid: $iid) { ...MrFields reviewers { nodes { ...ReviewerPlain } } } }
  }
`

// Why a raised MR's failed jobs failed, asked only when its pipeline has just failed: one small query then, and no field
// on every read for a message few reads need. A host too old to have the field answers an error, and the wake goes without.
const FAILURES = /* GraphQL */ `
  query Failures($path: ID!, $iid: String!) {
    project(fullPath: $path) { mergeRequest(iid: $iid) { headPipeline { jobs(statuses: [FAILED], retried: false) { nodes { webPath allowFailure failureMessage } } } } }
  }
`

const USUAL = /* GraphQL */ `
  query Usual($path: ID!) {
    project(fullPath: $path) { pipelines(source: "merge_request_event", status: SUCCESS, first: 20) { nodes { duration } } }
  }
`

// ---- The inbox: what GitLab says happened to the user's MRs ---------------------------------------------------------------
// Four documents, none of which changes anything. Each costs far less than a query may (`COMPLEXITY`), so a host that times one
// out loses only that one. A host without a field (`mergeUser`, `systemNoteMetadata`) needs a GitLab older than the ones
// the pane supports, so there are no plain variants here.

const INBOX_MR_FRAGMENT = /* GraphQL */ `
  fragment InboxMrFields on MergeRequest {
    iid state title webUrl draft createdAt
    author { username name }
    project { fullPath }
  }
`

// The last 30 notes of an MR, newest last. A system note's action says what it was: approved, unapproved,
// requested_changes, reviewed and commit (a push) are the ones the inbox counts.
const INBOX_NOTE_FRAGMENT = /* GraphQL */ `
  fragment InboxNoteFields on Note {
    id body system createdAt
    author { username name bot }
    ...InboxNoteActionFields
  }
`

// The fields a host may lack are fragments of their own, so a variant of a document without one is the document without
// its fragment. A system note's action says what it was.
const INBOX_NOTE_ACTION_FRAGMENT = /* GraphQL */ `
  fragment InboxNoteActionFields on Note {
    systemNoteMetadata { action }
  }
`

const INBOX_MERGED_BY_FRAGMENT = /* GraphQL */ `
  fragment InboxMergedByFields on MergeRequest {
    mergedAt
    mergeUser { username name }
  }
`

// What was addressed to the user and is still pending in GitLab's own to-do list; the pane never marks one done. `targetEntity`
// is GitLab 17.4 and newer, where `target` is deprecated. A host that says it has no `targetEntity` is sent the plain variant,
// which asks for `target` (see INBOX_TODOS_PLAIN).
const INBOX_TODOS = /* GraphQL */ `
  query InboxTodos {
    currentUser {
      username
      todos(
        state: [pending]
        type: [MERGEREQUEST]
        action: [review_requested, approval_required, mentioned, directly_addressed, review_submitted, build_failed, unmergeable]
        first: 50
      ) {
        nodes {
          action createdAt body targetUrl
          author { username name }
          targetEntity { webUrl ... on MergeRequest { ...InboxMrFields } }
        }
      }
    }
  }
`

const INBOX_TODOS_PLAIN = /* GraphQL */ `
  query InboxTodosPlain {
    currentUser {
      username
      todos(
        state: [pending]
        type: [MERGEREQUEST]
        action: [review_requested, approval_required, mentioned, directly_addressed, review_submitted, build_failed, unmergeable]
        first: 50
      ) {
        nodes {
          action createdAt body targetUrl
          author { username name }
          target { webUrl ... on MergeRequest { ...InboxMrFields } }
        }
      }
    }
  }
`

// The review queue: open MRs the user is a reviewer of. Those the user has approved already are told apart by the reader.
const INBOX_QUEUE = /* GraphQL */ `
  query InboxQueue {
    currentUser {
      username
      reviewRequestedMergeRequests(state: opened, first: 30, sort: UPDATED_DESC) {
        nodes {
          ...InboxMrFields
          approvedBy { nodes { username } }
          notes(last: 30) { pageInfo { hasPreviousPage } nodes { ...InboxNoteFields } }
        }
      }
    }
  }
`

// The user's own open MRs with their latest notes, and the ones merged since a date, who merged them.
const INBOX_AUTHORED = /* GraphQL */ `
  query InboxAuthored($since: Time!) {
    currentUser {
      username
      opened: authoredMergeRequests(state: opened, first: 30, sort: UPDATED_DESC) {
        nodes {
          ...InboxMrFields
          notes(last: 30) { pageInfo { hasPreviousPage } nodes { ...InboxNoteFields } }
        }
      }
      merged: authoredMergeRequests(state: merged, mergedAfter: $since, first: 10, sort: MERGED_AT_DESC) {
        nodes {
          ...InboxMrFields
          ...InboxMergedByFields
        }
      }
    }
  }
`

// The MRs of a person or a project the inboxFollow setting names: the open ones with their latest notes, and the ones merged
// since a date. A user or project the host does not know answers null, which is no MRs, not an error.
const INBOX_FOLLOW_USER = /* GraphQL */ `
  query InboxFollowUser($username: String!, $since: Time!) {
    currentUser { username }
    user(username: $username) {
      opened: authoredMergeRequests(state: opened, first: 10, sort: UPDATED_DESC) {
        nodes {
          ...InboxMrFields
          notes(last: 30) { pageInfo { hasPreviousPage } nodes { ...InboxNoteFields } }
        }
      }
      merged: authoredMergeRequests(state: merged, mergedAfter: $since, first: 5, sort: MERGED_AT_DESC) {
        nodes {
          ...InboxMrFields
          ...InboxMergedByFields
        }
      }
    }
  }
`

const INBOX_FOLLOW_PROJECT = /* GraphQL */ `
  query InboxFollowProject($path: ID!, $since: Time!) {
    currentUser { username }
    project(fullPath: $path) {
      opened: mergeRequests(state: opened, first: 10, sort: UPDATED_DESC) {
        nodes {
          ...InboxMrFields
          notes(last: 30) { pageInfo { hasPreviousPage } nodes { ...InboxNoteFields } }
        }
      }
      merged: mergeRequests(state: merged, mergedAfter: $since, first: 5, sort: MERGED_AT_DESC) {
        nodes {
          ...InboxMrFields
          ...InboxMergedByFields
        }
      }
    }
  }
`

// One MR whole, for /mrs: its description and its threads. 30 notes of 100 threads is `COMPLEXITY.InboxBrief`.
const INBOX_BRIEF = /* GraphQL */ `
  query InboxBrief($path: ID!, $iid: String!) {
    project(fullPath: $path) {
      mergeRequest(iid: $iid) {
        ...InboxMrFields
        description sourceBranch targetBranch
        discussions(first: 100) {
          nodes {
            resolvable resolved
            notes(first: 30) { nodes { id body system createdAt author { username name bot } } }
          }
        }
      }
    }
  }
`

/**
 * A document with the operation name it carries, its variables, and (in the type alone, never set) what GitLab answers
 * it with. The variables are strings, as the documents declare them.
 */
export type Request<Data> = { operation: keyof Operations; query: string; variables: Record<string, string>; readonly answer?: Data }

/** GitLab's answer to a document: its data, or none, and the errors beside either. */
export type RawResponse<Data> = { data?: Data | null; errors?: { message: string; extensions?: { code?: string; typeName?: string; fieldName?: string } }[] }

/** The operations the pane sends, by name, with what each takes and answers: the fakes in the tests key on this. */
export type Operations = PageOperations & {
  Authored: { variables: AuthoredQueryVariables; data: AuthoredQuery }
  AuthoredPlain: { variables: AuthoredPlainQueryVariables; data: AuthoredPlainQuery }
  MergeStatus: { variables: Record<string, never>; data: MergeStatusQuery }
  Failures: { variables: FailuresQueryVariables; data: FailuresQuery }
  Pinned: { variables: PinnedQueryVariables; data: PinnedQuery }
  PinnedPlain: { variables: PinnedQueryVariables; data: PinnedPlainQuery }
  Usual: { variables: UsualQueryVariables; data: UsualQuery }
  InboxTodos: { variables: Record<string, never>; data: InboxTodosQuery }
  InboxTodosPlain: { variables: Record<string, never>; data: InboxTodosPlainQuery }
  InboxQueue: { variables: Record<string, never>; data: InboxQueueQuery }
  InboxAuthored: { variables: InboxAuthoredQueryVariables; data: InboxAuthoredQuery }
  InboxBrief: { variables: InboxBriefQueryVariables; data: InboxBriefQuery }
  InboxFollowUser: { variables: InboxFollowUserQueryVariables; data: InboxFollowUserQuery }
  InboxFollowProject: { variables: InboxFollowProjectQueryVariables; data: InboxFollowProjectQuery }
  MoveState: { variables: MoveStateQueryVariables; data: MoveStateQuery }
  Merge: { variables: MergeMutationVariables; data: MergeMutation }
}

type Reads = Exclude<keyof Operations, (typeof WRITES)[number]>

/** The text sent for each document, by operation name, for tools/gitlab_schema.py to check against GitLab's schema. */
export const DOCUMENTS = {
  Authored: AUTHORED + MR_FRAGMENT + REVIEWER_FRAGMENT + NOTE_FRAGMENT,
  AuthoredPlain: AUTHORED_PLAIN + MR_FRAGMENT + REVIEWER_PLAIN_FRAGMENT + NOTE_FRAGMENT,
  Failures: FAILURES,
  MergeStatus: MERGE_STATUS,
  Pinned: PINNED + MR_FRAGMENT + REVIEWER_FRAGMENT + NOTE_FRAGMENT,
  PinnedPlain: PINNED_PLAIN + MR_FRAGMENT + REVIEWER_PLAIN_FRAGMENT + NOTE_FRAGMENT,
  Usual: USUAL,
  ...PAGE_DOCUMENTS,
  InboxTodos: INBOX_TODOS + INBOX_MR_FRAGMENT,
  InboxTodosPlain: INBOX_TODOS_PLAIN + INBOX_MR_FRAGMENT,
  InboxQueue: INBOX_QUEUE + INBOX_MR_FRAGMENT + INBOX_NOTE_FRAGMENT + INBOX_NOTE_ACTION_FRAGMENT,
  InboxAuthored: INBOX_AUTHORED + INBOX_MR_FRAGMENT + INBOX_NOTE_FRAGMENT + INBOX_NOTE_ACTION_FRAGMENT + INBOX_MERGED_BY_FRAGMENT,
  InboxBrief: INBOX_BRIEF + INBOX_MR_FRAGMENT,
  InboxFollowUser: INBOX_FOLLOW_USER + INBOX_MR_FRAGMENT + INBOX_NOTE_FRAGMENT + INBOX_NOTE_ACTION_FRAGMENT + INBOX_MERGED_BY_FRAGMENT,
  InboxFollowProject: INBOX_FOLLOW_PROJECT + INBOX_MR_FRAGMENT + INBOX_NOTE_FRAGMENT + INBOX_NOTE_ACTION_FRAGMENT + INBOX_MERGED_BY_FRAGMENT,
  MoveState: MOVE_STATE,
  Merge: MERGE,
} as const satisfies Record<keyof Operations, string>

/**
 * What GitLab's `queryComplexity` scores each document, which `node tools/gitlab_schema.ts check` measures against
 * gitlab.com, with no sign-in. A query may cost no more than the limit, and the check also fails any document that scores
 * other than this, or more than COMPLEXITY_SHARE of the limit it reports, so a change to a document states its cost. A
 * write is not here: scoring a document sends it.
 */
export const COMPLEXITY = {
  Authored: 151,
  AuthoredPlain: 148,
  Failures: 16,
  InboxAuthored: 70,
  InboxBrief: 33,
  InboxFollowProject: 64,
  InboxFollowUser: 64,
  InboxQueue: 50,
  InboxTodos: 39,
  InboxTodosPlain: 39,
  MergeStatus: 34,
  MoveState: 17,
  Pinned: 100,
  PinnedPlain: 98,
  Usual: 8,
  ...PAGE_COMPLEXITY,
} as const satisfies Record<Reads, number>

/** The most of GitLab's limit a document may score: the rest is room for a field to grow, and for the other queries of a read. */
export const COMPLEXITY_SHARE = 0.8

/**
 * A pinned MR the authored list lacks (someone else's, or merged), one query each (`COMPLEXITY.Pinned`): that needs no
 * aliases that change with how many are pinned, and a project out of reach loses its own MR and no other.
 */
export const pinnedQuery = (pin: Pinned, features: HostFeatures): Request<PinnedQuery | PinnedPlainQuery> => {
  const variables = { path: pin.path, iid: String(pin.iid) } satisfies PinnedQueryVariables
  return features.hasReviewStates ? { operation: 'Pinned', query: DOCUMENTS.Pinned, variables } : { operation: 'PinnedPlain', query: DOCUMENTS.PinnedPlain, variables }
}

/** The recent successful MR pipelines of a project, for how long one usually runs: cheap (`COMPLEXITY.Usual`), so one query each. */
export const usualQuery = (path: string): Request<UsualQuery> => ({
  operation: 'Usual',
  query: DOCUMENTS.Usual,
  variables: { path } satisfies UsualQueryVariables,
})

/** Why the failed jobs of an MR's pipeline failed (`COMPLEXITY.Failures`). */
export const failuresQuery = (path: string, iid: number): Request<FailuresQuery> => ({
  operation: 'Failures',
  query: DOCUMENTS.Failures,
  variables: { path, iid: String(iid) } satisfies FailuresQueryVariables,
})
