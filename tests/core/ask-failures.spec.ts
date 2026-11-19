import { expect, test } from 'vitest'

import { failureReasons } from '../../hooks/ask-failures.ts'

const job = (id: number | null, failureMessage: string | null) => ({
  webPath: id === null ? null : `/g/p/-/jobs/${id}`,
  allowFailure: false,
  failureMessage,
})

test("each failed job's reason is kept by the job's number; a job with no path, no message or an empty one has none", () => {
  const answer = {
    data: { project: { mergeRequest: { headPipeline: { jobs: { nodes: [job(7, 'script failure'), job(8, null), job(9, ''), job(null, 'lost'), null] } } } } },
  }
  expect([...failureReasons(answer)]).toEqual([[7, 'script failure']])
  expect([...failureReasons({ data: { project: null } })]).toEqual([])
  expect([...failureReasons({ errors: [{ message: 'undefined field' }] })]).toEqual([])
})
