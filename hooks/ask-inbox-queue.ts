// The review queue: open MRs the user is a reviewer of. Those the user has approved already are told apart by the reader.
import type { InboxQueueQuery } from './gitlab.generated'
import { present, timeOf } from './decode'
import { documentOf } from './gitlab-document'
import type { Request } from './gitlab-request'
import { INBOX_FRAGMENTS } from './inbox-fragments'
import { actorOf, cutoffOf, mrOf, noteSignals, PLAIN } from './inbox-signals'
import type { Found } from './inbox-signals'

import type { InboxMr, InboxSignal } from '../types'

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

export type InboxQueueOperations = {
  InboxQueue: { variables: Record<string, never>; data: InboxQueueQuery }
}

/** The document, and what GitLab scores it (`COMPLEXITY`). */
export const INBOX_QUEUE_ASK = { documents: { InboxQueue: documentOf(INBOX_QUEUE, INBOX_FRAGMENTS) }, complexity: { InboxQueue: 50 } } as const

/** The open MRs the user is a reviewer of, with their latest notes. */
export const inboxQueueQuery = (): Request<InboxQueueQuery> => ({ operation: 'InboxQueue', query: INBOX_QUEUE_ASK.documents.InboxQueue, variables: {} })

/** The MRs the user is a reviewer of and has not approved, with the pushes since. */
export function queueMrs(host: string, data: InboxQueueQuery | null, now: number): Found {
  const me = data?.currentUser?.username ?? null
  const mrs = present(data?.currentUser?.reviewRequestedMergeRequests?.nodes).flatMap((fields): InboxMr[] => {
    const isApproved = present(fields.approvedBy?.nodes).some(one => one.username === me)
    const asked = timeOf(fields.createdAt)
    if (me === null || isApproved || fields.author?.username === me || asked === null) {
      return []
    }
    // The to-do, when there is one, says better who asked and when; `combine` keeps the newest request.
    const request: InboxSignal = { kind: 'review_requested', actor: actorOf(fields.author?.username ?? ''), at: asked, note: null, excerpt: '' }
    return [mrOf(host, me, fields, [request, ...noteSignals(present(fields.notes.nodes), me, false, false, now)], { ...PLAIN, inQueue: true, cutoff: cutoffOf(fields.notes) })]
  })
  return { user: me, mrs }
}
