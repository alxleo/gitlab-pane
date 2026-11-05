// Generators for the property tests: MRs as GitLab would answer them, read into cards by the code under test, so a
// generated card is always one the pane can meet.
import fc from 'fast-check'

import { HOST, job, pipe, rawMr, reviewer, stage, thread } from '../fixtures.ts'
import { toCard } from '../../hooks/gitlab.ts'

import type { CiJobStatus, MergeRequestReviewState, PipelineStatusEnum } from '../../hooks/gitlab.generated.ts'
import type { CheckStatus, MergeStatus, MrCard } from '../../types'

const PIPELINE_STATUSES: readonly PipelineStatusEnum[] = ['CANCELED', 'CREATED', 'FAILED', 'MANUAL', 'PENDING', 'RUNNING', 'SKIPPED', 'SUCCESS']
const JOB_STATUSES: readonly CiJobStatus[] = ['CANCELED', 'CREATED', 'FAILED', 'MANUAL', 'RUNNING', 'SKIPPED', 'SUCCESS']
const REVIEW_STATES: readonly MergeRequestReviewState[] = ['APPROVED', 'REQUESTED_CHANGES', 'REVIEWED', 'REVIEW_STARTED', 'UNAPPROVED', 'UNREVIEWED']
const NAMES = ['ines.mendel', 'ivo.marsh', 'tessa', 'GitLabDuo', 'mel.northcote', 'ixm5302']

const jobArb = fc.record({ name: fc.constantFrom('lint', 'unit', 'e2e', 'build', 'deploy'), status: fc.constantFrom(...JOB_STATUSES), allowFailure: fc.boolean() })

const pipelineArb = fc.record({
  status: fc.constantFrom(...PIPELINE_STATUSES),
  id: fc.integer({ min: 1, max: 5 }),
  stages: fc.array(fc.record({ name: fc.constantFrom('build', 'test', 'ship'), jobs: fc.array(jobArb, { maxLength: 6 }) }), { maxLength: 4 }),
})

/** A heavy-ish MR as GitLab sends it, with the pipeline, reviewers and threads of any shape. */
const rawArb = fc.record({
  iid: fc.integer({ min: 1, max: 40 }),
  pipeline: fc.option(pipelineArb, { nil: undefined }),
  conflicts: fc.boolean(),
  shouldBeRebased: fc.boolean(),
  draft: fc.boolean(),
  approvalsLeft: fc.integer({ min: 0, max: 3 }),
  approvalsRequired: fc.integer({ min: 0, max: 3 }),
  reviewers: fc.array(fc.record({ name: fc.constantFrom(...NAMES), state: fc.constantFrom(...REVIEW_STATES), bot: fc.boolean() }), { maxLength: 4 }),
  threads: fc.array(fc.record({ body: fc.constantFrom('please fix', 'nit', 'why?'), author: fc.constantFrom(...NAMES), resolved: fc.boolean(), bot: fc.boolean() }), {
    maxLength: 8,
  }),
  description: fc.constantFrom('', '## Summary\n\nDoes a thing.', 'Line one\n\n- [x] done\n- [ ] not'),
  updatedAt: fc.constantFrom('2026-10-23T15:00:00Z', '2026-10-23T16:00:00Z', '2026-10-24T09:30:00Z'),
})

/** The card GitLab's answer reads into. No merge checks yet (null), as the authored list gives it. */
const cardArb: fc.Arbitrary<MrCard> = rawArb.map(spec =>
  toCard(
    HOST,
    rawMr(spec.iid, {
      conflicts: spec.conflicts,
      shouldBeRebased: spec.shouldBeRebased,
      draft: spec.draft,
      approvalsLeft: spec.approvalsLeft,
      approvalsRequired: spec.approvalsRequired,
      description: spec.description,
      updatedAt: spec.updatedAt,
      headPipeline:
        spec.pipeline !== undefined
          ? pipe(spec.pipeline.status, {
              id: `gid://gitlab/Ci::Pipeline/${spec.pipeline.id}`,
              stages: {
                nodes: spec.pipeline.stages.map(each =>
                  stage(
                    each.name,
                    'SUCCESS',
                    each.jobs.map(one => job(one.name, one.status, { allowFailure: one.allowFailure }))
                  )
                ),
              },
            })
          : null,
      reviewers: { nodes: spec.reviewers.map(one => reviewer(one.name, one.state, one.bot)) },
      discussions: { nodes: spec.threads.map(one => thread(one.body, one.author, one.resolved, true, one.bot)) },
    })
  )
)

/** GitLab's merge checks for a card, as GitLab would say them given what the card shows: a failing check for each thing that blocks. */
const checksFor = (card: MrCard): MergeStatus => {
  const status = card.pipeline?.status
  const pipelineCheck: CheckStatus =
    status === 'failed' || status === 'canceled' || status === 'manual' ? 'failed' : status !== undefined && status !== 'success' && status !== 'skipped' ? 'checking' : 'success'
  const threads = card.openThreads.length + card.threadsLeft.loose + card.threadsLeft.held
  const failing = (isBad: boolean): CheckStatus => (isBad ? 'failed' : 'success')
  return [
    { id: 'NOT_OPEN', status: 'success' },
    { id: 'REQUESTED_CHANGES', status: failing(card.changesRequestedBy.length > 0) },
    { id: 'DISCUSSIONS_NOT_RESOLVED', status: failing(threads > 0) },
    { id: 'CI_MUST_PASS', status: pipelineCheck },
    { id: 'NOT_APPROVED', status: failing(card.approvalsLeft > 0) },
    { id: 'NEED_REBASE', status: failing(card.needsRebase) },
    { id: 'CONFLICT', status: failing(card.hasConflicts) },
  ]
}

/** A card with the checks GitLab would say for it, or none read. */
export const readCardArb: fc.Arbitrary<MrCard> = fc.tuple(cardArb, fc.boolean()).map(([card, isRead]) => ({ ...card, mergeStatus: isRead ? checksFor(card) : null }))

/** Text with the characters foreign has to deal with in it as often as ordinary ones. */
export const textArb = fc.string({
  unit: fc.oneof(
    fc.constantFrom('\n', '\r', '\t', '\u0000', '\u0007', '\u001B', '\u0085', ' ', ' ', ' ', '​', '‎', '‮', '⁦', '⁩', '﻿', ' ', 'ß', 'é', '…', '️', '\u{E0139}', 'ㅤ'),
    fc
      .integer({ min: 0, max: 0x10ffff })
      .filter(code => code < 0xd800 || code > 0xdfff)
      .map(code => String.fromCodePoint(code)),
    fc.string({ unit: 'binary-ascii', maxLength: 1 })
  ),
  maxLength: 300,
})
