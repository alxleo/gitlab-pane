import type { EngineInterface } from 'claude-code'

import { drawnChoices } from './choices'
import { drawnData } from './data'
import { drawnProblems } from './failures'
import { drawnPressed, hereProject } from './moves'

/** Everything the pane draws, read at once; reading here makes the pane redraw when any of it changes. */
export async function view($: EngineInterface) {
  const [data, choices, failures, pressed, here, now] = await Promise.all([drawnData($), drawnChoices($), drawnProblems($), drawnPressed($), hereProject($), $.clock.now()])
  return { ...data, ...choices, failures, pressed, here, now }
}
