// Which jobs of a pipeline are worth opening and in what order, as plain data: a shared card keeps the first of them. Pure.
import type { CiStatus, Job, Stage } from '../types'

/** A job is its status, but a failure it may have is amber. */
type JobKind = CiStatus | 'amber'

/** Jobs worth a look first: hard failures, then what runs, then what waits, then what passed. */
const JOB_RANK: Record<JobKind, number> = {
  failed: 0,
  running: 1,
  amber: 2,
  preparing: 3,
  waiting_for_resource: 4,
  waiting_for_callback: 5,
  pending: 6,
  scheduled: 7,
  manual: 8,
  created: 9,
  success: 10,
  skipped: 11,
  canceling: 12,
  canceled: 13,
  unknown: 14,
}

const jobKind = (job: Job): JobKind => (job.status === 'failed' && job.allowFailure ? 'amber' : job.status)

/** The jobs worth opening across the pipeline, most pressing first: what failed, runs or waits on a person. */
export function listedJobs(stages: readonly Stage[]): Job[] {
  return stages
    .flatMap(stage => stage.jobs)
    .filter(job => ['failed', 'running'].includes(job.status) || (job.status === 'manual' && !job.allowFailure))
    .sort((a, b) => JOB_RANK[jobKind(a)] - JOB_RANK[jobKind(b)])
}
