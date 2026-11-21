import type { EngineInterface, RenderInput } from 'claude-code'

/**
 * What one drawing of the pane draws with: the surface's own elements, whether it draws Svg or a Select, and the time. It holds no `$`
 * (the engine refuses `$` put in an object), so a function that needs the engine takes it beside the kit. The pane's modules each take it first, so none holds a drawing's state in a variable of its own.
 */
export function kitOf($: EngineInterface, e: RenderInput<'Pane'>, now: number) {
  const elements = $.ui.resolve(e)
  // The terminal's table still answers `Svg`, drawn as an empty box, so the surface decides.
  const Svg = e.surface !== 'terminal' && 'Svg' in elements ? elements.Svg : undefined
  // A phone draws a Select only when its app asked for one, else an empty Box, and the pane cannot tell which it got.
  const Select = e.surface !== 'mobile' ? elements.Select : undefined
  // So may an Input, so a phone has no search box.
  const Input = e.surface !== 'mobile' ? elements.Input : undefined
  // A description waits in a region of its own, which only the desktop draws under a pointer here; elsewhere a symbol keeps
  // its words beside it.
  const Client = e.surface === 'desktop' && 'Client' in elements ? elements.Client : undefined
  const showsHints = Client !== undefined
  return { ...elements, Svg, Select, Input, Client, showsHints, e, now }
}

export type Kit = ReturnType<typeof kitOf>
