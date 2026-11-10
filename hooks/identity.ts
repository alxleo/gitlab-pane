// A person's identity on the pane: the hash behind keys and colours, the initials, the first name. Pure, so the Mine tab
// and the Inbox, which meet the same person through a display name and a username, draw one and the same disc.

/** A string's hash, stable across runs; short keys and the pick of a colour both come from it. */
export const hash = (text: string): number => [...text].reduce((value, char) => (Math.imul(value, 31) + char.charCodeAt(0)) >>> 0, 7)

/** Keeps a hover scope or key short whatever the project path or username. */
export const shortHash = (text: string): string => hash(text).toString(36)

/** Fills for initials discs, picked by username so a person keeps one colour wherever they appear. */
const FILLS = ['#5B8DEF', '#E5734A', '#3FA27B', '#B062D8', '#C9971C', '#E0567A', '#3A9FBF', '#7A8899']

export const discColour = (username: string): string => FILLS[hash(username) % FILLS.length] ?? '#7A8899'

const wordsOf = (text: string, start: RegExp): string[] => text.split(/[\s._-]+/).filter(word => start.test(word))

/** The first `count` characters, whole code points, so a name in Han or Cyrillic is never cut in half. */
const head = (text: string, count: number): string => [...text].slice(0, count).join('')

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
  return `${head(first.toUpperCase(), 1)}${head(last.toUpperCase(), 1)}` + (longer ? head([...last].slice(1).join(''), 1) : '')
}

/**
 * The name to call a person by: the display name's first word, else the username's. Some GitLab names are written like
 * handles ("Mel.Northcote"), so a dot or underscore ends a first name too; a hyphen does not, as in "Jean-Luc".
 */
export function firstName(name: string, username = ''): string {
  return name.split(/[\s._]+/).find(Boolean) ?? username.split(/[\s._]+/).find(Boolean) ?? ''
}
