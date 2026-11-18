// A made-up GitLab for the harness and the move check: the repo's fixtures as MRs, and a merge that GitLab carries out
// on the next look, so a press is followed the way it is against the real one. No request leaves the process.
import { decodeGraphql } from '../../hooks/decode.ts'
import type { Request } from '../../hooks/gitlab-documents.ts'
import { checks, mergeStatuses, pipe, rawMr, reviewer, thread, user } from '../../tests/fixtures.ts'
import type { Mr } from '../../tests/fixtures.ts'

import type { GitLab } from './read.ts'

/** Made-up MRs that show each kind of row: failed, conflicts, ready to merge, behind its target, running, draft. */
const mrs = (): Mr[] => [
  rawMr(412, {
    title: 'feat: [SHOP-88] basket keeps its items across devices',
    headPipeline: pipe('FAILED'),
    reviewers: { nodes: [reviewer('mira', 'REQUESTED_CHANGES')] },
    discussions: { nodes: [thread('This should not block the main thread.', 'mira')] },
    mergeabilityChecks: checks({ CI_MUST_PASS: 'FAILED' }),
  }),
  rawMr(398, {
    title: 'fix: retry the payment webhook once on a 502',
    conflicts: true,
    approvalsLeft: 0,
    approvedBy: { nodes: [user('tom')] },
    mergeabilityChecks: checks({ CONFLICT: 'FAILED' }),
  }),
  rawMr(405, {
    title: 'chore: raise the image cache to 7 days',
    approvalsLeft: 0,
    approvedBy: { nodes: [user('ana')] },
    reviewers: { nodes: [reviewer('ana', 'APPROVED')] },
    mergeabilityChecks: checks(),
  }),
  rawMr(409, {
    title: 'fix: the order page keeps its scroll position',
    approvalsLeft: 0,
    approvedBy: { nodes: [user('ana')] },
    shouldBeRebased: true,
    mergeabilityChecks: checks({ NEED_REBASE: 'FAILED' }),
  }),
  rawMr(417, { title: 'feat: [SHOP-91] gift cards at checkout', headPipeline: pipe('RUNNING'), reviewers: { nodes: [reviewer('tom', 'UNREVIEWED')] } }),
  rawMr(420, { title: 'Draft: spike the new search ranking', draft: true, headPipeline: pipe('MANUAL') }),
]

/** A GitLab that answers the panel's documents from `mrs()`, and records the writes it was sent. */
export function fakeGitLab(): GitLab & { writes: string[] } {
  let open = mrs()
  const merged = new Set<string>()
  const writes: string[] = []
  const answer = (request: Request<unknown>): unknown => {
    const { variables } = request
    switch (request.operation) {
      case 'Authored':
      case 'AuthoredPlain':
        return { data: { currentUser: { authoredMergeRequests: { nodes: open } } } }
      case 'MergeStatus':
        return mergeStatuses(open)
      case 'MoveState': {
        const iid = String(variables.iid)
        const isMerged = merged.has(iid)
        if (isMerged) {
          open = open.filter(mr => mr.iid !== iid)
        }
        const mr = mrs().find(each => each.iid === iid)
        const isReady = mr !== undefined && (mr.mergeabilityChecks ?? []).every(check => check.status !== 'FAILED')
        return {
          data: {
            project: {
              mergeRequest: {
                state: isMerged ? 'merged' : 'opened',
                detailedMergeStatus: isReady ? 'MERGEABLE' : 'NOT_APPROVED',
                diffHeadSha: `head-${iid}`,
                rebaseCommitSha: null,
                rebaseInProgress: false,
                autoMergeEnabled: false,
                mergeError: null,
                availableAutoMergeStrategies: [],
                squashOnMerge: false,
              },
            },
          },
        }
      }
      case 'Merge':
        writes.push(`merge !${String(variables.iid)} on ${String(variables.sha)}`)
        merged.add(String(variables.iid))
        return { data: { mergeRequestAccept: { errors: [], mergeRequest: { state: 'opened', mergeError: null } } } }
      default:
        return { data: null, errors: [{ message: `the fake has no ${request.operation}` }] }
    }
  }
  return {
    host: 'gitlab.com',
    writes,
    graphql: async <Data>(request: Request<Data>) => decodeGraphql<Data>(answer(request)),
    put: async path => {
      writes.push(`PUT ${path}`)
      return { status: 202, text: '{"rebase_in_progress":true}' }
    },
  }
}
