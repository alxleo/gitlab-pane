// The ledger of what this session sets out to write to GitLab, on plain data: what any write needs whatever it writes (a
// merge, a rebase, a reply). A write is confirmed for what the person saw, sent once and never again on its own, and
// one whose answer was lost may still have been made, so it is said to be unknown, never failed outright. writes.ts holds
// the entries; each feature decides its presses, says what it sends and how it is drawn. Pure.
import { kindOf, messageOf } from './failure.ts'
import { foreign } from './model-text.ts'

import type { Write } from '../types'

/**
 * How long a sent write is believed to be under way: the longest the pane follows one (a merge's looks, each waiting on
 * GitLab). Past it, the session that sent it was closed or reloaded mid-way, and nothing will say how it ended.
 */
export const SENT_HOLDS_MS = 4 * 60_000

/** Why a write sent long ago has no outcome: its answer was lost with the session or the reload that was waiting for it. */
export const LOST = 'no answer came back: it may have reached GitLab, so look before trying again'

/**
 * The entry as it holds now: one sent longer ago than any write is followed has lost its answer, and says so rather than
 * claiming to be under way for ever. An armed one is taken back by its owner's timer; a hand-off or a failure holds until
 * what it was for changes.
 */
export function liveOf<Kind extends string>(write: Write<Kind> | undefined, now: number): Write<Kind> | undefined {
  return write?.state === 'sent' && now - write.at > SENT_HOLDS_MS ? { kind: write.kind, state: 'failed', on: write.on, at: write.at, say: LOST } : write
}

/** GitLab's words for why a write failed, or an error's, on one short line for a row and a toast. */
export const why = (error: string): string => foreign(error, 120)

/**
 * Why a write did not take, and whether it may have reached GitLab all the same: a dropped connection, a timeout or a
 * server error may have come after GitLab took it, and such a write is followed or looked for, never sent again.
 */
export type Refusal = { reason: string; mayHaveLanded: boolean }

/** An error from sending a write as a refusal. The engine's own refusal (`… refused: …`, a policy) never left the machine. */
export function refusalOf(error: unknown): Refusal {
  const message = messageOf(error)
  const kind = kindOf(error)
  return { reason: why(message), mayHaveLanded: (kind === 'network' || kind === 'timeout' || kind === 'server') && !/\brefused:/u.test(message) }
}
