import { expect, test } from 'vitest'

import { toCard } from '../../hooks/gitlab.ts'
import { pageHead, personPage } from '../../hooks/page-lines.ts'
import { HOST, gitlabSays, job, note, pipe, rawMr, reviewer, stage, thread } from '../fixtures.ts'

const JIRA = { tickets: {}, browse: 'https://jira.example.com/browse/', failures: {} }

test('a ticket Jira cannot be read for says so on its page, instead of waiting for a read that will not come', () => {
  const card = toCard(HOST, rawMr(7))
  expect(pageHead(card, JIRA).ticket).toEqual({ text: '🎫 ABC-1: not read from Jira yet', href: 'https://jira.example.com/browse/ABC-1' })
  const gone = { jira: { message: 'acli is not installed', at: 0, kind: 'not-installed' as const } }
  expect(pageHead(card, { ...JIRA, failures: gone }).ticket?.text).toBe('🎫 ABC-1: Jira is not available here')
  const read = { 'ABC-1': { type: 'Task', status: 'In Progress', summary: 'Make the thing work' } }
  expect(pageHead(card, { ...JIRA, tickets: read }).ticket?.text).toBe('🎫 ABC-1 · Task · In Progress: Make the thing work')
  // With no Jira site set, a ticket has nowhere to lead.
  expect(pageHead(card, { ...JIRA, browse: '' }).ticket).toBeNull()
})

test("a page says what stands before a merge that GitLab's verdict leaves unsaid, and nothing it says itself", () => {
  const conflicted = { ...toCard(HOST, rawMr(8, { conflicts: true })), mergeStatus: gitlabSays({ CONFLICT: 'failed' }) }
  // The verdict says the conflict, so the page's head does not say it again; only the approval it also waits on.
  expect(pageHead(conflicted, JIRA).standing.map(line => line.text)).toEqual(['👤 Approvals 0/1'])
  const waiting = toCard(HOST, rawMr(9))
  expect(pageHead(waiting, JIRA).standing).toEqual([{ text: '👤 Approvals 0/1', tone: undefined, href: null }])
})

test('a manual job the pipeline waits on links to its page, where a person starts it', () => {
  const manual = pipe('MANUAL', { stages: { nodes: [stage('deploy', 'MANUAL', [job('deploy-prod', 'MANUAL')])] } })
  const card = toCard(HOST, rawMr(11, { headPipeline: manual }))
  const waiting = pageHead(card, JIRA).standing.find(line => line.text.includes('Waiting on'))
  expect(waiting?.text).toContain('deploy-prod')
  expect(waiting?.href).toMatch(/\/jobs\//)
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
