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
    if (event.type === 'down' && event.button === 'left') {
      surface.setState({ drag: { from: over, over } })
    } else if (event.type === 'move' && drag !== null && over !== drag.over) {
      surface.setState({ drag: { ...drag, over } })
    } else if (event.type === 'up' && drag !== null) {
      if (drag.from !== over) {
        surface.post({ lines: moved(lines, drag.from, over) })
      }
      surface.setState({ drag: null })
    }
  })
  const drag = surface.state?.drag ?? null
  const shown = drag !== null ? moved(lines, drag.from, drag.over) : lines
  return (
    <Box flexDirection="column">
      {shown.map((line, i) => {
        const isHeld = drag !== null && i === drag.over
        return (
          <Text key={line.key} wrap="truncate-end" color={isHeld ? 'claude' : undefined} dimColor={!isHeld} weight={isHeld ? 'semibold' : undefined}>
            {`⠿ ${line.label}`}
          </Text>
        )
      })}
    </Box>
  )
}

export default PinStrip
