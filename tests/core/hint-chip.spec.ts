import { expect, test } from 'vitest'
import fc from 'fast-check'

import { HINT_ROOM } from '../../hooks/drawing.ts'
import { cellsOf } from '../../hooks/graphemes.ts'
import { HIDDEN, HINT_DELAY_MS, HINT_LINES, hintChip, isWaiting, regionStep, waitStep } from '../../hooks/hint-chip.ts'
import type { Wait } from '../../hooks/hint-chip.ts'
import { textArb } from './arbitrary.ts'

/** The wait after a run of moments: whether the region was shown, and when. */
const run = (moments: readonly [boolean, number][]): Wait => moments.reduce<Wait>((wait, [isVisible, now]) => waitStep(wait, isVisible, now), HIDDEN)

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
  expect(hintChip('李小龍').cells).toBe(8)
})

test('a description from GitLab draws as lines of words: nothing unseen, no box past the room, at most so many lines', () => {
  expect(hintChip(`build\u0001 ·\n failed`).lines).toEqual(['build · failed'])
  // A right-to-left override or a zero-width space could turn a name around; the joiners that spell an emoji stay.
  expect(hintChip('‮xx​yy').lines).toEqual(['xxyy'])
  expect(hintChip('👩‍💻').lines).toEqual(['👩‍💻'])
  // Words that are all unseen marks say nothing, so the symbol draws without a description.
  expect(hintChip('\u0001‮').lines).toEqual([])
  expect(cellsOf(hintChip('x'.repeat(300)).lines[0] ?? '')).toBe(HINT_ROOM)
  // Cut by the cells a line takes, so a name in wide letters fits the same box.
  expect(hintChip('李'.repeat(60)).cells).toBeLessThanOrEqual(HINT_ROOM + 2)
  const stages = hintChip(Array.from({ length: 40 }, (_, i) => `stage ${i} · failed`))
  expect(stages.lines).toHaveLength(HINT_LINES)
  expect(stages.lines.at(-1)).toBe(`and ${40 - HINT_LINES + 1} more`)
  expect(stages.rows).toBe(HINT_LINES)
  fc.assert(
    fc.property(fc.array(fc.oneof(fc.string(), fc.string({ unit: 'grapheme' }), textArb), { maxLength: 50 }), words => {
      const chip = hintChip(words)
      expect(chip.lines.length).toBeLessThanOrEqual(HINT_LINES)
      expect(chip.cells).toBeLessThanOrEqual(HINT_ROOM + 2)
      for (const line of chip.lines) {
        expect(cellsOf(line)).toBeLessThanOrEqual(HINT_ROOM)
        expect(line).not.toMatch(/\p{Cc}|(?![‌‍])\p{Cf}/u)
        expect(line).not.toBe('')
      }
      expect(chip.rows).toBe(Math.max(1, chip.lines.length))
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
