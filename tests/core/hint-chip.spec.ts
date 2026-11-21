import { expect, test } from 'vitest'
import fc from 'fast-check'

import { HINT_DELAY_S, hintChip } from '../../hooks/hint-chip.ts'

test('a chip stays invisible until the pointer has rested a moment, then shows its words whole', () => {
  const chip = hintChip(['raised MRs wake Claude'], 'hint-wake')
  expect(HINT_DELAY_S).toBeGreaterThanOrEqual(0.5)
  expect(HINT_DELAY_S).toBeLessThan(1)
  expect(chip.source).toContain(`<g style='color-scheme:light dark' opacity='0'><set attributeName='opacity' to='1' begin='${HINT_DELAY_S}s'/>`)
  expect(chip.source).toContain('>raised MRs wake Claude</tspan>')
  expect(chip.rows).toBe(1)
})

test('two symbols that say the same words draw pictures of their own, so each waits from its own hover', () => {
  expect(hintChip(['approved'], 'hint-person-ines').source).not.toBe(hintChip(['approved'], 'hint-approved-1').source)
})

test('a chip is wide enough for its longest line and tall enough for all of them, and its box has the cells and rows to hold it', () => {
  fc.assert(
    fc.property(fc.array(fc.string({ minLength: 1, maxLength: 40 }), { minLength: 1, maxLength: 9 }), lines => {
      const chip = hintChip(lines, 'k')
      expect(chip.width).toBeGreaterThanOrEqual(Math.max(...lines.map(line => line.length)) * 7.5 + 14)
      expect(chip.cells * 7).toBeGreaterThanOrEqual(chip.width)
      expect(chip.height).toBe(20 + 15 * (lines.length - 1))
      expect(chip.rows * 20).toBeGreaterThanOrEqual(chip.height)
      expect(chip.source.split('<tspan ').length - 1).toBe(lines.length)
    })
  )
})

test('words from GitLab cannot become markup in a chip', () => {
  expect(hintChip(['<b>Ines</b>, approved'], 'k').source).toContain('&lt;b&gt;Ines&lt;/b&gt;, approved')
})
