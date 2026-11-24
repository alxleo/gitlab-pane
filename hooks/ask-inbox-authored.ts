// The user's own open MRs with their latest notes, and the ones merged since a date, who merged them and what landed: one
// answer that the inbox's rules, the Jira moves and the Mine tab's merged section each read their part of.
import type { InboxAuthoredQuery, InboxAuthoredQueryVariables } from './gitlab.generated'
import { present, timeOf } from './decode'
import { documentOf } from './gitlab-document'
import type { Request } from './gitlab-request'
import { cardKey } from './hosts'
import { INBOX_FRAGMENTS } from './inbox-fragments'
import { actorOf, cutoffOf, mrOf, noteSignals, PLAIN } from './inbox-signals'
import type { Found } from './inbox-signals'

import type { InboxMr, OwnMrs } from '../types'

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

export type InboxAuthoredOperations = {
  InboxAuthored: { variables: InboxAuthoredQueryVariables; data: InboxAuthoredQuery }
}

/** The document, and what GitLab scores it (`COMPLEXITY`). */
export const INBOX_AUTHORED_ASK = { documents: { InboxAuthored: documentOf(INBOX_AUTHORED, INBOX_FRAGMENTS) }, complexity: { InboxAuthored: 74 } } as const

/** The user's open MRs with their latest notes, and the ones merged since `since` (an ISO time). */
export const inboxAuthoredQuery = (since: string): Request<InboxAuthoredQuery> => ({
  operation: 'InboxAuthored',
  query: INBOX_AUTHORED_ASK.documents.InboxAuthored,
  variables: { since } satisfies InboxAuthoredQueryVariables,
})

/**
 * The user's MRs merged since the horizon, as the answer to `InboxAuthored` lists them: the one place that says where in it
 * they are. Three readers take what each needs of them: the Jira moves (`ownMrs`), the rules (`authoredMrs`) and the merged
 * section (`mergedLately`, in landed.ts). They need different parts and keep different MRs of the nodes (the moves every one,
 * the rules those merged by someone else, the section the newest few with a branch and commits), so the nodes are shared and
 * not what is made of them.
 */
export const mergedNodes = (data: InboxAuthoredQuery | null) => present(data?.currentUser?.merged?.nodes)

/** From the same answer, for the Jira moves: who the user is on the host, and every MR of theirs merged since the horizon, by card key. */
export function ownMrs(host: string, data: InboxAuthoredQuery | null): OwnMrs {
  return {
    user: data?.currentUser?.username ?? null,
    merged: mergedNodes(data).map(mr => ({ key: cardKey(host, mr.project.fullPath, mr.iid), iid: Number(mr.iid), title: mr.title })),
  }
}

/** The user's open MRs with what others did on them lately, and the ones merged since the horizon by someone else. */
export function authoredMrs(host: string, data: InboxAuthoredQuery | null, now: number): Found {
  const me = data?.currentUser?.username ?? null
  if (me === null) {
    return { user: null, mrs: [] }
  }
  const opened = present(data?.currentUser?.opened?.nodes).map(fields =>
    mrOf(host, me, fields, noteSignals(present(fields.notes.nodes), me, true, false, now), { ...PLAIN, cutoff: cutoffOf(fields.notes) })
  )
  const merged = mergedNodes(data).flatMap((fields): InboxMr[] => {
    const at = timeOf(fields.mergedAt)
    const by = fields.mergeUser?.username
    return at === null || by === undefined || by === me ? [] : [mrOf(host, me, fields, [{ kind: 'merged', actor: actorOf(by), at, note: null, excerpt: '' }], PLAIN)]
  })
  return { user: me, mrs: [...opened, ...merged] }
}
