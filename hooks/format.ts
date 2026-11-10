import { shorten } from './graphemes.ts'
import { flatOf } from './markdown.ts'
import { line, type ModelLine } from './model-text.ts'
import { isSettled } from './status.ts'

import type { GitLabMarkdown, Job, MrCard, Ran, Stage, Usual } from '../types'

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

/** A body's lines of prose: code blocks (a suggestion is one) left out, a link's words kept without its address, pictures dropped. */
function proseLines(body: GitLabMarkdown): string[] {
  const kept: string[] = []
  let isCode = false
  for (const text of flatOf(body).split('\n')) {
    if (/^\s*(```|~~~)/u.test(text)) {
      isCode = !isCode
    } else if (!isCode) {
      kept.push(text.replace(/!\[[^\]]*\]\([^)]*\)/gu, '').replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1'))
    }
  }
  return kept
}

/**
 * The first line worth reading, as plain words cut between characters: without Markdown's marks, and empty for a body of
 * code or pictures alone.
 */
export function excerpt(body: GitLabMarkdown, room = 160): string {
  const first = proseLines(body).find(text => text.replace(/[#*_>\s-]/gu, '').length > 0) ?? ''
  // Underscores stay: in a review they are mostly names (`fn_name`), rarely emphasis.
  return shorten(first.replace(/^[#>\s]+|[*`]/gu, '').trim(), room)
}

/** The first paragraph under the headings, as one plain line. */
export function lead(body: GitLabMarkdown, room = 240): string {
  const paragraph =
    flatOf(body)
      .replace(/^#.*$/gmu, '')
      .split(/\n\s*\n/u)
      .map(text => text.trim())
      .find(Boolean) ?? ''
  const plain = paragraph
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/^[>\-*\s]+/gmu, '')
    .replace(/[*_`]/gu, '')
    .replace(/\s*\n\s*/gu, ' ')
  return shorten(plain, room)
}

export const duration = (seconds: number): ModelLine => {
  const minutes = Math.round(seconds / 60)
  if (seconds < 60) {
    return line`${Math.round(seconds)}s`
  }
  if (minutes < 60) {
    return line`${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? line`${hours}h ${minutes % 60}m` : line`${Math.floor(hours / 24)}d ${hours % 24}h`
}

export const ago = (iso: string, now: number): ModelLine => {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000)
  if (minutes < 1) {
    return line`now`
  }
  if (minutes < 60) {
    return line`${minutes}m`
  }
  return minutes < 1440 ? line`${Math.floor(minutes / 60)}h` : line`${Math.floor(minutes / 1440)}d`
}

/** The jobs that failed and may not, counting those a shared card leaves out of its list. */
export const failedCount = (pipeline: NonNullable<MrCard['pipeline']>): number => pipeline.failed.length + pipeline.moreFailed
/** The jobs that failed and may, counting those a shared card leaves out of its list. */
export const amberCount = (pipeline: NonNullable<MrCard['pipeline']>): number => pipeline.amber.length + pipeline.moreAmber
/** The open threads a person started, counting those a shared card leaves out of its list. */
export const threadCount = (card: MrCard): number => card.openThreads.length + card.threadsLeft.loose + card.threadsLeft.held
/** The open threads no person's icon holds, counting those a shared card leaves out of its list. */
export const looseCount = (card: MrCard, held: ReadonlySet<string>): number => card.openThreads.filter(note => !held.has(note.author)).length + card.threadsLeft.loose

/** Merges time spans that touch or overlap into runs, in order. */
function merged(spans: readonly (readonly [number, number])[]): [number, number][] {
  const runs: [number, number][] = []
  for (const [start, end] of spans.toSorted((a, b) => a[0] - b[0])) {
    const last = runs.at(-1)
    if (last !== undefined && start <= last[1]) {
      last[1] = Math.max(last[1], end)
    } else {
      runs.push([start, end])
    }
  }
  return runs
}

/** When these jobs ran: the spans of the finished ones merged into runs, and the start of each that is still going. */
export function ranOf(jobs: readonly Pick<Job, 'startedAt' | 'finishedAt'>[]): Ran {
  const started = jobs.flatMap(job => (job.startedAt !== null ? [{ start: Date.parse(job.startedAt), end: job.finishedAt !== null ? Date.parse(job.finishedAt) : null }] : []))
  return {
    done: merged(started.flatMap(({ start, end }) => (end !== null ? [[start, end] as const] : []))),
    running: started.flatMap(({ start, end }) => (end === null ? [start] : [])),
  }
}

/** Seconds any of these stages' jobs ran, overlaps counted once, as GitLab counts a pipeline's duration. */
export function ranFor(stages: readonly Stage[], now: number): number {
  const spans = stages.flatMap(stage => [...stage.ran.done, ...stage.ran.running.map((start): [number, number] => [start, now])]).toSorted((a, b) => a[0] - b[0])
  let total = 0
  let reach = -Infinity
  spans.forEach(([start, end]) => {
    total += Math.max(0, end - Math.max(start, reach))
    reach = Math.max(reach, end)
  })
  return Math.round(total / 1000)
}

const minutes = (seconds: number) => Math.max(1, Math.round(seconds / 60))

/** `10–15m`, the middle half of recent runs. */
const usualRange = (usual: Usual): ModelLine => (minutes(usual.low) === minutes(usual.high) ? line`${minutes(usual.low)}m` : line`${minutes(usual.low)}–${minutes(usual.high)}m`)

/** How long the pipeline took, or has run so far against how long one usually takes. */
export function pipelineTime(card: MrCard, now: number, usual?: Usual): ModelLine {
  const pipeline = card.pipeline
  if (pipeline === undefined) {
    return line`no pipeline`
  }
  if (pipeline.duration !== null && isSettled(pipeline.status)) {
    return duration(pipeline.duration)
  }
  const ranJobs = ranFor(pipeline.stages, now)
  const ran = ranJobs > 0 ? ranJobs : pipeline.startedAt !== null ? (now - Date.parse(pipeline.startedAt)) / 1000 : null
  if (ran === null) {
    return line`${pipeline.status}`
  }
  return usual !== undefined ? line`${duration(ran)} · usually ${usualRange(usual)}` : line`${duration(ran)} so far`
}

const TICKET = /\[([A-Z]+-\d+)\]/u

export const ticketOf = (title: string): string | null => TICKET.exec(title)?.[1] ?? null

/** The title without its `type(scope):` lead and ticket, which the row draws apart. */
export const shortTitle = (title: string): string =>
  title
    .replace(/^Draft:\s*/iu, '')
    .replace(/^\w+(\([^)]*\))?!?:\s*/u, '')
    .replace(/\[([A-Z]+-\d+|NO-JIRA)\]\s*/u, '')
