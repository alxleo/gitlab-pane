// What a row's hover cards and opened detail say, as plain lines: the draw layer maps each line to an element. These
// depend on the time (how long ago, how long a job ran), so they are made for each drawing, and only for the rows that
// are drawn. Pure.
import type { Badge } from './attention.ts'
import { isFilled } from './decode.ts'
import { REVIEW_STATE } from './face-model.ts'
import { ago, pipelineTime, plural } from './format.ts'
import { projectLabel } from './hosts.ts'
import { JOBS_SHOWN, pipelineJobs } from './job-lines.ts'
import type { JobLine } from './job-lines.ts'
import type { MarkdownText } from './markdown.ts'
import type { CardFacts, NoteFacts, PersonFacts } from './row-facts.ts'
import { statusMark } from './status.ts'
import type { Tone } from './status.ts'
import { STATUS_WORD } from './strip-model.ts'

import type { MrCard, Ticket, Usual } from '../types'

export type Line =
  | { kind: 'text'; text: string; bold: boolean; dim: boolean; tone: Tone | undefined }
  | { kind: 'link'; href: string; text: string }
  | { kind: 'job'; job: JobLine }
  | { kind: 'note'; who: string; where: string; url: string; text: string }
  | { kind: 'person'; name: string; tag: string | null }
  | { kind: 'hint'; text: string; gap: boolean }

const text = (words: string, how: { bold?: boolean; dim?: boolean; tone?: Tone } = {}): Line => ({
  kind: 'text',
  text: words,
  bold: how.bold ?? false,
  dim: how.dim ?? false,
  tone: how.tone,
})

/** A note's byline words: where in the code, and when. */
export const whereAndWhen = (note: NoteFacts, now: number): string =>
  [note.where, ago(note.at, now)].filter(isFilled).join(' · ')

const noteLine = (note: NoteFacts, now: number, who = note.author): Line => ({
  kind: 'note',
  who,
  where: whereAndWhen(note, now),
  url: note.url,
  text: note.excerpt,
})

/** What a card draws beside the MR itself: what was read about its tickets and times. */
export type RowContext = {
  tickets: Readonly<Record<string, Ticket>>
  usual: Readonly<Record<string, Usual>>
  /** The start of a ticket's link; empty while no Jira site is set. */
  browse: string
  /** The repo most cards belong to, whose name a card leaves out. */
  homeRepo: string | undefined
  /** Jira cannot be read here (its tool is not installed), so a ticket will not be filled in. */
  isJiraUnavailable: boolean
}

/** The card under the first line: what the MR is, its pipeline and ticket. */
export function aboutLines(card: MrCard, facts: CardFacts, ctx: RowContext, ticketLink: string | null, now: number): Line[] {
  const pipeline = card.pipeline
  const mark = statusMark(pipeline?.status)
  const jira = facts.ticket !== null ? ctx.tickets[facts.ticket] : undefined
  const diff = card.diff !== null ? ` · +${card.diff.additions} −${card.diff.deletions} · ${plural(card.diff.files, 'file')}` : ''
  const jobs = pipeline !== undefined ? pipelineJobs(pipeline.stages, now) : { jobs: [], more: 0 }
  return [
    text(facts.title, { bold: true }),
    text(`${card.branch.source} → ${card.branch.target}${facts.isStacked ? ' (stacked)' : ''}${diff}`, { dim: true }),
    ...(card.description !== '' ? [text(facts.lead)] : []),
    ...(pipeline !== undefined
      ? [
          text(`${mark.glyph} Pipeline ${STATUS_WORD[pipeline.status]} · ${pipelineTime(card, now, ctx.usual[card.project])}`, { bold: true, tone: mark.tone }),
          ...jobs.jobs.map((job): Line => ({ kind: 'job', job })),
          ...(jobs.more > 0 ? [text(`+${jobs.more} more`, { dim: true })] : []),
        ]
      : []),
    ...(facts.ticket !== null && ticketLink !== null
      ? [text(jira !== undefined ? `${facts.ticket} · ${jira.type} · ${jira.status}: ${jira.summary}` : `${facts.ticket}: ${ctx.isJiraUnavailable ? 'Jira is not available here' : 'not read from Jira yet'}`)]
      : []),
    ...(card.project !== ctx.homeRepo ? [text(projectLabel(card.host, card.path), { dim: true })] : []),
  ]
}

/** One line or a few per marker, the markers' glyphs leading: what stands between the MR and a merge. */
export function blockerLines(card: MrCard, facts: CardFacts, badge: Badge, now: number): Line[] {
  const pipeline = card.pipeline
  const head = (words: string): Line => text(`${badge.glyph} ${words}`, { bold: true, ...(badge.tone === 'subtle' ? {} : { tone: badge.tone }) })
  const links = (jobs: readonly { name: string; url: string }[]): Line[] => jobs.map(job => ({ kind: 'link', href: job.url, text: job.name }))
  switch (badge.kind) {
    case 'threads':
      return [head(plural(facts.loose.length, 'open thread')), ...facts.loose.slice(0, 3).map(note => noteLine(note, now))]
    case 'failed':
      return [head('Failed jobs'), ...links(pipeline?.failed ?? [])]
    case 'amber':
      return [head('Failed, allowed to fail'), ...links(pipeline?.amber ?? [])]
    case 'manual':
      return [head(`Waiting on ${pipeline?.blockedOn.join(', ') ?? 'a manual job'}`)]
    case 'check':
      return [head(badge.words)]
    case 'conflicts':
      return [head(`Conflicts with ${card.branch.target}`)]
    case 'rebase':
      return [head(`Needs a rebase onto ${card.branch.target}`)]
    case 'approvals':
      return [head(`Approvals ${badge.count}${card.approvers.length > 0 ? `: ${card.approvers.join(', ')}` : ''}`)]
    case 'ready':
      return [head('Ready to merge')]
    case 'bots':
    case 'changes':
      // A person's or bot's icon speaks for these, so the row never has them as markers.
      return []
  }
}

/** What a hover on a person's face shows: who they are, where they stand, their latest comment. */
export function personLines(person: PersonFacts, now: number): Line[] {
  const latest = person.notes[0]
  return [
    { kind: 'person', name: person.name, tag: person.tag },
    text(person.standing, { tone: person.tone }),
    ...(latest !== undefined ? [noteLine(latest, now, latest.isOpen ? 'open thread' : 'comment')] : []),
    {
      kind: 'hint',
      gap: latest !== undefined,
      text:
        person.notes.length > 1
          ? `Click their name for all ${person.notes.length} comments.`
          : person.notes.length === 1
            ? 'Click their name to read it whole.'
            : 'No comments.',
    },
  ]
}

export type NoteBlock = { who: string; where: string; url: string; body: MarkdownText }

/** What an opened card ends on, before its foot: one person's comments, or the description, failed jobs and threads. */
export type DetailModel =
  | { kind: 'person'; title: string; notes: NoteBlock[] }
  | {
      kind: 'mr'
      description: MarkdownText | null
      jobs: { glyph: string; name: string; href: string }[]
      more: { text: string; href: string } | null
      threads: NoteBlock[]
      hasPeople: boolean
    }

export function detailOf(card: MrCard, facts: CardFacts, focus: PersonFacts | undefined, now: number): DetailModel {
  if (focus !== undefined) {
    return {
      kind: 'person',
      title: `${focus.name} · ${REVIEW_STATE[focus.state]} · ${plural(focus.notes.length, 'comment')}`,
      notes: focus.notes.map(note => ({ who: note.isOpen ? 'open thread' : 'comment', where: whereAndWhen(note, now), url: note.url, body: note.comment })),
    }
  }
  const pipeline = card.pipeline
  const jobs = pipeline === undefined ? [] : [...pipeline.failed.map(job => ({ job, glyph: '✗' })), ...pipeline.amber.map(job => ({ job, glyph: '⚠' }))]
  return {
    kind: 'mr',
    description: facts.detail,
    jobs: jobs.slice(0, JOBS_SHOWN).map(({ job, glyph }) => ({ glyph, name: job.name, href: job.url })),
    more: pipeline !== undefined && jobs.length > JOBS_SHOWN ? { text: `+${jobs.length - JOBS_SHOWN} more`, href: pipeline.url } : null,
    threads: facts.threads.map(note => ({ who: note.author, where: whereAndWhen(note, now), url: note.url, body: note.thread })),
    hasPeople: card.people.length > 0,
  }
}
