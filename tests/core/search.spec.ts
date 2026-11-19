import { expect, test } from 'vitest'
import fc from 'fast-check'

import { fold, found, queryOf, scoreOf } from '../../hooks/search.ts'
import type { Findable, Query } from '../../hooks/search.ts'

const mr = (iid: number, over: Partial<Findable> = {}): Findable => ({
  iid,
  title: `fix: [ABC-${iid}] thing ${iid}`,
  branch: `fix/thing-${iid}`,
  repo: 'checkout',
  people: ['maya', 'Maya Ortiz'],
  ...over,
})

const MRS: Findable[] = [
  mr(1398, { title: 'feat: [HET-1074] Add order history to the account page', branch: 'feature/het-1074-order-history', repo: 'web-store' }),
  mr(13980, { title: 'fix: Retry payment authorisation once', branch: 'fix/payment-retry', repo: 'payments', people: ['sam', 'Sam Lee'] }),
  mr(42, { title: 'chore: Bump the Node image', branch: 'renovate/node-26', repo: 'platform', people: ['renovate-bot'] }),
  mr(77, { title: 'Draft: [HET-1100] Show the delivery window', branch: 'het_1100_delivery', repo: 'web-store' }),
]

/** The numbers of the MRs a search finds, best first. */
const find = (text: string, mrs: readonly Findable[] = MRS): number[] => {
  const query = queryOf(text)
  return query !== null ? found(query, mrs, each => each).map(each => each.iid) : []
}

test('a blank search, or one of punctuation alone, looks for nothing and leaves the list as it is', () => {
  expect(queryOf('')).toBeNull()
  expect(queryOf('   \t ')).toBeNull()
  expect(queryOf('! - / ')).toBeNull()
})

test("an MR is found by its number with or without GitLab's !, and the exact number comes before one that only contains it", () => {
  expect(find('!1398')).toEqual([1398])
  expect(find('1398')).toEqual([1398, 13980])
  expect(find('!139')).toEqual([])
})

test('a ticket is found however it is spelled: its case, its hyphen, an underscore, or none', () => {
  for (const typed of ['HET-1074', 'het-1074', 'het1074', 'HET1074', 'het_1074']) {
    expect(find(typed)).toEqual([1398])
  }
  // A branch named for the ticket finds it too, where the title does not name it.
  expect(find('het1100')).toEqual([77])
})

test('words of the title, branch, repo and author are found by their start or any part, in any case', () => {
  expect(find('order hist')).toEqual([1398])
  expect(find('PAYMENT')).toEqual([13980])
  expect(find('renovate')).toEqual([42])
  expect(find('web-store')).toEqual([1398, 77])
  expect(find('sam lee')).toEqual([13980])
  expect(find('thoris')).toEqual([13980])
})

test('every word must match, so a word no MR has finds nothing', () => {
  expect(find('order zebra')).toEqual([])
  expect(find('payment checkout')).toEqual([])
})

test('a ticket whole ranks above a word that starts with it, and that above a part of a word', () => {
  const ticket = mr(1, { title: '[XY-12] One', branch: 'one' })
  const start = mr(2, { title: 'xy123 tool', branch: 'two' })
  const part = mr(3, { title: 'thexy12', branch: 'three' })
  expect(find('XY-12', [part, start, ticket])).toEqual([1, 2, 3])
})

test('MRs that match as well keep the order they came in, which is how pressing they are', () => {
  const same = [mr(5, { title: 'Tidy logs' }), mr(6, { title: 'Tidy tests' }), mr(7, { title: 'Tidy docs' })]
  expect(find('tidy', same)).toEqual([5, 6, 7])
})

const findableArb = fc.record({
  iid: fc.integer({ min: 1, max: 99_999 }),
  title: fc.string({ maxLength: 40 }),
  branch: fc.string({ maxLength: 20 }),
  repo: fc.string({ maxLength: 12 }),
  people: fc.array(fc.string({ maxLength: 12 }), { maxLength: 2 }),
})
const mrsArb = fc.uniqueArray(findableArb, { selector: each => each.iid, maxLength: 8 })
const PUNCTUATION = ['-', '_', '.', '/', ':', '[', ']', '#', '(', ')', ',']

test('neither case nor punctuation inside a word changes what a search finds', () => {
  // A `!` is left out of what is typed: before a number it says the number is the MR's, which punctuation would change.
  const charsArb = fc.array(
    fc.string({ minLength: 1, maxLength: 1 }).filter(char => char !== '!'),
    { maxLength: 12 }
  )
  fc.assert(
    fc.property(mrsArb, charsArb, fc.array(fc.constantFrom(...PUNCTUATION), { minLength: 1, maxLength: 4 }), (mrs, chars, marks) => {
      const [head = '', ...tail] = chars
      const marked = [head, ...tail.flatMap((char, i) => (i < marks.length ? [marks[i] ?? '', char] : [char]))].join('')
      expect(find(marked.toUpperCase(), mrs)).toEqual(find(chars.join(''), mrs))
    })
  )
})

test('every MR is found first by its own number, typed with or without !', () => {
  fc.assert(
    fc.property(mrsArb, fc.nat(), (mrs, pick) => {
      fc.pre(mrs.length > 0)
      const one = mrs[pick % mrs.length]
      fc.pre(one !== undefined)
      expect(find(`!${one.iid}`, mrs)).toEqual([one.iid])
      expect(find(String(one.iid), mrs)[0]).toBe(one.iid)
    })
  )
})

test('any part of a title finds its MR', () => {
  fc.assert(
    fc.property(mrsArb, fc.nat(), fc.nat(), fc.nat(), (mrs, pick, from, length) => {
      fc.pre(mrs.length > 0)
      const one = mrs[pick % mrs.length]
      fc.pre(one !== undefined)
      const title = fold(one.title)
      const start = title.length > 0 ? from % title.length : 0
      const part = title.slice(start, start + 1 + (length % 6))
      fc.pre(part !== '')
      expect(find(part, mrs)).toContain(one.iid)
    })
  )
})

test('another word never finds more', () => {
  fc.assert(
    fc.property(mrsArb, fc.string({ maxLength: 8 }), fc.string({ maxLength: 8 }), (mrs, first, second) => {
      const wider = find(first, mrs)
      fc.pre(queryOf(first) !== null)
      for (const iid of find(`${first} ${second}`, mrs)) {
        expect(wider).toContain(iid)
      }
    })
  )
})

test('a score is the sum over the words, so a search of one word scores what that word does', () => {
  const query = (text: string): Query => queryOf(text) ?? { words: [] }
  const one = mr(1398, { title: 'feat: [HET-1074] Add order history' })
  expect(scoreOf(query('1398'), one)).toBe(8)
  expect(scoreOf(query('het1074'), one)).toBe(4)
  expect(scoreOf(query('1398 het1074'), one)).toBe(12)
  expect(scoreOf(query('1398 zebra'), one)).toBeNull()
})
