import type { ClientModule } from 'claude-code'

import { HIDDEN, HINT_TICK_MS, regionStep } from './hint-chip'
import type { Wait } from './hint-chip'

/** What `hinted` hands the region: the description's lines, as `hintChip` made them. */
export type HintWaitProps = { lines: string[] }

/** Its wait, the clock it stops, and the time as its own ticks count it (`HINT_TICK_MS` each), the clock it waits by. */
type State = { wait: Wait; stop: (() => void) | null; ticks: number }

/**
 * The region inside a description's box. The app reveals the box the moment the pointer touches its symbol, and lays the
 * region out again as it shows or hides; `regionStep` decides from its size and its time when the words show and what its
 * clock does, so this only carries that out. Its time is its own ticks, not the wall's, so it waits the same under the
 * engine's test kit as in the app. The region holds no symbol, so a press still lands on the symbol beneath.
 */
const HintWait: ClientModule<HintWaitProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const settle = (at: State): void => {
    const { wait, tick } = regionStep(at.wait, surface, at.ticks * HINT_TICK_MS)
    if (tick === 'stop') {
      at.stop?.()
    }
    const stop = tick === 'start' ? surface.every(HINT_TICK_MS, () => advanced(surface.state ?? at)) : tick === 'stop' ? null : at.stop
    if (wait !== at.wait || stop !== at.stop || at !== surface.state) {
      surface.setState({ wait, stop, ticks: at.ticks })
    }
  }
  const advanced = (at: State): void => settle({ ...at, ticks: at.ticks + 1 })
  const now = surface.state ?? { wait: HIDDEN, stop: null, ticks: 0 }
  settle(now)
  return now.wait.isShown ? (
    <Box flexDirection="column" backgroundColor="text" paddingX={1}>
      {props.lines.map((line, i) => (
        <Text key={`line-${i}`} color="inverseText" wrap="truncate-end">
          {line}
        </Text>
      ))}
    </Box>
  ) : (
    <Box />
  )
}

export default HintWait
