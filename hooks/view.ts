import type { EngineInterface } from 'claude-code'

import { drawnChoices } from './choices'
import { drawnData } from './data'
import { drawnProblems, drawnStripFaults } from './failures'

/** Everything the pane draws, read at once; reading here makes the pane redraw when any of it changes. */
export async function view($: EngineInterface) {
  const [data, choices, failures, stripFaults, now] = await Promise.all([drawnData($), drawnChoices($), drawnProblems($), drawnStripFaults($), $.clock.now()])
  return { ...data, ...choices, failures, stripFaults, now }
}
