import { expect, test } from 'vitest'
import fc from 'fast-check'

import { faceFacts, faceRows, REVIEW_MARK, reviewerId, SUGGESTED_MOST, suggestedFace, suggestedOf, suggestedPress, suggestionRoom, THREAD_MARK } from '../../hooks/face-model.ts'
import { toCard } from '../../hooks/mr-card.ts'
import { cardFacts } from '../../hooks/row-facts.ts'
import { slimCard } from '../../hooks/slim.ts'
import { SENT_HOLDS_MS } from '../../hooks/write-model.ts'
import { HOST, rawMr, reviewer, user } from '../fixtures.ts'
import type { Note, Person, PersonState, Suggestion, Write } from '../../types'

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

test('a suggested face is the same face faded, with no badge, no glyph and no colour of its own, and says it is a suggestion', () => {
  fc.assert(
    fc.property(personArb, fc.constantFrom(undefined, 'https://gitlab.com/a.png'), (person, picture) => {
      const face = suggestedFace(person, picture)
      const reviewed = faceFacts(person, picture)
      expect(face.picture === null).toBe(reviewed.picture === null)
      const pairs = [[face.plain, reviewed.plain] as const, ...(face.picture !== null && reviewed.picture !== null ? [[face.picture, reviewed.picture] as const] : [])]
      for (const [source, badged] of pairs) {
        // The same size as a badged face, so a row does not shift when they become a reviewer.
        expect(source).toMatch(/^<svg xmlns='http:\/\/www.w3.org\/2000\/svg' width='22' height='22' viewBox='-3 -3 22 22'><g opacity='0.45'>/u)
        expect(source).not.toContain('light-dark(')
        expect(source).not.toContain('stroke-dasharray')
        expect(source.length).toBeLessThan(badged.length)
      }
      expect(face.glyph).toBe('')
      expect(face.alt).toBe(`${person.name}, suggested reviewer`)
    })
  )
})

const ines: Suggestion = { username: 'ines', name: 'Ines Mendel', avatarUrl: null, isBot: false }
const mel: Suggestion = { username: 'mel', name: 'Mel Northcote', avatarUrl: 'https://gitlab.com/m.png', isBot: false }
const tess: Suggestion = { username: 'tess', name: 'Tess Rowe', avatarUrl: null, isBot: false }

test('a card short of reviewers suggests whom GitLab suggests, in its order, never the author, a bot or anyone on the MR', () => {
  const cardWith = (...nodes: ReturnType<typeof reviewer>[]) => toCard(HOST, rawMr(1, { approvalsLeft: 2, approvalsRequired: 2, reviewers: { nodes } }))
  const card = cardWith(reviewer('rae', 'REVIEWED'))
  const all: Suggestion[] = [{ ...ines, username: 'alex' }, { ...ines, username: 'rae' }, { ...ines, username: 'bot', isBot: true }, ines, mel, tess]
  // Two approvals left, one review asked for with no verdict: room for one.
  expect(suggestionRoom(card)).toBe(1)
  expect(suggestedOf(card, all).map(person => person.username)).toEqual(['ines'])
  expect(suggestedOf(cardWith(), all).map(person => person.username)).toEqual(['rae', 'ines'])
  // A card shared between sessions keeps one reviewer: the others still count.
  const three = cardWith(reviewer('rae', 'APPROVED'), reviewer('sam', 'UNREVIEWED'), reviewer('tom', 'REVIEW_STARTED'))
  expect(suggestionRoom(three)).toBe(0)
  expect(suggestionRoom(slimCard(three))).toBe(0)
  // An approval asked for and given, or changes asked for, is a verdict: that reviewer waits on nothing more.
  expect(suggestionRoom(cardWith(reviewer('rae', 'REQUESTED_CHANGES')))).toBe(2)
  expect(suggestionRoom(cardWith(reviewer('rae', 'APPROVED')))).toBe(2)
  // A bot's review gives no approval the MR counts.
  expect(suggestionRoom(cardWith(reviewer('bot', 'UNREVIEWED', true)))).toBe(2)
  // None on a draft, a closed MR, or one with every approval it needs asked for.
  expect(suggestionRoom({ ...card, isDraft: true })).toBe(0)
  expect(suggestionRoom({ ...card, isOpen: false })).toBe(0)
  expect(suggestionRoom({ ...card, approvalsLeft: 0 })).toBe(0)
  expect(suggestionRoom({ ...cardWith(), approvalsLeft: 9 })).toBe(SUGGESTED_MOST)
  expect(suggestedOf(card, [])).toEqual([])
})

test('a suggested person is someone with no stand yet, whose initials are told apart from those of the people on the card', () => {
  const card = toCard(HOST, rawMr(1, { approvalsLeft: 2 }))
  const iris: Person = { username: 'iris', name: 'Iris Mayer', initials: 'IM', isBot: false, avatarUrl: null, state: 'commented', openThreads: 0, notes: [], noteCount: 0 }
  const [suggested] = suggestedOf({ ...card, people: [iris] }, [ines])
  expect(suggested).toMatchObject({ username: 'ines', state: 'unreviewed', openThreads: 0, notes: [], isBot: false })
  expect(suggested?.initials).toBe('IMe')
  expect(suggestedOf(card, [ines])[0]?.initials).toBe('IM')
})

test('the press beside a suggested face arms first, adds on the second, says when it is out or done, and why it did not take', () => {
  const at = 1_000
  const held = (over: Partial<Write> & Pick<Write, 'state'>): Write =>
    over.state === 'failed' ? { kind: 'reviewer', on: 'ines', at, say: 'no', ...over } : { kind: 'reviewer', on: 'ines', at, ...over, state: over.state }
  expect(suggestedPress('Ines', undefined, at)).toEqual({ label: '+ Ines', does: 'arm', isArmed: false, failed: null })
  expect(suggestedPress('Ines', held({ state: 'armed' }), at)).toEqual({ label: '+ add Ines as a reviewer? press again', does: 'make', isArmed: true, failed: null })
  expect(suggestedPress('Ines', held({ state: 'sent' }), at)).toEqual({ label: '+ adding Ines…', does: null, isArmed: false, failed: null })
  // Added, until a read shows them as a reviewer; never longer than a sent write is followed.
  expect(suggestedPress('Ines', held({ state: 'handed' }), at + SENT_HOLDS_MS - 1)).toEqual({ label: 'Ines added', does: null, isArmed: false, failed: null })
  expect(suggestedPress('Ines', held({ state: 'handed' }), at + SENT_HOLDS_MS).does).toBe('arm')
  expect(suggestedPress('Ines', held({ state: 'failed', say: 'gitlab.com refused' }), at)).toEqual({ label: '+ Ines', does: 'arm', isArmed: false, failed: 'gitlab.com refused' })
  expect(reviewerId('gitlab.com/g/p!1', 'ines')).toBe('reviewer:gitlab.com/g/p!1:ines')
})

test('a row names its faces by first name, its suggested ones after a +, each with the press its add holds, and keeps initials for a shared name', () => {
  const card = toCard(HOST, rawMr(1, { approvalsLeft: 2, reviewers: { nodes: [] }, approvedBy: { nodes: [user('ines.other')] } }))
  const facts = cardFacts(card, {}, [{ ...ines, name: 'Ines Other', username: 'ines.o2' }, mel])
  const row = (writes: Record<string, Write>, hasSvg = true) => faceRows(facts, { hasSvg, writes, key: card.key, suffix: '1-x', now: 0 })
  const plain = row({})
  expect(plain.people.map(person => person.label)).toEqual([facts.people[0]?.initials])
  expect(plain.suggested.map(person => person.label)).toEqual([`+ ${facts.suggested[0]?.initials}`, '+ Mel'])
  expect(plain.suggested.map(person => person.key)).toEqual([expect.stringMatching(/^suggest-.+-1-x$/u), expect.stringMatching(/^suggest-.+-1-x$/u)])
  expect(row({ [reviewerId(card.key, 'mel')]: { kind: 'reviewer', state: 'armed', on: 'mel', at: 0 } }).suggested[1]?.press.isArmed).toBe(true)
  // Without Svg, the initials are what a row calls everyone.
  expect(row({}, false).suggested[1]?.label).toBe('+ MN')
})
