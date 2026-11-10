// The one module that keeps state in its own variables, and the lint rule `local/no-module-state` names it. What waits
// across calls here is not a value an atom can hold: a promise or a callback cannot be saved or sent, and the render hook
// that must announce a drawing may not write an atom (the engine denies a write while drawing). A reload empties it, which
// is right, as nothing started before the reload can finish after it.

import type { HostFeatures } from '../types'

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
  // Whether the run in hand ended well or not, the next one goes ahead and the queue clears.
  const go = () => {
    queued.delete(name)
    return serialised(name, work)
  }
  const next = current.then(go, go)
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

// What each GitLab host was found to lack, learned when it answered a document's field as undefined; whole until then.
const lacking = new Map<string, HostFeatures>()

/** What a host has of the fields older GitLab versions lack: all of them until it has said it lacks one. */
export const featuresOf = (host: string): HostFeatures => lacking.get(host) ?? { hasMergeVerdict: true, hasReviewStates: true, hasTodoEntity: true }

/** Remembers, until the mod reloads, that `host` lacks `feature`; gives what the host has now. */
export function learnLack(host: string, feature: keyof HostFeatures): HostFeatures {
  const next = { ...featuresOf(host), [feature]: false }
  lacking.set(host, next)
  return next
}

// Tokens, which are secrets: they live here, in memory, as resolved promises, and in no atom or store a session saves.
const tokens = new Map<string, Promise<string | null>>()

/** What `find` gave for `name`, asked once and then remembered, a miss included, until `forgetFound` clears it. */
export function remembered(name: string, find: () => Promise<string | null>): Promise<string | null> {
  const known = tokens.get(name)
  if (known !== undefined) {
    return known
  }
  const asked = find()
  tokens.set(name, asked)
  return asked
}

/** Forgets everything remembered but the tokens given in settings, so the next read asks again. */
export function forgetFound(): void {
  for (const name of tokens.keys()) {
    if (!name.startsWith('setting:')) {
      tokens.delete(name)
    }
  }
}

const waitingForDraw: (() => void)[] = []
let drawnAtRow = 0

/** The pane was just drawn, its window at `row`: the render hook calls this, and whoever waited for a drawing goes on. */
export function drawn(row: number): void {
  drawnAtRow = row
  waitingForDraw.splice(0).forEach(resolve => resolve())
}

/** Resolves at the next drawing of the pane. */
export const nextDraw = (): Promise<void> =>
  new Promise(resolve => {
    waitingForDraw.push(resolve)
  })

/** Where the window sat at the last drawing. */
export const rowDrawn = (): number => drawnAtRow

/** A session starting finds out again what each host lacks, and finds each token again where a session before it left one. */
export function forgetProbed(): void {
  lacking.clear()
  forgetFound()
}
