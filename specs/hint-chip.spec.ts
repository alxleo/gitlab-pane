import { expect, test } from 'vitest'
import fc from 'fast-check'

import { HINT_ROOM } from '../hooks/drawing'
import { cellsOf } from '../hooks/graphemes'
import { HIDDEN, HINT_DELAY_MS, HINT_LINES, hintChip, isWaiting, regionStep, waitStep } from '../hooks/hint-chip'
import type { Wait } from '../hooks/hint-chip'
import { textArb } from './arbitrary'

/** The wait after a run of moments: whether the region was shown, and when. */
const run = (moments: readonly [boolean, number][]): Wait => moments.reduce<Wait>((wait, [isVisible, now]) => waitStep(wait, isVisible, now), HIDDEN)

/** The lines a description draws, none where it has nothing to say. */
const linesOf = (words: string | readonly string[]): string[] => hintChip(words)?.lines ?? []

/** Characters by their code points, so the ones that draw nothing can be seen here. */
const point = (...codes: number[]): string => String.fromCodePoint(...codes)

test('a description shows only once the pointer has rested on its symbol for the delay, a little over half a second', () => {
  expect(HINT_DELAY_MS).toBeGreaterThanOrEqual(500)
  expect(HINT_DELAY_MS).toBeLessThan(1000)
  expect(run([[true, 1_000]]).isShown).toBe(false)
  expect(
    run([
      [true, 1_000],
      [true, 1_000 + HINT_DELAY_MS - 1],
    ]).isShown
  ).toBe(false)
  expect(
    run([
      [true, 1_000],
      [true, 1_000 + HINT_DELAY_MS],
    ]).isShown
  ).toBe(true)
})

test('every rest waits again, so a symbol already seen does not flash its description as the pointer passes', () => {
  const seen = run([
    [true, 0],
    [true, HINT_DELAY_MS],
    [false, 5_000],
  ])
  expect(seen).toBe(HIDDEN)
  expect(waitStep(seen, true, 6_000).isShown).toBe(false)
  expect(
    run([
      [true, 0],
      [true, HINT_DELAY_MS],
      [false, 5_000],
      [true, 6_000],
      [true, 6_000 + HINT_DELAY_MS - 1],
    ]).isShown
  ).toBe(false)
})

test('a pointer that leaves before the delay starts the wait over, whatever the moments', () => {
  fc.assert(
    fc.property(fc.array(fc.tuple(fc.boolean(), fc.nat({ max: 10_000 })), { maxLength: 30 }), steps => {
      const moments = steps.reduce<[boolean, number][]>((all, [isVisible, gap]) => [...all, [isVisible, (all.at(-1)?.[1] ?? 0) + gap]], [])
      const wait = run(moments)
      // Shown only when the visible moments since the last hidden one span the delay.
      const lastHidden = moments.findLastIndex(([isVisible]) => !isVisible)
      const since = moments[lastHidden + 1]?.[1]
      const end = moments.at(-1)?.[1]
      expect(wait.isShown).toBe(since !== undefined && end !== undefined && end - since >= HINT_DELAY_MS)
      expect(isWaiting(wait)).toBe(since !== undefined && !wait.isShown)
    })
  )
})

test('nothing changes while a region stays as it is, so it asks for no redraw of its own', () => {
  const shown = run([
    [true, 0],
    [true, HINT_DELAY_MS],
  ])
  expect(waitStep(shown, true, 99_999)).toBe(shown)
  expect(waitStep(HIDDEN, false, 1)).toBe(HIDDEN)
  const waiting = run([[true, 0]])
  expect(waitStep(waiting, true, HINT_DELAY_MS - 1)).toBe(waiting)
})

test("a description's box has a cell across for each of its widest line's, and the room either side, and a row a line", () => {
  expect(hintChip('opens the MR')).toEqual({ lines: ['opens the MR'], cells: 14, rows: 1 })
  expect(hintChip(['2 stages passed', 'e2e · running'])).toEqual({ lines: ['2 stages passed', 'e2e · running'], cells: 17, rows: 2 })
  // Wide letters take two cells each, so a name in them is not cut short by the box.
  expect(hintChip(point(0x674e, 0x5c0f, 0x9f8d))?.cells).toBe(8)
})

test('a description from GitLab draws as lines of words: nothing unseen, no box past the room, at most so many lines', () => {
  expect(linesOf(`build${point(1)} ·\n failed`)).toEqual(['build · failed'])
  // A right-to-left override or a zero-width space could turn a name around.
  expect(linesOf(`${point(0x202e)}xx${point(0x200b)}yy`)).toEqual(['xxyy'])
  // The joiner that spells an emoji and the tags that spell a flag stay.
  const coder = point(0x1f469, 0x200d, 0x1f4bb)
  const flag = point(0x1f3f4, 0xe0067, 0xe0062, 0xe0073, 0xe0063, 0xe0074, 0xe007f)
  expect(linesOf([coder, flag])).toEqual([coder, flag])
  // Letters drawn blank say nothing either.
  expect(linesOf([point(0x2800, 0x2800), point(0x3164)])).toEqual([])
  // Words that are all unseen marks say nothing, so the symbol draws without a description.
  expect(hintChip(`${point(1)}${point(0x202e)}`)).toBeNull()
  expect(cellsOf(linesOf('x'.repeat(300))[0] ?? '')).toBe(HINT_ROOM)
  // Cut by the cells a line takes, so a name in wide letters fits the same box.
  expect(hintChip(point(0x674e).repeat(60))?.cells).toBeLessThanOrEqual(HINT_ROOM + 2)
  const stages = linesOf(Array.from({ length: 40 }, (_, i) => `stage ${i} · failed`))
  expect(stages).toHaveLength(HINT_LINES)
  expect(stages.at(-1)).toBe(`and ${40 - HINT_LINES + 1} more`)
  fc.assert(
    fc.property(fc.array(fc.oneof(fc.string(), fc.string({ unit: 'grapheme' }), textArb), { maxLength: 50 }), words => {
      const chip = hintChip(words)
      if (chip === null) {
        return
      }
      expect(chip.lines.length).toBeGreaterThan(0)
      expect(chip.lines.length).toBeLessThanOrEqual(HINT_LINES)
      expect(chip.cells).toBeLessThanOrEqual(HINT_ROOM + 2)
      expect(chip.rows).toBe(chip.lines.length)
      for (const line of chip.lines) {
        expect(cellsOf(line)).toBeLessThanOrEqual(HINT_ROOM)
        expect(line).not.toMatch(/\p{Cc}/u)
        expect(line).not.toBe('')
      }
    })
  )
})

test("a region's size tells it whether its box shows: it starts its clock when shown, and stops it once the words show or it hides", () => {
  const shown = { columns: 14, rows: 1 }
  const hidden = { columns: 0, rows: 0 }
  const first = regionStep(HIDDEN, shown, 1_000)
  expect(first).toEqual({ wait: { since: 1_000, isShown: false }, tick: 'start' })
  expect(regionStep(first.wait, shown, 1_100).tick).toBe('keep')
  expect(regionStep(first.wait, shown, 1_000 + HINT_DELAY_MS)).toEqual({ wait: { since: 1_000, isShown: true }, tick: 'stop' })
  expect(regionStep(first.wait, hidden, 1_200)).toEqual({ wait: HIDDEN, tick: 'stop' })
  // Laid out with no width or no height, the box is hidden whatever the other says.
  expect(regionStep(HIDDEN, { columns: 14, rows: 0 }, 1).wait).toBe(HIDDEN)
  expect(regionStep(HIDDEN, { columns: 0, rows: 1 }, 1).wait).toBe(HIDDEN)
  expect(regionStep(HIDDEN, hidden, 1)).toEqual({ wait: HIDDEN, tick: 'keep' })
})
