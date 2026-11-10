import type { EngineInterface, RenderChildren } from 'claude-code'

import { face } from './faces'
import type { Kit } from './kit'
import { openReading } from './panes'
import type { RowModel } from './pane-model'
import { strip } from './strip'

/** The parts of a row the pane fits to its room. */
export type RowPart = 'line1' | 'line2' | 'faces' | 'said'

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
    case 'line1':
      return (
        <Box flexDirection="row" gap={1} alignItems="center">
          <Box flexGrow={1} flexShrink={1}>
            <Button key={row.titleKey} plain label={row.title} onPress={() => openReading($, row.key)} />
          </Box>
          {/* A quiet row is this line alone: what it waits on, or that it can merge, goes beside its title. */}
          {row.isQuiet && row.verdict !== null && (
            <Box flexShrink={0}>
              <Text bold={row.verdict.bold} color={row.verdict.tone}>
                {row.verdict.words}
              </Text>
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
        </Box>
      )
    case 'line2':
    case 'faces': {
      const withPictures = part === 'faces'
      return (
        <Box flexDirection="row" flexWrap="wrap" columnGap={2} paddingLeft={2}>
          {/* A Link takes no flex props, so this box keeps the links whole when the line wraps. */}
          <Box flexDirection="row" gap={1} flexShrink={0}>
            <Link href={row.mr.href}>{row.mr.text}</Link>
            {row.ticket !== null && (row.ticket.href !== null ? <Link href={row.ticket.href}>{row.ticket.text}</Link> : <Text dimColor>{row.ticket.text}</Text>)}
            {row.repo !== null && <Link href={row.repo.href}>{row.repo.text}</Link>}
          </Box>
          {row.strip !== null && strip(kit, row.strip)}
          {row.pipeline !== null ? <Link href={row.pipeline.href}>{row.pipeline.text}</Link> : <Text dimColor>no pipeline</Text>}
          {row.verdict !== null ? (
            <Box flexDirection="row" gap={1} flexShrink={0}>
              <Text weight={row.verdict.bold ? 'semibold' : undefined} color={row.verdict.tone}>
                {row.verdict.words}
              </Text>
              {row.verdict.trailing !== null && <Text dimColor>{row.verdict.trailing}</Text>}
            </Box>
          ) : (
            row.blocker !== null && (
              <Box flexShrink={0}>
                <Text color={row.blocker.tone}>{row.blocker.text}</Text>
              </Box>
            )
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
