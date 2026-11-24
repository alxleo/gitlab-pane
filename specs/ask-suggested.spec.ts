import { expect, test } from 'vitest'

import { readSuggested, suggestedQuery } from '../hooks/ask-suggested'
import { featuresOf } from '../hooks/in-flight'

test('who GitLab suggests to approve an MR is asked by its path and number, and read in its order with avatars made absolute', () => {
  const asked = suggestedQuery('g/p', 7, featuresOf('gitlab.com'))
  expect(asked?.operation).toBe('Suggested')
  expect(asked?.query).toContain('suggestedApprovers(first: 5)')
  expect(asked?.query).not.toContain('g/p')
  expect(asked?.variables).toEqual({ path: 'g/p', iid: '7' })
  type Node = { username: string; name: string; avatarUrl: string | null; bot: boolean } | null
  const approvers = (nodes: Node[]) => ({ data: { project: { mergeRequest: { approvalState: { suggestedApprovers: { nodes } } } } } })
  expect(
    readSuggested(
      'git.corp.com',
      approvers([
        { username: 'ines', name: 'Ines Mendel', avatarUrl: '/uploads/-/system/user/avatar/4/a.png', bot: false },
        null,
        { username: 'mel', name: 'Mel', avatarUrl: 'https://secure.gravatar.com/avatar/ab', bot: false },
        { username: 'tess', name: 'Tess', avatarUrl: '', bot: true },
      ])
    )
  ).toEqual([
    { username: 'ines', name: 'Ines Mendel', avatarUrl: 'https://git.corp.com/uploads/-/system/user/avatar/4/a.png', isBot: false },
    { username: 'mel', name: 'Mel', avatarUrl: 'https://secure.gravatar.com/avatar/ab', isBot: false },
    { username: 'tess', name: 'Tess', avatarUrl: null, isBot: true },
  ])
  // A project without approval rules suggests no one; an MR GitLab did not answer reads as none known.
  expect(readSuggested('gitlab.com', { data: { project: { mergeRequest: { approvalState: { suggestedApprovers: null } } } } })).toEqual([])
  expect(readSuggested('gitlab.com', { data: { project: { mergeRequest: null } } })).toBeNull()
  expect(readSuggested('gitlab.com', { data: null })).toBeNull()
})
