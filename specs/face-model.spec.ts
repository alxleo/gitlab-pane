import { expect, test } from 'vitest'
import fc from 'fast-check'

import { HINT_ROOM } from '../hooks/drawing'
import {
  faceFacts,
  faceRows,
  isAddKept,
  REVIEW_MARK,
  REVIEW_STATE,
  reviewerId,
  SUGGESTED_MOST,
  suggestedFace,
  suggestedOf,
  suggestedPress,
  suggestionRoom,
  THREAD_MARK,
  suggestionsFor,
} from '../hooks/face-model'
import { toCard } from '../hooks/mr-card'
import { cardFacts } from '../hooks/row-facts'
import { slimCard } from '../hooks/slim'
import { ARMED_MS, SENT_HOLDS_MS } from '../hooks/write-model'
import { HOST, rawMr, reviewer, thread, user } from '../tests/fixtures'
import type { Note, Person, PersonState, Suggestion, Write } from '../types'

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

test("a face's description says its badge in the Badge table's words, with the threads they hold, short enough for a narrow pane", () => {
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

test('a suggested face is the same face under a veil that washes it out, lighter in the dark theme, with no badge or glyph', () => {
  fc.assert(
    fc.property(personArb, fc.constantFrom(undefined, 'https://gitlab.com/a.png'), (person, picture) => {
      const face = suggestedFace(person, picture)
      const reviewed = faceFacts(person, picture)
      expect(face.picture === null).toBe(reviewed.picture === null)
      const pairs = [[face.plain, reviewed.plain] as const, ...(face.picture !== null && reviewed.picture !== null ? [[face.picture, reviewed.picture] as const] : [])]
      for (const [source, badged] of pairs) {
        // The same size as a badged face, so a row does not shift when they become a reviewer; the veil is the last thing
        // drawn, over the whole face, and it alone follows the theme: white on the light pane, the dim grey on the dark one,
        // never the dark pane's own near-black, which made the face muddy.
        expect(source).toMatch(/^<svg xmlns='http:\/\/www.w3.org\/2000\/svg' width='22' height='22' viewBox='-3 -3 22 22'><g style='color-scheme:light dark'>/u)
        expect(source).toMatch(/<circle cx='8' cy='8' r='8' fill='#ffffff8c' style='fill:light-dark\(#ffffff8c,#9c9c9c73\)'\/><\/g><\/svg>$/u)
        expect(source.match(/light-dark\(/gu)).toHaveLength(1)
        expect(source).not.toContain('stroke-dasharray')
        expect(source.length).toBeLessThan(badged.length)
      }
      expect(face.glyph).toBe('')
      expect(face.alt).toBe(`${person.name}, suggested reviewer`)
      expect(face.hint).toBe('suggested reviewer')
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
  // A card shared between sessions keeps every reviewer, so it counts the same.
  const three = cardWith(reviewer('rae', 'APPROVED'), reviewer('sam', 'UNREVIEWED'), reviewer('tom', 'REVIEW_STARTED'))
  expect(suggestionRoom(three)).toBe(0)
  expect(suggestionRoom(slimCard(three))).toBe(0)
  // A comment asks no one for a review: a commenter leaves the room as it was.
  const commented = toCard(HOST, rawMr(1, { approvalsLeft: 1, discussions: { nodes: [thread('Why this?', 'rae')] } }))
  expect(commented.people.map(person => person.username)).toEqual(['rae'])
  expect(suggestionRoom(commented)).toBe(1)
  // Only the user's own MR asks GitLab whom to suggest; while who the user is is not known, as after a reload, what was
  // held stays and nothing is asked.
  expect(suggestionsFor(card, 'alex')).toBe('ask')
  expect(suggestionsFor(card, 'me')).toBe('none')
  expect(suggestionsFor(card, null)).toBe('keep')
  expect(suggestionsFor({ ...card, approvalsLeft: 0 }, 'alex')).toBe('none')
  expect(suggestionsFor({ ...card, approvalsLeft: 0 }, null)).toBe('none')
  // An approval asked for and given, or changes asked for, is a verdict: that reviewer waits on nothing more.
  expect(suggestionRoom(cardWith(reviewer('rae', 'REQUESTED_CHANGES')))).toBe(2)
  expect(suggestionRoom(cardWith(reviewer('rae', 'APPROVED')))).toBe(2)
  // A bot's review gives no approval the MR counts, nor does the author's of their own MR; a shared card, which leaves the
  // author out of its reviewers, counts the same.
  expect(suggestionRoom(cardWith(reviewer('bot', 'UNREVIEWED', true)))).toBe(2)
  const selfAsked = cardWith(reviewer(card.author, 'UNREVIEWED'))
  expect(suggestionRoom(selfAsked)).toBe(2)
  expect(suggestionRoom(slimCard(selfAsked))).toBe(2)
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
  // An arm past its time has run out though its timer never ran, as after a reload: a press arms afresh, so it says so.
  expect(suggestedPress('Ines', held({ state: 'armed' }), at + ARMED_MS)).toMatchObject({ does: 'make', isArmed: true })
  expect(suggestedPress('Ines', held({ state: 'armed' }), at + ARMED_MS + 1)).toEqual({ label: '+ Ines', does: 'arm', isArmed: false, failed: null })
  expect(suggestedPress('Ines', held({ state: 'sent' }), at)).toEqual({ label: '+ adding Ines…', does: null, isArmed: false, failed: null })
  // Added, until a read shows them as a reviewer; never longer than a sent write is followed.
  expect(suggestedPress('Ines', held({ state: 'handed' }), at + SENT_HOLDS_MS - 1)).toEqual({ label: 'Ines added', does: null, isArmed: false, failed: null })
  expect(suggestedPress('Ines', held({ state: 'handed' }), at + SENT_HOLDS_MS).does).toBe('arm')
  expect(suggestedPress('Ines', held({ state: 'failed', say: 'gitlab.com refused' }), at)).toEqual({ label: '+ Ines', does: 'arm', isArmed: false, failed: 'gitlab.com refused' })
  expect(reviewerId('gitlab.com/g/p!1', 'ines')).toBe('reviewer:gitlab.com/g/p!1:ines')
})

test('the ledger forgets the adds on MRs no longer listed, and keeps every other feature’s entries', () => {
  const listed = ['gitlab.com/g/p!1']
  expect(isAddKept(reviewerId('gitlab.com/g/p!1', 'ines'), listed)).toBe(true)
  expect(isAddKept(reviewerId('gitlab.com/g/p!2', 'ines'), listed)).toBe(false)
  // A listed key that only begins another's is not it.
  expect(isAddKept(reviewerId('gitlab.com/g/p!12', 'ines'), listed)).toBe(false)
  expect(isAddKept('move:gitlab.com/g/p!2', listed)).toBe(true)
  expect(isAddKept('reply:https://gitlab.com/g/p/-/merge_requests/2#note_1', [])).toBe(true)
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
