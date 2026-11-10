import { expect, test } from 'vitest'
import fc from 'fast-check'

import { cut, leading, shorten } from '../../hooks/graphemes.ts'
import { textArb } from './arbitrary.ts'

// A family is three people joined by zero-width joiners, written as escapes so the joiners can be seen.
const FAMILY = '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}'
// A person, a skin tone, a joiner and red hair: seven UTF-16 units, one character, and its second code point is no mark.
const PERSON = '\u{1F9D1}\u{1F3FD}\u{200D}\u{1F9B0}'
// A flag of black, five tag letters and the tag that cancels them: fourteen units, one character, ending in a tag.
const SCOTLAND = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}'
/** What ends an initial badly: a joiner that waits for a next code point, or a tag inside a tag sequence. */
const ENDS_IN_JOINER = /[\u{200D}\u{E0020}-\u{E007F}]$/u
const MARK = /^\p{M}$/u
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

test('a leading character over the size keeps its first code point and the marks that fit, so an accent survives, a thousand marks do not and a joined sequence is never left hanging', () => {
  expect(leading('e\u{301}mile', 2, 4)).toEqual(['e\u{301}', 'm'])
  expect(leading('🇺🇸🇬🇧x', 2, 4)).toEqual(['🇺🇸', '🇬🇧'])
  expect(leading(marked(1000), 3, 4)).toEqual([marked(3)])
  expect(leading('abc', 0, 4)).toEqual([])
  expect(leading('', 2, 4)).toEqual([])
  expect(leading('a𠮷', 2, 2)).toEqual(['a', '𠮷'])
  // A flag cut to three units is its first letter, whole, and a letter of two units cut to one is nothing, not half.
  expect(leading('🇺🇸', 1, 3)).toEqual(['🇺'])
  expect(leading('😀', 1, 1)).toEqual([''])
  // A person with a skin tone and red hair is its first code point: the next one is a skin tone, not a mark, and what would
  // follow it is a joiner that waits for more. A family is its first person, and a flag of black with a tag sequence its flag.
  expect(leading(PERSON, 1, 5)).toEqual(['\u{1F9D1}'])
  expect(leading(FAMILY, 1, 5)).toEqual(['\u{1F468}'])
  expect(leading(SCOTLAND, 1, 5)).toEqual(['\u{1F3F4}'])
  // A letter with a hundred marks keeps as many marks as fit after it, and a mark outside the basic plane takes two units.
  expect(leading(marked(100, 'e'), 1, 5)).toEqual([marked(4, 'e')])
  expect(leading(`a${'\u{1D165}'.repeat(3)}`, 1, 4)).toEqual([`a\u{1D165}`])
  // The marks end at the first code point that is none: the joiner stops them, though more marks follow it.
  expect(leading('e\u{301}\u{200D}\u{301}\u{301}\u{301}\u{301}', 1, 5)).toEqual(['e\u{301}'])
  // A character within the size stays whole, whatever ends it: only a cut character is made to end well.
  expect(leading('a\u{200D}', 1, 5)).toEqual(['a\u{200D}'])
  expect(leading(PERSON, 1, 7)).toEqual([PERSON])
})

test('a leading character is its whole self or a letter with its marks, and never ends in a joiner or a tag', () => {
  // Words made of what names and emoji are made of. No character here is both short enough to stay whole and ending in a
  // joiner, and none of the sizes reaches the fourteen units of the flag, so the one rule holds for every output.
  const partArb = fc.oneof(
    fc.constantFrom('a', 'é', '李', '\u{20BB7}', '👍🏽', '🇺🇸', PERSON, FAMILY, SCOTLAND),
    fc.tuple(fc.constantFrom('e', '\u{20BB7}'), fc.integer({ min: 0, max: 8 })).map(([letter, marks]) => marked(marks, letter))
  )
  const wordArb = fc.array(partArb, { maxLength: 6 }).map(parts => parts.join(''))
  const charactersOf = (text: string): string[] => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), ({ segment }) => segment)
  fc.assert(
    fc.property(wordArb, fc.integer({ min: 0, max: 6 }), fc.integer({ min: 1, max: 8 }), (text, count, size) => {
      const wholes = charactersOf(text).slice(0, count)
      const out = leading(text, count, size)
      expect(out).toHaveLength(wholes.length)
      out.forEach((piece, at) => {
        const whole = wholes[at] ?? ''
        expect(piece).not.toMatch(ENDS_IN_JOINER)
        expect(piece.length).toBeLessThanOrEqual(size)
        expect(whole.startsWith(piece)).toBe(true)
        if (whole.length <= size) {
          expect(piece).toBe(whole)
        } else {
          // Over the size: a first code point, then marks only, ended where the next code point is no mark or does not fit.
          const [, ...marks] = Array.from(piece)
          const next = Array.from(whole.slice(piece.length))[0] ?? ''
          expect(marks.every(mark => MARK.test(mark))).toBe(true)
          expect(piece.length + next.length > size || (piece !== '' && !MARK.test(next))).toBe(true)
        }
      })
    })
  )
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
