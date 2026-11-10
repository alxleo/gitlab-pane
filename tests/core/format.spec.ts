import { expect, test } from 'vitest'
import fc from 'fast-check'

import { bodyOf, lead, pipelineTime, ranFor, ranOf, shortTitle, ticketOf } from '../../hooks/format.ts'
import { cleanBody, toCard } from '../../hooks/gitlab.ts'
import { HOST, NOW, pipe, rawMr } from '../fixtures.ts'
import type { Job, Stage } from '../../types'

test('run time counts only while jobs run, not while a manual gate waits', async () => {
  const at = (minute: number) => new Date(NOW - (60 - minute) * 60_000).toISOString()
  const stageOf = (name: string, status: Stage['status'], jobs: Job[]): Stage => ({ name, status, jobs, ran: ranOf(jobs) })
  const stages: Stage[] = [
    stageOf('a', 'success', [{ name: 'x', status: 'success', allowFailure: false, url: '', startedAt: at(0), finishedAt: at(10) }]),
    stageOf('b', 'running', [
      { name: 'y', status: 'success', allowFailure: false, url: '', startedAt: at(5), finishedAt: at(15) },
      { name: 'z', status: 'running', allowFailure: false, url: '', startedAt: at(50), finishedAt: null },
    ]),
  ]
  expect(ranFor(stages, NOW)).toBe(25 * 60)
  // Merged into runs and starts, as a shared card keeps them, the jobs say the same.
  expect(stages.map(one => one.ran)).toEqual([
    { done: [[Date.parse(at(0)), Date.parse(at(10))]], running: [] },
    { done: [[Date.parse(at(5)), Date.parse(at(15))]], running: [Date.parse(at(50))] },
  ])
  expect(ranFor([], NOW)).toBe(0)
})

test('a running pipeline says how long it has run against how long it usually takes', async () => {
  const card = toCard(HOST, rawMr(1, { headPipeline: pipe('RUNNING') }))
  expect(pipelineTime(card, NOW)).toBe('20m so far')
  expect(pipelineTime(card, NOW, { low: 600, high: 900 })).toBe('20m · usually 10–15m')
  expect(pipelineTime(toCard(HOST, rawMr(2)), NOW, { low: 600, high: 900 })).toBe('10m')
})

test('an MR reads by its first paragraph, not its headings', async () => {
  expect(lead(cleanBody('## Summary\nDoes **thing** [12](https://x).\nMore.\n\n## Testing\n\nRan it.', HOST, 'g/p'))).toBe('Does thing 12. More.')
  expect(lead(cleanBody('Short', HOST, 'g/p'), 3)).toBe('Sh…')
  // Room 240 is 239 UTF-16 units and the ellipsis: a flag is four, so one that would pass 239 goes whole, not halved.
  expect(lead(cleanBody(`${'x'.repeat(236)}🇺🇸tail`, HOST, 'g/p'))).toBe(`${'x'.repeat(236)}…`)
})

test('a body is cut to its room between characters, dropping a flag that does not fit whole', () => {
  expect(bodyOf(cleanBody(`${'x'.repeat(96)}🇺🇸tail`, HOST, 'g/p'), 100)).toBe(`${'x'.repeat(96)}…`)
  expect(bodyOf(cleanBody(`${'x'.repeat(95)}🇺🇸tail`, HOST, 'g/p'), 100)).toBe(`${'x'.repeat(95)}🇺🇸…`)
})

test('titles keep the ticket apart and lose their type lead', async () => {
  expect(shortTitle('Draft: fix: [ABC-980] stop a warning')).toBe('stop a warning')
  expect(shortTitle('feat(web)!: a change')).toBe('a change')
  expect(shortTitle('ci: [NO-JIRA] post the summary')).toBe('post the summary')
  expect(ticketOf('ci: [ABC-965] pin node')).toBe('ABC-965')
})

const spans = fc.array(
  fc.tuple(fc.integer({ min: 0, max: 5_000_000 }), fc.integer({ min: 0, max: 5_000_000 })).map(([a, b]): [number, number] => [Math.min(a, b), Math.max(a, b)]),
  { maxLength: 6 }
)
const stagesArb = fc.array(
  fc.record({ done: spans, running: fc.array(fc.integer({ min: 0, max: 5_000_000 }), { maxLength: 3 }) }).map((ran): Stage => ({ name: 's', status: 'success', jobs: [], ran })),
  { maxLength: 4 }
)

test('the time jobs ran is never more than the wall time since the first started, and only grows as now does', () => {
  fc.assert(
    fc.property(stagesArb, fc.integer({ min: 5_000_000, max: 9_000_000 }), fc.integer({ min: 0, max: 4_000_000 }), (stages, now, later) => {
      const starts = stages.flatMap(each => [...each.ran.done.map(([start]) => start), ...each.ran.running])
      const ran = ranFor(stages, now)
      expect(ran).toBeGreaterThanOrEqual(0)
      expect(ran).toBeLessThanOrEqual(starts.length > 0 ? Math.round((now - Math.min(...starts)) / 1000) : 0)
      expect(ranFor(stages, now + later)).toBeGreaterThanOrEqual(ran)
    })
  )
})
