// The documents on merging an MR, and the requests built from them: GitLab's verdict on the user's MRs, one MR read fresh
// before and during a move, and the merge, the only document that changes anything in GitLab. GraphQL has no rebase,
// which goes over REST (moves.ts). DOCUMENTS in gitlab-documents.ts holds these with the rest, for the schema check.
import type { MergeMutation, MergeMutationVariables, MergeStatusQuery, MergeStrategyEnum, MoveStateQuery, MoveStateQueryVariables } from './gitlab.generated.ts'
import type { Operations, Request } from './gitlab-documents.ts'

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
