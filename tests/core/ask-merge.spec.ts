import { expect, test } from 'vitest'

import { mergeRefusal } from '../../hooks/ask-merge.ts'

test('a merge GitLab took is no refusal; one it refused says why in its words and cannot have landed', () => {
  expect(mergeRefusal({ data: { mergeRequestAccept: { errors: [], mergeRequest: { state: 'merged', mergeError: null } } } })).toBeNull()
  expect(mergeRefusal({ data: { mergeRequestAccept: { errors: ['SHA does not match HEAD of source branch'], mergeRequest: null } } })).toEqual({
    reason: 'SHA does not match HEAD of source branch',
    mayHaveLanded: false,
  })
  expect(mergeRefusal({ data: { mergeRequestAccept: null }, errors: [{ message: 'not allowed' }] })).toEqual({ reason: 'not allowed', mayHaveLanded: false })
  expect(mergeRefusal({ data: null })).toEqual({ reason: 'GitLab sent no answer', mayHaveLanded: false })
})
