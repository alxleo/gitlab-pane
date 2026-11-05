// Every GraphQL document the pane sends, and the requests built from them. tools/gitlab_queries.ts prints DOCUMENTS for
// tools/gitlab_schema.py, and graphql-codegen reads the documents in this file for the types in gitlab.generated.ts.
import type {
  AuthoredPlainQuery,
  AuthoredQuery,
  MergeStatusQuery,
  PinnedPlainQuery,
  PinnedQuery,
  PinnedQueryVariables,
  ProbeQuery,
  UsualQuery,
  UsualQueryVariables,
} from './gitlab.generated.ts'

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
  query Authored {
    currentUser { authoredMergeRequests(state: opened, first: 50, sort: UPDATED_DESC) { nodes { ...MrFields reviewers { nodes { ...ReviewerFields } } } } }
  }
`

const AUTHORED_PLAIN = /* GraphQL */ `
  query AuthoredPlain {
    currentUser { authoredMergeRequests(state: opened, first: 50, sort: UPDATED_DESC) { nodes { ...MrFields reviewers { nodes { ...ReviewerPlain } } } } }
  }
`

const MERGE_STATUS = /* GraphQL */ `
  query MergeStatus {
    currentUser { authoredMergeRequests(state: opened, first: 50, sort: UPDATED_DESC) { nodes { iid project { fullPath } mergeabilityChecks { identifier status } } } }
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

// The few fields that differ between GitLab versions, asked of a host's schema the first time it is read. The names of
// every field of two types are cheap to send and to read; `includeDeprecated` keeps a field GitLab has since deprecated.
const PROBE = /* GraphQL */ `
  query Probe {
    mergeRequest: __type(name: "MergeRequest") { fields(includeDeprecated: true) { name } }
    interaction: __type(name: "UserMergeRequestInteraction") { fields(includeDeprecated: true) { name } }
  }
`

const USUAL = /* GraphQL */ `
  query Usual($path: ID!) {
    project(fullPath: $path) { pipelines(source: "merge_request_event", status: SUCCESS, first: 20) { nodes { duration } } }
  }
`

/**
 * A document with the operation name it carries, its variables, and (in the type alone, never set) what GitLab answers
 * it with. The variables are strings, as the documents declare them.
 */
export type Request<Data> = { operation: keyof Operations; query: string; variables: Record<string, string>; readonly answer?: Data }

/** GitLab's answer to a document: its data, or none, and the errors beside either. */
export type RawResponse<Data> = { data?: Data | null; errors?: { message: string }[] }

/** The operations the pane sends, by name, with what each takes and answers: the fakes in the tests key on this. */
export type Operations = {
  Authored: { variables: Record<string, never>; data: AuthoredQuery }
  AuthoredPlain: { variables: Record<string, never>; data: AuthoredPlainQuery }
  MergeStatus: { variables: Record<string, never>; data: MergeStatusQuery }
  Pinned: { variables: PinnedQueryVariables; data: PinnedQuery }
  PinnedPlain: { variables: PinnedQueryVariables; data: PinnedPlainQuery }
  Probe: { variables: Record<string, never>; data: ProbeQuery }
  Usual: { variables: UsualQueryVariables; data: UsualQuery }
}

/** The text sent for each document, by operation name, for tools/gitlab_schema.py to check against GitLab's schema. */
export const DOCUMENTS = {
  Authored: AUTHORED + MR_FRAGMENT + REVIEWER_FRAGMENT + NOTE_FRAGMENT,
  AuthoredPlain: AUTHORED_PLAIN + MR_FRAGMENT + REVIEWER_PLAIN_FRAGMENT + NOTE_FRAGMENT,
  MergeStatus: MERGE_STATUS,
  Pinned: PINNED + MR_FRAGMENT + REVIEWER_FRAGMENT + NOTE_FRAGMENT,
  PinnedPlain: PINNED_PLAIN + MR_FRAGMENT + REVIEWER_PLAIN_FRAGMENT + NOTE_FRAGMENT,
  Probe: PROBE,
  Usual: USUAL,
} as const satisfies Record<keyof Operations, string>

/**
 * What GitLab's `queryComplexity` scores each document, which `node tools/gitlab_schema.ts check` measures against
 * gitlab.com, with no sign-in. A query may cost no more than the limit, and the check also fails any document that scores
 * other than this, or more than COMPLEXITY_SHARE of the limit it reports, so a change to a document states its cost.
 * `null` is a document GitLab does not score (introspection).
 */
export const COMPLEXITY = {
  Authored: 151,
  AuthoredPlain: 148,
  MergeStatus: 19,
  Pinned: 100,
  PinnedPlain: 98,
  Probe: null,
  Usual: 8,
} as const satisfies Record<keyof Operations, number | null>

/** The most of GitLab's limit a document may score: the rest is room for a field to grow, and for the other queries of a read. */
export const COMPLEXITY_SHARE = 0.8


/** Asks a host's schema which of the fields that older GitLab versions lack it has. */
export const probeQuery = (): Request<ProbeQuery> => ({ operation: 'Probe', query: DOCUMENTS.Probe, variables: {} })

/** Every open MR the user authored: the heaviest document (`COMPLEXITY.Authored`). */
export const authoredQuery = (features: HostFeatures): Request<AuthoredQuery | AuthoredPlainQuery> =>
  features.hasReviewStates
    ? { operation: 'Authored', query: DOCUMENTS.Authored, variables: {} }
    : { operation: 'AuthoredPlain', query: DOCUMENTS.AuthoredPlain, variables: {} }

/**
 * GitLab's own merge checks for the same MRs, asked on its own: its single verdict (`detailedMergeStatus`) answered
 * CONFLICT, twice in a row, inside the authored query for MRs that this query and each MR's own lookup called MERGEABLE.
 */
export const mergeStatusQuery = (): Request<MergeStatusQuery> => ({ operation: 'MergeStatus', query: DOCUMENTS.MergeStatus, variables: {} })

/**
 * A pinned MR the authored list lacks (someone else's, or merged), one query each (`COMPLEXITY.Pinned`): that needs no
 * aliases that change with how many are pinned, and a project out of reach loses its own MR and no other.
 */
export const pinnedQuery = (pin: Pinned, features: HostFeatures): Request<PinnedQuery | PinnedPlainQuery> => {
  const variables = { path: pin.path, iid: String(pin.iid) } satisfies PinnedQueryVariables
  return features.hasReviewStates
    ? { operation: 'Pinned', query: DOCUMENTS.Pinned, variables }
    : { operation: 'PinnedPlain', query: DOCUMENTS.PinnedPlain, variables }
}

/** The recent successful MR pipelines of a project, for how long one usually runs: cheap (`COMPLEXITY.Usual`), so one query each. */
export const usualQuery = (path: string): Request<UsualQuery> => ({
  operation: 'Usual',
  query: DOCUMENTS.Usual,
  variables: { path } satisfies UsualQueryVariables,
})
