// What an MR's page needs of its threads beyond their words, read beside the whole MR when the page opens and never for the
// list: where a reply to each goes, and the lines of the diff it was left on.
import { isFilled, isSome, present } from './decode.ts'
import type { ThreadsPlainQuery, ThreadsQuery, ThreadsQueryVariables } from './gitlab.generated.ts'
import { documentOf } from './gitlab-document.ts'
import type { RawResponse, Request } from './gitlab-request.ts'
import { hunkOf } from './reply-model.ts'
import type { DiffLine } from './reply-model.ts'

import type { HostFeatures, MrCard } from '../types'

// The MR's ID and each thread's, to post a reply under it, and the lines of the diff a thread was left on (at most 16,
// ending at the commented line). Each thread is known by its first note's address. A GitLab without `truncatedDiffLines`
// is sent THREADS_PLAIN: replies, and no lines.
const THREADS = /* GraphQL */ `
  query Threads($path: ID!, $iid: String!) {
    project(fullPath: $path) { mergeRequest(iid: $iid) { id discussions(first: 100) { nodes { replyId ...ThreadLines notes(first: 1) { nodes { url } } } } } }
  }
`

const THREADS_PLAIN = /* GraphQL */ `
  query ThreadsPlain($path: ID!, $iid: String!) {
    project(fullPath: $path) { mergeRequest(iid: $iid) { id discussions(first: 100) { nodes { replyId notes(first: 1) { nodes { url } } } } } }
  }
`

const THREAD_LINES_FRAGMENT = /* GraphQL */ `
  fragment ThreadLines on Discussion {
    truncatedDiffLines { oldLine newLine type text }
  }
`

export type ThreadsOperations = {
  Threads: { variables: ThreadsQueryVariables; data: ThreadsQuery }
  ThreadsPlain: { variables: ThreadsQueryVariables; data: ThreadsPlainQuery }
}

/** The page's documents, and what GitLab scores each (`COMPLEXITY`). */
export const THREADS_ASK = {
  documents: { Threads: documentOf(THREADS, [THREAD_LINES_FRAGMENT]), ThreadsPlain: documentOf(THREADS_PLAIN, [THREAD_LINES_FRAGMENT]) },
  complexity: { Threads: 18, ThreadsPlain: 12 },
} as const

/** What an MR's page needs of its threads to answer them (`COMPLEXITY.Threads`); a host without the diff lines is asked without them. */
export const threadsQuery = (path: string, iid: number, features: HostFeatures): Request<ThreadsQuery | ThreadsPlainQuery> => {
  const variables = { path, iid: String(iid) } satisfies ThreadsQueryVariables
  return features.hasDiffLines
    ? { operation: 'Threads', query: THREADS_ASK.documents.Threads, variables }
    : { operation: 'ThreadsPlain', query: THREADS_ASK.documents.ThreadsPlain, variables }
}

/** A thread's diff lines; a host asked without them (`ThreadsPlain`) sends none. */
const linesOf = (thread: { replyId: string; truncatedDiffLines?: readonly DiffLine[] | null }): readonly DiffLine[] => thread.truncatedDiffLines ?? []

/**
 * The card read whole, its open threads joined with what its page alone asks (`threadsQuery`), by their first note's
 * address: where a reply to each goes, and the lines of the diff it was left on. A read that failed, or that GitLab
 * answered with errors alone, leaves the threads as they were and says why in `repliesOff`; an MR GitLab no longer names
 * leaves them as they were.
 */
export function withThreads(card: MrCard, read: { response: RawResponse<ThreadsQuery | ThreadsPlainQuery> } | { reason: string }): MrCard {
  if ('reason' in read) {
    return { ...card, repliesOff: read.reason }
  }
  const { response } = read
  const mr = response.data?.project?.mergeRequest
  const errors = (response.errors ?? []).map(error => error.message)
  if (!isSome(mr)) {
    return errors.length > 0 && !isSome(response.data) ? { ...card, repliesOff: errors.join('; ') } : card
  }
  const byUrl = new Map(
    present(mr.discussions.nodes).flatMap(thread => {
      const url = present(thread.notes.nodes)[0]?.url
      return isFilled(url) ? [[url, { replyId: thread.replyId, hunk: hunkOf(linesOf(thread)) }] as const] : []
    })
  )
  return {
    ...card,
    openThreads: card.openThreads.map(note => {
      const found = byUrl.get(note.url)
      if (found === undefined) {
        return note
      }
      return {
        ...note,
        answer: { mr: mr.id, thread: found.replyId },
        ...(found.hunk !== null && note.where !== undefined ? { excerpt: { path: note.where.replace(/:\d+$/u, ''), hunk: found.hunk } } : {}),
      }
    }),
  }
}
