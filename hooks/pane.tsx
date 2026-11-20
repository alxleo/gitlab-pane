import type { EngineInterface, RenderChildren, RenderInput } from 'claude-code'

import { drawFound, drawMerged, drawPart, drawUnder } from './card'
import type { RowPart } from './card'
import { clearSearch, filterRepo, submitSearch, toggle, toggleWake, typeSearch } from './choices'
import { CHROME_SIZE, DRAWING_BUDGET, measure } from './drawing'
import { quietly } from './failures'
import { inboxNews } from './inbox'
import { drawInbox } from './inbox-pane'
import { kitOf } from './kit'
import { buildPane } from './pane-model'
import type { Piece, RowModel } from './pane-model'
import { pageHead, personUnder, ticketUnder } from './page-lines'
import { ticketUrl } from './jira'
import { leaveReading, openTab } from './panes'
import { refresh } from './poll'
import { drawReading } from './reading'
import { pickedRepo } from './repo-filter'
import { drawnReply } from './replies'
import { drawnWrites } from './writes'
import { withDetail } from './slim'
import { view } from './view'

/** The GitLab pane: what each MR waits on at a glance, the whole of it a press away. It draws; the modules beside it hold the state. */
export async function drawPane($: EngineInterface, e: RenderInput<'Pane'>) {
  const {
    pinned,
    rows,
    details,
    avatars,
    tickets,
    usual,
    expanded,
    chosen,
    folds,
    repoFilter,
    search,
    searchBox,
    under,
    ticketDetails,
    tab,
    page,
    poll,
    isReading,
    isWaking,
    browse,
    failures,
    pressed,
    here,
    now,
  } = await view($)
  const kit = kitOf($, e, now)
  const { Box, Text, Button, Input } = kit
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
  // What is open under one card, drawn once and sized once, so the card's room in the list counts it.
  const underOf = (row: RowModel): { element: RenderChildren; size: number } | null => {
    if (under === null || under.card !== row.key) {
      return null
    }
    const known = drawnParts.get(`${row.key}|under`)
    if (known !== undefined) {
      return known
    }
    const card = cards.find(each => each.key === row.key)
    const block =
      under.kind === 'ticket'
        ? ticketUnder(under.id, tickets[under.id], ticketDetails[under.id], failures.jira !== undefined)
        : card !== undefined
          ? personUnder(card, under.id)
          : null
    if (block === null) {
      return null
    }
    const element = drawUnder($, kit, row, block, under, under.kind === 'ticket' ? ticketUrl(browse, under.id) : null)
    const made = { element, size: measure(element) }
    drawnParts.set(`${row.key}|under`, made)
    return made
  }
  const sizeOf = (row: RowModel, piece: Piece): number => {
    // A JSON array of three costs the three and four characters between and around them.
    switch (piece) {
      case 'head':
        return (row.isQuiet ? partOf(row, 'line1').size : partOf(row, 'line1').size + partOf(row, 'line2').size + partOf(row, 'said').size + 4) + (underOf(row)?.size ?? 0)
      case 'line2':
        return partOf(row, 'line2').size
      case 'faces':
      default:
        return partOf(row, 'faces').size
    }
  }

  const { isSyncing, landed, mrs, ...news } = await inboxNews($)
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
      news,
      landed,
      // A surface with no search box searches for nothing, so it never shows a search it could not end.
      search: Input !== undefined ? search : '',
      inbox: mrs,
      poll,
      isReading,
      isSyncing,
      isWaking,
      failures,
      pressed,
      here,
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
    // No border: where the MR stands is said by its marks and words, never by a colour alone. A blank line below each card
    // keeps one card's lines together and apart from the next.
    return (
      <Box key={row.boxKey} flexDirection="column" paddingX={1} marginBottom={1}>
        {partOf(row, 'line1').element}
        {!row.isQuiet && (fit.hasFaces ? partOf(row, 'faces').element : partOf(row, 'line2').element)}
        {!row.isQuiet && partOf(row, 'said').element}
        {underOf(row)?.element}
      </Box>
    )
  }

  const { mine, parked, drafts, others, merged } = model
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
  // A filter holds its own row inside a frame, grey while it hides nothing and blue while it does, so a list narrowed by a
  // search or a repo says so where it is narrowed. The frame is always there, so turning a filter on moves nothing.
  const framed = (isOn: boolean, child: RenderChildren) => (
    <Box borderStyle="round" borderColor={isOn ? 'suggestion' : 'subtle'} borderDimColor={!isOn} paddingX={1}>
      {child}
    </Box>
  )
  // The repos are one picker, a row however many there are; a phone, which may not draw one, has a button for each.
  const { repos } = model
  const { Select } = kit
  const filterRow =
    repos === null
      ? []
      : Select !== undefined
        ? [framed(repoFilter !== '', <Select key="repo" label={repos.mark} options={repos.choices} value={repos.value} onSelect={value => filterRepo($, pickedRepo(value))} />)]
        : [
            <Box flexDirection="row" flexWrap="wrap" columnGap={1} alignItems="center">
              <Text>{repos.mark}</Text>
              {repos.choices.map(choice => (
                <Button
                  key={`repo-${choice.value}`}
                  label={choice.label}
                  variant={choice.value === repos.value ? 'primary' : 'secondary'}
                  onPress={() => filterRepo($, pickedRepo(choice.value))}
                />
              ))}
            </Box>,
          ]
  // The search box tops Mine. The list follows the typing once it pauses, and Enter at once; ✕ ends the search. The box is
  // drawn holding what Enter or ✕ left (SearchBox), never what is being typed, so a redraw while typing keeps every key.
  const searchRow =
    Input !== undefined
      ? [
          framed(
            search !== '',
            <Box flexDirection="row" columnGap={1} alignItems="center">
              <Box flexGrow={1} flexShrink={1}>
                <Input
                  key={`search-${searchBox.round}`}
                  label="🔍"
                  placeholder="!iid, ticket, title, branch or author"
                  value={searchBox.drawn}
                  submitLabel="find"
                  onInput={text => typeSearch($, text)}
                  onSubmit={text => submitSearch($, text)}
                />
              </Box>
              {search !== '' && <Button key="search-clear" plain label="✕" onPress={() => clearSearch($)} />}
            </Box>
          ),
        ]
      : []
  const { found } = model
  const list =
    found !== null
      ? [
          <Text weight="semibold">{found.heading}</Text>,
          ...(found.isEmpty ? [<Text dimColor>Nothing the pane holds matches.</Text>] : []),
          ...found.rows.map(draw),
          ...(found.merged.length > 0 ? [<Text dimColor>Merged</Text>, ...found.merged.map(row => drawMerged(kit, row))] : []),
          ...(found.mergedMore !== null ? [<Text dimColor>{found.mergedMore}</Text>] : []),
          ...(found.inbox.length > 0 ? [<Text dimColor>Inbox</Text>, ...found.inbox.map(row => drawFound(kit, row))] : []),
          ...(found.inboxMore !== null ? [<Text dimColor>{found.inboxMore}</Text>] : []),
        ]
      : [
          ...(model.session.length > 0 ? [<Text weight="semibold">This session</Text>, ...model.session.map(draw)] : []),
          ...(others !== null ? [<Button key="others" plain label={others.label} onPress={() => toggle($, 'others')} />] : []),
          ...rest,
        ]
  const mineTab = [
    ...searchRow,
    ...filterRow,
    ...model.firstRun.map(line => (
      <Text color="warning" size="footnote">
        {line}
      </Text>
    )),
    ...list,
    ...(model.leftOut !== null ? [<Text dimColor>{model.leftOut}</Text>] : []),
    // Last, and outside what folds under the others, so a failed build on the fold line is never out of sight.
    ...(merged !== null ? [<Button key="merged" plain label={merged.label} onPress={() => toggle($, 'merged')} />, ...merged.rows.map(row => drawMerged(kit, row))] : []),
  ]

  // An MR read whole is a page over its tab, a way back at each end, so a long one needs no scrolling back up.
  const back = (key: string) => <Button key={key} plain label={isInbox ? '‹ Inbox' : '‹ Mine'} onPress={() => leaveReading($)} />
  const status =
    model.status.text !== '' ? (
      <Text color={model.status.isWarning ? 'warning' : undefined} dimColor={!model.status.isWarning} size="footnote">
        {model.status.text}
      </Text>
    ) : null
  // Refreshing and waking sit at the top right, as symbols: in view on a long list, and out of the way of what is read. Each
  // symbol is its Button's label, alone: the desktop app draws a label in place of the children. ↻ reads the MRs and the
  // inbox alike, and is dim while either read is out.
  const controls = (
    <Box flexDirection="row" gap={2} flexShrink={0}>
      <Button key="refresh" plain dimColor={model.isRefreshing} label="↻" onPress={() => quietly($, refresh($))} />
      <Button key="wake" plain label={model.wake} onPress={() => toggleWake($)} />
    </Box>
  )
  const topRow = (...left: RenderChildren[]) => (
    <Box flexDirection="row" columnGap={2} alignItems="center">
      <Box flexDirection="row" columnGap={1} alignItems="center" flexGrow={1} flexShrink={1}>
        {left}
      </Box>
      {controls}
    </Box>
  )
  const body =
    reading !== undefined
      ? [
          // An MR read whole has no tabs row: the age goes beside its way back.
          topRow(back('back-top'), status),
          ...drawReading($, e, reading, {
            folds,
            focus: chosen[reading.key] ?? '',
            head: pageHead(reading, { tickets, browse, failures }),
            now,
            reply: await drawnReply($),
            writes: await drawnWrites($),
          }),
          back('back-bottom'),
        ]
      : [
          topRow(
            <Button key="tab-mine" label={model.tabs.mine} variant={isInbox ? 'secondary' : 'primary'} onPress={() => openTab($, 'mine')} />,
            <Button key="tab-inbox" label={model.tabs.inbox} variant={isInbox ? 'primary' : 'secondary'} onPress={() => openTab($, 'inbox')} />,
            // The inbox says its own age on the row below its tabs.
            !isInbox && status
          ),
          ...(isInbox ? [await drawInbox($, e)] : mineTab),
        ]

  return (
    <Box flexDirection="column" gap={1}>
      {body}
      {/* The footer is only what went wrong with the last read, or what it left out. */}
      {model.footer.text !== '' && (
        <Text color={model.footer.isWarning ? 'warning' : undefined} dimColor={!model.footer.isWarning} size="footnote">
          {model.footer.text}
        </Text>
      )}
    </Box>
  )
}
