// The one module that keeps state in its own variables, and the lint rule `local/no-module-state` names it. What waits
// across calls here is not a value an atom can hold: a promise or a callback cannot be saved or sent, and the render hook
// that must announce a drawing may not write an atom (the engine denies a write while drawing). A reload empties it, which
// is right, as nothing started before the reload can finish after it.

const running = new Map<string, Promise<void>>()
const queued = new Map<string, Promise<void>>()

/** Runs `work` once at a time under `name`. A caller arriving mid-run gets one more run, started after this one ends. */
export function serialised(name: string, work: () => Promise<void>): Promise<void> {
  const current = running.get(name)
  if (current === undefined) {
    const started = work().finally(() => {
      running.delete(name)
    })
    running.set(name, started)
    return started
  }
  const waiting = queued.get(name)
  if (waiting !== undefined) {
    return waiting
  }
  const next = current.then(() => {
    queued.delete(name)
    return serialised(name, work)
  })
  queued.set(name, next)
  return next
}

/** Runs `work` unless `name` is already running, and then joins that run, so a call mid-run waits for the run in hand. */
export function joined(name: string, work: () => Promise<void>): Promise<void> {
  const current = running.get(name)
  if (current !== undefined) {
    return current
  }
  const started = work().finally(() => {
    running.delete(name)
  })
  running.set(name, started)
  return started
}

const waitingForDraw: (() => void)[] = []
let drawnAtRow = 0

/** The pane was just drawn, its window at `row`: the render hook calls this, and whoever waited for a drawing goes on. */
export function drawn(row: number): void {
  drawnAtRow = row
  waitingForDraw.splice(0).forEach(resolve => resolve())
}

/** Resolves at the next drawing of the pane. */
export const nextDraw = (): Promise<void> => new Promise(resolve => waitingForDraw.push(resolve))

/** Where the window sat at the last drawing. */
export const rowDrawn = (): number => drawnAtRow
