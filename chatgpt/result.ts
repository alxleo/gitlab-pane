// What a tool result carries, read from `unknown`: the panel's rows in `_meta.gitlabPane`, what the model sees in
// `structuredContent.mrs`, and how a press ended in `structuredContent.outcome`. The panel, the checks and the probe read a
// result only through these, so each shape is checked in one place.
import { isRecord } from '../hooks/decode.ts'
import type { Outcome } from './move.ts'
import type { Panel } from './read.ts'

const isPanel = (value: unknown): value is Panel => isRecord(value) && Array.isArray(value.sections) && isRecord(value.handOff)

/** The panel a result's `_meta` carries, or null. */
export const panelIn = (meta: unknown): Panel | null => (isRecord(meta) && isPanel(meta.gitlabPane) ? meta.gitlabPane : null)

/** Every row of a panel, its folds included. */
export const rowsOf = (panel: Panel | null) => (panel !== null ? panel.sections.flatMap(section => section.rows) : [])

/** The rows the model is given, each a record of its fields. */
export const modelRows = (structured: unknown): Record<string, unknown>[] => (isRecord(structured) && Array.isArray(structured.mrs) ? structured.mrs.filter(isRecord) : [])

const isOutcome = (value: unknown): value is Outcome =>
  isRecord(value) && (value.state === 'armed' || value.state === 'busy' || (value.state === 'ended' && typeof value.say === 'string' && typeof value.isDone === 'boolean'))

/** How a press ended, from a `press_move` result, or null. */
export const outcomeIn = (structured: unknown): Outcome | null => (isRecord(structured) && isOutcome(structured.outcome) ? structured.outcome : null)

/** A string field of a tool's `_meta` entry, as `ui.resourceUri`, or ''. */
export const metaString = (meta: unknown, entry: string, field: string): string => {
  const inner = isRecord(meta) ? meta[entry] : undefined
  const value = isRecord(inner) ? inner[field] : undefined
  return typeof value === 'string' ? value : ''
}
