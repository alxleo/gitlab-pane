import type { EngineInterface, RenderChildren } from 'claude-code'

import { face } from './faces'
import type { Kit } from './kit'
import { pressMove } from './moves'
import { openReading } from './panes'
import { togglePin } from './shared'
import type { RowModel } from './pane-model'
import { strip } from './strip'

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
function moveParts($: EngineInterface, kit: Kit, row: RowModel, move: Verdict['move'], trailing: string | null): RenderChildren[] {
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
    ...(row.head !== null ? [<Link href={row.head.href}>{row.head.text}</Link>] : []),
    ...(trailing !== null ? [<Text dimColor>{trailing}</Text>] : []),
    ...(move !== null && move.failed !== null ? [<Text color="warning">{move.failed}</Text>] : []),
  ]
}

/**
 * One part of a row's card from the row model: its title line, its second line with or without pictures on the faces, and
 * the one comment it quotes. Only what the model decided is drawn here. Nothing on a card shows or hides on a hover: the
 * MR's page, a press on the title away, holds the rest of it.
 */
export function drawPart($: EngineInterface, kit: Kit, row: RowModel, part: RowPart): RenderChildren {
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
          {/* A quiet row is this line alone: what it waits on goes beside its title, with GitLab's own merge once checks pass. */}
          {row.isQuiet && row.verdict !== null && (
            <Box flexDirection="row" gap={1} alignItems="center" flexShrink={0}>
              {verdictWords(kit, row.verdict)}
              {moveParts($, kit, row, row.verdict.move, null)}
            </Box>
          )}
          {row.isQuiet && row.verdict === null && row.blocker !== null && (
            <Box flexShrink={0}>
              <Text dimColor>{row.blocker.text}</Text>
            </Box>
          )}
          <Text dimColor size="footnote">
            {row.ago}
          </Text>
          {/* The star at the top right, as anywhere else, dim while hollow: the label alone, which the desktop app draws. */}
          {pin !== null && <Button key={pin.key} plain dimColor={pin.mark === '☆'} label={pin.mark} onPress={() => togglePin($, pin.press, pin.mr)} />}
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
            <Link href={row.mr.href}>{row.mr.text}</Link>
            {row.ticket !== null && (row.ticket.href !== null ? <Link href={row.ticket.href}>{row.ticket.text}</Link> : <Text dimColor>{row.ticket.text}</Text>)}
            {row.repo !== null && <Link href={row.repo.href}>{row.repo.text}</Link>}
          </Box>
          {row.strip !== null && strip(kit, row.strip)}
          {row.pipeline !== null ? <Link href={row.pipeline.href}>{row.pipeline.text}</Link> : <Text dimColor>no pipeline</Text>}
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
          {/* A name opens the MR's page on that person's comments alone. */}
          {row.people.map(person => (
            <Box flexDirection="row" alignItems="center" flexShrink={0}>
              {face(kit, person, withPictures)}
              <Button key={scope(`person-${person.username}`)} plain label={person.label} onPress={() => openReading($, row.key, person.username)} />
            </Box>
          ))}
        </Box>
      )
    }
    case 'said':
    default: {
      const { said } = row
      return said !== null ? (
        <Box paddingLeft={2}>
          <Button key={scope('said')} plain label={said.label} onPress={() => openReading($, row.key, said.username)} />
        </Box>
      ) : null
    }
  }
}
