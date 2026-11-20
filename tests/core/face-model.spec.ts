import { expect, test } from 'vitest'
import fc from 'fast-check'

import { faceFacts, REVIEW_MARK, THREAD_MARK } from '../../hooks/face-model.ts'
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
