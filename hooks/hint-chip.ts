// What a symbol's description says, how much room it takes, and when it shows: the one rule every symbol follows, on
// plain data. The engine reveals a hidden box the moment the pointer touches its symbol and has no delay of its own, so the
// box holds a region (`hint-wait.tsx`) that hands `regionStep` its size and the time, and draws what it answers.
import { HINT_ROOM } from './drawing'
import { drawnLine, withoutInvisibleMarks } from './format'
import { cellsOf, shortenToCells } from './graphemes'

/**
 * Milliseconds the pointer rests on a symbol before its description shows, every time it comes back: tooltips commonly
 * wait half a second to most of one. 1.5 s read as slow in the desktop app, and 0.6 s as right.
 */
export const HINT_DELAY_MS = 600

/** How often a region that is waiting looks at the clock: the description shows at most this late. */
export const HINT_TICK_MS = 100

/** Lines a description draws at most; a longer list (a strip's stages) ends with how many more there are. */
export const HINT_LINES = 8

export type HintChip = {
  /** What it says, a line each, each one line of at most `HINT_ROOM` cells; at least one. */
  lines: string[]
  /** Cells across and rows down the box that holds it: its widest line and the room either side, and a row a line. */
  cells: number
  rows: number
}

/**
 * `words` as a description draws them: lines cleaned and cut to `HINT_ROOM` cells, a long list cut to `HINT_LINES`; `null`
 * when nothing is left to say, so the symbol draws alone rather than over an empty chip.
 */
export function hintChip(words: string | readonly string[]): HintChip | null {
  const every = (typeof words === 'string' ? [words] : words).map(each => shortenToCells(drawnLine(withoutInvisibleMarks(each)), HINT_ROOM)).filter(line => line !== '')
  const lines = every.length > HINT_LINES ? [...every.slice(0, HINT_LINES - 1), `and ${every.length - HINT_LINES + 1} more`] : every
  return lines.length > 0 ? { lines, cells: Math.max(...lines.map(cellsOf)) + 2, rows: lines.length } : null
}

/** Where a region's wait stands: since when it has been shown, `null` while hidden, and whether its words show. */
export type Wait = { since: number | null; isShown: boolean }

/** A region the pointer is not on. */
export const HIDDEN: Wait = { since: null, isShown: false }

/**
 * The wait after the region was laid out or its clock ticked at `now`: hidden, it starts over; shown, it counts from when it
 * was first shown, and its words show once `HINT_DELAY_MS` has passed. The same object back means nothing changed.
 */
export function waitStep(wait: Wait, isVisible: boolean, now: number): Wait {
  if (!isVisible) {
    return wait.since === null && !wait.isShown ? wait : HIDDEN
  }
  if (wait.since === null) {
    return { since: now, isShown: false }
  }
  return !wait.isShown && now - wait.since >= HINT_DELAY_MS ? { since: wait.since, isShown: true } : wait
}

/** Whether a region must look at the clock: shown, its words not yet. */
export const isWaiting = (wait: Wait): boolean => wait.since !== null && !wait.isShown

/** What a region does about its clock after a step: start it, stop it, or leave it as it is. */
export type Tick = 'start' | 'stop' | 'keep'

/**
 * A region's whole decision, as it is laid out (`columns` and `rows`, both 0 while its box is hidden) or its clock ticks: the
 * wait it now has, and what it does about its clock. The region draws its words when `wait.isShown`, and nothing else.
 */
export function regionStep(wait: Wait, size: { columns: number; rows: number }, now: number): { wait: Wait; tick: Tick } {
  const next = waitStep(wait, size.columns > 0 && size.rows > 0, now)
  const [was, is] = [isWaiting(wait), isWaiting(next)]
  return { wait: next, tick: was === is ? 'keep' : is ? 'start' : 'stop' }
}
