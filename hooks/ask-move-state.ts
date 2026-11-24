// What a move needs just before it is made, and after a rebase until it is done: one MR, read fresh.
import type { MoveStateQuery, MoveStateQueryVariables } from './gitlab.generated'
import { dataOf, isSome } from './decode'
import type { RawResponse, Request } from './gitlab-request'
import type { Fresh } from './next-move'

const MOVE_STATE = /* GraphQL */ `
  query MoveState($path: ID!, $iid: String!) {
    project(fullPath: $path) { mergeRequest(iid: $iid) { state detailedMergeStatus diffHeadSha rebaseCommitSha rebaseInProgress autoMergeEnabled mergeError availableAutoMergeStrategies squashOnMerge } }
  }
`

export type MoveStateOperations = {
  MoveState: { variables: MoveStateQueryVariables; data: MoveStateQuery }
}

/** The document, and what GitLab scores it (`COMPLEXITY`). */
export const MOVE_STATE_ASK = { documents: { MoveState: MOVE_STATE }, complexity: { MoveState: 18 } } as const

/** One MR as a move needs it, read fresh (`COMPLEXITY.MoveState`). */
export const moveStateQuery = (path: string, iid: number): Request<MoveStateQuery> => ({
  operation: 'MoveState',
  query: MOVE_STATE,
  variables: { path, iid: String(iid) } satisfies MoveStateQueryVariables,
})

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
        squash: raw.squashOnMerge,
      }
    : null
}
