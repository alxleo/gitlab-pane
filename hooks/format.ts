import { cutMarkdown, flatOf, type MarkdownText } from './markdown.ts'
import { line, type ModelLine } from './model-text.ts'
import { isSettled } from './status.ts'

import type { MrCard, Stage, Usual } from '../types'

export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`

/** The first line worth reading, without its Markdown marks. */
export function excerpt(body: string, room = 160): string {
  const line = flatOf(body).split('\n').find(text => text.replace(/[#*_>\s-]/g, '').length > 0) ?? ''
  const plain = line.replace(/^[#>\s]+|[*_`]/g, '').trim()
  return plain.length > room ? `${plain.slice(0, room - 1)}…` : plain
}

/** GitLab Markdown as one drawable Markdown string (folds closed, see markdown.ts), cut at `room`. */
export function bodyOf(text: string, room = 1_200): MarkdownText {
  return cutMarkdown(flatOf(text), room)
}

/** The first paragraph under the headings, as one plain line. */
export function lead(body: string, room = 240): string {
  const paragraph =
    flatOf(body)
      .replace(/^#.*$/gm, '')
      .split(/\n\s*\n/)
      .map(text => text.trim())
      .find(Boolean) ?? ''
  const plain = paragraph
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[>\-*\s]+/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/\s*\n\s*/g, ' ')
  return plain.length > room ? `${plain.slice(0, room - 1)}…` : plain
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

/** Seconds any of these jobs ran, overlaps counted once, as GitLab counts a pipeline's duration. */
export function ranFor(stages: readonly Stage[], now: number): number {
  const spans = stages
    .flatMap(stage => stage.jobs)
    .flatMap(job => (job.startedAt !== null ? [[Date.parse(job.startedAt), job.finishedAt !== null ? Date.parse(job.finishedAt) : now] as const] : []))
    .sort((a, b) => a[0] - b[0])
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
export const usualRange = (usual: Usual): ModelLine =>
  minutes(usual.low) === minutes(usual.high) ? line`${minutes(usual.low)}m` : line`${minutes(usual.low)}–${minutes(usual.high)}m`

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

const TICKET = /\[([A-Z]+-\d+)\]/

export const ticketOf = (title: string): string | null => TICKET.exec(title)?.[1] ?? null

/** The title without its `type(scope):` lead and ticket, which the row draws apart. */
export const shortTitle = (title: string): string =>
  title
    .replace(/^Draft:\s*/i, '')
    .replace(/^\w+(\([^)]*\))?!?:\s*/, '')
    .replace(/\[([A-Z]+-\d+|NO-JIRA)\]\s*/, '')
