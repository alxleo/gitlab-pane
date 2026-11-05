// Every GraphQL document the pane sends, and the requests built from them. tools/gitlab_queries.ts prints DOCUMENTS for
// tools/gitlab_schema.py, and graphql-codegen reads the documents in this file for the types in gitlab.generated.ts.
import type {
  AuthoredPlainQuery,
  AuthoredQuery,
  InboxAuthoredQuery,
  InboxAuthoredQueryVariables,
  InboxBriefQuery,
  InboxBriefQueryVariables,
  InboxQueueQuery,
  InboxTodosQuery,
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
    currentUser { authoredMergeRequests(state: opened, first: 50, sort: UPDATED_DESC) { nodes { iid project { fullPath } detailedMergeStatus } } }
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

// ---- The inbox: what GitLab says happened to the user's MRs ---------------------------------------------------------------
// Four documents, none of which changes anything. Each costs far less than the 250 a query may, so a host that times one
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
// is GitLab 17.4 and newer (`target` is deprecated there): an older host answers an error, and the inbox then has no to-dos.
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

// The review queue: open MRs the user is a reviewer of. Those the user has approved already are told apart by the reader.
const INBOX_QUEUE = /* GraphQL */ `
  query InboxQueue {
    currentUser {
      username
      reviewRequestedMergeRequests(state: opened, first: 30, sort: UPDATED_DESC) {
        nodes {
          ...InboxMrFields
          approvedBy { nodes { username } }
          notes(last: 30) { nodes { ...InboxNoteFields } }
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
          notes(last: 30) { nodes { ...InboxNoteFields } }
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

// One MR whole, for /mrs: its description and its threads. 30 notes of 100 threads costs about 90 of the 250 a query may.
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
  InboxTodos: { variables: Record<string, never>; data: InboxTodosQuery }
  InboxQueue: { variables: Record<string, never>; data: InboxQueueQuery }
  InboxAuthored: { variables: InboxAuthoredQueryVariables; data: InboxAuthoredQuery }
  InboxBrief: { variables: InboxBriefQueryVariables; data: InboxBriefQuery }
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
  InboxTodos: INBOX_TODOS + INBOX_MR_FRAGMENT,
  InboxQueue: INBOX_QUEUE + INBOX_MR_FRAGMENT + INBOX_NOTE_FRAGMENT + INBOX_NOTE_ACTION_FRAGMENT,
  InboxAuthored: INBOX_AUTHORED + INBOX_MR_FRAGMENT + INBOX_NOTE_FRAGMENT + INBOX_NOTE_ACTION_FRAGMENT + INBOX_MERGED_BY_FRAGMENT,
  InboxBrief: INBOX_BRIEF + INBOX_MR_FRAGMENT,
} as const satisfies Record<keyof Operations, string>


/** Asks a host's schema which of the fields that older GitLab versions lack it has. */
export const probeQuery = (): Request<ProbeQuery> => ({ operation: 'Probe', query: DOCUMENTS.Probe, variables: {} })

/** Every open MR the user authored; GitLab scores it 158 of the 250 a query may cost. */
export const authoredQuery = (features: HostFeatures): Request<AuthoredQuery | AuthoredPlainQuery> =>
  features.hasReviewStates
    ? { operation: 'Authored', query: DOCUMENTS.Authored, variables: {} }
    : { operation: 'AuthoredPlain', query: DOCUMENTS.AuthoredPlain, variables: {} }

/**
 * GitLab's merge verdict for the same MRs, asked on its own: inside the authored query it answered CONFLICT, twice in a
 * row, for MRs that this query and each MR's own lookup called MERGEABLE.
 */
export const mergeStatusQuery = (): Request<MergeStatusQuery> => ({ operation: 'MergeStatus', query: DOCUMENTS.MergeStatus, variables: {} })

/**
 * A pinned MR the authored list lacks (someone else's, or merged), one query each. It costs about 103 of the 250 a query
 * may, so two would fit, but one per query needs no aliases that change with how many are pinned, and a project out of
 * reach loses its own MR and no other.
 */
export const pinnedQuery = (pin: Pinned, features: HostFeatures): Request<PinnedQuery | PinnedPlainQuery> => {
  const variables = { path: pin.path, iid: String(pin.iid) } satisfies PinnedQueryVariables
  return features.hasReviewStates
    ? { operation: 'Pinned', query: DOCUMENTS.Pinned, variables }
    : { operation: 'PinnedPlain', query: DOCUMENTS.PinnedPlain, variables }
}

/** The recent successful MR pipelines of a project, for how long one usually runs; it costs 11, so one query each is cheap. */
export const usualQuery = (path: string): Request<UsualQuery> => ({
  operation: 'Usual',
  query: DOCUMENTS.Usual,
  variables: { path } satisfies UsualQueryVariables,
})

/** The user's pending to-dos on MRs of the kinds the inbox rules name. */
export const inboxTodosQuery = (): Request<InboxTodosQuery> => ({ operation: 'InboxTodos', query: DOCUMENTS.InboxTodos, variables: {} })

/** The open MRs the user is a reviewer of, with their latest notes. */
export const inboxQueueQuery = (): Request<InboxQueueQuery> => ({ operation: 'InboxQueue', query: DOCUMENTS.InboxQueue, variables: {} })

/** The user's open MRs with their latest notes, and the ones merged since `since` (an ISO time). */
export const inboxAuthoredQuery = (since: string): Request<InboxAuthoredQuery> => ({
  operation: 'InboxAuthored',
  query: DOCUMENTS.InboxAuthored,
  variables: { since } satisfies InboxAuthoredQueryVariables,
})

/** One MR with its description and threads, for `/mrs`. */
export const inboxBriefQuery = (path: string, iid: number): Request<InboxBriefQuery> => ({
  operation: 'InboxBrief',
  query: DOCUMENTS.InboxBrief,
  variables: { path, iid: String(iid) } satisfies InboxBriefQueryVariables,
})
