// A symbol's description as a small picture: a chip in the pane's text colour, its words in the page's, kept invisible for
// a moment after it is drawn. The engine reveals a hidden box the moment the pointer touches its symbol and offers no
// delay, so the delay is the picture's own: a pointer passing by is gone before the chip shows. Pure, on plain data.
import { PAGE } from './status.ts'
import type { Shades } from './status.ts'
import { raw, svg } from './svg.ts'
import type { SvgSource } from './svg.ts'

/**
 * Seconds a chip stays invisible once drawn, as tooltips commonly wait half a second to most of one. 1.5 s read as slow in
 * the desktop app; half a second read as instant only while symbols with the same words shared a picture (see `hintChip`).
 */
export const HINT_DELAY_S = 0.6

/** The pane's text, as the desktop paints it in each theme. */
const INK: Shades = { light: '#191919', dark: '#efefef' }

/** A colour as the theme picks it. */
const shade = ({ light, dark }: Shades): string => `light-dark(${light},${dark})`

/**
 * CSS pixels: a one-line chip's height, each further line's, its words' size, the room either side of them, and what a
 * letter takes at most, so the words fit.
 */
const HEIGHT = 20
const LINE = 15
const SIZE = 12
const PAD = 7
const LETTER = 7.5

/** About what a cell of the pane takes across and down, in CSS pixels; a chip's box is given the cells its picture needs. */
const CELL = 7
const ROW = 20

export type HintChip = {
  /** What it says, a line each: its `alt`, joined. */
  lines: readonly string[]
  /** CSS pixels. */
  width: number
  height: number
  /** Cells across the box that holds it needs, so the picture is drawn at its own width, and rows down, to sit above its symbol. */
  cells: number
  rows: number
  source: SvgSource
}

/**
 * `lines` in a chip that follows the app's theme and shows `HINT_DELAY_S` after it is drawn. About 450 characters for one
 * line. `key` makes each symbol's picture its own: the desktop keeps one copy of a picture, and its clock, for every place that
 * draws the same source, so a second symbol with the same words showed its chip at once, its wait already spent on the first.
 */
export function hintChip(lines: readonly string[], key: string): HintChip {
  const width = Math.ceil(Math.max(0, ...lines.map(line => line.length)) * LETTER) + 2 * PAD
  const height = HEIGHT + LINE * Math.max(0, lines.length - 1)
  const text = lines.map((line, i) => svg`<tspan x='${PAD}' y='${14 + i * LINE}'>${line}</tspan>`)
  return {
    lines,
    width,
    height,
    cells: Math.ceil(width / CELL) + 1,
    rows: Math.ceil(height / ROW),
    // Only the desktop draws a chip, and it knows light-dark(), so each paint is the one style, with no fallback shade.
    source: svg`<svg xmlns='http://www.w3.org/2000/svg' id='${key}' width='${width}' height='${height}'><g style='color-scheme:light dark' opacity='0'><set attributeName='opacity' to='1' begin='${HINT_DELAY_S}s'/><rect width='${width}' height='${height}' rx='4' style='fill:${shade(INK)}'/><text font-family='system-ui' font-size='${SIZE}' style='fill:${shade(PAGE)}'>${raw(text)}</text></g></svg>`,
  }
}
