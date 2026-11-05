import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { quietly } from './failures'

// What the person chose in the pane: which cards are open, which fold, which tab, which MR is read whole. The engine reads
// an atom only in the file that declares it, so everything that reads or writes these goes through the functions below.
const expandedAtom = atom({ plugin: 'gitlab-ci', key: 'expanded' } as const, [])
const personAtom = atom({ plugin: 'gitlab-ci', key: 'person' } as const, {})
const foldsAtom = atom({ plugin: 'gitlab-ci', key: 'folds' } as const, [])
const repoFilterAtom = atom({ plugin: 'gitlab-ci', key: 'repoFilter' } as const, '')
const tabAtom = atom({ plugin: 'gitlab-ci', key: 'tab' } as const, 'mine')
const readingAtom = atom({ plugin: 'gitlab-ci', key: 'reading' } as const, '')
const wakeAtom = atom({ plugin: 'gitlab-ci', key: 'wake' } as const, true)

/** What the pane draws from; reading it here makes the pane redraw when any of it changes. */
export async function drawnChoices($: EngineInterface) {
  const [expanded, chosen, folds, repoFilter, tab, page, isWaking] = await Promise.all([
    read($, expandedAtom),
    read($, personAtom),
    read($, foldsAtom),
    read($, repoFilterAtom),
    read($, tabAtom),
    read($, readingAtom),
    read($, wakeAtom),
  ])
  return { expanded, chosen, folds, repoFilter, tab, page, isWaking }
}

export function readTab($: EngineInterface): Promise<string> {
  return read($, tabAtom)
}
/** The card key of the MR read whole, or empty. */
export function readPage($: EngineInterface): Promise<string> {
  return read($, readingAtom)
}
export function readWake($: EngineInterface): Promise<boolean> {
  return read($, wakeAtom)
}

export function setTab($: EngineInterface, tab: 'mine' | 'inbox'): Promise<void> {
  return update($, tabAtom, () => tab).then(() => undefined)
}
export function setPage($: EngineInterface, key: string): Promise<void> {
  return update($, readingAtom, () => key).then(() => undefined)
}

/** Closes the page of the MR `key` and the folds it had open. */
export async function closePage($: EngineInterface, key: string): Promise<void> {
  await update($, readingAtom, () => '')
  await update($, foldsAtom, list => list.filter(id => !id.startsWith(`${key}#`)))
}

const toggled = (list: string[], key: string): string[] => (list.includes(key) ? list.filter(one => one !== key) : [...list, key])

/** Opens or closes a row (or `drafts`) on what blocks it, never on one person's comments. */
export function toggle($: EngineInterface, key: string): void {
  quietly(
    $,
    Promise.all([
      update($, expandedAtom, list => toggled(list, key)),
      update($, personAtom, ({ [key]: _, ...rest }) => rest),
    ])
  )
}

/** Opens or closes one `<details>` fold, named `<row key>#<where>`, against how GitLab first shows it. */
export function toggleFold($: EngineInterface, id: string): void {
  quietly($, update($, foldsAtom, list => toggled(list, id)))
}

/** Opens a row on one person's comments alone; asked again for the same person, closes it. */
export async function showPerson($: EngineInterface, key: string, username: string): Promise<void> {
  const [expanded, people] = await Promise.all([read($, expandedAtom), read($, personAtom)])
  if (expanded.includes(key) && people[key] === username) {
    await update($, expandedAtom, list => list.filter(one => one !== key))
    await update($, personAtom, ({ [key]: _, ...rest }) => rest)
    return
  }
  await update($, personAtom, previous => ({ ...previous, [key]: username }))
  await update($, expandedAtom, list => (list.includes(key) ? list : [...list, key]))
}

/** Narrows the list to one repo; the same repo again, or none, shows them all. */
export function filterRepo($: EngineInterface, project: string): void {
  quietly($, update($, repoFilterAtom, current => (current === project ? '' : project)))
}

export function toggleWake($: EngineInterface): void {
  quietly($, update($, wakeAtom, value => !value))
}

/**
 * After a read: a row merged or closed since it was opened stays out of what is drawn. Gives whether the MR read whole is
 * gone, which has left its page.
 */
export async function forgetGone($: EngineInterface, isShown: (key: string) => boolean): Promise<boolean> {
  await update($, expandedAtom, list => list.filter(key => key === 'drafts' || key === 'more' || isShown(key)))
  await update($, personAtom, people => Object.fromEntries(Object.entries(people).filter(([key]) => isShown(key))))
  await update($, foldsAtom, list => list.filter(id => isShown(id.split('#')[0] ?? '')))
  const page = await read($, readingAtom)
  if (page !== '' && !isShown(page)) {
    await update($, readingAtom, () => '')
    return true
  }
  return false
}
