import { expect, test } from 'vitest'

import { Failure } from '../../hooks/failure.ts'
import type { LandedQuery } from '../../hooks/gitlab.generated.ts'
import {
  BUILD_APPEARS_MS,
  LANDED_SHOWN,
  LANDED_WITHIN_MS,
  RECHECK_MS,
  buildOf,
  isDue,
  keptLanded,
  knownLanded,
  landingOf,
  mergeRequestPath,
  mergedLately,
  squashShaOf,
  withLanded,
} from '../../hooks/landed.ts'
import { NOW } from '../fixtures.ts'

import type { Landed } from '../../types'

const MERGE = 'a'.repeat(40)
const SQUASH = 'b'.repeat(40)
const HEAD = 'c'.repeat(40)

const ISO = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

/** An MR of the user's in the inbox's answer, merged `minutes` ago. */
const raw = (iid: number, minutes: number, over: Record<string, unknown> = {}) => ({
  iid: String(iid),
  state: 'merged' as const,
  title: `feat: [ABC-${iid}] thing ${iid}`,
  webUrl: `https://gitlab.com/g/p/-/merge_requests/${iid}`,
  draft: false,
  createdAt: ISO(10_000),
  author: { username: 'me', name: 'Me' },
  project: { fullPath: 'g/p' },
  mergedAt: ISO(minutes),
  mergeUser: { username: 'me', name: 'Me' },
  targetBranch: 'main',
  mergeCommitSha: null,
  diffHeadSha: null,
  ...over,
})

const answer = (...nodes: (ReturnType<typeof raw> | null)[]) => ({ currentUser: { username: 'me', opened: { nodes: [] }, merged: { nodes } } })

// ---- which commit landed -------------------------------------------------------------------------------------------------

test('a merge commit is the commit that landed, whether or not the MR was squashed, and nothing more is asked', () => {
  const merged = { mergeCommitSha: MERGE, diffHeadSha: HEAD }
  expect(landingOf(merged, undefined)).toEqual({ kind: 'landed', sha: MERGE })
  // A squash commit beside it sits on the source branch, not the target: the merge commit still lands.
  expect(landingOf(merged, SQUASH)).toEqual({ kind: 'landed', sha: MERGE })
})

test('a fast-forward merge without a squash lands the head the MR had, once GitLab has said there is no squash commit', () => {
  const merged = { mergeCommitSha: null, diffHeadSha: HEAD }
  expect(landingOf(merged, null)).toEqual({ kind: 'landed', sha: HEAD })
})

test('a fast-forward merge with a squash lands the squash commit, never the head the MR had', () => {
  const merged = { mergeCommitSha: null, diffHeadSha: HEAD }
  expect(landingOf(merged, SQUASH)).toEqual({ kind: 'landed', sha: SQUASH })
})

test('a merge with no merge commit asks for the squash commit before it says anything, and is unknown when nothing says which landed', () => {
  expect(landingOf({ mergeCommitSha: null, diffHeadSha: HEAD }, undefined)).toEqual({ kind: 'ask-squash-commit' })
  expect(landingOf({ mergeCommitSha: null, diffHeadSha: null }, undefined)).toEqual({ kind: 'ask-squash-commit' })
  expect(landingOf({ mergeCommitSha: null, diffHeadSha: null }, null)).toEqual({ kind: 'unknown' })
})

test("the squash commit is read from an MR's REST entity, its path encoded, and anything that is no entity is a failure", () => {
  expect(mergeRequestPath('g/sub/p', 7)).toBe('projects/g%2Fsub%2Fp/merge_requests/7')
  expect(squashShaOf({ status: 200, text: JSON.stringify({ iid: 7, squash_commit_sha: SQUASH }) })).toBe(SQUASH)
  expect(squashShaOf({ status: 200, text: JSON.stringify({ iid: 7, squash_commit_sha: null }) })).toBeNull()
  expect(squashShaOf({ status: 200, text: JSON.stringify({ iid: 7, squash_commit_sha: '' }) })).toBeNull()
  expect(squashShaOf({ status: 200, text: JSON.stringify({ iid: 7 }) })).toBeNull()
  expect(() => squashShaOf({ status: 404, text: '{}' })).toThrow(Failure)
  expect(() => squashShaOf({ status: 502, text: '<html>' })).toThrow(Failure)
  expect(() => squashShaOf({ status: 200, text: '<html>' })).toThrow(Failure)
  expect(() => squashShaOf({ status: 200, text: '[]' })).toThrow(Failure)
})

// ---- which merges count --------------------------------------------------------------------------------------------------

test('the user’s MRs merged within three days are listed newest first, whoever merged them, at most five', () => {
  const found = mergedLately(
    'gitlab.com',
    answer(raw(1, 60, { mergeUser: { username: 'dave', name: 'Dave' } }), raw(2, 30), raw(3, 90), raw(4, 120), raw(5, 150), raw(6, 180), raw(7, 240)),
    NOW
  )
  expect(found.map(one => one.iid)).toEqual([2, 1, 3, 4, 5])
  expect(found.length).toBe(LANDED_SHOWN)
  // The inbox's own list leaves out what the user merged themselves: this one does not.
  expect(mergedLately('gitlab.com', answer(raw(3, 5)), NOW).map(one => one.iid)).toEqual([3])
})

test('a merge older than three days is left out, and one at the edge is not', () => {
  const edge = (LANDED_WITHIN_MS - 1) / 60_000
  const found = mergedLately('gitlab.com', answer(raw(1, edge), raw(2, edge + 1)), NOW)
  expect(found.map(one => one.iid)).toEqual([1])
})

test('an MR GitLab names no merge time for, or sent as null, is left out; the rest keeps its link, branch and commits', () => {
  const found = mergedLately(
    'gitlab.com',
    answer(null, raw(1, 5, { mergedAt: null }), raw(2, 5, { mergeCommitSha: MERGE, diffHeadSha: '', webUrl: null, targetBranch: 'release/1' })),
    NOW
  )
  expect(found).toEqual([
    {
      host: 'gitlab.com',
      path: 'g/p',
      iid: 2,
      title: 'feat: [ABC-2] thing 2',
      url: 'https://gitlab.com/g/p/-/merge_requests/2',
      mergedAt: NOW - 5 * 60_000,
      targetBranch: 'release/1',
      mergeCommitSha: MERGE,
      diffHeadSha: null,
    },
  ])
  expect(mergedLately('gitlab.com', null, NOW)).toEqual([])
})

// ---- the build -----------------------------------------------------------------------------------------------------------

type Pipelines = NonNullable<NonNullable<NonNullable<LandedQuery['project']>['pipelines']>['nodes']>

const answered = (nodes: Pipelines) => buildOf('gitlab.com', 'https://gitlab.com/g/p/-/merge_requests/1', { data: { project: { pipelines: { nodes } } } })

test("the build is the pipeline GitLab named, with its status as the pane names it and its page's address", () => {
  expect(answered([{ id: 'gid://gitlab/Ci::Pipeline/9', status: 'FAILED', path: '/g/p/-/pipelines/9' }])).toEqual({ status: 'failed', url: 'https://gitlab.com/g/p/-/pipelines/9' })
  expect(answered([{ id: 'gid://gitlab/Ci::Pipeline/9', status: 'RUNNING', path: null }])).toEqual({ status: 'running', url: 'https://gitlab.com/g/p/-/merge_requests/1' })
})

test('no pipeline on the commit is no build, and a project out of reach is the same', () => {
  expect(answered([])).toBeNull()
  expect(answered([null])).toBeNull()
  expect(buildOf('gitlab.com', '', { data: { project: null } })).toBeNull()
  expect(() => buildOf('gitlab.com', '', { errors: [{ message: 'timeout' }] })).toThrow(Failure)
})

const entry = (over: Partial<Landed> = {}): Landed => ({
  host: 'gitlab.com',
  path: 'g/p',
  iid: 1,
  title: 'thing',
  url: 'https://gitlab.com/g/p/-/merge_requests/1',
  mergedAt: NOW - 60 * 60_000,
  targetBranch: 'main',
  sha: MERGE,
  build: null,
  checkedAt: null,
  ...over,
})

const built = (status: 'success' | 'failed' | 'canceled' | 'skipped' | 'running' | 'pending' | 'manual' | 'unknown') => ({ status, url: 'https://gitlab.com/g/p/-/pipelines/9' })

const MERGED_AT = NOW - 60 * 60_000

test('a build that passed, was canceled or was skipped is never asked for again, whatever ↻', () => {
  for (const status of ['success', 'canceled', 'skipped'] as const) {
    expect(isDue(entry({ build: built(status), checkedAt: NOW - 3 * RECHECK_MS }), MERGED_AT, NOW, false)).toBe(false)
    expect(isDue(entry({ build: built(status), checkedAt: NOW - 3 * RECHECK_MS }), MERGED_AT, NOW, true)).toBe(false)
  }
})

test('a build still running is asked for at every read', () => {
  for (const status of ['running', 'pending', 'unknown'] as const) {
    expect(isDue(entry({ build: built(status), checkedAt: NOW }), MERGED_AT, NOW, false)).toBe(true)
  }
})

test('a build that failed or waits on a person is asked for again after the recheck period, or at once on ↻, and not before', () => {
  for (const status of ['failed', 'manual'] as const) {
    const asked = (ago: number, isAsked: boolean) => isDue(entry({ build: built(status), checkedAt: NOW - ago }), MERGED_AT, NOW, isAsked)
    expect(asked(0, false)).toBe(false)
    expect(asked(RECHECK_MS - 1, false)).toBe(false)
    expect(asked(RECHECK_MS, false)).toBe(true)
    expect(asked(0, true)).toBe(true)
  }
})

test('a squash commit GitLab would not name is asked for again after the recheck period, or at once on ↻, and not before', () => {
  const asked = (ago: number, isAsked: boolean) => isDue(entry({ sha: null, checkedAt: NOW - ago }), MERGED_AT, NOW, isAsked)
  expect(asked(RECHECK_MS - 1, false)).toBe(false)
  expect(asked(RECHECK_MS, false)).toBe(true)
  expect(asked(0, true)).toBe(true)
  // One never asked for is asked for at the first read.
  expect(isDue(entry({ sha: null, checkedAt: null }), MERGED_AT, NOW, false)).toBe(true)
  expect(isDue(undefined, MERGED_AT, NOW, false)).toBe(true)
})

test('with no build seen yet, it is looked for until a look made after GitLab could have started one finds none', () => {
  const due = (over: Partial<Landed>, isAsked = false) => isDue(entry(over), MERGED_AT, NOW, isAsked)
  expect(due({ checkedAt: null })).toBe(true)
  expect(due({ checkedAt: MERGED_AT + BUILD_APPEARS_MS - 1 })).toBe(true)
  expect(due({ checkedAt: MERGED_AT + BUILD_APPEARS_MS })).toBe(false)
  // ↻ asks once more even for that.
  expect(due({ checkedAt: MERGED_AT + BUILD_APPEARS_MS }, true)).toBe(true)
})

// ---- what a stored list holds --------------------------------------------------------------------------------------------

test('a stored list keeps the entries that are one, and an older snapshot with no list, or a list of anything else, keeps none', () => {
  const good = entry({ build: built('failed'), checkedAt: NOW })
  expect(keptLanded([good, entry({ iid: 2, sha: null })])).toEqual([good, entry({ iid: 2, sha: null })])
  expect(keptLanded(undefined)).toEqual([])
  expect(keptLanded({})).toEqual([])
  expect(
    keptLanded([
      null,
      'x',
      { ...good, mergedAt: 'yesterday' },
      { ...good, build: { status: 'exploded', url: '' } },
      { ...good, build: 3 },
      { ...good, checkedAt: undefined },
      { ...good, sha: 7 },
    ])
  ).toEqual([])
})

// ---- the list before GitLab is asked, and the answer put into it ---------------------------------------------------------

const lately = (iid: number, minutes: number) => mergedLately('gitlab.com', answer(raw(iid, minutes, { mergeCommitSha: MERGE })), NOW)

test('the list the inbox gives is there before GitLab is asked, each MR with what was kept of its commit and build and none with what was not', () => {
  const kept = [entry({ iid: 1, build: built('failed'), checkedAt: NOW - 5 * 60_000 })]
  const known = knownLanded([{ host: 'gitlab.com', merged: [...lately(1, 30), ...lately(2, 20)] }], kept)
  expect(known.map(each => [each.iid, each.sha, each.build?.status ?? null, each.checkedAt])).toEqual([
    [1, MERGE, 'failed', NOW - 5 * 60_000],
    [2, null, null, null],
  ])
  // What the inbox says now of an MR is what is listed, not what was kept of it.
  expect(known[0]?.title).toBe('feat: [ABC-1] thing 1')
})

test('a host whose inbox answer failed keeps the entries it had, and the others are as their answers say', () => {
  const kept = [entry({ iid: 1 }), entry({ host: 'git.example.com', iid: 9, url: 'https://git.example.com/g/p/-/merge_requests/9' })]
  const known = knownLanded(
    [
      { host: 'gitlab.com', merged: [] },
      { host: 'git.example.com', merged: null },
    ],
    kept
  )
  expect(known.map(each => [each.host, each.iid])).toEqual([['git.example.com', 9]])
})

test('an answer is put in the place of the entry kept for its MR, and an MR the list has dropped meanwhile is not brought back', () => {
  const kept = [entry({ iid: 1 }), entry({ iid: 2, build: built('running') })]
  const found = [entry({ iid: 2, build: built('failed'), checkedAt: NOW }), entry({ iid: 3, build: built('success') })]
  expect(withLanded(kept, found)).toEqual([entry({ iid: 1 }), entry({ iid: 2, build: built('failed'), checkedAt: NOW })])
})
