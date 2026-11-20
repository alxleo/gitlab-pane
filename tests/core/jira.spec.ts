import { expect, test } from 'vitest'

import { detailArgs, readTicketDetails, readTickets, readTransition, reviewedArgs, searchArgs, ticketChip, ticketQuery, transitionArgs } from '../../hooks/jira.ts'

test('a ticket read whole is its assignee and its description as plain lines, a block a line and list items marked', () => {
  expect(detailArgs('ABC-1')).toEqual(['jira', 'workitem', 'search', '--json', '--fields', 'key,description,assignee', '--limit', '1', '--jql', 'key in (ABC-1)'])
  const description = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Why' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Orders show ' },
          { type: 'text', text: 'their history.', marks: [{ type: 'strong' }] },
        ],
      },
      { type: 'paragraph', content: [] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Newest first' }] }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'one' }, { type: 'hardBreak' }, { type: 'text', text: 'two' }] },
    ],
  }
  const answer = [
    { key: 'ABC-1', fields: { description, assignee: { displayName: 'Ines Mendel' } } },
    { key: 'ABC-2', fields: { description: '  Plain text.  ', assignee: null } },
    { key: 'ABC-3', fields: { description: null } },
  ]
  expect(readTicketDetails(answer)).toEqual({
    'ABC-1': { assignee: 'Ines Mendel', description: 'Why\nOrders show their history.\n• Newest first\none\ntwo' },
    'ABC-2': { assignee: '', description: 'Plain text.' },
    'ABC-3': { assignee: '', description: '' },
  })
  // A long description is cut, whole characters only, and says so.
  const long = readTicketDetails([{ key: 'ABC-4', fields: { description: '👍'.repeat(700) } }])['ABC-4']?.description ?? ''
  expect(long).toBe(`${'👍'.repeat(600)}…`)
  expect(() => readTicketDetails({})).toThrow('acli answered something other than a list of tickets')
})

test('a ticket key is a link the pane answers while a Jira site is set, and its words alone while none is', () => {
  expect(ticketChip('https://jira.example.com/browse/', 'ABC-1')).toEqual({ key: 'ABC-1', text: 'ABC-1', link: '[🎫 ABC-1](https://jira.example.com/browse/ABC-1)' })
  expect(ticketChip('', 'ABC-1')).toEqual({ key: 'ABC-1', text: 'ABC-1', link: null })
})

test('Jira is asked which tickets have ever been in a review status, each name quoted as JQL reads it', () => {
  expect(reviewedArgs(['ABC-1', 'x) or 1=1'], ['In Review', 'Code "Review" \\ 2'])).toEqual([
    'jira',
    'workitem',
    'search',
    '--json',
    '--fields',
    'key,issuetype,status,summary',
    '--limit',
    '1',
    '--jql',
    'key in (ABC-1) AND status WAS IN ("In Review", "Code \\"Review\\" \\\\ 2")',
  ])
})

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
