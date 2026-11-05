import { expect, test } from 'vitest'
import fc from 'fast-check'

import { EXPIRY_MS, RENEW_MS, TICK_MS, decide, isHeld, readRecord } from '../../hooks/lease.ts'
import type { Decision, LeaseRecord, Role } from '../../hooks/lease.ts'

type Session = { me: string; isDrawing: boolean; raisedPins: number }

const T0 = 1_000_000

const session = (me: string, over: Partial<Session> = {}): Session => ({ me, isDrawing: true, raisedPins: 0, ...over })

/** The stored record after a decision wrote its part. */
const stored = (record: LeaseRecord | null, { write }: Decision): LeaseRecord | null =>
  write.kind === 'set' ? write.record : write.kind === 'clear' ? null : record

/** One session's tick against the record in the store; the next record is what the store holds afterwards. */
const tick = (record: LeaseRecord | null, who: Session, now: number) => {
  const decision = decide({ record, me: who.me, now, isDrawing: who.isDrawing, raisedPins: who.raisedPins })
  return { decision, record: stored(record, decision) }
}

/** Every session ticks in turn, each reading what the one before wrote. Answers the record and each one's role. */
const round = (record: LeaseRecord | null, who: readonly Session[], now: number) => {
  const start: { record: LeaseRecord | null; roles: Record<string, Role> } = { record, roles: {} }
  return who.reduce((state, one) => {
    const next = tick(state.record, one, now)
    return { record: next.record, roles: { ...state.roles, [one.me]: next.decision.role } }
  }, start)
}

/** Every session reads the same record, then all write, in order: the race the store allows, as it has no compare-and-swap. */
const race = (record: LeaseRecord | null, who: readonly Session[], now: number) => {
  const decisions = who.map(one => ({ me: one.me, decision: decide({ record, me: one.me, now, isDrawing: one.isDrawing, raisedPins: one.raisedPins }) }))
  return {
    record: decisions.reduce((held, one) => stored(held, one.decision), record),
    roles: Object.fromEntries(decisions.map(one => [one.me, one.decision.role])),
  }
}

test('a lone drawing session takes the lease, renews it each period and keeps it between', () => {
  const alone = session('a')
  const first = tick(null, alone, T0)
  expect(first.decision).toEqual({ role: 'leader', move: 'acquire', write: { kind: 'set', record: { owner: 'a', renewedAt: T0 } } })

  const soon = tick(first.record, alone, T0 + TICK_MS)
  expect(soon.decision).toEqual({ role: 'leader', move: 'keep', write: { kind: 'none' } })

  const due = tick(first.record, alone, T0 + RENEW_MS)
  expect(due.decision.move).toBe('renew')
  expect(due.record).toEqual({ owner: 'a', renewedAt: T0 + RENEW_MS })
})

test('a session whose pane is not drawn does not take a free lease', () => {
  const hidden = session('a', { isDrawing: false })
  expect(tick(null, hidden, T0).decision).toEqual({ role: 'idle', move: 'keep', write: { kind: 'none' } })
})

test('a second drawing session follows the leader and never writes while the lease is held', () => {
  const held = { owner: 'a', renewedAt: T0 }
  const decision = tick(held, session('b'), T0 + TICK_MS).decision
  expect(decision).toEqual({ role: 'follower', move: 'keep', write: { kind: 'none' } })
})

test('two sessions racing for a free lease leave one leader once the loser reads the record again', () => {
  const who = [session('a'), session('b')]
  const raced = race(null, who, T0)
  expect(raced.roles).toEqual({ a: 'leader', b: 'leader' })
  expect(raced.record?.owner).toBe('b')

  const settled = round(raced.record, who, T0 + TICK_MS)
  expect(settled.roles).toEqual({ a: 'follower', b: 'leader' })
})

test('a late renewal over a takeover is resolved at the next tick', () => {
  // a stalled past expiry, b took over; then a's renewal, read before the takeover, lands over b's record.
  const expired = { owner: 'a', renewedAt: T0 }
  const takeover = tick(expired, session('b'), T0 + EXPIRY_MS + 1)
  expect(takeover.decision.move).toBe('take-over')
  const overwritten = { owner: 'a', renewedAt: T0 + EXPIRY_MS + 2 }
  const next = round(overwritten, [session('a'), session('b')], T0 + EXPIRY_MS + 3 * TICK_MS)
  expect(next.roles).toEqual({ a: 'leader', b: 'follower' })
})

test('a leader that stalled past expiry and wakes with nobody else drawing takes its own lease again', () => {
  const stale = { owner: 'a', renewedAt: T0 }
  const decision = tick(stale, session('a'), T0 + 5 * EXPIRY_MS).decision
  expect(decision.move).toBe('acquire')
  expect(decision.role).toBe('leader')
})

test('a leader whose pane closes releases at once and a drawing session takes over at its next tick', () => {
  const lead = session('a')
  const held = tick(null, lead, T0).record
  const closed = tick(held, { ...lead, isDrawing: false }, T0 + 1_000)
  expect(closed.decision).toEqual({ role: 'idle', move: 'release', write: { kind: 'clear' } })
  expect(closed.record).toBeNull()

  const handoff = tick(closed.record, session('b'), T0 + 1_000 + TICK_MS)
  expect(handoff.decision.role).toBe('leader')
  expect(handoff.decision.move).toBe('acquire')
})

test('a hidden session does not release a lease it does not hold', () => {
  const held = { owner: 'a', renewedAt: T0 }
  expect(tick(held, session('b', { isDrawing: false }), T0 + 1_000).decision.write).toEqual({ kind: 'none' })
})

test('with no pane drawn anywhere, only a session that raised an MR keeps polling, for those MRs alone', () => {
  const raised = session('a', { isDrawing: false, raisedPins: 2 })
  const bystander = session('b', { isDrawing: false })
  const closed = round(null, [raised, bystander], T0)
  expect(closed.roles).toEqual({ a: 'wake-only', b: 'idle' })
  expect(closed.record).toBeNull()
})

test('a leader that closes its pane while it holds raised MRs falls back to waking alone', () => {
  const held = { owner: 'a', renewedAt: T0 }
  const decision = tick(held, session('a', { isDrawing: false, raisedPins: 1 }), T0 + 1_000).decision
  expect(decision).toEqual({ role: 'wake-only', move: 'release', write: { kind: 'clear' } })
})

test('a session that raised an MR follows a leader instead of polling alone while a pane is drawn elsewhere', () => {
  const held = { owner: 'a', renewedAt: T0 }
  expect(tick(held, session('b', { isDrawing: false, raisedPins: 1 }), T0 + TICK_MS).decision.role).toBe('follower')
})

test('a record a clock far ahead wrote, or one past its time, does not hold the lease', () => {
  expect(isHeld({ owner: 'a', renewedAt: T0 }, T0 + EXPIRY_MS - 1)).toBe(true)
  expect(isHeld({ owner: 'a', renewedAt: T0 }, T0 + EXPIRY_MS)).toBe(false)
  expect(isHeld({ owner: 'a', renewedAt: T0 + EXPIRY_MS }, T0)).toBe(false)
})

test('only a record with an owner and a finite time is read as a lease', () => {
  expect(readRecord({ owner: 'a', renewedAt: T0 })).toEqual({ owner: 'a', renewedAt: T0 })
  expect(readRecord({ owner: 'a', renewedAt: T0, extra: 1 })).toEqual({ owner: 'a', renewedAt: T0 })
  for (const bad of [undefined, null, 'a', 3, [], {}, { owner: '', renewedAt: T0 }, { owner: 'a' }, { owner: 'a', renewedAt: 'x' }, { owner: 'a', renewedAt: NaN }]) {
    expect(readRecord(bad)).toBeNull()
  }
})

test('the lease outlives a missed renewal and a tick is never slower than a renewal', () => {
  expect(EXPIRY_MS).toBeGreaterThanOrEqual(2 * RENEW_MS)
  expect(TICK_MS).toBeLessThanOrEqual(RENEW_MS)
})

// ---- properties -------------------------------------------------------------------------------------------------------

type Move = { who: 'a' | 'b'; isDrawing: boolean; otherDrawing: boolean; raised: number; dt: number; isSplit: boolean }

const moveArb: fc.Arbitrary<Move> = fc.record({
  who: fc.constantFrom('a', 'b'),
  isDrawing: fc.boolean(),
  otherDrawing: fc.boolean(),
  raised: fc.integer({ min: 0, max: 2 }),
  dt: fc.integer({ min: 0, max: 2 * EXPIRY_MS }),
  isSplit: fc.boolean(),
})

/**
 * Two sessions' ticks in any interleaving the store allows. A split tick reads the record, then the other session ticks whole,
 * and only then does the first write what it decided on the record it had read: the race a store with no compare-and-swap lets happen.
 */
const interleaved = (moves: readonly Move[], start: number): { record: LeaseRecord | null; now: number } =>
  moves.reduce<{ record: LeaseRecord | null; now: number }>(
    (state, move) => {
      const now = state.now + move.dt
      const other = move.who === 'a' ? 'b' : 'a'
      const me = session(move.who, { isDrawing: move.isDrawing, raisedPins: move.raised })
      const them = session(other, { isDrawing: move.otherDrawing })
      if (!move.isSplit) {
        return { record: tick(tick(state.record, me, now).record, them, now).record, now }
      }
      const decision = decide({ record: state.record, me: me.me, now, isDrawing: me.isDrawing, raisedPins: me.raisedPins })
      const between = tick(state.record, them, now).record
      return { record: stored(between, decision), now }
    },
    { record: null, now: start }
  )

test('after any interleaving of two sessions ticks, at most one leads once both have ticked in turn, and it stays the one for a renew period', () => {
  fc.assert(
    fc.property(fc.array(moveArb, { maxLength: 12 }), fc.boolean(), (moves, aFirst) => {
      const chaos = interleaved(moves, T0)
      const who = aFirst ? [session('a'), session('b')] : [session('b'), session('a')]
      let held = chaos.record
      let leader: string | undefined
      for (let at = chaos.now + TICK_MS; at < chaos.now + RENEW_MS; at += TICK_MS) {
        const settled = round(held, who, at)
        const leaders = Object.entries(settled.roles).filter(([, role]) => role === 'leader')
        expect(leaders.length).toBeLessThanOrEqual(1)
        leader ??= leaders[0]?.[0]
        // Once settled, the same session keeps leading while its record is renewed.
        expect(leaders[0]?.[0]).toBe(leader)
        held = settled.record
      }
    })
  )
})

test('a leader that dies is followed from while its record holds and replaced by the first tick after it expires', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 10 * EXPIRY_MS }), fc.integer({ min: 0, max: EXPIRY_MS }), (renewedAt, wait) => {
      const dead: LeaseRecord = { owner: 'a', renewedAt }
      let held: LeaseRecord | null = dead
      for (let at = renewedAt + wait; at <= renewedAt + EXPIRY_MS + TICK_MS; at += TICK_MS) {
        const next = tick(held, session('b'), at)
        expect(next.decision.role === 'leader').toBe(at - renewedAt >= EXPIRY_MS || held?.owner === 'b')
        held = next.record
      }
      expect(held?.owner).toBe('b')
    })
  )
})
