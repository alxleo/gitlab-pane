import { expect, test } from 'vitest'

import { rebasePath, rebaseRefusal } from '../../hooks/ask-rebase.ts'

test('a rebase GitLab started is no refusal; a 4xx says why and did not land, a 5xx may have', () => {
  expect(rebaseRefusal({ status: 202, text: '{"rebase_in_progress":true}' })).toBeNull()
  expect(rebaseRefusal({ status: 409, text: '{"message":"Rebase in progress"}' })).toEqual({ reason: 'GitLab answered HTTP 409: Rebase in progress', mayHaveLanded: false })
  expect(rebaseRefusal({ status: 502, text: '<html>Bad Gateway</html>' })).toEqual({ reason: 'GitLab answered HTTP 502', mayHaveLanded: true })
})

test('a rebase is asked for at the MR whose project path is escaped as one segment', () => {
  expect(rebasePath('group/sub/project', 7)).toBe('projects/group%2Fsub%2Fproject/merge_requests/7/rebase')
})
