import { expect, test } from 'vitest'

import { decodeGraphql } from '../../hooks/decode.ts'
import { Failure } from '../../hooks/failure.ts'
import { isAbsentOptional, leaderProblems, reportedProblems, withProblem } from '../../hooks/problems.ts'

test('a failure carries the kind it was detected as, and only an absent optional tool is no problem', async () => {
  expect(withProblem({}, 'gitlab', new Failure('no-token', 'no GitLab token for git.corp.com'), 0)).toEqual({
    gitlab: { message: 'no GitLab token for git.corp.com', kind: 'no-token', at: 0 },
  })
  expect(withProblem({}, 'gitlab', new Error('boom'), 0).gitlab?.kind).toBe('unknown')
  expect(isAbsentOptional('jira', 'not-installed')).toBe(true)
  // A ticket opened under a card is read by the same optional tool.
  expect(isAbsentOptional('jira-ticket', 'not-installed')).toBe(true)
  expect(isAbsentOptional('inbox', 'not-installed')).toBe(false)
  expect(isAbsentOptional('gitlab', 'not-installed')).toBe(false)
  expect(isAbsentOptional('jira', 'failed')).toBe(false)
  expect(() => decodeGraphql([])).toThrow(Failure)
})

test('what only the session that reads GitLab works for is told to the others, and what each session does itself is not', () => {
  const failed = { message: 'boom', kind: 'failed', at: 5 } as const
  const all = { gitlab: failed, 'jira-moves': failed, usual: failed, avatars: failed, suggested: failed, jira: failed, inbox: failed, pane: failed }
  const told = leaderProblems(all)
  expect(Object.keys(told)).toEqual(['gitlab', 'jira-moves', 'usual', 'avatars', 'suggested'])
  expect(reportedProblems(told, 9).suggested).toEqual({ message: 'boom', kind: 'failed', at: 9 })
})
