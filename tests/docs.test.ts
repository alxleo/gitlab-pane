import { expect, mock, test } from 'claude-code/testing'

import { CHECK_TONE } from '../hooks/attention'
import { LINK } from '../hooks/drawing'
import { REVIEW_MARK, REVIEW_STATE } from '../hooks/face-model'
import { CI_STATUSES } from '../hooks/gitlab-status'
import { VERB } from '../hooks/inbox-pane'
import { RULES } from '../hooks/inbox-rules'
import { BACKOFF_FROM_MS, BACKOFF_MOST_MS, MOVING_EVERY_MS, SETTLED_EVERY_MS, TICKETS_EVERY_MS, USUAL_EVERY_MS } from '../hooks/poll'
import { INBOX_TICK_MS } from '../hooks/register'
import { STAGE_COLOURS, statusMark } from '../hooks/status'
import { DESIGN, README } from './docs.generated'

import type { CiStatus, PersonState } from '../types'

// The docs' tables as tools/docs.ts read them (`npm run docs -- check` keeps that file in step with the docs), held to the
// code here, where the engine-facing modules load. A test that fails names a table that says something the code does not.

/** Values in a fixed order, so two lists compare as sets. */
const sorted = (values: readonly string[]): string[] => [...values].sort()

test('the README names the slash commands and the tool the plugin registers, and no others', async ($, on) => {
  mock.clock(on, { now: 0 })
  const commands: string[] = []
  const tools: string[] = []
  on('command.register', (_, e) => {
    commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('tool.register', (_, e) => {
    tools.push(e.name)
    return { value: { tool: e.name } }
  })
  on('http.fetch', () => ({ deny: 'offline' }))
  on('process.run', () => ({ deny: 'no processes' }))
  on('session.surfaces', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(sorted(README.commands)).toEqual(sorted(commands))
  expect(sorted(README.tools)).toEqual(sorted(tools))
})

test('the README\'s polling intervals are the ones the pane polls at', () => {
  expect(README.runs).toEqual([
    // GraphQL for your MRs: while a pinned pipeline runs, otherwise, and backing off from the first failed read to the most.
    [MOVING_EVERY_MS, SETTLED_EVERY_MS, BACKOFF_FROM_MS * 2, BACKOFF_MOST_MS],
    // the usual pipeline times
    [USUAL_EVERY_MS],
    // the Inbox
    [INBOX_TICK_MS],
    // why a job failed: once, when it fails
    [],
    // Jira
    [TICKETS_EVERY_MS],
    // avatars, once per face; glab's token, once per host
    [],
    [],
  ])
})

test('DESIGN\'s colour table is the palette, tone for tone', () => {
  expect(DESIGN.colours.length).toBe(Object.keys(STAGE_COLOURS).length)
  expect(Object.fromEntries(DESIGN.colours)).toEqual(STAGE_COLOURS)
})

test('DESIGN\'s pipeline marks are statusMark\'s, for every status GitLab sends and for no pipeline', () => {
  const statuses = Object.keys(CI_STATUSES).filter((status): status is CiStatus => status in CI_STATUSES)
  const fromCode = [...statuses.map(status => [status, statusMark(status)] as const), ['none', statusMark(undefined)] as const].map(([status, mark]) => `${status} ${mark.glyph} ${mark.tone}`)
  const fromDocs = DESIGN.pipelineMarks.flatMap(([glyph, tone, named]) => (named.length > 0 ? named : ['none']).map(status => `${status} ${glyph} ${tone}`))
  expect(sorted(fromDocs)).toEqual(sorted(fromCode))
})

test('DESIGN\'s merge-check tones are CHECK_TONE\'s, every check once', () => {
  const fromCode = Object.entries(CHECK_TONE).map(([check, tone]) => `${check} ${tone}`)
  const fromDocs = DESIGN.checkTones.flatMap(([tone, checks]) => checks.map(check => `${check} ${tone}`))
  expect(sorted(fromDocs)).toEqual(sorted(fromCode))
})

test('DESIGN\'s badges, link marks and inbox events are the code\'s, in its order', () => {
  const states = Object.keys(REVIEW_STATE).filter((state): state is PersonState => state in REVIEW_STATE)
  expect(DESIGN.badges).toEqual(states.flatMap(state => (REVIEW_MARK[state] !== null ? [[REVIEW_MARK[state].glyph, REVIEW_STATE[state]]] : [])))
  expect(DESIGN.links).toEqual(Object.values(LINK))
  expect(DESIGN.inboxEvents).toEqual(Object.values(VERB).map(verb => [verb.glyph, verb.word]))
  expect(DESIGN.inboxTabs).toEqual(RULES.map(rule => [rule.title, rule.name]))
})
