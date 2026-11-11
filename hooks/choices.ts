import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { isEqual } from './equal'
import { quietly } from './failures'
import { keptRepo } from './repo-filter'

import type { Choices } from '../types'

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

/** What the pane draws from; reading it here makes the pane redraw when any of it changes. */
export async function drawnChoices($: EngineInterface) {
  const { expanded, person, folds, repoFilter, tab, reading, wake } = await read($, choicesAtom)
  return { expanded, chosen: person, folds, repoFilter, tab, page: reading, isWaking: wake }
}

export async function readTab($: EngineInterface): Promise<string> {
  return (await read($, choicesAtom)).tab
}
/** The card key of the MR read whole, or empty. */
export async function readPage($: EngineInterface): Promise<string> {
  return (await read($, choicesAtom)).reading
}
/** The card key of the MR read whole, alone or none: the one whose description and threads are wanted. */
export async function readOpened($: EngineInterface): Promise<string[]> {
  const { reading } = await read($, choicesAtom)
  return reading !== '' ? [reading] : []
}
export async function readWake($: EngineInterface): Promise<boolean> {
  return (await read($, choicesAtom)).wake
}

function change($: EngineInterface, how: (choices: Choices) => Choices): Promise<void> {
  return update($, choicesAtom, how).then(() => undefined)
}

export function setTab($: EngineInterface, tab: 'mine' | 'inbox'): Promise<void> {
  return change($, choices => ({ ...choices, tab }))
}
/** Opens the page of the MR `key`, on the comments of `username` alone, or whole when that is empty. */
export function setPage($: EngineInterface, key: string, username: string): Promise<void> {
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
export function showInbox($: EngineInterface): Promise<void> {
  return change($, choices => ({ ...choices, tab: 'inbox', reading: '', person: {}, folds: choices.folds.filter(id => !id.startsWith(`${choices.reading}#`)) }))
}

const toggled = (list: string[], key: string): string[] => (list.includes(key) ? list.filter(one => one !== key) : [...list, key])

/** Opens or closes a fold of the list: the drafts, the parked, the ready past the first few, or all but this session's. */
export function toggle($: EngineInterface, key: 'drafts' | 'parked' | 'more' | 'others'): void {
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
  return isGone
}
