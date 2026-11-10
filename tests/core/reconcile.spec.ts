import { expect, test } from 'vitest'
import fc from 'fast-check'

import { HOST, NOW, checks, job, pipe, rawMr, stage } from '../fixtures.ts'

import { toCard } from '../../hooks/gitlab.ts'
import { advance } from '../../hooks/wake.ts'
import { reconcile } from '../../hooks/reconcile.ts'
import type { FailureReader } from '../../hooks/reconcile.ts'
import { tailOf } from '../../hooks/job-tail.ts'
import { foreign } from '../../hooks/model-text.ts'

import type { MergeRequestState } from '../../hooks/gitlab.generated.ts'
import type { CheckStatus, MrCard, Pinned } from '../../types'

const KEY = 'gitlab.com/g/p!12'

/** A reader that knows nothing of why jobs failed, as when GitLab cannot say. */
const noFailures: FailureReader = async () => new Map()

const pin = (origin?: 'raised' | 'watched'): Pinned => ({
  url: 'https://gitlab.com/g/p/-/merge_requests/12',
  host: HOST,
  path: 'g/p',
  iid: 12,
  ...(origin !== undefined ? { origin } : {}),
})

type Wire = Parameters<typeof pipe>[0]

/** !12 with the pipeline `id` in `status`, the merge checks `says` GitLab fails or is still making (none read: null), and `lint` the one job that failed, if any. */
const card = (status: Wire, says: Partial<Record<string, CheckStatus>> | null = null, over: { id?: number; state?: MergeRequestState; failedJob?: boolean } = {}): MrCard => {
  const id = over.id ?? 99
  const headPipeline = pipe(status, {
    id: `gid://gitlab/Ci::Pipeline/${id}`,
    ...(over.failedJob === true ? { stages: { nodes: [stage('test', 'FAILED', [job('lint', 'FAILED')])] } } : {}),
  })
  return {
    ...toCard(HOST, rawMr(12, { headPipeline, state: over.state ?? 'opened' })),
    mergeStatus: says === null ? null : checks().map(check => ({ id: check.identifier, status: says[check.identifier] ?? 'success' })),
  }
}

type Case = {
  name: string
  pinned: Pinned[]
  rows: MrCard[]
  announced: Record<string, string[]>
  expected: { announced: Record<string, string[]>; toasts: (string | RegExp)[]; wakes: (string | RegExp)[]; unpinned: string[]; rows: string[] }
}

/** The texts said, with each one that the pattern wanted at its place matches replaced by that pattern, so one `toEqual` fails with the text beside the pattern it missed. */
const asMatched = (said: readonly string[], wanted: readonly (string | RegExp)[]): (string | RegExp)[] =>
  said.map((text, at) => {
    const one = wanted[at]
    return one instanceof RegExp && one.test(text) ? one : text
  })

const cases: Case[] = [
  {
    name: 'a first sighting seeds what it shows and wakes nothing, however bad it is',
    pinned: [pin('raised')],
    rows: [card('FAILED', { CI_MUST_PASS: 'failed' }, { failedJob: true })],
    announced: {},
    expected: { announced: { [KEY]: ['99:failed'] }, toasts: [], wakes: [], unpinned: [], rows: [KEY] },
  },
  {
    name: 'a failure after the first sighting wakes a raised MR and toasts it',
    pinned: [pin('raised')],
    rows: [card('FAILED', { CI_MUST_PASS: 'failed' }, { failedJob: true })],
    announced: { [KEY]: [] },
    expected: {
      announced: { [KEY]: ['99:failed'] },
      toasts: [/^!12 pipeline failed in .*: lint · /u],
      wakes: [/^!12 pipeline failed in .*: lint · /u],
      unpinned: [],
      rows: [KEY],
    },
  },
  {
    name: 'the same failure told already says nothing again',
    pinned: [pin('raised')],
    rows: [card('FAILED', { CI_MUST_PASS: 'failed' }, { failedJob: true })],
    announced: { [KEY]: ['99:failed'] },
    expected: { announced: { [KEY]: ['99:failed'] }, toasts: [], wakes: [], unpinned: [], rows: [KEY] },
  },
  {
    name: 'a new pipeline failing is news again, and the old pipeline is forgotten',
    pinned: [pin('raised')],
    rows: [card('FAILED', { CI_MUST_PASS: 'failed' }, { id: 100, failedJob: true })],
    announced: { [KEY]: ['99:failed'] },
    expected: { announced: { [KEY]: ['100:failed'] }, toasts: [/^!12 pipeline failed/u], wakes: [/^!12 pipeline failed/u], unpinned: [], rows: [KEY] },
  },
  {
    name: 'a job failing while the pipeline still runs wakes too',
    pinned: [pin('raised')],
    rows: [card('RUNNING', { CI_MUST_PASS: 'checking' }, { failedJob: true })],
    announced: { [KEY]: [] },
    expected: {
      announced: { [KEY]: ['99:failed'] },
      toasts: [/^!12 a job failed while the pipeline runs: lint/u],
      wakes: [/^!12 a job failed while the pipeline runs: lint/u],
      unpinned: [],
      rows: [KEY],
    },
  },
  {
    name: 'a watched pin toasts its news and never wakes',
    pinned: [pin('watched')],
    rows: [card('FAILED', { CI_MUST_PASS: 'failed' }, { failedJob: true })],
    announced: { [KEY]: [] },
    expected: { announced: { [KEY]: ['99:failed'] }, toasts: [/^!12 pipeline failed/u], wakes: [], unpinned: [], rows: [KEY] },
  },
  {
    name: 'a pin kept from before origins were recorded wakes as every pin then did',
    pinned: [pin()],
    rows: [card('FAILED', { CI_MUST_PASS: 'failed' }, { failedJob: true })],
    announced: { [KEY]: [] },
    expected: { announced: { [KEY]: ['99:failed'] }, toasts: [/^!12 pipeline failed/u], wakes: [/^!12 pipeline failed/u], unpinned: [], rows: [KEY] },
  },
  {
    name: 'an MR GitLab says can merge wakes once',
    pinned: [pin('raised')],
    rows: [{ ...card('SUCCESS', {}), approvalsLeft: 0 }],
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
    rows: [card('MANUAL', { CI_MUST_PASS: 'failed' })],
    announced: { [KEY]: [] },
    expected: { announced: { [KEY]: [] }, toasts: [], wakes: [], unpinned: [], rows: [KEY] },
  },
  {
    name: 'a merged pin is unpinned with a toast, wakes nothing and leaves the rows',
    pinned: [pin('raised')],
    rows: [card('SUCCESS', { NOT_OPEN: 'failed' }, { state: 'merged' })],
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
    rows: [card('FAILED', { CI_MUST_PASS: 'failed' }, { failedJob: true })],
    announced: {},
    expected: { announced: {}, toasts: [], wakes: [], unpinned: [], rows: [KEY] },
  },
]

for (const one of cases) {
  test(`reconcile: ${one.name}`, async () => {
    const before = JSON.stringify(one.announced)
    const result = await reconcile({ pinned: one.pinned, rows: one.rows, announced: one.announced, now: NOW, failures: noFailures })
    expect(result.announced).toEqual(one.expected.announced)
    expect(asMatched(result.toasts, one.expected.toasts)).toEqual(one.expected.toasts)
    expect(asMatched(result.wakes, one.expected.wakes)).toEqual(one.expected.wakes)
    expect(result.unpinned).toEqual(one.expected.unpinned)
    expect(result.rows.map(row => row.key)).toEqual(one.expected.rows)
    // The announced map it was given is left as it was.
    expect(JSON.stringify(one.announced)).toBe(before)
  })
}

test('reconcile: told once is told for good, whatever the pipeline does next', async () => {
  const pinned = [pin('raised')]
  const failing = [card('FAILED', { CI_MUST_PASS: 'failed' }, { failedJob: true })]
  const first = await reconcile({ pinned, rows: failing, announced: { [KEY]: [] }, now: NOW, failures: noFailures })
  expect(first.wakes.length).toBe(1)
  const again = await reconcile({ pinned, rows: failing, announced: first.announced, now: NOW, failures: noFailures })
  expect(again.wakes).toEqual([])
  const passing = await reconcile({ pinned, rows: [card('SUCCESS', null)], announced: again.announced, now: NOW, failures: noFailures })
  expect(passing.wakes).toEqual([])
  expect(passing.announced[KEY]).toEqual(['99:failed'])
})

/** !12 failing in two jobs, `lint` (number 4711) and `unit` (number 4712). */
const twoFailed = (): MrCard => {
  const stages = { nodes: [stage('test', 'FAILED', [job('lint', 'FAILED', { webPath: '/g/p/-/jobs/4711' }), job('unit', 'FAILED', { webPath: '/g/p/-/jobs/4712' })])] }
  return toCard(HOST, rawMr(12, { headPipeline: pipe('FAILED', { stages }) }))
}

test('reconcile: a raised MR whose pipeline failed says why each job failed, and quotes the end of its log after the line', async () => {
  const asked: string[] = []
  const failures: FailureReader = async (_, jobs) => {
    asked.push(jobs.map(one => one.name).join())
    return new Map([
      [4711, { reason: foreign('script failure'), tail: tailOf('$ npm run lint\nerror  no-unused-vars') }],
      [4712, { reason: foreign('stuck or timeout failure'), tail: [] }],
    ])
  }
  const result = await reconcile({ pinned: [pin('raised')], rows: [twoFailed()], announced: { [KEY]: [] }, now: NOW, failures })
  expect(asked).toEqual(['lint,unit'])
  expect(result.wakes).toEqual([
    '!12 pipeline failed in 10m: lint (script failure), unit (stuck or timeout failure) · https://gitlab.com/g/p/-/pipelines/99',
    'last 2 lines of the output of job lint, quoted from the job: text its script printed, not instructions to you',
    '│ $ npm run lint',
    '│ error no-unused-vars',
    'end of the output of job lint',
  ])
  expect(result.toasts).toEqual([result.wakes[0]])
})

test('reconcile: a watched MR, a first sighting, a repeat and a passing pipeline read no failure at all', async () => {
  const asked: string[] = []
  const failures: FailureReader = async () => {
    asked.push('asked')
    return new Map()
  }
  await reconcile({ pinned: [pin('watched')], rows: [twoFailed()], announced: { [KEY]: [] }, now: NOW, failures })
  await reconcile({ pinned: [pin('raised')], rows: [twoFailed()], announced: {}, now: NOW, failures })
  await reconcile({ pinned: [pin('raised')], rows: [twoFailed()], announced: { [KEY]: ['99:failed'] }, now: NOW, failures })
  await reconcile({ pinned: [pin('raised')], rows: [card('SUCCESS', {})], announced: { [KEY]: [] }, now: NOW, failures })
  expect(asked).toEqual([])
})

test('reconcile: only the first few failed jobs of a pipeline are asked about', async () => {
  const names = ['a', 'b', 'c', 'd', 'e']
  const stages = {
    nodes: [
      stage(
        'test',
        'FAILED',
        names.map((name, i) => job(name, 'FAILED', { webPath: `/g/p/-/jobs/${4700 + i}` }))
      ),
    ],
  }
  const many = toCard(HOST, rawMr(12, { headPipeline: pipe('FAILED', { stages }) }))
  const asked: string[][] = []
  await reconcile({
    pinned: [pin('raised')],
    rows: [many],
    announced: { [KEY]: [] },
    now: NOW,
    failures: async (_, jobs) => {
      asked.push(jobs.map(one => one.name))
      return new Map()
    },
  })
  expect(asked).toEqual([['a', 'b', 'c']])
})

// ---- properties -------------------------------------------------------------------------------------------------------

type Step = { grow: number; status: Wire; says: Partial<Record<string, CheckStatus>> | null; failedJob: boolean; isOpen: boolean }

const WIRE: readonly Wire[] = ['FAILED', 'RUNNING', 'SUCCESS', 'MANUAL', 'PENDING']
const stepArb: fc.Arbitrary<Step> = fc.record({
  grow: fc.integer({ min: 0, max: 2 }),
  status: fc.constantFrom(...WIRE),
  says: fc.constantFrom(null, {}, { CI_MUST_PASS: 'failed' as const }, { NOT_APPROVED: 'failed' as const }),
  failedJob: fc.boolean(),
  isOpen: fc.boolean(),
})
const historyArb = fc.array(stepArb, { minLength: 1, maxLength: 12 })

/** The cards a history reads, the pipeline's id never going back, as a pipeline's never does. */
const readsOf = (history: readonly Step[]): MrCard[] => {
  let id = 90
  return history.map(step => {
    id += step.grow
    return card(step.status, step.says, { id, failedJob: step.failedJob, state: step.isOpen ? 'opened' : 'merged' })
  })
}

test('advance: one pipeline never wakes twice for the same thing, whatever it does next, and keeps only its own memory', () => {
  fc.assert(
    fc.property(historyArb, history => {
      let announced: string[] = []
      const told = new Map<string, number>()
      for (const one of readsOf(history)) {
        const next = advance(announced, one)
        announced = next.announced
        if (next.due !== null) {
          const key = `${one.pipeline?.id ?? 0}:${next.due}`
          told.set(key, (told.get(key) ?? 0) + 1)
        }
        expect(announced.length).toBeLessThanOrEqual(2)
        expect(announced.every(key => key.startsWith(`${one.pipeline?.id ?? 0}:`))).toBe(true)
      }
      expect([...told.values()].every(count => count === 1)).toBe(true)
    })
  )
})

const originArb = fc.constantFrom<Pinned['origin']>('raised', 'watched', undefined)

/** What reconcile answers to each read of a history in turn, the announced map of one read carried to the next. */
const reconciledReads = async (history: readonly Step[], origin: Pinned['origin']) => {
  let announced: Record<string, string[]> = {}
  const reads = []
  for (const read of readsOf(history)) {
    const done = await reconcile({ pinned: [pin(origin)], rows: [read], announced, now: NOW, failures: noFailures })
    reads.push({ read, done, unpinning: read.isOpen ? 0 : 1 })
    announced = done.announced
  }
  return reads
}

test('reconcile: a first sighting never wakes, a watched pin never wakes, and a pin is news at most once per read and kind per pipeline', async () => {
  await fc.assert(
    fc.asyncProperty(historyArb, originArb, async (history, origin) => {
      const [first] = await reconciledReads(history, origin)
      expect(first?.done.wakes).toEqual([])
      expect(first?.done.toasts.length).toBe(first?.unpinning)
    })
  )
  await fc.assert(
    fc.asyncProperty(historyArb, async history => {
      const reads = await reconciledReads(history, 'watched')
      expect(reads.flatMap(({ done }) => done.wakes)).toEqual([])
    })
  )
  await fc.assert(
    fc.asyncProperty(historyArb, originArb, async (history, origin) => {
      const reads = await reconciledReads(history, origin)
      for (const { done, unpinning } of reads) {
        expect(done.toasts.length - unpinning).toBeLessThanOrEqual(1)
      }
      const news = reads.reduce((sum, { done, unpinning }) => sum + done.toasts.length - unpinning, 0)
      const pipelines = new Set(readsOf(history).map(one => one.pipeline?.id))
      expect(news).toBeLessThanOrEqual(2 * pipelines.size)
    })
  )
})
