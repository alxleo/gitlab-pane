import { badges, isMergeable } from './attention.ts'
import { pipelineTime, ticketOf } from './format.ts'
import { commas, dotted, EMPTY, foreign, line, NAME_ROOM, URL_ROOM, type ModelLine } from './model-text.ts'
import { isSettled, statusMark } from './status.ts'

import type { CiStatus, MergeStatus, MrCard } from '../types'

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

/** The one line a wake says: `!1395 can merge: pipeline passed in 17m`; a failure carries the pipeline's link. */
export function wakeLine(card: MrCard, due: Due, now: number): ModelLine {
  const pipeline = card.pipeline
  const time = pipelineTime(card, now)
  if (due === 'mergeable') {
    return line`!${card.iid} can merge${pipeline?.status === 'success' ? line`: pipeline passed in ${time}` : EMPTY}`
  }
  const jobs = commas(pipeline?.failed.map(job => foreign(job.name)) ?? [])
  const when = pipeline !== undefined && isSettled(pipeline.status) ? line`pipeline failed in ${time}` : line`a job failed while the pipeline runs`
  return line`!${card.iid} ${when}${jobs.length > 0 ? line`: ${jobs}` : EMPTY} · ${foreign(pipeline?.url ?? card.url, URL_ROOM)}`
}

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
    failed.length > 0 ? line`failed: ${commas(failed)}` : EMPTY,
    foreign(card.pipeline?.url ?? card.url, URL_ROOM),
  ])
}
