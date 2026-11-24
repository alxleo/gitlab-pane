import { expect, mock, test } from 'claude-code/testing'

import { CHECK_TONE } from '../hooks/attention'
import { CONTROL, LINK, LINK_OPENS } from '../hooks/drawing'
import { REVIEW_MARK, REVIEW_STATE, SUGGESTED_MARK, SUGGESTED_SAYS, THREAD_MARK } from '../hooks/face-model'
import { CI_STATUSES } from '../hooks/gitlab-status'
import { VERB } from '../hooks/inbox-pane'
import { RULES } from '../hooks/inbox-rules'
import { FULL_EVERY_MS } from '../hooks/incremental'
import { RETRY_MS } from '../hooks/jira-moves'
import { RECHECK_MS } from '../hooks/landed'
import { EXPIRY_MS, RENEW_MS, TICK_MS } from '../hooks/lease'
import { FOLLOW_MS, FOLLOW_TRIES, MOVES } from '../hooks/next-move'
import { TICKETS_EVERY_MS, USUAL_EVERY_MS } from '../hooks/side-reads'
import { BACKOFF_MAX_MS, INBOX_EVERY_MS, WAKE_ONLY_EVERY_MS, pollEvery } from '../hooks/snapshot'
import { TONE_COLOURS, statusMark } from '../hooks/status'
import { DESIGN, README } from './docs.generated'

import type { CiStatus, PersonState } from '../types'

// The docs' tables as tools/docs.ts read them (`npm run docs -- check` keeps that file in step with the docs), held to the
// code here, where the engine-facing modules load. A test that fails names a table that says something the code does not.

/** Values in a fixed order, so two lists compare as sets. */
const sorted = (values: readonly string[]): string[] => values.toSorted()

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

test("the README's polling intervals are the ones the sessions poll at", () => {
  expect(README.runs).toEqual([
    // The leader's read of your MRs: while a pinned pipeline runs, otherwise, the first back-off and the most; the whole list.
    [pollEvery(0, true), pollEvery(0, false), pollEvery(1, false), BACKOFF_MAX_MS, FULL_EVERY_MS],
    // an MR's page, read whole once
    [],
    // a reply posted from it, once per press
    [],
    // a raised MR in a session that draws no pane
    [WAKE_ONLY_EVERY_MS],
    // the usual pipeline times
    [USUAL_EVERY_MS],
    // who GitLab suggests as a reviewer, once each time an MR changes; adding one, once per confirmed press
    [],
    [],
    // the Inbox
    [INBOX_EVERY_MS],
    // the build of each lately merged MR's commit, asked with the inbox while it runs, and again after the recheck period when it failed or waits on a person
    [INBOX_EVERY_MS, RECHECK_MS],
    // why a job failed: once, when it fails
    [],
    // Jira
    [TICKETS_EVERY_MS],
    // a ticket opened under its card, read whole again on opening once as old as the quarter-hourly read lets a ticket be
    [TICKETS_EVERY_MS],
    // Jira moves: after a read, and again a while after a failed ask
    [RETRY_MS],
    // avatars, once per face; glab's token, once per host
    [],
    [],
    // the lease: each session's turn, the leader's renewal, and how long an unrenewed lease holds
    [TICK_MS, RENEW_MS, EXPIRY_MS],
    // a merge or rebase you pressed, and the MR looked at until GitLab is done, for so long at most
    [FOLLOW_MS, FOLLOW_MS * FOLLOW_TRIES],
  ])
})

test("DESIGN's colour table is the palette, tone for tone", () => {
  expect(DESIGN.colours.length).toBe(Object.keys(TONE_COLOURS).length)
  expect(Object.fromEntries(DESIGN.colours)).toEqual(TONE_COLOURS)
})

test("DESIGN's pipeline marks are statusMark's, for every status GitLab sends and for no pipeline", () => {
  const statuses = Object.keys(CI_STATUSES).filter((status): status is CiStatus => status in CI_STATUSES)
  const fromCode = [...statuses.map(status => [status, statusMark(status)] as const), ['none', statusMark(undefined)] as const].map(
    ([status, mark]) => `${status} ${mark.glyph} ${mark.tone}`
  )
  const fromDocs = DESIGN.pipelineMarks.flatMap(([glyph, tone, named]) => (named.length > 0 ? named : ['none']).map(status => `${status} ${glyph} ${tone}`))
  expect(sorted(fromDocs)).toEqual(sorted(fromCode))
})

test("DESIGN's merge-check tones are CHECK_TONE's, every check once", () => {
  const fromCode = Object.entries(CHECK_TONE).map(([check, tone]) => `${check} ${tone}`)
  const fromDocs = DESIGN.checkTones.flatMap(([tone, checks]) => checks.map(check => `${check} ${tone}`))
  expect(sorted(fromDocs)).toEqual(sorted(fromCode))
})

test("DESIGN's badges, link marks, controls and inbox events are the code's, in its order", () => {
  const states = Object.keys(REVIEW_STATE).filter((state): state is PersonState => state in REVIEW_STATE)
  expect(DESIGN.badges).toEqual([
    ...states.map(state => [REVIEW_MARK[state].glyph, REVIEW_STATE[state]]),
    [THREAD_MARK.glyph, 'holds an open thread'],
    [SUGGESTED_MARK.glyph, SUGGESTED_SAYS],
  ])
  const links = Object.keys(LINK).filter((link): link is keyof typeof LINK => link in LINK)
  expect(DESIGN.links).toEqual(links.map(link => [LINK[link], LINK_OPENS[link]]))
  expect(DESIGN.controls).toEqual(Object.values(CONTROL).map(control => [control.mark, control.hint]))
  expect(DESIGN.inboxEvents).toEqual(Object.values(VERB).map(verb => [verb.glyph, verb.word]))
  expect(DESIGN.inboxTabs).toEqual(RULES.map(rule => [rule.title, rule.name]))
})

test("DESIGN's moves are the ones a card offers, in its order", () => {
  expect(DESIGN.moves).toEqual(Object.values(MOVES).map(move => move.label))
})
