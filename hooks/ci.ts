import { flatOf } from './markdown'

import type { MrCard, Person, Pinned, Stage, Usual } from '../types'

/** A pipeline in one of these waits for nothing but a person. */
const SETTLED = ['success', 'failed', 'canceled', 'skipped', 'manual']

export const isSettled = (status: string): boolean => SETTLED.includes(status)

const MR_URL = /^https:\/\/gitlab\.com\/(.+?)\/-\/merge_requests\/(\d+)/

export const MR_URLS = /https:\/\/gitlab\.com\/[\w.\-/]+?\/-\/merge_requests\/\d+/g

export function parseMrUrl(url: string): Pinned | null {
  const match = MR_URL.exec(url.trim())
  if (!match?.[1] || !match[2]) {
    return null
  }
  const iid = Number(match[2])
  return { url: `https://gitlab.com/${match[1]}/-/merge_requests/${iid}`, project: match[1], iid }
}

export const pinKey = (pin: Pinned): string => `${pin.project}!${pin.iid}`

/** What a raised MR wakes its session for: a moment it can act on. */
export type Due = 'failed' | 'mergeable'

/**
 * Once per pipeline, the two moments a session can act on: its first hard failure, whether it still runs or has
 * ended, and GitLab newly saying the MR can merge. A pipeline that passed, or waits on a manual job, says nothing.
 */
export function advance(
  announced: readonly string[],
  card: { pipeline?: { id: number; status: string; failed: readonly unknown[] }; mergeStatus: string | null }
): { announced: string[]; due: Due | null } {
  const id = card.pipeline?.id ?? 0
  const mine = announced.filter(key => key.startsWith(`${id}:`))
  const isFailing = card.pipeline !== undefined && (card.pipeline.failed.length > 0 || card.pipeline.status === 'failed')
  const due = isFailing ? 'failed' : card.mergeStatus === 'MERGEABLE' ? 'mergeable' : null
  if (due === null || mine.includes(`${id}:${due}`)) {
    return { announced: mine, due: null }
  }
  return { announced: [...mine, `${id}:${due}`], due }
}

/** The one line a wake says: `!1395 can merge: pipeline passed in 17m`; a failure carries the pipeline's link. */
export function wakeLine(card: MrCard, due: Due, now: number): string {
  const pipeline = card.pipeline
  if (due === 'mergeable') {
    return `!${card.iid} can merge${pipeline?.status === 'success' ? `: pipeline passed in ${pipelineTime(card, now)}` : ''}`
  }
  const jobs = pipeline?.failed.map(job => job.name).join(', ') ?? ''
  const when = pipeline && isSettled(pipeline.status) ? `pipeline failed in ${pipelineTime(card, now)}` : 'a job failed while the pipeline runs'
  return `!${card.iid} ${when}${jobs ? `: ${jobs}` : ''} · ${pipeline?.url ?? card.url}`
}

/** 0 needs you now, 1 is moving, 2 waits on others, 3 is ready. */
export function rank(card: MrCard): number {
  const status = card.pipeline?.status
  if (
    status === 'failed' ||
    card.hasConflicts ||
    card.needsRebase ||
    card.changesRequestedBy.length > 0 ||
    card.openThreads.length > 0
  ) {
    return 0
  }
  if (status && !isSettled(status)) {
    return 1
  }
  return card.approvalsLeft > 0 || status === 'manual' || botsHolding(card).length > 0 ? 2 : 3
}

/** Bots with an open thread or a request for changes, either of which holds the merge. */
const botsHolding = (card: MrCard): Person[] =>
  card.people.filter(person => person.isBot && (person.openThreads > 0 || person.state === 'requested_changes'))

export const byAttention = (a: MrCard, b: MrCard): number =>
  rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt)

export type Tone = 'success' | 'error' | 'warning' | 'subtle' | 'suggestion'

export function statusMark(status: string | undefined): { glyph: string; tone: Tone } {
  switch (status) {
    case 'success':
      return { glyph: '✓', tone: 'success' }
    case 'failed':
      return { glyph: '✗', tone: 'error' }
    case 'manual':
      return { glyph: '⏸', tone: 'warning' }
    case 'canceled':
    case 'skipped':
      return { glyph: '⊘', tone: 'subtle' }
    case undefined:
      return { glyph: '○', tone: 'subtle' }
    default:
      return { glyph: '●', tone: 'suggestion' }
  }
}

export const STAGE_COLOURS: Record<Tone, string> = {
  success: '#2da44e',
  error: '#cf222e',
  warning: '#bf8700',
  suggestion: '#0969da',
  subtle: '#8c959f',
}

/**
 * An MR card's border colour, its review: red while someone asked for changes or it cannot merge as it is (conflicts,
 * a failed pipeline), green once approved, grey while it waits on a review. Whether it needs you is the line's weight.
 */
export function reviewTone(card: MrCard): Tone {
  if (card.changesRequestedBy.length > 0 || card.hasConflicts || card.pipeline?.status === 'failed') {
    return 'error'
  }
  // With no approvals required, approved means someone did approve.
  return card.approvalsLeft === 0 && (card.approvalsRequired > 0 || card.approvers.length > 0) ? 'success' : 'subtle'
}

/** What a link opens, said before its words: a Link holds text alone, and an emoji costs two characters, a logo hundreds. */
export const LINK = { mr: '🔀', jira: '🎫', repo: '📁', pipeline: '🚦', comment: '💬' } as const

/**
 * The desktop app draws nothing for a tree past 100,000 characters serialized (a 381,164-character one left the pane
 * blank). The engine adds up to about 6,000 of press handles and hover stamps to what this measures, so the app gets
 * about 91,000 at most: rows, then open detail, then hover cards, then avatars, in order of what needs you.
 */
export const DRAWING_BUDGET = 85_000

/** What the tabs, repo filter, headings and footer take, with room to spare for a long list of repos. */
export const CHROME_SIZE = 6_000

/** A tree's size as the app receives it. */
export const measure = (tree: unknown): number => {
  try {
    return JSON.stringify(tree)?.length ?? 0
  } catch {
    return DRAWING_BUDGET
  }
}

/** Keeps a hover scope or key short whatever the project path or username. */
export const shortHash = (text: string): string =>
  [...text].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0, 7).toString(36)

/** An MR card's element key, which the pane scrolls back to after its page. */
export const cardKey = (rowKey: string): string => `card-${shortHash(rowKey)}`

export const stageTone = (status: string): Tone =>
  status === 'success'
    ? 'success'
    : status === 'failed'
      ? 'error'
      : status === 'manual'
        ? 'warning'
        : isSettled(status) || status === 'created'
          ? 'subtle'
          : 'suggestion'

export type BadgeKind =
  | 'failed'
  | 'conflicts'
  | 'changes'
  | 'threads'
  | 'rebase'
  | 'manual'
  | 'amber'
  | 'bots'
  | 'approvals'
  | 'ready'

/** One marker on a row's second line: a glyph and a count, its detail on hover; `words` is what a model reads. */
export type Badge = { kind: BadgeKind; glyph: string; tone: Tone; count: string; words: string }

export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`

/** What stands between the MR and a merge, each from its own field, worst first. */
export function badges(card: MrCard): Badge[] {
  const pipeline = card.pipeline
  const list: Badge[] = []
  const add = (kind: BadgeKind, glyph: string, tone: Tone, count: string, words: string) =>
    list.push({ kind, glyph, tone, count, words })
  if (pipeline && pipeline.failed.length > 0) {
    add('failed', '✗', 'error', String(pipeline.failed.length), plural(pipeline.failed.length, 'job failed', 'jobs failed'))
  }
  if (card.hasConflicts) {
    add('conflicts', '⇄', 'error', '', 'conflicts')
  }
  if (card.changesRequestedBy.length > 0) {
    add('changes', '✋', 'error', String(card.changesRequestedBy.length), `changes requested by ${card.changesRequestedBy.join(', ')}`)
  }
  if (card.openThreads.length > 0) {
    add('threads', '💬', 'warning', String(card.openThreads.length), plural(card.openThreads.length, 'open thread'))
  }
  if (card.needsRebase) {
    add('rebase', '↻', 'warning', '', 'needs rebase')
  }
  if (pipeline && pipeline.blockedOn.length > 0) {
    add('manual', '⏸', 'warning', '', `waiting on ${pipeline.blockedOn.join(', ')}`)
  }
  if (pipeline && pipeline.amber.length > 0) {
    add('amber', '⚠', 'warning', String(pipeline.amber.length), `amber: ${pipeline.amber.map(job => job.name).join(', ')}`)
  }
  const holding = botsHolding(card)
  if (holding.length > 0) {
    const threads = holding.reduce((sum, bot) => sum + bot.openThreads, 0)
    const asked = holding.filter(bot => bot.state === 'requested_changes').map(bot => bot.name)
    const held = [threads > 0 ? plural(threads, 'open thread') : '', asked.length > 0 ? `${asked.join(', ')} requested changes` : '']
    add('bots', '🤖', 'subtle', String(threads + asked.length), `bots hold the merge: ${held.filter(Boolean).join(', ')}`)
  }
  if (card.approvalsRequired > 0) {
    const given = Math.max(0, card.approvalsRequired - card.approvalsLeft)
    add(
      'approvals',
      '👤',
      card.approvalsLeft > 0 ? 'subtle' : 'success',
      `${given}/${card.approvalsRequired}`,
      card.approvalsLeft > 0 ? `needs ${plural(card.approvalsLeft, 'approval')}` : 'approved'
    )
  }
  const blocks = list.some(badge => badge.kind !== 'approvals') || card.approvalsLeft > 0
  if (!blocks && pipeline?.status === 'success' && !card.isDraft) {
    add('ready', '⤵', 'success', '', 'ready to merge')
  }
  return list
}

/**
 * The row's markers: each person's or bot's icon speaks for their change request and threads, so 💬 keeps only threads
 * no icon holds.
 */
export function rowBadges(card: MrCard): Badge[] {
  const held = new Set(card.people.map(person => person.username))
  const loose = card.openThreads.filter(note => !held.has(note.author)).length
  return badges(card).flatMap(badge => {
    if (badge.kind === 'changes' || badge.kind === 'bots') {
      return []
    }
    if (badge.kind === 'threads') {
      return loose > 0 ? [{ ...badge, count: String(loose), words: plural(loose, 'open thread') }] : []
    }
    return [badge]
  })
}

/** What GitLab's verdict already says, so the pane's own marker for it would only repeat it. */
const SAID_BY: Record<string, readonly BadgeKind[]> = {
  MERGEABLE: ['ready', 'approvals'],
  NOT_APPROVED: ['approvals'],
  REQUESTED_CHANGES: ['changes'],
  CONFLICT: ['conflicts'],
  NEED_REBASE: ['rebase'],
  CI_MUST_PASS: ['failed'],
  DISCUSSIONS_NOT_RESOLVED: ['threads'],
}

/** Still being worked out by GitLab, or about an MR that has left: nothing worth saying. */
const QUIET = ['UNCHECKED', 'CHECKING', 'PREPARING', 'APPROVALS_SYNCING', 'NOT_OPEN']

/**
 * GitLab's own verdict on whether the MR can merge (`detailedMergeStatus`), in words and a tone, with the pane's markers
 * it already covers; null while GitLab is deciding, or when it was not read.
 */
export function verdictOf(card: MrCard): { words: string; tone: Tone; covers: readonly BadgeKind[] } | null {
  const status = card.mergeStatus
  if (!status || QUIET.includes(status)) {
    return null
  }
  const words: Record<string, [string, Tone]> = {
    MERGEABLE: ['✓ mergeable', 'success'],
    NOT_APPROVED: [card.approvalsLeft > 0 ? `needs ${plural(card.approvalsLeft, 'approval')}` : 'needs approval', 'subtle'],
    REQUESTED_CHANGES: ['changes requested', 'error'],
    CONFLICT: ['conflicts', 'error'],
    NEED_REBASE: ['needs rebase', 'warning'],
    CI_MUST_PASS: ['CI must pass', 'error'],
    CI_STILL_RUNNING: ['CI running', 'subtle'],
    DISCUSSIONS_NOT_RESOLVED: ['threads open', 'warning'],
    DRAFT_STATUS: ['draft', 'subtle'],
  }
  const [said, tone] = words[status] ?? [status.toLowerCase().replace(/_/g, ' '), 'subtle']
  return { words: said, tone, covers: SAID_BY[status] ?? [] }
}

/** A person's icon colour: asked for changes, open threads, approved, or nothing pending. */
export const personTone = (person: Person): Tone =>
  person.state === 'requested_changes' ? 'error' : person.openThreads > 0 ? 'warning' : person.state === 'approved' ? 'success' : 'subtle'

/** The same avatar at `px` pixels: GitLab resizes its uploads by `width`, Gravatar by `s`. */
export function sizedAvatar(url: string, px: number): string {
  const [base = url, query = ''] = url.split('?')
  if (!/gravatar\.com\//.test(base)) {
    return `${base}?width=${px}`
  }
  return `${base}?${[`s=${px}`, ...query.split('&').filter(pair => pair && !pair.startsWith('s='))].join('&')}`
}

const PICTURE_TYPES: [string, string][] = [
  ['iVBOR', 'image/png'],
  ['/9j/', 'image/jpeg'],
  ['R0lGOD', 'image/gif'],
  ['UklGR', 'image/webp'],
]

/** A picture's base64 as a `data:` URI typed by its first bytes; null for anything else, or past `most` characters. */
export function pictureUri(base64: string, most: number): string | null {
  const bytes = base64.replace(/\s+/g, '')
  const type = PICTURE_TYPES.find(([magic]) => bytes.startsWith(magic))?.[1]
  return type && bytes.length <= most ? `data:${type};base64,${bytes}` : null
}

/** The first line worth reading, without its Markdown marks. */
export function excerpt(body: string, room = 160): string {
  const line = flatOf(body).split('\n').find(text => text.replace(/[#*_>\s-]/g, '').length > 0) ?? ''
  const plain = line.replace(/^[#>\s]+|[*_`]/g, '').trim()
  return plain.length > room ? `${plain.slice(0, room - 1)}…` : plain
}

/** Text for Markdown, its marks escaped so a title reads as written. */
export function markdownText(text: string): string {
  return text.replace(/([\\`*_[\]()#<>!|~])/g, '\\$1')
}

/** GitLab Markdown as one drawable Markdown string (folds closed, see markdown.ts), cut at `room`. */
export function bodyOf(text: string, room = 1_200): string {
  const clean = flatOf(text)
  return clean.length > room ? `${clean.slice(0, room - 1)}…` : clean
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

export const duration = (seconds: number): string => {
  const minutes = Math.round(seconds / 60)
  if (seconds < 60) {
    return `${Math.round(seconds)}s`
  }
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export const ago = (iso: string, now: number): string => {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000)
  if (minutes < 1) {
    return 'now'
  }
  if (minutes < 60) {
    return `${minutes}m`
  }
  return minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`
}

/** Seconds any of these jobs ran, overlaps counted once, as GitLab counts a pipeline's duration. */
export function ranFor(stages: readonly Stage[], now: number): number {
  const spans = stages
    .flatMap(stage => stage.jobs)
    .flatMap(job => (job.startedAt ? [[Date.parse(job.startedAt), job.finishedAt ? Date.parse(job.finishedAt) : now] as const] : []))
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
export const usualRange = (usual: Usual): string =>
  minutes(usual.low) === minutes(usual.high) ? `${minutes(usual.low)}m` : `${minutes(usual.low)}–${minutes(usual.high)}m`

/** How long the pipeline took, or has run so far against how long one usually takes. */
export function pipelineTime(card: MrCard, now: number, usual?: Usual): string {
  const pipeline = card.pipeline
  if (!pipeline) {
    return 'no pipeline'
  }
  if (pipeline.duration !== null && isSettled(pipeline.status)) {
    return duration(pipeline.duration)
  }
  const ran = ranFor(pipeline.stages, now) || (pipeline.startedAt ? (now - Date.parse(pipeline.startedAt)) / 1000 : null)
  if (ran === null) {
    return pipeline.status
  }
  return usual ? `${duration(ran)} · usually ${usualRange(usual)}` : `${duration(ran)} so far`
}

const TICKET = /\[([A-Z]+-\d+)\]/

export const ticketOf = (title: string): string | null => TICKET.exec(title)?.[1] ?? null

/** The title without its `type(scope):` lead and ticket, which the row draws apart. */
export const shortTitle = (title: string): string =>
  title
    .replace(/^Draft:\s*/i, '')
    .replace(/^\w+(\([^)]*\))?!?:\s*/, '')
    .replace(/\[([A-Z]+-\d+|NO-JIRA)\]\s*/, '')

/** One line a model or a toast reads; never another person's words, only who and where. */
export function describe(card: MrCard, now: number): string {
  const { glyph } = statusMark(card.pipeline?.status)
  const ticket = ticketOf(card.title)
  const failed = card.pipeline?.failed.map(job => job.name) ?? []
  return [
    `!${card.iid}${ticket ? ` (${ticket})` : ''} ${glyph} ${card.pipeline?.status ?? 'no pipeline'} ${pipelineTime(card, now)}`,
    ...badges(card)
      .filter(badge => badge.kind !== 'failed' && badge.words !== 'approved')
      .map(badge => badge.words),
    failed.length > 0 ? `failed: ${failed.join(', ')}` : '',
    card.pipeline?.url ?? card.url,
  ]
    .filter(Boolean)
    .join(' · ')
}
