import { isRecord } from './decode.ts'

import type { Role } from '../types'

// Which session reads GitLab for all of them. Sessions elect one leader through a record in the plugin's store, which every
// Claude process on the machine reads and writes. The store has no compare-and-swap, so two sessions can both write at
// once and the last write wins; that is allowed to happen. The record is read again every tick, so the session that lost
// finds another's record there at its next tick and follows, and a leader's work must be harmless to do twice.
//
// This file only decides, from plain data. lease-store.ts reads the record, asks `decide`, and writes what it answers.

/** How often a renewing leader writes its record: Firestore's primary lease renews at the same pace. */
export const RENEW_MS = 4_000
/** A record not renewed for this long is dead, whoever wrote it: three renewals missed. */
export const EXPIRY_MS = 12_000
/** How often a session runs `decide`: no longer than a renew period, so a double leader is resolved within one. */
export const TICK_MS = 2_000

/** The lease as stored: who holds it and when they last said so, on the clock every session on the machine shares. */
export type LeaseRecord = { owner: string; renewedAt: number }

/**
 * What a session does with GitLab now. A `leader` reads it and writes the snapshot; a `follower` reads the snapshot; a
 * `wake-only` session has no pane drawn anywhere and polls only the MRs it raised, so their wakes still fire; an `idle`
 * session polls nothing. (Declared with the other contract types, which `types/index.d.ts` holds.)
 */
export type { Role }

/** Why the record changes: `acquire` a free or expired lease, `take-over` another's expired one, `renew` one's own, `release` it. */
export type Move = 'keep' | 'acquire' | 'take-over' | 'renew' | 'release'

/** What to do to the stored record: leave it, set it, or remove it. */
export type Write = { kind: 'none' } | { kind: 'set'; record: LeaseRecord } | { kind: 'clear' }

export type Decision = { role: Role; move: Move; write: Write }

export type LeaseInput = {
  /** What the store holds, or null when it holds nothing a lease can be read from. */
  record: LeaseRecord | null
  /** This session's id. */
  me: string
  now: number
  /** Whether a surface draws this session's pane now: the engine's `$.ui.panes()` says so (see `isPaneDrawn` in panes.ts). */
  isDrawing: boolean
  /** How many MRs this session raised that are still open. */
  raisedPins: number
}

/** The record a stored value is, or null for anything else: the store holds whatever any version of the mod wrote. */
export function readRecord(value: unknown): LeaseRecord | null {
  if (!isRecord(value)) {
    return null
  }
  const { owner, renewedAt } = value
  return typeof owner === 'string' && owner !== '' && typeof renewedAt === 'number' && Number.isFinite(renewedAt) ? { owner, renewedAt } : null
}

/** Whether a record still holds the lease. A renewal stamped far ahead of this clock is no proof of life, so it expires too. */
export function isHeld(record: LeaseRecord, now: number): boolean {
  return Math.abs(now - record.renewedAt) < EXPIRY_MS
}

const KEEP = { kind: 'none' } as const

/** What a session with no lease to lead does: poll its raised MRs alone, or nothing. */
const withoutPane = (raisedPins: number): Role => (raisedPins > 0 ? 'wake-only' : 'idle')

/** The role this session takes and the record it writes, from the record it just read. */
export function decide({ record, me, now, isDrawing, raisedPins }: LeaseInput): Decision {
  if (record === null || !isHeld(record, now)) {
    if (!isDrawing) {
      return { role: withoutPane(raisedPins), move: 'keep', write: KEEP }
    }
    const move = record !== null && record.owner !== me ? 'take-over' : 'acquire'
    return { role: 'leader', move, write: { kind: 'set', record: { owner: me, renewedAt: now } } }
  }
  if (record.owner !== me) {
    return { role: 'follower', move: 'keep', write: KEEP }
  }
  if (!isDrawing) {
    return { role: withoutPane(raisedPins), move: 'release', write: { kind: 'clear' } }
  }
  if (now - record.renewedAt >= RENEW_MS) {
    return { role: 'leader', move: 'renew', write: { kind: 'set', record: { owner: me, renewedAt: now } } }
  }
  return { role: 'leader', move: 'keep', write: KEEP }
}
