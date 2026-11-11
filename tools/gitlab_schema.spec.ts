import { expect, test } from 'vitest'

import { DOCUMENTS } from '../hooks/gitlab-documents.ts'
import { scored } from './gitlab_schema.ts'

test('scoring a read adds GitLab’s own score of it and sample values for its variables', () => {
  const { query, variables } = scored(DOCUMENTS.MoveState)
  expect(query).toContain('queryComplexity')
  expect(Object.keys(variables).toSorted()).toEqual(['iid', 'path'])
})

test('a write is never made ready to be scored, as scoring sends it to gitlab.com, where it would run', () => {
  expect(() => scored(DOCUMENTS.Merge)).toThrow('Merge is a mutation, which is never sent to be scored')
})
