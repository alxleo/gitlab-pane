// The MR list: the user's authored MRs, whole or as the changes since a moment, their pipelines without the jobs. What it
// asks, what that costs, and what its answer holds: the MRs, how many GitLab timed out, and which to read again with their jobs.
import type { AuthoredPlainQuery, AuthoredPlainQueryVariables, AuthoredQuery, AuthoredQueryVariables } from './gitlab.generated.ts'
import { dataOf, present } from './decode.ts'
import { documentOf } from './gitlab-document.ts'
import { isCurrent } from './gitlab-features.ts'
import type { RawResponse, Request } from './gitlab-request.ts'
import { ciStatusOf } from './gitlab-status.ts'
import { siteOf } from './hosts.ts'
import { MR_FRAGMENTS } from './mr-fragments.ts'
import type { ListedPipeline, RawMr } from './mr-fragments.ts'

import type { HostFeatures, Pinned } from '../types'

const AUTHORED = /* GraphQL */ `
  query Authored($state: MergeRequestState, $after: Time) {
    currentUser {
      authoredMergeRequests(state: $state, updatedAfter: $after, first: 50, sort: UPDATED_DESC) {
        nodes { ...MrFields ...CommentFields headPipeline { ...PipelineFields } reviewers { nodes { ...ReviewerFields } } }
      }
    }
  }
`

const AUTHORED_PLAIN = /* GraphQL */ `
  query AuthoredPlain($state: MergeRequestState, $after: Time) {
    currentUser {
      authoredMergeRequests(state: $state, updatedAfter: $after, first: 50, sort: UPDATED_DESC) {
        nodes { ...MrFields ...ThreadFields headPipeline { ...PipelineFields } reviewers { nodes { ...ReviewerPlain } } }
      }
    }
  }
`

export type AuthoredOperations = {
  Authored: { variables: AuthoredQueryVariables; data: AuthoredQuery }
  AuthoredPlain: { variables: AuthoredPlainQueryVariables; data: AuthoredPlainQuery }
}

/** The list's documents, and what GitLab scores each (`COMPLEXITY`). */
export const AUTHORED_ASK = {
  documents: { Authored: documentOf(AUTHORED, MR_FRAGMENTS), AuthoredPlain: documentOf(AUTHORED_PLAIN, MR_FRAGMENTS) },
  complexity: { Authored: 157, AuthoredPlain: 125 },
} as const

/** How many authored MRs one read asks for: the `first:` of the Authored documents, past which a delta may have more behind it. */
export const AUTHORED_PAGE = 50

/** What an authored read asks for: every open MR, or every MR of any state that changed after a moment. */
export type AuthoredScope = { kind: 'open' } | { kind: 'since'; after: string }

/**
 * The user's authored MRs, the heaviest document (`COMPLEXITY.Authored`), their pipelines without the jobs (`needsJobs`).
 * A read `since` a moment asks for MRs of every state updated after it, so one merged or closed since comes back as such
 * instead of vanishing.
 */
export const authoredQuery = (features: HostFeatures, scope: AuthoredScope): Request<AuthoredQuery | AuthoredPlainQuery> => {
  const variables: Record<string, string> =
    scope.kind === 'open' ? ({ state: 'opened' } satisfies AuthoredQueryVariables) : ({ after: scope.after } satisfies AuthoredQueryVariables)
  return isCurrent(features)
    ? { operation: 'Authored', query: AUTHORED_ASK.documents.Authored, variables }
    : { operation: 'AuthoredPlain', query: AUTHORED_ASK.documents.AuthoredPlain, variables }
}

/** The authored MRs GitLab sent. A read with no data at all throws; a partial one keeps what came back. */
export const listedMrs = (response: RawResponse<AuthoredQuery | AuthoredPlainQuery>): RawMr[] => present<RawMr>(dataOf(response).currentUser?.authoredMergeRequests?.nodes)

/** How many of the authored MRs GitLab sent back null: parts of a heavy query it timed out. */
export const lostIn = (response: RawResponse<AuthoredQuery | AuthoredPlainQuery>): number =>
  (response.data?.currentUser?.authoredMergeRequests?.nodes ?? []).filter(node => node === null).length

/**
 * Whether an MR's row draws from its pipeline's jobs, which the list leaves out: the jobs to open, the allowed failures,
 * a manual job holding the merge, and how long a stage that did not pass ran, or a pipeline still going has. A pipeline
 * that passed with no warning (an allowed failure), every stage passed or skipped, and its duration known draws none.
 */
export const needsJobs = (pipeline: ListedPipeline | null): boolean =>
  pipeline !== null &&
  (pipeline.status !== 'SUCCESS' ||
    pipeline.warnings ||
    pipeline.duration === null ||
    present(pipeline.stages?.nodes).some(stage => !['success', 'skipped'].includes(ciStatusOf(stage.status ?? ''))))

/** The authored MRs to read again one by one with their jobs (`needsJobs`, `pinnedQuery`), as pins of `host`. */
export const jobsWanted = (host: string, response: RawResponse<AuthoredQuery | AuthoredPlainQuery>): Pinned[] =>
  present<RawMr>(response.data?.currentUser?.authoredMergeRequests?.nodes)
    .filter(raw => needsJobs(raw.headPipeline))
    .map(raw => ({ url: raw.webUrl ?? `${siteOf(host)}/${raw.project.fullPath}/-/merge_requests/${raw.iid}`, host, path: raw.project.fullPath, iid: Number(raw.iid) }))
