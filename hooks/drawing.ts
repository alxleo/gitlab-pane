import { shortHash } from './identity.ts'

/** What a link opens, said before its words: a Link holds text alone, and an emoji costs two characters, a logo hundreds. */
export const LINK = { mr: '🔀', jira: '🎫', repo: '📁', pipeline: '🚦', comment: '💬' } as const

/**
 * The desktop app draws nothing for a tree past 100,000 characters serialized (a 381,164-character one left the pane
 * blank). The engine adds up to about 6,000 of press handles and hover stamps to what this measures, so the app gets
 * about 91,000 at most: rows, then open detail, then hover cards, then avatars, in order of what needs you.
 */
export const DRAWING_BUDGET = 85_000

/** What the tabs, repo filter, headings and footer take, with room to spare for a long list of repos. */
export const CHROME_SIZE = 6_000

/** JSON.stringify answers `undefined` for a value with no JSON form, though its declared type says `string`. */
const lengthOf = (json: string | undefined): number => (json === undefined ? 0 : json.length)

/** A tree's size as the app receives it; one that cannot be serialized counts as `unreadable`, a whole budget by default. */
export const measure = (tree: unknown, unreadable = DRAWING_BUDGET): number => {
  try {
    return lengthOf(JSON.stringify(tree))
  } catch {
    return unreadable
  }
}

/**
 * The key of an MR's title button, which the pane scrolls back to after the MR's page. The desktop reports where only
 * elements it can press sit, so the card's own box is never found.
 */
export const titleKey = (mr: { iid: number; project: string }): string => `open-${mr.iid}-${shortHash(mr.project)}`
