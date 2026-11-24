// The merge: one of the two documents that change anything in GitLab, sent once the person has pressed for it.
import type { MergeMutation, MergeMutationVariables, MergeStrategyEnum } from './gitlab.generated'
import { isSome } from './decode'
import type { RawResponse, Request } from './gitlab-request'
import { why } from './write-model'
import type { Refusal } from './write-model'

// A write: never scored, since scoring sends the document. The head is the one the verdict was read on, and GitLab
// refuses the merge if the branch has moved since. `squash` is always sent: left out, GitLab takes it as false and writes
// that onto the MR, so a project that always squashes refuses the merge, and an MR whose own flag is on merges unsquashed.
// Removing the source branch, left out, is the MR's own setting.
const MERGE = /* GraphQL */ `
  mutation Merge($path: ID!, $iid: String!, $sha: String!, $strategy: MergeStrategyEnum, $squash: Boolean!) {
    mergeRequestAccept(input: { projectPath: $path, iid: $iid, sha: $sha, strategy: $strategy, squash: $squash }) { errors mergeRequest { state mergeError } }
  }
`

export type MergeOperations = {
  Merge: { variables: MergeMutationVariables; data: MergeMutation }
}

/** The document, which writes and so is never scored. */
export const MERGE_ASK = { documents: { Merge: MERGE }, writes: ['Merge'] } as const

/**
 * Merges the MR at `sha`, the head its verdict was read on, by `strategy` where GitLab gives one (a merge train, or once its
 * checks pass), squashed when GitLab said it would squash it.
 */
export const mergeWrite = (path: string, iid: number, sha: string, strategy: MergeStrategyEnum | null, squash: boolean): Request<MergeMutation> => ({
  operation: 'Merge',
  query: MERGE,
  variables: { path, iid: String(iid), sha, squash, ...(strategy !== null ? { strategy } : {}) } satisfies MergeMutationVariables,
})

/** Why GitLab refused a merge, in its words, or null when it took it. */
export function mergeRefusal(response: RawResponse<MergeMutation>): Refusal | null {
  const said = [...(response.errors ?? []).map(error => error.message), ...(response.data?.mergeRequestAccept?.errors ?? [])]
  if (said.length > 0) {
    return { reason: why(said.join('; ')), mayHaveLanded: false }
  }
  return isSome(response.data?.mergeRequestAccept) ? null : { reason: 'GitLab sent no answer', mayHaveLanded: false }
}
