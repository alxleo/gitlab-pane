import { BOT_MARKS, discMarks } from './avatar'
import { personTone } from './attention'
import { plural } from './format'
import type { Kit } from './kit'
import { noteKind, noteLine } from './notes'
import { raw, svg } from './svg'
import { STAGE_COLOURS, type Tone } from './status'

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

/**
 * Their avatar, else their initials on a disc (a bot's, a robot), ringed in the colour of where they stand: heavy
 * once they have a say, thin while they have none, with a ✓ or ✕ badge for an approval or a request for changes. A
 * coloured mark where the surface draws no Svg. A disc costs about 340 characters (500 with a badge), a picture about
 * 1,300.
 */
export function face(kit: Kit, person: Person, isFocused: boolean, picture: string | undefined) {
  const { Svg, Text } = kit
  const tone = personTone(person)
  const badge = REVIEW_MARK[person.state]
  if (Svg === undefined) {
    return <Text color={tone}>{badge?.glyph ?? (isFocused ? '◉' : '●')}</Text>
  }
  // The face is 16 pixels at the origin; the view's 3-pixel margin holds the ring and the badge.
  const inner =
    picture !== undefined && picture !== ''
      ? svg`<clipPath id='c'><circle cx='8' cy='8' r='8'/></clipPath><image href='${picture}' width='16' height='16' clip-path='url(#c)'/>`
      : person.isBot
        ? BOT_MARKS
        : discMarks(person.username, 16, person.initials)
  const ring =
    tone === 'subtle'
      ? svg`<circle cx='8' cy='8' r='9' fill='none' stroke='${STAGE_COLOURS[tone]}' stroke-width='1.5'/>`
      : svg`<circle cx='8' cy='8' r='9.5' fill='none' stroke='${STAGE_COLOURS[tone]}' stroke-width='3'/>`
  const mark = badge !== null
    ? svg`<circle cx='14.75' cy='14.75' r='3.75' fill='${STAGE_COLOURS[badge.tone]}' stroke='#fff'/><path d='${badge.path}' fill='none' stroke='#fff' stroke-width='1.3' stroke-linecap='round'/>`
    : svg``
  return (
    <Svg
      width={22}
      height={22}
      alt={badge !== null ? `${person.name}, ${REVIEW_STATE[person.state]}` : person.name}
      source={svg`<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='-3 -3 22 22'>${raw(inner)}${raw(ring)}${raw(mark)}</svg>`}
    />
  )
}

/** What a hover on a person's face shows: who they are, where they stand, their latest comment. */
export function personCard(kit: Kit, person: Person) {
  const { Box, Text } = kit
  const latest = person.notes[0]
  // A name written like the handle ("Mel.Northcote") would say it twice.
  const isHandle = person.name.toLowerCase() === person.username.toLowerCase()
  const standing = [REVIEW_STATE[person.state], person.openThreads > 0 ? plural(person.openThreads, 'open thread') : ''].filter(part => part !== '')
  return [
    <Box flexDirection="row" gap={1}>
      <Text bold>{person.name}</Text>
      {(person.isBot || !isHandle) && <Text dimColor>{person.isBot ? 'bot' : `@${person.username}`}</Text>}
    </Box>,
    <Text color={personTone(person)}>{standing.join(' · ')}</Text>,
    ...(latest !== undefined ? [noteLine(kit, latest, noteKind(latest))] : []),
    <Box marginTop={latest !== undefined ? 1 : 0}>
      <Text dimColor>
        {person.notes.length > 1 ? `Click their name for all ${person.notes.length} comments.` : person.notes.length === 1 ? 'Click their name to read it whole.' : 'No comments.'}
      </Text>
    </Box>,
  ]
}
