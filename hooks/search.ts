// What the search box finds among the MRs the pane already holds: an MR by its number (`!1398`, `1398`), a ticket however
// it is spelled (`HET-1074`, `het1074`), or words of its title, branch, repo or author. Pure, on plain data; the pane says
// what each MR is called, and this says which match and in what order.

/** What a typed search looks for: each word folded to letters and digits, the ones typed with `!` an MR's number alone. */
export type Query = { words: readonly Word[] }

type Word = { text: string; isIid: boolean }

/** What of an MR a search reads. `people` are its author's username and name, where known. */
export type Findable = { iid: number; title: string; branch: string; repo: string; people: readonly string[] }

/** How well a word matches, added up over the words: the MR's own number, then a ticket whole, the start of a word, any part. */
const TIER = { iid: 8, ticket: 4, start: 2, part: 1 } as const

/**
 * Lowercase letters and digits alone, accents dropped, so case and punctuation never decide a match. Upper then lower case,
 * so a letter whose capital is two (`ß`, `SS`) folds as its capitals do.
 */
export const fold = (text: string): string =>
  text
    .toUpperCase()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '')

/** The words of a text, each folded; punctuation and spaces part them. */
const wordsOf = (text: string): string[] =>
  text
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .map(fold)
    .filter(word => word !== '')

/** The ticket keys a text names, `HET-1074`, `het_1074` or `het1074`, folded. */
const ticketsOf = (text: string): string[] => [...text.matchAll(/\p{L}+[-_ ]?\p{N}+/gu)].map(([match]) => fold(match))

/** The search typed, or null when it holds nothing to look for, which shows the list as it is. */
export function queryOf(text: string): Query | null {
  const words = text
    .split(/\s+/u)
    .map(raw => ({ text: fold(raw), isIid: raw.startsWith('!') && /^\p{N}+$/u.test(fold(raw)) }))
    .filter(word => word.text !== '')
  return words.length > 0 ? { words } : null
}

/** How well one word matches the MR, or null when it does not. */
function tierOf(word: Word, mr: Findable): number | null {
  const iid = String(mr.iid)
  if (word.text === iid) {
    return TIER.iid
  }
  if (word.isIid) {
    return null
  }
  const texts = [mr.title, mr.branch, mr.repo, ...mr.people]
  if (ticketsOf(`${mr.title} ${mr.branch}`).includes(word.text)) {
    return TIER.ticket
  }
  if (texts.some(text => fold(text).startsWith(word.text) || wordsOf(text).some(each => each.startsWith(word.text)))) {
    return TIER.start
  }
  return [iid, ...texts].some(text => fold(text).includes(word.text)) ? TIER.part : null
}

/** How well the MR matches every word, or null when one word does not. */
export function scoreOf(query: Query, mr: Findable): number | null {
  let score = 0
  for (const word of query.words) {
    const tier = tierOf(word, mr)
    if (tier === null) {
      return null
    }
    score += tier
  }
  return score
}

/** The items that match every word, best first; items that match as well keep the order they came in. */
export function found<T>(query: Query, items: readonly T[], findable: (item: T) => Findable): T[] {
  return items
    .flatMap(item => {
      const score = scoreOf(query, findable(item))
      return score !== null ? [{ item, score }] : []
    })
    .toSorted((a, b) => b.score - a.score)
    .map(({ item }) => item)
}
