import type { EngineInterface } from 'claude-code'

import { pinMr, readHosts, readPinned, unpinKeys } from './data'
import { quietly } from './failures'
import { parseMrUrl, pinKey } from './mr-url'
import { isPublished, PINS_PREFIX, readPinsRecord, readSnapshot, REFRESH_KEY, SNAPSHOT_KEY, unionPins } from './snapshot.ts'
import type { PinsRecord, Snapshot } from './snapshot.ts'

import type { Pinned } from '../types'

// The store as the sessions share it: the lease (lease-store.ts), the snapshot, each session's pins and the counter that asks
// for a read. Each is a key of its own, so a write to one never loses another's (the store merges by key), and the large
// value, the snapshot, is written only by the leader and only after a read.

/** The snapshot the leader last wrote, or null when there is none a session of this version can read. */
export async function loadSnapshot($: EngineInterface): Promise<Snapshot | null> {
  return readSnapshot(await $.store.get(SNAPSHOT_KEY))
}

export async function saveSnapshot($: EngineInterface, snapshot: Snapshot): Promise<void> {
  await $.store.set(SNAPSHOT_KEY, snapshot)
}

const pinsKey = (session: string): string => `${PINS_PREFIX}${session}`

/**
 * The person's pin from a card: puts the MR in this session, last, or takes it out again. It wakes nothing, as `watch_mr`
 * does not, and is published for the leader as every pin is.
 */
export function togglePin($: EngineInterface, key: string, url: string): void {
  quietly(
    $,
    (async () => {
      if ((await readPinned($)).some(one => pinKey(one) === key)) {
        await unpinKeys($, [key])
      } else {
        const parsed = parseMrUrl(url, await readHosts($))
        if (parsed === null) {
          throw new Error(`Not a merge request URL on the hosts set: ${url}`)
        }
        await pinMr($, parsed, 'watched')
      }
      await publishPins($, await readPinned($))
    })()
  )
}

/**
 * Says what this session has pinned, when that is not what the store holds or its beat is due. A session with no pins
 * leaves no record, so one that never pinned writes nothing.
 */
export async function publishPins($: EngineInterface, pins: readonly Pinned[]): Promise<void> {
  const [session, now] = await Promise.all([$.session.id(), $.clock.now()])
  const stored = readPinsRecord(await $.store.get(pinsKey(session)))
  if (pins.length === 0) {
    if (stored !== null) {
      await $.store.delete(pinsKey(session))
    }
  } else if (!isPublished(stored, pins, now)) {
    const record: PinsRecord = { session, at: now, pins: [...pins] }
    await $.store.set(pinsKey(session), record)
  }
}

/**
 * Every pin to read: this session's and those of the other sessions that beat lately. A session that went silent has its
 * record removed here, so the store does not keep what a closed session left.
 */
export async function pinsToRead($: EngineInterface, own: readonly Pinned[]): Promise<Pinned[]> {
  const [me, now, keys] = await Promise.all([$.session.id(), $.clock.now(), $.store.keys()])
  const found = await Promise.all(
    keys.filter(key => key.startsWith(PINS_PREFIX) && key !== pinsKey(me)).map(async key => ({ key, record: readPinsRecord(await $.store.get(key)) }))
  )
  const live = unionPins(
    own,
    found.flatMap(({ record }) => (record !== null ? [record] : [])),
    now
  )
  const gone = found.filter(({ record }) => record === null || unionPins([], [record], now).length === 0)
  await Promise.all(gone.map(({ key }) => $.store.delete(key)))
  return live
}

/** Asks the leader for a read now, from any session. */
export async function askForRefresh($: EngineInterface): Promise<void> {
  await $.store.set(REFRESH_KEY, (await readRefreshes($)) + 1)
}

/** How many times a read was asked for. */
export async function readRefreshes($: EngineInterface): Promise<number> {
  const count = await $.store.get(REFRESH_KEY)
  return typeof count === 'number' ? count : 0
}
