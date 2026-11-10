// The one move the pane can make for an MR, or none: merge it, rebase it, or hand its conflicts to Claude. Each is offered
// only where GitLab's checks name it and the signed-in user may make it, so a card has a move only when that move is what
// moves the MR along; waiting on people, on a pipeline or on a fix stays as quiet as it was. Pure, on plain data.
import { checkWords, verdictOf } from './attention.ts'
import type { MergeStrategyEnum } from './gitlab.generated.ts'
import { foreign, line, URL_ROOM, type ModelLine } from './model-text.ts'

import type { MoveKind, MrCard, Pressed } from '../types'

/** How long a merge stays armed after its first press; a second press within it merges, and past it the press is forgotten. */
export const ARMED_MS = 10_000

/**
 * A move as a row says it. `check` is the GitLab check it speaks for, which the row then does not say again; null for a
 * merge, which speaks for GitLab's verdict that the MR can merge. `press` is what pressing it does: `arm` asks for a
 * second press before anything that merges, `make` makes the move; none while a move is under way.
 */
export type Move = { label: string; check: string | null; press: { kind: MoveKind; does: 'arm' | 'make' } | null; isArmed: boolean; failed: string | null }

/** What each move says while it can be pressed, in DESIGN.md's order. */
export const MOVE_LABEL: Record<MoveKind, string> = {
  merge: '⤵ merge',
  rebase: '↻ rebase',
  'rebase-merge': '↻ rebase and merge',
  conflicts: '⇄ hand conflicts to Claude',
}

/** The checks a move speaks for: a merge for GitLab's verdict that the MR can merge, the others for the check they fix. */
const CHECK: Record<MoveKind, string | null> = { merge: null, rebase: 'NEED_REBASE', 'rebase-merge': 'NEED_REBASE', conflicts: 'CONFLICT' }

/** What a move says while it is under way. */
const UNDER_WAY: Record<MoveKind, string> = {
  merge: '⤵ merging…',
  rebase: '↻ rebasing…',
  'rebase-merge': '↻ rebasing…',
  conflicts: '⇄ conflicts · with Claude',
}

const said = (label: string, check: string | null): Move => ({ label, check, press: null, isArmed: false, failed: null })

/** Moves that merge ask for a second press; a rebase or a hand-off to Claude can be undone, or does nothing until Claude pushes. */
const ARMS: ReadonlySet<MoveKind> = new Set(['merge', 'rebase-merge'])

/**
 * Whether a press may make its move: one that merges only while this session's arm for that move, on that head, still
 * holds, so a drawing from before the arm ran out, or before a push, merges nothing.
 */
export const isConfirmed = (kind: MoveKind, held: Pressed | undefined, head: string): boolean =>
  !ARMS.has(kind) || (held?.state === 'armed' && held.kind === kind && held.head === head)

/**
 * The move GitLab's checks name: conflicts before a rebase, which they would stop, and a rebase before a merge, which it
 * blocks. A rebase with nothing else failing also merges once the checks pass. Conflicts go to Claude only from a session
 * in the MR's repo, where Claude can work on the branch.
 */
function offered(card: MrCard, isHere: boolean): MoveKind | null {
  const { merging, mergeStatus } = card
  if (merging === null || mergeStatus === null || merging.head === '') {
    return null
  }
  const failing = mergeStatus.filter(check => check.status === 'failed').map(check => check.id)
  if (failing.includes('CONFLICT')) {
    return merging.canPush && isHere ? 'conflicts' : null
  }
  if (failing.includes('NEED_REBASE')) {
    return !merging.canPush ? null : failing.length === 1 && merging.canMerge ? 'rebase-merge' : 'rebase'
  }
  return verdictOf(card)?.check === null && merging.canMerge ? 'merge' : null
}

/**
 * The MR's one move, or none. GitLab's own work under way comes first (a rebase, or a merge once checks pass), then
 * this session's press on the MR's current head: armed, sent or handed to Claude. A press on an older head no longer
 * holds, so a push offers the move afresh.
 */
export function nextMove(card: MrCard, pressed: Pressed | undefined, isHere: boolean): Move | null {
  const { merging } = card
  if (merging?.isAutoMerging === true) {
    return said('⤵ merges when checks pass', verdictOf(card)?.check ?? null)
  }
  if (merging?.isRebasing === true) {
    return said(UNDER_WAY.rebase, CHECK.rebase)
  }
  const press = pressed !== undefined && pressed.head === merging?.head ? pressed : undefined
  if (press?.state === 'sent') {
    return said(UNDER_WAY[press.kind], CHECK[press.kind])
  }
  const kind = offered(card, isHere)
  if (kind === null) {
    return null
  }
  if (press?.state === 'handed' && press.kind === kind) {
    return said(UNDER_WAY[kind], CHECK[kind])
  }
  const isArmed = press?.state === 'armed' && press.kind === kind
  return {
    label: isArmed ? `${MOVE_LABEL[kind]} !${card.iid}? press again` : MOVE_LABEL[kind],
    check: CHECK[kind],
    press: { kind, does: ARMS.has(kind) && !isArmed ? 'arm' : 'make' },
    isArmed,
    // Why the last press of this move did not take, until it is pressed again or the head moves.
    failed: press?.state === 'failed' && press.kind === kind ? press.say : null,
  }
}

// ---- After a press: what GitLab says, and what to do about it ----------------------------------------------------------

/** How often the pane looks at an MR while GitLab carries out a move, and how many times before it stops looking. */
export const FOLLOW_MS = 3_000
export const FOLLOW_TRIES = 40

/**
 * A press as it holds now: one sent to GitLab only while the pane could still be following it (a minute past its last
 * look), so a session closed mid-move leaves no `merging…` behind. Armed presses are taken back by a timer, and a hand-off
 * or a failure holds until the head moves.
 */
export function liveOf(pressed: Pressed | undefined, now: number): Pressed | undefined {
  return pressed?.state === 'sent' && now - pressed.at > FOLLOW_MS * FOLLOW_TRIES + 60_000 ? undefined : pressed
}

/** One MR as GitLab says it just now (`MoveState`): enough to make a move, and to see it through. */
export type Fresh = {
  state: string
  /** GitLab's `detailedMergeStatus`, `MERGEABLE` when it can merge now. */
  status: string | null
  head: string
  isRebasing: boolean
  mergeError: string | null
  /** GitLab's `availableAutoMergeStrategies`, as it words them (`merge_when_checks_pass`). */
  strategies: readonly string[]
}

/**
 * What to do next for a move: rebase, merge (by a strategy, or now), look again in a moment, or stop and say how it
 * ended, `isDone` when it did what was pressed for (or as much as GitLab allows yet).
 */
export type Step = { does: 'rebase' } | { does: 'merge'; head: string; strategy: MergeStrategyEnum | null } | { does: 'wait' } | { does: 'stop'; say: string; isDone: boolean }

const done = (say: string): Step => ({ does: 'stop', say, isDone: true })
const failed = (say: string): Step => ({ does: 'stop', say, isDone: false })

const offers = (fresh: Fresh, strategy: MergeStrategyEnum): boolean => fresh.strategies.some(one => one.toUpperCase() === strategy)

/** A merge now goes into the MR's merge train where the project has one, as GitLab's own button does; else it merges. */
const nowStrategy = (fresh: Fresh): MergeStrategyEnum | null => (offers(fresh, 'MERGE_TRAIN') ? 'MERGE_TRAIN' : null)

/** A merge once checks pass joins the train where there is one. Null while GitLab offers neither (no pipeline yet). */
const whenStrategy = (fresh: Fresh): MergeStrategyEnum | null =>
  (['ADD_TO_MERGE_TRAIN_WHEN_CHECKS_PASS', 'MERGE_WHEN_CHECKS_PASS'] as const).find(strategy => offers(fresh, strategy)) ?? null

/** GitLab's words for why a move failed, on one short line. */
const why = (error: string): string => foreign(error, 120)

/**
 * The first step of a move GitLab makes, from the MR as GitLab says it just before. A merge is sent only for `head`, the
 * one its verdict was read on, and only while GitLab still says it can merge.
 */
export function firstStep(kind: 'merge' | 'rebase' | 'rebase-merge', head: string, before: Fresh): Step {
  if (kind !== 'merge') {
    return { does: 'rebase' }
  }
  if (before.head !== head) {
    return failed('changed since it was read: look again')
  }
  if (before.status !== 'MERGEABLE') {
    return failed(`cannot merge just now: GitLab says ${checkWords(before.status ?? 'nothing')}`)
  }
  return { does: 'merge', head, strategy: nowStrategy(before) }
}

/**
 * The next step of a move GitLab is carrying out, from the MR as GitLab says it now and as it said it before the move
 * (an error GitLab kept from an earlier attempt says nothing of this one). After `FOLLOW_TRIES` looks it stops, saying
 * where things stand. What it says names no MR: a row says it beside its own, a toast after the MR's number.
 */
export function nextStep(kind: 'merge' | 'rebase' | 'rebase-merge', before: Fresh, now: Fresh, tries: number): Step {
  const error = now.mergeError !== null && now.mergeError !== before.mergeError ? now.mergeError : null
  const isLast = tries >= FOLLOW_TRIES
  if (kind === 'merge') {
    if (now.state === 'merged') {
      return done('merged')
    }
    if (error !== null) {
      return failed(`not merged: ${why(error)}`)
    }
    if (now.state !== 'opened') {
      return failed(`not merged: it was ${now.state}`)
    }
    return isLast ? failed('GitLab has not merged it yet; see the MR') : { does: 'wait' }
  }
  if (error !== null) {
    return failed(`not rebased: ${why(error)}`)
  }
  if (now.isRebasing || now.head === before.head) {
    return isLast ? failed('GitLab has not finished the rebase; see the MR') : { does: 'wait' }
  }
  if (kind === 'rebase') {
    return done('rebased')
  }
  const strategy = now.status === 'MERGEABLE' ? nowStrategy(now) : whenStrategy(now)
  if (now.status === 'MERGEABLE' || strategy !== null) {
    return { does: 'merge', head: now.head, strategy }
  }
  // The rebase is done; what is left is GitLab's to offer, which the row's own move then is.
  return isLast ? done('rebased; merge it once its checks pass') : { does: 'wait' }
}

/**
 * Once GitLab took a merge: one it carries out later (once checks pass, or in its train) is as done as the pane can make
 * it, and the row says so from GitLab's next read; one it makes now is followed until it merged (null).
 */
export function afterMerge(strategy: MergeStrategyEnum | null): Step | null {
  if (strategy === 'MERGE_TRAIN') {
    return done('added to the merge train')
  }
  return strategy !== null ? done('merges when checks pass') : null
}

/**
 * What Claude is handed for an MR's conflicts: where it is (the MR, its repo, both branches and its link) and what to do,
 * in this code's words. Nothing the MR's people wrote (its title, description or comments) is in it.
 */
export function conflictsTask(card: MrCard): ModelLine[] {
  const source = foreign(card.branch.source)
  const target = foreign(card.branch.target)
  return [
    line`!${card.iid} in ${foreign(card.path)} has merge conflicts with ${target}. Resolve them in a subagent, so this conversation stays on its task: bring ${target} into ${source} (rebase or merge, as the repo does), in this session's checkout of ${source} if it has one, else a worktree of its own; resolve the conflicts, run the checks and push.`,
    line`Then say in one line whether it is fixed or needs me, and what for. ${foreign(card.url, URL_ROOM)}`,
  ]
}
