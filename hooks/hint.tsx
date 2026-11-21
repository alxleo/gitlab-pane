import type { RenderChildren } from 'claude-code'

import { hintChip } from './hint-chip'
import type { HintWaitProps } from './hint-wait'
import type { Kit } from './kit'

/**
 * Where a description draws: above its symbol, where the pointer does not cover it and the pane's last line has room, or
 * below one in the top rows, which have none above; from the symbol's start, or back from its end for one at the right edge.
 */
export type Place = { side: 'above' | 'below'; edge: 'start' | 'end' }

const ABOVE: Place = { side: 'above', edge: 'start' }
/** A symbol at the right edge of its line. */
export const AT_END: Place = { side: 'above', edge: 'end' }
/** A control in the top rows, at the right. */
export const TOP_RIGHT: Place = { side: 'below', edge: 'end' }

/**
 * A symbol and what it means, shown once the pointer has rested on it: the one rule for every symbol the pane draws. The box
 * that holds the description is out of the flow, so it covers the lines beside it and moves nothing. The engine reveals it
 * the moment the pointer touches the symbol; the region inside (`hint-wait.tsx`) shows the words only after `HINT_DELAY_MS`,
 * on every rest, so a pointer passing by sets nothing off. `words` is a line, or several (a strip's stages). Where no
 * pointer hovers, the symbol alone, and whoever drops words for it keeps them there.
 */
export function hinted(kit: Kit, key: string, words: string | readonly string[], symbol: RenderChildren, place: Place = ABOVE): RenderChildren {
  const { Box, Client } = kit
  if (Client === undefined) {
    return symbol
  }
  const chip = hintChip(words)
  if (chip === null) {
    return symbol
  }
  const props: HintWaitProps = { lines: chip.lines }
  return (
    <Box key={key} flexShrink={0}>
      {symbol}
      <Box
        position="absolute"
        top={place.side === 'above' ? -chip.rows : 1}
        left={place.edge === 'start' ? 0 : undefined}
        right={place.edge === 'end' ? 0 : undefined}
        width={chip.cells}
        display="none"
        hover={{ display: 'flex' }}
      >
        <Client key={`${key}-w`} module="./hint-wait.tsx" props={props} width="100%" height={chip.rows} />
      </Box>
    </Box>
  )
}
