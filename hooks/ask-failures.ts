// Why a raised MR's failed jobs failed, asked only when its pipeline has just failed: one small query then, and no field
// on every read for a message few reads need. A host too old to have the field answers an error, and the wake goes without.
import type { FailuresQuery, FailuresQueryVariables } from './gitlab.generated.ts'
import type { RawResponse, Request } from './gitlab-request.ts'
import { jobIdOf } from './job-tail.ts'

const FAILURES = /* GraphQL */ `
  query Failures($path: ID!, $iid: String!) {
    project(fullPath: $path) { mergeRequest(iid: $iid) { headPipeline { jobs(statuses: [FAILED], retried: false) { nodes { webPath allowFailure failureMessage } } } } }
  }
`

export type FailuresOperations = {
  Failures: { variables: FailuresQueryVariables; data: FailuresQuery }
}

/** The document, and what GitLab scores it (`COMPLEXITY`). */
export const FAILURES_ASK = { documents: { Failures: FAILURES }, complexity: { Failures: 16 } } as const

/** Why the failed jobs of an MR's pipeline failed (`COMPLEXITY.Failures`). */
export const failuresQuery = (path: string, iid: number): Request<FailuresQuery> => ({
  operation: 'Failures',
  query: FAILURES,
  variables: { path, iid: String(iid) } satisfies FailuresQueryVariables,
})

/** GitLab's message on why each failed job failed, by the job's number; a job it gave no message for has none. */
export function failureReasons(response: RawResponse<FailuresQuery>): Map<number, string> {
  const jobs = response.data?.project?.mergeRequest?.headPipeline?.jobs?.nodes ?? []
  return new Map(
    jobs.flatMap(job => {
      const id = job !== null && job.webPath !== null ? jobIdOf(job.webPath) : null
      return job !== null && id !== null && job.failureMessage !== null && job.failureMessage !== '' ? [[id, job.failureMessage] as const] : []
    })
  )
}
