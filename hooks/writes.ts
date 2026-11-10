import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { liveOf } from './write-model'

import type { Write } from '../types'

// The ledger of what this session sets out to write to GitLab, by id (`move:<card key>`, `reply:<thread>`): one entry per
// write, armed, sent, handed on or failed (write-model.ts says what each means). It is this session's own, an atom and
// not the store. The engine reads an atom only in the file that declares it, so every feature that writes goes through
// the functions below, and none keeps a record of its own. Each change that depends on the entry held is decided inside
// the one update that makes it, so nothing can come between reading an entry and changing it.
const writesAtom = atom({ plugin: 'gitlab-pane', key: 'writes' } as const, {})

/**
 * The entries the pane draws, each as it holds now (`liveOf`): a write sent by a session closed mid-way says its answer
 * was lost. Reading them here makes the pane redraw when one changes.
 */
export async function drawnWrites($: EngineInterface): Promise<Record<string, Write>> {
  const [all, now] = await Promise.all([read($, writesAtom), $.clock.now()])
  return Object.fromEntries(Object.entries(all).map(([id, write]) => [id, liveOf(write, now) ?? write] as const))
}

/** Records `write` as `id`'s entry, or forgets it (null); entries `isKept` turns down go too. For the write's own sender. */
export async function setWrite($: EngineInterface, id: string, write: Write | null, isKept: (other: string) => boolean = () => true): Promise<void> {
  await update($, writesAtom, all => {
    const kept = Object.entries(all).filter(([each]) => each !== id && isKept(each))
    return Object.fromEntries(write !== null ? [...kept, [id, write]] : kept)
  })
}

/**
 * Decides `id`'s entry against the one held and records it, in one update, so two presses at once make one write. Gives
 * the entry recorded, or null when `decide` made none. `decide` is the feature's own, on plain data, and sees the entry
 * as stored: it says how it holds now (`liveOf`). Confirming is the feature's choice: a merge or a reply arms first and
 * goes `sent` only on an armed entry; a rebase or a hand-off goes `sent` (`handed`) on the first press.
 */
export async function claimWrite<Made extends Write>($: EngineInterface, id: string, decide: (held: Write | undefined) => Made | null): Promise<Made | null> {
  const made: Made[] = []
  await update($, writesAtom, all => {
    const next = decide(all[id])
    made.splice(0, made.length, ...(next !== null ? [next] : []))
    return next !== null ? { ...all, [id]: next } : all
  })
  return made[0] ?? null
}

/**
 * Forgets `id`'s entry if `mayGo` allows it against the entry held, in one update, so a write sent meanwhile is never
 * forgotten. Gives whether it was allowed, and the entry it held.
 */
export async function forgetWrite($: EngineInterface, id: string, mayGo: (held: Write | undefined) => boolean): Promise<{ isGone: boolean; held: Write | undefined }> {
  const seen: { isGone: boolean; held: Write | undefined }[] = []
  await update($, writesAtom, all => {
    const held = all[id]
    const isGone = mayGo(held)
    seen.splice(0, seen.length, { isGone, held })
    return isGone ? Object.fromEntries(Object.entries(all).filter(([each]) => each !== id)) : all
  })
  return seen[0] ?? { isGone: false, held: undefined }
}
