import { expect, test } from 'vitest'
import fc from 'fast-check'

import { firstRunLines } from '../../hooks/first-run.ts'
import { cleanBody, toCard } from '../../hooks/gitlab.ts'
import { buildPane, MINE_SHOWN } from '../../hooks/pane-model.ts'
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
      tickets: {},
      usual: {},
      browse: '',
      expanded: [],
      chosen: {},
      repoFilter: '',
      view: 'mine',
      news: 0,
      poll: { fetchedAt: NOW, error: null, hosts: {} },
      isReading: false,
      isWaking: true,
      failures: {},
      ...over,
    },
    NOW,
    { hasSvg: true },
    { room, sizeOf: (row, piece) => cost(piece, row) }
  )

test('beside the tabs, the age of the cards, with ↻ while a read is out; the footer speaks only of what went wrong', () => {
  const threeHours = { fetchedAt: NOW - 3 * 3_600_000, error: null, hosts: {} }
  expect(modelOf([], { poll: threeHours }).status).toEqual({ text: 'updated 3h ago', isWarning: false })
  expect(modelOf([], { poll: threeHours, isReading: true }).status).toEqual({ text: '↻ updated 3h ago', isWarning: false })
  expect(modelOf([], { poll: { fetchedAt: null, error: null, hosts: {} }, isReading: true }).status.text).toBe('↻ reading GitLab…')
  expect(modelOf([], { poll: { fetchedAt: null, error: null, hosts: {} } }).status.text).toBe('')
  expect(modelOf([], { poll: threeHours }).footer.text).toBe('')
  const failed = { fetchedAt: NOW - 600_000, error: 'connection refused', hosts: { [HOST]: { fetchedAt: NOW - 600_000, error: 'connection refused' } } }
  expect(modelOf([], { poll: failed }).status).toEqual({ text: 'updated 10m ago', isWarning: true })
  expect(modelOf([], { poll: failed }).footer).toMatchObject({ text: 'GitLab read failed: connection refused; showing 10m old data', isWarning: true })
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

test('a render works out the facts of the rows drawn alone, and measures each piece of a row at most once', async () => {
  const worked = new Set<string>()
  // cardFacts is the only reader of a card's description, so a card whose description is read has its facts worked out.
  const cards = Array.from({ length: 50 }, (_, i) => {
    const card = toCard(HOST, rawMr(300 + i, { headPipeline: pipe(i % 2 === 0 ? 'FAILED' : 'SUCCESS') }))
    return Object.defineProperty({ ...card }, 'description', {
      enumerable: true,
      get: () => {
        worked.add(card.key)
        return card.description
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
  // Three kinds of piece for a row without detail: its head, its cards, and its faces if it has pictures.
  expect(measured.size).toBeLessThanOrEqual(MINE_SHOWN * 3)
})

test('the model fills the room by what needs you: rows, then hover cards; rows past the room are counted', async () => {
  const cards = Array.from({ length: 12 }, (_, i) =>
    toCard(HOST, rawMr(100 + i, { updatedAt: `2026-10-23T15:${String(10 + i).padStart(2, '0')}:00Z`, headPipeline: pipe(i % 2 === 0 ? 'FAILED' : 'SUCCESS') }))
  )
  const cost = (piece: Piece) => (piece === 'head' ? 10_000 : piece === 'cards' ? 5_000 : 1_000)
  const folded = modelOf(cards, { expanded: ['more'] }, cost)
  // Seven rows of 10,000 fit 79,000; the failing ones, latest first, come in before the passing.
  const drawn = folded.mine.rows.filter(row => row.fit.isDrawn)
  expect(drawn.length).toBe(7)
  expect(drawn.map(row => row.key).slice(0, 3)).toEqual(
    cards
      .filter((_, i) => i % 2 === 0)
      .map(card => card.key)
      .reverse()
      .slice(0, 3)
  )
  expect(folded.leftOut).toBe('5 more MRs left out to stay within what the app draws; pick a repo above to see them.')
  // What is left after the rows goes to hover cards, in the same order.
  expect(drawn.filter(row => row.fit.hasCards).length).toBe(1)
  // An opened row takes its place before any other: the last, passing one is drawn because it was opened.
  const key = cards[11]?.key ?? ''
  const withDescription = cards.map(card => ({ ...card, description: cleanBody('Does it.', HOST, 'g/p') }))
  const first = modelOf(withDescription, { expanded: ['more', key] }, cost)
  expect(first.mine.rows.find(row => row.key === key)?.fit.isDrawn).toBe(true)
  expect(first.mine.rows.filter(row => row.fit.isDrawn).length).toBe(7)
})

test('an opened row too big for the room is drawn without its detail, and each piece is measured once', async () => {
  const card = { ...toCard(HOST, rawMr(5)), description: cleanBody('Does the thing.', HOST, 'g/p') }
  const asked: string[] = []
  const model = modelOf([card], { expanded: [card.key] }, piece => {
    asked.push(piece)
    return piece === 'detail' ? 90_000 : 1_000
  })
  const [row] = model.mine.rows
  expect(row?.hasDetail).toBe(true)
  expect(row?.fit).toEqual({ isDrawn: true, hasCards: true, hasFaces: false, hasDetail: false })
  expect(asked.filter(piece => piece === 'head').length).toBe(1)
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

test('a ticket Jira cannot be read for says so, instead of waiting for a read that will not come', async () => {
  const card = toCard(HOST, rawMr(7))
  const gone = { jira: { message: 'acli is not installed', at: NOW, kind: 'not-installed' as const } }
  const texts = (failures: PaneInput['failures']) =>
    (modelOf([card], { browse: 'https://jira.example.com/browse/', failures }).mine.rows[0]?.about ?? []).flatMap(line => (line.kind === 'text' ? [line.text] : []))
  expect(texts({})).toContain('ABC-1: not read from Jira yet')
  expect(texts(gone)).toContain('ABC-1: Jira is not available here')
})

/** What a row draws on the list itself: its lines, faces and marks, not the hover cards and the detail, which a shared card holds as excerpts. */
const drawnRows = (cards: MrCard[]) => {
  const model = modelOf(cards, { expanded: ['drafts'] }, () => 1)
  const strip = (row: RowModel) => ({ ...row, about: null, blocks: null, detail: null, people: row.people.map(person => ({ ...person, card: [] })) })
  return { session: model.session.map(strip), mine: model.mine.rows.map(strip), drafts: model.drafts?.rows.map(strip) ?? [], more: model.mine.more, leftOut: model.leftOut }
}

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
