import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { liveOf } from './write-model'

import type { Write } from '../types'

// The ledger of what this session sets out to write to GitLab, by id (`move:<card key>`, `reply:<thread>`): one entry per
// write, armed, sent, handed on or failed (write-model.ts says what each means). It is this session's own, an atom and
// not the store. The engine reads an atom only in the file that declares it, so every feature that writes goes through
// the functions below, and none keeps a record of its own.
const writesAtom = atom({ plugin: 'gitlab-pane', key: 'writes' } as const, {})

/** What the pane draws from; reading it here makes the pane redraw when an entry changes. */
export function drawnWrites($: EngineInterface): Promise<Record<string, Write>> {
  return read($, writesAtom)
}

/** The entry `id` as it holds now (`liveOf`), or none. */
export async function heldWrite($: EngineInterface, id: string): Promise<Write | undefined> {
  const [all, now] = await Promise.all([read($, writesAtom), $.clock.now()])
  return liveOf(all[id], now)
}

/** Records `write` as `id`'s entry, or forgets it (null); entries `isKept` turns down go too. */
export async function setWrite($: EngineInterface, id: string, write: Write | null, isKept: (other: string) => boolean = () => true): Promise<void> {
  await update($, writesAtom, all => {
    const kept = Object.entries(all).filter(([each]) => each !== id && isKept(each))
    return Object.fromEntries(write !== null ? [...kept, [id, write]] : kept)
  })
}

/**
 * Decides `id`'s entry against the one held and records it, in one write, so two presses at once make one write. Gives
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

/** Takes an armed entry back once its time is up, unless it was armed again meanwhile. */
export async function disarmWrite($: EngineInterface, id: string, at: number): Promise<void> {
  const held = (await read($, writesAtom))[id]
  if (held?.state === 'armed' && held.at === at) {
    await setWrite($, id, null)
  }
}
