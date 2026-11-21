import { expect, test } from 'vitest'

import { addedRefusal, addReviewerWrite } from '../../hooks/ask-add-reviewer.ts'
import { decodeGraphql, parseJson } from '../../hooks/decode.ts'
import type { AddReviewerMutation } from '../../hooks/gitlab.generated.ts'
import type { RawResponse } from '../../hooks/gitlab-request.ts'
import { isWrite } from '../../hooks/gitlab-operations.ts'

/** GitLab's answer as the pane reads it: through the JSON a host sends. */
const answer = (raw: unknown): RawResponse<AddReviewerMutation> => decodeGraphql<AddReviewerMutation>(parseJson(JSON.stringify(raw)))
const reviewers = (...usernames: string[]) => ({
  data: { mergeRequestSetReviewers: { errors: [], mergeRequest: { reviewers: { nodes: usernames.map(username => ({ username })) } } } },
})

test('adding a reviewer keeps those the MR has, is a write sent once, and names them by variable', () => {
  const write = addReviewerWrite('g/p', 7, 'ines')
  // Left out, the mode would be GitLab's REPLACE, which drops every other reviewer.
  expect(write.query).toContain('operationMode: APPEND')
  expect(write.query).not.toContain('ines')
  expect(write.variables).toEqual({ path: 'g/p', iid: '7', username: 'ines' })
  expect(isWrite(write)).toBe(true)
})

test('a reviewer GitLab lists after the write was added; one it refused, did not keep, or left out says why in one line', () => {
  const not = (reason: string) => ({ reason, mayHaveLanded: false })
  expect(addedRefusal('gitlab.com', 'ines', answer(reviewers('mel', 'ines')))).toBeNull()
  // A token of read_api alone may not write: GitLab refuses the whole mutation, with no word of the scope.
  expect(
    addedRefusal('gitlab.com', 'ines', answer({ data: { mergeRequestSetReviewers: null }, errors: [{ message: "you don't have permission\nto perform this action" }] }))
  ).toEqual(not("gitlab.com refused: you don't have permission to perform this action. A token with only the read_api scope is refused so; adding a reviewer needs api"))
  expect(addedRefusal('gitlab.com', 'ines', answer({ data: { mergeRequestSetReviewers: null } }))).toEqual(not('gitlab.com sent no answer'))
  expect(addedRefusal('gitlab.com', 'ines', answer({ data: { mergeRequestSetReviewers: { errors: ['Reviewers are limited'], mergeRequest: null } } }))).toEqual(
    not('Reviewers are limited')
  )
  // GitLab leaves out, with no error, someone who may not see the MR.
  expect(addedRefusal('gitlab.com', 'ines', answer(reviewers('mel')))).toEqual(not('gitlab.com did not add ines: they may not have access to the project'))
})
