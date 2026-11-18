// A press on a row's move, carried out: the mod's `moves.ts` without the engine. What a press records and every step after
// it are the core's (`decidePress`, `firstStep`, `nextStep`, `afterSend`); this file sends what they decide and looks at
// GitLab until the move is done. The presses live in this server's memory, one per MR, as the mod keeps them in its ledger.
import { messageOf } from '../../hooks/failure.ts'
import { Failure } from '../../hooks/failure.ts'
import { mergeRefusal, mergeWrite, moveStateQuery, readMoveState, rebasePath, rebaseRefusal } from '../../hooks/merge-gitlab.ts'
import { afterSend, ARMED_MS, decidePress, firstStep, FOLLOW_MS, nextStep } from '../../hooks/next-move.ts'
import type { Fresh, Step } from '../../hooks/next-move.ts'
import { refusalOf, why } from '../../hooks/write-model.ts'

import type { MoveKind, MrCard, Pressed } from '../../types/index.d.ts'
import type { GitLab } from './read.ts'

/** How a press ended: armed (press again), or the move's last word, done or not. */
export type Outcome = { state: 'armed' } | { state: 'busy' } | { state: 'ended'; say: string; isDone: boolean }

type Course = { kind: 'merge' | 'rebase' | 'rebase-merge'; before: Fresh; tries: number }

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function freshOf(gitlab: GitLab, card: MrCard): Promise<Fresh> {
  const fresh = readMoveState(await gitlab.graphql(moveStateQuery(card.path, card.iid)))
  if (fresh === null) {
    throw new Failure('bad-answer', 'GitLab no longer shows it')
  }
  return fresh
}

async function send(gitlab: GitLab, card: MrCard, step: Extract<Step, { does: 'merge' | 'rebase' }>) {
  try {
    return step.does === 'merge'
      ? mergeRefusal(await gitlab.graphql(mergeWrite(card.path, card.iid, step.head, step.strategy, step.squash)))
      : rebaseRefusal(await gitlab.put(rebasePath(card.path, card.iid)))
  } catch (error) {
    return refusalOf(error)
  }
}

/** Takes the course's steps until the core says stop, looking at GitLab every FOLLOW_MS while it is at work. */
async function carry(gitlab: GitLab, card: MrCard, course: Course, first: Step, wait: (ms: number) => Promise<unknown>): Promise<Outcome> {
  let step = first
  let { kind, tries } = course
  for (;;) {
    switch (step.does) {
      case 'stop':
        return { state: 'ended', say: step.say, isDone: step.isDone }
      case 'wait':
        await wait(FOLLOW_MS)
        tries += 1
        try {
          step = nextStep(kind, course.before, await freshOf(gitlab, card), tries)
        } catch (error) {
          return { state: 'ended', say: `lost track of it: ${why(messageOf(error))}`, isDone: false }
        }
        break
      case 'rebase':
        step = afterSend(step, await send(gitlab, card, step))
        break
      case 'merge':
      default:
        // A merge after a rebase is the merge from here on, on the head the rebase made.
        kind = 'merge'
        step = afterSend(step, await send(gitlab, card, step))
        break
    }
  }
}

/**
 * A press on `card`'s move. `held` is the press kept for each MR, which this updates: a first press on a merge arms it,
 * a second within ARMED_MS on the same head makes it, and a move that did not take is kept, failed, with why.
 */
export async function pressMove(
  gitlab: GitLab,
  card: MrCard,
  press: { kind: MoveKind; does: 'arm' | 'make' },
  held: Map<string, Pressed>,
  now = Date.now(),
  wait: (ms: number) => Promise<unknown> = sleep
): Promise<Outcome> {
  const head = card.merging?.head ?? ''
  const pressed = decidePress(press, held.get(card.key), head, now)
  if (pressed === null || pressed.kind === 'conflicts') {
    return { state: 'busy' }
  }
  held.set(card.key, pressed)
  if (pressed.state === 'armed') {
    return { state: 'armed' }
  }
  const kind = pressed.kind
  let outcome: Outcome
  try {
    const before = await freshOf(gitlab, card)
    outcome = await carry(gitlab, card, { kind, before, tries: 0 }, firstStep(kind, head, before), wait)
  } catch (error) {
    outcome = { state: 'ended', say: why(messageOf(error)), isDone: false }
  }
  if (outcome.state === 'ended' && !outcome.isDone) {
    held.set(card.key, { kind, state: 'failed', on: head, at: Date.now(), say: outcome.say })
  } else {
    held.delete(card.key)
  }
  return outcome
}

/** The presses with any arm past ARMED_MS forgotten, as the mod's timer forgets them, so a row offers its move afresh. */
export function liveHeld(held: Map<string, Pressed>, now = Date.now()): Map<string, Pressed> {
  for (const [key, pressed] of held) {
    if (pressed.state === 'armed' && now - pressed.at >= ARMED_MS) {
      held.delete(key)
    }
  }
  return held
}
