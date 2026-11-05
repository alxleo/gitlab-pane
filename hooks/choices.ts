import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { isEqual } from './equal'
import { quietly } from './failures'

import type { Choices } from '../types'

// What the person chose in the pane: which cards are open, which fold, which tab, which MR is read whole. All of it is one
// atom, so a drawing reads it once and a choice that touches two things redraws once. The engine reads an atom only in
// the file that declares it, so everything that reads or writes it goes through the functions below.
const choicesAtom = atom({ plugin: 'gitlab-ci', key: 'choices' } as const, {
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
export async function readWake($: EngineInterface): Promise<boolean> {
  return (await read($, choicesAtom)).wake
}

function change($: EngineInterface, how: (choices: Choices) => Choices): Promise<void> {
  return update($, choicesAtom, how).then(() => undefined)
}

export function setTab($: EngineInterface, tab: 'mine' | 'inbox'): Promise<void> {
  return change($, choices => ({ ...choices, tab }))
}
export function setPage($: EngineInterface, key: string): Promise<void> {
  return change($, choices => ({ ...choices, reading: key }))
}

/** Closes the page of the MR `key` and the folds it had open. */
export function closePage($: EngineInterface, key: string): Promise<void> {
  return change($, choices => ({ ...choices, reading: '', folds: choices.folds.filter(id => !id.startsWith(`${key}#`)) }))
}

const toggled = (list: string[], key: string): string[] => (list.includes(key) ? list.filter(one => one !== key) : [...list, key])

const without = (people: Record<string, string>, key: string): Record<string, string> =>
  Object.fromEntries(Object.entries(people).filter(([each]) => each !== key))

/** Opens or closes a row (or `drafts`) on what blocks it, never on one person's comments. */
export function toggle($: EngineInterface, key: string): void {
  quietly($, change($, choices => ({ ...choices, expanded: toggled(choices.expanded, key), person: without(choices.person, key) })))
}

/** Opens or closes one `<details>` fold, named `<row key>#<where>`, against how GitLab first shows it. */
export function toggleFold($: EngineInterface, id: string): void {
  quietly($, change($, choices => ({ ...choices, folds: toggled(choices.folds, id) })))
}

/** Opens a row on one person's comments alone; asked again for the same person, closes it. */
export function showPerson($: EngineInterface, key: string, username: string): Promise<void> {
  return change($, choices =>
    choices.expanded.includes(key) && choices.person[key] === username
      ? { ...choices, expanded: choices.expanded.filter(one => one !== key), person: without(choices.person, key) }
      : {
          ...choices,
          person: { ...choices.person, [key]: username },
          expanded: choices.expanded.includes(key) ? choices.expanded : [...choices.expanded, key],
        }
  )
}

/** Narrows the list to one repo; the same repo again, or none, shows them all. */
export function filterRepo($: EngineInterface, project: string): void {
  quietly($, change($, choices => ({ ...choices, repoFilter: choices.repoFilter === project ? '' : project })))
}

export function toggleWake($: EngineInterface): void {
  quietly($, change($, choices => ({ ...choices, wake: !choices.wake })))
}

/**
 * After a read: a row merged or closed since it was opened stays out of what is drawn. Gives whether the MR read whole is
 * gone, which has left its page.
 */
export async function forgetGone($: EngineInterface, isShown: (key: string) => boolean): Promise<boolean> {
  const before = await read($, choicesAtom)
  const expanded = before.expanded.filter(key => key === 'drafts' || key === 'more' || isShown(key))
  const person = Object.fromEntries(Object.entries(before.person).filter(([key]) => isShown(key)))
  const folds = before.folds.filter(id => isShown(id.split('#')[0] ?? ''))
  const isGone = before.reading !== '' && !isShown(before.reading)
  const next = { ...before, expanded, person, folds, reading: isGone ? '' : before.reading }
  // A read that finds nothing gone writes nothing, so it redraws nothing.
  if (!isEqual(next, before)) {
    await change($, choices => ({ ...choices, expanded, person, folds, reading: isGone ? '' : choices.reading }))
  }
  return isGone
}
