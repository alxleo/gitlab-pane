import type { ClientModule } from 'claude-code'

import { lineAt, moved } from './pin-order'
import type { Drag, PinStripProps } from './pin-order'

/**
 * This session's pins, one line each, dragged into the person's own order. It runs where it is drawn, beside the pointer,
 * so a line follows the drag as it moves; once one is dropped somewhere new, it sends its lines in their new order to the
 * pane's hooks, which keep that order and hand it back. One line is one row, so the row under the pointer is the line.
 */
const PinStrip: ClientModule<PinStripProps, { drag: Drag | null }> = (props, surface) => {
  const { Box, Text } = surface.elements
  const { lines } = props
  surface.onPointer(event => {
    const drag = surface.state?.drag ?? null
    const over = lineAt(event.y, lines.length)
    if (event.type === 'down') {
      // Only the left button picks a line up; any other press, or one on an empty strip, holds nothing.
      const line = event.button === 'left' ? lines[over] : undefined
      surface.setState({ drag: line !== undefined ? { key: line.key, over } : null })
      return
    }
    if (drag === null) {
      return
    }
    const from = lines.findIndex(line => line.key === drag.key)
    // The pin held went (it merged, or was unpinned), or the button came up where the strip did not see it: the drag ends.
    if (from < 0 || (event.type === 'move' && event.button === undefined)) {
      surface.setState({ drag: null })
    } else if (event.type === 'move' && over !== drag.over) {
      surface.setState({ drag: { ...drag, over } })
    } else if (event.type === 'up') {
      if (from !== over) {
        surface.post({ lines: moved(lines, from, over) })
      }
      surface.setState({ drag: null })
    }
  })
  const drag = surface.state?.drag ?? null
  const from = drag !== null ? lines.findIndex(line => line.key === drag.key) : -1
  const held = drag !== null && from >= 0 ? Math.min(drag.over, lines.length - 1) : -1
  const shown = held >= 0 ? moved(lines, from, held) : lines
  return (
    <Box flexDirection="column">
      {shown.map((line, i) => {
        const isHeld = i === held
        return (
          <Text key={line.key} wrap="truncate-end" color={isHeld ? 'claude' : undefined} dimColor={!isHeld} weight={isHeld ? 'semibold' : undefined}>
            {`↕ ${line.label}`}
          </Text>
        )
      })}
    </Box>
  )
}

export default PinStrip
