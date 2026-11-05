// The requests the inbox sends: each document of gitlab-documents.ts with its variables. Kept apart because that file is full.
import { DOCUMENTS } from './gitlab-documents.ts'
import type { Request } from './gitlab-documents.ts'
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
} from './gitlab.generated.ts'

import type { HostFeatures } from '../types'

/** The user's pending to-dos on MRs of the kinds the inbox rules name; a host without `targetEntity` is asked for `target`. */
export const inboxTodosQuery = (features: HostFeatures): Request<InboxTodosQuery | InboxTodosPlainQuery> =>
  features.hasTodoEntity
    ? { operation: 'InboxTodos', query: DOCUMENTS.InboxTodos, variables: {} }
    : { operation: 'InboxTodosPlain', query: DOCUMENTS.InboxTodosPlain, variables: {} }

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

/** The open MRs and the ones merged since `since` of a person, `username` without the `@`. */
export const inboxFollowUserQuery = (username: string, since: string): Request<InboxFollowUserQuery> => ({
  operation: 'InboxFollowUser',
  query: DOCUMENTS.InboxFollowUser,
  variables: { username, since } satisfies InboxFollowUserQueryVariables,
})

/** The open MRs and the ones merged since `since` of a project. */
export const inboxFollowProjectQuery = (path: string, since: string): Request<InboxFollowProjectQuery> => ({
  operation: 'InboxFollowProject',
  query: DOCUMENTS.InboxFollowProject,
  variables: { path, since } satisfies InboxFollowProjectQueryVariables,
})
