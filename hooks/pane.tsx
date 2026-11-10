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
import { pageHead } from './page-lines'
import { PIN_STRIP } from './pin-order'
import { leaveReading, openTab } from './panes'
import { refresh } from './poll'
import { drawReading } from './reading'
import { withDetail } from './slim'
import { view } from './view'

/** The GitLab pane: what each MR waits on at a glance, the whole of it a press away. It draws; the modules beside it hold the state. */
export async function drawPane($: EngineInterface, e: RenderInput<'Pane'>) {
  const { pinned, rows, details, avatars, tickets, usual, expanded, chosen, folds, repoFilter, tab, page, poll, isReading, isWaking, browse, failures, stripFaults, now } =
    await view($)
  const kit = kitOf($, e, now)
  const { Box, Text, Button, Client } = kit
  // Only the open tab or page is drawn, so the MR list, the inbox and one MR read whole each have all the app draws.
  const isInbox = tab === 'inbox'
  // The cards are the shared ones; the MR read whole has its description and threads put back (detail.ts reads them).
  const cards = rows.map(row => withDetail(row, details[row.key]))
  const reading = cards.find(row => row.key === page)

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
    // A JSON array of three costs the three and four characters between and around them.
    switch (piece) {
      case 'head':
        return row.isQuiet ? partOf(row, 'line1').size : partOf(row, 'line1').size + partOf(row, 'line2').size + partOf(row, 'said').size + 4
      case 'line2':
        return partOf(row, 'line2').size
      case 'faces':
      default:
        return partOf(row, 'faces').size
    }
  }

  const model = buildPane(
    {
      cards,
      avatars,
      pinned,
      usual,
      browse,
      expanded,
      repoFilter,
      view: isInbox ? 'inbox' : reading !== undefined ? 'reading' : 'mine',
      news: await inboxNews($),
      poll,
      isReading,
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
      <Box key={row.boxKey} flexDirection="column" borderStyle={row.border.style} borderColor={row.border.colour} hover={{ borderColor: 'claude' }} paddingX={1}>
        {partOf(row, 'line1').element}
        {!row.isQuiet && (fit.hasFaces ? partOf(row, 'faces').element : partOf(row, 'line2').element)}
        {!row.isQuiet && partOf(row, 'said').element}
      </Box>
    )
  }

  const { mine, parked, drafts, others } = model
  const fold = (key: 'parked' | 'drafts', list: { label: string; rows: RowModel[] } | null) =>
    list !== null ? [<Button key={key} plain label={list.label} onPress={() => toggle($, key)} />, ...list.rows.map(draw)] : []
  // With this session's MRs on top, the rest is one line until it is opened.
  const rest =
    others === null || others.isOpen
      ? [
          <Text weight="semibold">{mine.heading}</Text>,
          ...(mine.isEmpty ? [<Text dimColor>Nothing open here.</Text>] : []),
          ...mine.rows.map(draw),
          ...(mine.more !== null ? [<Button key="more" plain label={mine.more} onPress={() => toggle($, 'more')} />] : []),
          ...fold('parked', parked),
          ...fold('drafts', drafts),
        ]
      : []
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
    ...(model.session.length > 0 ? [<Text weight="semibold">This session</Text>] : []),
    // Where the surface follows the pointer, a line per MR to drag them into the person's own order; elsewhere, and where the
    // strip failed, the order pinned.
    ...(model.order !== null && Client !== undefined && !stripFaults.includes(e.surface)
      ? [
          <Text dimColor size="footnote">
            Drag to reorder
          </Text>,
          <Client key={PIN_STRIP} module="./pin-strip.tsx" props={model.order} />,
        ]
      : []),
    ...model.session.map(draw),
    ...(others !== null ? [<Button key="others" plain label={others.label} onPress={() => toggle($, 'others')} />] : []),
    ...rest,
    ...(model.leftOut !== null ? [<Text dimColor>{model.leftOut}</Text>] : []),
  ]

  // An MR read whole is a page over its tab, a way back at each end, so a long one needs no scrolling back up.
  const back = (key: string) => <Button key={key} plain label={isInbox ? '‹ Inbox' : '‹ Mine'} onPress={() => leaveReading($)} />
  const status =
    model.status.text !== '' ? (
      <Text color={model.status.isWarning ? 'warning' : undefined} dimColor={!model.status.isWarning} size="footnote">
        {model.status.text}
      </Text>
    ) : null
  const body =
    reading !== undefined
      ? [
          back('back-top'),
          ...drawReading($, e, reading, {
            folds,
            focus: chosen[reading.key] ?? '',
            head: pageHead(reading, { tickets, browse, failures }),
            now,
          }),
          back('back-bottom'),
        ]
      : [
          <Box flexDirection="row" columnGap={1} alignItems="center">
            <Button key="tab-mine" label={model.tabs.mine} variant={isInbox ? 'secondary' : 'primary'} onPress={() => openTab($, 'mine')} />
            <Button key="tab-inbox" label={model.tabs.inbox} variant={isInbox ? 'primary' : 'secondary'} onPress={() => openTab($, 'inbox')} />
            {/* The inbox says its own age on the row below its tabs. */}
            {!isInbox && status}
          </Box>,
          ...(isInbox ? [await drawInbox($, e)] : mineTab),
        ]

  return (
    <Box flexDirection="column" gap={1}>
      {body}
      <Box flexDirection="row" gap={2}>
        {/* An MR read whole has no tabs row: the age goes beside its refresh. */}
        {reading !== undefined && status}
        {model.footer.text !== '' && (
          <Text color={model.footer.isWarning ? 'warning' : undefined} dimColor={!model.footer.isWarning} size="footnote">
            {model.footer.text}
          </Text>
        )}
        <Button key="refresh" plain label="refresh" onPress={() => quietly($, refresh($))} />
        <Button key="wake" plain label={model.footer.wake} onPress={() => toggleWake($)} />
      </Box>
    </Box>
  )
}
