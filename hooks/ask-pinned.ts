// One MR read on its own, with its pipeline's jobs: a pinned MR the list lacks (someone else's, or merged), an MR whose row
// draws from the jobs the list leaves out, and an MR's page.
import type { PinnedPlainQuery, PinnedQuery, PinnedQueryVariables } from './gitlab.generated'
import { dataOf, isSome } from './decode'
import { documentOf } from './gitlab-document'
import { isCurrent } from './gitlab-features'
import type { RawResponse, Request } from './gitlab-request'
import { MR_FRAGMENTS } from './mr-fragments'
import type { RawMr } from './mr-fragments'

import type { HostFeatures, Pinned } from '../types'

const PINNED = /* GraphQL */ `
  query Pinned($path: ID!, $iid: String!) {
    project(fullPath: $path) { mergeRequest(iid: $iid) { ...MrFields ...CommentFields headPipeline { ...PipelineJobs } reviewers { nodes { ...ReviewerFields } } } }
  }
`

const PINNED_PLAIN = /* GraphQL */ `
  query PinnedPlain($path: ID!, $iid: String!) {
    project(fullPath: $path) { mergeRequest(iid: $iid) { ...MrFields ...ThreadFields headPipeline { ...PipelineJobs } reviewers { nodes { ...ReviewerPlain } } } }
  }
`

export type PinnedOperations = {
  Pinned: { variables: PinnedQueryVariables; data: PinnedQuery }
  PinnedPlain: { variables: PinnedQueryVariables; data: PinnedPlainQuery }
}

/** One MR's documents, and what GitLab scores each (`COMPLEXITY`). */
export const PINNED_ASK = {
  documents: { Pinned: documentOf(PINNED, MR_FRAGMENTS), PinnedPlain: documentOf(PINNED_PLAIN, MR_FRAGMENTS) },
  complexity: { Pinned: 120, PinnedPlain: 99 },
} as const

/**
 * A pinned MR the authored list lacks (someone else's, or merged), one query each (`COMPLEXITY.Pinned`): that needs no
 * aliases that change with how many are pinned, and a project out of reach loses its own MR and no other.
 */
export const pinnedQuery = (pin: Pinned, features: HostFeatures): Request<PinnedQuery | PinnedPlainQuery> => {
  const variables = { path: pin.path, iid: String(pin.iid) } satisfies PinnedQueryVariables
  return isCurrent(features)
    ? { operation: 'Pinned', query: PINNED_ASK.documents.Pinned, variables }
    : { operation: 'PinnedPlain', query: PINNED_ASK.documents.PinnedPlain, variables }
}

/** The one MR, or none when GitLab named no such MR or project (out of reach). A read with no data at all throws. */
export const pinnedMr = (response: RawResponse<PinnedQuery | PinnedPlainQuery>): RawMr | null => {
  const raw = dataOf(response).project?.mergeRequest
  return isSome(raw) ? raw : null
}
