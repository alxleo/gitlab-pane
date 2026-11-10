// A person's identity on the pane: the hash behind keys and colours, the initials, the first name. Pure, so the Mine tab
// and the Inbox, which meet the same person through a display name and a username, draw one and the same disc.

import { leading } from './graphemes.ts'

/**
 * A string's hash, stable across runs; short keys and the pick of a colour both come from it. It runs over UTF-16 code
 * units: where one character ends does not matter to a hash.
 */
export function hash(text: string): number {
  let value = 7
  for (let at = 0; at < text.length; at += 1) {
    value = (Math.imul(value, 31) + text.charCodeAt(at)) >>> 0
  }
  return value
}

/** Keeps a key short whatever the project path or username. */
export const shortHash = (text: string): string => hash(text).toString(36)

/** Fills for initials discs, picked by username so a person keeps one colour wherever they appear. */
const FILLS = ['#5B8DEF', '#E5734A', '#3FA27B', '#B062D8', '#C9971C', '#E0567A', '#3A9FBF', '#7A8899']

export const discColour = (username: string): string => FILLS[hash(username) % FILLS.length] ?? '#7A8899'

const wordsOf = (text: string, start: RegExp): string[] => text.split(/[\s._-]+/u).filter(word => start.test(word))

/**
 * The most UTF-16 units one initial keeps. A character a person writes in a name is a few: a letter with two or three marks
 * (Vietnamese ệ written as `e` and two marks is three units), a flag (four), a Devanagari conjunct of three consonants, the
 * longest of the usual (five). Five keeps every one of those whole, and cuts a letter that carries a hundred thousand marks
 * to its first four, instead of carrying them in the card to every surface that draws it; four would cut that conjunct.
 */
const INITIAL_SIZE = 5

/** The first `count` characters as a person sees them, a name in Han or Cyrillic, an accented letter or a flag each whole. */
const head = (text: string, count: number): string => leading(text, count, INITIAL_SIZE).join('')

/**
 * Initials from the display name: first and last word's first letter, `Ines Mendel` is IM; one word gives its first
 * two letters. A name with no word (empty, or only marks) falls back to the username, so `ixm5302` alone is IX. With
 * `longer`, for two people who share initials, a third letter is added.
 */
export function initials(name: string, username = '', longer = false): string {
  let words = wordsOf(name, /^\p{L}/u)
  if (words.length === 0) {
    words = wordsOf(username, /^[\p{L}\p{N}]/u)
  }
  const [first = '?', ...rest] = words
  const last = rest.at(-1)
  if (last === undefined) {
    return head(first.toUpperCase(), longer ? 3 : 2)
  }
  return `${head(first.toUpperCase(), 1)}${head(last.toUpperCase(), 1)}` + (longer ? leading(last, 2, INITIAL_SIZE).slice(1).join('') : '')
}

/**
 * The name to call a person by: the display name's first word, else the username's. Some GitLab names are written like
 * handles ("Mel.Northcote"), so a dot or underscore ends a first name too; a hyphen does not, as in "Jean-Luc".
 */
export function firstName(name: string, username = ''): string {
  return name.split(/[\s._]+/u).find(Boolean) ?? username.split(/[\s._]+/u).find(Boolean) ?? ''
}
