import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { isEqual } from './equal.ts'
import { browseUrl } from './jira.ts'
import { pinKey } from './mr-url.ts'

import type { MrCard, Pinned, PollState, ReadClock, Role, Ticket, Usual } from '../types'

// What GitLab, Jira and avatar fetches gave, and the polling's bookkeeping. The engine reads an atom only in the file that
// declares it, so everything that reads or writes these goes through the functions below.
const pinnedAtom = atom({ plugin: 'gitlab-pane', key: 'pinned' } as const, [])
const hostsAtom = atom({ plugin: 'gitlab-pane', key: 'hosts' } as const, ['gitlab.com'])
const rowsAtom = atom({ plugin: 'gitlab-pane', key: 'rows' } as const, [])
const detailsAtom = atom({ plugin: 'gitlab-pane', key: 'details' } as const, {})
const ticketsAtom = atom({ plugin: 'gitlab-pane', key: 'tickets' } as const, {})
const usualAtom = atom({ plugin: 'gitlab-pane', key: 'usual' } as const, {})
const avatarsAtom = atom({ plugin: 'gitlab-pane', key: 'avatars' } as const, {})
const announcedAtom = atom({ plugin: 'gitlab-pane', key: 'announced' } as const, {})
const unreachableAtom = atom({ plugin: 'gitlab-pane', key: 'unreachable' } as const, [])
const jiraAtom = atom({ plugin: 'gitlab-pane', key: 'jira' } as const, '')
const roleAtom = atom({ plugin: 'gitlab-pane', key: 'role' } as const, 'idle' satisfies Role)
const pollAtom = atom({ plugin: 'gitlab-pane', key: 'poll' } as const, { fetchedAt: null, error: null, hosts: {} } satisfies PollState)
// Whether this session is reading GitLab now. Kept out of the store: only the session that reads can say so.
const readingAtom = atom({ plugin: 'gitlab-pane', key: 'reading' } as const, false)
// Not read by the drawing, so writing it redraws nothing.
const readsAtom = atom({ plugin: 'gitlab-pane', key: 'reads' } as const, {
  attemptedAt: null,
  failures: 0,
  ticketsAt: null,
  usualAt: null,
  adopted: '',
  refreshed: 0,
  inboxAt: null,
  inboxSeen: null,
} satisfies ReadClock)

/** What the pane draws from; reading it here makes the pane redraw when any of it changes. */
export async function drawnData($: EngineInterface) {
  const [pinned, rows, details, avatars, tickets, usual, poll, isReading, browse] = await Promise.all([
    read($, pinnedAtom),
    read($, rowsAtom),
    read($, detailsAtom),
    read($, avatarsAtom),
    read($, ticketsAtom),
    read($, usualAtom),
    read($, pollAtom),
    read($, readingAtom),
    read($, jiraAtom),
  ])
  return { pinned, rows, details, avatars, tickets, usual, poll, isReading, browse }
}

export function readPinned($: EngineInterface): Promise<Pinned[]> {
  return read($, pinnedAtom)
}
/** The GitLab hosts the settings name, home first. */
export function readHosts($: EngineInterface): Promise<string[]> {
  return read($, hostsAtom)
}
export function readRows($: EngineInterface): Promise<MrCard[]> {
  return read($, rowsAtom)
}
export function readDetails($: EngineInterface): Promise<Record<string, MrCard>> {
  return read($, detailsAtom)
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
export function readReads($: EngineInterface): Promise<ReadClock> {
  return read($, readsAtom)
}
export function readRole($: EngineInterface): Promise<Role> {
  return read($, roleAtom)
}
/** The start of a ticket's link, empty while no Jira site is set. */
export function readBrowse($: EngineInterface): Promise<string> {
  return read($, jiraAtom)
}

/** A mod loading takes its settings and forgets which pictures failed, so each is tried again. */
export async function startData($: EngineInterface, jiraSite: unknown, hosts: readonly string[]): Promise<void> {
  await update($, jiraAtom, () => browseUrl(jiraSite))
  await update($, hostsAtom, () => [...hosts])
  await update($, unreachableAtom, () => [])
  // A reload mid-read never reaches the read's own reset, and a session that follows never writes this.
  await update($, readingAtom, () => false)
}

/**
 * Pins an MR, last; one pinned already keeps its place, the order the person sees. Watching one this session raised keeps
 * it raised, so it still wakes.
 */
export async function pinMr($: EngineInterface, parsed: Pinned, origin: 'raised' | 'watched'): Promise<void> {
  await update($, pinnedAtom, list => {
    const was = list.find(one => pinKey(one) === pinKey(parsed))
    const pin: Pinned = { ...parsed, origin: was?.origin === 'raised' ? 'raised' : origin }
    return was !== undefined ? list.map(one => (one === was ? pin : one)) : [...list, pin]
  })
}

/** Takes the pins named by key off the list. */
export async function unpinKeys($: EngineInterface, keys: readonly string[]): Promise<void> {
  await update($, pinnedAtom, list => list.filter(each => !keys.includes(pinKey(each))))
}

// A write redraws every reader, changed or not, so each setter below writes only what differs from what the atom holds.
export async function setReading($: EngineInterface, isReading: boolean): Promise<void> {
  if ((await read($, readingAtom)) !== isReading) {
    await update($, readingAtom, () => isReading)
  }
}
export async function setRows($: EngineInterface, rows: MrCard[]): Promise<void> {
  if (!isEqual(await read($, rowsAtom), rows)) {
    await update($, rowsAtom, () => rows)
  }
}
/** Keeps the whole cards of the MRs `isWanted` names and puts `card` among them, if given. */
export async function setDetails($: EngineInterface, isWanted: (key: string) => boolean, card?: MrCard): Promise<void> {
  const known = await read($, detailsAtom)
  const next = Object.fromEntries([...Object.entries(known), ...(card !== undefined ? [[card.key, card] as const] : [])].filter(([key]) => isWanted(key)))
  if (!isEqual(known, next)) {
    await update($, detailsAtom, () => next)
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
export async function setRole($: EngineInterface, role: Role): Promise<void> {
  if ((await read($, roleAtom)) !== role) {
    await update($, roleAtom, () => role)
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
  await changeReads($, reads => ({ ...reads, ticketsAt: at }))
}

/** Adds the pipeline run times read for projects, by `host/group/project`. */
export async function mergeUsual($: EngineInterface, usual: Record<string, Usual>): Promise<void> {
  const known = await read($, usualAtom)
  if (!isEqual(known, { ...known, ...usual })) {
    await update($, usualAtom, previous => ({ ...previous, ...usual }))
  }
}

/** Records when a pass over the projects' run times ended. */
export async function markUsualRead($: EngineInterface, at: number): Promise<void> {
  await changeReads($, reads => ({ ...reads, usualAt: at }))
}

/** What the footer says of the last read: written only when its words would change, as every write redraws the pane. */
export async function setPoll($: EngineInterface, poll: PollState): Promise<void> {
  if (!isEqual(await read($, pollAtom), poll)) {
    await update($, pollAtom, () => poll)
  }
}

export async function changeReads($: EngineInterface, change: (reads: ReadClock) => ReadClock): Promise<void> {
  const previous = await read($, readsAtom)
  if (!isEqual(previous, change(previous))) {
    await update($, readsAtom, change)
  }
}
