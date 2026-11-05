// Reading only what changed. A whole read of the authored list costs GitLab 158 of the 250 a query may, and most polls find
// nothing new, so between whole reads the leader asks for the MRs updated since the last one (`updatedAfter`), of every
// state so that one merged or closed shows up as such. GitLab does not bump `updatedAt` when an MR's pipeline moves,
// when another MR merges into its target and it starts to conflict, or when a rule changes, so those are read another
// way: a running pipeline's MR is read on its own, the merge verdicts are read for all MRs every time, and a whole read
// comes round every `FULL_EVERY_MS` for the rest. Pure, on plain data.
import type { AuthoredScope } from './authored-request.ts'
import type { Cursor } from './snapshot.ts'
import { isSettled } from './status.ts'

import type { MergeStatus, MrCard } from '../types'

/**
 * How long between whole reads. A merge or close is seen at once (the delta asks for every state) and a pipeline is read
 * as it moves, so the whole read only catches what bumps nothing: conflicts, a rebase, an approval rule changed. Those
 * were seen within the old three minutes; five keeps the whole reads at twelve an hour, from twenty, and a delta in
 * between costs a small query for the changes and one for the verdicts.
 */
export const FULL_EVERY_MS = 5 * 60_000
/** A delta starts this long before the last read began, so a clock a little apart from GitLab's loses nothing. */
export const OVERLAP_MS = 60_000
/** Past this many running pipelines to read one by one, a whole read is cheaper than the single ones. */
export const MOVING_MAX = 5

/** A host's next read: from its cursor, or whole when it has none, its last whole read is old, or the person asked for a fresh one. */
export function scopeFor(cursor: Cursor | undefined, now: number, isFresh: boolean): AuthoredScope {
  return isFresh || cursor === undefined || now - cursor.fullAt >= FULL_EVERY_MS ? { kind: 'open' } : { kind: 'since', after: cursor.after }
}

/** The cursor after a read that began at `startedAt`; a delta leaves the time of the last whole read as it was. */
export function cursorAfter(scope: AuthoredScope, startedAt: number, previous: Cursor | undefined): Cursor {
  return {
    after: new Date(startedAt - OVERLAP_MS).toISOString(),
    fullAt: scope.kind === 'open' || previous === undefined ? startedAt : previous.fullAt,
  }
}

/** The open MRs whose pipeline is still going: GitLab does not say, in the changes since, that it moved. */
export const movingRows = (rows: readonly MrCard[]): MrCard[] =>
  rows.filter(row => row.isOpen && row.pipeline !== undefined && !isSettled(row.pipeline.status))

/** What one host's read found, to be put with what was known of it. */
export type HostFound = {
  scope: AuthoredScope['kind']
  /** The host's rows before this read. */
  base: readonly MrCard[]
  /** The authored read: every open MR for a whole read, those changed (any state) for a delta. */
  fetched: readonly MrCard[]
  /** MRs read one by one: pinned ones the authored list lacks, and running pipelines. Any state. */
  singles: readonly MrCard[]
  /** Keys pinned by any session, whose closed MRs are kept so each session can unpin its own. */
  pinned: ReadonlySet<string>
  /** GitLab's verdicts by card key, or null when the host has none or could not be asked. */
  verdicts: ReadonlyMap<string, MergeStatus> | null
}

/**
 * The host's rows after a read. A whole read starts from nothing; a delta from the rows known, less the closed ones nobody
 * pins any more. A card read opens or replaces its row, and one that is closed stays only while pinned. A row keeps
 * its last verdict through a delta that brings none.
 */
export function mergeReads({ scope, base, fetched, singles, pinned, verdicts }: HostFound): MrCard[] {
  const before = new Map(base.map(row => [row.key, row]))
  const rows = new Map(scope === 'since' ? base.filter(row => row.isOpen || pinned.has(row.key)).map(row => [row.key, row]) : [])
  for (const card of [...fetched, ...singles]) {
    if (card.isOpen || pinned.has(card.key)) {
      rows.set(card.key, card)
    } else {
      rows.delete(card.key)
    }
  }
  return [...rows.values()].map(row => ({
    ...row,
    mergeStatus: verdicts?.get(row.key) ?? (scope === 'since' ? (before.get(row.key)?.mergeStatus ?? null) : null),
  }))
}
