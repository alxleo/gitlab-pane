import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { ask, ENGINE_READS_BYTES } from './graphql'
import { failuresQuery } from './gitlab-documents'
import { jobIdOf, tailOf } from './job-tail'
import { foreign } from './model-text'
import { tokenFor } from './tokens'
import type { Failures, JobFailure } from './wake'

import type { JobLink, MrCard } from '../types'

// Whether the person leaves the end of failed jobs' logs in a wake: the `failureLogs` setting, taken when the mod loads. On unless
// the setting is false. The engine reads an atom only in the file that declares it, so it is kept and read here.
const logsAtom = atom({ plugin: 'gitlab-pane', key: 'logs' } as const, true)

/** A mod loading takes the `failureLogs` setting. */
export async function rememberLogs($: EngineInterface, setting: unknown): Promise<void> {
  await update($, logsAtom, () => setting !== false)
}

/** The end of a log is where a job says why it failed, so a host that honours a range is asked for just that much of it. */
const TAIL_BYTES = 64 * 1024

/** GitLab's message on why each failed job failed, by the job's number; none when the host cannot say. */
async function reasonsOf($: EngineInterface, card: MrCard): Promise<Map<number, string>> {
  try {
    const answer = await ask($, card.host, failuresQuery(card.path, card.iid))
    const jobs = answer.data?.project?.mergeRequest?.headPipeline?.jobs?.nodes ?? []
    return new Map(
      jobs.flatMap(job => {
        const id = job !== null && job.webPath !== null ? jobIdOf(job.webPath) : null
        return job !== null && id !== null && job.failureMessage !== null && job.failureMessage !== '' ? [[id, job.failureMessage] as const] : []
      })
    )
  } catch {
    return new Map()
  }
}

/**
 * A job's log from GitLab's REST API (`GET /api/v4/projects/:id/jobs/:job_id/trace`, which is text), cleaned to its last
 * lines. Nothing when it cannot be read, or when the log is longer than the engine reads, as what it read is then its
 * start and not the end that says why.
 */
async function tailFor($: EngineInterface, card: MrCard, id: number): Promise<JobFailure['tail']> {
  try {
    const found = await tokenFor($, card.host)
    if (!found.ok) {
      return []
    }
    const answer = await $.http.fetch(`https://${card.host}/api/v4/projects/${encodeURIComponent(card.path)}/jobs/${id}/trace`, {
      headers: { Authorization: `Bearer ${found.value.token}`, Accept: 'text/plain', Range: `bytes=-${TAIL_BYTES}` },
    })
    return (answer.status === 200 || answer.status === 206) && answer.text.length < ENGINE_READS_BYTES * 0.9 ? tailOf(answer.text) : []
  } catch {
    return []
  }
}

/**
 * Why the failed `jobs` of a raised MR's pipeline failed: GitLab's failure message for each and, unless the person turned
 * it off, the end of its log. Read once, when the wake is due; whatever cannot be read is left out, and the wake goes
 * without it.
 */
export async function readFailures($: EngineInterface, card: MrCard, jobs: readonly JobLink[]): Promise<Failures> {
  const [reasons, hasLogs] = await Promise.all([reasonsOf($, card), read($, logsAtom)])
  const entries = await Promise.all(
    jobs.map(async (job): Promise<readonly [number, JobFailure][]> => {
      const id = jobIdOf(job.url)
      if (id === null) {
        return []
      }
      const reason = reasons.get(id)
      return [[id, { reason: reason !== undefined ? foreign(reason) : null, tail: hasLogs ? await tailFor($, card, id) : [] }]]
    })
  )
  return new Map(entries.flat())
}
