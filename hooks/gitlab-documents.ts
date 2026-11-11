// Every GraphQL document the pane sends (those on merging an MR are in merge-gitlab.ts, an MR page's own in
// page-documents.ts, the inbox's in inbox-documents.ts), and the requests built from them. tools/gitlab_schema.ts checks
// DOCUMENTS against GitLab; graphql-codegen reads all four files for gitlab.generated.ts.
import { INBOX_COMPLEXITY, INBOX_DOCUMENTS } from './inbox-documents.ts'
import type { InboxOperations } from './inbox-documents.ts'
import { MERGE, MERGE_STATUS, MOVE_STATE } from './merge-gitlab.ts'
import type { WRITES } from './merge-gitlab.ts'
import type {
  AuthoredPlainQuery,
  AuthoredPlainQueryVariables,
  AuthoredQuery,
  AuthoredQueryVariables,
  FailuresQuery,
  FailuresQueryVariables,
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

/**
 * A document with the operation name it carries, its variables, and (in the type alone, never set) what GitLab answers
 * it with. The variables are strings, or a merge's `squash` flag, as the documents declare them.
 */
export type Request<Data> = { operation: keyof Operations; query: string; variables: Record<string, string | boolean>; readonly answer?: Data }

/** GitLab's answer to a document: its data, or none, and the errors beside either. */
export type RawResponse<Data> = { data?: Data | null; errors?: { message: string; extensions?: { code?: string; typeName?: string; fieldName?: string } }[] }

/** The operations the pane sends, by name, with what each takes and answers: the fakes in the tests key on this. */
export type Operations = PageOperations &
  InboxOperations & {
    Authored: { variables: AuthoredQueryVariables; data: AuthoredQuery }
    AuthoredPlain: { variables: AuthoredPlainQueryVariables; data: AuthoredPlainQuery }
    MergeStatus: { variables: Record<string, never>; data: MergeStatusQuery }
    Failures: { variables: FailuresQueryVariables; data: FailuresQuery }
    Pinned: { variables: PinnedQueryVariables; data: PinnedQuery }
    PinnedPlain: { variables: PinnedQueryVariables; data: PinnedPlainQuery }
    Usual: { variables: UsualQueryVariables; data: UsualQuery }
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
  ...INBOX_DOCUMENTS,
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
  MergeStatus: 34,
  MoveState: 18,
  Pinned: 100,
  PinnedPlain: 98,
  Usual: 8,
  ...PAGE_COMPLEXITY,
  ...INBOX_COMPLEXITY,
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
