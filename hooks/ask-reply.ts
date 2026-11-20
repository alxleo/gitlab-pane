// The reply under a thread: one of the two documents that change anything in GitLab, posted as the token's owner once the
// person has confirmed it.
import type { ReplyMutation, ReplyMutationVariables } from './gitlab.generated.ts'
import type { RawResponse, Request } from './gitlab-request.ts'
import type { Refusal } from './write-model.ts'

// A reply of quick actions alone runs them and keeps no note, which `commandsOnly` says.
const REPLY = /* GraphQL */ `
  mutation Reply($mr: NoteableID!, $thread: DiscussionID!, $body: String!) {
    createNote(input: { noteableId: $mr, discussionId: $thread, body: $body }) {
      errors
      note { id }
      quickActionsStatus { commandsOnly errorMessages }
    }
  }
`

export type ReplyOperations = {
  Reply: { variables: ReplyMutationVariables; data: ReplyMutation }
}

/**
 * The document, which writes: GitLab scores only queries (`queryComplexity` is a field of queries alone), so a write is
 * never sent to be scored.
 */
export const REPLY_ASK = { documents: { Reply: REPLY }, writes: ['Reply'] } as const

/** A reply under the thread `thread` of the MR `mr` (both GitLab's global IDs), as the person confirmed it. */
export const replyMutation = (mr: string, thread: string, body: string): Request<ReplyMutation> => ({
  operation: 'Reply',
  query: REPLY,
  variables: { mr, thread, body } satisfies ReplyMutationVariables,
})

/** GitLab, answering, turned the reply down: it was not made. */
const refused = (reason: string): Refusal => ({ reason, mayHaveLanded: false })

/** GitLab's words on one line. */
const oneLine = (words: readonly string[]): string => words.map(word => word.replace(/\s+/gu, ' ').trim()).join('; ')

/**
 * What GitLab's answer to a reply means. A refusal of the whole write (a token that may only read, a thread gone) comes
 * as errors beside no payload, which never name the scope and read the same for a thread one may not answer, so the pane
 * says what a read-only token gets without claiming that is the cause; the payload's own errors say why GitLab
 * kept no note; a reply of quick actions alone runs them and keeps none. Null when GitLab kept it.
 */
export function postedOf(host: string, response: RawResponse<ReplyMutation>): Refusal | null {
  const made = response.data?.createNote ?? null
  if (made === null) {
    const errors = (response.errors ?? []).map(error => error.message)
    return refused(
      errors.length > 0
        ? `${host} refused the reply: ${oneLine(errors)}. A token with only the read_api scope is refused so; replying needs api.`
        : `${host} sent no answer to the reply`
    )
  }
  if (made.note !== null) {
    return null
  }
  if (made.errors.length > 0) {
    return refused(`${host} did not post the reply: ${oneLine(made.errors)}`)
  }
  const quick = made.quickActionsStatus?.errorMessages ?? []
  return refused(
    made.quickActionsStatus?.commandsOnly === true
      ? `${host} ran the quick actions in the reply and kept no note${quick.length > 0 ? `: ${oneLine(quick)}` : ''}`
      : `${host} kept no note of the reply`
  )
}
