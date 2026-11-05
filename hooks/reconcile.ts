import { advance, pinKey, wakeLine } from './ci'
import type { ModelLine } from './model-text'

import type { MrCard, Pinned } from '../types'

export type Reconciled = {
  /** The open rows: what is drawn and saved. A row merged or closed since it was opened is left out. */
  rows: MrCard[]
  /** Per card key, `<pipeline id>:<what>` already announced. Keys of MRs not pinned any more are kept as they were. */
  announced: Record<string, string[]>
  /** Every pin's news and every pin that ended, for the user to see. */
  toasts: string[]
  /** What wakes the session: only news of an MR it raised. */
  wakes: ModelLine[]
  /** Keys of pinned MRs that are closed or merged. */
  unpinned: string[]
}

/**
 * What a read means for the pinned MRs: which are news, which wake the session, which have ended. `rows` are the fresh
 * ones, then those kept from the read before. Nothing here reads or writes the engine, so it can be tried on plain data.
 */
export function reconcile(input: {
  pinned: readonly Pinned[]
  rows: readonly MrCard[]
  announced: Readonly<Record<string, readonly string[]>>
  now: number
}): Reconciled {
  const announced: Record<string, string[]> = Object.fromEntries(Object.entries(input.announced).map(([key, told]) => [key, [...told]]))
  const toasts: string[] = []
  const wakes: ModelLine[] = []
  const unpinned: string[] = []
  for (const pin of input.pinned) {
    const row = input.rows.find(each => each.key === pinKey(pin))
    if (!row) {
      continue
    }
    if (!row.isOpen) {
      unpinned.push(row.key)
      toasts.push(`!${row.iid} is closed or merged; unpinned.`)
      continue
    }
    const prior = announced[row.key]
    const next = advance(prior ?? [], row)
    announced[row.key] = next.announced
    // The first sighting only seeds: what it shows was told when it was pinned.
    if (next.due && prior !== undefined) {
      const line = wakeLine(row, next.due, input.now)
      // Every pin's news is a toast; only an MR this session raised wakes it, since that is the work it can act on.
      toasts.push(line)
      if (pin.origin !== 'watched') {
        wakes.push(line)
      }
    }
  }
  return { rows: input.rows.filter(row => row.isOpen), announced, toasts, wakes, unpinned }
}
