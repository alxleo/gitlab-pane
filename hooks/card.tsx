import type { EngineInterface, RenderChildren } from 'claude-code'

import { showPersonCard, toggleCard } from './detail'
import { quietly } from './failures'
import { face } from './faces'
import { joins, markdown, reveal, trigger } from './kit'
import type { Kit } from './kit'
import { byline, drawLines } from './notes'
import { openReading } from './panes'
import type { RowModel } from './pane-model'
import { strip } from './strip'

/** The parts of a row the pane fits to its room. */
export type RowPart = 'line1' | 'line2' | 'faces' | 'under1' | 'under2' | 'detail'

/**
 * One part of a row's card from the row model: its two lines, the hover cards under each, the faces with pictures, and
 * the detail an opened card ends on. Only what the model decided is drawn here.
 */
export function drawPart($: EngineInterface, kit: Kit, row: RowModel, part: RowPart): RenderChildren {
  const { Box, Text, Button, Link } = kit
  // A card opens right under the line its trigger is on, so the pointer can move into it. Every trigger on the first
  // line shares one card, and the second line's markers share another: each card's wrapper costs the drawing ~200
  // characters, and the app draws nothing past 100,000.
  const scope = (what: string) => `${what}-${row.suffix}`
  const about = scope('l1')
  const blocks = scope('b')
  // The desktop app refuses a whole drawing over one element it does not take, so controls hold plain strings:
  // a Link's text and a Button's label, never styled Text inside them. The title opens the card, so it is a plain
  // Button with a disclosure arrow, not a link-blue title that reads as leaving for GitLab (🔀 !iid does that).
  // An open card ends on closing it, or on reading it whole on a page of its own, which has a drawing of its own.
  const foot = (
    <Box flexDirection="row" gap={2}>
      <Button key={scope('less')} plain label="▴ less" onPress={() => toggleCard($, row.key)} />
      <Button key={scope('read')} plain label="read whole ›" onPress={() => openReading($, row.key)} />
    </Box>
  )
  switch (part) {
    case 'line1':
      return (
        <Box flexDirection="row" gap={1} alignItems="center">
          <Box flexGrow={1} flexShrink={1} hover={joins(kit, about)}>
            {row.canOpen ? (
              <Button key={row.titleKey} plain label={`${row.isOpen ? '▾' : '▸'} ${row.title}`} onPress={() => toggleCard($, row.key)} />
            ) : (
              <Text weight="semibold" wrap="truncate-end">
                {row.title}
              </Text>
            )}
          </Box>
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
            <Box flexDirection="row" gap={1} flexShrink={0} hover={joins(kit, blocks)}>
              <Text bold={row.verdict.bold} color={row.verdict.tone}>
                {row.verdict.words}
              </Text>
              {row.verdict.trailing !== null && <Text dimColor>{row.verdict.trailing}</Text>}
            </Box>
          ) : (
            row.blocker !== null && (
              <Box flexShrink={0} hover={joins(kit, blocks)}>
                <Text color={row.blocker.tone}>{row.blocker.text}</Text>
              </Box>
            )
          )}
          {row.people.map(person =>
            trigger(kit, person.scope, [
              face(kit, person, withPictures),
              <Button key={scope(`person-${person.username}`)} plain label={person.label} onPress={() => quietly($, showPersonCard($, row.key, person.username))} />,
            ])
          )}
        </Box>
      )
    }
    case 'under1':
      return [reveal(kit, about, drawLines(kit, row.about ?? []))]
    case 'under2':
      return [
        ...((row.blocks ?? []).length > 0 ? [reveal(kit, blocks, drawLines(kit, row.blocks ?? []))] : []),
        ...row.people.map(person => reveal(kit, person.scope, drawLines(kit, person.card))),
      ]
    case 'detail': {
      const { detail } = row
      if (detail === null) {
        return null
      }
      if (detail.kind === 'person') {
        return (
          <Box flexDirection="column" gap={1} paddingLeft={2} paddingTop={1}>
            <Text bold>{detail.title}</Text>
            {detail.notes.map(note => (
              <Box key={`pn-${note.url}`} flexDirection="column">
                {byline(kit, 'who', note.who, note.where, note.url)}
                {markdown(kit, note.body)}
              </Box>
            ))}
            {foot}
          </Box>
        )
      }
      return (
        <Box flexDirection="column" gap={1} paddingLeft={2} paddingTop={1}>
          {detail.description !== null && markdown(kit, detail.description)}
          {detail.jobs.length > 0 && (
            <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
              {detail.jobs.map(job => (
                <Link href={job.href}>{`${job.glyph} ${job.name}`}</Link>
              ))}
              {detail.more !== null && <Link href={detail.more.href}>{detail.more.text}</Link>}
            </Box>
          )}
          {detail.threads.map(note => (
            <Box key={`t-${note.url}`} flexDirection="column">
              {byline(kit, 'who', note.who, note.where, note.url)}
              {markdown(kit, note.body)}
            </Box>
          ))}
          {detail.hasPeople && <Text dimColor>Click a name to read only their comments.</Text>}
          {foot}
        </Box>
      )
    }
  }
}
