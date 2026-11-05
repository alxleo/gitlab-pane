import { LINK } from './drawing'
import { ago, excerpt } from './format'
import type { Kit } from './kit'

import type { Note } from '../types'

/** Where in the code, and when: the line under a name. */
export const whereAndWhen = (note: Note, now: number): string =>
  [note.where, ago(note.at, now)].filter((part): part is string => part !== undefined && part !== '').join(' · ')

export const noteKind = (note: Note): string => (note.isOpen ? 'open thread' : 'comment')

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

/** A note's byline over its first words. */
export function noteLine(kit: Kit, note: Note, who = note.author) {
  const { Box, Text } = kit
  return (
    <Box flexDirection="column" marginTop={1}>
      {byline(kit, 'who', who, whereAndWhen(note, kit.now), note.url)}
      <Text>{excerpt(note.body)}</Text>
    </Box>
  )
}
