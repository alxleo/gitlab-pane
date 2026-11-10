import type { EngineInterface, RenderInput } from 'claude-code'

/**
 * What one drawing of the pane draws with: the surface's own elements, whether it draws Svg, and the time. It holds no `$`
 * (the engine refuses `$` put in an object), so a function that needs the engine takes it beside the kit. The pane's modules each take it first, so none holds a drawing's state in a variable of its own.
 */
export function kitOf($: EngineInterface, e: RenderInput<'Pane'>, now: number) {
  const elements = $.ui.resolve(e)
  // The terminal's table still answers `Svg`, drawn as an empty box, so the surface decides.
  const Svg = e.surface !== 'terminal' && 'Svg' in elements ? elements.Svg : undefined
  // A region the mod draws itself, which follows the pointer: the terminal and the desktop draw it; VS Code's table still
  // answers `Client`, but it carries no region there, so the surface decides here too.
  const Client = (e.surface === 'terminal' || e.surface === 'desktop') && 'Client' in elements ? elements.Client : undefined
  return { ...elements, Svg, Client, e, now }
}

export type Kit = ReturnType<typeof kitOf>
