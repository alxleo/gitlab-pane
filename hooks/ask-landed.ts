// What the commit a merge put on its target branch ran there, for the Mine tab's merged MRs (landed.ts says which to ask).
import type { LandedQuery, LandedQueryVariables } from './gitlab.generated.ts'
import { dataOf, isFilled, present } from './decode.ts'
import type { RawResponse, Request } from './gitlab-request.ts'
import { ciStatusOf } from './gitlab-status.ts'
import { siteOf } from './hosts.ts'

import type { LandedBuild } from '../types'

// The newest pipeline of that commit on that branch that no schedule started, one MR at a time as `Pinned` reads one. `ref` is
// what makes it the build on the target: without it GitLab answers every pipeline of the commit, and a fast-forward merge's
// commit is the source branch's own, which has its own pipeline.
// A schedule runs on the branch's head, so a nightly pipeline is newer than the merge's own and says nothing of the merge; GitLab's
// own `merge_pipeline` leaves schedules out. The argument `source` filters for one value only, so the ten newest are asked for
// beside the ten newest scheduled ones, and `buildOf` takes the first of the first list that is not in the second. (The field
// `Pipeline.source` would do it in one, but a self-managed GitLab older than it would refuse the whole document.) A commit with ten
// newer schedule pipelines reads as having none.
const LANDED = /* GraphQL */ `
  query Landed($path: ID!, $sha: String!, $ref: String!) {
    project(fullPath: $path) {
      pipelines(sha: $sha, ref: $ref, first: 10) { nodes { id status path } }
      scheduled: pipelines(sha: $sha, ref: $ref, source: "schedule", first: 10) { nodes { id } }
    }
  }
`

export type LandedOperations = {
  Landed: { variables: LandedQueryVariables; data: LandedQuery }
}

/** The document, and what GitLab scores it (`COMPLEXITY`). */
export const LANDED_ASK = { documents: { Landed: LANDED }, complexity: { Landed: 23 } } as const

/** The newest pipeline of the commit `sha` on the branch `ref`, where a merge put it (`COMPLEXITY.Landed`); one MR's, as `Pinned` is. */
export const landedQuery = (path: string, sha: string, ref: string): Request<LandedQuery> => ({
  operation: 'Landed',
  query: LANDED,
  variables: { path, sha, ref } satisfies LandedQueryVariables,
})

/**
 * The newest pipeline GitLab ran on a commit on the target branch that no schedule started, or null when it ran none (or the
 * project is out of reach). The document asks for the newest pipelines and, beside them, for the scheduled ones among the newest:
 * a nightly pipeline runs on the branch's head, is newer than the merge's own, and says nothing of the merge (GitLab's own
 * `merge_pipeline` leaves schedules out).
 */
export function buildOf(host: string, fallback: string, response: RawResponse<LandedQuery>): LandedBuild | null {
  const project = dataOf(response).project
  const scheduled = new Set(present(project?.scheduled?.nodes).map(one => one.id))
  const pipeline = present(project?.pipelines?.nodes).find(one => !scheduled.has(one.id))
  return pipeline !== undefined ? { status: ciStatusOf(pipeline.status), url: isFilled(pipeline.path) ? `${siteOf(host)}${pipeline.path}` : fallback } : null
}
