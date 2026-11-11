// The GraphQL documents the inbox sends, and the one it needs for the MRs the user merged lately (`Landed`). gitlab-documents.ts lists
// them in DOCUMENTS with the rest, and graphql-codegen reads them here for the types in gitlab.generated.ts.
import type {
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
  LandedQuery,
  LandedQueryVariables,
} from './gitlab.generated.ts'

// ---- The inbox: what GitLab says happened to the user's MRs ---------------------------------------------------------------
// Four documents, none of which changes anything, and `Landed` beside them. Each costs far less than a query may (`COMPLEXITY`),
// so a host that times one out loses only that one. A host without a field (`mergeUser`, `systemNoteMetadata`) needs a GitLab
// older than the ones the pane supports, so there are no plain variants here.

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

// What says which commit a merge put on its target branch, for the user's own MRs alone (the Mine tab's merged ones): the merge
// commit, which a fast-forward merge has none of, and the head the MR had, which such a merge puts there unless it squashed.
// GraphQL has no squash commit; the pane reads that over REST (landed.ts).
const INBOX_LANDED_FRAGMENT = /* GraphQL */ `
  fragment InboxLandedFields on MergeRequest {
    targetBranch mergeCommitSha diffHeadSha
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

// The user's own open MRs with their latest notes, and the ones merged since a date, who merged them and what landed.
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
          ...InboxLandedFields
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

// What the commit a merge put on its target branch ran there: the newest pipeline of that commit on that branch that no schedule
// started, one MR at a time as `Pinned` reads one. `ref` is what makes it the build on the target: without it GitLab answers every
// pipeline of the commit, and a fast-forward merge's commit is the source branch's own, which has its own pipeline.
// A schedule runs on the branch's head, so a nightly pipeline is newer than the merge's own and says nothing of the merge; GitLab's
// own `merge_pipeline` leaves schedules out. The argument `source` filters for one value only, so the ten newest are asked for
// beside the ten newest scheduled ones, and `buildOf` takes the first of the first list that is not in the second. (The field
// `Pipeline.source` would do it in one, but a self-managed GitLab older than it would refuse the whole document.) A commit with ten
// newer schedule pipelines reads as having none.
const LANDED = /* GraphQL */ `
  query Landed($path: ID!, $sha: String!, $ref: String!) {
    project(fullPath: $path) {
      pipelines(sha: $sha, ref: $ref, first: 10) { nodes { id status path } }
      scheduled: pipelines(sha: $sha, ref: $ref, source: "schedule", first: 10) { nodes { id } }
    }
  }
`

/** The text sent for each of these documents, by operation name; DOCUMENTS holds them with the rest. */
export const INBOX_DOCUMENTS = {
  InboxTodos: INBOX_TODOS + INBOX_MR_FRAGMENT,
  InboxTodosPlain: INBOX_TODOS_PLAIN + INBOX_MR_FRAGMENT,
  InboxQueue: INBOX_QUEUE + INBOX_MR_FRAGMENT + INBOX_NOTE_FRAGMENT + INBOX_NOTE_ACTION_FRAGMENT,
  InboxAuthored: INBOX_AUTHORED + INBOX_MR_FRAGMENT + INBOX_NOTE_FRAGMENT + INBOX_NOTE_ACTION_FRAGMENT + INBOX_MERGED_BY_FRAGMENT + INBOX_LANDED_FRAGMENT,
  InboxBrief: INBOX_BRIEF + INBOX_MR_FRAGMENT,
  InboxFollowUser: INBOX_FOLLOW_USER + INBOX_MR_FRAGMENT + INBOX_NOTE_FRAGMENT + INBOX_NOTE_ACTION_FRAGMENT + INBOX_MERGED_BY_FRAGMENT,
  InboxFollowProject: INBOX_FOLLOW_PROJECT + INBOX_MR_FRAGMENT + INBOX_NOTE_FRAGMENT + INBOX_NOTE_ACTION_FRAGMENT + INBOX_MERGED_BY_FRAGMENT,
  Landed: LANDED,
} as const

/** These operations by name, with what each takes and answers; `Operations` holds them with the rest. */
export type InboxOperations = {
  InboxTodos: { variables: Record<string, never>; data: InboxTodosQuery }
  InboxTodosPlain: { variables: Record<string, never>; data: InboxTodosPlainQuery }
  InboxQueue: { variables: Record<string, never>; data: InboxQueueQuery }
  InboxAuthored: { variables: InboxAuthoredQueryVariables; data: InboxAuthoredQuery }
  InboxBrief: { variables: InboxBriefQueryVariables; data: InboxBriefQuery }
  InboxFollowUser: { variables: InboxFollowUserQueryVariables; data: InboxFollowUserQuery }
  InboxFollowProject: { variables: InboxFollowProjectQueryVariables; data: InboxFollowProjectQuery }
  Landed: { variables: LandedQueryVariables; data: LandedQuery }
}

/** What GitLab scores each of these queries, as `COMPLEXITY` holds them with the rest. */
export const INBOX_COMPLEXITY = {
  InboxAuthored: 74,
  InboxBrief: 33,
  InboxFollowProject: 64,
  InboxFollowUser: 64,
  InboxQueue: 50,
  InboxTodos: 39,
  InboxTodosPlain: 39,
  Landed: 23,
} as const
