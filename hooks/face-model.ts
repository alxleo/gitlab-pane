// A person's face as plain data: the Svg source for it with and without their picture, and the mark a surface that draws
// no Svg uses. Pure; the draw layer only puts the source in an Svg. Built once for a card, until the card or a picture changes.
import { personTone } from './attention.ts'
import { BOT_MARKS, discMarks } from './avatar.ts'
import { STAGE_COLOURS } from './status.ts'
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

/** The corner badge on a reviewer's face, and their mark where no Svg is drawn. */
const REVIEW_MARK: Record<PersonState, { glyph: string; tone: Tone; path: string } | null> = {
  approved: { glyph: '✓', tone: 'success', path: 'M13.1 14.9l1.1 1.1 2.1-2.2' },
  requested_changes: { glyph: '✕', tone: 'error', path: 'M13.5 13.5l2.5 2.5m0-2.5l-2.5 2.5' },
  reviewing: null,
  commented: null,
  unreviewed: null,
}

export type FaceFacts = {
  tone: Tone
  /** The badge's glyph, the person's mark where no Svg is drawn; null for someone without a badge. */
  badge: string | null
  alt: string
  /** Their initials on a disc, or a robot. */
  plain: SvgSource
  /** Their GitLab avatar in place of the disc; null without one. */
  picture: SvgSource | null
}

/**
 * Their avatar, else their initials on a disc (a bot's, a robot), ringed in the colour of where they stand: heavy
 * once they have a say, thin while they have none, with a ✓ or ✕ badge for an approval or a request for changes. A disc
 * costs about 340 characters (500 with a badge), a picture about 1,300.
 */
export function faceFacts(person: Person, picture: string | undefined): FaceFacts {
  const tone = personTone(person)
  const badge = REVIEW_MARK[person.state]
  const ring =
    tone === 'subtle'
      ? svg`<circle cx='8' cy='8' r='9' fill='none' stroke='${STAGE_COLOURS[tone]}' stroke-width='1.5'/>`
      : svg`<circle cx='8' cy='8' r='9.5' fill='none' stroke='${STAGE_COLOURS[tone]}' stroke-width='3'/>`
  const mark =
    badge !== null
    ? svg`<circle cx='14.75' cy='14.75' r='3.75' fill='${STAGE_COLOURS[badge.tone]}' stroke='#fff'/><path d='${badge.path}' fill='none' stroke='#fff' stroke-width='1.3' stroke-linecap='round'/>`
    : svg``
  // The face is 16 pixels at the origin; the view's 3-pixel margin holds the ring and the badge.
  const around = (inner: SvgSource): SvgSource =>
    svg`<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='-3 -3 22 22'>${raw(inner)}${raw(ring)}${raw(mark)}</svg>`
  const disc = person.isBot ? BOT_MARKS : discMarks(person.username, 16, person.initials)
  return {
    tone,
    badge: badge?.glyph ?? null,
    alt: badge !== null ? `${person.name}, ${REVIEW_STATE[person.state]}` : person.name,
    plain: around(disc),
    picture:
      picture !== undefined && picture !== ''
        ? around(svg`<clipPath id='c'><circle cx='8' cy='8' r='8'/></clipPath><image href='${picture}' width='16' height='16' clip-path='url(#c)'/>`)
        : null,
  }
}
