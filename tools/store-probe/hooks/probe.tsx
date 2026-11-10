import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Beat, Probe, Seen } from '../types'

// A dev-only probe of $.store across processes. Load it with `claude --plugin-dir tools/store-probe` in two or more
// sessions at once and open /store-probe. Every process writes its own key `p:<pid>` and the key `shared` twice a second,
// and draws what it reads of the others: how stale their writes are, whether any was never seen, and whether `shared`
// reads back as its own write (last write wins) or another's.
const PANE = 'store-probe'
const EVERY_MS = 500
const OWN_PREFIX = 'p:'
const SHARED = 'shared'

const probeAtom = atom({ plugin: 'store-probe', key: 'probe' } as const, {
  me: '',
  writes: 0,
  failures: 0,
  lastFailure: '',
  slowestSet: 0,
  slowestGet: 0,
  shared: null,
  overwritten: 0,
  kept: 0,
  seen: [],
} satisfies Probe)

const isBeat = (value: unknown): value is Beat =>
  typeof value === 'object' &&
  value !== null &&
  'pid' in value &&
  'n' in value &&
  'at' in value &&
  typeof value.pid === 'string' &&
  typeof value.n === 'number' &&
  typeof value.at === 'number'

/** The engine's own process id, which the mod cannot ask for directly: the parent of a shell it starts. */
async function pidOf($: EngineInterface): Promise<string> {
  const ran = await $.process.run(['/bin/sh', '-c', 'echo $PPID'], { timeoutMs: 5_000 })
  const pid = ran.stdout.trim()
  return ran.exitCode === 0 && pid !== '' ? pid : await $.session.id()
}

/** Runs `work` and answers how long it took on the engine's clock. */
async function timed($: EngineInterface, work: () => Promise<unknown>): Promise<{ ms: number; value: unknown }> {
  const start = await $.clock.now()
  const value = await work()
  return { ms: (await $.clock.now()) - start, value }
}

/** The beats the other processes' keys hold now, each with the writes of theirs this one never read. */
async function othersSeen($: EngineInterface, me: string, before: readonly Seen[], now: number): Promise<Seen[]> {
  const keys = (await $.store.keys()).filter(key => key.startsWith(OWN_PREFIX) && key !== `${OWN_PREFIX}${me}`)
  const beats = await Promise.all(keys.map(key => $.store.get(key)))
  return beats.filter(isBeat).map(heard => {
    const was = before.find(one => one.pid === heard.pid)
    const skipped = was === undefined ? 0 : was.skipped + Math.max(0, heard.n - was.n - 1)
    return { pid: heard.pid, n: heard.n, age: now - heard.at, skipped }
  })
}

/** One round: write both keys, read `shared` back at once, then read everyone else's. */
async function beat($: EngineInterface): Promise<void> {
  const before = await read($, probeAtom)
  try {
    const now = await $.clock.now()
    const mine: Beat = { pid: before.me, n: before.writes + 1, at: now }
    const wrote = await timed($, async () => {
      await $.store.set(`${OWN_PREFIX}${before.me}`, mine)
      await $.store.set(SHARED, mine)
    })
    const readBack = await timed($, () => $.store.get(SHARED))
    const shared = isBeat(readBack.value) ? readBack.value : null
    const seen = await othersSeen($, before.me, before.seen, await $.clock.now())
    await update($, probeAtom, probe => ({
      ...probe,
      writes: mine.n,
      slowestSet: Math.max(probe.slowestSet, wrote.ms),
      slowestGet: Math.max(probe.slowestGet, readBack.ms),
      shared,
      kept: probe.kept + (shared?.pid === probe.me ? 1 : 0),
      overwritten: probe.overwritten + (shared !== null && shared.pid !== probe.me ? 1 : 0),
      seen,
    }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await update($, probeAtom, probe => ({ ...probe, failures: probe.failures + 1, lastFailure: message }))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const me = await pidOf($)
    await update($, probeAtom, probe => ({ ...probe, me }))
    await $.command.register({ name: 'store-probe', description: 'Open the $.store probe pane' })
    $.clock.every(EVERY_MS, () => {
      beat($).catch(() => undefined)
    })
    return next(e)
  })

  on('command.run', { command: 'store-probe' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Store probe' })
    return { text: 'Store probe pane open' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const probe = await read($, probeAtom)
    return (
      <Box flexDirection="column">
        <Text>
          pid {probe.me}: {probe.writes} writes, {probe.failures} failed
        </Text>
        <Text>
          set max {probe.slowestSet} ms, get max {probe.slowestGet} ms
        </Text>
        <Text>
          shared: kept {probe.kept}, overwritten {probe.overwritten}, now by {probe.shared?.pid ?? 'nobody'}
        </Text>
        {probe.lastFailure !== '' && <Text color="red">{probe.lastFailure}</Text>}
        {probe.seen.length === 0 && <Text dimColor>No other process seen yet.</Text>}
        {probe.seen.map(one => (
          <Text>
            {one.pid}: n {one.n}, age {one.age} ms, skipped {one.skipped}
          </Text>
        ))}
      </Box>
    )
  })
}
