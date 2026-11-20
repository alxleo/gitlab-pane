import { expect, test } from 'vitest'
import fc from 'fast-check'

import { fold, found, keptSearch, queryOf, scoreOf } from '../../hooks/search.ts'
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
  mr(512, { title: 'feat: [ABC-123] Add order history to the account page', branch: 'feature/abc-123-order-history', repo: 'web-store' }),
  mr(5120, { title: 'fix: Retry payment authorisation once', branch: 'fix/payment-retry', repo: 'payments', people: ['sam', 'Sam Lee'] }),
  mr(42, { title: 'chore: Bump the Node image', branch: 'renovate/node-26', repo: 'platform', people: ['renovate-bot'] }),
  mr(77, { title: 'Draft: [ABC-150] Show the delivery window', branch: 'abc_150_delivery', repo: 'web-store' }),
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
  expect(find('!512')).toEqual([512])
  expect(find('512')).toEqual([512, 5120])
  expect(find('!51')).toEqual([])
})

test('a ticket is found however it is spelled: its case, its hyphen, an underscore, or none', () => {
  for (const typed of ['ABC-123', 'abc-123', 'abc123', 'ABC123', 'abc_123']) {
    expect(find(typed)).toEqual([512])
  }
  // A branch named for the ticket finds it too, where the title does not name it.
  expect(find('abc150')).toEqual([77])
})

test('words of the title, branch, repo and author are found by their start or any part, in any case', () => {
  expect(find('order hist')).toEqual([512])
  expect(find('PAYMENT')).toEqual([5120])
  expect(find('renovate')).toEqual([42])
  expect(find('web-store')).toEqual([512, 77])
  expect(find('sam lee')).toEqual([5120])
  expect(find('thoris')).toEqual([5120])
})

test('accents, strokes, a capital of two letters and a final sigma fold away, so a word typed plain or cut short still finds it', () => {
  const named = [mr(1, { title: 'Café crème for Łódź' }), mr(2, { title: 'Straße names' }), mr(3, { title: 'ΟΔΟΣΑ route' })]
  expect(find('cafe creme', named)).toEqual([1])
  expect(find('lodz', named)).toEqual([1])
  expect(find('STRASSE', named)).toEqual([2])
  expect(find('strasse', named)).toEqual([2])
  expect(find('οδοσ', named)).toEqual([3])
})

test("an MR's address or GitLab's reference to it, pasted, finds it by its repo and number", () => {
  const two = [mr(1, { repo: 'g/web' }), mr(1, { repo: 'g/api' }), mr(12, { repo: 'g/web' })]
  const repos = (text: string) => {
    const query = queryOf(text)
    return query !== null ? found(query, two, each => each).map(each => `${each.repo}!${each.iid}`) : []
  }
  expect(repos('g/web!1')).toEqual(['g/web!1'])
  expect(repos('web!12')).toEqual(['g/web!12'])
  expect(repos('https://gitlab.com/g/api/-/merge_requests/1')).toEqual(['g/api!1'])
  expect(repos('https://gitlab.com/g/web/-/merge_requests/12/diffs')).toEqual(['g/web!12'])
  // Wrapped as a message wraps them, in a Markdown link, or in GitLab's older address without its `/-/`.
  expect(repos('<https://gitlab.com/g/api/-/merge_requests/1>')).toEqual(['g/api!1'])
  expect(repos('[!12](https://gitlab.com/g/web/-/merge_requests/12)')).toEqual(['g/web!12'])
  expect(repos('https://gitlab.com/g/web/merge_requests/12')).toEqual(['g/web!12'])
  expect(repos('(g/web!12),')).toEqual(['g/web!12'])
})

test("a pasted reference's repo is the repo's whole path or its last parts, never part of another repo's name", () => {
  const near = [mr(5, { repo: 'grp/sub/web' }), mr(5, { repo: 'grp/website' }), mr(5, { repo: 'g/web-store' })]
  const repos = (text: string) => {
    const query = queryOf(text)
    return query !== null ? found(query, near, each => each).map(each => each.repo) : []
  }
  expect(repos('web!5')).toEqual(['grp/sub/web'])
  expect(repos('sub/web!5')).toEqual(['grp/sub/web'])
  expect(repos('web-store!5')).toEqual(['g/web-store'])
})

test('a ticket named by the branch alone ranks above a title word that only starts with it', () => {
  const branch = mr(1, { title: 'Other', branch: 'abc-150-delivery' })
  const title = mr(2, { title: 'the abc1500 thing', branch: 'two' })
  expect(find('ABC-150', [title, branch])).toEqual([1, 2])
})

test('a search is kept to its first 200 characters, none cut in half', () => {
  expect(keptSearch('order history')).toBe('order history')
  expect(keptSearch('a'.repeat(5_000))).toBe('a'.repeat(200))
  expect(keptSearch(`${'a'.repeat(199)}👍🏽`)).toBe('a'.repeat(199))
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
  const one = mr(512, { title: 'feat: [ABC-123] Add order history' })
  expect(scoreOf(query('512'), one)).toBe(8)
  expect(scoreOf(query('abc123'), one)).toBe(4)
  expect(scoreOf(query('512 abc123'), one)).toBe(12)
  expect(scoreOf(query('512 zebra'), one)).toBeNull()
})
