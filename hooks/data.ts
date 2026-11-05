import { atom, derive, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { isEqual } from './equal.ts'
import { browseUrl } from './jira.ts'
import { pinKey } from './mr-url.ts'
import { cardFacts } from './row-facts.ts'

import type { MrCard, Pinned, PollState, Ticket, Usual } from '../types'

// What GitLab, Jira and avatar fetches gave, and the polling's bookkeeping. The engine reads an atom only in the file that
// declares it, so everything that reads or writes these goes through the functions below.
const pinnedAtom = atom({ plugin: 'gitlab-ci', key: 'pinned' } as const, [])
const rowsAtom = atom({ plugin: 'gitlab-ci', key: 'rows' } as const, [])
const ticketsAtom = atom({ plugin: 'gitlab-ci', key: 'tickets' } as const, {})
const usualAtom = atom({ plugin: 'gitlab-ci', key: 'usual' } as const, {})
const avatarsAtom = atom({ plugin: 'gitlab-ci', key: 'avatars' } as const, {})
const announcedAtom = atom({ plugin: 'gitlab-ci', key: 'announced' } as const, {})
const unreachableAtom = atom({ plugin: 'gitlab-ci', key: 'unreachable' } as const, [])
const jiraAtom = atom({ plugin: 'gitlab-ci', key: 'jira' } as const, '')
const pollAtom = atom({ plugin: 'gitlab-ci', key: 'poll' } as const, {
  fetchedAt: null,
  attemptedAt: null,
  error: null,
  failures: 0,
  ticketsAt: null,
  usualAt: null,
} satisfies PollState)

// The rows with what each says by itself (badges, verdict, words, the Markdown cut from its text, its faces with their
// pictures), made again only when the rows or the pictures change, not for every drawing.
const drawnRowsOf = derive([rowsAtom, avatarsAtom], (rows, avatars) => ({
  rows,
  facts: Object.fromEntries(rows.map(row => [row.key, cardFacts(row, avatars)])),
}))

/** What the pane draws from; reading it here makes the pane redraw when any of it changes. */
export async function drawnData($: EngineInterface) {
  const [pinned, drawn, tickets, usual, poll, browse] = await Promise.all([
    read($, pinnedAtom),
    read($, drawnRowsOf),
    read($, ticketsAtom),
    read($, usualAtom),
    read($, pollAtom),
    read($, jiraAtom),
  ])
  return { pinned, rows: drawn.rows, facts: drawn.facts, tickets, usual, poll, browse }
}

export function readPinned($: EngineInterface): Promise<Pinned[]> {
  return read($, pinnedAtom)
}
export function readRows($: EngineInterface): Promise<MrCard[]> {
  return read($, rowsAtom)
}
export function readTicketsKnown($: EngineInterface): Promise<Record<string, Ticket>> {
  return read($, ticketsAtom)
}
export function readUsualKnown($: EngineInterface): Promise<Record<string, Usual>> {
  return read($, usualAtom)
}
export function readAvatarsShown($: EngineInterface): Promise<Record<string, string>> {
  return read($, avatarsAtom)
}
export function readAnnounced($: EngineInterface): Promise<Record<string, string[]>> {
  return read($, announcedAtom)
}
export function readUnreachable($: EngineInterface): Promise<string[]> {
  return read($, unreachableAtom)
}
export function readPoll($: EngineInterface): Promise<PollState> {
  return read($, pollAtom)
}
/** The start of a ticket's link, empty while no Jira site is set. */
export function readBrowse($: EngineInterface): Promise<string> {
  return read($, jiraAtom)
}

/** A mod loading takes its settings and forgets which pictures failed, so each is tried again. */
export async function startData($: EngineInterface, jiraSite: unknown): Promise<void> {
  await update($, jiraAtom, () => browseUrl(jiraSite))
  await update($, unreachableAtom, () => [])
}

/** Pins an MR; watching one this session raised keeps it raised, so it still wakes. */
export async function pinMr($: EngineInterface, parsed: Pinned, origin: 'raised' | 'watched'): Promise<void> {
  await update($, pinnedAtom, list => {
    const was = list.find(one => pinKey(one) === pinKey(parsed))
    return [...list.filter(one => one !== was), { ...parsed, origin: was?.origin === 'raised' ? 'raised' : origin }]
  })
}

/** Takes the pins named by key off the list. */
export async function unpinKeys($: EngineInterface, keys: readonly string[]): Promise<void> {
  await update($, pinnedAtom, list => list.filter(each => !keys.includes(pinKey(each))))
}

// A write redraws every reader, changed or not, so each setter below writes only what differs from what the atom holds.
export async function setRows($: EngineInterface, rows: MrCard[]): Promise<void> {
  if (!isEqual(await read($, rowsAtom), rows)) {
    await update($, rowsAtom, () => rows)
  }
}
export async function setAnnounced($: EngineInterface, announced: Record<string, string[]>): Promise<void> {
  if (!isEqual(await read($, announcedAtom), announced)) {
    await update($, announcedAtom, () => announced)
  }
}
export async function setAvatars($: EngineInterface, kept: Record<string, string>): Promise<void> {
  if (!isEqual(await read($, avatarsAtom), kept)) {
    await update($, avatarsAtom, () => kept)
  }
}
export async function markUnreachable($: EngineInterface, urls: readonly string[]): Promise<void> {
  if (urls.length > 0) {
    await update($, unreachableAtom, list => [...list, ...urls])
  }
}

/** Adds what Jira said about tickets, and when it was asked. */
export async function mergeTickets($: EngineInterface, found: Record<string, Ticket>, at: number): Promise<void> {
  const known = await read($, ticketsAtom)
  if (!isEqual(known, { ...known, ...found })) {
    await update($, ticketsAtom, previous => ({ ...previous, ...found }))
  }
  await changePoll($, poll => ({ ...poll, ticketsAt: at }))
}

/** Adds the pipeline run times read per project, and when they were asked. */
export async function mergeUsual($: EngineInterface, usual: Record<string, Usual>, at: number): Promise<void> {
  const known = await read($, usualAtom)
  if (!isEqual(known, { ...known, ...usual })) {
    await update($, usualAtom, previous => ({ ...previous, ...usual }))
  }
  await changePoll($, poll => ({ ...poll, usualAt: at }))
}

export async function changePoll($: EngineInterface, change: (poll: PollState) => PollState): Promise<void> {
  const previous = await read($, pollAtom)
  if (!isEqual(previous, change(previous))) {
    await update($, pollAtom, change)
  }
}
