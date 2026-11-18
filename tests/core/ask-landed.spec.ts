import { expect, test } from 'vitest'

import { buildOf } from '../../hooks/ask-landed.ts'
import { Failure } from '../../hooks/failure.ts'
import type { LandedQuery } from '../../hooks/gitlab.generated.ts'

type Pipelines = NonNullable<NonNullable<NonNullable<LandedQuery['project']>['pipelines']>['nodes']>

const answered = (nodes: Pipelines, scheduled: string[] = []) =>
  buildOf('gitlab.com', 'https://gitlab.com/g/p/-/merge_requests/1', { data: { project: { pipelines: { nodes }, scheduled: { nodes: scheduled.map(id => ({ id })) } } } })

const gid = (id: number) => `gid://gitlab/Ci::Pipeline/${id}`

test("the build is the pipeline GitLab named, with its status as the pane names it and its page's address", () => {
  expect(answered([{ id: gid(9), status: 'FAILED', path: '/g/p/-/pipelines/9' }])).toEqual({ status: 'failed', url: 'https://gitlab.com/g/p/-/pipelines/9' })
  expect(answered([{ id: gid(9), status: 'RUNNING', path: null }])).toEqual({ status: 'running', url: 'https://gitlab.com/g/p/-/merge_requests/1' })
})

test('a pipeline a schedule started is not the build of a merge, however new: the newest of the others is', () => {
  const nightly = { id: gid(12), status: 'SUCCESS' as const, path: '/g/p/-/pipelines/12' }
  const merge = { id: gid(9), status: 'FAILED' as const, path: '/g/p/-/pipelines/9' }
  expect(answered([nightly, merge], [gid(12)])).toEqual({ status: 'failed', url: 'https://gitlab.com/g/p/-/pipelines/9' })
  // Several nights have run since; only schedules newer than it are passed over, and it is not one.
  expect(answered([{ ...nightly, id: gid(14) }, nightly, merge], [gid(14), gid(12)])).toEqual({ status: 'failed', url: 'https://gitlab.com/g/p/-/pipelines/9' })
  // The merge itself is the one a schedule ran, as a branch that only builds by night: GitLab names none for the merge.
  expect(answered([nightly], [gid(12)])).toBeNull()
  // Without the scheduled ones named, nothing is passed over.
  expect(answered([nightly, merge])).toEqual({ status: 'success', url: 'https://gitlab.com/g/p/-/pipelines/12' })
})

test('no pipeline on the commit is no build, and a project out of reach is the same', () => {
  expect(answered([])).toBeNull()
  expect(answered([null])).toBeNull()
  expect(buildOf('gitlab.com', '', { data: { project: null } })).toBeNull()
  expect(() => buildOf('gitlab.com', '', { errors: [{ message: 'timeout' }] })).toThrow(Failure)
})
