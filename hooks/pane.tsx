import type { EngineInterface, RenderInput } from 'claude-code'

import { byAttention, rank, reviewTone } from './attention'
import { buildCard } from './card'
import { filterRepo, toggle, toggleWake } from './choices'
import { CHROME_SIZE, DRAWING_BUDGET, measure } from './drawing'
import { quietly } from './failures'
import { ago, plural } from './format'
import { shortHash } from './identity'
import { inboxView } from './inbox'
import { drawInbox } from './inbox-pane'
import { kitOf } from './kit'
import { pinKey } from './mr-url'
import { leaveReading, openTab } from './panes'
import { refresh } from './poll'
import { drawReading } from './reading'
import { STAGE_COLOURS } from './status'
import { view } from './view'

import type { MrCard } from '../types'

const updatedLine = (age: string): string => (age === 'now' ? 'updated just now' : `updated ${age} ago`)

const MINE_SHOWN = 10

/** The GitLab pane: what each MR waits on at a glance, its detail a pointer away. It draws; the modules beside it hold the state. */
export async function drawPane($: EngineInterface, e: RenderInput<'Pane'>) {
  const { pinned, rows: lastRead, tickets, usual, avatars, expanded, chosen, folds, repoFilter, tab, page, poll, isWaking, browse, now } = await view($)
  const kit = kitOf($, e, now)
  const { Box, Text, Button } = kit
  // GitLab says an MR is no longer open before the authored list drops it.
  const rows = lastRead.filter(row => row.mergeStatus !== 'NOT_OPEN')
  // Only the open tab or page is drawn, so the MR list, the inbox and one MR read whole each have all the app draws.
  const isInbox = tab === 'inbox'
  const reading = lastRead.find(row => row.key === page)
  const pinnedKeys = new Set(pinned.map(pinKey))
  const repos = [...rows.reduce((count, row) => count.set(row.project, (count.get(row.project) ?? 0) + 1), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1])
  const homeRepo = rows.find(row => pinnedKeys.has(row.key))?.project ?? repos[0]?.[0]
  const shown = rows.filter(row => repoFilter === '' || row.project === repoFilter)
  const session = shown.filter(row => pinnedKeys.has(row.key)).sort(byAttention)
  const mine = shown.filter(row => !pinnedKeys.has(row.key) && !row.isDraft).sort(byAttention)
  const drafts = shown.filter(row => !pinnedKeys.has(row.key) && row.isDraft).sort(byAttention)
  const showDrafts = expanded.includes('drafts')
  // Past this many, the least pressing of Mine fold behind a button, so the pane's size stays bounded.
  const showMore = expanded.includes('more')
  const mineShown = showMore ? mine : mine.slice(0, MINE_SHOWN)
  const repoName = (project: string) => rows.find(row => row.project === project)?.repo.name ?? project

  // Rows come in order of what needs you. Rows you opened take the room first, with their detail; then the other rows
  // in that order, then hover cards, then avatars. Rows that do not fit at all are left out and counted.
  const context = { expanded, chosen, tickets, usual, avatars, browse, homeRepo, repoFilter }
  const built = isInbox || reading !== undefined ? [] : [...session, ...mineShown, ...(showDrafts ? drafts : [])].map(mr => buildCard($, kit, context, mr))
  let room = DRAWING_BUDGET - CHROME_SIZE
  /** Takes the room `tree` needs past what `instead` already took. */
  const fits = (tree: unknown, instead?: unknown) => {
    const size = measure(tree) - (instead === undefined ? 0 : measure(instead))
    if (size > room) {
      return false
    }
    room -= size
    return true
  }
  const opened = built.filter(part => part.detail !== null && fits([part.line1, part.line2]))
  const withDetail = new Set(opened.filter(part => fits(part.detail)).map(part => part.key))
  const drawn = new Set([...opened, ...built.filter(part => part.detail === null && fits([part.line1, part.line2]))].map(part => part.key))
  const left = built.length - drawn.size
  const withCards = new Set(built.filter(part => drawn.has(part.key) && fits([part.under1, part.under2])).map(part => part.key))
  const withFaces = new Set(built.filter(part => drawn.has(part.key) && part.faces !== null && fits(part.faces, part.line2)).map(part => part.key))
  const draw = (mr: MrCard) => {
    const part = built.find(one => one.key === mr.key)
    if (part === undefined || !drawn.has(part.key)) {
      return null
    }
    const hasCards = withCards.has(part.key)
    // The colour is the review, in the stage squares' own colours, brighter than the theme's tones; the heavier line
    // is an MR that needs you.
    return (
      <Box
        key={shortHash(part.key)}
        flexDirection="column"
        borderStyle={rank(mr) === 0 ? 'bold' : 'round'}
        borderColor={STAGE_COLOURS[reviewTone(mr)]}
        hover={part.canOpen ? { borderColor: 'claude' } : undefined}
        paddingX={1}
      >
        {part.line1}
        {hasCards && part.under1}
        {withFaces.has(part.key) ? part.faces : part.line2}
        {hasCards && part.under2}
        {part.detail !== null && (withDetail.has(part.key) ? part.detail : <Text dimColor>Too much is open to draw this too; close another row.</Text>)}
      </Box>
    )
  }

  const fetched = poll.fetchedAt !== null ? ago(new Date(poll.fetchedAt).toISOString(), now) : null
  const keptNote = (poll.kept ?? 0) > 0 ? `; ${plural(poll.kept ?? 0, 'MR')} kept from the last read` : ''
  const status =
    poll.error !== null
      ? `GitLab read failed: ${poll.error}${fetched !== null ? `; showing ${fetched} old data` : ''}`
      : fetched !== null
        ? `${updatedLine(fetched)}${keptNote}`
        : 'reading GitLab…'

  // An MR counts as news once, whichever rules list it, as the inbox itself counts it.
  const { inbox: inboxState } = await inboxView($)
  const news = new Set(inboxState.sections.flatMap(section => section.items.filter(item => item.unseen > 0).map(item => item.key))).size
  const openCount = rows.filter(row => !row.isDraft || pinnedKeys.has(row.key)).length
  const mineTab = [
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      <Button key="repo-all" label={`All ${rows.length}`} variant={repoFilter !== '' ? 'secondary' : 'primary'} onPress={() => filterRepo($, repoFilter)} />
      {repos.map(([project, count]) => (
        <Button
          key={`repo-${project}`}
          label={`${repoName(project)} ${count}`}
          variant={repoFilter === project ? 'primary' : 'secondary'}
          onPress={() => filterRepo($, project)}
        />
      ))}
    </Box>,
    ...(session.length > 0 ? [<Text bold>This session</Text>, ...session.map(draw)] : []),
    <Text bold>{`Mine · ${mine.length}`}</Text>,
    ...(mine.length === 0 ? [<Text dimColor>Nothing open here.</Text>] : []),
    ...mineShown.map(draw),
    ...(mine.length > MINE_SHOWN
      ? [<Button key="more" plain label={showMore ? '▾ Show fewer' : `▸ ${mine.length - MINE_SHOWN} more`} onPress={() => toggle($, 'more')} />]
      : []),
    ...(drafts.length > 0
      ? [<Button key="drafts" plain label={`${showDrafts ? '▾' : '▸'} Drafts · ${drafts.length}`} onPress={() => toggle($, 'drafts')} />]
      : []),
    ...(showDrafts ? drafts.map(draw) : []),
    ...(left > 0 ? [<Text dimColor>{`${plural(left, 'more MR')} left out to stay within what the app draws; pick a repo above to see them.`}</Text>] : []),
  ]

  // An MR read whole is a page over its tab, a way back at each end, so a long one needs no scrolling back up.
  const back = (key: string) => <Button key={key} plain label={isInbox ? '‹ Inbox' : '‹ Mine'} onPress={() => leaveReading($)} />
  const body =
    reading !== undefined
      ? [back('back-top'), ...drawReading($, e, reading, folds, now), back('back-bottom')]
      : [
          <Box flexDirection="row" columnGap={1}>
            <Button key="tab-mine" label={`Mine · ${openCount}`} variant={isInbox ? 'secondary' : 'primary'} onPress={() => openTab($, 'mine')} />
            <Button
              key="tab-inbox"
              label={news > 0 ? `Inbox · ${news} new` : 'Inbox'}
              variant={isInbox ? 'primary' : 'secondary'}
              onPress={() => openTab($, 'inbox')}
            />
          </Box>,
          ...(isInbox ? [await drawInbox($, e)] : mineTab),
        ]

  return (
    <Box flexDirection="column" gap={1}>
      {body}
      <Box flexDirection="row" gap={2}>
        <Text color={poll.error !== null ? 'warning' : undefined} dimColor={poll.error === null} size="footnote">
          {status}
        </Text>
        <Button key="refresh" plain label="refresh" onPress={() => quietly($, refresh($))} />
        <Button key="wake" plain label={isWaking ? 'wake Claude: on' : 'wake Claude: off'} onPress={() => toggleWake($)} />
      </Box>
    </Box>
  )
}
