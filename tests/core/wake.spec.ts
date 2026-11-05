import { expect, test } from 'vitest'

import { advance } from '../../hooks/wake.ts'
import { gitlabSays } from '../fixtures.ts'
import type { CiStatus } from '../../types'

const view = (status: CiStatus, id = 7, failed: unknown[] = []) => ({ id, status, failed })

test('a pipeline wakes once for its first hard failure, running or finished, never again after a reload', async () => {
  const first = advance([], { pipeline: view('running', 7, ['test']), mergeStatus: gitlabSays({ CI_MUST_PASS: 'checking' }) })
  expect(first.due).toBe('failed')
  expect(advance(first.announced, { pipeline: view('running', 7, ['test']), mergeStatus: gitlabSays({ CI_MUST_PASS: 'checking' }) }).due).toBe(null)
  expect(advance(first.announced, { pipeline: view('failed', 7, ['test']), mergeStatus: gitlabSays({ CI_MUST_PASS: 'failed' }) }).due).toBe(null)
  // The next pipeline's failure is news again.
  expect(advance(first.announced, { pipeline: view('failed', 8, ['test']), mergeStatus: gitlabSays({ CI_MUST_PASS: 'failed' }) }).due).toBe('failed')
})

test('a passed pipeline alone never wakes; GitLab newly saying it can merge does, once per pipeline', async () => {
  const passed = advance([], { pipeline: view('success'), mergeStatus: gitlabSays({ NOT_APPROVED: 'failed' }) })
  expect(passed.due).toBe(null)
  expect(advance([], { pipeline: view('manual'), mergeStatus: gitlabSays({ CI_MUST_PASS: 'failed' }) }).due).toBe(null)

  const approved = advance(passed.announced, { pipeline: view('success'), mergeStatus: gitlabSays() })
  expect(approved.due).toBe('mergeable')
  expect(advance(approved.announced, { pipeline: view('success'), mergeStatus: gitlabSays() }).due).toBe(null)
})
