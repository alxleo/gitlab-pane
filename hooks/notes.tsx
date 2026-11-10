import type { RenderChildren } from 'claude-code'

import { LINK } from './drawing'
import type { Kit } from './kit'
import type { Line } from './row-lines'

/** Who or what, where and when on one line with its link. */
export function byline(kit: Kit, key: string, who: string, where: string, url: string) {
  const { Box, Text, Link } = kit
  return (
    <Box key={key} flexDirection="row" gap={1}>
      <Box flexShrink={0}>
        <Text bold>{who}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text dimColor wrap="truncate-end">
          {where}
        </Text>
      </Box>
      <Link href={url}>{LINK.comment}</Link>
    </Box>
  )
}

/** A hover card's lines as elements. */
export function drawLines(kit: Kit, lines: readonly Line[]): RenderChildren[] {
  const { Box, Text, Link } = kit
  return lines.map((line, i) => {
    switch (line.kind) {
      case 'text':
        return (
          <Text bold={line.bold ? true : undefined} dimColor={line.dim ? true : undefined} color={line.tone}>
            {line.text}
          </Text>
        )
      case 'link':
        return <Link href={line.href}>{line.text}</Link>
      case 'job': {
        const { job } = line
        return (
          <Box key={`j${lines.slice(0, i).filter(each => each.kind === 'job').length}`} flexDirection="row" gap={1}>
            <Text color={job.tone}>{job.glyph}</Text>
            <Box flexGrow={1} flexShrink={1}>
              <Link href={job.href}>{job.name}</Link>
            </Box>
            <Text dimColor>{job.ran}</Text>
          </Box>
        )
      }
      case 'note':
        return (
          <Box flexDirection="column" marginTop={1}>
            {byline(kit, 'who', line.who, line.where, line.url)}
            <Text>{line.text}</Text>
          </Box>
        )
      case 'person':
        return (
          <Box flexDirection="row" gap={1}>
            <Text bold>{line.name}</Text>
            {line.tag !== null && <Text dimColor>{line.tag}</Text>}
          </Box>
        )
      case 'hint':
        return (
          <Box marginTop={line.gap ? 1 : 0}>
            <Text dimColor>{line.text}</Text>
          </Box>
        )
    }
  })
}
