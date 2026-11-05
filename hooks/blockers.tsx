import type { Badge } from './attention'
import { duration, plural } from './format'
import type { Kit } from './kit'
import { noteLine } from './notes'
import { statusMark, type Tone } from './status'

import type { CiStatus, Job, MrCard, Stage } from '../types'

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

const jobMark = (job: Job): { glyph: string; tone: Tone } =>
  jobKind(job) === 'amber' ? { glyph: '⚠', tone: 'warning' } : statusMark(job.status)

/** How many jobs a card lists before saying how many more there are. */
export const JOBS_SHOWN = 6

/** How long a job ran, or has so far; empty before it starts. */
const ranLine = (job: Job, now: number): string =>
  job.startedAt === null ? '' : duration(((job.finishedAt !== null ? Date.parse(job.finishedAt) : now) - Date.parse(job.startedAt)) / 1000)

/** The jobs worth opening across the pipeline: what failed, runs or waits on a person, each linked. */
export function pipelineJobs(kit: Kit, stages: Stage[]) {
  const { Box, Text, Link } = kit
  const open = stages
    .flatMap(stage => stage.jobs)
    .filter(job => ['failed', 'running'].includes(job.status) || (job.status === 'manual' && !job.allowFailure))
    .sort((a, b) => JOB_RANK[jobKind(a)] - JOB_RANK[jobKind(b)])
  return [
    ...open.slice(0, JOBS_SHOWN).map((job, i) => {
      const mark = jobMark(job)
      return (
        <Box key={`j${i}`} flexDirection="row" gap={1}>
          <Text color={mark.tone}>{mark.glyph}</Text>
          <Box flexGrow={1} flexShrink={1}>
            <Link href={job.url}>{job.name}</Link>
          </Box>
          <Text dimColor>{ranLine(job, kit.now)}</Text>
        </Box>
      )
    }),
    ...(open.length > JOBS_SHOWN ? [<Text dimColor>{`+${open.length - JOBS_SHOWN} more`}</Text>] : []),
  ]
}

/** One line or a few per marker, the markers' glyphs leading: what stands between the MR and a merge. */
export function blockerLines(kit: Kit, row: MrCard, badge: Badge) {
  const { Text, Link } = kit
  const pipeline = row.pipeline
  const head = (words: string) => (
    <Text bold color={badge.tone === 'subtle' ? undefined : badge.tone}>
      {`${badge.glyph} ${words}`}
    </Text>
  )
  switch (badge.kind) {
    case 'threads': {
      const held = new Set(row.people.map(person => person.username))
      const loose = row.openThreads.filter(note => !held.has(note.author))
      return [head(plural(loose.length, 'open thread')), ...loose.slice(0, 3).map(note => noteLine(kit, note))]
    }
    case 'failed':
      return [head('Failed jobs'), ...(pipeline?.failed ?? []).map(job => <Link href={job.url}>{job.name}</Link>)]
    case 'amber':
      return [head('Failed, allowed to fail'), ...(pipeline?.amber ?? []).map(job => <Link href={job.url}>{job.name}</Link>)]
    case 'manual':
      return [head(`Waiting on ${pipeline?.blockedOn.join(', ') ?? 'a manual job'}`)]
    case 'conflicts':
      return [head(`Conflicts with ${row.branch.target}`)]
    case 'rebase':
      return [head(`Needs a rebase onto ${row.branch.target}`)]
    case 'approvals':
      return [head(`Approvals ${badge.count}${row.approvers.length > 0 ? `: ${row.approvers.join(', ')}` : ''}`)]
    case 'ready':
      return [head('Ready to merge')]
    default:
      return []
  }
}
