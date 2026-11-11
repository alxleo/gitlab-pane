import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { shortHash as hashOf } from '../hooks/identity'
import { readSnapshot } from '../hooks/inbox-snapshot'
import { seenKey, seenKeyOf } from '../hooks/inbox-rules'
import { RECHECK_MS } from '../hooks/landed'
import { NOW, mergeStatuses, pipe, rawMr } from './fixtures'
import type { Mr } from './fixtures'
import { ALICE, ME, brief, busyWorld, comment, emptyWorld, fields, inboxAnswers, merged, open, queued, system, todo } from './inbox_fixtures'
import type { Fields, Note, Person, World } from './inbox_fixtures'
import { fakeGitLab, fakeSession, ran } from './gitlab_host'

const PANE = {
  plugin: 'gitlab-pane',
  component: 'Pane',
  requestId: 'gitlab-pane',
  props: {
    title: 'GitLab',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

/** The band above the prompt, with no survey in it. */
const BAND = {
  plugin: 'gitlab-pane',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 12, bodyColumns: 80, scroll: { offset: 0, bodyRows: 11 }, view: {} },
} as const

const REMOTE = 'git@gitlab.com:g/p.git'
const TOKEN = 'tok-1'

/** The host with `world` behind it, and `mine` as your open MRs on Mine; every call is in `requests`. The token comes from the environment. */
function engine(on: On, world: World, hasToken = true, remote: string | null = REMOTE, held?: () => Promise<void>, mine: Mr[] = []) {
  // The pane is drawn by a session that holds the plugin's store, where the marks are and nowhere else.
  const { store, panes, surfaces, unreadable } = fakeSession(on)
  const gitlab = fakeGitLab(
    on,
    {
      'gitlab.com': {
        accepts: TOKEN,
        mergeRequests: (path, iid) => (`${path}!${iid}` in world.squashed ? { squash_commit_sha: world.squashed[`${path}!${iid}`] ?? null } : undefined),
        answers: {
          ...inboxAnswers(world),
          Authored: () => ({ data: { currentUser: { authoredMergeRequests: { nodes: mine } } } }),
          MergeStatus: () => mergeStatuses(mine),
          Pinned: ({ path, iid }) => ({ data: { project: { mergeRequest: mine.find(mr => mr.iid === iid && mr.project.fullPath === path) ?? null } } }),
        },
      },
    },
    { env: hasToken ? { GITLAB_TOKEN: TOKEN } : {}, isDown: () => world.isDown, ...(held !== undefined ? { held } : {}) }
  )
  on('process.run', (_, e) => gitlab.glab(e.argv) ?? ran('', 1, `nothing answers ${e.argv.join(' ')}`))
  on('session.repo', () => ({ value: remote === null ? null : { root: '/r', remote, internal: false, name: null } }))
  on('command.register', () => ({ value: { command: 'gitlab' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__gitlab-pane__watch_mr' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // The engine's own band, which the mod passes the band on to when it has nothing to say: empty, as with no survey.
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: [] }))
  return { ...gitlab, store, panes, surfaces, unreadable, marks: () => [...store].filter(([key]) => key.startsWith('seen:')) }
}

/** The inbox's first read waits this long after the session starts. */
const FIRST_SYNC_MS = 2_000

/** The title a card draws, a Button whose press opens and closes the card. */
const titleOf = async (ui: { find: (query: { type: string; key: string }) => Promise<{ props?: Record<string, unknown> } | undefined> }, iid: number) =>
  (await ui.find({ type: 'Button', key: `inbox-open-${hashOf(`gitlab.com/g/p!${iid}`)}` }))?.props?.label

const typed = (args: string) => ({
  command: 'mrs',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 100 },
})

test('the inbox reads GitLab once the pane shows it, applies each rule, and opens one to its MRs', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const gitlab = engine(on, busyWorld())

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await clock.advance(FIRST_SYNC_MS)
    // Three small documents on the host, read with the token from the environment; nothing else is run for the inbox.
    expect(gitlab.requests).toEqual(expect.arrayContaining(['gitlab.com InboxTodos', 'gitlab.com InboxQueue', 'gitlab.com InboxAuthored']))
    expect(gitlab.tokens.filter(token => token.endsWith(` ${TOKEN}`)).length).toBe(gitlab.tokens.length)
    // The inbox has a tab of its own, which names how many MRs have news; its body draws only there.
    expect(JSON.stringify(await ui.drawn())).toContain('"Inbox · 2 new"')
    expect(await ui.find({ type: 'Text', text: 'synced just now' })).toBeUndefined()
    await ui.press({ key: 'tab-inbox' })
    expect(await ui.find({ type: 'Text', text: 'synced just now' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: "Nothing else in: Mentions, Build failed, Can't merge" })).toBeDefined()
    expect(await titleOf(ui, 1)).toBeUndefined()
    // Counts are MRs with news, not the events in them; each rule is a tab.
    expect(JSON.stringify(await ui.drawn())).toContain('"On my MRs · 1 new"')
    expect(JSON.stringify(await ui.drawn())).toContain('"Review requested · 1 new"')

    await ui.press({ key: 'inbox-rule-on-my-mrs' })
    // Dark text with a disclosure mark, not a link: a link-blue title read as a way out to GitLab.
    expect(await titleOf(ui, 1)).toBe('▸ thing 1')
    expect(await ui.find({ type: 'Text', text: '3 new' })).toBeDefined()
    // A count per kind instead of a line of handles, and the ref without the repo, which follows it. Your own MR leaves your name out.
    expect(await ui.find({ type: 'Text', text: 'p · 1 approved · 2 commented' })).toBeDefined()
    expect(JSON.stringify(await ui.drawn())).toContain('"!1"')
    // The newest event says who did what; the rest wait behind a press on the title.
    expect(await ui.find({ type: 'Text', text: '✓ bob approved' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '“please rename”' })).toBeUndefined()
    const opens = { key: `inbox-open-${hashOf('gitlab.com/g/p!1')}` }
    await ui.press(opens)
    expect(await titleOf(ui, 1)).toBe('▾ thing 1')
    expect(await ui.find({ type: 'Text', text: '💬 carol commented' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '“please rename”' })).toBeDefined()
    // The title closes it again, and so does ▴ less at the card's foot.
    await ui.press(opens)
    expect(await ui.find({ type: 'Text', text: '“please rename”' })).toBeUndefined()
    await ui.press(opens)
    await ui.press({ key: `inbox-less-${hashOf('gitlab.com/g/p!1')}` })
    expect(await ui.find({ type: 'Text', text: '“please rename”' })).toBeUndefined()
    // s marks the open tab seen while the pane holds the keyboard; the terminal, where that is proven, says so on the button.
    const allSeen = await ui.find({ type: 'Button', key: 'inbox-seen-rule-on-my-mrs' })
    expect(allSeen?.props['hotkey']).toBe('s')
    expect(allSeen?.props['label']).toBe(surface === 'terminal' ? '✓ mark all seen (s)' : '✓ mark all seen')
    await ui.press({ key: 'inbox-rule-on-my-mrs' })
    await ui.press({ key: 'tab-mine' })
    await ui.unmount()
  }
})

test('a review requested of you shows until you approve it, and a push since you looked brings it back', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world = emptyWorld()
  world.queue = [queued(2), { ...queued(3), approvedBy: { nodes: [{ username: 'me' }] } }]
  engine(on, world)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  await ui.press({ key: 'tab-inbox' })
  await ui.press({ key: 'inbox-rule-review-requested' })
  expect(await titleOf(ui, 2)).toBe('▸ thing 2')
  expect(await titleOf(ui, 3)).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '? Alice asked for a review' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'p · alice · 1 asked for a review' })).toBeDefined()

  // Marked seen, it stays in the queue, grey; the author's push then makes it new again.
  await ui.press({ key: `inbox-seen-${hashOf('gitlab.com/g/p!2')}` })
  expect(await titleOf(ui, 2)).toBe('▸ thing 2')
  expect(await ui.find({ type: 'Text', text: /new$/u })).toBeUndefined()
  world.queue = [queued(2, [system(21, 'alice', -5, 'commit', 'added 2 commits')])]
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ type: 'Text', text: '1 new' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '↑ Alice pushed' })).toBeDefined()
  await ui.unmount()
})

test('what you were mentioned in, whose build failed and what cannot merge each have a rule, from your to-dos', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world = emptyWorld()
  world.todos = [
    todo('mentioned', fields(4), 'dave', 30, '@me can you look at this'),
    todo('directly_addressed', fields(5), 'erin', 20, '@me ping'),
    todo('build_failed', fields(6, ME), 'me', 10, 'pipeline failed'),
    todo('unmergeable', fields(7, ME), 'me', 8, 'conflicts'),
    todo('assigned', fields(8), 'frank', 5, 'assigned to you'),
  ]
  engine(on, world)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  await ui.press({ key: 'tab-inbox' })
  const tabs = JSON.stringify(await ui.drawn())
  expect(tabs).toContain('"Mentions · 2 new"')
  expect(tabs).toContain('"Build failed · 1 new"')
  expect(tabs).toContain('"Can\'t merge · 1 new"')
  expect(await ui.find({ type: 'Text', text: 'Nothing else in: Review requested, On my MRs' })).toBeDefined()
  await ui.press({ key: 'inbox-rule-mentions' })
  expect(await ui.find({ type: 'Text', text: '@ dave mentioned you' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '“@me can you look at this”' })).toBeDefined()
  await ui.press({ key: 'inbox-rule-build-failed' })
  // An event nobody did reads without a name.
  expect(await ui.find({ type: 'Text', text: '✗ pipeline failed' })).toBeDefined()
  await ui.press({ key: 'inbox-rule-cant-merge' })
  expect(await ui.find({ type: 'Text', text: "⚠ can't merge" })).toBeDefined()
  await ui.unmount()
})

test('✓ marks one MR seen on this machine only, and GitLab is not asked again', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const gitlab = engine(on, busyWorld())

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  await ui.press({ key: 'tab-inbox' })
  await ui.press({ key: 'inbox-rule-on-my-mrs' })
  expect(await titleOf(ui, 1)).toBeDefined()
  const before = gitlab.requests.length
  await ui.press({ key: `inbox-seen-${hashOf('gitlab.com/g/p!1')}` })
  expect(gitlab.requests.length).toBe(before)
  expect(await titleOf(ui, 1)).toBeUndefined()
  // One small value in the plugin's store, not a field on GitLab.
  expect(gitlab.marks().map(([, at]) => at)).toEqual([NOW + FIRST_SYNC_MS])
  expect(gitlab.requests.every(request => request.startsWith('gitlab.com '))).toBe(true)
  await ui.unmount()
})

test('the band above the prompt says the inbox news while the pane is not shown, opens the Inbox tab, and clears once all is seen', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world = { ...emptyWorld(), opened: [open(1, [comment(12, 'carol.jones', 180, 'please rename')])] }
  const gitlab = engine(on, world, true, REMOTE, undefined, [rawMr(5, { headPipeline: pipe('RUNNING') })])
  const bandOf = async (ui: { find: (query: { type: string; key: string }) => Promise<{ props?: Record<string, unknown> } | undefined> }) =>
    (await ui.find({ type: 'Button', key: 'inbox-band' }))?.props?.label

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  expect(JSON.stringify(await pane.drawn())).toContain('"Inbox · 1 new"')
  // The pane's tab says it already, so the band leaves the place to anything else that draws there.
  const shown = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await bandOf(shown)).toBeUndefined()
  // An MR read whole puts its way back where the tabs were, so the band says the count meanwhile; its press leaves the
  // page for the Inbox tab, which says it again.
  await pane.press({ key: (await pane.findAll({ type: 'Button' })).find(button => button.key?.startsWith('open-5-') === true)?.key ?? '' })
  expect(await pane.find({ type: 'Button', key: 'back-top' })).toBeDefined()
  expect(await bandOf(shown)).toBe('Inbox · 1 new')
  await shown.press({ key: 'inbox-band' })
  expect(await pane.find({ type: 'Button', key: 'back-top' })).toBeUndefined()
  expect((await pane.find({ type: 'Button', key: 'tab-inbox' }))?.props.variant).toBe('primary')
  expect(await bandOf(shown)).toBeUndefined()
  await shown.unmount()
  await pane.unmount()

  // Closed, the pane says nothing; within a tick the band does, on each surface it draws on.
  gitlab.panes.delete('gitlab-pane')
  await clock.advance(FIRST_SYNC_MS)
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await bandOf(band)).toBe('Inbox · 1 new')
    await band.unmount()
  }
  // A survey holds the band, and the mod gives way to it.
  const survey = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true }, surface: 'desktop' })
  expect(await bandOf(survey)).toBeUndefined()
  await survey.unmount()

  // Pressing it opens the pane on the Inbox tab, whose tab now says the count, so the band goes.
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'inbox-band' })
  expect(gitlab.panes.has('gitlab-pane')).toBe(true)
  expect(await bandOf(band)).toBeUndefined()
  const opened = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await opened.find({ type: 'Button', key: 'tab-inbox' }))?.props.variant).toBe('primary')

  // Everything marked seen, there is no news, and the band stays away with the pane closed again.
  await opened.press({ key: 'inbox-rule-on-my-mrs' })
  await opened.press({ key: `inbox-seen-${hashOf('gitlab.com/g/p!1')}` })
  await opened.unmount()
  gitlab.panes.delete('gitlab-pane')
  await clock.advance(FIRST_SYNC_MS)
  expect(await bandOf(band)).toBeUndefined()
  await band.unmount()
})

test('with no pane drawn anywhere, a session with a window still reads the inbox each minute, alone, so the band keeps up', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world = { ...emptyWorld(), opened: [open(1, [comment(12, 'carol.jones', 180, 'please rename')])] }
  const gitlab = engine(on, world)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  gitlab.panes.clear()
  await clock.advance(FIRST_SYNC_MS)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await band.find({ type: 'Button', key: 'inbox-band' }))?.props.label).toBe('Inbox · 1 new')
  const before = gitlab.requests.length
  // A review asked of you a minute later reaches the band with no pane open: the inbox is read, and nothing else is.
  world.queue = [queued(2)]
  await clock.advance(60_000)
  expect((await band.find({ type: 'Button', key: 'inbox-band' }))?.props.label).toBe('Inbox · 2 new')
  // A minute more is one read more: the pace holds with no pane open.
  await clock.advance(60_000)
  const since = gitlab.requests.slice(before)
  expect(since).toEqual(expect.arrayContaining(['gitlab.com InboxTodos', 'gitlab.com InboxQueue', 'gitlab.com InboxAuthored']))
  expect(since.every(request => request.startsWith('gitlab.com Inbox'))).toBe(true)
  expect(since.filter(request => request === 'gitlab.com InboxQueue')).toHaveLength(2)
  await band.unmount()
})

test('with no pane drawn, a session reads no inbox while another reads it, nor while the store cannot say who does, nor with no window for a band', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const gitlab = engine(on, busyWorld())

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  gitlab.panes.clear()
  // Another session holds the inbox's own lease, renewing it: this one shows that session's read and asks GitLab nothing.
  // Its read has one MR with news where this session's own, made while its pane was open, had two.
  const renew = () => gitlab.store.set('inbox-lease', { owner: 'session-b', renewedAt: clock.now() })
  renew()
  await clock.advance(FIRST_SYNC_MS)
  const before = gitlab.requests.length
  gitlab.store.set('inbox-snapshot', sharedInbox(clock.now()))
  for (let minute = 0; minute < 3; minute += 1) {
    renew()
    await clock.advance(30_000)
  }
  expect(gitlab.requests.slice(before)).toEqual([])
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await band.find({ type: 'Button', key: 'inbox-band' }))?.props.label).toBe('Inbox · 1 new')
  await band.unmount()
  // That lease lapses, but the store cannot be read to say so: every session with a window would elect itself, so none reads.
  gitlab.unreadable.add('inbox-lease')
  await clock.advance(120_000)
  expect(gitlab.requests.slice(before)).toEqual([])
  gitlab.unreadable.clear()
  // A session without a window reads nothing either: it has no band to say it in.
  gitlab.surfaces.length = 0
  await clock.advance(120_000)
  expect(gitlab.requests.slice(before)).toEqual([])
})

test('the mark outlives the pane, and an MR that has left the inbox loses its mark', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world = busyWorld()
  const gitlab = engine(on, world)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  await ui.press({ key: 'tab-inbox' })
  await ui.press({ key: 'inbox-rule-on-my-mrs' })
  await ui.press({ key: `inbox-seen-${hashOf('gitlab.com/g/p!1')}` })
  // Read again, the MR is still there and still seen; the same notes do not come back as news.
  await ui.press({ key: 'refresh' })
  expect(await titleOf(ui, 1)).toBeUndefined()
  expect(gitlab.marks().length).toBe(1)
  // A full review queue pushes it past the MRs the snapshot keeps; GitLab still lists it, so its mark stays.
  world.queue = Array.from({ length: 50 }, (_, i) => queued(200 + i))
  await ui.press({ key: 'refresh' })
  expect(gitlab.marks().length).toBe(1)
  // Once GitLab no longer lists it, the next read drops its mark.
  world.queue = []
  world.opened = []
  await ui.press({ key: 'refresh' })
  expect(gitlab.marks().length).toBe(0)
  await ui.unmount()
})

/** An inbox snapshot as a leader shares it, read at `at`: one MR of the user's with a comment. */
const sharedInbox = (at: number) => ({
  at,
  hosts: { 'gitlab.com': { user: 'me', failure: null } },
  mrs: [
    {
      host: 'gitlab.com',
      path: 'g/p',
      iid: 1,
      title: 'thing 1',
      url: 'https://gitlab.com/g/p/-/merge_requests/1',
      author: 'me',
      authorName: 'Me',
      isMine: true,
      state: 'opened',
      isDraft: false,
      inQueue: false,
      isFollowed: false,
      cutoff: null,
      signals: [{ kind: 'comment', actor: 'carol', at: at - 60_000, note: null, excerpt: 'please rename' }],
    },
  ],
})

test('a session that leads shows the inbox the store keeps while its own slow read is out, and marks nothing', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let answer = () => {}
  const answered = new Promise<void>(resolve => {
    answer = resolve
  })
  const kit = engine(on, busyWorld(), true, REMOTE, () => answered)
  kit.store.set('inbox-snapshot', sharedInbox(NOW - 3 * 3_600_000))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(FIRST_SYNC_MS)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-inbox' })
  await ui.press({ key: 'inbox-rule-on-my-mrs' })
  expect(await titleOf(ui, 1)).toBe('▸ thing 1')
  expect((await ui.find({ type: 'Text', text: /^synced /u }))?.text).toBe('synced 3h ago')
  expect((await ui.find({ type: 'Button', key: 'refresh' }))?.props.dimColor).toBe(true)
  expect(kit.marks()).toEqual([])

  answer()
  await clock.settle()
  expect((await ui.find({ type: 'Text', text: /synced/u }))?.text).toBe('synced just now')
  await ui.unmount()
})

test('a session that only draws shows the inbox the leader shared, asks GitLab for nothing, and keeps the ✓ made there', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const kit = engine(on, busyWorld())
  kit.store.set('lease', { owner: 'other', renewedAt: NOW })
  kit.store.set('inbox-snapshot', sharedInbox(NOW))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(10_000)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-inbox' })
  await ui.press({ key: 'inbox-rule-on-my-mrs' })
  expect(await titleOf(ui, 1)).toBe('▸ thing 1')
  // The ✓ is kept in the store by this session; the leader's next read of it, and the mark, are not lost to each other.
  await ui.press({ key: `inbox-seen-${hashOf('gitlab.com/g/p!1')}` })
  expect(kit.marks()).toHaveLength(1)
  expect(await titleOf(ui, 1)).toBeUndefined()
  expect(kit.requests).toEqual([])
  await ui.unmount()
})

// ---- the MRs you merged lately --------------------------------------------------------------------------------------------

const MERGE_COMMIT = 'a'.repeat(40)
const SQUASH_COMMIT = 'b'.repeat(40)
const HEAD_SQUASHED = 'c'.repeat(40)
const HEAD_PLAIN = 'd'.repeat(40)

/**
 * Three of your MRs merged lately, one by each method. !11 went in with a merge commit, onto a release branch; !12 was
 * fast-forwarded after a squash, so the commit on the branch is the squash commit, which GraphQL does not name; !13 was
 * fast-forwarded as it was. Each has the build GitLab ran on its commit on its target branch, and a pipeline of the same commit
 * on the branch it came from, which is newer and not the build on the target.
 */
const mergedWorld = (): World => ({
  ...emptyWorld(),
  merged: [
    merged(11, 30, { mergeCommitSha: MERGE_COMMIT, diffHeadSha: 'e'.repeat(40) }, { targetBranch: 'release/2.1' }),
    merged(12, 90, { diffHeadSha: HEAD_SQUASHED }),
    merged(13, 150, { diffHeadSha: HEAD_PLAIN }),
  ],
  squashed: { 'g/p!12': SQUASH_COMMIT, 'g/p!13': null },
  pipelines: [
    { sha: MERGE_COMMIT, ref: 'release/2.1', id: 101, status: 'SUCCESS' },
    { sha: SQUASH_COMMIT, ref: 'main', id: 102, status: 'FAILED' },
    { sha: HEAD_PLAIN, ref: 'main', id: 103, status: 'RUNNING' },
    { sha: HEAD_PLAIN, ref: 'feat/plain', id: 300, status: 'FAILED' },
    { sha: HEAD_SQUASHED, ref: 'feat/squashed', id: 301, status: 'FAILED' },
  ],
})

/** The fold's words, or none while Mine draws no such line. */
const foldOf = async (ui: { find: (query: { type: string; key: string }) => Promise<{ props?: Record<string, unknown> } | undefined> }) =>
  (await ui.find({ type: 'Button', key: 'merged' }))?.props?.label

test('the MRs you merged lately fold at the foot of Mine, a failed build on the branch they landed on is said on the fold, and nothing wakes Claude or toasts', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const woken: string[] = []
  const toasts: string[] = []
  on('prompt.submit', (_, e) => {
    woken.push(e.text)
    return { text: e.text }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const gitlab = engine(on, mergedWorld())

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  // Three merged, one build failed: only that is said while folded; the running and passed builds are quiet.
  expect(await foldOf(ui)).toBe('▸ 3 merged · 1 build ✗')
  expect(await ui.find({ type: 'Link', text: /!11/u })).toBeUndefined()
  // Beside the fold sits no inbox news: the merges are no one's activity, and the inbox's tabs say nothing of them.
  expect(JSON.stringify(await ui.drawn())).not.toContain('"Inbox ·')

  await ui.press({ key: 'merged' })
  expect(await foldOf(ui)).toBe('▾ 3 merged')
  // A link's text in the drawing is its address and then its words.
  const links = (await ui.findAll({ type: 'Link' })).map(link => [link.text.replace(String(link.props.href), ''), link.props.href])
  expect(links).toEqual([
    ['🔀 !11 thing 11', 'https://gitlab.com/g/p/-/merge_requests/11'],
    ['🚦 release/2.1', 'https://gitlab.com/g/p/-/pipelines/101'],
    ['🔀 !12 thing 12', 'https://gitlab.com/g/p/-/merge_requests/12'],
    ['🚦 main', 'https://gitlab.com/g/p/-/pipelines/102'],
    ['🔀 !13 thing 13', 'https://gitlab.com/g/p/-/merge_requests/13'],
    ['🚦 main', 'https://gitlab.com/g/p/-/pipelines/103'],
  ])
  // Each build's mark is its status in its colour; how long ago it merged is said once, and who merged it is not (the inbox says that).
  const marks = (await ui.findAll({ type: 'Text' })).filter(text => ['✓', '✗', '●'].includes(text.text)).map(text => [text.text, text.props.color])
  expect(marks).toEqual([
    ['✓', 'success'],
    ['✗', 'error'],
    ['●', 'suggestion'],
  ])
  expect((await ui.findAll({ type: 'Text' })).map(text => text.text)).toEqual(expect.arrayContaining(['30m', '1h', '2h']))
  // The squash commit is asked of REST once per MR that had no merge commit, and not at all for the merge commit's MR.
  expect(gitlab.requests.filter(request => request.includes('merge-request'))).toEqual(['gitlab.com merge-request g/p!12', 'gitlab.com merge-request g/p!13'])
  expect(woken).toEqual([])
  expect(toasts).toEqual([])
  await ui.press({ key: 'merged' })
  expect(await foldOf(ui)).toBe('▸ 3 merged · 1 build ✗')
  await ui.unmount()
})

test('a build that passed is asked for once and kept, a running one at every read, a failed one only after the recheck period, and a squash commit is read once', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world = mergedWorld()
  const gitlab = engine(on, world)
  const asked = (what: string) => gitlab.requests.filter(request => request.endsWith(what)).length

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  expect(asked(' Landed')).toBe(3)
  // The next minute asks for the one that was still running, and for nothing else: the others ended, and !12's squash commit is known.
  await clock.advance(60_000)
  expect(asked(' Landed')).toBe(4)
  expect(asked('g/p!12')).toBe(1)
  expect(asked('g/p!13')).toBe(1)
  // It ends, and the fold says so on the next read, as it said the failed one.
  world.pipelines = world.pipelines.map(each => (each.id === 103 ? { ...each, status: 'FAILED' } : each))
  await clock.advance(60_000)
  expect(await foldOf(ui)).toBe('▸ 3 merged · 2 builds ✗')
  // Nothing is asked for the next five minutes: the passed build is final, and the two that failed wait to be asked again, as a retry may turn them green.
  await clock.advance(5 * 60_000)
  expect(asked(' Landed')).toBe(5)
  // Someone retries !12's pipeline and it passes. Past the recheck period both failed builds are asked for once, and the fold has one failure left.
  world.pipelines = world.pipelines.map(each => (each.id === 102 ? { ...each, status: 'SUCCESS' } : each))
  await clock.advance(6 * 60_000)
  expect(asked(' Landed')).toBe(7)
  expect(await foldOf(ui)).toBe('▸ 3 merged · 1 build ✗')
  await ui.unmount()
})

test('a build that failed and was retried to success loses its mark on the fold once the recheck period has passed, and not before', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world: World = { ...emptyWorld(), merged: [merged(21, 1, { mergeCommitSha: MERGE_COMMIT })], pipelines: [{ sha: MERGE_COMMIT, ref: 'main', id: 700, status: 'FAILED' }] }
  const gitlab = engine(on, world)
  const asked = () => gitlab.requests.filter(request => request.endsWith(' Landed')).length

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  expect(await foldOf(ui)).toBe('▸ 1 merged · 1 build ✗')
  world.pipelines = [{ sha: MERGE_COMMIT, ref: 'main', id: 700, status: 'SUCCESS' }]
  // Five minutes on, the failed build has not been asked for again, so the fold is as it was.
  await clock.advance(5 * 60_000)
  expect(asked()).toBe(1)
  expect(await foldOf(ui)).toBe('▸ 1 merged · 1 build ✗')
  await clock.advance(RECHECK_MS)
  expect(asked()).toBe(2)
  expect(await foldOf(ui)).toBe('▸ 1 merged')
  // It passed: final, and asked for no more.
  await clock.advance(20 * 60_000)
  expect(asked()).toBe(2)
  await ui.unmount()
})

test('↻ asks again for a failed build at once, and for a manual one, and not for one that passed', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world: World = {
    ...emptyWorld(),
    merged: [merged(21, 30, { mergeCommitSha: MERGE_COMMIT }), merged(22, 31, { mergeCommitSha: SQUASH_COMMIT }), merged(23, 32, { mergeCommitSha: HEAD_PLAIN })],
    pipelines: [
      { sha: MERGE_COMMIT, ref: 'main', id: 701, status: 'FAILED' },
      { sha: SQUASH_COMMIT, ref: 'main', id: 702, status: 'MANUAL' },
      { sha: HEAD_PLAIN, ref: 'main', id: 703, status: 'SUCCESS' },
    ],
  }
  const gitlab = engine(on, world)
  const asked = () => gitlab.requests.filter(request => request.endsWith(' Landed')).length

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  expect(asked()).toBe(3)
  expect(await foldOf(ui)).toBe('▸ 3 merged · 1 build ✗')
  world.pipelines = world.pipelines.map(each => (each.id === 701 ? { ...each, status: 'SUCCESS' } : each))
  await ui.press({ key: 'refresh' })
  expect(asked()).toBe(5)
  expect(await foldOf(ui)).toBe('▸ 3 merged')
  await ui.unmount()
})

test('a read that asks nothing of GitLab about the merged MRs writes nothing to the store', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world = { ...emptyWorld(), merged: [merged(21, 30, { mergeCommitSha: MERGE_COMMIT }), merged(22, 31, { mergeCommitSha: SQUASH_COMMIT })] }
  world.pipelines = [
    { sha: MERGE_COMMIT, ref: 'main', id: 701, status: 'FAILED' },
    { sha: SQUASH_COMMIT, ref: 'main', id: 702, status: 'MANUAL' },
  ]
  const kit = engine(on, world)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  // A write puts a new object in the store: the same one is no write.
  const shared = kit.store.get('inbox-snapshot')
  const asked = kit.requests.length
  // Four more minutes of reads: the inbox is read each minute, the two builds wait for the recheck period, and the snapshot is as it was.
  await clock.advance(4 * 60_000)
  expect(kit.requests.length).toBeGreaterThan(asked)
  expect(kit.requests.filter(request => request.endsWith(' Landed'))).toHaveLength(2)
  expect(kit.store.get('inbox-snapshot')).toBe(shared)
  await ui.unmount()
})

test('a merge whose pipeline GitLab has not started yet is looked for again, and one whose branch runs none is given up on once it is past doubt', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world = { ...emptyWorld(), merged: [merged(21, 1, { mergeCommitSha: MERGE_COMMIT })] }
  const gitlab = engine(on, world)
  const asked = () => gitlab.requests.filter(request => request.endsWith(' Landed')).length

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  await ui.press({ key: 'merged' })
  // No pipeline yet: the mark for none, and no link to a pipeline.
  expect((await ui.findAll({ type: 'Text' })).some(text => text.text === '○')).toBe(true)
  expect(await ui.find({ type: 'Link', text: /🚦/u })).toBeUndefined()
  await clock.advance(60_000)
  expect(asked()).toBe(2)
  // The pipeline appears, running: the mark is blue and links to it.
  world.pipelines = [{ sha: MERGE_COMMIT, ref: 'main', id: 500, status: 'RUNNING' }]
  await clock.advance(60_000)
  expect((await ui.find({ type: 'Link', text: '🚦 main' }))?.props.href).toBe('https://gitlab.com/g/p/-/pipelines/500')
  await ui.unmount()
})

test('a merge on a branch that runs no pipeline is not asked for after ten minutes, and its row says so', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world = { ...emptyWorld(), merged: [merged(21, 1, { mergeCommitSha: MERGE_COMMIT })] }
  const gitlab = engine(on, world)
  const asked = () => gitlab.requests.filter(request => request.endsWith(' Landed')).length

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  await clock.advance(11 * 60_000)
  const before = asked()
  // The look after ten minutes found none; nothing more is asked of this MR, now or later.
  await clock.advance(30 * 60_000)
  expect(asked()).toBe(before)
  await ui.press({ key: 'merged' })
  expect((await ui.find({ type: 'Text', text: 'no pipeline' }))?.text).toBe('no pipeline')
  await ui.unmount()
})

test('a merge whose squash commit GitLab will not say draws no build, says so, and is asked for again, while the rest of the inbox reads on', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world = { ...emptyWorld(), opened: [open(1, [comment(12, 'carol.jones', 180, 'please rename')])], merged: [merged(31, 20, { diffHeadSha: HEAD_PLAIN })] }
  const gitlab = engine(on, world)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  // The REST entity is not found: the commit is not guessed from the head, and no build is read for one.
  await ui.press({ key: 'merged' })
  expect((await ui.find({ type: 'Text', text: 'build unknown' }))?.text).toBe('build unknown')
  expect(gitlab.requests.some(request => request.endsWith(' Landed'))).toBe(false)
  expect(JSON.stringify(await ui.drawn())).toContain('"Inbox · 1 new"')
  // What went wrong is no failure of the inbox, which is whole: its tab says nothing, and `/gitlab` names the MR.
  await ui.press({ key: 'tab-inbox' })
  expect(await ui.find({ type: 'Text', text: /sync failed/u })).toBeUndefined()
  await ui.press({ key: 'tab-mine' })
  // A minute later it is not asked again: a project that refuses REST is not asked every minute.
  const askedRest = () => gitlab.requests.filter(request => request.includes('merge-request')).length
  expect(askedRest()).toBe(1)
  await clock.advance(60_000)
  expect(askedRest()).toBe(1)
  // GitLab will say there is no squash commit when it is asked again. `/gitlab` is a request for a fresh read, and says what stood before it.
  world.squashed = { 'g/p!31': null }
  world.pipelines = [{ sha: HEAD_PLAIN, ref: 'main', id: 600, status: 'SUCCESS' }]
  const gitlabSays = async () => (await $.command.run({ ...typed(''), command: 'gitlab' })).text
  // The read that asked nothing did not clear it: the commit is still unknown, and `/gitlab` names the MR.
  expect(await gitlabSays()).toContain('merged: g/p!31: GitLab answered HTTP 404')
  await clock.advance(1_000)
  expect(askedRest()).toBe(2)
  expect((await ui.find({ type: 'Link', text: '🚦 main' }))?.props.href).toBe('https://gitlab.com/g/p/-/pipelines/600')
  expect(await gitlabSays()).not.toContain('merged:')
  await ui.unmount()
})

test('a squash commit GitLab would not say is asked for again once the recheck period has passed, with no press of ↻', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world = { ...emptyWorld(), merged: [merged(31, 20, { diffHeadSha: HEAD_PLAIN })] }
  const gitlab = engine(on, world)
  const askedRest = () => gitlab.requests.filter(request => request.includes('merge-request')).length

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  expect(askedRest()).toBe(1)
  world.squashed = { 'g/p!31': null }
  world.pipelines = [{ sha: HEAD_PLAIN, ref: 'main', id: 600, status: 'SUCCESS' }]
  await clock.advance(RECHECK_MS - FIRST_SYNC_MS - 60_000)
  expect(askedRest()).toBe(1)
  await clock.advance(2 * 60_000)
  expect(askedRest()).toBe(2)
  await ui.press({ key: 'merged' })
  expect((await ui.find({ type: 'Link', text: '🚦 main' }))?.props.href).toBe('https://gitlab.com/g/p/-/pipelines/600')
  await ui.unmount()
})

test('a read that fails keeps the merged MRs and builds it last showed, and the next that works asks only for what is not settled', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world = mergedWorld()
  const gitlab = engine(on, world)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  expect(await foldOf(ui)).toBe('▸ 3 merged · 1 build ✗')
  world.isDown = true
  await ui.press({ key: 'refresh' })
  expect(await foldOf(ui)).toBe('▸ 3 merged · 1 build ✗')
  world.isDown = false
  const asked = gitlab.requests.filter(request => request.endsWith(' Landed')).length
  await ui.press({ key: 'refresh' })
  // Back up, ↻ asks for the builds that could still change, the running one and the failed one: what passed, and the squash commit, were kept through the failure.
  expect(gitlab.requests.filter(request => request.endsWith(' Landed')).length).toBe(asked + 2)
  expect(gitlab.requests.filter(request => request.includes('merge-request')).length).toBe(2)
  await ui.unmount()
})

test('a session that only draws shows the merged MRs the leader shared and asks GitLab for nothing', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const kit = engine(on, emptyWorld())
  kit.store.set('lease', { owner: 'other', renewedAt: NOW })
  const entry = (iid: number, minutes: number, status: 'success' | 'failed') => ({
    host: 'gitlab.com',
    path: 'g/p',
    iid,
    title: `thing ${iid}`,
    url: `https://gitlab.com/g/p/-/merge_requests/${iid}`,
    mergedAt: NOW - minutes * 60_000,
    targetBranch: 'main',
    sha: MERGE_COMMIT,
    build: { status, url: `https://gitlab.com/g/p/-/pipelines/${iid}` },
    checkedAt: NOW,
  })
  kit.store.set('inbox-snapshot', { ...sharedInbox(NOW), landed: [entry(1, 10, 'success'), entry(2, 20, 'failed')] })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(10_000)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await foldOf(ui)).toBe('▸ 2 merged · 1 build ✗')
  expect(kit.requests).toEqual([])
  await ui.unmount()
})

test('a snapshot an older leader shared, with no merged MRs in it, draws no fold', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const kit = engine(on, emptyWorld())
  kit.store.set('lease', { owner: 'other', renewedAt: NOW })
  kit.store.set('inbox-snapshot', sharedInbox(NOW))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(10_000)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await foldOf(ui)).toBeUndefined()
  await ui.unmount()
})

test('the leader keeps the merged MRs and their builds in the snapshot it shares, so a session that draws has them', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const kit = engine(on, mergedWorld())

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  const shared = readSnapshot(kit.store.get('inbox-snapshot'))
  expect(shared?.landed.map(each => [each.iid, each.sha, each.build?.status])).toEqual([
    [11, MERGE_COMMIT, 'success'],
    [12, SQUASH_COMMIT, 'failed'],
    [13, HEAD_PLAIN, 'running'],
  ])
  await ui.unmount()
})

test('the leader prunes the marks of MRs that left the inbox without losing one made in another session', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const kit = engine(on, busyWorld())

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  const shared = readSnapshot(kit.store.get('inbox-snapshot'))
  const mine = shared?.mrs.find(mr => mr.iid === 1)
  if (shared === null || mine === undefined) {
    throw new Error('the leader shared no inbox')
  }
  // Another session marked the MR seen; a mark for an MR GitLab no longer lists is left from before.
  kit.store.set(seenKeyOf(shared, mine) ?? '', NOW)
  kit.store.set(seenKey('gitlab.com', 'me', 'g/gone', 9), NOW)
  await ui.press({ key: 'tab-inbox' })
  await ui.press({ key: 'refresh' })
  expect(kit.marks().map(([key]) => key)).toEqual([seenKeyOf(shared, mine)])
  // Seen, the MR is no longer news, so the rule that listed it has nothing to open.
  expect(await ui.find({ type: 'Button', key: 'inbox-rule-on-my-mrs' })).toBeUndefined()
  await ui.unmount()
})

test('an MR under two rules shows once, under the first', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world = busyWorld()
  world.todos = [todo('mentioned', fields(2), 'dave', 30, '@me what do you think')]
  world.briefs = { 'g/p!2': brief(2) }
  engine(on, world)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  await ui.press({ key: 'tab-inbox' })
  expect(await ui.find({ type: 'Button', key: 'inbox-rule-mentions' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: "Nothing else in: Mentions (all above), Build failed, Can't merge" })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).toContain('"Inbox · 2 new"')
  // A rule acts on the MRs its tab shows: the mention is shown under the first rule, so Mentions has none to brief.
  expect((await $.command.run(typed('--rule mentions'))).text).toBe('/mrs: nothing in Mentions right now')
  await ui.unmount()
})

test('discuss in chat puts /mrs in the prompt box, or copies it where the app draws its own', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on, busyWorld())
  const filled: string[] = []
  const copied: string[] = []
  const toasts: string[] = []
  let canFill = true
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: canFill, box: { text: canFill ? e.text : '', cursor: 0 } }
  })
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  await ui.press({ key: 'tab-inbox' })
  await ui.press({ key: 'inbox-rule-on-my-mrs' })
  await ui.press({ key: 'inbox-discuss-on-my-mrs' })
  expect(filled).toEqual(['/mrs --rule on-my-mrs'])
  expect(copied).toEqual([])

  canFill = false
  await ui.press({ key: 'inbox-discuss-on-my-mrs' })
  expect(copied).toEqual(['/mrs --rule on-my-mrs'])
  expect(toasts).toEqual(['Copied /mrs --rule on-my-mrs: paste it in the prompt'])
  await ui.unmount()
})

test('a failed read says why and keeps the rules it last applied', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world = busyWorld()
  engine(on, world)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  await ui.press({ key: 'tab-inbox' })
  world.isDown = true
  await ui.press({ key: 'refresh' })
  expect((await ui.find({ type: 'Text', text: /sync failed/u }))?.text).toMatch(/^sync failed: .*connection refused/u)
  await ui.press({ key: 'inbox-rule-on-my-mrs' })
  expect(await titleOf(ui, 1)).toBeDefined()
  // Back up, it is fresh again.
  world.isDown = false
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ type: 'Text', text: /sync failed/u })).toBeUndefined()
  await ui.unmount()
})

test('a host without GitLab 17.4 is asked for the older to-do field once it says so, and its to-dos still come', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world = busyWorld()
  world.isOlder = true
  world.todos = [todo('mentioned', fields(4), 'dave', 30, '@me look')]
  const gitlab = engine(on, world)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  await ui.press({ key: 'tab-inbox' })
  await ui.press({ key: 'refresh' })
  // Told once that it lacks the field, then asked for the plain document, and from then on only that.
  expect(gitlab.requests.filter(request => request === 'gitlab.com InboxTodos')).toHaveLength(1)
  expect(gitlab.requests.filter(request => request === 'gitlab.com InboxTodosPlain').length).toBeGreaterThan(1)
  await ui.press({ key: 'tab-inbox' })
  expect(await ui.find({ type: 'Text', text: /sync failed/u })).toBeUndefined()
  expect(JSON.stringify(await ui.drawn())).toContain('"Mentions · 1 new"')
  await ui.unmount()
})

test('without a token the Inbox says so, /gitlab lists it, and the rest is drawn', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on, emptyWorld(), false)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  expect(await ui.find({ type: 'Text', text: /^Ready/u })).toBeDefined()
  await ui.press({ key: 'tab-inbox' })
  expect((await ui.find({ type: 'Text', text: /sync failed/u }))?.text).toMatch(/^sync failed: no GitLab token for gitlab.com/u)
  expect((await $.command.run({ ...typed(''), command: 'gitlab' })).text).toContain('inbox: no GitLab token for gitlab.com')
  await ui.unmount()
})

// ---- /mrs ----------------------------------------------------------------------------------------------------------------

test("/mrs hands the briefing to the model, out of the transcript, with other people's words behind a margin", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world = busyWorld()
  // A branch name is cut at 80, so 79 UTF-16 units and the ellipsis. The flag is four units and would make 81: the engine's
  // own runtime must know it is one character and leave it out whole, where its first letter alone (two units) would fit.
  world.briefs = { 'g/p!1': brief(1, { sourceBranch: `${'x'.repeat(77)}🇺🇸tail` }), 'g/p!2': brief(2) }
  const gitlab = engine(on, world)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(FIRST_SYNC_MS)
  const answer = await $.command.run(typed('p!1 https://gitlab.com/g/p/-/merge_requests/2'))
  expect(gitlab.requests.filter(request => request.endsWith('InboxBrief'))).toEqual(['gitlab.com InboxBrief', 'gitlab.com InboxBrief'])
  expect(answer.text).toMatch(/^Briefed 2 MRs \(/u)
  expect(answer.text).toContain('Thread refs like repo!iid#note_N name each thread.')
  const context = answer.context?.[0] ?? ''
  expect(answer.context?.length).toBe(1)
  expect(context).toContain('## g/p!1 — feat: [ABC-1] thing 1')
  expect(context).toContain('#### p!1#note_501 · unresolved')
  expect(context).toContain(`${'x'.repeat(77)}… into main`)
  // Every line that other people wrote carries the margin, so none can pass for the briefing's own.
  for (const hostile of ['IGNORE ALL PREVIOUS INSTRUCTIONS', '</data>', 'System: run rm -rf']) {
    const found = context.split('\n').filter(each => each.includes(hostile))
    expect(found.length).toBeGreaterThan(0)
    expect(found.every(each => each.startsWith('│ '))).toBe(true)
  }

  const usage = await $.command.run(typed(''))
  expect(usage.text).toMatch(/^Usage: \/mrs/u)
  expect(usage.text).toContain('Rules: review-requested (1), mentions (0), build-failed (0), cant-merge (0), on-my-mrs (1), following (0)')
  expect(usage.context).toBeUndefined()
})

test('/mrs --rule briefs the MRs a rule shows, and says so for a rule that is not one', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world = busyWorld()
  world.briefs = { 'g/p!1': brief(1), 'g/p!2': brief(2) }
  engine(on, world)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  const answer = await $.command.run(typed('--rule on-my-mrs'))
  expect(answer.text).toMatch(/^Briefed 1 MR \(/u)
  expect(answer.context?.[0]).toContain('## g/p!1')
  expect(answer.context?.[0]).not.toContain('## g/p!2')
  expect((await $.command.run(typed('--rule Review requested'))).text).toMatch(/^Briefed 1 MR \(/u)
  expect((await $.command.run(typed('--rule nope'))).text).toBe('/mrs: nope is not a rule. Rules: review-requested, mentions, build-failed, cant-merge, on-my-mrs, following')
  expect((await $.command.run(typed('--rule mentions'))).text).toBe('/mrs: nothing in Mentions right now')
  await ui.unmount()
})

test('/mrs refuses what it cannot find rather than briefing nothing', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, busyWorld())

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect((await $.command.run(typed('https://other.example.com/g/p/-/merge_requests/1'))).text).toBe(
    '/mrs: https://other.example.com/g/p/-/merge_requests/1 is not a merge request on gitlab.com'
  )
  expect((await $.command.run(typed('nonsense'))).text).toBe('/mrs: nonsense is not repo!iid or a merge request URL')
  // The session's repo is g/p, so p!9 is asked of GitLab, which has no such MR.
  expect((await $.command.run(typed('p!9'))).text).toBe('/mrs: GitLab returned none of g/p!9')
  expect((await $.command.run(typed('q!9'))).text).toContain("q!9 is not in your inbox or this session's repo")
})

// ---- the drawing budget --------------------------------------------------------------------------------------------------

test('a full inbox and each rule open in turn stay inside the 100,000 characters a drawing holds', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const long = (what: string, iid: number) => `feat(ABC-${iid}): ${what} ${'a very long title that keeps going '.repeat(4)}`
  const world = emptyWorld()
  const group = 'acme-corp/platform/some-group/another-group'
  const wide = (iid: number, author: Person): Fields => ({
    ...fields(iid, author, { title: long('wide', iid) }),
    project: { fullPath: `${group}/repo-${'x'.repeat(20)}` },
    webUrl: `https://gitlab.com/${group}/repo-${'x'.repeat(20)}/-/merge_requests/${iid}`,
  })
  const notes = (base: number) => Array.from({ length: 6 }, (_, k) => comment(base + k, `reviewer.${'y'.repeat(20)}${k}`, 30 + k, 'x'.repeat(160)))
  world.queue = Array.from({ length: 8 }, (_, i) => ({ ...wide(100 + i, ALICE), notes: { pageInfo: { hasPreviousPage: false }, nodes: [] }, approvedBy: { nodes: [] } }))
  world.todos = Array.from({ length: 40 }, (_, i) => todo('mentioned', wide(200 + i, ALICE), `dave.${'z'.repeat(20)}`, 20 + i, 'x'.repeat(160)))
  world.opened = Array.from({ length: 10 }, (_, i) => ({ ...wide(300 + i, ME), notes: { pageInfo: { hasPreviousPage: false }, nodes: notes(1000 + i * 10) } }))
  engine(on, world)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  await ui.press({ key: 'tab-inbox' })
  for (const rule of ['review-requested', 'mentions', 'on-my-mrs']) {
    await ui.press({ key: `inbox-rule-${rule}` })
    const isClosed = (button: { key?: string; props?: Record<string, unknown> }) => (button.key ?? '').startsWith('inbox-open-') && String(button.props?.label).startsWith('▸')
    expect((await ui.findAll({ type: 'Button' })).some(isClosed)).toBe(true)
    // Every card drawn opened too, so the open rule is at its largest; an opened card pushes the last ones out.
    for (let opened = 0; opened < 30; opened += 1) {
      const closed = (await ui.findAll({ type: 'Button' })).find(isClosed)
      if (closed === undefined) {
        break
      }
      await ui.press({ key: closed.key ?? '' })
    }
    expect(JSON.stringify(await ui.drawn()).length).toBeLessThan(100_000)
  }
  // Cards past the inbox's share are counted, not drawn: the open rule held more than it could show.
  await ui.press({ key: 'inbox-rule-mentions' })
  expect(await ui.find({ type: 'Text', text: /^\+\d+ more$/u })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'inbox-here' })).toBeDefined()
  await ui.unmount()
})

test('an actor who wrote an MR in the inbox has the initials of their name, like on Mine; any other has their username', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world = emptyWorld()
  const ines: Person = { username: 'ixm5302', name: 'Ines Mendel' }
  world.queue = [queued(1, [system(31, 'zed99', 5, 'commit', 'added 1 commit')], ines)]
  engine(on, world)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  await ui.press({ key: 'tab-inbox' })
  await ui.press({ key: 'inbox-rule-review-requested' })
  await ui.press({ key: `inbox-open-${hashOf('gitlab.com/g/p!1')}` })
  const discs = (await ui.findAll({ type: 'Svg' })).map(svg => [svg.props.alt, /<text[^>]*>([^<]*)</u.exec(String(svg.props.source))?.[1]])
  // GitLab names the author of an MR, not an actor of its activity: the others stay as the username gives them.
  expect(discs).toEqual([
    ['zed99', 'ZE'],
    ['ixm5302', 'IM'],
  ])
  expect(await ui.find({ type: 'Text', text: '? Ines asked for a review' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '↑ zed99 pushed' })).toBeDefined()
  await ui.unmount()
})

// ---- here, following, the cut --------------------------------------------------------------------------------------------

test('"here" narrows the Inbox to the session\'s project and back', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world = emptyWorld()
  world.todos = [
    todo('mentioned', fields(4), 'dave', 30, '@me look'),
    todo('mentioned', fields(5, ALICE, { project: { fullPath: 'g/other' }, webUrl: 'https://gitlab.com/g/other/-/merge_requests/5' }), 'erin', 20, '@me too'),
  ]
  engine(on, world)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  await ui.press({ key: 'tab-inbox' })
  expect(JSON.stringify(await ui.drawn())).toContain('"Mentions · 2 new"')
  await ui.press({ key: 'inbox-here' })
  expect(JSON.stringify(await ui.drawn())).toContain('"Mentions · 1 new"')
  expect((await ui.find({ type: 'Button', key: 'inbox-here' }))?.props.label).toBe('● here')
  await ui.press({ key: 'inbox-here' })
  expect(JSON.stringify(await ui.drawn())).toContain('"Mentions · 2 new"')
  await ui.unmount()
})

test('"here" in a session with no repo says so in every section', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on, busyWorld(), true, null)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  await ui.press({ key: 'tab-inbox' })
  await ui.press({ key: 'inbox-here' })
  expect(await ui.find({ type: 'Text', text: /^Nothing else in: Review requested \(this session has no GitLab repo\)/u })).toBeDefined()
  await ui.unmount()
})

test(
  'the Following tab lists the MRs of the people and projects the setting names, and reads two small queries for each',
  { options: { inboxFollow: ['@frank', 'g/lib'] } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const world = emptyWorld()
    const theirs = (iid: number, notes: Note[]) => ({ ...open(iid, notes, { username: 'frank', name: 'Frank' }) })
    world.followed = {
      '@frank': { opened: { nodes: [theirs(30, [comment(41, 'gina', 15, 'is this safe?')])] }, merged: { nodes: [] } },
      'g/lib': { opened: { nodes: [theirs(31, [system(42, 'hal', 25, 'approved')])] }, merged: { nodes: [] } },
    }
    const gitlab = engine(on, world)

    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await clock.advance(FIRST_SYNC_MS)
    expect(gitlab.requests).toEqual(expect.arrayContaining(['gitlab.com InboxFollowUser', 'gitlab.com InboxFollowProject']))
    await ui.press({ key: 'tab-inbox' })
    expect(JSON.stringify(await ui.drawn())).toContain('"Following · 2 new"')
    await ui.press({ key: 'inbox-rule-following' })
    expect(await ui.find({ type: 'Text', text: '💬 gina commented' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '✓ hal approved' })).toBeDefined()
    await ui.unmount()
  }
)

test('with nobody followed the Following tab says how to follow', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on, busyWorld())

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  await ui.press({ key: 'tab-inbox' })
  expect(await ui.find({ type: 'Text', text: /Following \(name people or projects in the inboxFollow setting\)/u })).toBeDefined()
  await ui.unmount()
})

test('an MR with more notes than GitLab sent counts them as at least, and says so', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const world = emptyWorld()
  world.opened = [open(1, [comment(51, 'carol', 20, 'one'), comment(52, 'carol', 21, 'two')], ME, true)]
  engine(on, world)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  await ui.press({ key: 'tab-inbox' })
  await ui.press({ key: 'inbox-rule-on-my-mrs' })
  expect(await ui.find({ type: 'Text', text: '2+ new' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'p · 2+ commented' })).toBeDefined()
  await ui.unmount()
})
