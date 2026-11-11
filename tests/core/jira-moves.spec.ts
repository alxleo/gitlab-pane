import { expect, test } from 'vitest'

import { HOST, NOW, SELF_MANAGED, project, rawMr, reviewer } from '../fixtures.ts'

import { toCard } from '../../hooks/gitlab.ts'
import {
  MOVE_PREFIX,
  RETRY_MS,
  STEPS,
  afterSearch,
  endOf,
  endPass,
  failedAsks,
  isStillOpen,
  liveTargets,
  moveTargets,
  noStep,
  plan,
  readMemory,
  reviewing,
} from '../../hooks/jira-moves.ts'
import type { MoveMemory, MoveRecord, MoveStep, Wanted } from '../../hooks/jira-moves.ts'
import { slimCard } from '../../hooks/slim.ts'

import type { MoveTargets, MrCard, OwnMrs, Ticket } from '../../types'

const TARGETS = moveTargets(['In Review', 'Code Review'], ['Done'])
const ME: Record<string, OwnMrs> = { [HOST]: { user: 'alex', merged: [] } }
const DAY = 24 * 3_600_000

// As the leader has it after a read: the card shared between sessions.
const inReview = (over: Parameters<typeof rawMr>[1] = {}, host = HOST): MrCard =>
  slimCard(toCard(host, rawMr(12, { reviewers: { nodes: [reviewer('maya', 'UNREVIEWED')] }, ...over })))

const elsewhere = (over: Parameters<typeof rawMr>[1] = {}) => inReview({ project: project('g/q', SELF_MANAGED), ...over }, SELF_MANAGED)

const merged = (iid: number, title: string): OwnMrs['merged'][number] => ({ key: `${HOST}/g/p!${iid}`, iid, title })

const planned = (rows: MrCard[], own = ME, memory: MoveMemory = {}, over: { targets?: MoveTargets; started?: readonly MoveStep[]; now?: number } = {}) =>
  plan({ rows, own, targets: over.targets ?? TARGETS, memory, started: over.started ?? STEPS, now: over.now ?? NOW })

/** The steps a pass takes, both steps long on. */
const taken = (rows: MrCard[], own = ME, memory: MoveMemory = {}, now = NOW) => planned(rows, own, memory, { now }).take

const ticket = (status: string, isDone: boolean | null = false): Ticket => ({ type: 'Task', status, isDone, summary: 'Make the thing work' })

const step = (over: Partial<Wanted> = {}): Wanted => ({ ticket: 'ABC-1', step: 'review', mr: `${HOST}/g/p!12`, iid: 12, names: ['In Review', 'Code Review'], ...over })

const record = (outcome: MoveRecord['outcome'], at = NOW): MoveRecord => ({ at, outcome, mr: `${HOST}/g/p!12`, status: '' })

const outcomes = (endings: readonly { record: MoveRecord }[]) => endings.map(one => one.record.outcome)

/** No ticket has been in review before. */
const NEVER: ReadonlySet<string> = new Set()

test('the settings give each step its statuses in order, each once, and nothing that is not a name', () => {
  expect(moveTargets([' In Review ', 'in review', 'Code Review', '', 'bad\u0007name', 7], []).review).toEqual(['In Review', 'Code Review'])
  expect(moveTargets([], 'Done').done).toEqual(['Done'])
  expect(moveTargets(undefined, undefined)).toEqual({ review: [], done: [] })
  expect(moveTargets(['a', 'b', 'c', 'd', 'e', 'f'], []).review).toHaveLength(5)
})

test('an MR of the user out of draft with a person asked to review it wants its ticket in review', () => {
  expect(taken([inReview()])).toEqual([step()])
})

test('a draft, an MR no other person is asked to review, or someone else’s MR moves nothing; the author asking themselves beside another does not hide the other', () => {
  expect(taken([inReview({ draft: true })])).toEqual([])
  expect(taken([inReview({ reviewers: { nodes: [reviewer('review-bot', 'UNREVIEWED', true)] } })])).toEqual([])
  // The author asking themselves is no review; asking themselves first and then someone else is.
  expect(taken([inReview({ reviewers: { nodes: [reviewer('alex', 'UNREVIEWED')] } })])).toEqual([])
  expect(taken([inReview({ reviewers: { nodes: [reviewer('alex', 'UNREVIEWED'), reviewer('maya', 'UNREVIEWED')] } })])).toEqual([step()])
  expect(taken([inReview({ author: { username: 'maya' } })])).toEqual([])
  // A title with no ticket has nothing to move.
  expect(taken([inReview({ title: 'fix: the thing' })])).toEqual([])
})

test('nothing moves until the user is known on every host an open MR is on, and /gitlab says so once the inbox has read one', () => {
  expect(planned([inReview(), elsewhere()]).wait).toBe(`waiting for the inbox to say who you are on ${SELF_MANAGED}`)
  expect(planned([inReview(), elsewhere()]).take).toEqual([])
  expect(planned([inReview()], { [HOST]: { user: null, merged: [] } }).wait).toBe(`waiting for the inbox to say who you are on ${HOST}`)
  // Before the inbox has read any host, a session that has just begun to lead waits without a word.
  expect(planned([inReview()], {})).toMatchObject({ wait: null, take: [] })
  expect(planned([], {}).wait).toBeNull()
})

test('a merged MR moves its ticket to done only when no open MR, on any host and whoever wrote it, still names it', () => {
  const own = { [HOST]: { user: 'alex', merged: [merged(9, 'feat: [ABC-1] first half')] } }
  expect(taken([], own)).toEqual([step({ step: 'done', mr: `${HOST}/g/p!9`, iid: 9, names: ['Done'] })])
  // MR 12 names the same ticket and is still open, out of review: the ticket waits for it.
  expect(taken([inReview({ reviewers: { nodes: [] } })], own)).toEqual([])
  // So does one on another host, whoever wrote it.
  expect(taken([elsewhere({ reviewers: { nodes: [] }, author: { username: 'maya' } })], { ...own, [SELF_MANAGED]: { user: 'alex', merged: [] } })).toEqual([])
})

test('a step is taken once, and only one that could not be asked is tried again, after a while', () => {
  const at = (outcome: MoveRecord['outcome'], when = NOW): MoveMemory => ({ 'ABC-1>review': record(outcome, when) })
  expect(taken([inReview()], ME, at('moved'))).toEqual([])
  expect(taken([inReview()], ME, at('settled'))).toEqual([])
  expect(taken([inReview()], ME, at('failed'))).toEqual([])
  expect(taken([inReview()], ME, at('failed', NOW - RETRY_MS))).toHaveLength(1)
  // Read again just before the move: another session may have taken it since.
  expect(isStillOpen(undefined, NOW)).toBe(true)
  expect(isStillOpen(record('moved'), NOW)).toBe(false)
  expect(isStillOpen(record('failed', NOW - RETRY_MS), NOW)).toBe(true)
})

test('a step whose setting is empty is never wanted, and a step turned off drops its start, to start afresh', () => {
  const own = { [HOST]: { user: 'alex', merged: [merged(9, 'feat: [ABC-2] other')] } }
  expect(planned([inReview()], own, {}, { targets: moveTargets([], []) })).toMatchObject({ take: [], drop: ['review', 'done'] })
  expect(planned([inReview()], own, {}, { targets: moveTargets([], ['Done']) })).toMatchObject({ drop: ['review'] })
  expect(planned([inReview()], own, {}, { targets: moveTargets([], ['Done']) }).take.map(one => one.step)).toEqual(['done'])
  // With no step on, the memory is not read at all.
  expect(plan({ rows: [inReview()], own, targets: moveTargets([], []), memory: null, started: [], now: NOW })).toMatchObject({ take: [], found: [], drop: [] })
})

test('two MRs of one ticket in review want one move', () => {
  const other = slimCard(toCard(HOST, rawMr(13, { reviewers: { nodes: [reviewer('maya', 'UNREVIEWED')] } })))
  expect(taken([inReview(), other])).toHaveLength(1)
})

test('a step just turned on only records what is already in review or merged, and is on only after; later ones are taken', () => {
  const own = { [HOST]: { user: 'alex', merged: [merged(9, 'feat: [ABC-2] done')] } }
  const fresh = planned([inReview()], own, {}, { started: [] })
  expect(fresh.take).toEqual([])
  expect(fresh.found.map(one => [one.key, one.record.outcome])).toEqual([
    [`${MOVE_PREFIX}ABC-1>review`, 'settled'],
    [`${MOVE_PREFIX}ABC-2>done`, 'settled'],
  ])
  expect(fresh.start).toEqual(['review', 'done'])
  const half = planned([inReview()], own, {}, { started: ['review'] })
  expect([half.take.map(one => one.ticket), half.found.map(one => one.key), half.start]).toEqual([['ABC-1'], [`${MOVE_PREFIX}ABC-2>done`], ['done']])
  expect(planned([inReview()], own, {}).found).toEqual([])
})

test('a pass with nothing to take and nothing to try again clears what /gitlab said of the moves', () => {
  expect(planned([]).isClear).toBe(true)
  expect(planned([], ME, { 'ABC-9>done': record('failed') }).isClear).toBe(false)
  expect(planned([inReview()]).isClear).toBe(false)
})

test('a ticket that is done, may be done, or is already where the step leads or past it, is left as it is', () => {
  const ends = (one: Ticket) => outcomes(afterSearch([step()], { 'ABC-1': one }, TARGETS, {}, NOW, NEVER).endings)
  expect(afterSearch([step()], { 'ABC-1': ticket('Backlog') }, TARGETS, {}, NOW, NEVER)).toEqual({ moves: [{ ...step(), from: 'Backlog' }], endings: [], problem: null })
  expect(ends(ticket('Closed', true))).toEqual(['settled'])
  // Jira did not say whether it is done: it is not moved.
  expect(ends(ticket('Shipped', null))).toEqual(['settled'])
  expect(ends(ticket('code review'))).toEqual(['settled'])
  // In a status the done step names, though not one Jira counts done: never back to review.
  expect(ends(ticket('Done', false))).toEqual(['settled'])
})

test('a ticket that has been in review is never brought back to it, from QA or wherever the team moved it since', () => {
  const qa = { 'ABC-1': ticket('QA'), 'ABC-2': ticket('In Progress') }
  const both = [step(), step({ ticket: 'ABC-2' })]
  const after = afterSearch(both, qa, TARGETS, {}, NOW, new Set(['ABC-1']))
  expect(outcomes(after.endings)).toEqual(['settled'])
  expect(after.endings[0]?.toast).toBeNull()
  expect(after.moves).toEqual([{ ...step({ ticket: 'ABC-2' }), from: 'In Progress' }])
  // The tickets Jira is asked about: those of review steps, each once; a done step needs no history.
  expect(reviewing([...both, step(), step({ ticket: 'ABC-3', step: 'done', names: ['Done'] })])).toEqual(['ABC-1', 'ABC-2'])
  // Its done step is not held back by having been in review.
  const done = step({ step: 'done', names: ['Done'] })
  expect(afterSearch([done], qa, TARGETS, {}, NOW, new Set(['ABC-1'])).moves).toEqual([{ ...done, from: 'QA' }])
})

test('a ticket the search leaves out is refused, unless the search found none, which is tried again once', () => {
  const two = [step(), step({ ticket: 'ABC-2' })]
  const some = afterSearch(two, { 'ABC-2': ticket('Backlog') }, TARGETS, {}, NOW, NEVER)
  expect(outcomes(some.endings)).toEqual(['refused'])
  expect(some.endings[0]?.toast).toBe('ABC-1 was not moved to In Review or Code Review: Jira does not show it to you')
  const none = afterSearch(two, {}, TARGETS, {}, NOW, NEVER)
  expect([outcomes(none.endings), none.problem]).toEqual([['failed', 'failed'], 'Jira returned none of the tickets asked for'])
  // Left out again after a failed ask: a key Jira does not show, not a passing fault.
  expect(outcomes(afterSearch(two, {}, TARGETS, { 'ABC-1>review': record('failed', NOW - RETRY_MS) }, NOW, NEVER).endings)).toEqual(['refused', 'failed'])
  // A search that could not be made at all: every step is a failed ask.
  expect(outcomes(failedAsks(two, NOW))).toEqual(['failed', 'failed'])
})

test('a status with no step leaves the move to the next status, and each end that changed or could not change the ticket says so', () => {
  const move = { ...step(), from: 'Backlog' }
  expect(endOf(move, 'In Review', { kind: 'no-step' }, NOW)).toBeNull()
  expect(endOf(move, 'Code Review', { kind: 'moved' }, NOW)).toEqual({
    key: `${MOVE_PREFIX}ABC-1>review`,
    record: { at: NOW, outcome: 'moved', mr: `${HOST}/g/p!12`, status: 'Code Review' },
    toast: 'ABC-1 moved to Code Review: !12 is in review.',
  })
  expect(endOf({ ...move, step: 'done', iid: 9 }, 'Done', { kind: 'moved' }, NOW)?.toast).toBe('ABC-1 moved to Done: !9 merged.')
  expect(noStep(move, NOW).toast).toBe('ABC-1 stays in Backlog: its workflow has no step to In Review or Code Review.')
  expect(endOf(move, 'In Review', { kind: 'refused', message: 'You do not have permission' }, NOW)?.toast).toBe(
    'ABC-1 was not moved to In Review or Code Review: You do not have permission'
  )
  expect(endOf(move, 'In Review', { kind: 'failed', reason: 'acli is not installed' }, NOW)).toMatchObject({ record: { outcome: 'failed' }, toast: null })
})

test('after the moves the tickets show their new status, and a pass is clear only when no step, this pass’s or an earlier one’s, waits to be tried again', () => {
  const move = { ...step(), from: 'Backlog' }
  const moved = endOf(move, 'In Review', { kind: 'moved' }, NOW)
  const endings = moved !== null ? [moved] : []
  expect(endPass({ 'ABC-1': ticket('Backlog') }, [move], endings, {})).toEqual({ tickets: { 'ABC-1': ticket('In Review') }, isClear: true })
  expect(endPass({ 'ABC-1': ticket('Backlog') }, [move], failedAsks([move], NOW), {}).isClear).toBe(false)
  // ABC-2 failed earlier and waits for its retry: ABC-1 moving now does not make that past.
  expect(endPass({ 'ABC-1': ticket('Backlog') }, [move], endings, { 'ABC-2>review': record('failed') }).isClear).toBe(false)
  // A step that failed before and moves now is past.
  expect(endPass({ 'ABC-1': ticket('Backlog') }, [move], endings, { 'ABC-1>review': record('failed', NOW - RETRY_MS) }).isClear).toBe(true)
})

test('with no Jira site, no step is on whatever the settings say', () => {
  expect(liveTargets('', TARGETS)).toEqual({ review: [], done: [] })
  expect(liveTargets('https://jira.example.com/browse/', TARGETS)).toEqual(TARGETS)
})

test('the memory is one store entry a step, and a step is forgotten only when nothing names its ticket and it is old', () => {
  const memory = readMemory([
    [`${MOVE_PREFIX}ABC-1>review`, { at: NOW - 14 * DAY, outcome: 'moved', mr: 'k', status: 'In Review' }],
    [`${MOVE_PREFIX}ABC-2>done`, { at: NOW - 14 * DAY, outcome: 'settled', mr: 'k', status: '' }],
    [`${MOVE_PREFIX}ABC-3>review`, { at: NOW, outcome: 'moved', mr: 'k', status: 'In Review' }],
    [`${MOVE_PREFIX}ABC-4>done`, { at: NOW, outcome: 'nonsense' }],
    ['seen:abc:x', { at: NOW, outcome: 'moved' }],
  ])
  expect(Object.keys(memory)).toEqual(['ABC-1>review', 'ABC-2>done', 'ABC-3>review'])
  expect(readMemory([])).toEqual({})
  expect(planned([], ME, memory).forget).toEqual([`${MOVE_PREFIX}ABC-1>review`, `${MOVE_PREFIX}ABC-2>done`])
  // An MR open longer than the memory lasts still names its ticket, so a ticket a person moved back stays where they put it.
  expect(planned([inReview({ reviewers: { nodes: [] } })], ME, memory).forget).toEqual([`${MOVE_PREFIX}ABC-2>done`])
  expect(planned([], { [HOST]: { user: 'alex', merged: [merged(9, 'fix: [ABC-2] y')] } }, memory).forget).toEqual([`${MOVE_PREFIX}ABC-1>review`])
})
