import { expect, test } from 'vitest'
import fc from 'fast-check'

import { HINT_ROOM } from '../../hooks/drawing.ts'
import { faceFacts, REVIEW_MARK, REVIEW_STATE, THREAD_MARK } from '../../hooks/face-model.ts'
import type { Note, Person, PersonState } from '../../types'

const STATES = Object.keys(REVIEW_MARK).filter((state): state is PersonState => state in REVIEW_MARK)

const personArb: fc.Arbitrary<Person> = fc.record({
  username: fc.constantFrom('ines.mendel', 'tessa.r', 'project_1_bot_ab'),
  name: fc.constantFrom('Ines Mendel', 'Tessa R'),
  isBot: fc.boolean(),
  initials: fc.constantFrom('IM', 'TR'),
  avatarUrl: fc.constant(null),
  state: fc.constantFrom(...STATES),
  openThreads: fc.nat(3),
  notes: fc.constant<Note[]>([]),
  noteCount: fc.nat(3),
})

test('every face, with or without a picture, draws its badge in both shades inside the group that follows the theme', () => {
  fc.assert(
    fc.property(personArb, fc.constantFrom(undefined, 'https://gitlab.com/a.png'), (person, picture) => {
      const face = faceFacts(person, picture)
      for (const source of [face.plain, ...(face.picture !== null ? [face.picture] : [])]) {
        // An element with two style attributes is not drawn at all, silently.
        expect(source).not.toMatch(/<[^>]*\sstyle='[^']*'[^>]*\sstyle='/u)
        const [, themed = ''] = /<g style='color-scheme:light dark'>(.*)<\/g><\/svg>$/u.exec(source) ?? []
        expect(themed).toContain('light-dark(')
        expect(source.replace(themed, '')).not.toContain('light-dark(')
      }
      // An open thread is the badge unless they asked for changes, which outranks it.
      expect(face.glyph).toBe(person.state !== 'requested_changes' && person.openThreads > 0 ? THREAD_MARK.glyph : REVIEW_MARK[person.state].glyph)
      expect(face.alt).toContain(person.name)
    })
  )
})

test("a face's hover says its badge in the Badge table's words, with the threads they hold, short enough for a narrow pane", () => {
  fc.assert(
    fc.property(personArb, fc.nat(999), (person, openThreads) => {
      const face = faceFacts({ ...person, openThreads }, undefined)
      expect(face.hint.startsWith(REVIEW_STATE[person.state])).toBe(true)
      expect(face.hint.endsWith('open thread') || face.hint.endsWith('open threads')).toBe(face.glyph === THREAD_MARK.glyph)
      expect(face.hint.length).toBeLessThanOrEqual(HINT_ROOM)
      expect(face.alt).toBe(`${person.name}, ${face.hint}`)
    })
  )
})
