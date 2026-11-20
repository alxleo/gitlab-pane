// What the search box finds among the MRs the pane already holds: an MR by its number (`!512`, `512`), a ticket however
// it is spelled (`ABC-123`, `abc123`), or words of its title, branch, repo or author. Pure, on plain data; the pane says
// what each MR is called, and this says which match and in what order.
import { cut } from './graphemes.ts'

/**
 * What a typed search looks for: each word folded to letters and digits. One typed with `!` is an MR's number alone; the repo
 * of a pasted address or reference is a repo's whole path or its last parts, never part of another repo's name.
 */
export type Query = { words: readonly Word[] }

type Word = { text: string; kind: 'any' | 'iid' | 'repo' }

/** What of an MR a search reads. `people` are its author's username and name, where known. */
export type Findable = { iid: number; title: string; branch: string; repo: string; people: readonly string[] }

/** How well a word matches, added up over the words: the MR's own number, then a ticket whole, the start of a word, any part. */
const TIER = { iid: 8, ticket: 4, start: 2, part: 1 } as const

/** The most a search holds: more is pasted, not typed, and it is drawn back in the box. */
const SEARCH_ROOM = 200

/** What of a search is kept: its first `SEARCH_ROOM` characters, none cut in half, so the box never outgrows the drawing. */
export const keptSearch = (text: string): string => cut(text, SEARCH_ROOM, SEARCH_ROOM)

/** Letters whose stroke or form no decomposition takes off, as their plain letter. */
const PLAIN: Readonly<Record<string, string>> = { ł: 'l', ø: 'o', đ: 'd', ħ: 'h', ı: 'i', ŧ: 't' }

/**
 * Lowercase letters and digits alone, accents and strokes dropped, so case and punctuation never decide a match. Upper then
 * lower case, so a letter whose capital is two (`ß`, `SS`) folds as its capitals do; a final sigma is a sigma, so a word cut
 * short after one still matches the longer word.
 */
export const fold = (text: string): string =>
  text
    .toUpperCase()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ς/gu, 'σ')
    .replace(/[łøđħıŧ]/gu, letter => PLAIN[letter] ?? letter)
    .replace(/[^\p{L}\p{N}]/gu, '')

/** The words of a text, each folded; punctuation and spaces part them. */
const wordsOf = (text: string): string[] =>
  text
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .map(fold)
    .filter(word => word !== '')

/** The ticket keys a text names, `ABC-123`, `abc_123` or `abc123`, folded. */
const ticketsOf = (text: string): string[] => [...text.matchAll(/\p{L}+[-_ ]?\p{N}+/gu)].map(([match]) => fold(match))

/**
 * A word as typed, or pasted: an MR's address anywhere in it (`https://host/group/repo/-/merge_requests/12`, in a Markdown link
 * or angle brackets too) or GitLab's reference to it (`group/repo!12`, punctuation around it aside) is its repo and number.
 */
function wordsTyped(raw: string): Word[] {
  const address = /https?:\/\/[^/\s]+\/(.+?)\/(?:-\/)?merge_requests\/(\p{N}+)/u.exec(raw)
  const bare = raw.replace(/^[<([{"'`]+|[>)\]}"'`,.;:]+$/gu, '')
  const reference = /^([^!]+)!(\p{N}+)$/u.exec(bare)
  const [, repo, iid] = address ?? reference ?? []
  if (repo !== undefined && iid !== undefined) {
    return [
      { text: fold(repo), kind: 'repo' },
      { text: iid, kind: 'iid' },
    ]
  }
  return [{ text: fold(raw), kind: bare.startsWith('!') && /^\p{N}+$/u.test(fold(raw)) ? 'iid' : 'any' }]
}

/** The search typed, or null when it holds nothing to look for, which shows the list as it is. */
export function queryOf(text: string): Query | null {
  const words = text
    .split(/\s+/u)
    .flatMap(wordsTyped)
    .filter(word => word.text !== '')
  return words.length > 0 ? { words } : null
}

/** Whether `text` is the repo's path, or its last parts (`web`, `group/web`), folded. */
const isRepo = (text: string, path: string): boolean => {
  const parts = path.split('/')
  return parts.some((_, i) => fold(parts.slice(i).join('/')) === text)
}

/** How well one word matches the MR, or null when it does not. */
function tierOf(word: Word, mr: Findable): number | null {
  const iid = String(mr.iid)
  if (word.kind === 'repo') {
    return isRepo(word.text, mr.repo) ? TIER.start : null
  }
  if (word.text === iid) {
    return TIER.iid
  }
  if (word.kind === 'iid') {
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
