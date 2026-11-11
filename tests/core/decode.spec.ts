import { expect, test } from 'vitest'

import { dataOf, decodeGraphql, present, timeOf } from '../../hooks/decode.ts'
import { readSnapshot } from '../../hooks/inbox-snapshot.ts'
import { readTickets } from '../../hooks/jira.ts'

test('what the outside tools print is checked, not cast', async () => {
  expect(() => readTickets({ error: 'not signed in' })).toThrow('acli answered something other than a list')
  expect(readTickets([null, { key: 7 }, { key: 'ABC-1', fields: { summary: 4 } }])).toEqual({ 'ABC-1': { type: '', status: '', isDone: null, summary: '' } })
  expect(
    readSnapshot({
      at: 1,
      hosts: { h: { user: 'u', failure: { kind: 'nope', message: 'm' } } },
      mrs: [
        null,
        {
          host: 'h',
          path: 'g/p',
          iid: 1,
          signals: [
            { kind: 'merged', at: 5 },
            { kind: 'nope', at: 6 },
            { kind: 'comment', at: 'x' },
          ],
        },
        { host: 'h' },
      ],
    })
  ).toEqual({
    at: 1,
    hosts: { h: { user: 'u', failure: { kind: 'unknown', message: 'm' } } },
    mrs: [
      {
        host: 'h',
        path: 'g/p',
        iid: 1,
        title: '',
        url: '',
        author: '',
        authorName: '',
        isMine: false,
        state: '',
        isDraft: false,
        inQueue: false,
        isFollowed: false,
        cutoff: null,
        signals: [{ kind: 'merged', actor: '', at: 5, note: null, excerpt: '' }],
      },
    ],
    // One kept before merged MRs were listed has none, which reads as none merged.
    landed: [],
  })
  expect(readSnapshot({ at: 'soon', hosts: {}, mrs: [] })).toBeNull()
  expect(decodeGraphql({ data: { a: 1 }, errors: [{ message: 'late' }, 3] })).toEqual({ data: { a: 1 }, errors: [{ message: 'late' }] })
  expect(() => decodeGraphql([])).toThrow('GitLab answered something other than an object')
  expect(() => decodeGraphql({ data: 'x' })).toThrow('data that is not an object')
})

test('the nodes of a list are the ones GitLab could read, none for a list it did not send, and a time is a time or none', () => {
  expect(present([{ a: 1 }, null, { a: 2 }])).toEqual([{ a: 1 }, { a: 2 }])
  expect(present(null)).toEqual([])
  expect(present(undefined)).toEqual([])
  expect(timeOf('2026-10-23T15:00:00Z')).toBe(Date.parse('2026-10-23T15:00:00Z'))
  expect(timeOf(null)).toBeNull()
  expect(timeOf('yesterday')).toBeNull()
})

test('an answer with no data is the errors GitLab gave in its place, as a server failure, and without them a bad answer', () => {
  expect(() => dataOf({ errors: [{ message: 'timeout' }, { message: 'again' }] })).toThrow('timeout; again')
  expect(() => dataOf({ errors: [{ message: 'timeout' }] })).toThrow(expect.objectContaining({ kind: 'server' }))
  expect(() => dataOf({ data: null })).toThrow(expect.objectContaining({ kind: 'bad-answer', message: 'GitLab sent no data' }))
  expect(dataOf({ data: { a: 1 } })).toEqual({ a: 1 })
})
