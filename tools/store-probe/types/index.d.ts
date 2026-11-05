/** What one process wrote: its pid, how many writes it has made, and its clock when it wrote. */
export type Beat = { pid: string; n: number; at: number }

/** What this process saw of another's key on its latest read. */
export type Seen = {
  pid: string
  /** The latest `n` read from that process's own key. */
  n: number
  /** Milliseconds between that write (its `at`) and this read: the visibility lag plus up to one write interval. */
  age: number
  /** Writes of that process this one never read: `n` jumped by more than the reads between. */
  skipped: number
}

/** Everything the pane draws. */
export type Probe = {
  me: string
  writes: number
  failures: number
  lastFailure: string
  /** The slowest `$.store.set` so far, in milliseconds: the lock's wait shows here. */
  slowestSet: number
  /** The slowest `$.store.get`. */
  slowestGet: number
  /** The `shared` key as last read: a key every process writes, so the last writer wins visibly. */
  shared: Beat | null
  /** How often the `shared` key read back as another process's right after this one wrote it. */
  overwritten: number
  /** How often the `shared` key read back as this process's own write. */
  kept: number
  seen: Seen[]
}

declare module 'claude-code' {
  interface PluginState {
    'store-probe': { probe: Probe }
  }
}
