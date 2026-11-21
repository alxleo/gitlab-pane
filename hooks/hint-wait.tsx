import type { ClientModule } from 'claude-code'

import { HIDDEN, HINT_TICK_MS, isWaiting, waitStep } from './hint-chip'
import type { Wait } from './hint-chip'

/** What `hinted` hands the region: the description's lines, as `hintChip` made them. */
export type HintWaitProps = { lines: string[] }

type State = { wait: Wait; stop: (() => void) | null }

/**
 * The region inside a description's box. The app reveals the box the moment the pointer touches its symbol, and lays the
 * region out again as it shows or hides; `waitStep` decides from that and the clock when the words show, so every rest
 * waits, the second as the first. The region holds no symbol, so a press still lands on the symbol beneath.
 */
const HintWait: ClientModule<HintWaitProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const settle = (at: State): void => {
    const wait = waitStep(at.wait, surface.columns > 0 && surface.rows > 0, Date.now())
    if (wait === at.wait) {
      return
    }
    if (!isWaiting(wait)) {
      at.stop?.()
    }
    const stop = isWaiting(wait) ? (at.stop ?? surface.every(HINT_TICK_MS, () => settle(surface.state ?? at))) : null
    surface.setState({ wait, stop })
  }
  const now = surface.state ?? { wait: HIDDEN, stop: null }
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
