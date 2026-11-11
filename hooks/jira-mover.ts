import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { knowTickets, readBrowse } from './data'
import { isEqual } from './equal'
import { Failure } from './failure'
import { clear, record } from './failures'
import { joined } from './in-flight'
import { readTickets, readTransition, searchArgs, transitionArgs } from './jira'
import {
  MOVE_PREFIX,
  NO_TARGETS,
  STEPS,
  afterSearch,
  endOf,
  endPass,
  failedAsks,
  isMovingTickets,
  isStillOpen,
  liveTargets,
  moveTargets,
  noStep,
  plan,
  readMemory,
  startKey,
  storeKey,
} from './jira-moves'
import type { Ending, Kept, MoveMemory, MoveStep, TicketMove } from './jira-moves'
import { runJson } from './tools'

import type { MoveTargets, MrCard, OwnMrs } from '../types'

// Moves the user's tickets in Jira as their MRs go into review and merge, with acli, signed in as them. Only the leader
// moves, after its read. This file reads the store, runs acli and does what jira-moves.ts decides; it decides nothing.

const targetsAtom = atom({ plugin: 'gitlab-pane', key: 'moveTargets' } as const, NO_TARGETS satisfies MoveTargets)
const ownAtom = atom({ plugin: 'gitlab-pane', key: 'ownMrs' } as const, {})

const TIMEOUT_MS = 60_000

/**
 * A mod loading takes the `jiraInReview` and `jiraOnMerge` settings, and forgets who the user is on each host, which the
 * inbox reads again: a host the settings no longer name then has no merged MRs to move tickets for.
 */
export async function setMoveTargets($: EngineInterface, inReview: unknown, onMerge: unknown): Promise<void> {
  await update($, targetsAtom, () => moveTargets(inReview, onMerge))
  await update($, ownAtom, () => ({}))
}

/** What the inbox's read of the user's own MRs on a host said: who they are there, and which merged lately. */
export async function noteOwn($: EngineInterface, host: string, own: OwnMrs): Promise<void> {
  if (!isEqual((await read($, ownAtom))[host], own)) {
    await update($, ownAtom, all => ({ ...all, [host]: own }))
  }
}

/** Keeps each step's end in its own store entry. */
async function keep($: EngineInterface, all: readonly Kept[]): Promise<void> {
  await Promise.all(all.map(one => $.store.set(one.key, one.record)))
}

/** Keeps each ending and says its toast. */
async function end($: EngineInterface, endings: readonly Ending[]): Promise<void> {
  await keep($, endings)
  for (const { toast } of endings) {
    if (toast !== null) {
      $.ui.toast(toast)
    }
  }
}

/** The steps on since an earlier pass, by their start entries. */
async function startedSteps($: EngineInterface): Promise<MoveStep[]> {
  const found = await Promise.all(STEPS.map(async step => ((await $.store.get(startKey(step))) !== undefined ? [step] : [])))
  return found.flat()
}

/** Every step's record in the store. */
async function readKept($: EngineInterface): Promise<MoveMemory> {
  const keys = (await $.store.keys()).filter(key => key.startsWith(MOVE_PREFIX))
  return readMemory(await Promise.all(keys.map(async key => [key, await $.store.get(key)] as const)))
}

/** Tries a move's statuses in turn with acli, until one ends it. */
async function transition($: EngineInterface, move: TicketMove, now: number): Promise<Ending> {
  for (const name of move.names) {
    const said = await runJson($, 'acli', transitionArgs(move.ticket, name), raw => readTransition(raw, move.ticket), { timeoutMs: TIMEOUT_MS })
    if (!said.ok) {
      await record($, 'jira-moves', new Failure(said.kind, `${move.ticket}: ${said.reason}`))
    }
    const ended = endOf(move, name, said.ok ? said.value : { kind: 'failed', reason: said.reason }, now)
    if (ended !== null) {
      return ended
    }
  }
  return noStep(move, now)
}

/**
 * The leader's pass after a read, over the open MRs (`rows`): takes each step `plan` gives, once, asking Jira where the
 * tickets are just before, so a ticket a person moved meanwhile is seen as it is.
 */
export function moveTickets($: EngineInterface, rows: readonly MrCard[]): Promise<void> {
  return joined('jira-moves', async () => {
    const [browse, set, own, started, now] = await Promise.all([readBrowse($), read($, targetsAtom), read($, ownAtom), startedSteps($), $.clock.now()])
    const targets = liveTargets(browse, set)
    const memory = isMovingTickets(targets) ? await readKept($) : null
    const steps = plan({ rows, own, targets, memory, started, now })
    await Promise.all(steps.drop.map(step => $.store.delete(startKey(step))))
    if (steps.wait !== null) {
      await record($, 'jira-moves', new Failure('failed', steps.wait))
    }
    await Promise.all(steps.forget.map(key => $.store.delete(key)))
    await keep($, steps.found)
    await Promise.all(steps.start.map(step => $.store.set(startKey(step), now)))
    if (steps.isClear) {
      await clear($, 'jira-moves')
    }
    if (memory === null || steps.take.length === 0) {
      return
    }
    const searched = await runJson($, 'acli', searchArgs([...new Set(steps.take.map(one => one.ticket))]), readTickets, { timeoutMs: TIMEOUT_MS })
    if (!searched.ok) {
      await record($, 'jira-moves', new Failure(searched.kind, searched.reason))
      await keep($, failedAsks(steps.take, now))
      return
    }
    const { moves, endings, problem } = afterSearch(steps.take, searched.value, targets, memory, now)
    if (problem !== null) {
      await record($, 'jira-moves', new Failure('bad-answer', problem))
    }
    await end($, endings)
    const moved: Ending[] = []
    for (const move of moves) {
      // Another session may have taken the step since this pass read the store.
      if (isStillOpen(await $.store.get(storeKey(move)), now)) {
        const ended = await transition($, move, now)
        await end($, [ended])
        moved.push(ended)
      }
    }
    const after = endPass(searched.value, moves, [...endings, ...moved], memory)
    // What Jira says of these tickets now, for their MRs' pages here; the other tickets are read at their own pace.
    await knowTickets($, after.tickets)
    if (after.isClear) {
      await clear($, 'jira-moves')
    }
  })
}
