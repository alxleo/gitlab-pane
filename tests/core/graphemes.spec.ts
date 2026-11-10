import { expect, test } from 'vitest'
import fc from 'fast-check'

import { cut, leading, shorten } from '../../hooks/graphemes.ts'
import { textArb } from './arbitrary.ts'

// A family is three people joined by zero-width joiners, written as escapes so the joiners can be seen.
const FAMILY = '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}'
/** One letter and `marks` combining acute accents: one character a person sees, and `marks + 1` UTF-16 units. */
const marked = (marks: number, letter = 'a') => `${letter}${'\u{301}'.repeat(marks)}`
const FOREVER = Number.POSITIVE_INFINITY

test('a flag, a skin-toned hand, a family and a letter with its accent are each one character to cut', () => {
  expect(cut('🇺🇸🇬🇧', 1, FOREVER)).toBe('🇺🇸')
  expect(cut('a👍🏽b', 2, FOREVER)).toBe('a👍🏽')
  expect(cut(`${FAMILY}x`, 1, FOREVER)).toBe(FAMILY)
  expect(cut('e\u{301}x', 1, FOREVER)).toBe('e\u{301}')
  expect(cut('a\r\nb', 2, FOREVER)).toBe('a\r\n')
})

test('a character that does not fit whole is left out whole, never halved', () => {
  // A flag is four UTF-16 units, a letter outside the basic plane two.
  expect(cut('ab🇺🇸cd', 3, 5)).toBe('ab')
  expect(cut('ab🇺🇸cd', 3, 6)).toBe('ab🇺🇸')
  expect(cut('ab🇺🇸cd', 3, FOREVER)).toBe('ab🇺🇸')
  expect(cut('ab𠮷cd', 3, 3)).toBe('ab')
  expect(cut('ab𠮷cd', 3, 4)).toBe('ab𠮷')
  expect(cut(marked(500), 1, 100)).toBe('')
  expect(cut(marked(5), 1, 6)).toBe(marked(5))
  expect(cut('abc', 0, 10)).toBe('')
  expect(cut('abc', 10, 0)).toBe('')
})

test('marks add to the units a cut counts, so no character is longer than the ceiling', () => {
  expect(cut(`ab${marked(500)}cd`, 4, 50)).toBe('ab')
  expect(cut(marked(500).repeat(100), 100, 80).length).toBeLessThanOrEqual(80)
  // A megabyte is read only as far as the cut goes.
  expect(cut('a'.repeat(1_000_000), 5, 100)).toBe('aaaaa')
})

test('a text that fits is kept and one that does not ends in an ellipsis within its room', () => {
  expect(shorten('abc', 3)).toBe('abc')
  expect(shorten('abcd', 3)).toBe('ab…')
  expect(shorten('abcd', 1)).toBe('…')
  // Twenty flags are 80 units and fit; 21 do not, and 19 of them are kept beside the ellipsis.
  expect(shorten('🇺🇸'.repeat(20), 80)).toBe('🇺🇸'.repeat(20))
  expect(shorten('🇺🇸'.repeat(21), 80)).toBe(`${'🇺🇸'.repeat(19)}…`)
  expect(shorten(`${'x'.repeat(75)}🇺🇸tail`, 80)).toBe(`${'x'.repeat(75)}🇺🇸…`)
  expect(shorten(`${'x'.repeat(76)}🇺🇸tail`, 80)).toBe(`${'x'.repeat(76)}…`)
  // The marks of one character count against the room, so a character of a thousand units leaves nothing.
  expect(shorten(marked(1000), 80)).toBe('…')
  expect(shorten(`x${marked(1000)}`, 80)).toBe('x…')
})

test('the leading characters keep their own leading units, so an accent survives, a thousand marks do not and no code point is halved', () => {
  expect(leading('e\u{301}mile', 2, 4)).toEqual(['e\u{301}', 'm'])
  expect(leading('🇺🇸🇬🇧x', 2, 4)).toEqual(['🇺🇸', '🇬🇧'])
  expect(leading(marked(1000), 3, 4)).toEqual([marked(3)])
  expect(leading('abc', 0, 4)).toEqual([])
  expect(leading('', 2, 4)).toEqual([])
  expect(leading('a𠮷', 2, 2)).toEqual(['a', '𠮷'])
  // A flag cut to three units is its first letter, whole, and a letter of two units cut to one is nothing, not half.
  expect(leading('🇺🇸', 1, 3)).toEqual(['🇺'])
  expect(leading('😀', 1, 1)).toEqual([''])
})

test('what is cut is the start of the text, whole characters, within the count and the units asked', () => {
  const boundariesOf = (text: string): Set<number> => {
    const ends = new Set<number>([0])
    let at = 0
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
      at += segment.length
      ends.add(at)
    }
    return ends
  }
  fc.assert(
    fc.property(textArb, fc.integer({ min: 0, max: 30 }), fc.integer({ min: 0, max: 40 }), (text, count, ceiling) => {
      const out = cut(text, count, ceiling)
      expect(text.startsWith(out)).toBe(true)
      expect(boundariesOf(text).has(out.length)).toBe(true)
      expect(out.length).toBeLessThanOrEqual(ceiling)
      expect(cut(out, count, FOREVER)).toBe(out)
      expect(cut(text, count, ceiling)).toBe(out)
    })
  )
})
