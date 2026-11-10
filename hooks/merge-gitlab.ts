// What the pane says to GitLab about merging an MR, and how it reads the answers: GitLab's verdict on the user's MRs, one
// MR read fresh before and during a move, the merge (the only document that changes anything in GitLab), and the rebase,
// which GraphQL lacks and goes over REST (moves.ts sends it). DOCUMENTS in gitlab-documents.ts holds the documents with the
// rest, for the schema check.
import type { MergeMutation, MergeMutationVariables, MergeStatusQuery, MergeStrategyEnum, MoveStateQuery, MoveStateQueryVariables } from './gitlab.generated.ts'
import type { Operations, RawResponse, Request } from './gitlab-documents.ts'
import { dataOf, isRecord, isSome, parseJson } from './decode.ts'
import { why } from './next-move.ts'
import type { Fresh, Refusal } from './next-move.ts'

import type { HostFeatures } from '../types'

// The verdict and what can be done about it come in one answer: the head the checks were made on is the one a merge names,
// so the pane never merges a commit newer than the verdict it showed.
export const MERGE_STATUS = /* GraphQL */ `
  query MergeStatus {
    currentUser {
      authoredMergeRequests(state: opened, first: 50, sort: UPDATED_DESC) {
        nodes { iid project { fullPath } mergeabilityChecks { identifier status } diffHeadSha rebaseInProgress autoMergeEnabled userPermissions { canMerge pushToSourceBranch } }
      }
    }
  }
`

// What a move needs just before it is made, and after a rebase until it is done: one MR, read fresh.
export const MOVE_STATE = /* GraphQL */ `
  query MoveState($path: ID!, $iid: String!) {
    project(fullPath: $path) { mergeRequest(iid: $iid) { state detailedMergeStatus diffHeadSha rebaseCommitSha rebaseInProgress autoMergeEnabled mergeError availableAutoMergeStrategies } }
  }
`

// A write: never scored, since scoring sends the document. The head is the one the verdict was read on, and GitLab
// refuses the merge if the branch has moved since. Squashing and removing the source branch are the MR's own settings.
export const MERGE = /* GraphQL */ `
  mutation Merge($path: ID!, $iid: String!, $sha: String!, $strategy: MergeStrategyEnum) {
    mergeRequestAccept(input: { projectPath: $path, iid: $iid, sha: $sha, strategy: $strategy }) { errors mergeRequest { state mergeError } }
  }
`

/** The documents that change GitLab: mutations, which the schema check never sends to be scored. */
export const WRITES = ['Merge'] as const satisfies readonly (keyof Operations)[]

/** Whether a request changes GitLab, by the document it sends: such a request is sent once and never again on a failure. */
export function isWrite(request: { operation: keyof Operations }): boolean {
  const writes: readonly string[] = WRITES
  return writes.includes(request.operation)
}

/**
 * GitLab's own merge checks for the same MRs, or none for a host that lacks them. Asked on its own: its single verdict (`detailedMergeStatus`) answered
 * CONFLICT, twice in a row, inside the authored query for MRs that this query and each MR's own lookup called MERGEABLE.
 */
export const mergeStatusQuery = (features: HostFeatures): Request<MergeStatusQuery> | null =>
  features.hasMergeVerdict ? { operation: 'MergeStatus', query: MERGE_STATUS, variables: {} } : null

/** One MR as a move needs it, read fresh (`COMPLEXITY.MoveState`). */
export const moveStateQuery = (path: string, iid: number): Request<MoveStateQuery> => ({
  operation: 'MoveState',
  query: MOVE_STATE,
  variables: { path, iid: String(iid) } satisfies MoveStateQueryVariables,
})

/** Merges the MR at `sha`, the head its verdict was read on, by `strategy` where GitLab gives one (a merge train, or once its checks pass). */
export const mergeWrite = (path: string, iid: number, sha: string, strategy: MergeStrategyEnum | null): Request<MergeMutation> => ({
  operation: 'Merge',
  query: MERGE,
  variables: { path, iid: String(iid), sha, ...(strategy !== null ? { strategy } : {}) } satisfies MergeMutationVariables,
})

/** The REST path that starts a rebase of the MR; GitLab answers `202 {"rebase_in_progress": true}` when it takes it. */
export const rebasePath = (path: string, iid: number): string => `projects/${encodeURIComponent(path)}/merge_requests/${iid}/rebase`

/** One MR as a move needs it; none when GitLab named no such MR, and a throw when it sent no data at all. */
export function readMoveState(response: RawResponse<MoveStateQuery>): Fresh | null {
  const raw = dataOf(response).project?.mergeRequest
  return isSome(raw)
    ? {
        state: raw.state,
        status: raw.detailedMergeStatus,
        head: raw.diffHeadSha ?? '',
        rebased: raw.rebaseCommitSha ?? '',
        isRebasing: raw.rebaseInProgress,
        isAutoMerging: raw.autoMergeEnabled,
        mergeError: raw.mergeError,
        strategies: raw.availableAutoMergeStrategies ?? [],
      }
    : null
}

/** Why GitLab refused a merge, in its words, or null when it took it. */
export function mergeRefusal(response: RawResponse<MergeMutation>): Refusal | null {
  const said = [...(response.errors ?? []).map(error => error.message), ...(response.data?.mergeRequestAccept?.errors ?? [])]
  if (said.length > 0) {
    return { reason: why(said.join('; ')), mayHaveLanded: false }
  }
  return isSome(response.data?.mergeRequestAccept) ? null : { reason: 'GitLab sent no answer', mayHaveLanded: false }
}

const jsonOrNull = (text: string): unknown => {
  try {
    return parseJson(text)
  } catch {
    return null
  }
}

/** Why GitLab would not start a rebase, in its words, or null when it took it. A server error may have come after it took it. */
export function rebaseRefusal(answer: { status: number; text: string }): Refusal | null {
  if (answer.status >= 200 && answer.status < 300) {
    return null
  }
  const said = jsonOrNull(answer.text)
  const message = isRecord(said) && typeof said.message === 'string' ? `: ${said.message}` : ''
  return { reason: why(`GitLab answered HTTP ${answer.status}${message}`), mayHaveLanded: answer.status >= 500 }
}
