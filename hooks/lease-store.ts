import type { EngineInterface } from 'claude-code'

import { decide, readRecord } from './lease'
import type { LeaseInput, LeaseRecord, Role, Write } from './lease'

// The engine side of lease.ts: the record lives under one key of the plugin's `$.store`, a file every Claude process of
// the user shares. A set or delete is a read-modify-write of that whole file under a lock, so a write never loses another
// key's update; the lease key itself has no compare-and-swap, so two writers still race and the last one wins.
const LEASE_KEY = 'lease'

/** What a tick found: the role to act in, and what went wrong with the store, if anything. */
export type Tick = { role: Role; problem: string | null }

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The record now stored; an unreadable store holds none, and says why. */
async function stored($: EngineInterface): Promise<{ record: LeaseRecord | null; problem: string | null }> {
  try {
    return { record: readRecord(await $.store.get(LEASE_KEY)), problem: null }
  } catch (error) {
    return { record: null, problem: messageOf(error) }
  }
}

/** Applies what `decide` answered. A release removes the record only while it is still this session's. */
async function apply($: EngineInterface, write: Write, me: string): Promise<void> {
  if (write.kind === 'set') {
    await $.store.set(LEASE_KEY, write.record)
  } else if (write.kind === 'clear' && (await stored($)).record?.owner === me) {
    await $.store.delete(LEASE_KEY)
  }
}

/**
 * One tick of the election: reads the record, decides, writes. A store that cannot be read or written does not stop the
 * session working: the decision stands, so a drawing session leads alone, as every session did before there was a lease.
 */
export async function leaseTick($: EngineInterface, view: Pick<LeaseInput, 'isDrawing' | 'raisedPins'>): Promise<Tick> {
  const [me, now, found] = await Promise.all([$.session.id(), $.clock.now(), stored($)])
  const decision = decide({ ...view, record: found.record, me, now })
  try {
    await apply($, decision.write, me)
  } catch (error) {
    return { role: decision.role, problem: messageOf(error) }
  }
  return { role: decision.role, problem: found.problem }
}
