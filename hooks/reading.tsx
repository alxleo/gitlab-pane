import type { EngineInterface, RenderInput } from 'claude-code'

import { CHROME_SIZE, DRAWING_BUDGET, LINK, STAGE_COLOURS, URGENCY, ago, bodyOf, botName, measure, plural, rank, shortHash, shortTitle } from './ci'
import { closeReading, quietly, toggle } from './read'

import type { MrCard, Note } from '../types'

/**
 * The Reading tab: each MR opened in the list, whole, in the order it was opened. The tab is drawn alone, so it has the
 * whole of what the app draws; an MR past the room left says so and links to GitLab.
 */
export function drawReading($: EngineInterface, e: RenderInput<'Pane'>, open: MrCard[], now: number) {
  const { Box, Text, Button, Link, Markdown } = $.ui.resolve(e)

  const byline = (note: Note) => (
    <Box flexDirection="row" gap={1}>
      <Box flexShrink={0}>
        <Text bold>{note.author}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text dimColor wrap="truncate-end">
          {[note.where, ago(note.at, now)].filter(Boolean).join(' · ')}
        </Text>
      </Box>
      <Link href={note.url}>{LINK.comment}</Link>
    </Box>
  )
  const said = (note: Note) => (
    <Box flexDirection="column">
      {byline(note)}
      <Markdown text={bodyOf(note.body, Infinity)} />
    </Box>
  )

  const card = (mr: MrCard) => {
    const pipeline = mr.pipeline
    const jobs = [...(pipeline?.failed ?? []).map(job => ({ job, glyph: '✗' })), ...(pipeline?.amber ?? []).map(job => ({ job, glyph: '⚠' }))]
    return [
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Link href={mr.url}>{`${LINK.mr} !${mr.iid}`}</Link>
        <Link href={mr.repo.url}>{`${LINK.repo} ${mr.repo.name}`}</Link>
        <Text dimColor>
          {`${mr.branch.source} → ${mr.branch.target}${mr.diff ? ` · +${mr.diff.additions} −${mr.diff.deletions} · ${plural(mr.diff.files, 'file')}` : ''}`}
        </Text>
      </Box>,
      ...(mr.description.trim() ? [<Markdown text={bodyOf(mr.description, Infinity)} />] : []),
      ...(jobs.length > 0
        ? [
            <Box flexDirection="column">
              <Text bold color="error">
                {plural(jobs.length, 'failed job')}
              </Text>
              <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
                {jobs.map(({ job, glyph }) => (
                  <Link href={job.url}>{`${glyph} ${job.name}`}</Link>
                ))}
              </Box>
            </Box>,
          ]
        : []),
      ...(mr.openThreads.length > 0
        ? [
            <Text bold>{plural(mr.openThreads.length, 'open thread')}</Text>,
            ...mr.openThreads.map(thread => (
              <Box flexDirection="column" gap={1}>
                {said(thread)}
                {(thread.replies ?? []).map(reply => (
                  <Box paddingLeft={2}>{said(reply)}</Box>
                ))}
              </Box>
            )),
          ]
        : []),
      ...(mr.bots.threads.length + mr.bots.changesBy.length > 0
        ? [
            <Box flexDirection="column">
              <Text bold>Bots hold the merge</Text>
              {mr.bots.changesBy.map(name => (
                <Text>{`${botName(name)} requested changes`}</Text>
              ))}
              {mr.bots.threads.map(note => (
                <Link href={note.url}>{`${botName(note.author)}${note.where ? ` · ${note.where}` : ''}`}</Link>
              ))}
            </Box>,
          ]
        : []),
    ]
  }

  let room = DRAWING_BUDGET - CHROME_SIZE
  const drawn = open.map(mr => {
    const whole = card(mr)
    room -= measure(whole)
    return (
      <Box key={shortHash(mr.key)} flexDirection="column" gap={1} borderStyle="round" borderColor={STAGE_COLOURS[URGENCY[rank(mr)] ?? 'subtle']} paddingX={1}>
        <Box flexDirection="row" gap={1}>
          <Box flexGrow={1} flexShrink={1}>
            <Text weight="semibold">{shortTitle(mr.title)}</Text>
          </Box>
          <Button key={`close-${mr.iid}-${shortHash(mr.project)}`} plain label="✕" onPress={() => toggle($, mr.key)} />
        </Box>
        {room >= 0 ? whole : <Link href={mr.url}>{`Too long to draw here with the others; read !${mr.iid} on GitLab`}</Link>}
      </Box>
    )
  })
  return [
    ...drawn,
    ...(open.length > 1 ? [<Button key="close-all" plain label="✕ close all" onPress={() => quietly(closeReading($))} />] : []),
  ]
}
