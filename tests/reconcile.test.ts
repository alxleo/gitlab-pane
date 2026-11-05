import { expect, test } from 'claude-code/testing'

import { NOW, job, pipe, rawMr, stage } from './fixtures'

import { toCard } from '../hooks/gitlab'
import { reconcile } from '../hooks/reconcile'

import type { MergeStatus, MrCard, Pinned } from '../types'

const KEY = 'g/p!12'

const pin = (origin?: 'raised' | 'watched'): Pinned => ({
  url: 'https://gitlab.com/g/p/-/merge_requests/12',
  project: 'g/p',
  iid: 12,
  ...(origin ? { origin } : {}),
})

type Wire = Parameters<typeof pipe>[0]

/** !12 with the pipeline `id` in `status`, GitLab's verdict `mergeStatus`, and `lint` the one job that failed, if any. */
const card = (status: Wire, mergeStatus: MergeStatus | null = null, over: { id?: number; state?: string; failedJob?: boolean } = {}): MrCard => {
  const id = over.id ?? 99
  const headPipeline = pipe(status, {
    id: `gid://gitlab/Ci::Pipeline/${id}`,
    ...(over.failedJob ? { stages: { nodes: [stage('test', 'FAILED', [job('lint', 'FAILED')])] } } : {}),
  })
  return { ...toCard(rawMr(12, { headPipeline, state: over.state ?? 'opened' })), mergeStatus }
}

type Case = {
  name: string
  pinned: Pinned[]
  rows: MrCard[]
  announced: Record<string, string[]>
  expected: { announced: Record<string, string[]>; toasts: (string | RegExp)[]; wakes: (string | RegExp)[]; unpinned: string[]; rows: string[] }
}

const cases: Case[] = [
  {
    name: 'a first sighting seeds what it shows and wakes nothing, however bad it is',
    pinned: [pin('raised')],
    rows: [card('FAILED', 'CI_MUST_PASS', { failedJob: true })],
    announced: {},
    expected: { announced: { [KEY]: ['99:failed'] }, toasts: [], wakes: [], unpinned: [], rows: [KEY] },
  },
  {
    name: 'a failure after the first sighting wakes a raised MR and toasts it',
    pinned: [pin('raised')],
    rows: [card('FAILED', 'CI_MUST_PASS', { failedJob: true })],
    announced: { [KEY]: [] },
    expected: {
      announced: { [KEY]: ['99:failed'] },
      toasts: [/^!12 pipeline failed in .*: lint · /],
      wakes: [/^!12 pipeline failed in .*: lint · /],
      unpinned: [],
      rows: [KEY],
    },
  },
  {
    name: 'the same failure told already says nothing again',
    pinned: [pin('raised')],
    rows: [card('FAILED', 'CI_MUST_PASS', { failedJob: true })],
    announced: { [KEY]: ['99:failed'] },
    expected: { announced: { [KEY]: ['99:failed'] }, toasts: [], wakes: [], unpinned: [], rows: [KEY] },
  },
  {
    name: 'a new pipeline failing is news again, and the old pipeline is forgotten',
    pinned: [pin('raised')],
    rows: [card('FAILED', 'CI_MUST_PASS', { id: 100, failedJob: true })],
    announced: { [KEY]: ['99:failed'] },
    expected: { announced: { [KEY]: ['100:failed'] }, toasts: [/^!12 pipeline failed/], wakes: [/^!12 pipeline failed/], unpinned: [], rows: [KEY] },
  },
  {
    name: 'a job failing while the pipeline still runs wakes too',
    pinned: [pin('raised')],
    rows: [card('RUNNING', 'CI_STILL_RUNNING', { failedJob: true })],
    announced: { [KEY]: [] },
    expected: {
      announced: { [KEY]: ['99:failed'] },
      toasts: [/^!12 a job failed while the pipeline runs: lint/],
      wakes: [/^!12 a job failed while the pipeline runs: lint/],
      unpinned: [],
      rows: [KEY],
    },
  },
  {
    name: 'a watched pin toasts its news and never wakes',
    pinned: [pin('watched')],
    rows: [card('FAILED', 'CI_MUST_PASS', { failedJob: true })],
    announced: { [KEY]: [] },
    expected: { announced: { [KEY]: ['99:failed'] }, toasts: [/^!12 pipeline failed/], wakes: [], unpinned: [], rows: [KEY] },
  },
  {
    name: 'a pin kept from before origins were recorded wakes as every pin then did',
    pinned: [pin()],
    rows: [card('FAILED', 'CI_MUST_PASS', { failedJob: true })],
    announced: { [KEY]: [] },
    expected: { announced: { [KEY]: ['99:failed'] }, toasts: [/^!12 pipeline failed/], wakes: [/^!12 pipeline failed/], unpinned: [], rows: [KEY] },
  },
  {
    name: 'an MR GitLab says can merge wakes once',
    pinned: [pin('raised')],
    rows: [{ ...card('SUCCESS', 'MERGEABLE'), approvalsLeft: 0 }],
    announced: { [KEY]: [] },
    expected: {
      announced: { [KEY]: ['99:mergeable'] },
      toasts: ['!12 can merge: pipeline passed in 10m'],
      wakes: ['!12 can merge: pipeline passed in 10m'],
      unpinned: [],
      rows: [KEY],
    },
  },
  {
    name: 'a pipeline waiting on a manual job wakes nothing',
    pinned: [pin('raised')],
    rows: [card('MANUAL', 'CI_MUST_PASS')],
    announced: { [KEY]: [] },
    expected: { announced: { [KEY]: [] }, toasts: [], wakes: [], unpinned: [], rows: [KEY] },
  },
  {
    name: 'a merged pin is unpinned with a toast, wakes nothing and leaves the rows',
    pinned: [pin('raised')],
    rows: [card('SUCCESS', 'NOT_OPEN', { state: 'merged' })],
    announced: { [KEY]: ['99:mergeable'] },
    expected: { announced: { [KEY]: ['99:mergeable'] }, toasts: ['!12 is closed or merged; unpinned.'], wakes: [], unpinned: [KEY], rows: [] },
  },
  {
    name: 'a closed pin is unpinned the same way',
    pinned: [pin('watched')],
    rows: [card('FAILED', null, { state: 'closed' })],
    announced: {},
    expected: { announced: {}, toasts: ['!12 is closed or merged; unpinned.'], wakes: [], unpinned: [KEY], rows: [] },
  },
  {
    name: 'a pin the read did not return is left as it was',
    pinned: [pin('raised')],
    rows: [],
    announced: { [KEY]: ['99:failed'] },
    expected: { announced: { [KEY]: ['99:failed'] }, toasts: [], wakes: [], unpinned: [], rows: [] },
  },
  {
    name: 'an MR that is not pinned is shown and never announced',
    pinned: [],
    rows: [card('FAILED', 'CI_MUST_PASS', { failedJob: true })],
    announced: {},
    expected: { announced: {}, toasts: [], wakes: [], unpinned: [], rows: [KEY] },
  },
]

for (const one of cases) {
  test(`reconcile: ${one.name}`, async () => {
    const before = JSON.stringify(one.announced)
    const result = reconcile({ pinned: one.pinned, rows: one.rows, announced: one.announced, now: NOW })
    expect(result.announced).toEqual(one.expected.announced)
    expect(result.toasts.length).toBe(one.expected.toasts.length)
    expect(result.wakes.length).toBe(one.expected.wakes.length)
    one.expected.toasts.forEach((want, i) => (typeof want === 'string' ? expect(result.toasts[i]).toBe(want) : expect(result.toasts[i]).toMatch(want)))
    one.expected.wakes.forEach((want, i) => (typeof want === 'string' ? expect(result.wakes[i]).toBe(want) : expect(result.wakes[i]).toMatch(want)))
    expect(result.unpinned).toEqual(one.expected.unpinned)
    expect(result.rows.map(row => row.key)).toEqual(one.expected.rows)
    // The announced map it was given is left as it was.
    expect(JSON.stringify(one.announced)).toBe(before)
  })
}

test('reconcile: told once is told for good, whatever the pipeline does next', async () => {
  const pinned = [pin('raised')]
  const failing = [card('FAILED', 'CI_MUST_PASS', { failedJob: true })]
  const first = reconcile({ pinned, rows: failing, announced: { [KEY]: [] }, now: NOW })
  expect(first.wakes.length).toBe(1)
  const again = reconcile({ pinned, rows: failing, announced: first.announced, now: NOW })
  expect(again.wakes).toEqual([])
  const passing = reconcile({ pinned, rows: [card('SUCCESS', null)], announced: again.announced, now: NOW })
  expect(passing.wakes).toEqual([])
  expect(passing.announced[KEY]).toEqual(['99:failed'])
})
