// A person's face as plain data: the Svg source for it with and without their picture, and the mark a surface that draws
// no Svg uses; who a card suggests adding as a reviewer, faded, and what the press beside them says. Pure; the draw layer
// only puts the source in an Svg. Built once for a card, until the card or a picture changes.
import { BOT_MARKS, discMarks } from './avatar'
import { drawnLine, plural, withoutInvisibleMarks } from './format'
import { initials, shortHash } from './identity'
import { followingTheme, PAGE, themePaint, TONE_COLOURS } from './status'
import type { Shades, Tone } from './status'
import { raw, svg } from './svg'
import type { RawSvg, SvgSource } from './svg'
import { ARMED_MS, SENT_HOLDS_MS } from './write-model'

import type { MrCard, Person, PersonState, Suggestion, Suggestions, Write } from '../types'

export const REVIEW_STATE: Record<PersonState, string> = {
  approved: 'approved',
  requested_changes: 'requested changes',
  reviewing: 'reviewing',
  commented: 'commented',
  unreviewed: 'not reviewed yet',
}

/** What a badge draws: a disc with a stroked path (✓, ✕) or a question mark on it, a speech bubble, or an empty dashed dot. */
type BadgeDrawing = { kind: 'stroke'; path: string } | { kind: 'question' } | { kind: 'bubble' } | { kind: 'empty' }
type Mark = { glyph: string; tone: Tone; drawing: BadgeDrawing }

/**
 * The corner badge on a reviewer's face, saying where they stand by its glyph and not by colour alone, and their mark
 * where no Svg is drawn: approved, asked for changes, looked without a verdict, or not looked yet.
 */
export const REVIEW_MARK: Record<PersonState, Mark> = {
  approved: { glyph: '✓', tone: 'success', drawing: { kind: 'stroke', path: 'M12.6 14.6l1.3 1.3 2.6-2.7' } },
  requested_changes: { glyph: '✕', tone: 'error', drawing: { kind: 'stroke', path: 'M13 13l3 3m0-3l-3 3' } },
  reviewing: { glyph: '?', tone: 'subtle', drawing: { kind: 'question' } },
  commented: { glyph: '?', tone: 'subtle', drawing: { kind: 'question' } },
  unreviewed: { glyph: '◌', tone: 'subtle', drawing: { kind: 'empty' } },
}

/**
 * The badge of someone holding an open thread: the MR waits on their discussion being resolved, which the MR's own words
 * say as a whole and this says of the person. A request for changes outranks it; it outranks an approval, which the open
 * thread still holds back.
 */
export const THREAD_MARK: Mark = { glyph: '💬', tone: 'warning', drawing: { kind: 'bubble' } }

/**
 * The badge of someone suggested as a reviewer, on their faded face: ＋, as a press adds them. Grey, as it is no stand of
 * theirs: the glyph and the words under the pointer say it.
 */
export const SUGGESTED_MARK: Mark = { glyph: '+', tone: 'subtle', drawing: { kind: 'stroke', path: 'M14.5 12.4v4.2m-2.1-2.1h4.2' } }

/** The badge a person wears: a request for changes, else an open thread, else where their review stands. */
const markOf = (person: Person): Mark => (person.state !== 'requested_changes' && person.openThreads > 0 ? THREAD_MARK : REVIEW_MARK[person.state])

export type FaceFacts = {
  tone: Tone
  /** The badge's glyph, the person's mark where no Svg is drawn. */
  glyph: string
  /** What the badge says, in the Badge table's words: the face's description under the pointer, a line each. */
  hint: string | readonly string[]
  alt: string
  /** Their initials on a disc, or a robot. */
  plain: SvgSource
  /** Their GitLab avatar in place of the disc; null without one. */
  picture: SvgSource | null
}

/**
 * The badge in the face's corner, cut out of the avatar by an edge in the pane's background. On a filled disc the glyph is
 * drawn in the background colour too: white on the vivid light shades, near black on the bright dark ones, so it keeps
 * 4.5:1 in either theme where a white glyph on a bright dark shade would not.
 */
function badgeOf({ tone, drawing }: Mark): SvgSource {
  switch (drawing.kind) {
    case 'bubble':
      return svg`<path d='M11.3 10.6h6.4a1.4 1.4 0 0 1 1.4 1.4v3.4a1.4 1.4 0 0 1-1.4 1.4h-3.2l-2.2 2v-2h-1a1.4 1.4 0 0 1-1.4-1.4v-3.4a1.4 1.4 0 0 1 1.4-1.4z' ${themePaint([
        ['fill', TONE_COLOURS[tone]],
        ['stroke', PAGE],
      ])} stroke-width='1.2' stroke-linejoin='round'/>`
    case 'stroke':
      return svg`<circle cx='14.5' cy='14.5' r='4.5' ${themePaint([
        ['fill', TONE_COLOURS[tone]],
        ['stroke', PAGE],
      ])} stroke-width='1.2'/><path d='${drawing.path}' fill='none' ${themePaint([['stroke', PAGE]])} stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/>`
    case 'question':
      return svg`<circle cx='14.5' cy='14.5' r='4.5' ${themePaint([
        ['fill', TONE_COLOURS[tone]],
        ['stroke', PAGE],
      ])} stroke-width='1.2'/><text x='14.5' y='16.8' font-family='system-ui' font-size='6.5' font-weight='800' text-anchor='middle' ${themePaint([['fill', PAGE]])}>?</text>`
    case 'empty':
    default:
      return svg`<circle cx='14.5' cy='14.5' r='3.6' ${themePaint([
        ['fill', PAGE],
        ['stroke', TONE_COLOURS[tone]],
      ])} stroke-width='1.3' stroke-dasharray='1.6 1.2'/>`
  }
}

/** The face with what goes around it, as `around` draws it: their disc (a bot's, a robot), and their avatar where there is one. */
function drawn(person: Person, picture: string | undefined, around: (inner: SvgSource) => SvgSource): Pick<FaceFacts, 'plain' | 'picture'> {
  return {
    plain: around(person.isBot ? BOT_MARKS : discMarks(person.username, 16, person.initials)),
    picture:
      picture !== undefined && picture !== ''
        ? around(svg`<clipPath id='c'><circle cx='8' cy='8' r='8'/></clipPath><image href='${picture}' width='16' height='16' clip-path='url(#c)'/>`)
        : null,
  }
}

/** The face is 16 pixels at the origin; the view's 3-pixel margin holds the badge, and keeps a face without one the same size. */
const framed = (inner: RawSvg): SvgSource => svg`<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='-3 -3 22 22'>${inner}</svg>`

/**
 * Their avatar, else their initials on a disc (a bot's, a robot), with a badge in its corner for where they stand. A
 * disc costs about 600 characters with its badge's two shades, a picture about 1,500.
 */
export function faceFacts(person: Person, picture: string | undefined): FaceFacts & { hint: string } {
  const mark = markOf(person)
  const badge = badgeOf(mark)
  const hint = `${REVIEW_STATE[person.state]}${mark === THREAD_MARK ? `, ${plural(person.openThreads, 'open thread')}` : ''}`
  return {
    tone: mark.tone,
    glyph: mark.glyph,
    hint,
    alt: `${person.name}, ${hint}`,
    ...drawn(person, picture, inner => framed(followingTheme(raw([inner, badge])))),
  }
}

// ---- Suggested reviewers ------------------------------------------------------------------------------------------------

/**
 * The veil over a suggested face, washing it out: white at 55% in the light theme, the dark theme's dim grey at 45% in
 * the dark one. Faded means suggested and nothing else in the pane: someone not on the MR yet, whom a press adds. A fade
 * toward the pane's background read pale on white but muddy on the dark pane, where it drowned the initials and darkened
 * a picture almost to the background (seen in the app's own engine), so the dark theme washes toward a lighter shade.
 * Its badge, ＋, sits over the veil, as sharp as any other badge.
 */
const VEIL: Shades = { light: `${PAGE.light}8c`, dark: `${TONE_COLOURS.subtle.dark}73` }

/** What a suggested face says first under the pointer: that it is a suggestion, and what a press does. */
export const SUGGESTED_SAYS = 'suggested reviewer: press to add'

/**
 * A person suggested as a reviewer: their face faded, badged ＋, and under the pointer, why them, a line each (`why`).
 * About 700 characters, a picture 1,600.
 */
export function suggestedFace(person: Person, picture: string | undefined, why: readonly string[]): FaceFacts {
  const veil = svg`<circle cx='8' cy='8' r='8' ${themePaint([['fill', VEIL]])}/>`
  const badge = badgeOf(SUGGESTED_MARK)
  return {
    tone: SUGGESTED_MARK.tone,
    glyph: SUGGESTED_MARK.glyph,
    hint: [SUGGESTED_SAYS, ...why],
    alt: `${person.name}, suggested reviewer`,
    ...drawn(person, picture, inner => framed(followingTheme(raw([inner, veil, badge])))),
  }
}

/** Why someone is suggested, a line each: the approval rule that names them, and how many of the last `outOf` merged MRs they approved. */
export function suggestionWhy(suggestion: Suggestion, outOf: number): string[] {
  return [...(suggestion.team !== null ? [suggestion.team] : []), ...(suggestion.approved > 0 ? [`approved ${suggestion.approved} of the last ${outOf} here`] : [])]
}

/** No one to suggest. */
export const NO_SUGGESTIONS: Suggestions = { outOf: 0, people: [] }

/** Someone a card suggests as a reviewer, and why them (`suggestionWhy`). */
export type SuggestedPerson = Person & { why: string[] }

/** The most suggested faces a card draws: a choice of two, not a list of everyone a rule names. */
export const SUGGESTED_MOST = 2

/** A review asked for that has no verdict yet: that reviewer may still give one of the approvals the MR needs. */
export const isAwaited = (reviewer: MrCard['reviewers'][number]): boolean => !reviewer.isBot && reviewer.state !== 'approved' && reviewer.state !== 'requested_changes'

/**
 * How many reviewers a card suggests adding: the approvals it still needs, less the reviews asked for that have no
 * verdict yet, at most SUGGESTED_MOST. None on a draft or a closed MR, nor on one whose reviewers can give every approval
 * it needs: the pane suggests only where a review is missing. A comment is no review asked for, and the author's own
 * gives no approval the MR counts (a shared card leaves the author out of its reviewers).
 */
export function suggestionRoom(card: MrCard): number {
  if (!card.isOpen || card.isDraft) {
    return 0
  }
  const awaited = card.reviewers.filter(reviewer => reviewer.username !== card.author && isAwaited(reviewer))
  return Math.max(0, Math.min(SUGGESTED_MOST, card.approvalsLeft - awaited.length))
}

/**
 * What a read does about whom GitLab suggests for an MR with room for a reviewer, by who the `user` is on its host: ask
 * for an MR they wrote; keep what it held while the user is not known yet (the inbox has not read since the mod loaded),
 * so a reload neither drops the faces nor asks again for each; else none. Asking for reviews is the author's: an MR of
 * someone else's pinned here suggests no one.
 */
export function suggestionsFor(card: MrCard, user: string | null): 'ask' | 'keep' | 'none' {
  if (suggestionRoom(card) === 0) {
    return 'none'
  }
  if (user === null) {
    return 'keep'
  }
  return user === card.author ? 'ask' : 'none'
}

/**
 * The people a card suggests adding as reviewers, best first (`rankSuggestions`): those suggested, less the author, bots
 * and anyone already on the MR, as many as there is room for, each with why them. Their initials are told apart from
 * those of the people on the card.
 */
export function suggestedOf(card: MrCard, suggestions: Suggestions): SuggestedPerson[] {
  const on = new Set([card.author, ...card.people.map(person => person.username), ...card.reviewers.map(reviewer => reviewer.username)])
  const taken = new Set(card.people.map(person => person.initials))
  return suggestions.people
    .filter(each => !each.isBot && !on.has(each.username))
    .slice(0, suggestionRoom(card))
    .map(each => {
      const plain = initials(each.name, each.username)
      return {
        username: each.username,
        name: each.name,
        isBot: false,
        initials: taken.has(plain) ? initials(each.name, each.username, true) : plain,
        avatarUrl: each.avatarUrl,
        state: 'unreviewed',
        openThreads: 0,
        notes: [],
        noteCount: 0,
        why: suggestionWhy(each, suggestions.outOf),
      }
    })
}

/** What the ledger's ids of adding reviewers start with (writes.ts). */
const REVIEWER_IDS = 'reviewer:'

/** The ledger's id of adding `username` as a reviewer of the card `key`; with no username, what each on that card starts with. */
export const reviewerId = (key: string, username: string): string => `${REVIEWER_IDS}${key}:${username}`

/** Whether the ledger keeps entry `id` when an add is recorded: another feature's always, an add while its MR is `listed`. */
export const isAddKept = (id: string, listed: readonly string[]): boolean => !id.startsWith(REVIEWER_IDS) || listed.some(key => id.startsWith(reviewerId(key, '')))

/** What a suggested face's press says and does, by the entry the ledger holds for it. */
export type SuggestedPress = { label: string; does: 'arm' | 'make' | null; isArmed: boolean; failed: string | null }

/**
 * The press beside a suggested face at `now`, `call` being what the card calls them: `add` and their name arms it, the
 * face's ＋ saying the same; armed, it says what a second press does, which adds them; while it is out it says so, with
 * nothing to press. Once GitLab has added them (`handed`) it says so until a read shows them as a reviewer, which takes a
 * read, never as long as a sent write is followed. One that did not take says why beside it, until it is pressed again.
 */
export function suggestedPress(call: string, held: Write | undefined, now: number): SuggestedPress {
  if (held?.state === 'sent') {
    return { label: `adding ${call}…`, does: null, isArmed: false, failed: null }
  }
  if (held?.state === 'handed' && now - held.at < SENT_HOLDS_MS) {
    return { label: `${call} added`, does: null, isArmed: false, failed: null }
  }
  // An arm past its time has run out whether or not its timer ran, as `confirmedPress` judges it.
  const isArmed = held?.state === 'armed' && now - held.at <= ARMED_MS
  return {
    label: isArmed ? `add ${call} as a reviewer? press again` : `add ${call}?`,
    does: isArmed ? 'make' : 'arm',
    isArmed,
    failed: held?.state === 'failed' ? held.say : null,
  }
}

// ---- Faces on a row -------------------------------------------------------------------------------------------------------

/** A person on a card, with their face: what a row draws of them. */
export type PersonFacts = {
  username: string
  isBot: boolean
  initials: string
  openThreads: number
  /** A first name where it is clear, else the initials; `initials` is what a surface without pictures uses. */
  call: string
  face: FaceFacts
}

/** A face as a row draws it, with the name beside it. */
export type PersonRow = {
  username: string
  /** The name beside the face, with the open threads they hold. */
  label: string
  tone: Tone
  /** The mark a surface without Svg draws. */
  glyph: string
  /** What the face's badge says, under the pointer, a line each. */
  hint: string | readonly string[]
  alt: string
  plain: SvgSource
  picture: SvgSource | null
}

/** Someone the row suggests adding as a reviewer: their faded face, and the press beside it (`suggestedPress`). */
export type SuggestedRow = PersonRow & { key: string; press: SuggestedPress }

/**
 * A card's faces as its row draws them: the people on it, each named with the open threads they hold, then those it
 * suggests, each with their press as this session's add of them holds at `now` in the ledger of `writes`. Beside a face
 * that already shows the initials, a first name reads better; two of the same name keep their initials. On a surface
 * without pictures, an add button still says the first name, with the username when the name is shared.
 */
export function faceRows(
  facts: { people: readonly PersonFacts[]; suggested: readonly PersonFacts[] },
  row: { hasSvg: boolean; writes: Readonly<Record<string, Write>>; key: string; suffix: string; now: number }
): { people: PersonRow[]; suggested: SuggestedRow[] } {
  const people = [...facts.people, ...facts.suggested]
  const names = people.map(person => (row.hasSvg ? person.call : person.initials))
  const callOf = (person: PersonFacts): string => {
    const name = row.hasSvg ? person.call : person.initials
    return names.filter(each => each === name).length > 1 ? person.initials : name
  }
  const terminalName = (person: PersonFacts): string => {
    const visible = drawnLine(withoutInvisibleMarks(person.call))
    // A name made entirely of joiners or variation selectors has no recipient to read.
    if (/[^\p{Default_Ignorable_Code_Point}\s]/u.test(visible)) {
      return visible
    }
    const username = drawnLine(withoutInvisibleMarks(person.username))
    return username === '' ? person.initials : `@${username}`
  }
  const drawnAs = (person: PersonFacts, label: string): PersonRow => ({
    username: person.username,
    label,
    tone: person.face.tone,
    glyph: person.face.glyph,
    hint: person.face.hint,
    alt: person.face.alt,
    plain: person.face.plain,
    picture: person.face.picture,
  })
  return {
    people: facts.people.map(person => drawnAs(person, `${callOf(person)}${person.openThreads > 0 ? ` ${person.openThreads}` : ''}`)),
    suggested: facts.suggested.map(person => {
      let name = callOf(person)
      if (!row.hasSvg) {
        const visible = terminalName(person)
        const shared = people.some(other => other.username !== person.username && terminalName(other) === visible)
        name = shared ? `${visible} (@${person.username})` : visible
      }
      const press = suggestedPress(name, row.writes[reviewerId(row.key, person.username)], row.now)
      return { ...drawnAs(person, press.label), key: `suggest-${shortHash(person.username)}-${row.suffix}`, press }
    }),
  }
}
