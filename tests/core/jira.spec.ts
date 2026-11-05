import { expect, test } from 'vitest'

import { readTickets, ticketQuery } from '../../hooks/jira.ts'

test('Jira is asked only about ticket keys, and its rows are read by key', async () => {
  expect(ticketQuery(['ABC-980', 'x) or 1=1', 'XY-2'])).toBe('key in (ABC-980, XY-2)')
  expect(readTickets([{ key: 'ABC-980', fields: { issuetype: { name: 'Task' }, status: { name: 'Backlog' }, summary: 'Stop builds' } }])).toEqual({
    'ABC-980': { type: 'Task', status: 'Backlog', summary: 'Stop builds' },
  })
})
