import type { EngineInterface } from 'claude-code'

import { drawnChoices } from './choices'
import { drawnData } from './data'
import { drawnProblems } from './failures'
import { hereProject } from './moves'
import { pressedIn } from './next-move'
import { drawnWrites } from './writes'

/**
 * Everything the pane draws, read at once; reading here makes the pane redraw when any of it changes. The ledger of
 * writes is read once: the moves' presses and the suggested reviewers' adds are both entries of it.
 */
export async function view($: EngineInterface) {
  const [data, choices, failures, writes, here, now] = await Promise.all([drawnData($), drawnChoices($), drawnProblems($), drawnWrites($), hereProject($), $.clock.now()])
  return { ...data, ...choices, failures, pressed: pressedIn(writes), writes, here, now }
}
