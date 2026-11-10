// When the pane moves an MR's Jira ticket, and what it remembers of each move. A ticket moves to the status the
// `jiraInReview` setting names once a person is asked to review the user's MR, and to `jiraOnMerge`'s once its MR merged
// and no open MR names it. Each step happens once per ticket: what the pane did, or found it need not do, is kept in the
// store, one entry a step, so a person who moves the ticket back is never overruled. A step's first pass only records
// what is in review or merged already: turning a setting on moves nothing that came before it.
//
// Every decision is here, on plain data; jira-mover.ts only reads the store, runs acli and applies what these say:
// `plan` a pass, `afterSearch` once Jira said where the tickets are, `endOf` (or `noStep`) for each move, `endPass` last.
import { field, text } from './decode.ts'
import { ticketOf } from './format.ts'
import { isTicketKey } from './jira.ts'
import type { Transition } from './jira.ts'

import type { MoveTargets, MrCard, OwnMrs, Ticket } from '../types'

export type MoveStep = 'review' | 'done'

export const STEPS: readonly MoveStep[] = ['review', 'done']

/**
 * How a step ended: `moved`; `no-step`, the ticket's workflow has no transition to any of the names; `refused`, Jira would
 * not (no such ticket, no permission); `settled`, the ticket was there already, done, or the step came before its setting;
 * `failed`, acli or Jira could not be asked, which alone is tried again.
 */
type MoveOutcome = 'moved' | 'no-step' | 'refused' | 'settled' | 'failed'

/** One step's end: when, how, for which MR (its card key), and the status it moved to (empty unless `moved`). */
export type MoveRecord = { at: number; outcome: MoveOutcome; mr: string; status: string }

/** The steps taken, by `<ticket>><step>`. */
export type MoveMemory = Record<string, MoveRecord>

/** A step the MRs call for: the ticket, the MR that calls for it, and the statuses to try in turn. */
export type Wanted = { ticket: string; step: MoveStep; mr: string; iid: number; names: string[] }

/** A step to take, with the status the ticket is in now. */
export type Move = Wanted & { from: string }

/** A step's record, under its store key. */
export type Kept = { key: string; record: MoveRecord }

/** How a step ended, kept and said. */
export type Ending = Kept & { toast: string | null }

/** The plugin store's keys: one per step taken, and one per step whose setting is on. */
export const MOVE_PREFIX = 'jira-move:'
export const startKey = (step: MoveStep): string => `jira-move-start:${step}`

/** How long a step that could not be asked waits before it is tried again. */
export const RETRY_MS = 15 * 60_000

/** How long a step is remembered once no open or lately merged MR names its ticket: as long as GitLab lists a merge. */
const KEPT_MS = 14 * 24 * 3_600_000

/** The most status names a setting gives, and the longest. */
const MOST_NAMES = 5
const NAME_ROOM = 60

export const NO_TARGETS: MoveTargets = { review: [], done: [] }

/** A setting's status names, in order: trimmed, each once whatever its case, no control characters, at most five. */
function statusNames(setting: unknown): string[] {
  const raw = Array.isArray(setting) ? setting : [setting]
  const names = raw.map(one => text(one).trim()).filter(name => name !== '' && name.length <= NAME_ROOM && !/\p{Cc}/u.test(name))
  return names.filter((name, at) => names.findIndex(other => other.toLowerCase() === name.toLowerCase()) === at).slice(0, MOST_NAMES)
}

/** The two settings as the steps' targets. */
export const moveTargets = (inReview: unknown, onMerge: unknown): MoveTargets => ({ review: statusNames(inReview), done: statusNames(onMerge) })

export const isMoving = (targets: MoveTargets): boolean => targets.review.length + targets.done.length > 0

const keyOf = (ticket: string, step: MoveStep): string => `${ticket}>${step}`
/** The store key of a step's record. */
export const storeKey = (wanted: Wanted): string => `${MOVE_PREFIX}${keyOf(wanted.ticket, wanted.step)}`
const kept = (wanted: Wanted, outcome: MoveOutcome, at: number, status = ''): Kept => ({ key: storeKey(wanted), record: { at, outcome, mr: wanted.mr, status } })

const OUTCOMES: readonly string[] = ['moved', 'no-step', 'refused', 'settled', 'failed'] satisfies MoveOutcome[]
const isOutcome = (value: unknown): value is MoveOutcome => typeof value === 'string' && OUTCOMES.includes(value)

/** One store entry as a step's end, or null when it is not one. */
function readRecord(raw: unknown): MoveRecord | null {
  const at = field(raw, 'at')
  const outcome = field(raw, 'outcome')
  return typeof at === 'number' && isOutcome(outcome) ? { at, outcome, mr: text(field(raw, 'mr')), status: text(field(raw, 'status')) } : null
}

/** The memory from the store's entries, by their store keys; entries of other keys, or that are not records, are left out. */
export function readMemory(entries: readonly (readonly [string, unknown])[]): MoveMemory {
  return Object.fromEntries(
    entries.flatMap(([key, raw]) => {
      const record = key.startsWith(MOVE_PREFIX) ? readRecord(raw) : null
      return record !== null ? [[key.slice(MOVE_PREFIX.length), record]] : []
    })
  )
}

/** Whether a step is still to take: never taken, or taken and failed long enough ago. */
const isOpenStep = (known: MoveRecord | null | undefined, now: number): boolean =>
  known === null || known === undefined || (known.outcome === 'failed' && now - known.at >= RETRY_MS)

/** Whether the store entry read just before a move still leaves it to take: another session may have taken it meanwhile. */
export const isStillOpen = (raw: unknown, now: number): boolean => isOpenStep(readRecord(raw), now)

/** The hosts an open MR is on whose user is not known: an MR there could be the user's, and need a ticket another MR merged for. */
const unknownHosts = (rows: readonly MrCard[], own: Readonly<Record<string, OwnMrs>>): string[] => [
  ...new Set(rows.filter(row => row.isOpen && (own[row.host]?.user ?? null) === null).map(row => row.host)),
]

/**
 * The steps the MRs call for now. In review: the user's open MR is not a draft and a person other than its author, not a
 * bot, is asked to review it. Done: the user's MR merged and no open MR the pane holds names the same ticket. A step
 * taken is not wanted again.
 */
function wantedMoves(rows: readonly MrCard[], own: Readonly<Record<string, OwnMrs>>, targets: MoveTargets, memory: MoveMemory, now: number): Wanted[] {
  const open = rows.filter(row => row.isOpen)
  const named = new Set(open.map(row => ticketOf(row.title)))
  const review = open.flatMap(row => {
    const ticket = ticketOf(row.title)
    const isMine = row.author !== '' && own[row.host]?.user === row.author
    const isAsked = !row.isDraft && row.reviewers.some(reviewer => !reviewer.isBot && reviewer.username !== row.author)
    return ticket !== null && isMine && isAsked ? [{ ticket, step: 'review' as const, mr: row.key, iid: row.iid, names: targets.review }] : []
  })
  const done = Object.values(own).flatMap(one =>
    one.merged.flatMap(mr => {
      const ticket = ticketOf(mr.title)
      return ticket !== null && !named.has(ticket) ? [{ ticket, step: 'done' as const, mr: mr.key, iid: mr.iid, names: targets.done }] : []
    })
  )
  const wanted = [...review, ...done].filter(one => one.names.length > 0 && isTicketKey(one.ticket) && isOpenStep(memory[keyOf(one.ticket, one.step)], now))
  return wanted.filter((one, at) => wanted.findIndex(other => other.ticket === one.ticket && other.step === one.step) === at)
}

/** The memory's store keys of the steps of tickets no MR the pane holds or the user lately merged names, once they are old. */
function forgotten(memory: MoveMemory, rows: readonly MrCard[], own: Readonly<Record<string, OwnMrs>>, now: number): string[] {
  const named = new Set([...rows.map(row => ticketOf(row.title)), ...Object.values(own).flatMap(one => one.merged.map(mr => ticketOf(mr.title)))])
  return Object.entries(memory).flatMap(([key, one]) => (named.has(key.split('>')[0] ?? '') || now - one.at < KEPT_MS ? [] : [`${MOVE_PREFIX}${key}`]))
}

/** What a pass does before it asks Jira anything, in this order. */
export type Plan = {
  /** Start entries to drop: their step is off, and starts afresh when on again. */
  drop: MoveStep[]
  /** Why nothing moves yet, for /gitlab, or null. */
  wait: string | null
  /** Store keys of steps to forget. */
  forget: string[]
  /** Steps found when their setting was turned on, kept as settled, never moved. */
  found: Kept[]
  /** Start entries to write, once `found` is kept, so a pass cut short in between records them again. */
  start: MoveStep[]
  /** The steps to take. */
  take: Wanted[]
  /** Whether nothing is left that /gitlab should say: no step to take and none failed to try again. */
  isClear: boolean
}

const IDLE: Omit<Plan, 'drop'> = { wait: null, forget: [], found: [], start: [], take: [], isClear: false }

/**
 * A pass's plan from the open MRs (`rows`), who the user is and what they merged on each host (`own`), the steps' targets,
 * the memory (null while no step is on: it is not read), and the steps already on (`started`). Nothing moves until the
 * user is known on every host an open MR is on; until the inbox has read any host, that is not said, as a session that
 * has just begun to lead waits a minute for it.
 */
export function plan(input: {
  rows: readonly MrCard[]
  own: Readonly<Record<string, OwnMrs>>
  targets: MoveTargets
  memory: MoveMemory | null
  started: readonly MoveStep[]
  now: number
}): Plan {
  const { rows, own, targets, memory, started, now } = input
  const drop = started.filter(step => targets[step].length === 0)
  const unknown = unknownHosts(rows, own)
  if (memory === null || !isMoving(targets)) {
    return { ...IDLE, drop }
  }
  if (unknown.length > 0) {
    return { ...IDLE, drop, wait: Object.keys(own).length > 0 ? `waiting for the inbox to say who you are on ${unknown.join(', ')}` : null }
  }
  const wanted = wantedMoves(rows, own, targets, memory, now)
  const take = wanted.filter(one => started.includes(one.step))
  return {
    drop,
    wait: null,
    forget: forgotten(memory, rows, own, now),
    found: wanted.filter(one => !started.includes(one.step)).map(one => kept(one, 'settled', now)),
    start: STEPS.filter(step => targets[step].length > 0 && !started.includes(step)),
    take,
    isClear: take.length === 0 && Object.values(memory).every(one => one.outcome !== 'failed'),
  }
}

/** A search that could not be made: each step to take is a failed ask, tried again later. */
export const failedAsks = (take: readonly Wanted[], now: number): Kept[] => take.map(one => kept(one, 'failed', now))

/** Why a ticket the search did not return was not moved. */
const NOT_SHOWN = 'Jira does not show it to you'

const WHY: Record<MoveStep, string> = { review: 'is in review', done: 'merged' }

/** The toast a step's end makes, or null for one that changed nothing worth saying; `from` is the status it was in, if read. */
function toastOf(move: Wanted & { from?: string }, outcome: MoveOutcome, status: string, message: string): string | null {
  const names = move.names.join(' or ')
  const said: Record<MoveOutcome, string | null> = {
    moved: `${move.ticket} moved to ${status}: !${move.iid} ${WHY[move.step]}.`,
    'no-step': `${move.ticket} stays in ${move.from ?? 'its status'}: its workflow has no step to ${names}.`,
    refused: `${move.ticket} was not moved to ${names}: ${message.slice(0, 120)}`,
    // Nothing changed that the person did not already see; a failure is said by /gitlab, and tried again.
    settled: null,
    failed: null,
  }
  return said[outcome]
}

const isIn = (status: string, names: readonly string[]): boolean => names.some(name => name.toLowerCase() === status.toLowerCase())

/**
 * Which steps to take, given what Jira says of the tickets now; the rest end here. A ticket the search did not return is
 * refused, unless it returned none, which is a failed ask the first time and a refusal the next. A ticket never moves
 * when Jira counts it done or did not say, nor when it is already in a status the step names, nor back to review from a
 * status done names. `problem` is what /gitlab should say, or null.
 */
export function afterSearch(
  take: readonly Wanted[],
  tickets: Readonly<Record<string, Ticket>>,
  targets: MoveTargets,
  memory: MoveMemory,
  now: number
): { moves: Move[]; endings: Ending[]; problem: string | null } {
  const isAnswered = Object.keys(tickets).length > 0
  const moves: Move[] = []
  const endings: Ending[] = []
  for (const one of take) {
    const ticket = tickets[one.ticket]
    if (ticket === undefined) {
      const hasFailed = memory[keyOf(one.ticket, one.step)]?.outcome === 'failed'
      const outcome = isAnswered || hasFailed ? 'refused' : 'failed'
      endings.push({ ...kept(one, outcome, now), toast: toastOf(one, outcome, '', NOT_SHOWN) })
    } else if (ticket.isDone !== false || isIn(ticket.status, one.names) || (one.step === 'review' && isIn(ticket.status, targets.done))) {
      endings.push({ ...kept(one, 'settled', now), toast: null })
    } else {
      moves.push({ ...one, from: ticket.status })
    }
  }
  const problem = endings.some(one => one.record.outcome === 'failed') ? 'Jira returned none of the tickets asked for' : null
  return { moves, endings, problem }
}

/** What acli did with one status of a move: what it said, or why it could not be asked. */
export type Said = Transition | { kind: 'failed'; reason: string }

/** How a move ends once acli said `said` of the status `name`, or null to try the move's next status. */
export function endOf(move: Move, name: string, said: Said, now: number): Ending | null {
  if (said.kind === 'no-step') {
    return null
  }
  const status = said.kind === 'moved' ? name : ''
  return { ...kept(move, said.kind, now, status), toast: toastOf(move, said.kind, status, said.kind === 'refused' ? said.message : '') }
}

/** How a move ends once none of its statuses had a step from where the ticket is. */
export const noStep = (move: Move, now: number): Ending => ({ ...kept(move, 'no-step', now), toast: toastOf(move, 'no-step', '', '') })

/** After the moves: the tickets as they are now, for their MRs' pages, and whether every step this pass ended for good. */
export function endPass(tickets: Readonly<Record<string, Ticket>>, moves: readonly Move[], endings: readonly Kept[]): { tickets: Record<string, Ticket>; isClear: boolean } {
  const current = { ...tickets }
  for (const move of moves) {
    const ticket = current[move.ticket]
    const ended = endings.find(one => one.key === storeKey(move))?.record
    if (ticket !== undefined && ended?.outcome === 'moved') {
      current[move.ticket] = { ...ticket, status: ended.status }
    }
  }
  return { tickets: current, isClear: endings.every(one => one.record.outcome !== 'failed') }
}
