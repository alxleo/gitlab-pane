import type { EngineInterface, RenderChildren, RenderInput } from 'claude-code'

import type { MarkdownText } from './markdown'

/**
 * What one drawing of the pane draws with: the surface's own elements, whether it draws Svg, and the time. It holds no `$`
 * (the engine refuses `$` put in an object), so a function that needs the engine takes it beside the kit. The pane's modules each take it first, so none holds a drawing's state in a variable of its own.
 */
export function kitOf($: EngineInterface, e: RenderInput<'Pane'>, now: number) {
  const elements = $.ui.resolve(e)
  // The terminal's table still answers `Svg`, drawn as an empty box, so the surface decides.
  const Svg = e.surface !== 'terminal' && 'Svg' in elements ? elements.Svg : undefined
  return { ...elements, Svg, e, now }
}

export type Kit = ReturnType<typeof kitOf>

/** The Markdown element takes only text made for it, so a title or name cannot be drawn as Markdown by accident. */
export function markdown(kit: Kit, text: MarkdownText) {
  const { Markdown } = kit
  return <Markdown text={text} />
}

// The desktop paints no background on a floating Box, so a card opens in the flow under its line instead.
// A scope groups a trigger with its card, so neither needs a key; keys would only spend the character budget.
// The desktop joins a Box to its scope only when its hover also sets a style, so a trigger tints faintly in either
// theme; short, as every row draws several. A terminal would paint this colour solid grey and needs no style to join.
export const joins = (kit: Kit, scope: string) => (kit.e.surface === 'terminal' ? { scope } : { scope, backgroundColor: '#8882' })

export function trigger(kit: Kit, scope: string, child: RenderChildren) {
  const { Box } = kit
  return (
    <Box flexDirection="row" alignItems="center" flexShrink={0} hover={joins(kit, scope)}>
      {child}
    </Box>
  )
}

/** Inside an MR's bordered card a second border would nest, so a reveal is set off by its indent alone. */
export function reveal(kit: Kit, scope: string, card: RenderChildren) {
  const { Box } = kit
  return (
    <Box display="none" hover={{ scope, display: 'flex' }} flexDirection="column" paddingLeft={2} paddingY={1}>
      {card}
    </Box>
  )
}
