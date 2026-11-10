import { expect, test } from 'vitest'
import fc from 'fast-check'

import { isStripProps, lineAt, moved, reordered } from '../../hooks/pin-order.ts'

const id = (key: string): string => key

test('a line dragged down lands where it is dropped, and the others close up', () => {
  expect(moved(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
  expect(moved(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c'])
  expect(moved(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
})

test('a move keeps every item and puts the one moved where it was dropped', () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.string(), { minLength: 1, maxLength: 8 }).chain(list => fc.tuple(fc.constant(list), fc.nat({ max: list.length - 1 }), fc.nat({ max: list.length - 1 }))),
      ([list, from, to]) => {
        const after = moved(list, from, to)
        expect(after.toSorted()).toEqual(list.toSorted())
        expect(after[to]).toBe(list[from])
      }
    )
  )
})

test('a pointer past either end of the strip is over its first or last line', () => {
  expect(lineAt(-3, 4)).toBe(0)
  expect(lineAt(1.6, 4)).toBe(1)
  expect(lineAt(9, 4)).toBe(3)
})

test('the pins named take that order in their own places, and every other pin stays put', () => {
  expect(reordered(['a', 'x', 'b', 'c'], ['c', 'a', 'b'], id)).toEqual(['c', 'x', 'a', 'b'])
  // A pin unpinned while the drag was under way is not put back, and one named twice moves once.
  expect(reordered(['a', 'b'], ['gone', 'b', 'b', 'a'], id)).toEqual(['b', 'a'])
})

test('a reorder never adds or loses a pin', () => {
  fc.assert(
    fc.property(fc.uniqueArray(fc.string(), { maxLength: 8 }), fc.array(fc.string(), { maxLength: 8 }), (list, order) => {
      expect(reordered(list, order, id).toSorted()).toEqual(list.toSorted())
    })
  )
})

test('only lines of keys and labels pass as what a strip sent', () => {
  expect(isStripProps({ lines: [{ key: 'k', label: '!1 Fix' }] })).toBe(true)
  expect(isStripProps({ lines: [] })).toBe(true)
  expect(isStripProps({ lines: [{ key: 1, label: '!1' }] })).toBe(false)
  expect(isStripProps({ order: ['k'] })).toBe(false)
  expect(isStripProps(null)).toBe(false)
})
