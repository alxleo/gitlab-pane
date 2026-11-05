import { expect, test } from 'vitest'

import { discSource } from '../../hooks/avatar.ts'
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
  expect(shortHash('g/p')).toBe(hash('g/p').toString(36))
  expect(discColour('ixm5302')).toBe(discColour('ixm5302'))
  expect(discColour('ixm5302')).toMatch(/^#[0-9A-F]{6}$/)
  expect(discSource('ixm5302')).toContain(discColour('ixm5302'))
})
