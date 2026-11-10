import { expect, test } from 'vitest'
import fc from 'fast-check'

import { discSource } from '../../hooks/avatar.ts'
import { cut } from '../../hooks/graphemes.ts'
import { discColour, firstName, hash, initials, shortHash } from '../../hooks/identity.ts'

test('initials come from the display name, so a handle like ixm5302 is IM beside Ines Mendel', () => {
  expect(initials('Ines Mendel', 'ixm5302')).toBe('IM')
  // The inbox knows only a username for an actor: the best it can do, and a test so nobody takes it for a bug.
  expect(initials('', 'ixm5302')).toBe('IX')
  // The same name and username give the same disc, whichever tab draws it.
  expect(discSource('ixm5302', 16, initials('Ines Mendel', 'ixm5302'))).toContain('>IM</text>')
  expect(discSource('ixm5302', 16, initials('', 'ixm5302'))).toContain('>IX</text>')
})

test('a handle with separators gives first and last, one without gives its first two letters', () => {
  expect(initials('', 'tessa.ravensworth')).toBe('TR')
  expect(initials('', 'tessa_ravensworth')).toBe('TR')
  expect(initials('', 'tessa-van-ravensworth')).toBe('TR')
  expect(initials('', 'tessa')).toBe('TE')
  expect(initials('', '42bot')).toBe('42')
  expect(initials('Mel.Northcote')).toBe('MN')
  expect(initials('', '')).toBe('?')
})

test('people who share initials get a longer pair', () => {
  expect(initials('Ines Mendel')).toBe('IM')
  expect(initials('Ivo Marsh')).toBe('IM')
  expect(initials('Ines Mendel', '', true)).toBe('IMe')
  expect(initials('Ivo Marsh', '', true)).toBe('IMa')
  expect(initials('Cher', '', true)).toBe('CHE')
  // Upper-casing can make a letter two (ß is SS): the pair is cut after it, so it stays three at most.
  expect(initials('ßßß', '', true)).toBe('SSS')
})

test('names in other scripts keep whole characters', () => {
  expect(initials('山田 太郎')).toBe('山太')
  expect(initials('山田太郎')).toBe('山田')
  expect(initials('Дарья Иванова')).toBe('ДИ')
  expect(initials('José Ñandú')).toBe('JÑ')
  // A code point outside the basic plane is not cut in half.
  expect(initials('𠮷野 家')).toBe('𠮷家')
  expect(initials('…', 'ana.diaz')).toBe('AD')
})

test('initials never cut a character the way a person sees it: an accented letter, a flag and a skin-toned hand are one each', () => {
  // `e` and a combining acute are two code points and one letter.
  expect(initials('e\u{301}mile durand')).toBe('E\u{301}D')
  expect(initials('e\u{301}mile')).toBe('E\u{301}M')
  expect(initials('', 'a🇺🇸')).toBe('A🇺🇸')
  expect(initials('Ana B🇺🇸', '', true)).toBe('AB🇺🇸')
  expect(initials('', 'a👍🏽b', true)).toBe('A👍🏽B')
  // The cap on one initial is five UTF-16 units, the most a name's character takes: ệ written as `e` and two marks is
  // three, a flag four, and a Devanagari conjunct of three consonants (a letter, a virama, a letter, a virama, a letter) five.
  expect(initials('e\u{323}\u{302}x')).toBe('E\u{323}\u{302}X')
  expect(initials('\u{938}\u{94D}\u{924}\u{94D}\u{930} \u{915}')).toBe('\u{938}\u{94D}\u{924}\u{94D}\u{930}\u{915}')
})

test('an initial keeps the first five UTF-16 units of its character, so an accent stays and a hundred thousand marks do not', () => {
  const marked = (letter: string) => `${letter}${'\u{301}'.repeat(100_000)}`
  // Each initial is one letter with its first four marks; the rest of the marks are not carried into the card.
  expect(initials(`${marked('a')} ${marked('b')}`)).toBe(`A${'\u{301}'.repeat(4)}B${'\u{301}'.repeat(4)}`)
  expect(initials(marked('a'), '', true)).toBe(`A${'\u{301}'.repeat(4)}`)
})

test('a first name ends at a space, dot or underscore, not a hyphen', () => {
  expect(firstName('Ines Mendel', 'ixm5302')).toBe('Ines')
  expect(firstName('Mel.Northcote')).toBe('Mel')
  expect(firstName('Jean-Luc Picard')).toBe('Jean-Luc')
  expect(firstName('', 'carol.jones')).toBe('carol')
  expect(firstName('', 'ixm5302')).toBe('ixm5302')
  expect(firstName('', '')).toBe('')
})

test('a person keeps one colour and a hash is stable', () => {
  expect(hash('g/p')).toBe(hash('g/p'))
  // The hash runs over UTF-16 code units, so a character outside the basic plane counts as its two halves. Pinned: a change
  // moves every person's colour and every key.
  expect(hash('ab')).toBe(9832)
  expect(hash('😀')).toBe(1_779_626)
  expect(shortHash('g/p')).toBe(hash('g/p').toString(36))
  expect(discColour('ixm5302')).toBe(discColour('ixm5302'))
  expect(discColour('ixm5302')).toMatch(/^#[0-9A-F]{6}$/)
  expect(discSource('ixm5302')).toContain(discColour('ixm5302'))
})

// ---- properties -------------------------------------------------------------------------------------------------------

const nameArb = fc.string({
  unit: fc.oneof(
    fc.constantFrom(' ', '.', '_', '-', 'ß', 'ǆ', 'ŉ', 'ﬃ', 'é', 'é', '李', 'Ж', '4', '!', '​'),
    fc
      .integer({ min: 0, max: 0x10ffff })
      .filter(code => code < 0xd800 || code > 0xdfff)
      .map(code => String.fromCodePoint(code)),
    fc.string({ unit: 'grapheme-ascii', maxLength: 1 })
  ),
  maxLength: 30,
})

test('initials are stable, one to three characters of a few units each, and the longer form extends the short one', () => {
  // The bound is three characters as a person counts them and 3 × 5 UTF-16 units, not three code points: a bound of three
  // code points is exactly what dropped the acute of an `é` written as `e` and a combining accent.
  const within = (initial: string): void => {
    expect(initial).not.toBe('')
    expect(cut(initial, 3, Number.POSITIVE_INFINITY)).toBe(initial)
    expect(initial.length).toBeLessThanOrEqual(3 * 5)
  }
  fc.assert(
    fc.property(nameArb, nameArb, (name, username) => {
      const short = initials(name, username)
      const long = initials(name, username, true)
      expect(initials(name, username)).toBe(short)
      within(short)
      within(long)
      expect(long.startsWith(short)).toBe(true)
    })
  )
})
