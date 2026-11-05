import { badges, isMergeable } from './attention.ts'
import { pipelineTime, ticketOf } from './format.ts'
import { jobIdOf, quotedTail } from './job-tail.ts'
import { commas, dotted, EMPTY, foreign, line, NAME_ROOM, URL_ROOM, type ModelLine } from './model-text.ts'
import { isSettled, statusMark } from './status.ts'

import type { CiStatus, JobLink, MergeStatus, MrCard } from '../types'

/** What a raised MR wakes its session for: a moment it can act on. */
export type Due = 'failed' | 'mergeable'

/**
 * Once per pipeline, the two moments a session can act on: its first hard failure, whether it still runs or has
 * ended, and GitLab newly saying the MR can merge. A pipeline that passed, or waits on a manual job, says nothing.
 */
export function advance(
  announced: readonly string[],
  card: { pipeline?: { id: number; status: CiStatus; failed: readonly unknown[] }; mergeStatus: MergeStatus | null }
): { announced: string[]; due: Due | null } {
  const id = card.pipeline?.id ?? 0
  const mine = announced.filter(key => key.startsWith(`${id}:`))
  const isFailing = card.pipeline !== undefined && (card.pipeline.failed.length > 0 || card.pipeline.status === 'failed')
  const due = isFailing ? 'failed' : isMergeable(card.mergeStatus) ? 'mergeable' : null
  if (due === null || mine.includes(`${id}:${due}`)) {
    return { announced: mine, due: null }
  }
  return { announced: [...mine, `${id}:${due}`], due }
}

/** What is known of why a failed job failed: GitLab's message, and the cleaned end of its log. Both are foreign text. */
export type JobFailure = { reason: ModelLine | null; tail: readonly ModelLine[] }

/** A failed pipeline's jobs by the number in their links; the reasons and tails of those GitLab and the log could tell. */
export type Failures = ReadonlyMap<number, JobFailure>

const failureOf = (job: JobLink, failures: Failures): JobFailure | undefined => {
  const id = jobIdOf(job.url)
  return id !== null ? failures.get(id) : undefined
}

/** The one line a wake says: `!1395 can merge: pipeline passed in 17m`; a failure carries the pipeline's link, and each job why it failed. */
export function wakeLine(card: MrCard, due: Due, now: number, failures: Failures = new Map()): ModelLine {
  const pipeline = card.pipeline
  const time = pipelineTime(card, now)
  if (due === 'mergeable') {
    return line`!${card.iid} can merge${pipeline?.status === 'success' ? line`: pipeline passed in ${time}` : EMPTY}`
  }
  const jobs = commas(
    pipeline?.failed.map(job => {
      const reason = failureOf(job, failures)?.reason ?? null
      return reason !== null ? line`${foreign(job.name)} (${reason})` : foreign(job.name)
    }) ?? []
  )
  const when = pipeline !== undefined && isSettled(pipeline.status) ? line`pipeline failed in ${time}` : line`a job failed while the pipeline runs`
  const left = pipeline !== undefined && pipeline.moreFailed > 0 ? line` +${pipeline.moreFailed} more` : EMPTY
  return line`!${card.iid} ${when}${jobs.length > 0 ? line`: ${jobs}${left}` : EMPTY} · ${foreign(pipeline?.url ?? card.url, URL_ROOM)}`
}

/** The lines after a failure's wake: the end of each failed job's log, quoted as the job's output and fenced from the rest. */
export const wakeTails = (card: MrCard, failures: Failures): ModelLine[] =>
  (card.pipeline?.failed ?? []).flatMap(job => quotedTail(foreign(job.name), failureOf(job, failures)?.tail ?? []))

/** One line a model or a toast reads; never another person's words, only who and where. */
export function describe(card: MrCard, now: number): ModelLine {
  const { glyph } = statusMark(card.pipeline?.status)
  const ticket = ticketOf(card.title)
  const failed = card.pipeline?.failed.map(job => foreign(job.name)) ?? []
  return dotted([
    line`!${card.iid}${ticket !== null ? line` (${foreign(ticket)})` : EMPTY} ${glyph} ${card.pipeline?.status ?? 'no pipeline'} ${pipelineTime(card, now)}`,
    ...badges(card)
      .filter(badge => badge.kind !== 'failed' && badge.words !== 'approved')
      .map(badge => foreign(badge.words, NAME_ROOM)),
    failed.length > 0 ? line`failed: ${commas(failed)}${card.pipeline !== undefined && card.pipeline.moreFailed > 0 ? line` +${card.pipeline.moreFailed} more` : EMPTY}` : EMPTY,
    foreign(card.pipeline?.url ?? card.url, URL_ROOM),
  ])
}
