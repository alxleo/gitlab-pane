// A person's face as plain data: the Svg source for it with and without their picture, and the mark a surface that draws
// no Svg uses. Pure; the draw layer only puts the source in an Svg. Built once for a card, until the card or a picture changes.
import { BOT_MARKS, discMarks } from './avatar.ts'
import { followingTheme, PAGE, themePaint, TONE_COLOURS } from './status.ts'
import type { Tone } from './status.ts'
import { raw, svg } from './svg.ts'
import type { SvgSource } from './svg.ts'

import type { Person, PersonState } from '../types'

export const REVIEW_STATE: Record<PersonState, string> = {
  approved: 'approved',
  requested_changes: 'requested changes',
  reviewing: 'reviewing',
  commented: 'commented',
  unreviewed: 'not reviewed yet',
}

/** What a badge draws on its disc: a stroked path (✓, ✕), a question mark, or nothing on an empty dashed dot. */
type BadgeDrawing = { kind: 'stroke'; path: string } | { kind: 'question' } | { kind: 'empty' }

/**
 * The corner badge on a reviewer's face, saying where they stand by its glyph and not by colour alone, and their mark
 * where no Svg is drawn: approved, asked for changes, looked without a verdict, or not looked yet.
 */
export const REVIEW_MARK: Record<PersonState, { glyph: string; tone: Tone; drawing: BadgeDrawing }> = {
  approved: { glyph: '✓', tone: 'success', drawing: { kind: 'stroke', path: 'M12.6 14.6l1.3 1.3 2.6-2.7' } },
  requested_changes: { glyph: '✕', tone: 'error', drawing: { kind: 'stroke', path: 'M13 13l3 3m0-3l-3 3' } },
  reviewing: { glyph: '?', tone: 'subtle', drawing: { kind: 'question' } },
  commented: { glyph: '?', tone: 'subtle', drawing: { kind: 'question' } },
  unreviewed: { glyph: '◌', tone: 'subtle', drawing: { kind: 'empty' } },
}

export type FaceFacts = {
  tone: Tone
  /** The badge's glyph, the person's mark where no Svg is drawn. */
  glyph: string
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
function badgeOf({ tone, drawing }: (typeof REVIEW_MARK)[PersonState]): SvgSource {
  switch (drawing.kind) {
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

/**
 * Their avatar, else their initials on a disc (a bot's, a robot), with a badge in its corner for where they stand. A
 * disc costs about 600 characters with its badge's two shades, a picture about 1,500.
 */
export function faceFacts(person: Person, picture: string | undefined): FaceFacts {
  const mark = REVIEW_MARK[person.state]
  const badge = badgeOf(mark)
  // The face is 16 pixels at the origin; the view's 3-pixel margin holds the badge.
  const around = (inner: SvgSource): SvgSource =>
    svg`<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='-3 -3 22 22'>${followingTheme(raw([inner, badge]))}</svg>`
  const disc = person.isBot ? BOT_MARKS : discMarks(person.username, 16, person.initials)
  return {
    tone: mark.tone,
    glyph: mark.glyph,
    alt: `${person.name}, ${REVIEW_STATE[person.state]}`,
    plain: around(disc),
    picture:
      picture !== undefined && picture !== ''
        ? around(svg`<clipPath id='c'><circle cx='8' cy='8' r='8'/></clipPath><image href='${picture}' width='16' height='16' clip-path='url(#c)'/>`)
        : null,
  }
}
