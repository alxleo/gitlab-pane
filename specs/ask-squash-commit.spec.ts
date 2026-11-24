import { expect, test } from 'vitest'

import { mergeRequestPath, squashShaOf } from '../hooks/ask-squash-commit'
import { Failure } from '../hooks/failure'

const SQUASH = 'b'.repeat(40)

test("the squash commit is read from an MR's REST entity, its path encoded, and anything that is no entity is a failure", () => {
  expect(mergeRequestPath('g/sub/p', 7)).toBe('projects/g%2Fsub%2Fp/merge_requests/7')
  expect(squashShaOf({ status: 200, text: JSON.stringify({ iid: 7, squash_commit_sha: SQUASH }) })).toBe(SQUASH)
  expect(squashShaOf({ status: 200, text: JSON.stringify({ iid: 7, squash_commit_sha: null }) })).toBeNull()
  expect(squashShaOf({ status: 200, text: JSON.stringify({ iid: 7, squash_commit_sha: '' }) })).toBeNull()
  expect(squashShaOf({ status: 200, text: JSON.stringify({ iid: 7 }) })).toBeNull()
  expect(() => squashShaOf({ status: 404, text: '{}' })).toThrow(Failure)
  expect(() => squashShaOf({ status: 502, text: '<html>' })).toThrow(Failure)
  expect(() => squashShaOf({ status: 200, text: '<html>' })).toThrow(Failure)
  expect(() => squashShaOf({ status: 200, text: '[]' })).toThrow(Failure)
})
