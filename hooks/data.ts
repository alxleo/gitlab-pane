import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { browseUrl } from './jira.ts'
import { pinKey } from './mr-url.ts'

import type { HostFeatures, MrCard, Pinned, PollState, Ticket, Usual } from '../types'

// What GitLab, Jira and avatar fetches gave, and the polling's bookkeeping. The engine reads an atom only in the file that
// declares it, so everything that reads or writes these goes through the functions below.
const pinnedAtom = atom({ plugin: 'gitlab-ci', key: 'pinned' } as const, [])
const hostsAtom = atom({ plugin: 'gitlab-ci', key: 'hosts' } as const, ['gitlab.com'])
const featuresAtom = atom({ plugin: 'gitlab-ci', key: 'features' } as const, {})
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

/** What the pane draws from; reading it here makes the pane redraw when any of it changes. */
export async function drawnData($: EngineInterface) {
  const [pinned, rows, tickets, usual, avatars, poll, browse] = await Promise.all([
    read($, pinnedAtom),
    read($, rowsAtom),
    read($, ticketsAtom),
    read($, usualAtom),
    read($, avatarsAtom),
    read($, pollAtom),
    read($, jiraAtom),
  ])
  return { pinned, rows, tickets, usual, avatars, poll, browse }
}

export function readPinned($: EngineInterface): Promise<Pinned[]> {
  return read($, pinnedAtom)
}
/** The GitLab hosts the settings name, home first. */
export function readHosts($: EngineInterface): Promise<string[]> {
  return read($, hostsAtom)
}
/** What each probed host's schema has. */
export function readFeaturesKnown($: EngineInterface): Promise<Record<string, HostFeatures>> {
  return read($, featuresAtom)
}
export function setFeatures($: EngineInterface, host: string, features: HostFeatures): Promise<void> {
  return update($, featuresAtom, known => ({ ...known, [host]: features })).then(() => undefined)
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

/** A mod loading takes its settings, and forgets which pictures failed and what each host's schema had, so each is tried again. */
export async function startData($: EngineInterface, jiraSite: unknown, hosts: readonly string[]): Promise<void> {
  await update($, jiraAtom, () => browseUrl(jiraSite))
  await update($, hostsAtom, () => [...hosts])
  await update($, featuresAtom, () => ({}))
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

export function setRows($: EngineInterface, rows: MrCard[]): Promise<void> {
  return update($, rowsAtom, () => rows).then(() => undefined)
}
export function setAnnounced($: EngineInterface, announced: Record<string, string[]>): Promise<void> {
  return update($, announcedAtom, () => announced).then(() => undefined)
}
export function setAvatars($: EngineInterface, kept: Record<string, string>): Promise<void> {
  return update($, avatarsAtom, () => kept).then(() => undefined)
}
export function markUnreachable($: EngineInterface, urls: readonly string[]): Promise<void> {
  return update($, unreachableAtom, list => [...list, ...urls]).then(() => undefined)
}

/** Adds what Jira said about tickets, and when it was asked. */
export async function mergeTickets($: EngineInterface, found: Record<string, Ticket>, at: number): Promise<void> {
  await update($, ticketsAtom, previous => ({ ...previous, ...found }))
  await update($, pollAtom, previous => ({ ...previous, ticketsAt: at }))
}

/** Adds the pipeline run times read for projects, by `host/group/project`. */
export async function mergeUsual($: EngineInterface, usual: Record<string, Usual>): Promise<void> {
  await update($, usualAtom, previous => ({ ...previous, ...usual }))
}

/** Records when a pass over the projects' run times ended. */
export async function markUsualRead($: EngineInterface, at: number): Promise<void> {
  await update($, pollAtom, previous => ({ ...previous, usualAt: at }))
}

export function changePoll($: EngineInterface, change: (poll: PollState) => PollState): Promise<void> {
  return update($, pollAtom, change).then(() => undefined)
}
