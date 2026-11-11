// The GraphQL documents only an MR's page sends, the requests built from them, and what their answers make of a card:
// what the page needs to answer a thread, and the reply itself. gitlab-documents.ts lists them in DOCUMENTS with the
// rest, and graphql-codegen reads them here for the types in gitlab.generated.ts.
import { isFilled, isSome } from './decode.ts'
import type { ReplyMutation, ReplyMutationVariables, ThreadsPlainQuery, ThreadsQuery, ThreadsQueryVariables } from './gitlab.generated.ts'
import type { RawResponse, Request } from './gitlab-documents.ts'
import { hunkOf } from './reply-model.ts'
import type { DiffLine } from './reply-model.ts'

import type { HostFeatures, MrCard } from '../types'

// What an MR's page needs of its threads beyond their words, read beside the whole MR when the page opens and never for
// the list: the MR's ID and each thread's, to post a reply under it, and the lines of the diff a thread was left on (at
// most 16, ending at the commented line). Each thread is known by its first note's address. A GitLab without
// `truncatedDiffLines` is sent THREADS_PLAIN: replies, and no lines.
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

// The one write: a reply under a thread, posted as the token's owner once the person has confirmed it. A reply of quick
// actions alone runs them and keeps no note, which `commandsOnly` says.
const REPLY = /* GraphQL */ `
  mutation Reply($mr: NoteableID!, $thread: DiscussionID!, $body: String!) {
    createNote(input: { noteableId: $mr, discussionId: $thread, body: $body }) {
      errors
      note { id }
      quickActionsStatus { commandsOnly errorMessages }
    }
  }
`

/** The text sent for each of these documents, by operation name; DOCUMENTS holds them with the rest. */
export const PAGE_DOCUMENTS = {
  Threads: THREADS + THREAD_LINES_FRAGMENT,
  ThreadsPlain: THREADS_PLAIN,
  Reply: REPLY,
} as const

/** These operations by name, with what each takes and answers; `Operations` holds them with the rest. */
export type PageOperations = {
  Threads: { variables: ThreadsQueryVariables; data: ThreadsQuery }
  ThreadsPlain: { variables: ThreadsQueryVariables; data: ThreadsPlainQuery }
  Reply: { variables: ReplyMutationVariables; data: ReplyMutation }
}

/**
 * What GitLab scores the queries, as `COMPLEXITY` holds them with the rest. `Reply` has none: it writes, and GitLab scores
 * only queries (`queryComplexity` is a field of queries alone), so a write is never sent to be scored.
 */
export const PAGE_COMPLEXITY = { Threads: 18, ThreadsPlain: 12 } as const

/** What an MR's page needs of its threads to answer them (`COMPLEXITY.Threads`); a host without the diff lines is asked without them. */
export const threadsQuery = (path: string, iid: number, features: HostFeatures): Request<ThreadsQuery | ThreadsPlainQuery> => {
  const variables = { path, iid: String(iid) } satisfies ThreadsQueryVariables
  return features.hasDiffLines ? { operation: 'Threads', query: PAGE_DOCUMENTS.Threads, variables } : { operation: 'ThreadsPlain', query: PAGE_DOCUMENTS.ThreadsPlain, variables }
}

/** A reply under the thread `thread` of the MR `mr` (both GitLab's global IDs), as the person confirmed it. */
export const replyMutation = (mr: string, thread: string, body: string): Request<ReplyMutation> => ({
  operation: 'Reply',
  query: PAGE_DOCUMENTS.Reply,
  variables: { mr, thread, body } satisfies ReplyMutationVariables,
})

const present = <T>(nodes: readonly (T | null)[] | null | undefined): T[] => (nodes ?? []).filter(node => node !== null)

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
