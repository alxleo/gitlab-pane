import { expect, test } from 'vitest'
import fc from 'fast-check'

import { badges, byAttention, rank, reviewTone, rowBadges, verdictOf } from '../../hooks/attention.ts'
import { failedCount } from '../../hooks/format.ts'
import { cardFacts } from '../../hooks/row-facts.ts'
import { checkStatusOf } from '../../hooks/gitlab-status.ts'
import { toCard } from '../../hooks/gitlab.ts'
import { readCardArb } from './arbitrary.ts'
import { HOST, gitlabSays, job, pipe, rawMr, reviewer, stage, thread } from '../fixtures.ts'
import type { MergeStatus, MrCard } from '../../types'

/** An MR with GitLab's merge checks, as the poll joins them to the authored list. */
const withChecks = (iid: number, says: MergeStatus, over: Parameters<typeof rawMr>[1] = {}): MrCard => ({ ...toCard(HOST, rawMr(iid, over)), mergeStatus: says })

const marks = (iid: number, over: Parameters<typeof rawMr>[1] = {}) => badges(toCard(HOST, rawMr(iid, over))).map(badge => `${badge.glyph}${badge.count}`)

test('MRs sort by what you can finish, then what needs you: mergeable, failing, running, waiting, then passed', async () => {
  const ready = toCard(HOST, rawMr(1, { approvalsLeft: 0, updatedAt: '2026-10-23T15:05:00Z' }))
  const waiting = toCard(HOST, rawMr(2))
  const running = toCard(HOST, rawMr(3, { headPipeline: pipe('RUNNING') }))
  const failing = toCard(HOST, rawMr(4, { headPipeline: pipe('FAILED') }))
  const asked = toCard(HOST, rawMr(5, { reviewers: { nodes: [reviewer('tim', 'REQUESTED_CHANGES')] } }))
  // GitLab says these two can merge: one quiet, one with a person's open thread its project does not make you resolve, which
  // ranks it as needing you. Both come before everything else, the latest first, as the green verdict on each says.
  const mergeable = withChecks(6, gitlabSays(), { approvalsLeft: 0, updatedAt: '2026-10-23T15:01:00Z' })
  const mergeableWithThread = withChecks(7, gitlabSays(), { approvalsLeft: 0, updatedAt: '2026-10-23T15:02:00Z', discussions: { nodes: [thread('Nit: rename this.')] } })
  expect(rank(mergeableWithThread)).toBe(0)

  expect([ready, waiting, running, mergeable, asked, failing, mergeableWithThread].toSorted(byAttention).map(card => card.iid)).toEqual([7, 6, 5, 4, 3, 2, 1])
})

test('on a host with no merge checks each blocker is its own marker: a glyph and a count, no words', async () => {
  expect(
    marks(1, {
      conflicts: true,
      reviewers: { nodes: [reviewer('GitLabDuo', 'REQUESTED_CHANGES', true)] },
      discussions: { nodes: [thread('a'), thread('b', 'x', true)] },
    })
  ).toEqual(['⇄', '💬1', '🤖1', '👤0/1'])
  expect(marks(2, { approvalsLeft: 0 })).toEqual(['👤1/1', '⤵'])
  expect(marks(3, { approvalsLeft: 0, approvalsRequired: 0 })).toEqual(['⤵'])
})

test('failed and manual jobs are read from the stages: amber when allowed to fail, blocking only when not optional', async () => {
  const over = {
    headPipeline: pipe('SUCCESS', {
      stages: {
        nodes: [
          stage('test', 'SUCCESS', [job('lint', 'FAILED', { allowFailure: true }), job('unit', 'SUCCESS')]),
          stage('e2e', 'MANUAL', [job('native-e2e', 'MANUAL', { allowFailure: true }), job('run-full-ci', 'MANUAL')]),
        ],
      },
    }),
  }
  const card = toCard(HOST, rawMr(1, over))
  expect(marks(1, over)).toEqual(['⏸', '⚠1', '👤0/1'])
  expect(card.pipeline?.failed).toEqual([])
  expect(card.pipeline?.amber).toEqual([{ name: 'lint', url: 'https://gitlab.com/g/p/-/jobs/lint' }])
  expect(card.pipeline?.stages.map(one => `${one.name}:${one.jobs.length}`)).toEqual(['test:2', 'e2e:2'])
})

test("GitLab's own merge checks give the verdict: its first failing check in words, mergeable when none stops it, nothing when none was read", async () => {
  const said = (mergeStatus: MergeStatus | null) => {
    const verdict = verdictOf({ ...toCard(HOST, rawMr(1)), mergeStatus })
    return verdict !== null ? [verdict.words, verdict.tone] : null
  }
  expect(said(gitlabSays())).toEqual(['✓ mergeable', 'success'])
  // GitLab lists the checks in the order that settles which one it reports, so the first that fails is the one said.
  expect(said(gitlabSays({ CI_MUST_PASS: 'failed', DRAFT_STATUS: 'failed', NOT_APPROVED: 'failed' }))).toEqual(['draft status', 'subtle'])
  expect(said(gitlabSays({ CI_MUST_PASS: 'failed' }))).toEqual(['CI must pass', 'error'])
  expect(said(gitlabSays({ CI_MUST_PASS: 'checking', NOT_APPROVED: 'failed' }))).toEqual(['needs 1 approval', 'subtle'])
  // Red is what you must fix, amber a smaller fix, grey what waits on others or on time.
  expect(said(gitlabSays({ CONFLICT: 'failed' }))).toEqual(['conflict', 'error'])
  expect(said(gitlabSays({ NEED_REBASE: 'failed' }))).toEqual(['need rebase', 'warning'])
  expect(said(gitlabSays({ DISCUSSIONS_NOT_RESOLVED: 'failed' }))).toEqual(['discussions not resolved', 'warning'])
  // Unresolved threads it has read, it counts, as it counts approvals.
  const threads = { discussions: { nodes: [thread('Rename this.', 'bob'), thread('And this.', 'alice')] } }
  const counted = verdictOf({ ...toCard(HOST, rawMr(1, threads)), mergeStatus: gitlabSays({ DISCUSSIONS_NOT_RESOLVED: 'failed' }) })
  expect(counted?.words).toBe('2 open threads')
  expect(said(gitlabSays({ REQUESTED_CHANGES: 'failed' }))).toEqual(['requested changes', 'error'])
  expect(said(gitlabSays({ MERGE_TIME: 'failed' }))).toEqual(['merge time', 'subtle'])
  expect(said(gitlabSays({ SECURITY_POLICY_VIOLATIONS: 'failed' }))).toEqual(['security policy violations', 'error'])
  expect(said(gitlabSays({ CI_MUST_PASS: 'checking' }))).toEqual(['CI must pass (checking)', 'subtle'])
  // A warning passed with a note, and a check the project turned off is not one.
  expect(said(gitlabSays({ JIRA_ASSOCIATION_MISSING: 'warning', MERGE_TIME: 'inactive' }))).toEqual(['✓ mergeable', 'success'])
  // A check and a status GitLab adds later read from their names, and a status the pane cannot name is not a pass.
  expect(said([...gitlabSays(), { id: 'A_CHECK_GITLAB_ADDS_LATER', status: 'failed' }])).toEqual(['a check gitlab adds later', 'error'])
  expect(said([...gitlabSays(), { id: 'X', status: checkStatusOf('A_STATUS_GITLAB_ADDS_LATER') }])).toBe(null)
  expect(said(null)).toBe(null)
  expect(said([])).toBe(null)
})

test('every check GitLab fails or warns of is a marker, worst first, with a pane marker standing in for the check it gives the detail of', async () => {
  const card = withChecks(1, gitlabSays({ DRAFT_STATUS: 'failed', JIRA_ASSOCIATION_MISSING: 'warning', NOT_APPROVED: 'failed', CONFLICT: 'failed' }), { conflicts: true })
  // The conflict is GitLab's to say, so the pane's own ⇄ stays out; the approvals count stands for NOT_APPROVED.
  expect(badges(card).map(badge => `${badge.glyph} ${badge.words}`)).toEqual(['✗ draft status', '✗ conflict', '⚠ jira association missing', '👤 needs 1 approval'])
  const facts = cardFacts(card, {})
  expect(facts.verdict?.words).toBe('draft status')
  expect(facts.trailing.map(badge => badge.words)).toEqual(['conflict', 'jira association missing', 'needs 1 approval'])
  expect(cardFacts(withChecks(2, gitlabSays({ NOT_APPROVED: 'failed' })), {}).trailing).toEqual([])
  expect(cardFacts(withChecks(3, gitlabSays(), { approvalsLeft: 0 }), {}).trailing).toEqual([])
})

test('an icon speaks for a request for changes, and still the check GitLab fails shows on the row', async () => {
  const card = withChecks(1, gitlabSays({ REQUESTED_CHANGES: 'failed' }), { reviewers: { nodes: [reviewer('tim', 'REQUESTED_CHANGES')] } })
  expect(badges(card).map(badge => badge.kind)).toEqual(['changes', 'approvals'])
  expect(rowBadges(card).map(badge => `${badge.kind}:${badge.words}`)).toEqual(['check:requested changes', 'approvals:needs 1 approval'])
})

test("a card GitLab gave no checks for still gets the pane's own markers for conflicts and a rebase", async () => {
  const card = toCard(HOST, rawMr(1, { conflicts: true, shouldBeRebased: true }))
  expect(card.mergeStatus).toBeNull()
  expect(badges(card).map(badge => badge.words)).toEqual(['conflicts', 'needs rebase', 'needs 1 approval'])
  expect(verdictOf(card)).toBeNull()
})

/** What stops a merge, worked out from the card's own fields and nothing in attention.ts. */
const isBlocked = (card: MrCard): boolean =>
  card.pipeline?.status === 'failed' ||
  (card.pipeline?.failed.length ?? 0) > 0 ||
  card.hasConflicts ||
  card.needsRebase ||
  card.changesRequestedBy.length > 0 ||
  card.openThreads.length > 0

test('a card ranks 0 if and only if something blocks its merge, and a blocked card is neither ready nor mergeable', () => {
  const isReady = (card: MrCard): boolean => badges(card).some(badge => badge.kind === 'ready')
  fc.assert(
    fc.property(readCardArb, card => {
      expect(rank(card) === 0).toBe(isBlocked(card))
    })
  )
  // Each of the rest holds for a kind of card, so each is run on cards of that kind, not on every card with the others skipped.
  fc.assert(
    fc.property(readCardArb.filter(isBlocked), card => {
      expect(isReady(card)).toBe(false)
      expect(verdictOf(card)?.tone).not.toBe('success')
    })
  )
  // Ready is about one generated card in five hundred, so these are made to order, and fewer of them.
  fc.assert(
    fc.property(readCardArb.filter(isReady), card => {
      expect(rank(card)).toBe(3)
    }),
    { numRuns: 20 }
  )
  // A job that failed turns the border red, as it puts the card under "needs you", even while the pipeline still runs.
  fc.assert(
    fc.property(
      readCardArb.filter(card => card.pipeline !== undefined && failedCount(card.pipeline) > 0),
      card => {
        expect(reviewTone(card)).toBe('error')
      }
    )
  )
  // A card with no merge checks read marks each blocker itself, so a blocked one always shows a marker or a failed pipeline.
  fc.assert(
    fc.property(
      readCardArb.filter(card => card.mergeStatus === null && isBlocked(card)),
      card => {
        expect(badges(card).length > 0 || card.pipeline?.status === 'failed').toBe(true)
      }
    )
  )
})
