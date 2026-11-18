// How long a project's MR pipelines usually run, from its recent successful ones.
import type { UsualQuery, UsualQueryVariables } from './gitlab.generated.ts'
import { present } from './decode.ts'
import type { RawResponse, Request } from './gitlab-request.ts'

import type { Usual } from '../types'

const USUAL = /* GraphQL */ `
  query Usual($path: ID!) {
    project(fullPath: $path) { pipelines(source: "merge_request_event", status: SUCCESS, first: 20) { nodes { duration } } }
  }
`

export type UsualOperations = {
  Usual: { variables: UsualQueryVariables; data: UsualQuery }
}

/** The document, and what GitLab scores it (`COMPLEXITY`). */
export const USUAL_ASK = { documents: { Usual: USUAL }, complexity: { Usual: 8 } } as const

/** The recent successful MR pipelines of a project, for how long one usually runs: cheap (`COMPLEXITY.Usual`), so one query each. */
export const usualQuery = (path: string): Request<UsualQuery> => ({
  operation: 'Usual',
  query: USUAL,
  variables: { path } satisfies UsualQueryVariables,
})

/** GitLab's `duration` counts only the time jobs ran, so a manual gate left waiting does not stretch it. */
export function readUsual(response: RawResponse<UsualQuery>): Usual | null {
  const seconds = present(response.data?.project?.pipelines?.nodes)
    .map(pipeline => pipeline.duration)
    .filter((value): value is number => typeof value === 'number')
    .toSorted((a, b) => a - b)
  if (seconds.length < 5) {
    return null
  }
  const at = (share: number) => seconds[Math.round((seconds.length - 1) * share)] ?? 0
  return { low: at(0.25), high: at(0.75) }
}
