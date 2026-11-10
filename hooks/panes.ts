import { atom, read, update } from 'claude-code'
import type { EngineInterface, UiScrollArgs } from 'claude-code'

import { closePage, readPage, readTab, setPage, setTab, showInbox } from './choices'
import { readRows } from './data'
import { ensureDetail } from './detail'
import { quietly } from './failures'
import { inboxNews } from './inbox'
import { nextDraw, rowDrawn } from './in-flight'
import { titleKey } from './drawing'
import { inboxBand } from './pane-model'

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

// Whether a surface drew the pane at the last tick. The engine says nothing when the person closes a pane, so the tick asks
// and keeps the answer here, written only when it changes, for the band above the prompt to redraw by.
const paneDrawnAtom = atom({ plugin: 'gitlab-pane', key: 'paneDrawn' } as const, false)

/**
 * Whether a surface draws the pane now, kept for the band. The engine keeps the record (`$.ui.panes()`), so a pane that
 * sits open and quiet, and so is never asked to draw again, still counts; one the person closed, or that waits undrawn
 * on a terminal too narrow for it, does not.
 */
export async function notePaneDrawn($: EngineInterface): Promise<boolean> {
  const isDrawn = (await $.ui.panes()).some(pane => pane.id === PANE_ID && pane.isPlaced && pane.isShown)
  if ((await read($, paneDrawnAtom)) !== isDrawn) {
    await update($, paneDrawnAtom, () => isDrawn)
  }
  return isDrawn
}

/** The band above the prompt's words, or null to leave it to a survey or whatever else draws there (`inboxBand`). */
export async function bandOf($: EngineInterface, hasSurvey: boolean): Promise<string | null> {
  const [isPaneDrawn, page, news] = await Promise.all([read($, paneDrawnAtom), readPage($), inboxNews($)])
  return inboxBand({ count: news.count, isPaneDrawn, isPageOpen: page !== '', hasSurvey })
}

/**
 * The band's press: the pane, open on the Inbox tab, which says the count from then on in the band's place. The band goes
 * at once; the caller then runs a tick, after any tick already out, so a tick that asked the engine before the pane
 * opened cannot leave the band beside the tab.
 */
export async function openInbox($: EngineInterface): Promise<void> {
  await showInbox($)
  await openPane($)
  await notePaneDrawn($)
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
 * Opens one MR whole on a page of its own, drawn alone over the tab it was opened from, on one person's comments when
 * `username` names them. The list moves to its top first: the desktop tells the engine where its buttons sit only when
 * its window moves, so a page opened after that leaves the engine knowing where the card's title is for the way back.
 */
export function openReading($: EngineInterface, key: string, username = ''): void {
  quietly(
    $,
    scrollPane($, { to: 'start' })
      .then(() => setPage($, key, username))
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
      const landed = nextDraw()
      const refused = await scrollPane($, { to: { key: titleKey(row) }, block: 'start' })
      if (refused.startsWith('no element')) {
        // Scrolling the page told the engine where the page's buttons sit; a move tells it the list's.
        await setGoingBack($, 'moving the window for the desktop to report the list')
        const reported = nextDraw()
        await scrollPane($, { to: rowDrawn() > 0 ? 'start' : 'end' })
        await Promise.race([reported, $.clock.sleep(2000)])
        await scrollPane($, { to: { key: titleKey(row) }, block: 'start' })
      } else if (refused === '') {
        // That scroll went to where the title sat before the page opened. The move had the desktop measure the list as it
        // is now, so a second one corrects for anything above the card that changed height while the page was open.
        await setGoingBack($, 'correcting for rows that changed above the card')
        await Promise.race([landed, $.clock.sleep(2000)])
        await scrollPane($, { to: { key: titleKey(row) }, block: 'start' })
      }
      await setGoingBack($, 'done')
    })().catch((error: unknown) => setGoingBack($, `failed: ${error instanceof Error ? error.message : String(error)}`))
  )
}
