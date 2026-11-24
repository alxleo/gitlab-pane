import type { RenderChildren } from 'claude-code'

import { measure } from './drawing'
import { hintChip } from './hint-chip'
import type { HintWaitProps } from './hint-wait'
import { shortHash } from './identity'
import type { HintHome, Kit } from './kit'

/**
 * The tint a symbol takes while the pointer is on it: faint grey, seen through, so it reads on either theme and keeps a
 * link's blue. It also ties the symbol to its description: the app lights a hover group only through a member whose hover
 * changes how it looks, so a symbol with no tint of its own would show nothing.
 */
const UNDER_POINTER = 'rgba(128,128,128,0.18)'

/** A kit that belongs to a block: the only kit a symbol can be drawn with, so none is drawn with nowhere to say its meaning. */
export type HomedKit = Kit & { home: HintHome }

/** The kit a block draws its symbols with: what they mean shows in the line under that block, `id` naming it in the pane. */
export const homed = (kit: Kit, id: string): HomedKit => {
  const home: HintHome = { id, reveals: [] }
  return { ...kit, home }
}

/** What the symbols drawn with `kit` have to say, for the line under their block. */
export const revealsOf = (kit: Kit): RenderChildren[] => kit.home?.reveals ?? []

/**
 * A symbol and what it means, shown once the pointer has rested on it: the one rule for every symbol the pane draws. The
 * symbol and its description are one hover group: the pointer on the symbol tints it and reveals the description in the
 * line under its block (`hintLine`), which is there whether or not anything shows, so nothing moves and nothing is covered
 * but that blank line, and the lines past it when a description runs to several. The region inside (`hint-wait.tsx`) shows
 * the words only after `HINT_DELAY_MS`, on every rest, so a pointer passing by sets nothing off. `words` is a line, or
 * several (a strip's stages). Where no pointer hovers, the symbol alone, and whoever drops words for it keeps them there.
 */
export function hinted(kit: HomedKit, key: string, words: string | readonly string[], symbol: RenderChildren): RenderChildren {
  const { Box, Client, home } = kit
  const chip = Client === undefined ? null : hintChip(words)
  if (Client === undefined || chip === null) {
    return symbol
  }
  // A group is the plugin's across the whole pane, so the block's name keeps two cards of one MR (Mine and Found) apart.
  const scope = `hint-${shortHash(`${home.id}|${key}`)}`
  const props: HintWaitProps = { lines: chip.lines }
  home.reveals.push(
    <Box key={`${key}-r`} position="absolute" top={0} left={0} width={chip.cells} height={chip.rows} display="none" hover={{ scope, display: 'flex' }}>
      <Client key={`${key}-w`} module="./hint-wait.tsx" props={props} width="100%" height={chip.rows} />
    </Box>
  )
  return (
    <Box key={key} flexShrink={0} hover={{ scope, backgroundColor: UNDER_POINTER }}>
      {symbol}
    </Box>
  )
}

/**
 * The margin a block keeps under it where its symbols say what they mean. The desktop draws a margin or a gap as half a
 * text row, so a block's own margin and the gap of the column it sits in make the whole blank row its `hintLine` takes;
 * a card keeps that margin everywhere, and the terminal, VS Code and a phone need none for a description they never draw.
 */
export const hintRoom = (kit: Kit): number => (kit.showsHints ? 1 : 0)

/**
 * The blank line under a block, where what its symbols mean shows, from the line's start: laid over the block's bottom
 * margin and the gap its column leaves (`hintRoom`), so it moves nothing, however many lines the block wraps to. The
 * block's last child.
 */
export function hintLine(kit: Kit, reveals: readonly RenderChildren[] = revealsOf(kit)): RenderChildren {
  return reveals.length > 0 ? lineBox(kit, reveals) : null
}

function lineBox(kit: Kit, reveals: readonly RenderChildren[]): RenderChildren {
  const { Box } = kit
  return (
    <Box position="absolute" bottom={-1} left={0} right={0} height={1}>
      {reveals}
    </Box>
  )
}

/** What a block's `hintLine` adds to the drawing besides the descriptions it holds, which their symbols' parts count. */
export const hintLineFrame = (kit: Kit): number => (kit.showsHints ? measure(lineBox(kit, [])) : 0)
