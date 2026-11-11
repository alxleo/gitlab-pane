import { expect, test } from 'vitest'

import { LANDED_SHOWN, LANDED_WITHIN_MS } from '../../hooks/landed.ts'
import { mergedModel } from '../../hooks/landed-model.ts'
import { NOW } from '../fixtures.ts'

import type { Landed } from '../../types'

const SHA = 'a'.repeat(40)

const landed = (iid: number, over: Partial<Landed> = {}): Landed => ({
  host: 'gitlab.com',
  path: 'g/p',
  iid,
  title: `feat: [ABC-${iid}] thing ${iid}`,
  url: `https://gitlab.com/g/p/-/merge_requests/${iid}`,
  mergedAt: NOW - 2 * 3_600_000,
  targetBranch: 'main',
  sha: SHA,
  build: { status: 'success', url: `https://gitlab.com/g/p/-/pipelines/${iid}0` },
  checkedAt: NOW,
  ...over,
})

const failed = (iid: number) => landed(iid, { build: { status: 'failed', url: `https://gitlab.com/g/p/-/pipelines/${iid}0` } })

const shown = (over: Partial<Parameters<typeof mergedModel>[1]> = {}) => ({ cardKeys: new Set<string>(), repoFilter: '', isOpen: false, now: NOW, ...over })

test('nothing merged lately draws no section', () => {
  expect(mergedModel([], shown())).toBeNull()
})

test('folded, the section says how many merged, and a healthy or running build adds nothing', () => {
  const running = landed(2, { build: { status: 'running', url: 'https://gitlab.com/g/p/-/pipelines/20' } })
  const none = landed(3, { build: null })
  const unknown = landed(4, { sha: null, build: null })
  expect(mergedModel([landed(1), running, none, unknown], shown())).toEqual({ label: '▸ 4 merged', isOpen: false, rows: [] })
  expect(mergedModel([landed(1)], shown())?.label).toBe('▸ 1 merged')
})

test('folded, only a failed build is said, counted, so a failure never waits behind the fold', () => {
  expect(mergedModel([landed(1), failed(2), landed(3)], shown())?.label).toBe('▸ 3 merged · 1 build ✗')
  expect(mergedModel([failed(1), failed(2), landed(3)], shown())?.label).toBe('▸ 3 merged · 2 builds ✗')
})

test('open, the rows hold each build, so the line says no failure twice', () => {
  const open = mergedModel([failed(1), landed(2)], shown({ isOpen: true }))
  expect(open?.label).toBe('▾ 2 merged')
  expect(open?.rows.map(row => row.build)).toEqual([
    { kind: 'mark', glyph: '✗', tone: 'error', link: { href: 'https://gitlab.com/g/p/-/pipelines/10', text: '🚦 main' } },
    { kind: 'mark', glyph: '✓', tone: 'success', link: { href: 'https://gitlab.com/g/p/-/pipelines/20', text: '🚦 main' } },
  ])
})

test("a row is the MR's link with its title, how long ago it merged, and the build on the target branch", () => {
  const [row] = mergedModel([landed(7, { mergedAt: NOW - 3 * 3_600_000, targetBranch: 'release/2.1' })], shown({ isOpen: true }))?.rows ?? []
  expect(row?.mr).toEqual({ href: 'https://gitlab.com/g/p/-/merge_requests/7', text: '🔀 !7 thing 7' })
  expect(row?.ago).toBe('3h')
  expect(row?.build).toMatchObject({ link: { text: '🚦 release/2.1' } })
})

test('a title too long for a link that cannot wrap is cut', () => {
  const [row] = mergedModel([landed(1, { title: `fix: ${'long '.repeat(40)}` })], shown({ isOpen: true }))?.rows ?? []
  expect(row?.mr.text.length).toBeLessThan(60)
  expect(row?.mr.text.endsWith('…')).toBe(true)
})

test('a build not yet seen is the mark for no pipeline, and a commit that could not be told has no mark', () => {
  const rows = mergedModel([landed(1, { build: null }), landed(2, { sha: null, build: null })], shown({ isOpen: true }))?.rows ?? []
  expect(rows[0]?.build).toEqual({ kind: 'mark', glyph: '○', tone: 'subtle', link: null })
  expect(rows[1]?.build).toEqual({ kind: 'unknown', words: 'build unknown' })
})

test('an MR the list still draws as a card is not said twice', () => {
  const cardKeys = new Set(['gitlab.com/g/p!2'])
  expect(mergedModel([landed(1), landed(2)], shown({ cardKeys, isOpen: true }))?.rows.map(row => row.key)).toEqual(['gitlab.com/g/p!1'])
  expect(mergedModel([landed(2)], shown({ cardKeys }))).toBeNull()
})

test('what the snapshot kept past three days is not drawn, nor counted, nor its failed build said; one at the edge is', () => {
  const old = landed(1, { mergedAt: NOW - LANDED_WITHIN_MS - 1, build: { status: 'failed', url: 'https://gitlab.com/g/p/-/pipelines/10' } })
  const edge = landed(2, { mergedAt: NOW - LANDED_WITHIN_MS })
  expect(mergedModel([old, edge], shown())?.label).toBe('▸ 1 merged')
  expect(mergedModel([old], shown())).toBeNull()
  expect(mergedModel([old, edge], shown({ isOpen: true }))?.rows.map(row => row.key)).toEqual(['gitlab.com/g/p!2'])
})

test('more than five kept, from several hosts, draw the five newest, newest first', () => {
  const entries = [1, 2, 3, 4, 5, 6, 7].map(iid => landed(iid, { mergedAt: NOW - iid * 3_600_000, host: iid % 2 === 0 ? 'git.example.com' : 'gitlab.com' }))
  const model = mergedModel(entries.toReversed(), shown({ isOpen: true }))
  expect(model?.label).toBe(`▾ ${LANDED_SHOWN} merged`)
  expect(model?.rows.map(row => row.mr.text.slice(3, 6))).toEqual(['!1 ', '!2 ', '!3 ', '!4 ', '!5 '])
})

test('a repo picked narrows the section to its own MRs, and none left draws no section', () => {
  const other = landed(5, { path: 'g/q' })
  expect(mergedModel([landed(1), other], shown({ repoFilter: 'gitlab.com/g/q', isOpen: true }))?.rows.map(row => row.key)).toEqual(['gitlab.com/g/q!5'])
  expect(mergedModel([landed(1)], shown({ repoFilter: 'gitlab.com/g/q' }))).toBeNull()
})
