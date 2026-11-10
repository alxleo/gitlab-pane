import type { EngineInterface } from 'claude-code'

import { drawnChoices } from './choices'
import { drawnData } from './data'
import { drawnProblems } from './failures'

/** Everything the pane draws, read at once; reading here makes the pane redraw when any of it changes. */
export async function view($: EngineInterface) {
  const [data, choices, failures, now] = await Promise.all([drawnData($), drawnChoices($), drawnProblems($), $.clock.now()])
  return { ...data, ...choices, failures, now }
}
