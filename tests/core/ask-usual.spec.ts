import { expect, test } from 'vitest'

import { readUsual, usualQuery } from '../../hooks/ask-usual.ts'

test('the usual run time is the middle half of recent successful MR pipelines, per project', async () => {
  const { operation, query, variables } = usualQuery('g/p')
  expect(operation).toBe('Usual')
  expect(query).toContain('pipelines(source: "merge_request_event", status: SUCCESS, first: 20)')
  expect(query).not.toContain('g/p')
  expect(variables).toEqual({ path: 'g/p' })
  const durations = [540, 600, 660, 700, 720, 780, 840, 900, 1000, 1200]
  const pipelines = (list: number[]) => ({ data: { project: { pipelines: { nodes: list.map(duration => ({ duration })) } } } })
  expect(readUsual(pipelines(durations))).toEqual({ low: 660, high: 900 })
  expect(readUsual(pipelines([60]))).toBeNull()
})
