// GitLab's own merge checks of the user's open MRs, and what it says of merging each: asked beside the list, never inside it.
import type { MergeStatusQuery } from './gitlab.generated.ts'
import type { RawResponse, Request } from './gitlab-request.ts'
import { checkStatusOf } from './gitlab-status.ts'
import { cardKey } from './hosts.ts'

import type { HostFeatures, MergeStatus, Merging } from '../types'

// The verdict and what can be done about it come in one answer: the head the checks were made on is the one a merge names,
// so the pane never merges a commit newer than the verdict it showed.
const MERGE_STATUS = /* GraphQL */ `
  query MergeStatus {
    currentUser {
      authoredMergeRequests(state: opened, first: 50, sort: UPDATED_DESC) {
        nodes { iid project { fullPath } mergeabilityChecks { identifier status } diffHeadSha rebaseInProgress autoMergeEnabled userPermissions { canMerge pushToSourceBranch } }
      }
    }
  }
`

export type MergeStatusOperations = {
  MergeStatus: { variables: Record<string, never>; data: MergeStatusQuery }
}

/** The document, and what GitLab scores it (`COMPLEXITY`). */
export const MERGE_STATUS_ASK = { documents: { MergeStatus: MERGE_STATUS }, complexity: { MergeStatus: 34 } } as const

/**
 * GitLab's own merge checks for the same MRs, or none for a host that lacks them. Asked on its own: its single verdict (`detailedMergeStatus`) answered
 * CONFLICT, twice in a row, inside the authored query for MRs that this query and each MR's own lookup called MERGEABLE.
 */
export const mergeStatusQuery = (features: HostFeatures): Request<MergeStatusQuery> | null =>
  features.hasMergeVerdict ? { operation: 'MergeStatus', query: MERGE_STATUS, variables: {} } : null

/** GitLab's merge checks of an MR, and what it says of merging it, from the same answer. */
export type GitLabVerdict = { checks: MergeStatus; merging: Merging }

/** Each MR's merge checks by card key; an MR missing from the answer, or sent with no checks, has none. */
export function readMergeStatus(host: string, response: RawResponse<MergeStatusQuery>): Map<string, GitLabVerdict> {
  const nodes = response.data?.currentUser?.authoredMergeRequests?.nodes ?? []
  return new Map(
    nodes.flatMap(node => {
      if (node === null) {
        return []
      }
      const checks = node.mergeabilityChecks.map(check => ({ id: check.identifier, status: checkStatusOf(check.status) }))
      const merging: Merging = {
        head: node.diffHeadSha ?? '',
        isRebasing: node.rebaseInProgress,
        isAutoMerging: node.autoMergeEnabled,
        canMerge: node.userPermissions.canMerge,
        canPush: node.userPermissions.pushToSourceBranch,
      }
      return checks.length > 0 ? [[cardKey(host, node.project.fullPath, node.iid), { checks, merging }] as const] : []
    })
  )
}
