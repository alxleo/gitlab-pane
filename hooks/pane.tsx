import type { EngineInterface, RenderChildren, RenderInput } from 'claude-code'

import { drawPart } from './card'
import type { RowPart } from './card'
import { filterRepo, toggle, toggleWake } from './choices'
import { CHROME_SIZE, DRAWING_BUDGET, measure } from './drawing'
import { quietly } from './failures'
import { inboxNews } from './inbox'
import { drawInbox } from './inbox-pane'
import { kitOf } from './kit'
import { buildPane } from './pane-model'
import type { Piece, RowModel } from './pane-model'
import { leaveReading, openTab } from './panes'
import { refresh } from './poll'
import { drawReading } from './reading'
import { view } from './view'

/** The GitLab pane: what each MR waits on at a glance, its detail a pointer away. It draws; the modules beside it hold the state. */
export async function drawPane($: EngineInterface, e: RenderInput<'Pane'>) {
  const { pinned, rows, facts, tickets, usual, expanded, chosen, folds, repoFilter, tab, page, poll, isWaking, browse, failures, now } = await view($)
  const kit = kitOf($, e, now)
  const { Box, Text, Button } = kit
  // Only the open tab or page is drawn, so the MR list, the inbox and one MR read whole each have all the app draws.
  const isInbox = tab === 'inbox'
  const reading = rows.find(row => row.key === page)

  // A part of a row is drawn once, when the model first asks how big it is or the row is put in the tree, and sized once.
  const drawnParts = new Map<string, { element: RenderChildren; size: number }>()
  const partOf = (row: RowModel, part: RowPart) => {
    const key = `${row.key}|${part}`
    const known = drawnParts.get(key)
    if (known !== undefined) {
      return known
    }
    const element = drawPart($, kit, row, part)
    const made = { element, size: measure(element) }
    drawnParts.set(key, made)
    return made
  }
  const sizeOf = (row: RowModel, piece: Piece): number => {
    // A JSON array of two costs the two and three characters between and around them.
    switch (piece) {
      case 'head':
        return partOf(row, 'line1').size + partOf(row, 'line2').size + 3
      case 'line2':
        return partOf(row, 'line2').size
      case 'cards':
        return partOf(row, 'under1').size + partOf(row, 'under2').size + 3
      case 'faces':
        return partOf(row, 'faces').size
      case 'detail':
        return partOf(row, 'detail').size
    }
  }

  const model = buildPane(
    {
      cards: rows,
      facts,
      pinned,
      tickets,
      usual,
      browse,
      expanded,
      chosen,
      repoFilter,
      view: isInbox ? 'inbox' : reading !== undefined ? 'reading' : 'mine',
      news: await inboxNews($),
      poll,
      isWaking,
      failures,
    },
    now,
    { hasSvg: kit.Svg !== undefined },
    { room: DRAWING_BUDGET - CHROME_SIZE, sizeOf }
  )

  const draw = (row: RowModel) => {
    if (!row.fit.isDrawn) {
      return null
    }
    const { fit } = row
    // The colour is the review, in the stage squares' own colours, brighter than the theme's tones; the heavier line
    // is an MR that needs you.
    return (
      <Box
        key={row.boxKey}
        flexDirection="column"
        borderStyle={row.border.style}
        borderColor={row.border.colour}
        hover={row.canOpen ? { borderColor: 'claude' } : undefined}
        paddingX={1}
      >
        {partOf(row, 'line1').element}
        {fit.hasCards && partOf(row, 'under1').element}
        {fit.hasFaces ? partOf(row, 'faces').element : partOf(row, 'line2').element}
        {fit.hasCards && partOf(row, 'under2').element}
        {row.hasDetail && (fit.hasDetail ? partOf(row, 'detail').element : <Text dimColor>Too much is open to draw this too; close another row.</Text>)}
      </Box>
    )
  }

  const { mine, drafts } = model
  const mineTab = [
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      <Button key="repo-all" label={model.repos.all.label} variant={model.repos.all.isActive ? 'primary' : 'secondary'} onPress={() => filterRepo($, repoFilter)} />
      {model.repos.each.map(repo => (
        <Button key={`repo-${repo.project}`} label={repo.label} variant={repo.isActive ? 'primary' : 'secondary'} onPress={() => filterRepo($, repo.project)} />
      ))}
    </Box>,
    ...model.firstRun.map(line => (
      <Text color="warning" size="footnote">
        {line}
      </Text>
    )),
    ...(model.session.length > 0 ? [<Text bold>This session</Text>, ...model.session.map(draw)] : []),
    <Text bold>{mine.heading}</Text>,
    ...(mine.isEmpty ? [<Text dimColor>Nothing open here.</Text>] : []),
    ...mine.rows.map(draw),
    ...(mine.more !== null ? [<Button key="more" plain label={mine.more} onPress={() => toggle($, 'more')} />] : []),
    ...(drafts !== null ? [<Button key="drafts" plain label={drafts.label} onPress={() => toggle($, 'drafts')} />] : []),
    ...(drafts !== null ? drafts.rows.map(draw) : []),
    ...(model.leftOut !== null ? [<Text dimColor>{model.leftOut}</Text>] : []),
  ]

  // An MR read whole is a page over its tab, a way back at each end, so a long one needs no scrolling back up.
  const back = (key: string) => <Button key={key} plain label={isInbox ? '‹ Inbox' : '‹ Mine'} onPress={() => leaveReading($)} />
  const body =
    reading !== undefined
      ? [back('back-top'), ...drawReading($, e, reading, folds, now), back('back-bottom')]
      : [
          <Box flexDirection="row" columnGap={1}>
            <Button key="tab-mine" label={model.tabs.mine} variant={isInbox ? 'secondary' : 'primary'} onPress={() => openTab($, 'mine')} />
            <Button key="tab-inbox" label={model.tabs.inbox} variant={isInbox ? 'primary' : 'secondary'} onPress={() => openTab($, 'inbox')} />
          </Box>,
          ...(isInbox ? [await drawInbox($, e)] : mineTab),
        ]

  return (
    <Box flexDirection="column" gap={1}>
      {body}
      <Box flexDirection="row" gap={2}>
        <Text color={model.footer.isWarning ? 'warning' : undefined} dimColor={!model.footer.isWarning} size="footnote">
          {model.footer.text}
        </Text>
        <Button key="refresh" plain label="refresh" onPress={() => quietly($, refresh($))} />
        <Button key="wake" plain label={model.footer.wake} onPress={() => toggleWake($)} />
      </Box>
    </Box>
  )
}
