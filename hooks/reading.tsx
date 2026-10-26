import type { EngineInterface, RenderChildren, RenderInput } from 'claude-code'

import { CHROME_SIZE, DRAWING_BUDGET, LINK, ago, botName, measure, plural, shortHash, verdictOf } from './ci'
import { partsOf } from './markdown'
import { toggleFold } from './read'

import type { Part } from './markdown'
import type { MrCard, Note } from '../types'

/** Room kept for the link that says the rest is on GitLab. */
const CUT_NOTE_SIZE = 300

/**
 * One MR whole, as a page of its own drawn alone: the threads, jobs and bots that need acting on take the room first,
 * then the description what is left, cut where it runs out. `folds` are the `<details>` drawn the other way from how
 * GitLab first shows them.
 */
export function drawReading($: EngineInterface, e: RenderInput<'Pane'>, mr: MrCard, folds: string[], now: number) {
  const { Box, Text, Button, Link, Markdown } = $.ui.resolve(e)

  /** GitLab Markdown drawn as GitLab draws it: each `<details>` a toggle under its summary, closed unless asked open. */
  const rich = (parts: Part[], id: string): RenderChildren[] => parts.flatMap((part, i) => richPart(part, id, i))
  const richPart = (part: Part, id: string, i: number): RenderChildren[] => {
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
  }

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
      {rich(partsOf(note.body), `${mr.key}#${note.url.split('#').pop() ?? note.at}`)}
    </Box>
  )

  const verdict = verdictOf(mr)
  const head = [
    <Text size="heading" weight="semibold">
      {mr.title}
    </Text>,
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      <Link href={mr.url}>{`${LINK.mr} !${mr.iid}`}</Link>
      <Link href={mr.repo.url}>{`${LINK.repo} ${mr.repo.name}`}</Link>
      {verdict && (
        <Text bold={verdict.tone === 'success'} color={verdict.tone}>
          {verdict.words}
        </Text>
      )}
      <Text dimColor>
        {`${mr.branch.source} → ${mr.branch.target}${mr.diff ? ` · +${mr.diff.additions} −${mr.diff.deletions} · ${plural(mr.diff.files, 'file')}` : ''}`}
      </Text>
    </Box>,
  ]

  const pipeline = mr.pipeline
  const jobs = [...(pipeline?.failed ?? []).map(job => ({ job, glyph: '✗' })), ...(pipeline?.amber ?? []).map(job => ({ job, glyph: '⚠' }))]
  const threads = mr.openThreads.map(thread => (
    <Box flexDirection="column" gap={1}>
      {said(thread)}
      {(thread.replies ?? []).map(reply => (
        <Box paddingLeft={2}>{said(reply)}</Box>
      ))}
    </Box>
  ))
  const blocks = [
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
    ...(threads.length > 0 ? [<Text bold>{plural(threads.length, 'open thread')}</Text>, ...threads] : []),
  ]

  let room = DRAWING_BUDGET - CHROME_SIZE - CUT_NOTE_SIZE - measure(head)
  const kept = blocks.filter(block => {
    const size = measure(block)
    if (size > room) {
      room = 0
      return false
    }
    room -= size
    return true
  })

  const described: RenderChildren[] = []
  let isCut = false
  for (const [i, part] of partsOf(mr.description).entries()) {
    const drawn = richPart(part, `${mr.key}#d`, i)
    const size = measure(drawn)
    if (size <= room) {
      described.push(...drawn)
      room -= size
      continue
    }
    const cut = 'text' in part ? cutToFit(part.text, room, text => measure(<Markdown text={text} />)) : ''
    if (cut) {
      described.push(<Markdown text={cut} />)
    }
    isCut = true
    break
  }

  return [
    ...head,
    ...described,
    ...(isCut ? [<Link href={mr.url}>{`${LINK.mr} The rest of the description is on GitLab`}</Link>] : []),
    ...kept,
    ...(kept.length < blocks.length ? [<Link href={mr.url}>{`${LINK.mr} The rest of the threads are on GitLab`}</Link>] : []),
  ]
}

/** The longest start of `text` whose drawing fits `room`, ended at a paragraph, a line or a word; empty if none does. */
function cutToFit(text: string, room: number, sizeOf: (text: string) => number): string {
  let length = Math.min(text.length, room)
  while (length > 0) {
    const start = text.slice(0, length)
    const end = [start.lastIndexOf('\n\n'), start.lastIndexOf('\n'), start.lastIndexOf(' ')].find(at => at > length / 2) ?? length
    const cut = `${start.slice(0, end).trimEnd()} …`
    if (sizeOf(cut) <= room) {
      return cut
    }
    length = Math.floor(length * 0.8)
  }
  return ''
}
