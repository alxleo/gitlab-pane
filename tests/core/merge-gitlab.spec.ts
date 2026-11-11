import { expect, test } from 'vitest'
import { Kind, parse } from 'graphql'

import { COMPLEXITY, DOCUMENTS } from '../../hooks/gitlab-documents.ts'
import type { Operations } from '../../hooks/gitlab-documents.ts'
import type { MoveStateQuery } from '../../hooks/gitlab.generated.ts'
import { isWrite, mergeRefusal, mergeWrite, moveStateQuery, readMoveState, rebasePath, rebaseRefusal } from '../../hooks/merge-gitlab.ts'

type MoveStateMr = NonNullable<NonNullable<MoveStateQuery['project']>['mergeRequest']>

const isOperation = (name: string): name is keyof Operations => Object.hasOwn(DOCUMENTS, name)

/** The kind of the one operation a document holds: query or mutation. */
const kindOf = (text: string): string => {
  const operation = parse(text).definitions.find(definition => definition.kind === Kind.OPERATION_DEFINITION)
  return operation?.kind === Kind.OPERATION_DEFINITION ? operation.operation : 'none'
}

test('a document that changes GitLab is a mutation and is sent once; every other is a query, which may be tried again', () => {
  for (const [name, text] of Object.entries(DOCUMENTS)) {
    expect(isOperation(name)).toBe(true)
    const operation = isOperation(name) ? name : 'Authored'
    expect([name, kindOf(text)]).toEqual([name, isWrite({ operation }) ? 'mutation' : 'query'])
  }
  expect(isWrite(mergeWrite('g/p', 1, 'abc', null, false))).toBe(true)
  expect(isWrite(moveStateQuery('g/p', 1))).toBe(false)
})

test('no write is scored: scoring a document sends it to gitlab.com', () => {
  expect(Object.keys(COMPLEXITY).filter(name => isOperation(name) && isWrite({ operation: name }))).toEqual([])
})

test('a merge GitLab took is no refusal; one it refused says why in its words and cannot have landed', () => {
  expect(mergeRefusal({ data: { mergeRequestAccept: { errors: [], mergeRequest: { state: 'merged', mergeError: null } } } })).toBeNull()
  expect(mergeRefusal({ data: { mergeRequestAccept: { errors: ['SHA does not match HEAD of source branch'], mergeRequest: null } } })).toEqual({
    reason: 'SHA does not match HEAD of source branch',
    mayHaveLanded: false,
  })
  expect(mergeRefusal({ data: { mergeRequestAccept: null }, errors: [{ message: 'not allowed' }] })).toEqual({ reason: 'not allowed', mayHaveLanded: false })
  expect(mergeRefusal({ data: null })).toEqual({ reason: 'GitLab sent no answer', mayHaveLanded: false })
})

test('a rebase GitLab started is no refusal; a 4xx says why and did not land, a 5xx may have', () => {
  expect(rebaseRefusal({ status: 202, text: '{"rebase_in_progress":true}' })).toBeNull()
  expect(rebaseRefusal({ status: 409, text: '{"message":"Rebase in progress"}' })).toEqual({ reason: 'GitLab answered HTTP 409: Rebase in progress', mayHaveLanded: false })
  expect(rebaseRefusal({ status: 502, text: '<html>Bad Gateway</html>' })).toEqual({ reason: 'GitLab answered HTTP 502', mayHaveLanded: true })
})

test('a rebase is asked for at the MR whose project path is escaped as one segment', () => {
  expect(rebasePath('group/sub/project', 7)).toBe('projects/group%2Fsub%2Fproject/merge_requests/7/rebase')
})

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
