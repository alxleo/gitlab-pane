import { expect, test } from 'vitest'

import { readMoveState } from '../../hooks/ask-move-state.ts'
import type { MoveStateQuery } from '../../hooks/gitlab.generated.ts'

type MoveStateMr = NonNullable<NonNullable<MoveStateQuery['project']>['mergeRequest']>

test('an MR read fresh gives what a move needs; one GitLab does not name gives none, and an answer with no data throws', () => {
  const mergeRequest: MoveStateMr = {
    state: 'opened',
    detailedMergeStatus: 'NEED_REBASE',
    diffHeadSha: 'abc',
    rebaseCommitSha: null,
    rebaseInProgress: false,
    autoMergeEnabled: false,
    mergeError: null,
    availableAutoMergeStrategies: ['merge_when_checks_pass'],
    squashOnMerge: true,
  }
  expect(readMoveState({ data: { project: { mergeRequest } } })).toEqual({
    state: 'opened',
    status: 'NEED_REBASE',
    head: 'abc',
    rebased: '',
    isRebasing: false,
    isAutoMerging: false,
    mergeError: null,
    strategies: ['merge_when_checks_pass'],
    squash: true,
  })
  expect(readMoveState({ data: { project: { mergeRequest: null } } })).toBeNull()
  expect(() => readMoveState({ data: null, errors: [{ message: 'timeout' }] })).toThrow('timeout')
})
