import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { pinMr, readPinned, readRows } from './data'
import { Failure, messageOf } from './failure'
import { quietly } from './failures'
import { ask, askRest } from './graphql'
import { projectOf } from './hosts'
import { parseRemote } from './inbox-refs'
import { mergeRefusal, mergeWrite, moveStateQuery, readMoveState, rebasePath, rebaseRefusal } from './merge-gitlab'
import { lines } from './model-text'
import { afterSend, ARMED_MS, conflictsTask, decidePress, firstStep, FOLLOW_MS, nextStep, refusalOf, why } from './next-move'
import type { Fresh, Refusal, Step } from './next-move'
import { askForRefresh, publishPins } from './shared'

import type { MoveKind, MrCard, Pressed } from '../types'

// The MR moves a press makes: merge, rebase, or hand the conflicts to Claude. What a card offers, what a press records and
// each step after it are next-move.ts's to decide; this file sends what it decides to GitLab or to Claude, keeps this
// session's presses (an atom, not the store) and looks at GitLab until the move is done. The engine reads an atom only in
// the file that declares it.
const pressedAtom = atom({ plugin: 'gitlab-pane', key: 'pressed' } as const, {})

/** What the pane draws from; reading it here makes the pane redraw when a press changes. */
export function drawnPressed($: EngineInterface): Promise<Record<string, Pressed>> {
  return read($, pressedAtom)
}

/** The project this session works in, `host/group/project`, from its remote; Claude can take that project's conflicts. */
export async function hereProject($: EngineInterface): Promise<string | null> {
  const remote = parseRemote((await $.session.repo().catch(() => null))?.remote ?? '')
  return remote !== null ? projectOf(remote.host, remote.path) : null
}

/** Records a press on `key`, or forgets it (null), and forgets the presses on MRs no longer listed. */
async function mark($: EngineInterface, key: string, pressed: Pressed | null): Promise<void> {
  const listed = new Set((await readRows($)).map(row => row.key))
  await update($, pressedAtom, all => {
    const kept = Object.entries(all).filter(([each]) => each !== key && listed.has(each))
    return Object.fromEntries(pressed !== null ? [...kept, [key, pressed]] : kept)
  })
}

/** Takes an armed press back once its time is up, unless it was pressed again meanwhile. */
async function disarm($: EngineInterface, key: string, at: number): Promise<void> {
  const held = (await read($, pressedAtom))[key]
  if (held?.state === 'armed' && held.at === at) {
    await mark($, key, null)
  }
}

/** The MR as GitLab says it now. */
async function freshOf($: EngineInterface, card: MrCard): Promise<Fresh> {
  const fresh = readMoveState(await ask($, card.host, moveStateQuery(card.path, card.iid)))
  if (fresh === null) {
    throw new Failure('bad-answer', 'GitLab no longer shows it')
  }
  return fresh
}

/** Sends a merge or a rebase to GitLab, once (GraphQL has no rebase, so it goes over REST); why it did not take, or null. */
async function send($: EngineInterface, card: MrCard, step: Extract<Step, { does: 'merge' | 'rebase' }>): Promise<Refusal | null> {
  try {
    if (step.does === 'merge') {
      return mergeRefusal(await ask($, card.host, mergeWrite(card.path, card.iid, step.head, step.strategy)))
    }
    return rebaseRefusal(
      await askRest($, card.host, rebasePath(card.path, card.iid), {
        method: 'PUT',
        headers: { Accept: 'application/json' },
        needs: 'the api scope, and you push access to the branch',
      })
    )
  } catch (error) {
    return refusalOf(error)
  }
}

/** A move under way: the MR as it was when pressed, what was pressed, the head it is on now and how often it was looked at. */
type Course = { card: MrCard; kind: 'merge' | 'rebase' | 'rebase-merge'; before: Fresh; head: string; tries: number }

/** How a move ended: in a toast (the pane may be hidden) and, when it did not take, beside the move on its row. */
async function end($: EngineInterface, course: Course, step: Extract<Step, { does: 'stop' }>): Promise<void> {
  $.ui.toast(`!${course.card.iid} ${step.say}`)
  const at = await $.clock.now()
  await mark($, course.card.key, step.isDone ? null : { kind: course.kind, state: 'failed', head: course.head, at, say: step.say })
  await askForRefresh($)
}

/** Takes one step of a move, and schedules the next look while GitLab is still at it. Each look is a dispatch of its own. */
async function carry($: EngineInterface, course: Course, step: Step): Promise<void> {
  switch (step.does) {
    case 'stop':
      return end($, course, step)
    case 'wait':
      $.clock.after(FOLLOW_MS, () => quietly($, look($, { ...course, tries: course.tries + 1 })))
      return undefined
    case 'rebase':
      return carry($, course, afterSend(step, await send($, course.card, step)))
    case 'merge':
    default: {
      // A merge after a rebase is on the new head: the row's press, kept on the old one, would no longer hold.
      const merging: Course = { ...course, kind: 'merge', head: step.head }
      await mark($, course.card.key, { kind: 'merge', state: 'sent', head: step.head, at: await $.clock.now() })
      return carry($, merging, afterSend(step, await send($, course.card, step)))
    }
  }
}

async function look($: EngineInterface, course: Course): Promise<void> {
  try {
    const now = await freshOf($, course.card)
    await carry($, { ...course, head: now.head }, nextStep(course.kind, course.before, now, course.tries))
  } catch (error) {
    await end($, course, { does: 'stop', say: `lost track of it: ${why(messageOf(error))}`, isDone: false })
  }
}

/** Pins the MR in this session, which then owns it, and hands Claude its conflicts as a prompt that waits for a turn of its own. */
async function handConflicts($: EngineInterface, card: MrCard, handed: Pressed): Promise<void> {
  await pinMr($, { url: card.url, host: card.host, path: card.path, iid: card.iid }, 'watched')
  await publishPins($, await readPinned($))
  // A prompt a hook or the engine drops resolves with why, and never reaches Claude.
  const dropped = await $.prompt.submit({ text: lines(conflictsTask(card)) }).then(
    sent => sent.drop ?? null,
    (error: unknown) => messageOf(error)
  )
  if (dropped !== null) {
    await mark($, card.key, { ...handed, state: 'failed', say: `Claude was not reached: ${why(dropped)}` })
  }
}

/** Decides the press on `key` against the one held and records it, in one write, so two presses at once make one move. */
async function claim($: EngineInterface, key: string, decide: (held: Pressed | undefined) => Pressed | null): Promise<Pressed | null> {
  const made: Pressed[] = []
  await update($, pressedAtom, all => {
    const next = decide(all[key])
    made.splice(0, made.length, ...(next !== null ? [next] : []))
    return next !== null ? { ...all, [key]: next } : all
  })
  return made[0] ?? null
}

async function press($: EngineInterface, key: string, move: { kind: MoveKind; does: 'arm' | 'make' }): Promise<void> {
  const card = (await readRows($)).find(row => row.key === key)
  if (card === undefined || card.merging === null) {
    return
  }
  const { head } = card.merging
  const at = await $.clock.now()
  const pressed = await claim($, key, held => decidePress(move, held, head, at))
  if (pressed === null) {
    return
  }
  if (pressed.state === 'armed') {
    $.clock.after(ARMED_MS, () => quietly($, disarm($, key, at)))
    return
  }
  if (pressed.state === 'handed') {
    await handConflicts($, card, pressed)
    return
  }
  if (pressed.kind === 'conflicts') {
    return
  }
  try {
    const before = await freshOf($, card)
    await carry($, { card, kind: pressed.kind, before, head, tries: 0 }, firstStep(pressed.kind, head, before))
  } catch (error) {
    const say = why(messageOf(error))
    await mark($, key, { kind: pressed.kind, state: 'failed', head, at, say })
    $.ui.toast(`!${card.iid}: ${say}`)
  }
}

/** The press on a row's move: `arm` asks for a second press before a merge, `make` makes the move. */
export function pressMove($: EngineInterface, key: string, move: { kind: MoveKind; does: 'arm' | 'make' }): void {
  quietly($, press($, key, move))
}
