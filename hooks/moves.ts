import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { parseJson, isRecord } from './decode'
import { pinMr, readPinned, readRows } from './data'
import { Failure } from './failure'
import { quietly } from './failures'
import { mergeWrite, moveStateQuery } from './merge-documents'
import { mergeRefusal, readMoveState } from './gitlab'
import { ask, write } from './graphql'
import { projectOf, redact } from './hosts'
import { parseRemote } from './inbox-refs'
import { lines } from './model-text'
import { afterMerge, ARMED_MS, conflictsTask, firstStep, FOLLOW_MS, isConfirmed, nextStep } from './next-move'
import type { Fresh, Step } from './next-move'
import { askForRefresh, publishPins } from './shared'
import { tokenFor } from './tokens'

import type { MergeStrategyEnum } from './gitlab.generated'
import type { MoveKind, MrCard, Pressed } from '../types'

// The MR moves a press makes: merge, rebase, or hand the conflicts to Claude. Which move a card offers is next-move.ts's to
// say; this file makes it and sees it through. What was pressed is this session's own (an atom, not the store), kept by
// card key until the MR's head moves. The engine reads an atom only in the file that declares it.
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

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The MR as GitLab says it now. */
async function freshOf($: EngineInterface, card: MrCard): Promise<Fresh> {
  const fresh = readMoveState(await ask($, card.host, moveStateQuery(card.path, card.iid)))
  if (fresh === null) {
    throw new Failure('bad-answer', 'GitLab no longer shows it')
  }
  return fresh
}

/** Asks GitLab to rebase the MR (`PUT …/merge_requests/:iid/rebase`: GraphQL has no such write); why it would not, or null. */
async function sendRebase($: EngineInterface, card: MrCard): Promise<string | null> {
  const found = await tokenFor($, card.host)
  if (!found.ok) {
    return found.reason
  }
  const { token, source } = found.value
  try {
    const answer = await $.http.fetch(`https://${card.host}/api/v4/projects/${encodeURIComponent(card.path)}/merge_requests/${card.iid}/rebase`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (answer.status >= 200 && answer.status < 300) {
      return null
    }
    if (answer.status === 403) {
      return `GitLab refused it (HTTP 403): the token from ${source} needs the api scope, and you need to be able to push to the branch`
    }
    let said: unknown = null
    try {
      said = parseJson(answer.text)
    } catch {
      said = null
    }
    return `GitLab answered HTTP ${answer.status}${isRecord(said) && typeof said.message === 'string' ? `: ${said.message}` : ''}`
  } catch (error) {
    return redact(messageOf(error), [token])
  }
}

/** Asks GitLab to merge the MR at `head`; why it would not, or null. */
async function sendMerge($: EngineInterface, card: MrCard, head: string, strategy: MergeStrategyEnum | null): Promise<string | null> {
  return mergeRefusal(await write($, card.host, mergeWrite(card.path, card.iid, head, strategy)))
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
    case 'rebase': {
      const refused = await sendRebase($, course.card)
      return refused !== null ? end($, course, { does: 'stop', say: `not rebased: ${refused}`, isDone: false }) : carry($, course, { does: 'wait' })
    }
    case 'merge':
    default: {
      // A merge after a rebase is on the new head: the row's press, kept on the old one, would no longer hold.
      const merging: Course = { ...course, kind: 'merge', head: step.head }
      await mark($, course.card.key, { kind: 'merge', state: 'sent', head: step.head, at: await $.clock.now() })
      const refused = await sendMerge($, course.card, step.head, step.strategy)
      if (refused !== null) {
        return end($, merging, { does: 'stop', say: `not merged: ${refused}`, isDone: false })
      }
      return carry($, merging, afterMerge(step.strategy) ?? { does: 'wait' })
    }
  }
}

async function look($: EngineInterface, course: Course): Promise<void> {
  try {
    const now = await freshOf($, course.card)
    await carry($, { ...course, head: now.head }, nextStep(course.kind, course.before, now, course.tries))
  } catch (error) {
    await end($, course, { does: 'stop', say: `lost track of it: ${messageOf(error)}`, isDone: false })
  }
}

/** Pins the MR in this session, which then owns it, and hands Claude its conflicts as a prompt that waits for a turn of its own. */
async function handConflicts($: EngineInterface, card: MrCard, head: string): Promise<void> {
  await pinMr($, { url: card.url, host: card.host, path: card.path, iid: card.iid }, 'watched')
  await publishPins($, await readPinned($))
  const at = await $.clock.now()
  await mark($, card.key, { kind: 'conflicts', state: 'handed', head, at })
  try {
    await $.prompt.submit({ text: lines(conflictsTask(card)) })
  } catch (error) {
    await mark($, card.key, { kind: 'conflicts', state: 'failed', head, at, say: `Claude was not reached: ${messageOf(error)}` })
  }
}

async function press($: EngineInterface, key: string, kind: MoveKind, does: 'arm' | 'make'): Promise<void> {
  const card = (await readRows($)).find(row => row.key === key)
  if (card === undefined || card.merging === null) {
    return
  }
  const { head } = card.merging
  const at = await $.clock.now()
  if (does === 'arm' || !isConfirmed(kind, (await read($, pressedAtom))[key], head)) {
    await mark($, key, { kind, state: 'armed', head, at })
    $.clock.after(ARMED_MS, () => quietly($, disarm($, key, at)))
    return
  }
  if (kind === 'conflicts') {
    await handConflicts($, card, head)
    return
  }
  await mark($, key, { kind, state: 'sent', head, at })
  try {
    const before = await freshOf($, card)
    await carry($, { card, kind, before, head, tries: 0 }, firstStep(kind, head, before))
  } catch (error) {
    await mark($, key, { kind, state: 'failed', head, at, say: messageOf(error) })
    $.ui.toast(`!${card.iid}: ${messageOf(error)}`)
  }
}

/** The press on a row's move: `arm` asks for a second press before a merge, `make` makes the move. */
export function pressMove($: EngineInterface, key: string, move: { kind: MoveKind; does: 'arm' | 'make' }): void {
  quietly($, press($, key, move.kind, move.does))
}
