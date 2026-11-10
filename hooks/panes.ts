import { atom, read, update } from 'claude-code'
import type { EngineInterface, UiScrollArgs } from 'claude-code'

import { closePage, readPage, readTab, setPage, setTab } from './choices'
import { readRows } from './data'
import { ensureDetail } from './detail'
import { quietly } from './failures'
import { nextDraw, rowDrawn } from './in-flight'
import { titleKey } from './drawing'

import type { Scrolling } from '../types'

/** The pane's id; register.tsx names it again, since the engine reads a hook's matcher from that file alone. */
export const PANE_ID = 'gitlab-pane'

// Why the pane's last scroll did not move, and how far going back from a page got; /gitlab reports both.
const scrollingAtom = atom({ plugin: 'gitlab-pane', key: 'scrolling' } as const, { refused: '', goingBack: '' } satisfies Scrolling)

export function readScrolling($: EngineInterface): Promise<Scrolling> {
  return read($, scrollingAtom)
}

/** A mod loading starts with nothing to say about scrolling. */
export async function forgetScrolling($: EngineInterface): Promise<void> {
  await update($, scrollingAtom, () => ({ refused: '', goingBack: '' }))
}

function setRefused($: EngineInterface, refused: string): Promise<unknown> {
  return update($, scrollingAtom, previous => ({ ...previous, refused }))
}
function setGoingBack($: EngineInterface, goingBack: string): Promise<unknown> {
  return update($, scrollingAtom, previous => ({ ...previous, goingBack }))
}

/** The pane's title names the view shown, since it is the one line of the pane that never scrolls away. */
async function paneTitle($: EngineInterface): Promise<string> {
  const [tab, page, rows] = await Promise.all([readTab($), readPage($), readRows($)])
  const row = rows.find(each => each.key === page)
  return row !== undefined ? `GitLab · !${row.iid}` : tab === 'inbox' ? 'GitLab · Inbox' : 'GitLab · Mine'
}

/** Opens the pane, or retitles it for the view now shown. */
export async function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE_ID, title: await paneTitle($) })
}

/**
 * Whether a surface draws the pane now. The engine keeps the record (`$.ui.panes()`), so a pane that sits open and quiet,
 * and so is never asked to draw again, still counts; one the person closed, or that waits undrawn on a terminal too
 * narrow for it, does not.
 */
export async function isPaneDrawn($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === PANE_ID && pane.isPlaced && pane.isShown)
}

/** Shows the MR list (`mine`) or the inbox; only the open tab is drawn. */
export function openTab($: EngineInterface, tab: 'mine' | 'inbox'): void {
  quietly(
    $,
    setTab($, tab).then(() => openPane($))
  )
}

async function scrollPane($: EngineInterface, args: Omit<UiScrollArgs, 'in'>): Promise<string> {
  const result = await $.ui.scroll({ ...args, in: PANE_ID }).catch((error: unknown) => ({ deny: String(error) }))
  const refused = result.deny ?? ''
  await setRefused($, refused)
  return refused
}

/**
 * Opens one MR whole on a page of its own, drawn alone over the tab it was opened from. The list moves to its top
 * first: the desktop tells the engine where its buttons sit only when its window moves, so a page opened after that
 * leaves the engine knowing where the card's title is for the way back.
 */
export function openReading($: EngineInterface, key: string): void {
  quietly(
    $,
    scrollPane($, { to: 'start' })
      .then(() => setPage($, key))
      .then(() => openPane($))
      .then(() => ensureDetail($, key))
  )
}

/**
 * Back from an MR's page to its tab, scrolled to the card it was read from. `goingBack` in the scrolling state says how
 * far it got.
 */
export function leaveReading($: EngineInterface): void {
  quietly(
    $,
    (async () => {
      await setGoingBack($, 'started')
      const key = await readPage($)
      const row = (await readRows($)).find(each => each.key === key)
      const listed = nextDraw()
      await closePage($, key)
      await openPane($)
      await setGoingBack($, 'waiting for the list to draw')
      await listed
      if (row === undefined) {
        await setGoingBack($, 'done')
        return
      }
      // The list's drawing leaves only after this resumes; a scroll ahead of it would stop at the page's last row.
      await $.clock.sleep(50)
      const refused = await scrollPane($, { to: { key: titleKey(row) }, block: 'start' })
      if (refused.startsWith('no element')) {
        // Scrolling the page told the engine where the page's buttons sit; a move tells it the list's.
        await setGoingBack($, 'moving the window for the desktop to report the list')
        const reported = nextDraw()
        await scrollPane($, { to: rowDrawn() > 0 ? 'start' : 'end' })
        await Promise.race([reported, $.clock.sleep(2000)])
        await scrollPane($, { to: { key: titleKey(row) }, block: 'start' })
      }
      await setGoingBack($, 'done')
    })().catch((error: unknown) => setGoingBack($, `failed: ${error instanceof Error ? error.message : String(error)}`))
  )
}
