import { expect, test } from 'vitest'

import { readTickets, readTransition, searchArgs, ticketQuery, transitionArgs } from '../../hooks/jira.ts'

test('acli’s answer to a move says for each ticket whether it moved, though acli exits 0 either way', () => {
  const answer = (status: string, message: string) => ({ results: [{ status, message, id: 'ABC-1' }], totalCount: 1 })
  expect(readTransition(answer('SUCCESS', ''), 'ABC-1')).toEqual({ kind: 'moved' })
  expect(readTransition(answer('FAILURE', 'No allowed transitions found for given status'), 'ABC-1')).toEqual({ kind: 'no-step' })
  expect(readTransition(answer('FAILURE', 'Issue does not exist or you do not have permission to see it.'), 'ABC-1')).toEqual({
    kind: 'refused',
    message: 'Issue does not exist or you do not have permission to see it.',
  })
  expect(() => readTransition({ results: [] }, 'ABC-1')).toThrow('acli said nothing of ABC-1')
  expect(transitionArgs('ABC-1', 'In Review')).toEqual(['jira', 'workitem', 'transition', '--key', 'ABC-1', '--status', 'In Review', '--yes', '--json'])
  expect(searchArgs(['ABC-1', 'XY-2'])).toEqual([
    'jira',
    'workitem',
    'search',
    '--json',
    '--fields',
    'key,issuetype,status,summary',
    '--limit',
    '2',
    '--jql',
    'key in (ABC-1, XY-2)',
  ])
})

test('Jira is asked only about ticket keys, and its rows are read by key', async () => {
  expect(ticketQuery(['ABC-980', 'x) or 1=1', 'XY-2'])).toBe('key in (ABC-980, XY-2)')
  expect(readTickets([{ key: 'ABC-980', fields: { issuetype: { name: 'Task' }, status: { name: 'Backlog' }, summary: 'Stop builds' } }])).toEqual({
    'ABC-980': { type: 'Task', status: 'Backlog', isDone: null, summary: 'Stop builds' },
  })
})

test('a ticket is done when Jira counts its status as done, whatever the workflow calls it, and unknown when Jira does not say', async () => {
  const row = (key: string, category: string) => ({ key, fields: { issuetype: { name: 'Task' }, status: { name: 'Shipped', statusCategory: { key: category } }, summary: '' } })
  const read = readTickets([row('ABC-1', 'done'), row('ABC-2', 'indeterminate'), row('ABC-3', '')])
  expect([read['ABC-1']?.isDone, read['ABC-2']?.isDone, read['ABC-3']?.isDone]).toEqual([true, false, null])
})
