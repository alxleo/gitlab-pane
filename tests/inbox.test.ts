import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { shortHash as hashOf } from '../hooks/identity'
import { AVATAR_BASE64, NOW, job, pipe, project, rawMr, reviewer, stage, thread } from './fixtures'

const PANE = {
  plugin: 'gitlab-ci',
  component: 'Pane',
  requestId: 'gitlab-ci',
  props: {
    title: 'GitLab',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const REMOTE = 'git@gitlab.com:g/p.git'
const MINUTES_AGO = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

const ran = (stdout: string, exitCode = 0, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

const item = (iid: number, unseen: number, isMine = false) => ({
  key: `g/p!${iid}`,
  ref: `p!${iid}`,
  project: 'g/p',
  iid,
  title: `feat: [ABC-${iid}] thing ${iid}`,
  url: `https://gitlab.com/g/p/-/merge_requests/${iid}`,
  author: isMine ? { username: 'me', name: 'Me', is_me: true } : { username: 'alice', name: 'Alice', is_me: false },
  state: 'opened',
  draft: false,
  unseen,
  counts: { comment: 2, approved: 1 },
  activity: [
    { kind: 'approved', actor: 'bob', at: MINUTES_AGO(120), url: null, excerpt: '' },
    { kind: 'comment', actor: 'carol.jones', at: MINUTES_AGO(180), url: `https://gitlab.com/g/p/-/merge_requests/${iid}#note_1`, excerpt: 'please rename' },
  ],
})

/** The title a card draws, a Button whose press opens and closes the card. */
const titleOf = async (
  ui: { find: (query: { type: string; key: string }) => Promise<{ props?: Record<string, unknown> } | undefined> },
  iid: number
) => (await ui.find({ type: 'Button', key: `inbox-open-${hashOf(`g/p!${iid}`)}` }))?.props?.label

/** mr-inbox as the test sets it: the inbox it prints, and every call it was asked. */
type Inbox = { sections: unknown[]; sync: Record<string, unknown>; exitCode?: number; stderr?: string }

function engine(on: On, inbox: Inbox) {
  const calls: string[][] = []
  on('process.run', (_, e) => {
    const at = e.argv.indexOf('mr-inbox')
    if (at < 0) {
      // The pane's own GitLab read: no open MRs of yours.
      return ran(JSON.stringify({ data: { currentUser: { authoredMergeRequests: { nodes: [] } } } }))
    }
    const args = e.argv.slice(at + 1)
    calls.push(args)
    if (inbox.exitCode) {
      return ran('', inbox.exitCode, inbox.stderr ?? '')
    }
    if (args[0] === 'inbox') {
      return ran(JSON.stringify({ sync: inbox.sync, sections: inbox.sections }))
    }
    if (args[0] === 'brief') {
      return ran('# MR briefing: 2 MRs\n\n## p!1 — thing\n\n## p!2 — thing\n')
    }
    return ran('{"ok": true}')
  })
  on('session.repo', () => ({ value: { root: '/r', remote: REMOTE, internal: false, name: null } }))
  on('command.register', () => ({ value: { command: 'gitlab' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__gitlab-ci__watch_mr' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return calls
}

/** The inbox's first sync waits this long after the session starts. */
const FIRST_SYNC_MS = 2_000

const typed = (args: string) => ({
  command: 'mrs',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 100 },
})

const sections = () => [
  { rule: 'people', title: 'Reviews: people I follow', note: null, items: [item(1, 3), item(2, 0, true)] },
  { rule: 'to-review', title: 'To review', note: null, items: [] },
]

test('the inbox syncs once the pane shows it, folds each rule, and opens one to its MRs', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const calls = engine(on, { sections: sections(), sync: { ok: true, finished_at: MINUTES_AGO(2) } })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await clock.advance(FIRST_SYNC_MS)
    expect(calls.some(args => args[0] === 'sync' && args.includes('--if-older-than') && args.includes(REMOTE))).toBe(true)
    // The inbox has a tab of its own, which names how many MRs have news; its body draws only there.
    expect(JSON.stringify(await ui.drawn())).toContain('"Inbox · 1 new"')
    expect(await ui.find({ type: 'Button', key: 'inbox-sync' })).toBeUndefined()
    await ui.press({ key: 'tab-inbox' })
    expect(await ui.find({ type: 'Text', text: 'synced 2m ago' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Nothing else in: To review' })).toBeDefined()
    expect(await titleOf(ui, 1)).toBeUndefined()
    // Counts are MRs with news, not the events in them; each rule is a tab.
    expect(JSON.stringify(await ui.drawn())).toContain('"Reviews: people I follow · 1 new"')

    await ui.press({ key: 'inbox-rule-people' })
    // Dark text with a disclosure mark, not a link: a link-blue title read as a way out to GitLab.
    expect(await titleOf(ui, 1)).toBe('▸ thing 1')
    expect(await ui.find({ type: 'Text', text: '3 new' })).toBeDefined()
    // A count per kind instead of a line of handles, and the ref without the repo, which follows it.
    expect(await ui.find({ type: 'Text', text: 'p · alice · 1 approved · 2 commented' })).toBeDefined()
    // Your own MR leaves your name out.
    expect(await ui.find({ type: 'Text', text: 'p · 1 approved · 2 commented' })).toBeDefined()
    expect(JSON.stringify(await ui.drawn())).toContain('"!1"')
    // The newest event says who did what; the rest wait behind a press on the title.
    expect(await ui.find({ type: 'Text', text: '✓ bob approved' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '“please rename”' })).toBeUndefined()
    const opens = { key: `inbox-open-${hashOf('g/p!1')}` }
    await ui.press(opens)
    expect(await titleOf(ui, 1)).toBe('▾ thing 1')
    expect(await ui.find({ type: 'Text', text: '💬 carol commented' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '“please rename”' })).toBeDefined()
    // The title closes it again, and so does ▴ less at the card's foot.
    await ui.press(opens)
    expect(await ui.find({ type: 'Text', text: '“please rename”' })).toBeUndefined()
    await ui.press(opens)
    await ui.press({ key: `inbox-less-${hashOf('g/p!1')}` })
    expect(await ui.find({ type: 'Text', text: '“please rename”' })).toBeUndefined()
    await ui.press({ key: 'inbox-rule-people' })
    await ui.press({ key: 'tab-mine' })
    await ui.unmount()
  }
})

test('✓ marks one MR seen and reads the inbox again', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const inbox: Inbox = { sections: sections(), sync: { ok: true, finished_at: MINUTES_AGO(1) } }
  const calls = engine(on, inbox)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  await ui.press({ key: 'tab-inbox' })
  await ui.press({ key: 'inbox-rule-people' })
  expect(await titleOf(ui, 1)).toBeDefined()
  inbox.sections = [{ ...sections()[0], items: [item(2, 0)] }, sections()[1]]
  const before = calls.length
  await ui.press({ key: `inbox-seen-${hashOf('g/p!1')}` })
  expect(calls.slice(before)).toEqual([['seen', 'g/p!1'], ['inbox', '--json', '--repo', REMOTE]])
  expect(await titleOf(ui, 1)).toBeUndefined()
  await ui.unmount()
})

test('an MR under two rules shows once, under the first', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on, {
    sections: [
      ...sections(),
      { rule: 'repos', title: 'Reviews: repos I follow', note: null, items: [item(1, 3)] },
    ],
    sync: { ok: true, finished_at: MINUTES_AGO(1) },
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  await ui.press({ key: 'tab-inbox' })
  expect(await ui.find({ type: 'Button', key: 'inbox-rule-repos' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Nothing else in: To review, Reviews: repos I follow (all above)' })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).toContain('"Inbox · 1 new"')
  await ui.unmount()
})

test('discuss in chat puts /mrs in the prompt box, or copies it where the app draws its own', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on, { sections: sections(), sync: { ok: true, finished_at: MINUTES_AGO(1) } })
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
  await ui.press({ key: 'inbox-rule-people' })
  await ui.press({ key: 'inbox-discuss-people' })
  expect(filled).toEqual(['/mrs --rule people'])
  expect(copied).toEqual([])

  canFill = false
  await ui.press({ key: 'inbox-discuss-people' })
  expect(copied).toEqual(['/mrs --rule people'])
  expect(toasts).toEqual(['Copied /mrs --rule people: paste it in the prompt'])
  await ui.unmount()
})

test('a failed sync says why and keeps the rules it last read', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on, { sections: sections(), sync: { ok: false, error: 'glab is not signed in to gitlab.com', finished_at: MINUTES_AGO(5) } })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  await ui.press({ key: 'tab-inbox' })
  expect((await ui.find({ type: 'Text', text: /sync failed/ }))?.text).toBe('sync failed: glab is not signed in to gitlab.com')
  await ui.press({ key: 'inbox-rule-people' })
  expect(await titleOf(ui, 2)).toBeDefined()
  await ui.unmount()
})

test('without mr-inbox installed the pane says so once and draws the rest', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on, { sections: [], sync: {}, exitCode: 127, stderr: 'zsh:1: command not found: mr-inbox' })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  expect(await ui.find({ type: 'Text', text: /^Mine/ })).toBeDefined()
  await ui.press({ key: 'tab-inbox' })
  expect((await ui.find({ type: 'Text', text: /not installed/ }))?.text).toBe('mr-inbox is not installed')
  await ui.unmount()
})

test('/mrs hands the briefing to the model, out of the transcript', async ($, on) => {
  mock.clock(on, { now: NOW })
  const calls = engine(on, { sections: sections(), sync: { ok: true, finished_at: MINUTES_AGO(1) } })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const answer = await $.command.run(typed('p!1 p!2'))
  expect(calls.at(-1)).toEqual(['brief', 'p!1', 'p!2', '--repo', REMOTE])
  expect(answer.text).toMatch(/^Briefed 2 MRs \(/)
  expect(answer.context).toEqual(['# MR briefing: 2 MRs\n\n## p!1 — thing\n\n## p!2 — thing\n'])

  const usage = await $.command.run(typed(''))
  expect(usage.text).toMatch(/^Usage: \/mrs/)
  expect(usage.context).toBeUndefined()
})

test('a full inbox, each rule open in turn, and fifty busy MRs each stay inside the 100,000 characters a drawing holds', { timeoutMs: 20_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const long = (name: string) => `${name}-${'x'.repeat(30)}`
  const busy = (status: string) =>
    pipe(status, {
      stages: {
        nodes: Array.from({ length: 9 }, (_, s) =>
          stage(long(`stage${s}`), status, Array.from({ length: 20 }, (_, j) => job(long(`job${s}-${j}`), status)))
        ),
      },
    })
  const mrs = Array.from({ length: 50 }, (_, i) =>
    rawMr(1000 + i, {
      project: project(`acme-corp/platform/some-group/another-group/${i % 3 === 0 ? 'repo-one' : 'repo-two'}`),
      headPipeline: busy(i % 2 === 0 ? 'RUNNING' : 'FAILED'),
      reviewers: { nodes: [reviewer('first.reviewer', 'REQUESTED_CHANGES'), reviewer('second.reviewer', 'APPROVED')] },
      discussions: { nodes: Array.from({ length: 6 }, (_, t) => thread(`${'A long comment. '.repeat(40)}${t}`, t % 2 ? 'first.reviewer' : 'second.reviewer')) },
    })
  )
  const rules = ['mine', 'to-review', 'people', 'repos', 'here']
  const wide = (iid: number) => ({
    ...item(iid, 9),
    ref: `some-group/another-group/repo-${'x'.repeat(20)}!${iid}`,
    title: `feat(ABC-${iid}): ${'a very long title that keeps going '.repeat(4)}`,
    activity: Array.from({ length: 3 }, (_, k) => ({ kind: 'changes_requested', actor: `reviewer.${'y'.repeat(20)}${k}`, at: MINUTES_AGO(30), url: null, excerpt: 'x'.repeat(160) })),
  })
  const inboxSections = rules.map((rule, r) => ({
    rule,
    title: `Rule ${rule} with a fairly long title to fill the line`,
    note: null,
    items: Array.from({ length: 30 }, (_, i) => wide(r * 100 + i)),
  }))
  on('process.run', (_, e) => {
    if (e.argv.includes('mr-inbox')) {
      return ran(JSON.stringify({ sync: { ok: true, finished_at: MINUTES_AGO(1) }, sections: inboxSections }))
    }
    if (e.argv.includes('acli')) {
      return ran('[]')
    }
    if (e.argv.includes('avatar')) {
      return ran(AVATAR_BASE64)
    }
    const query = e.argv.find(arg => arg.startsWith('query=')) ?? ''
    if (query.includes('pipelines(source:')) {
      const aliases = [...query.matchAll(/(h\d+): project/g)].map(match => match[1] ?? '')
      return ran(JSON.stringify({ data: Object.fromEntries(aliases.map(alias => [alias, { pipelines: { nodes: [{ duration: 600 }] } }])) }))
    }
    return ran(JSON.stringify({ data: { currentUser: { authoredMergeRequests: { nodes: mrs } } } }))
  })
  on('session.repo', () => ({ value: { root: '/r', remote: REMOTE, internal: false, name: null } }))
  on('command.register', () => ({ value: { command: 'gitlab' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__gitlab-ci__watch_mr' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  // The desktop app draws nothing for a tree past 100,000 characters serialized.
  await ui.press({ key: 'more' })
  expect(JSON.stringify(await ui.drawn()).length).toBeLessThan(100_000)
  await ui.press({ key: 'tab-inbox' })
  for (const rule of rules) {
    await ui.press({ key: `inbox-rule-${rule}` })
    const isClosed = (button: { key?: string; props?: Record<string, unknown> }) =>
      /^inbox-open-/.test(button.key ?? '') && String(button.props?.label).startsWith('▸')
    expect((await ui.findAll({ type: 'Button' })).some(isClosed)).toBe(true)
    // Every card drawn opened too, so the open rule is at its largest; an opened card pushes the last ones out.
    for (let opened = 0; opened < 30; opened += 1) {
      const closed = (await ui.findAll({ type: 'Button' })).find(isClosed)
      if (!closed) {
        break
      }
      await ui.press({ key: closed.key ?? '' })
    }
    expect(JSON.stringify(await ui.drawn()).length).toBeLessThan(100_000)
    // Cards past the inbox's share are counted, not drawn.
    expect(await ui.find({ type: 'Text', text: /^\+\d+ more$/ })).toBeDefined()
  }
  expect(await ui.find({ type: 'Button', key: 'refresh' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'inbox-sync' })).toBeDefined()
  await ui.unmount()
})

test('an actor who wrote an MR in the inbox has the initials of their name, like on Mine; any other has their username', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const who = (actor: string) => ({ kind: 'approved', actor, at: MINUTES_AGO(5), url: null, excerpt: '' })
  const ines = { ...item(1, 1), author: { username: 'ixm5302', name: 'Ines Mendel', is_me: false }, activity: [who('ixm5302'), who('zed99')] }
  engine(on, { sections: [{ rule: 'people', title: 'People', note: null, items: [ines] }], sync: { ok: true, finished_at: MINUTES_AGO(2) } })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.advance(FIRST_SYNC_MS)
  await ui.press({ key: 'tab-inbox' })
  await ui.press({ key: 'inbox-rule-people' })
  await ui.press({ key: `inbox-open-${hashOf('g/p!1')}` })
  const discs = (await ui.findAll({ type: 'Svg' })).map(svg => [svg.props.alt, /<text[^>]*>([^<]*)</.exec(String(svg.props.source))?.[1]])
  // mr-inbox names the author of an MR, not an actor of its activity: the others stay as the username gives them.
  expect(discs).toEqual([
    ['ixm5302', 'IM'],
    ['zed99', 'ZE'],
  ])
  expect(await ui.find({ type: 'Text', text: '✓ Ines approved' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '✓ zed99 approved' })).toBeDefined()
  await ui.unmount()
})

