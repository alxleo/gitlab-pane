import { expect, test } from 'vitest'

import { Failure } from '../../hooks/failure.ts'
import type { LandedQuery } from '../../hooks/gitlab.generated.ts'
import { BUILD_APPEARS_MS, LANDED_SHOWN, LANDED_WITHIN_MS, buildOf, isBuildDue, keptLanded, landingOf, mergeRequestPath, mergedLately, squashShaOf } from '../../hooks/landed.ts'
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

test('a build that ended is not looked for again, one that has not or waits on a person is', () => {
  for (const status of ['success', 'failed', 'canceled', 'skipped'] as const) {
    expect(isBuildDue(entry({ build: built(status), checkedAt: NOW }), NOW - 60 * 60_000)).toBe(false)
  }
  for (const status of ['running', 'pending', 'manual', 'unknown'] as const) {
    expect(isBuildDue(entry({ build: built(status), checkedAt: NOW }), NOW - 60 * 60_000)).toBe(true)
  }
})

test('with no build seen yet, it is looked for until a look made after GitLab could have started one finds none', () => {
  const mergedAt = NOW - 60 * 60_000
  expect(isBuildDue(undefined, mergedAt)).toBe(true)
  expect(isBuildDue(entry({ sha: null }), mergedAt)).toBe(true)
  expect(isBuildDue(entry({ checkedAt: null }), mergedAt)).toBe(true)
  expect(isBuildDue(entry({ checkedAt: mergedAt + BUILD_APPEARS_MS - 1 }), mergedAt)).toBe(true)
  expect(isBuildDue(entry({ checkedAt: mergedAt + BUILD_APPEARS_MS }), mergedAt)).toBe(false)
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
