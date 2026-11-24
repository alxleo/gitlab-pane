import { expect, test } from 'vitest'

import { readMergeStatus } from '../hooks/ask-merge-status'
import { cardKey } from '../hooks/hosts'
import { HOST, checks, gitlabSays, mergeStatuses, rawMr } from '../tests/fixtures'

test('each MR with merge checks is read with its checks and what GitLab says of merging it; one with none, or sent as null, has no entry', () => {
  const answer = mergeStatuses([
    rawMr(1, {
      mergeabilityChecks: checks({ CONFLICT: 'FAILED' }),
      merging: { diffHeadSha: 'abc', rebaseInProgress: true, userPermissions: { canMerge: false, pushToSourceBranch: true } },
    }),
    rawMr(2, { mergeabilityChecks: [] }),
  ])
  // Another project's MR, its head unknown, set to merge when its pipeline passes, which the user may merge but not push to.
  const other = {
    iid: '3',
    project: { fullPath: 'g/q' },
    mergeabilityChecks: [{ identifier: 'NEED_REBASE' as const, status: 'FAILED' as const }],
    diffHeadSha: null,
    rebaseInProgress: false,
    autoMergeEnabled: true,
    userPermissions: { canMerge: true, pushToSourceBranch: false },
  }
  const nodes = answer.data.currentUser.authoredMergeRequests.nodes
  const read = readMergeStatus(HOST, { data: { currentUser: { authoredMergeRequests: { nodes: [...nodes, other, null] } } } })
  expect([...read.keys()]).toEqual([cardKey(HOST, 'g/p', 1), cardKey(HOST, 'g/q', 3)])
  expect(read.get(cardKey(HOST, 'g/p', 1))).toEqual({
    checks: gitlabSays({ CONFLICT: 'failed' }),
    merging: { head: 'abc', isRebasing: true, isAutoMerging: false, canMerge: false, canPush: true },
  })
  expect(read.get(cardKey(HOST, 'g/q', 3))).toEqual({
    checks: [{ id: 'NEED_REBASE', status: 'failed' }],
    merging: { head: '', isRebasing: false, isAutoMerging: true, canMerge: true, canPush: false },
  })
})
