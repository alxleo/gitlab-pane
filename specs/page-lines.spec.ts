import { expect, test } from 'vitest'

import { toCard } from '../hooks/mr-card'
import { PANELS_MOST, pageHead, personPage, personUnder, ticketUnder, toggledUnders } from '../hooks/page-lines'
import { HOST, gitlabSays, job, note, pipe, rawMr, reviewer, stage, thread } from '../tests/fixtures'

const JIRA = { tickets: {}, browse: 'https://jira.example.com/browse/', failures: {} }

test('a ticket Jira cannot be read for says so on its page, instead of waiting for a read that will not come', () => {
  const card = toCard(HOST, rawMr(7))
  expect(pageHead(card, JIRA).ticket).toEqual({ text: '🎫 ABC-1: not read from Jira yet', href: 'https://jira.example.com/browse/ABC-1' })
  const gone = { jira: { message: 'acli is not installed', at: 0, kind: 'not-installed' as const } }
  expect(pageHead(card, { ...JIRA, failures: gone }).ticket?.text).toBe('🎫 ABC-1: Jira is not available here')
  const read = { 'ABC-1': { type: 'Task', status: 'In Progress', isDone: false, summary: 'Make the thing work' } }
  expect(pageHead(card, { ...JIRA, tickets: read }).ticket?.text).toBe('🎫 ABC-1 · Task · In Progress: Make the thing work')
  // What Jira says is drawn without the control characters a drawing refuses.
  const hostile = { 'ABC-1': { type: 'Ta\u0007sk', status: 'In\nProgress', isDone: false, summary: 'Make\u001b[31m it\r' } }
  expect(pageHead(card, { ...JIRA, tickets: hostile }).ticket?.text).toBe('🎫 ABC-1 · Ta sk · In Progress: Make [31m it')
  // With no Jira site set, a ticket has nowhere to lead.
  expect(pageHead(card, { ...JIRA, browse: '' }).ticket).toBeNull()
})

test("a page explains GitLab's verdict, saying it once: who can approve when it needs an approval", () => {
  const waiting = { ...toCard(HOST, rawMr(9)), approvers: ['Farhad', 'Max'], mergeStatus: gitlabSays({ NOT_APPROVED: 'failed' }) }
  // "needs 1 approval" gives way to the line that says it with who can give it.
  expect(pageHead(waiting, JIRA).verdict).toBeNull()
  expect(pageHead(waiting, JIRA).standing).toEqual([{ text: '👤 needs 1 approval: Farhad, Max', tone: undefined, href: null }])
  const conflicted = { ...toCard(HOST, rawMr(8, { conflicts: true })), mergeStatus: gitlabSays({ CONFLICT: 'failed' }) }
  expect(pageHead(conflicted, JIRA).verdict).toBeNull()
  expect(pageHead(conflicted, JIRA).standing.map(line => line.text)).toEqual(['✗ conflict', '👤 needs 1 approval'])
  // A verdict the page has no line for stays in its head.
  const mergeable = { ...toCard(HOST, rawMr(10, { approvalsLeft: 0 })), mergeStatus: gitlabSays() }
  expect(pageHead(mergeable, JIRA).verdict).toEqual({ words: '✓ mergeable', tone: 'success', bold: true })
  // Unresolved threads are said by the page's own list of them, not by a line in its head.
  const threaded = { ...toCard(HOST, rawMr(11, { discussions: { nodes: [thread('Rename this.', 'bob')] } })), mergeStatus: gitlabSays({ DISCUSSIONS_NOT_RESOLVED: 'failed' }) }
  expect(
    pageHead(threaded, JIRA)
      .standing.map(line => line.text)
      .some(text => text.includes('thread'))
  ).toBe(false)
  expect(pageHead(threaded, JIRA).verdict?.words).toBe('1 open thread')
})

test('a manual job the pipeline waits on links to its page, where a person starts it', () => {
  const manual = pipe('MANUAL', { stages: { nodes: [stage('deploy', 'MANUAL', [job('deploy-prod', 'MANUAL')])] } })
  const card = toCard(HOST, rawMr(11, { headPipeline: manual }))
  const waiting = pageHead(card, JIRA).standing.find(line => line.text.includes('Waiting on'))
  expect(waiting?.text).toContain('deploy-prod')
  expect(waiting?.href).toMatch(/\/jobs\//u)
})

test('a page opened on one person heads their comments with where they stand, and says which are still open', () => {
  const settled = { resolvable: true, resolved: true, notes: { nodes: [note('Thanks, fixed.', 'tim', { createdAt: '2026-10-23T15:00:00Z' })] } }
  const card = toCard(HOST, rawMr(10, { reviewers: { nodes: [reviewer('tim', 'REQUESTED_CHANGES')] }, discussions: { nodes: [thread('Please look again.', 'tim'), settled] } }))
  const page = personPage(card, 'tim')
  expect(page?.heading).toBe('Tim · requested changes · 1 open thread · 2 comments')
  // The open thread leads, though the settled comment is newer.
  expect(page?.notes.map(each => each.label)).toEqual(['open thread', 'comment'])
  expect(personPage(card, 'nobody')).toBeNull()
})

test('a person opened under a card leads with their newest comment once the MR is read whole, and the way on to all of them', () => {
  const settled = { resolvable: true, resolved: true, notes: { nodes: [note('Thanks, fixed.', 'tim', { createdAt: '2026-10-23T15:00:00Z' })] } }
  const card = toCard(HOST, rawMr(10, { reviewers: { nodes: [reviewer('tim', 'REQUESTED_CHANGES')] }, discussions: { nodes: [thread('Please look again.', 'tim'), settled] } }))
  expect(personUnder(card, 'tim', true)).toEqual({
    kind: 'person',
    heading: 'Tim · requested changes · 1 open thread · 2 comments',
    latest: { label: 'comment', text: 'Thanks, fixed.' },
    more: 'all 2 comments ›',
  })
  // The shared card keeps one note a person, their open thread before their newest, so until the MR is read whole (or when
  // that read fails) none is quoted as their newest: the heading and the way on stand alone.
  expect(personUnder(card, 'tim', false)).toEqual({ kind: 'person', heading: 'Tim · requested changes · 1 open thread · 2 comments', latest: null, more: 'all 2 comments ›' })
  // One comment, which the excerpt may cut short, is read whole a press further; someone who wrote nothing has no way on.
  const once = toCard(HOST, rawMr(11, { reviewers: { nodes: [reviewer('tim', 'APPROVED')] }, discussions: { nodes: [thread('Please look again.', 'tim')] } }))
  expect(personUnder(once, 'tim', true)).toMatchObject({ latest: { label: 'open thread' }, more: 'read it whole ›' })
  expect(personUnder(once, 'tim', false)).toMatchObject({ latest: null, more: 'read it whole ›' })
  const quiet = toCard(HOST, rawMr(12, { reviewers: { nodes: [reviewer('tim', 'APPROVED')] } }))
  expect(personUnder(quiet, 'tim', true)).toMatchObject({ latest: null, more: null })
  // Someone who has left the MR since their panel opened still has one, saying so, which `✕` closes.
  expect(personUnder(card, 'nobody', true)).toEqual({ kind: 'person', heading: 'nobody · no longer on this MR', latest: null, more: null })
})

test('a ticket opened under a card says what the quarter-hourly read knows at once, and what reading it whole adds once in', () => {
  const ticket = { type: 'Story', status: 'In Review', isDone: false, summary: 'Order history' }
  const read = { isFound: true, at: 0 }
  expect(ticketUnder('ABC-1', ticket, undefined)).toEqual({ kind: 'ticket', heading: 'ABC-1 · Story · In Review', lines: ['Order history'], isReading: true })
  expect(ticketUnder('ABC-1', ticket, { assignee: 'Ines Mendel', description: '', ...read })).toEqual({
    kind: 'ticket',
    heading: 'ABC-1 · Story · In Review',
    lines: ['Order history', 'Assigned to Ines Mendel', 'No description.'],
    isReading: false,
  })
  // A ticket the read has not reached is its key alone, and nobody assigned says nothing.
  expect(ticketUnder('ABC-2', undefined, { assignee: '', description: 'Do it.', ...read })).toEqual({
    kind: 'ticket',
    heading: 'ABC-2',
    lines: ['Do it.'],
    isReading: false,
  })
  // Never "reading" for good: a ticket Jira answered without says so, and a Jira that cannot be read points at /gitlab.
  expect(ticketUnder('ABC-3', undefined, { assignee: '', description: '', isFound: false, at: 0 })).toEqual({
    kind: 'ticket',
    heading: 'ABC-3',
    lines: ['Jira says nothing of this ticket to you.'],
    isReading: false,
  })
  // A read of this ticket that failed says so for this ticket alone, and /gitlab says why.
  const failed = { assignee: '', description: '', isFound: false, at: 0, failed: 'timeout' as const }
  expect(ticketUnder('ABC-3', undefined, failed)).toEqual({ kind: 'ticket', heading: 'ABC-3', lines: ['Jira could not be read; /gitlab says why.'], isReading: false })
  // With Jira's tool not installed, /gitlab says nothing of it (it is optional), so the ticket says so itself, as a page does.
  expect(ticketUnder('ABC-3', undefined, { ...failed, failed: 'not-installed' })).toMatchObject({ lines: ['Jira is not available here.'], isReading: false })
  // What Jira says is drawn without the control characters a drawing refuses, which could blank the whole list.
  const hostile = { type: 'Ta\u0007sk', status: 'In\nReview', isDone: false, summary: 'Fix\u001b[31m it\r' }
  expect(ticketUnder('ABC-4', hostile, undefined)).toMatchObject({ heading: 'ABC-4 · Ta sk · In Review', lines: ['Fix [31m it'] })
})

test('a press opens a panel under its card in place of the card’s last, closes it when it is that, and keeps the most open, the first opened going', () => {
  const tim = { kind: 'person' as const, id: 'tim' }
  const ticket = { kind: 'ticket' as const, id: 'ABC-1' }
  expect(toggledUnders({}, 'a!1', tim)).toEqual({ 'a!1': tim })
  // Another card's stays open; the same card's other thing takes its place; the same thing again closes it.
  expect(toggledUnders({ 'a!1': tim }, 'a!2', ticket)).toEqual({ 'a!1': tim, 'a!2': ticket })
  expect(toggledUnders({ 'a!1': tim }, 'a!1', ticket)).toEqual({ 'a!1': ticket })
  expect(toggledUnders({ 'a!1': tim, 'a!2': ticket }, 'a!1', tim)).toEqual({ 'a!2': ticket })
  // Each is a whole MR read and kept, so past the most the first opened closes.
  const full = Object.fromEntries(Array.from({ length: PANELS_MOST }, (_, at) => [`a!${at}`, tim]))
  const more = toggledUnders(full, 'a!99', ticket)
  expect(Object.keys(more)).toHaveLength(PANELS_MOST)
  expect(more['a!0']).toBeUndefined()
  expect(more['a!99']).toEqual(ticket)
})
