import { expect, test } from 'vitest'
import fc from 'fast-check'

import { hasLeft } from '../../hooks/attention.ts'
import { firstRunLines } from '../../hooks/first-run.ts'
import { cardKey } from '../../hooks/hosts.ts'
import { pinKey } from '../../hooks/mr-url.ts'
import { toCard } from '../../hooks/gitlab.ts'
import { buildPane, inboxBand, MINE_SHOWN } from '../../hooks/pane-model.ts'
import type { PaneInput, Piece, RowModel } from '../../hooks/pane-model.ts'
import { slimCard } from '../../hooks/slim.ts'
import { STAGE_COLOURS } from '../../hooks/status.ts'
import { readCardArb } from './arbitrary.ts'
import { HOST, NOW, gitlabSays, pipe, rawMr, thread } from '../fixtures.ts'
import type { MrCard } from '../../types'

/** The pane's model over these cards, every piece of a row costing `cost(piece)` characters. */
const modelOf = (cards: MrCard[], over: Partial<PaneInput> = {}, cost: (piece: Piece, row: RowModel) => number = () => 1_000, room = 79_000) =>
  buildPane(
    {
      cards,
      avatars: {},
      pinned: [],
      usual: {},
      browse: '',
      expanded: [],
      repoFilter: '',
      view: 'mine',
      news: { count: 0, keys: [] },
      poll: { fetchedAt: NOW, error: null, hosts: {} },
      isReading: false,
      isSyncing: false,
      isWaking: true,
      failures: {},
      ...over,
    },
    NOW,
    { hasSvg: true },
    { room, sizeOf: (row, piece) => cost(piece, row) }
  )

test('beside the tabs, the age of the cards, and ↻ dim while this session reads; the footer speaks only of what went wrong', () => {
  const threeHours = { fetchedAt: NOW - 3 * 3_600_000, error: null, hosts: {} }
  expect(modelOf([], { poll: threeHours }).status).toEqual({ text: 'updated 3h ago', isWarning: false })
  expect(modelOf([], { poll: threeHours }).isRefreshing).toBe(false)
  // ↻ is only ever the press: a read that is out dims it, and the age beside it carries no mark of its own.
  expect(modelOf([], { poll: threeHours, isReading: true })).toMatchObject({ status: { text: 'updated 3h ago', isWarning: false }, isRefreshing: true })
  expect(modelOf([], { poll: threeHours, isSyncing: true }).isRefreshing).toBe(true)
  // A session that follows has no read of its own to dim ↻ for, but still says one is out while it has nothing to show.
  expect(modelOf([], { poll: { fetchedAt: null, error: null, hosts: {} } }).status.text).toBe('reading GitLab…')
  expect(modelOf([], { poll: threeHours }).footer.text).toBe('')
  const failed = { fetchedAt: NOW - 600_000, error: 'connection refused', hosts: { [HOST]: { fetchedAt: NOW - 600_000, error: 'connection refused' } } }
  expect(modelOf([], { poll: failed }).status).toEqual({ text: 'updated 10m ago', isWarning: true })
  expect(modelOf([], { poll: failed }).footer).toMatchObject({ text: 'GitLab read failed: connection refused; showing 10m old data', isWarning: true })
  // Whether a raised MR wakes Claude is a bell, named for the press: struck through once wakes are off.
  expect(modelOf([]).wake).toEqual({ label: 'wake Claude: on', mark: '🔔' })
  expect(modelOf([], { isWaking: false }).wake).toEqual({ label: 'wake Claude: off', mark: '🔕' })
})

test('the band above the prompt says the inbox news only while the pane shows no tabs that say it, and gives way to a survey', () => {
  const band = (over: Partial<Parameters<typeof inboxBand>[0]> = {}) => inboxBand({ count: 2, isPaneDrawn: false, isPageOpen: false, hasSurvey: false, ...over })
  expect(band()).toBe('Inbox · 2 new')
  // Nothing new is no news: the band is left to whatever else draws there.
  expect(band({ count: 0 })).toBeNull()
  // The pane's Inbox tab says the same words, so the band does not repeat them beside it.
  expect(band({ isPaneDrawn: true })).toBeNull()
  // An MR read whole has its way back where the tabs were, so the count is nowhere in the pane and the band says it.
  expect(band({ isPaneDrawn: true, isPageOpen: true })).toBe('Inbox · 2 new')
  expect(band({ hasSurvey: true })).toBeNull()
  // The band and the tab are one fact in one form of words.
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 500 }), count => {
      expect(band({ count })).toBe(modelOf([], { news: { count, keys: [] } }).tabs.inbox)
    })
  )
})

test('each MR is a card bordered by its review, heavier when it needs you, its worst blocker in words', async () => {
  const approved = { approvalsLeft: 0, approvedBy: { nodes: [{ username: 'mel', name: 'Mel', bot: false, avatarUrl: null }] } }
  const botThread = { nodes: [thread('### What the bot wrote', 'project_1_bot_ab', false, true, true)] }
  const cards = [
    toCard(HOST, rawMr(12, { headPipeline: pipe('FAILED') })),
    toCard(HOST, rawMr(13, { headPipeline: pipe('SUCCESS') })),
    { ...toCard(HOST, rawMr(14, { ...approved, headPipeline: pipe('SUCCESS'), discussions: botThread })), mergeStatus: gitlabSays() },
    { ...toCard(HOST, rawMr(15, { ...approved, headPipeline: pipe('RUNNING') })), mergeStatus: gitlabSays({ CI_MUST_PASS: 'checking' }) },
    { ...toCard(HOST, rawMr(16)), mergeStatus: gitlabSays({ NOT_OPEN: 'failed' }) },
  ]
  const { mine, tabs } = modelOf(cards)
  // The failed one needs you: a heavier line in red. One waiting on a review is grey; approved ones are green.
  expect(Object.fromEntries(mine.rows.map(row => [row.mr.text, [row.border.style, row.border.colour]]))).toEqual({
    '🔀 !12': ['bold', STAGE_COLOURS.error],
    '🔀 !13': ['round', STAGE_COLOURS.subtle],
    '🔀 !14': ['round', STAGE_COLOURS.success],
    '🔀 !15': ['round', STAGE_COLOURS.success],
  })
  // GitLab says one is no longer open, so it leaves Mine before the next full read.
  expect(tabs.mine).toBe('Mine · 4')
  const byLink = Object.fromEntries(mine.rows.map(row => [row.mr.text, row]))
  // GitLab's verdict is the one word on whether it can merge, said once; a bot's open thread is on its face, so nothing trails it.
  expect(byLink['🔀 !14']?.verdict).toEqual({ words: '✓ mergeable', tone: 'success', bold: true, trailing: null })
  expect(byLink['🔀 !15']?.verdict?.words).toBe('CI must pass (checking)')
  // With no verdict read, the pane's own marker shows in words.
  expect(byLink['🔀 !13']?.verdict).toBeNull()
  expect(byLink['🔀 !13']?.blocker).toEqual({ text: '👤 needs 1 approval', tone: 'subtle' })
})

test('a row that passed and waits on nothing of yours folds to one line; one that runs, failed, is blocked or quotes a person does not', () => {
  const approved = { approvalsLeft: 0, approvedBy: { nodes: [{ username: 'mel', name: 'Mel', bot: false, avatarUrl: null }] } }
  const rows = {
    waiting: toCard(HOST, rawMr(1, { headPipeline: pipe('SUCCESS') })),
    mergeable: { ...toCard(HOST, rawMr(2, { ...approved, headPipeline: pipe('SUCCESS') })), mergeStatus: gitlabSays() },
    running: toCard(HOST, rawMr(3, { headPipeline: pipe('RUNNING') })),
    failed: toCard(HOST, rawMr(4, { headPipeline: pipe('FAILED') })),
    conflict: { ...toCard(HOST, rawMr(5, { headPipeline: pipe('SUCCESS') })), mergeStatus: gitlabSays({ CONFLICT: 'failed' }) },
    // Human feedback always surfaces, approved or not.
    asked: toCard(HOST, rawMr(6, { ...approved, headPipeline: pipe('SUCCESS'), discussions: { nodes: [thread('Rename this.', 'mel')] } })),
  }
  const model = modelOf(Object.values(rows))
  const quiet = Object.fromEntries(Object.entries(rows).map(([name, card]) => [name, model.mine.rows.find(row => row.key === card.key)?.isQuiet]))
  expect(quiet).toEqual({ waiting: true, mergeable: true, running: false, failed: false, conflict: false, asked: false })
  // Its one line still says what it waits on, or that it can merge.
  expect(model.mine.rows.find(row => row.key === rows.mergeable.key)?.verdict?.words).toBe('✓ mergeable')
})

test('a render works out the facts of the rows drawn alone, and measures each piece of a row at most once', async () => {
  const worked = new Set<string>()
  // cardFacts is the only reader of a card's title, so a card whose title is read has its facts worked out.
  const cards = Array.from({ length: 50 }, (_, i) => {
    const card = toCard(HOST, rawMr(300 + i, { headPipeline: pipe(i % 2 === 0 ? 'FAILED' : 'SUCCESS') }))
    return Object.defineProperty({ ...card }, 'title', {
      enumerable: true,
      get: () => {
        worked.add(card.key)
        return card.title
      },
    })
  })
  const measured = new Map<string, number>()
  const model = modelOf(cards, {}, (piece, row) => {
    measured.set(`${row.key}|${piece}`, (measured.get(`${row.key}|${piece}`) ?? 0) + 1)
    return 1_000
  })
  const drawn = model.mine.rows.filter(row => row.fit.isDrawn)
  // Mine shows ten of the fifty; the other forty are ranked and counted, and their words never worked out.
  expect(drawn).toHaveLength(MINE_SHOWN)
  expect(worked.size).toBe(MINE_SHOWN)
  expect(Math.max(...measured.values())).toBe(1)
  // Two kinds of piece for a row: its head, and its faces if it has pictures.
  expect(measured.size).toBeLessThanOrEqual(MINE_SHOWN * 2)
})

test('the model fills the room by what needs you; rows past the room are counted', async () => {
  const cards = Array.from({ length: 12 }, (_, i) =>
    toCard(HOST, rawMr(100 + i, { updatedAt: `2026-10-23T15:${String(10 + i).padStart(2, '0')}:00Z`, headPipeline: pipe(i % 2 === 0 ? 'FAILED' : 'SUCCESS') }))
  )
  const cost = (piece: Piece) => (piece === 'head' ? 10_000 : 1_000)
  const folded = modelOf(cards, { expanded: ['more'] }, cost)
  // Seven rows of 10,000 fit 79,000; the failing ones, latest first, come in before the passing.
  const drawn = folded.mine.rows.filter(row => row.fit.isDrawn)
  expect(drawn.length).toBe(7)
  expect(drawn.map(row => row.key).slice(0, 3)).toEqual(
    cards
      .filter((_, i) => i % 2 === 0)
      .map(card => card.key)
      .toReversed()
      .slice(0, 3)
  )
  expect(folded.leftOut).toBe('5 more MRs left out to stay within what the app draws; pick a repo above to see them.')
})

test('while nothing has been read, one line per failing source says what to do, from the kind of failure and not its words', async () => {
  const failures = {
    gitlab: { message: 'anything at all', at: NOW, kind: 'no-token' as const },
    jira: { message: 'acli is not installed', at: NOW, kind: 'not-installed' as const },
    inbox: { message: 'boom', at: NOW, kind: 'unknown' as const },
  }
  expect(firstRunLines(failures, false)).toEqual(['GitLab: no access token: set one, or sign in, then press refresh', 'Inbox: boom'])
  expect(firstRunLines({ gitlab: { message: 'x', at: NOW, kind: 'network' } }, false)).toEqual(['GitLab: cannot be reached: check the network or VPN, then press refresh'])
  // Once something has been read the pane has cards to show and the footer says the rest.
  expect(firstRunLines(failures, true)).toEqual([])
  const unread = { fetchedAt: null, attemptedAt: NOW, error: 'x', hosts: {}, failures: 1, ticketsAt: null, usualAt: null }
  expect(modelOf([], { failures, poll: unread }).firstRun.length).toBe(2)
})

/** What the list draws: its rows, with their lines, faces, marks and the comment each quotes. */
const drawnRows = (cards: MrCard[]) => {
  const model = modelOf(cards, { expanded: ['drafts'] }, () => 1)
  return { session: model.session, mine: model.mine.rows, drafts: model.drafts?.rows ?? [], more: model.mine.more, leftOut: model.leftOut }
}

test("the Mine tab, All and the repos count the same MRs, and this session's, the ready, the parked and the drafts add up to them", () => {
  const countOf = (label: string | undefined) => Number(/(\d+)$/u.exec(label ?? '')?.[1] ?? NaN)
  fc.assert(
    fc.property(fc.array(readCardArb, { maxLength: 8 }), fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }), (cards, isPinned) => {
      // One card to a key, and a pin's key that of its card, as the list holds them.
      const full = cards.map((one, i) => ({ ...one, iid: one.iid + 100 * i, key: cardKey(one.host, one.path, one.iid + 100 * i) }))
      const pinned = full.filter((_, i) => isPinned[i] === true).map(card => ({ url: card.url, host: card.host, path: card.path, iid: card.iid, origin: 'watched' as const }))
      const model = modelOf(full, { pinned, expanded: ['drafts', 'parked', 'more', 'others'] }, () => 1)
      expect(model.session.length).toBe(pinned.filter(pin => full.some(card => card.key === pinKey(pin) && !hasLeft(card))).length)
      const tab = countOf(model.tabs.mine)
      expect(countOf(model.repos.all.label)).toBe(tab)
      expect(model.repos.each.reduce((sum, repo) => sum + countOf(repo.label), 0)).toBe(tab)
      expect(model.session.length + countOf(model.mine.heading) + countOf(model.parked?.label ?? '0') + countOf(model.drafts?.label ?? '0')).toBe(tab)
      // Folded, the one line counts all but this session's; with nothing of this session's, nothing folds.
      const folded = modelOf(full, { pinned }, () => 1).others
      expect(folded === null).toBe(model.session.length === 0 || model.session.length === tab)
      expect(model.session.length + Number(/(\d+) others?/u.exec(folded?.label ?? `${tab - model.session.length} others`)?.[1])).toBe(tab)
    })
  )
})

const pinOf = (card: MrCard, origin: 'raised' | 'watched' = 'watched') => ({ url: card.url, host: card.host, path: card.path, iid: card.iid, origin })

test('with this session holding MRs, the rest fold to one line counting them and their news; a picked repo shows its MRs', () => {
  const failing = (iid: number) => toCard(HOST, rawMr(iid, { headPipeline: pipe('FAILED') }))
  const [held, other, news] = [failing(21), failing(22), failing(23)]
  const cards = [held, other, news, failing(24)]
  const pinned = [pinOf(held)]
  // News from outside Mine is not counted among the folded.
  const folded = modelOf(cards, { pinned, news: { count: 2, keys: [news.key, 'gitlab.example.com/other/repo!9'] } })
  expect(folded.session.map(row => row.key)).toEqual([held.key])
  expect(folded.others).toEqual({ label: '▸ 3 others · 1 new', isOpen: false })
  expect(folded.mine.rows).toEqual([])
  const opened = modelOf(cards, { pinned, expanded: ['others'] })
  expect(opened.others?.label).toBe('▾ 3 others')
  expect(opened.mine.rows.map(row => row.key)).toContain(other.key)
  // The line that says rows were left out sends the person to a repo, which shows them unfolded.
  const picked = modelOf(cards, { pinned, repoFilter: held.project })
  expect(picked.others).toBeNull()
  expect(picked.mine.rows).toHaveLength(3)
  expect(modelOf(cards).others).toBeNull()
})

test('a ready MR untouched for a week parks until its pipeline runs or it has news; a draft stays with the drafts', () => {
  const old = '2026-10-10T15:00:00Z'
  const untouched = (iid: number, over: Parameters<typeof rawMr>[1] = {}) =>
    toCard(HOST, rawMr(iid, { updatedAt: old, headPipeline: pipe('FAILED', { startedAt: old, finishedAt: old }), ...over }))
  const stale = untouched(31)
  const spoken = untouched(32)
  // GitLab leaves the updated time alone when a pipeline runs, so a pipeline that just failed counts as a move.
  const rerun = untouched(35, { headPipeline: pipe('FAILED') })
  const fresh = toCard(HOST, rawMr(33))
  const draft = untouched(34, { draft: true })
  const model = modelOf([stale, spoken, rerun, fresh, draft], { news: { count: 1, keys: [spoken.key] } })
  expect(new Set(model.mine.rows.map(row => row.key))).toEqual(new Set([fresh.key, spoken.key, rerun.key]))
  expect(model.parked).toEqual({ label: '▸ Parked, untouched for a week · 1', isOpen: false, rows: [] })
  expect(model.drafts?.label).toBe('▸ Drafts · 1')
  // With every ready MR parked, Ready does not say nothing is open.
  const allParked = modelOf([stale], { expanded: ['parked'] })
  expect(allParked.parked?.rows.map(row => row.key)).toEqual([stale.key])
  expect(allParked.mine.isEmpty).toBe(false)
})

test("this session's MRs keep the order they came in; one it raised has no unpin, so its wakes cannot be dropped by a press", () => {
  const first = toCard(HOST, rawMr(41))
  const second = toCard(HOST, rawMr(42))
  const third = toCard(HOST, rawMr(43, { headPipeline: pipe('FAILED') }))
  const cards = [first, second, third]
  const pinned = [pinOf(first, 'raised'), pinOf(third), pinOf(second)]
  const model = modelOf(cards, { pinned })
  // The failing one would rank first; the person's order stands instead.
  expect(model.session.map(row => row.mr.text)).toEqual(['🔀 !41', '🔀 !43', '🔀 !42'])
  expect(model.session.map(row => row.pin?.label ?? null)).toEqual([null, 'unpin', 'unpin'])
  expect(modelOf(cards).mine.rows.map(row => row.pin?.label)).toEqual(['pin', 'pin', 'pin'])
  // The press is a star, as anywhere else: filled on an MR pinned here, hollow on one that is not.
  expect(model.session.map(row => row.pin?.mark ?? null)).toEqual([null, '★', '★'])
  expect(modelOf(cards).mine.rows.map(row => row.pin?.mark)).toEqual(['☆', '☆', '☆'])
})

test('the list draws a shared slim card as it draws the whole one', () => {
  fc.assert(
    fc.property(fc.array(readCardArb, { maxLength: 6 }), cards => {
      // One card to a key, as the list holds them.
      const full = cards.map((one, i) => ({ ...one, key: `${one.key}-${i}`, iid: one.iid + 100 * i }))
      const whole = drawnRows(full)
      expect(whole.mine.length + whole.drafts.length).toBe(full.length)
      expect(drawnRows(full.map(slimCard))).toEqual(whole)
    })
  )
})
