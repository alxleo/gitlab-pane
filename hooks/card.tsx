import type { EngineInterface, RenderChildren } from 'claude-code'

import { CONTROL, LINK, opens } from './drawing'
import { face } from './faces'
import type { InboxRow } from './found-model'
import { hinted, hintLine, hintRoom, homed } from './hint'
import type { HomedKit } from './hint'
import type { Kit } from './kit'
import type { MergedRow } from './landed-model'
import { pressMove } from './moves'
import type { UnderBlock } from './page-lines'
import { openReading, openUnder } from './panes'
import { pressSuggested } from './reviewers'
import { togglePin } from './shared'
import type { RowModel } from './pane-model'
import { markWord, statusMark } from './status'
import { strip } from './strip'

import type { Under } from '../types'

/** The parts of a row the pane fits to its room. */
export type RowPart = 'line1' | 'line2' | 'faces' | 'said'

type Verdict = NonNullable<RowModel['verdict']>

/** GitLab's verdict in words, or nothing when the MR's move fixes the check it names and so says it. */
function verdictWords(kit: Kit, verdict: Verdict): RenderChildren[] {
  const { Text } = kit
  return verdict.move?.isVerdict === true
    ? []
    : [
        <Text weight={verdict.bold ? 'semibold' : undefined} color={verdict.tone}>
          {verdict.words}
        </Text>,
      ]
}

/**
 * The MR's one move: a Button while it can be pressed (primary once armed, asking for the press that confirms), dim words
 * while it is under way. On a merge, the head it takes follows it; then `trailing`, the blockers that trail a verdict the
 * move says; then why its last press failed, amber, so nothing before it moves when a failure comes or goes.
 */
function moveParts($: EngineInterface, kit: HomedKit, row: RowModel, move: Verdict['move'], trailing: string | null): RenderChildren[] {
  const { Text, Button, Link } = kit
  const press = move?.press ?? null
  return [
    ...(move === null
      ? []
      : [
          press !== null ? (
            <Button key={move.key} variant={move.isArmed ? 'primary' : 'secondary'} label={move.label} onPress={() => pressMove($, row.key, press)} />
          ) : (
            <Text dimColor>{move.label}</Text>
          ),
        ]),
    ...(row.head !== null ? [hinted(kit, `hint-head-${row.suffix}`, opens('commit'), <Link href={row.head.href}>{row.head.text}</Link>)] : []),
    ...(trailing !== null ? [<Text dimColor>{trailing}</Text>] : []),
    ...(move !== null && move.failed !== null ? [<Text color="warning">{move.failed}</Text>] : []),
  ]
}

/** What the ticket's link says under the pointer: where a click opens it, and where a ⌘ click does. */
const TICKET_SAYS = ['opens the ticket under the card', '⌘ click opens it in Jira']

/**
 * The ticket the title names: with a Jira site set, a link whose plain click opens the ticket under the card and whose ⌘,
 * ctrl or alt click opens it in Jira, as the Markdown element does with a link it answers; else its key, dim.
 */
function ticketLink($: EngineInterface, kit: Kit, row: RowModel, ticket: NonNullable<RowModel['ticket']>): RenderChildren {
  const { Text, Markdown } = kit
  return ticket.link !== null ? (
    <Markdown key={`ticket-${row.suffix}`} text={ticket.link} onLinkPress={() => openUnder($, row.key, 'ticket', ticket.key)} />
  ) : (
    <Text dimColor>{ticket.text}</Text>
  )
}

/**
 * What is open under a card, in place of a page: a person's say on the MR, newest comment first, or its ticket as Jira tells
 * it. The way on goes to the whole (the MR's page on that person, or the ticket in Jira); `✕` closes it, as a second press
 * on what opened it does.
 */
export function drawUnder($: EngineInterface, kit: HomedKit, row: RowModel, block: UnderBlock, open: Under, href: string | null): RenderChildren {
  const { Box, Text, Button, Link } = kit
  const close = hinted(
    kit,
    `hint-under-close-${row.suffix}`,
    CONTROL.close.hint,
    <Button key={`under-close-${row.suffix}`} plain dimColor label={CONTROL.close.mark} onPress={() => openUnder($, row.key, open.kind, open.id)} />
  )
  const heading = (
    <Box flexDirection="row" columnGap={1} alignItems="center">
      <Box flexGrow={1} flexShrink={1}>
        <Text weight="semibold">{block.heading}</Text>
      </Box>
      {close}
    </Box>
  )
  if (block.kind === 'person') {
    return (
      <Box key={`under-${row.suffix}`} flexDirection="column" paddingLeft={2} marginTop={1}>
        {heading}
        {block.latest !== null && <Text dimColor>{`newest, ${block.latest.label}:`}</Text>}
        {block.latest !== null && <Text>{block.latest.text}</Text>}
        {block.more !== null && <Button key={`under-more-${row.suffix}`} plain label={block.more} onPress={() => openReading($, row.key, open.id)} />}
      </Box>
    )
  }
  return (
    <Box key={`under-${row.suffix}`} flexDirection="column" paddingLeft={2} marginTop={1}>
      {heading}
      {block.lines.map(line => (
        <Text>{line}</Text>
      ))}
      {block.isReading && <Text dimColor>reading Jira…</Text>}
      {href !== null && hinted(kit, `hint-under-jira-${row.suffix}`, opens('jira'), <Link href={href}>{`${LINK.jira} open in Jira`}</Link>)}
    </Box>
  )
}

/**
 * One part of a row's card from the row model: its title line, its second line with or without pictures on the faces, and
 * the one comment it quotes. Only what the model decided is drawn here. Nothing on a card shows or hides on a hover but a
 * symbol's description, in the blank line under the card (`hinted`): what a press on a name or a ticket opens goes under the card, and
 * the MR's page, a press on the title away, holds the rest.
 */
export function drawPart($: EngineInterface, kit: HomedKit, row: RowModel, part: RowPart): RenderChildren {
  const { Box, Text, Button, Link } = kit
  const scope = (what: string) => `${what}-${row.suffix}`
  // The desktop app refuses a whole drawing over one element it does not take, so controls hold plain strings:
  // a Link's text and a Button's label, never styled Text inside them. The title opens the MR's page, so it is a plain
  // Button, not a link-blue title that reads as leaving for GitLab (🔀 !iid does that).
  switch (part) {
    case 'line1': {
      const { pin } = row
      return (
        <Box flexDirection="row" gap={1} alignItems="center">
          <Box flexGrow={1} flexShrink={1}>
            <Button key={row.titleKey} plain label={row.title} onPress={() => openReading($, row.key)} />
          </Box>
          <Text dimColor size="footnote">
            {row.ago}
          </Text>
          {/* The star at the top right, as anywhere else, dim while hollow: the label alone, which the desktop app draws. */}
          {pin !== null &&
            hinted(
              kit,
              scope('hint-pin'),
              pin.hint,
              <Button key={pin.key} plain dimColor={pin.mark === CONTROL.pin.mark} label={pin.mark} onPress={() => togglePin($, pin.press, pin.mr)} />
            )}
        </Box>
      )
    }
    case 'line2':
    case 'faces': {
      const withPictures = part === 'faces'
      const said = row.verdict !== null ? verdictWords(kit, row.verdict) : []
      // What trails the verdict follows its words; where the move says the verdict, it follows the move.
      const trailing = row.verdict?.trailing ?? null
      const lead = moveParts($, kit, row, row.verdict?.move ?? null, said.length > 0 ? null : trailing)
      return (
        <Box flexDirection="row" flexWrap="wrap" columnGap={2} paddingLeft={2}>
          {/* The move leads the line, so it is in one place on every card and across reads, whatever the links and ages say. */}
          {lead.length > 0 && (
            <Box flexDirection="row" gap={1} alignItems="center" flexShrink={0}>
              {lead}
            </Box>
          )}
          {/* A Link takes no flex props, so this box keeps the links whole when the line wraps. */}
          <Box flexDirection="row" gap={1} flexShrink={0}>
            {hinted(kit, scope('hint-mr'), opens('mr'), <Link href={row.mr.href}>{row.mr.text}</Link>)}
            {row.ticket !== null &&
              (row.ticket.link !== null ? hinted(kit, scope('hint-ticket'), TICKET_SAYS, ticketLink($, kit, row, row.ticket)) : ticketLink($, kit, row, row.ticket))}
            {row.repo !== null && hinted(kit, scope('hint-repo'), opens('repo'), <Link href={row.repo.href}>{row.repo.text}</Link>)}
          </Box>
          {/* The strip says its stages, a line each, once the pointer rests on it. */}
          {row.strip !== null && hinted(kit, scope('hint-strip'), row.strip.hint, strip(kit, row.strip))}
          {row.pipeline !== null
            ? hinted(kit, scope('hint-pipeline'), opens('pipeline'), <Link href={row.pipeline.href}>{row.pipeline.text}</Link>)
            : noPipeline(kit, scope('hint-pipeline'))}
          {row.verdict !== null
            ? said.length > 0 && (
                <Box flexDirection="row" gap={1} alignItems="center" flexShrink={0}>
                  {said}
                  {trailing !== null && <Text dimColor>{trailing}</Text>}
                </Box>
              )
            : row.blocker !== null && (
                <Box flexShrink={0}>
                  <Text color={row.blocker.tone}>{row.blocker.text}</Text>
                </Box>
              )}
          {/* A name opens what that person says on the MR under the card, the list staying where it is; a second press closes
              it. The face or the name says where they stand. */}
          {row.people.map(person =>
            hinted(
              kit,
              scope(`hint-person-${person.username}`),
              person.hint,
              <Box flexDirection="row" alignItems="center" flexShrink={0}>
                {face(kit, person, withPictures)}
                <Button key={scope(`person-${person.username}`)} plain label={person.label} onPress={() => openUnder($, row.key, 'person', person.username)} />
              </Box>
            )
          )}
          {/* Someone suggested as a reviewer, faded: `+` and their name arms adding them, and armed, a second press adds them. */}
          {row.suggested.flatMap(person => {
            const { does, isArmed, failed } = person.press
            const press = () => {
              if (does !== null) {
                pressSuggested($, row.key, person.username, does)
              }
            }
            return [
              hinted(
                kit,
                scope(`hint-suggest-${person.username}`),
                person.hint,
                <Box flexDirection="row" alignItems="center" flexShrink={0}>
                  {face(kit, person, withPictures)}
                  {does === null ? (
                    <Text dimColor>{person.label}</Text>
                  ) : isArmed ? (
                    <Button key={person.key} variant="primary" label={person.label} onPress={press} />
                  ) : (
                    <Button key={person.key} plain dimColor label={person.label} onPress={press} />
                  )}
                </Box>
              ),
              ...(failed !== null ? [<Text color="warning">{failed}</Text>] : []),
            ]
          })}
        </Box>
      )
    }
    case 'said':
    default: {
      const { said } = row
      return said !== null ? (
        <Box paddingLeft={2}>
          <Button key={scope('said')} plain label={said.label} onPress={() => openUnder($, row.key, 'person', said.username)} />
        </Box>
      ) : null
    }
  }
}

/** No pipeline: its mark, which says so under the pointer, or the words where nothing hovers. */
function noPipeline(kit: HomedKit, key: string): RenderChildren {
  const { Text } = kit
  const { glyph, tone } = statusMark(undefined)
  return kit.showsHints ? hinted(kit, key, markWord(undefined), <Text color={tone}>{glyph}</Text>) : <Text dimColor>{markWord(undefined)}</Text>
}

/** An inbox MR a search found: its link, then its repo and who wrote it, dim. */
export function drawFound(listKit: Kit, row: InboxRow): RenderChildren {
  const kit = homed(listKit, row.boxKey)
  const { Box, Text, Link } = kit
  return (
    <Box key={row.boxKey} flexDirection="row" flexWrap="wrap" columnGap={2} paddingLeft={2} marginBottom={hintRoom(kit)}>
      {/* A Link takes no flex props, so this box keeps it whole when the line wraps. */}
      <Box flexShrink={0}>{hinted(kit, `hint-${row.boxKey}`, opens('mr'), <Link href={row.mr.href}>{row.mr.text}</Link>)}</Box>
      <Text dimColor size="footnote">
        {row.about}
      </Text>
      {hintLine(kit)}
    </Box>
  )
}

/**
 * One MR merged lately, a line: its link, how long ago it merged, and the build GitLab ran on the commit that landed, a mark in the
 * colour of its status with its pipeline's link, as a card's pipeline is. A merge whose commit could not be told says so and has
 * no mark, never a guessed one.
 */
export function drawMerged(listKit: Kit, row: MergedRow): RenderChildren {
  const kit = homed(listKit, row.boxKey)
  const { Box, Text, Link } = kit
  const { build } = row
  return (
    <Box key={row.boxKey} flexDirection="row" flexWrap="wrap" columnGap={2} paddingLeft={2} marginBottom={hintRoom(kit)}>
      {/* A Link takes no flex props, so this box keeps it whole when the line wraps. */}
      <Box flexShrink={0}>{hinted(kit, `hint-mr-${row.boxKey}`, opens('mr'), <Link href={row.mr.href}>{row.mr.text}</Link>)}</Box>
      <Text dimColor size="footnote">
        {row.ago}
      </Text>
      {build.kind === 'unknown' ? (
        <Text dimColor>{build.words}</Text>
      ) : (
        <Box flexDirection="row" gap={1} flexShrink={0}>
          {hinted(kit, `hint-build-${row.boxKey}`, build.word, <Text color={build.tone}>{build.glyph}</Text>)}
          {/* Under the pointer the mark says there is none; where nothing hovers, the words do. */}
          {build.link !== null
            ? hinted(kit, `hint-pipeline-${row.boxKey}`, opens('pipeline'), <Link href={build.link.href}>{build.link.text}</Link>)
            : !kit.showsHints && <Text dimColor>{build.word}</Text>}
        </Box>
      )}
      {hintLine(kit)}
    </Box>
  )
}
