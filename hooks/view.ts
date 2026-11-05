import type { EngineInterface } from 'claude-code'

import { drawnChoices } from './choices'
import { drawnData } from './data'

/** Everything the pane draws, read at once; reading here makes the pane redraw when any of it changes. */
export async function view($: EngineInterface) {
  const [data, choices, now] = await Promise.all([drawnData($), drawnChoices($), $.clock.now()])
  return { ...data, ...choices, now }
}
