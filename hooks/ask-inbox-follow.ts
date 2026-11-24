// The MRs of a person or a project the inboxFollow setting names: the open ones with their latest notes, and the ones merged
// since a date. A user or project the host does not know answers null, which is no MRs, not an error.
import type { InboxFollowProjectQuery, InboxFollowProjectQueryVariables, InboxFollowUserQuery, InboxFollowUserQueryVariables } from './gitlab.generated'
import { present, timeOf } from './decode'
import { documentOf } from './gitlab-document'
import type { Request } from './gitlab-request'
import { INBOX_FRAGMENTS } from './inbox-fragments'
import { actorOf, cutoffOf, mrOf, noteSignals, PLAIN } from './inbox-signals'
import type { Found } from './inbox-signals'

import type { InboxMr } from '../types'

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

export type InboxFollowOperations = {
  InboxFollowUser: { variables: InboxFollowUserQueryVariables; data: InboxFollowUserQuery }
  InboxFollowProject: { variables: InboxFollowProjectQueryVariables; data: InboxFollowProjectQuery }
}

/** The documents, and what GitLab scores each (`COMPLEXITY`). */
export const INBOX_FOLLOW_ASK = {
  documents: { InboxFollowUser: documentOf(INBOX_FOLLOW_USER, INBOX_FRAGMENTS), InboxFollowProject: documentOf(INBOX_FOLLOW_PROJECT, INBOX_FRAGMENTS) },
  complexity: { InboxFollowProject: 64, InboxFollowUser: 64 },
} as const

/** The open MRs and the ones merged since `since` of a person, `username` without the `@`. */
export const inboxFollowUserQuery = (username: string, since: string): Request<InboxFollowUserQuery> => ({
  operation: 'InboxFollowUser',
  query: INBOX_FOLLOW_ASK.documents.InboxFollowUser,
  variables: { username, since } satisfies InboxFollowUserQueryVariables,
})

/** The open MRs and the ones merged since `since` of a project. */
export const inboxFollowProjectQuery = (path: string, since: string): Request<InboxFollowProjectQuery> => ({
  operation: 'InboxFollowProject',
  query: INBOX_FOLLOW_ASK.documents.InboxFollowProject,
  variables: { path, since } satisfies InboxFollowProjectQueryVariables,
})

/** The open and the lately merged MRs of a followed person or project. */
type Followed = NonNullable<InboxFollowUserQuery['user']>

function followedMrs(host: string, me: string | null, group: Followed | null | undefined, now: number): Found {
  if (me === null || group === null || group === undefined) {
    return { user: me, mrs: [] }
  }
  const opened = present(group.opened?.nodes).map(fields =>
    mrOf(host, me, fields, noteSignals(present(fields.notes.nodes), me, fields.author?.username === me, true, now), { ...PLAIN, isFollowed: true, cutoff: cutoffOf(fields.notes) })
  )
  const merged = present(group.merged?.nodes).flatMap((fields): InboxMr[] => {
    const at = timeOf(fields.mergedAt)
    const by = fields.mergeUser?.username
    return at === null || by === undefined || by === me
      ? []
      : [mrOf(host, me, fields, [{ kind: 'merged', actor: actorOf(by), at, note: null, excerpt: '' }], { ...PLAIN, isFollowed: true })]
  })
  return { user: me, mrs: [...opened, ...merged] }
}

/** A followed person's MRs: the open ones with what others did on them lately, and the ones merged by someone else. */
export const followedUserMrs = (host: string, data: InboxFollowUserQuery | null, now: number): Found => followedMrs(host, data?.currentUser?.username ?? null, data?.user, now)

/** A followed project's MRs, the same. */
export const followedProjectMrs = (host: string, data: InboxFollowProjectQuery | null, now: number): Found =>
  followedMrs(host, data?.currentUser?.username ?? null, data?.project, now)
