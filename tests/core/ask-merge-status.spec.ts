import { expect, test } from 'vitest'

import { readMergeStatus } from '../../hooks/ask-merge-status.ts'
import { cardKey } from '../../hooks/hosts.ts'
import { HOST, checks, gitlabSays, mergeStatuses, rawMr } from '../fixtures.ts'

test('each MR with merge checks is read with its checks and what GitLab says of merging it; one with none, or sent as null, has no entry', () => {
  const answer = mergeStatuses([
    rawMr(1, {
      mergeabilityChecks: checks({ CONFLICT: 'FAILED' }),
      merging: { diffHeadSha: 'abc', rebaseInProgress: true, userPermissions: { canMerge: false, pushToSourceBranch: true } },
    }),
    rawMr(2, { mergeabilityChecks: [] }),
    rawMr(3, { mergeabilityChecks: [{ identifier: 'NEED_REBASE', status: 'FAILED' }] }),
  ])
  const nodes = answer.data.currentUser.authoredMergeRequests.nodes
  const read = readMergeStatus(HOST, { data: { currentUser: { authoredMergeRequests: { nodes: [...nodes, null] } } } })
  expect([...read.keys()]).toEqual([cardKey(HOST, 'g/p', 1), cardKey(HOST, 'g/p', 3)])
  expect(read.get(cardKey(HOST, 'g/p', 1))).toEqual({
    checks: gitlabSays({ CONFLICT: 'failed' }),
    merging: { head: 'abc', isRebasing: true, isAutoMerging: false, canMerge: false, canPush: true },
  })
  expect(read.get(cardKey(HOST, 'g/p', 3))?.checks).toEqual([{ id: 'NEED_REBASE', status: 'failed' }])
})
