// Which jobs a card lists and in what order, as plain data. Pure; blockers.tsx draws them.
import { duration } from './format.ts'
import { statusMark } from './status.ts'
import type { Tone } from './status.ts'

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

const jobMark = (job: Job): { glyph: string; tone: Tone } => (jobKind(job) === 'amber' ? { glyph: '⚠', tone: 'warning' } : statusMark(job.status))

/** How many jobs a card lists before saying how many more there are. */
export const JOBS_SHOWN = 6

/** How long a job ran, or has so far; empty before it starts. */
const ranLine = (job: Job, now: number): string =>
  job.startedAt === null ? '' : duration(((job.finishedAt !== null ? Date.parse(job.finishedAt) : now) - Date.parse(job.startedAt)) / 1000)

export type JobLine = { glyph: string; tone: Tone; name: string; href: string; ran: string }

/** The jobs worth opening across the pipeline, most pressing first: what failed, runs or waits on a person. */
export function listedJobs(stages: readonly Stage[]): Job[] {
  return stages
    .flatMap(stage => stage.jobs)
    .filter(job => ['failed', 'running'].includes(job.status) || (job.status === 'manual' && !job.allowFailure))
    .sort((a, b) => JOB_RANK[jobKind(a)] - JOB_RANK[jobKind(b)])
}

/** The jobs worth opening across the pipeline, each linked; `more` are left out, `unlisted` of them by a shared card that kept the first few alone. */
export function pipelineJobs(stages: readonly Stage[], now: number, unlisted = 0): { jobs: JobLine[]; more: number } {
  const open = listedJobs(stages)
  return {
    jobs: open.slice(0, JOBS_SHOWN).map(job => ({ ...jobMark(job), name: job.name, href: job.url, ran: ranLine(job, now) })),
    more: Math.max(0, open.length - JOBS_SHOWN) + unlisted,
  }
}
