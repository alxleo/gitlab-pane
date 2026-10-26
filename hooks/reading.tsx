import type { EngineInterface, RenderChildren, RenderInput } from 'claude-code'

import { CHROME_SIZE, DRAWING_BUDGET, LINK, STAGE_COLOURS, URGENCY, ago, botName, measure, plural, rank, shortHash, shortTitle } from './ci'
import { partsOf } from './markdown'
import { closeReading, quietly, toggle, toggleFold } from './read'

import type { Part } from './markdown'
import type { MrCard, Note } from '../types'

/**
 * The Reading tab: each MR opened in the list, whole, in the order it was opened. The tab is drawn alone, so it has the
 * whole of what the app draws; an MR past the room left says so and links to GitLab. `folds` are the `<details>` drawn
 * the other way from how GitLab first shows them.
 */
export function drawReading($: EngineInterface, e: RenderInput<'Pane'>, open: MrCard[], folds: string[], now: number) {
  const { Box, Text, Button, Link, Markdown } = $.ui.resolve(e)

  /** GitLab Markdown drawn as GitLab draws it: each `<details>` a toggle under its summary, closed unless asked open. */
  const rich = (parts: Part[], id: string): RenderChildren[] =>
    parts.flatMap((part, i) => {
      if ('text' in part) {
        return [<Markdown text={part.text} />]
      }
      const fold = `${id}.${i}`
      const isOpen = part.isOpen !== folds.includes(fold)
      return [
        <Button key={`fold-${shortHash(fold)}`} plain label={`${isOpen ? '▾' : '▸'} ${part.summary}`} onPress={() => toggleFold($, fold)} />,
        ...(isOpen
          ? [
              <Box flexDirection="column" gap={1} paddingLeft={2}>
                {rich(part.parts, fold)}
              </Box>,
            ]
          : []),
      ]
    })

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
  const said = (mr: MrCard, note: Note) => (
    <Box flexDirection="column">
      {byline(note)}
      {rich(partsOf(note.body), `${mr.key}#${note.url.split('#').pop() ?? note.at}`)}
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
      ...rich(partsOf(mr.description), `${mr.key}#d`),
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
                {said(mr, thread)}
                {(thread.replies ?? []).map(reply => (
                  <Box paddingLeft={2}>{said(mr, reply)}</Box>
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

  // Each card takes its room, title row and frame included; one that does not fit links to GitLab instead.
  let room = DRAWING_BUDGET - CHROME_SIZE
  const drawn = open.map(mr => {
    const framed = (body: RenderChildren) => (
      <Box key={shortHash(mr.key)} flexDirection="column" gap={1} borderStyle="round" borderColor={STAGE_COLOURS[URGENCY[rank(mr)] ?? 'subtle']} paddingX={1}>
        <Box flexDirection="row" gap={1}>
          <Box flexGrow={1} flexShrink={1}>
            <Text weight="semibold">{shortTitle(mr.title)}</Text>
          </Box>
          <Button key={`close-${mr.iid}-${shortHash(mr.project)}`} plain label="✕" onPress={() => toggle($, mr.key)} />
        </Box>
        {body}
      </Box>
    )
    const whole = framed(card(mr))
    const size = measure(whole)
    if (size <= room) {
      room -= size
      return whole
    }
    const link = framed(<Link href={mr.url}>{`Too long to draw here with the others; read !${mr.iid} on GitLab`}</Link>)
    room -= measure(link)
    return link
  })
  return [
    ...drawn,
    ...(open.length > 1 ? [<Button key="close-all" plain label="✕ close all" onPress={() => quietly(closeReading($))} />] : []),
  ]
}
