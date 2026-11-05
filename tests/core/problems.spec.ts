import { expect, test } from 'vitest'

import { decodeGraphql } from '../../hooks/decode.ts'
import { Failure } from '../../hooks/failure.ts'
import { isAbsentOptional, withProblem } from '../../hooks/problems.ts'

test('a failure carries the kind it was detected as, and only an absent optional tool is no problem', async () => {
  expect(withProblem({}, 'gitlab', new Failure('no-token', 'no GitLab token for git.corp.com'), 0)).toEqual({ gitlab: { message: 'no GitLab token for git.corp.com', kind: 'no-token', at: 0 } })
  expect(withProblem({}, 'gitlab', new Error('boom'), 0).gitlab?.kind).toBe('unknown')
  expect(isAbsentOptional('jira', 'not-installed')).toBe(true)
  expect(isAbsentOptional('inbox', 'not-installed')).toBe(false)
  expect(isAbsentOptional('gitlab', 'not-installed')).toBe(false)
  expect(isAbsentOptional('jira', 'failed')).toBe(false)
  expect(() => decodeGraphql([])).toThrow(Failure)
})
