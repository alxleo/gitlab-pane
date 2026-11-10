import { expect, test } from 'vitest'

import { toCard } from '../../hooks/gitlab.ts'
import { cardFacts } from '../../hooks/row-facts.ts'
import { HOST, note, rawMr, thread } from '../fixtures.ts'

const at = (body: string, author: string, createdAt: string, resolved = false) => ({ resolvable: true, resolved, notes: { nodes: [note(body, author, { createdAt })] } })
const saidOn = (discussions: ReturnType<typeof at>[], over: Parameters<typeof rawMr>[1] = {}) =>
  cardFacts(toCard(HOST, rawMr(1, { discussions: { nodes: discussions }, ...over })), {}).said

test('a card quotes the latest open thread a person wrote, by their first name', () => {
  const said = saidOn([at('Rename this.', 'maya.lee', '2026-10-23T10:00:00Z'), at('**Can** the token come from the provider?', 'bob.baker', '2026-10-23T12:00:00Z')])
  expect(said).toEqual({ username: 'bob.baker', who: 'Bob', words: 'Can the token come from the provider?' })
})

test("a card quotes no bot, no resolved thread, and never the author's own words", () => {
  expect(saidOn([thread('### What the bot wrote', 'project_1_bot_ab', false, true, true)])).toBeNull()
  expect(saidOn([at('Fixed now.', 'bob.baker', '2026-10-23T12:00:00Z', true)])).toBeNull()
  expect(saidOn([at('A note to myself.', 'alex', '2026-10-23T12:00:00Z')])).toBeNull()
})

test('a reply is never the quote: only a thread a person started, though they replied later', () => {
  const asked = {
    resolvable: true,
    resolved: false,
    notes: { nodes: [note('Author asks.', 'alex', { createdAt: '2026-10-23T10:00:00Z' }), note('ok', 'bob.baker', { createdAt: '2026-10-23T13:00:00Z' })] },
  }
  expect(saidOn([asked])).toBeNull()
  expect(saidOn([at('Can the token come from the provider?', 'bob.baker', '2026-10-23T11:00:00Z'), asked])?.words).toBe('Can the token come from the provider?')
})

test('a quote is the words of a comment: a link without its address, names whole, and no code', () => {
  expect(saidOn([at('See [the docs](https://gitlab.com/g/p/-/wikis/x) on `fn_name`', 'bob.baker', '2026-10-23T12:00:00Z')])?.words).toBe('See the docs on fn_name')
  expect(saidOn([at('```suggestion:-0+0\nconst token = vault.get(card)\n```', 'bob.baker', '2026-10-23T12:00:00Z')])?.words).toBe('code or a picture, no words')
  expect(saidOn([at('```suggestion:-0+0\nx()\n```\nThis reads better.', 'bob.baker', '2026-10-23T12:00:00Z')])?.words).toBe('This reads better.')
  expect(saidOn([at('![shot](/uploads/a.png)', 'bob.baker', '2026-10-23T12:00:00Z')])?.words).toBe('code or a picture, no words')
})

test('an approval does not quiet the open thread its reviewer left', () => {
  const approved = { approvalsLeft: 0, approvedBy: { nodes: [{ username: 'mel', name: 'Mel', bot: false, avatarUrl: null }] } }
  expect(saidOn([at('Nit: a shorter name reads better.', 'mel', '2026-10-23T12:00:00Z')], approved)?.words).toBe('Nit: a shorter name reads better.')
})

test('a long comment is cut short on its card', () => {
  const words = saidOn([at('word '.repeat(80), 'bob.baker', '2026-10-23T12:00:00Z')])?.words ?? ''
  expect(words.length).toBeLessThanOrEqual(120)
  expect(words.endsWith('…')).toBe(true)
})
