import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { isEqual } from './equal'
import { quietly } from './failures'
import { isLastTyped, typed } from './in-flight'
import { keptRepo } from './repo-filter'
import { keptSearch } from './search'

import type { Choices, SearchBox, Under } from '../types'

// What the person chose in the pane: which folds are open, which tab, which MR is read whole and on whom. All of it is one
// atom, so a drawing reads it once and a choice that touches two things redraws once. The engine reads an atom only in
// the file that declares it, so everything that reads or writes it goes through the functions below.
const choicesAtom = atom({ plugin: 'gitlab-pane', key: 'choices' } as const, {
  expanded: [],
  person: {},
  folds: [],
  repoFilter: '',
  tab: 'mine',
  reading: '',
  wake: true,
} satisfies Choices)

// What was searched for, apart from the choices: a key of its own reads empty in a session whose choices an older version kept.
// Written once typing pauses, and on Enter.
const searchAtom = atom({ plugin: 'gitlab-pane', key: 'search' } as const, '')

// What the box is drawn holding, which typing never changes, so a redraw while typing keeps what is typed (SearchBox).
const searchBoxAtom = atom({ plugin: 'gitlab-pane', key: 'searchBox' } as const, { drawn: '', round: 0 } satisfies SearchBox)

// What is open under one card: a person's say on it, or its ticket (Under). Its own key, as the search's is.
const underAtom = atom({ plugin: 'gitlab-pane', key: 'under' } as const, null)

/** How long typing pauses before the list follows it: long enough to finish a word, short enough to feel live. */
const TYPING_PAUSE_MS = 250

/** What the pane draws from; reading it here makes the pane redraw when any of it changes. */
export async function drawnChoices($: EngineInterface) {
  const [{ expanded, person, folds, repoFilter, tab, reading, wake }, search, searchBox, under] = await Promise.all([
    read($, choicesAtom),
    read($, searchAtom),
    read($, searchBoxAtom),
    read($, underAtom),
  ])
  return { expanded, chosen: person, folds, repoFilter, tab, page: reading, isWaking: wake, search, searchBox, under }
}

/** Typing in the search box: once it pauses, with nothing typed after, the list shows what `text` finds. */
export function typeSearch($: EngineInterface, text: string): void {
  const mark = typed('search')
  quietly(
    $,
    $.clock.sleep(TYPING_PAUSE_MS).then(() => (isLastTyped('search', mark) ? update($, searchAtom, () => keptSearch(text)).then(() => undefined) : undefined))
  )
}

/** Enter in the search box: what `text` finds at once, and the box drawn holding it. */
export function submitSearch($: EngineInterface, text: string): void {
  // A pause still to come would put back what was typed before Enter.
  typed('search')
  const kept = keptSearch(text)
  quietly($, Promise.all([update($, searchAtom, () => kept), update($, searchBoxAtom, box => ({ ...box, drawn: kept }))]))
}

/** ✕: ends the search and draws a new box, empty. */
export function clearSearch($: EngineInterface): void {
  typed('search')
  quietly($, Promise.all([update($, searchAtom, () => ''), update($, searchBoxAtom, box => ({ drawn: '', round: box.round + 1 }))]))
}

/**
 * Opens `kind` `id` under the card `card`, or closes it when it is the one open; whatever else was open under a card closes.
 * Gives what is open now.
 */
export function toggleUnder($: EngineInterface, card: string, kind: 'person' | 'ticket', id: string): Promise<Under> {
  return update($, underAtom, open => (open !== null && open.card === card && open.kind === kind && open.id === id ? null : { card, kind, id }))
}

export async function readTab($: EngineInterface): Promise<string> {
  return (await read($, choicesAtom)).tab
}
/** The card key of the MR read whole, or empty. */
export async function readPage($: EngineInterface): Promise<string> {
  return (await read($, choicesAtom)).reading
}
/** The cards whose threads are wanted: the MR read whole, and the one a person's say is open under. */
export async function readOpened($: EngineInterface): Promise<string[]> {
  const [{ reading }, under] = await Promise.all([read($, choicesAtom), read($, underAtom)])
  const cards = [...(reading !== '' ? [reading] : []), ...(under !== null && under.kind === 'person' ? [under.card] : [])]
  return [...new Set(cards)]
}
export async function readWake($: EngineInterface): Promise<boolean> {
  return (await read($, choicesAtom)).wake
}

function change($: EngineInterface, how: (choices: Choices) => Choices): Promise<void> {
  return update($, choicesAtom, how).then(() => undefined)
}

/**
 * Leaving the list for a page or the inbox, or closing the pane: the box comes back drawn holding what is searched for, as
 * typing paused on it, a new box under a new key. Typing not yet paused on goes with the box.
 */
export async function settleBox($: EngineInterface): Promise<void> {
  typed('search')
  const search = await read($, searchAtom)
  await update($, searchBoxAtom, box => (box.drawn === search ? box : { drawn: search, round: box.round + 1 }))
}

export async function setTab($: EngineInterface, tab: 'mine' | 'inbox'): Promise<void> {
  if (tab !== 'mine') {
    await settleBox($)
  }
  return change($, choices => ({ ...choices, tab }))
}
/** Opens the page of the MR `key`, on the comments of `username` alone, or whole when that is empty. */
export async function setPage($: EngineInterface, key: string, username: string): Promise<void> {
  await settleBox($)
  return change($, choices => ({ ...choices, reading: key, person: username !== '' ? { [key]: username } : {} }))
}

/** Widens the page from one person's comments to the whole MR. */
export function showWhole($: EngineInterface): void {
  quietly(
    $,
    change($, choices => ({ ...choices, person: {} }))
  )
}

/** Closes the page of the MR `key`, with the person it was on and the folds it had open. */
export function closePage($: EngineInterface, key: string): Promise<void> {
  return change($, choices => ({ ...choices, reading: '', person: {}, folds: choices.folds.filter(id => !id.startsWith(`${key}#`)) }))
}

/** Shows the Inbox tab, leaving any MR's page, with the person it was on and the folds it had open. */
export async function showInbox($: EngineInterface): Promise<void> {
  await settleBox($)
  return change($, choices => ({ ...choices, tab: 'inbox', reading: '', person: {}, folds: choices.folds.filter(id => !id.startsWith(`${choices.reading}#`)) }))
}

const toggled = (list: string[], key: string): string[] => (list.includes(key) ? list.filter(one => one !== key) : [...list, key])

/** Opens or closes a fold of the list: the drafts, the parked, the ready past the first few, all but this session's, or the merged. */
export function toggle($: EngineInterface, key: 'drafts' | 'parked' | 'more' | 'others' | 'merged'): void {
  quietly(
    $,
    change($, choices => ({ ...choices, expanded: toggled(choices.expanded, key) }))
  )
}

/** Opens or closes one `<details>` fold, named `<row key>#<where>`, against how GitLab first shows it. */
export function toggleFold($: EngineInterface, id: string): void {
  quietly(
    $,
    change($, choices => ({ ...choices, folds: toggled(choices.folds, id) }))
  )
}

/** Narrows the list to one repo, or with none shows them all. Picking the repo already picked keeps it. */
export function filterRepo($: EngineInterface, project: string): void {
  quietly(
    $,
    change($, choices => ({ ...choices, repoFilter: project }))
  )
}

export function toggleWake($: EngineInterface): void {
  quietly(
    $,
    change($, choices => ({ ...choices, wake: !choices.wake }))
  )
}

/**
 * After a read: an MR merged or closed since its page was opened takes its folds and page with it, and a repo picked whose
 * MRs are all gone (or the last repo besides it) takes the pick, so its coming back does not narrow the list by itself.
 * `projects` are the repos the open MRs are in. Gives whether the MR read whole is gone, which has left its page.
 */
export async function forgetGone($: EngineInterface, isShown: (key: string) => boolean, projects: ReadonlySet<string>): Promise<boolean> {
  const before = await read($, choicesAtom)
  const folds = before.folds.filter(id => isShown(id.split('#')[0] ?? ''))
  const isGone = before.reading !== '' && !isShown(before.reading)
  const person = isGone ? {} : before.person
  const repoFilter = keptRepo(before.repoFilter, projects)
  const next = { ...before, person, folds, repoFilter, reading: isGone ? '' : before.reading }
  // A read that finds nothing gone writes nothing, so it redraws nothing.
  if (!isEqual(next, before)) {
    await change($, choices => ({ ...choices, person, folds, repoFilter: keptRepo(choices.repoFilter, projects), reading: isGone ? '' : choices.reading }))
  }
  // What was open under a card goes with the card.
  const under = await read($, underAtom)
  if (under !== null && !isShown(under.card)) {
    await update($, underAtom, open => (open !== null && !isShown(open.card) ? null : open))
  }
  return isGone
}
