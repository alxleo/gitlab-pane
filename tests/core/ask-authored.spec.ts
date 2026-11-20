import { expect, test } from 'vitest'

import { jobsWanted, lostIn, needsJobs } from '../../hooks/ask-authored.ts'
import type { RawPipeline } from '../../hooks/mr-fragments.ts'
import { HOST, commented, listed, pipe, project, rawMr, stage } from '../fixtures.ts'

test('an MR whose row draws from its jobs is asked for one by one: a pipeline not passed, with a warning, a stage not passed, or no duration', () => {
  const passed = pipe('SUCCESS')
  const needs = (pipeline: RawPipeline | null) => needsJobs(listed({ headPipeline: pipeline }).headPipeline)
  expect(needs(null)).toBe(false)
  expect(needs(passed)).toBe(false)
  expect(needs({ ...passed, stages: { nodes: [stage('build', 'SUCCESS', []), stage('deploy', 'SKIPPED', [])] } })).toBe(false)
  for (const status of ['FAILED', 'RUNNING', 'MANUAL', 'PENDING', 'CREATED', 'CANCELED'] as const) {
    expect(needs(pipe(status))).toBe(true)
  }
  // An allowed failure leaves the pipeline passed and draws ⚠; a passed pipeline still owing a manual stage draws its time.
  expect(needs({ ...passed, warnings: true })).toBe(true)
  expect(needs({ ...passed, stages: { nodes: [stage('build', 'SUCCESS', []), stage('release', 'MANUAL', [])] } })).toBe(true)
  expect(needs({ ...passed, duration: null })).toBe(true)
  const mrs = [rawMr(1), rawMr(2, { headPipeline: pipe('FAILED') }), rawMr(3, { headPipeline: null }), rawMr(4, { headPipeline: pipe('RUNNING'), project: project('g/q') })]
  expect(jobsWanted(HOST, { data: { currentUser: { authoredMergeRequests: { nodes: [...mrs.map(mr => listed(commented(mr))), null] } } } })).toEqual([
    { url: 'https://gitlab.com/g/p/-/merge_requests/2', host: HOST, path: 'g/p', iid: 2 },
    { url: 'https://gitlab.com/g/p/-/merge_requests/4', host: HOST, path: 'g/q', iid: 4 },
  ])
})

test('the authored MRs GitLab sent back null are counted as lost, and the ones it sent are not', () => {
  const sent = (iid: number) => listed(commented(rawMr(iid)))
  const answer = (nodes: Array<ReturnType<typeof sent> | null>) => ({ data: { currentUser: { authoredMergeRequests: { nodes } } } })
  expect(lostIn(answer([sent(1), null, sent(2), null, sent(3)]))).toBe(2)
  expect(lostIn(answer([sent(1)]))).toBe(0)
  expect(lostIn({ data: null })).toBe(0)
})
