import { shortHash } from './identity.ts'

/** What a link opens, said before its words: a Link holds text alone, and an emoji costs two characters, a logo hundreds. */
export const LINK = { mr: '🔀', jira: '🎫', repo: '📁', pipeline: '🚦', comment: '💬', commit: '📍' } as const

/** What each link mark opens, said under the pointer as `opens …`. */
export const LINK_OPENS: Record<keyof typeof LINK, string> = {
  mr: 'the MR',
  jira: 'the Jira ticket',
  repo: 'the repo',
  pipeline: 'the pipeline',
  comment: 'the comment',
  commit: 'the commit a merge takes',
}

/** A link's mark in words, as its hover says it. */
export const opens = (link: keyof typeof LINK): string => `opens ${LINK_OPENS[link]}`

/** The controls drawn as a symbol alone, and what each says under the pointer: what a press does, or what is on. */
export const CONTROL = {
  refresh: { mark: '↻', hint: 'read GitLab again' },
  wakeOn: { mark: '🔔', hint: 'raised MRs wake Claude' },
  wakeOff: { mark: '🔕', hint: "raised MRs don't wake Claude" },
  pin: { mark: '☆', hint: 'pin to this session' },
  unpin: { mark: '★', hint: 'unpin from this session' },
  clear: { mark: '✕', hint: 'end the search' },
  close: { mark: '✕', hint: 'close what is open under the card' },
  seen: { mark: '✓', hint: 'mark seen' },
} as const

/** Some of the controls, each as its mark and hover. */
export type Control<K extends keyof typeof CONTROL> = (typeof CONTROL)[K]

/**
 * Cells a hover description may take. It draws from the start of the line under its block, so a longer one would run past
 * a narrow pane's edge; `tests/core/drawing.spec.ts` holds every description to it.
 */
export const HINT_ROOM = 36

/**
 * The desktop app draws nothing for a tree past 100,000 characters serialized (a 381,164-character one left the pane
 * blank). The engine adds up to about 6,000 of press handles and hover stamps to what this measures, so the app gets
 * about 91,000 at most: rows in order of what needs you, then avatars; an MR's page, drawn alone, fits its own.
 */
export const DRAWING_BUDGET = 85_000

/** Beside a search or a repo pick that narrows the list: a glyph and a word, drawn in the theme's blue. */
export const FILTERED = '⧩ filtered'

/**
 * What the tabs, repo filter, headings and footer take, with room to spare for a long list of repos, and the descriptions
 * of ↻, 🔔 and the search's ✕, about 600 characters each.
 */
export const CHROME_SIZE = 7_000

/** JSON.stringify answers `undefined` for a value with no JSON form, though its declared type says `string`. */
const lengthOf = (json: string | undefined): number => (json === undefined ? 0 : json.length)

/** A tree's size as the app receives it; one that cannot be serialized counts as `unreadable`, a whole budget by default. */
export const measure = (tree: unknown, unreadable = DRAWING_BUDGET): number => {
  try {
    const json = JSON.stringify(tree)
    return lengthOf(json) + groupsIn(json) * GROUP_STAMP
  } catch {
    return unreadable
  }
}

/** What the engine adds to every element in a hover group, saying whose group it is: a symbol and its description each. */
const GROUP_STAMP = ',"group":{"plugin":"gitlab-pane"}'.length

/** How many elements of a serialized tree join a hover group, as `lengthOf` reads a JSON that may be `undefined`. */
const groupsIn = (json: string | undefined): number => (json === undefined ? 0 : (json.match(/"scope":/gu)?.length ?? 0))

/**
 * The key of an MR's title button, which the pane scrolls back to after the MR's page. The desktop reports where only
 * elements it can press sit, so the card's own box is never found.
 */
export const titleKey = (mr: { iid: number; project: string }): string => `open-${mr.iid}-${shortHash(mr.project)}`
