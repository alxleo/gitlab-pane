import type { EngineInterface, RenderChildren, RenderInput } from 'claude-code'

import { drawFound, drawMerged, drawPart, drawUnder } from './card'
import type { RowPart } from './card'
import { clearSearch, filterRepo, submitSearch, toggle, toggleWake, typeSearch } from './choices'
import { CHROME_SIZE, CONTROL, DRAWING_BUDGET, FILTERED, measure } from './drawing'
import { quietly } from './failures'
import { hinted, hintLine, hintLineFrame, hintRoom, homed, revealsOf } from './hint'
import { inboxNews } from './inbox'
import { drawInbox } from './inbox-pane'
import type { HomedKit } from './hint'
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
import { isCurrentWhole, withDetail } from './slim'
import { view } from './view'

/** The GitLab pane: what each MR waits on at a glance, the whole of it a press away. It draws; the modules beside it hold the state. */
export async function drawPane($: EngineInterface, e: RenderInput<'Pane'>) {
  const {
    pinned,
    rows,
    details,
    avatars,
    suggested,
    tickets,
    usual,
    expanded,
    chosen,
    folds,
    repoFilter,
    search,
    searchBox,
    unders,
    ticketDetails,
    tab,
    page,
    poll,
    isReading,
    isWaking,
    browse,
    failures,
    pressed,
    writes,
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

  // A part of a row is drawn once, when the model first asks how big it is or the row is put in the tree, and sized once,
  // with what its symbols say in the line under the card, which costs the card as the symbols do.
  type Drawn = { element: RenderChildren; reveals: RenderChildren[]; size: number }
  const drawnParts = new Map<string, Drawn>()
  const drawn = (row: RowModel, part: RowPart | 'under', paint: (at: HomedKit) => RenderChildren): Drawn => {
    const at = homed(kit, row.boxKey)
    const element = paint(at)
    const reveals = revealsOf(at)
    const made = { element, reveals, size: measure(element) + measure(reveals) }
    drawnParts.set(`${row.key}|${part}`, made)
    return made
  }
  const partOf = (row: RowModel, part: RowPart) => drawnParts.get(`${row.key}|${part}`) ?? drawn(row, part, at => drawPart($, at, row, part))
  // What is open under a card, drawn once and sized once, so the card's room in the list counts it.
  const underOf = (row: RowModel): Drawn | null => {
    const under = unders[row.key]
    if (under === undefined) {
      return null
    }
    const known = drawnParts.get(`${row.key}|under`)
    if (known !== undefined) {
      return known
    }
    const shared = rows.find(each => each.key === row.key)
    const block =
      under.kind === 'ticket'
        ? ticketUnder(under.id, tickets[under.id], ticketDetails[under.id])
        : shared !== undefined
          ? personUnder(withDetail(shared, details[row.key]), under.id, isCurrentWhole(shared, details[row.key]))
          : null
    if (block === null) {
      return null
    }
    return drawn(row, 'under', at => drawUnder($, at, row, block, under, under.kind === 'ticket' ? ticketUrl(browse, under.id) : null))
  }
  // No border: where the MR stands is said by its marks and words, never by a colour alone. A blank line below each card
  // keeps one card's lines together and apart from the next, and is where a symbol on it says what it means.
  const cardBox = (row: RowModel, children: RenderChildren[]) => (
    <Box key={row.boxKey} flexDirection="column" paddingX={1} marginBottom={1}>
      {children}
    </Box>
  )
  // What a card adds around its parts: its own box and the line under it, the same for every card but for its key.
  const lineFrame = hintLineFrame(kit)
  const frameOf = (row: RowModel) => measure(cardBox(row, [])) + lineFrame
  const sizeOf = (row: RowModel, piece: Piece): number => {
    // A JSON array of three costs the three and four characters between and around them.
    switch (piece) {
      case 'head':
        return frameOf(row) + partOf(row, 'line1').size + partOf(row, 'line2').size + partOf(row, 'said').size + 4 + (underOf(row)?.size ?? 0)
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
      suggested,
      writes,
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
    const under = underOf(row)
    const parts = [partOf(row, 'line1'), fit.hasFaces ? partOf(row, 'faces') : partOf(row, 'line2'), partOf(row, 'said'), ...(under !== null ? [under] : [])]
    return cardBox(row, [
      ...parts.map(part => part.element),
      hintLine(
        kit,
        parts.flatMap(part => part.reveals)
      ),
    ])
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
  // A filter that narrows the list says so where it was narrowed: `⧩ filtered` beside it, dim, a glyph and a word.
  const filtered = <Text dimColor>{FILTERED}</Text>
  // The repos are one picker, a row however many there are; a phone, which may not draw one, has a button for each.
  const { repos } = model
  const { Select } = kit
  const filterRow =
    repos === null
      ? []
      : Select !== undefined
        ? [
            <Box flexDirection="row" columnGap={1} alignItems="center">
              <Select key="repo" label={repos.mark} options={repos.choices} value={repos.value} onSelect={value => filterRepo($, pickedRepo(value))} />
              {repoFilter !== '' && filtered}
            </Box>,
          ]
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
              {repoFilter !== '' && filtered}
            </Box>,
          ]
  // The search box tops Mine. The list follows the typing once it pauses, and Enter at once; ✕ ends the search. The box is
  // drawn holding what Enter or ✕ left (SearchBox), never what is being typed, so a redraw while typing keeps every key.
  // Closing the pane draws the box again holding what the list is searched for (`notePaneDrawn`). Text that finds nothing
  // to look for (`!`, spaces) narrows nothing, and says nothing.
  const { found } = model
  const atSearch = homed(kit, 'search')
  const searchRow =
    Input !== undefined
      ? [
          <Box flexDirection="row" columnGap={1} alignItems="center" marginBottom={hintRoom(atSearch)}>
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
            {found !== null && filtered}
            {search !== '' &&
              hinted(atSearch, 'hint-search-clear', CONTROL.clear.hint, <Button key="search-clear" plain label={CONTROL.clear.mark} onPress={() => clearSearch($)} />)}
            {hintLine(atSearch)}
          </Box>,
        ]
      : []
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
  // Their descriptions show in the blank line under the top row, as every symbol's does under its block.
  const controls = (at: HomedKit) => (
    <Box flexDirection="row" gap={2} flexShrink={0}>
      {hinted(
        at,
        'hint-refresh',
        CONTROL.refresh.hint,
        <Button key="refresh" plain dimColor={model.isRefreshing} label={CONTROL.refresh.mark} onPress={() => quietly($, refresh($))} />
      )}
      {hinted(at, 'hint-wake', model.wake.hint, <Button key="wake" plain label={model.wake.mark} onPress={() => toggleWake($)} />)}
    </Box>
  )
  const topRow = (...left: RenderChildren[]) => {
    const at = homed(kit, 'top')
    return (
      <Box flexDirection="row" columnGap={2} alignItems="center" marginBottom={hintRoom(at)}>
        <Box flexDirection="row" columnGap={1} alignItems="center" flexGrow={1} flexShrink={1}>
          {left}
        </Box>
        {controls(at)}
        {hintLine(at)}
      </Box>
    )
  }
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
            writes,
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

  // The last block has no gap under it, only its own margin: the pane's own padding makes up the rest of the blank row
  // where what its symbols mean shows, so the pane's end does not cut that row in half.
  return (
    <Box flexDirection="column" gap={1} paddingBottom={hintRoom(kit)}>
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
