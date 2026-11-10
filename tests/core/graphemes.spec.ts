import { expect, test } from 'vitest'
import fc from 'fast-check'

import { graphemes } from '../../hooks/graphemes.ts'
import { textArb } from './arbitrary.ts'

// A family is three people joined by zero-width joiners, written as escapes so the joiners can be seen.
const FAMILY = '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}'

test('a flag, a skin-toned hand, a family and a letter with its accent are one character each', () => {
  expect(graphemes('🇺🇸🇬🇧')).toEqual(['🇺🇸', '🇬🇧'])
  expect(graphemes('a👍🏽b')).toEqual(['a', '👍🏽', 'b'])
  expect(graphemes(`${FAMILY}x`)).toEqual([FAMILY, 'x'])
  expect(graphemes('e\u{301}x')).toEqual(['e\u{301}', 'x'])
  expect(graphemes('a\r\nb')).toEqual(['a', '\r\n', 'b'])
})

test('plain text is one character per letter, and an empty text has none', () => {
  expect(graphemes('abc')).toEqual(['a', 'b', 'c'])
  expect(graphemes('山田 太郎')).toEqual(['山', '田', ' ', '太', '郎'])
  expect(graphemes('')).toEqual([])
})

test('the characters of a text joined again are the text, whatever it holds', () => {
  fc.assert(
    fc.property(textArb, text => {
      expect(graphemes(text).join('')).toBe(text)
    })
  )
})
