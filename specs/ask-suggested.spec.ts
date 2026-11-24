import { expect, test } from 'vitest'
import fc from 'fast-check'

import { rankSuggestions, readSuggested, suggestedQuery } from '../hooks/ask-suggested'
import { featuresOf } from '../hooks/in-flight'

type Node = { username: string; name: string; avatarUrl: string | null; bot: boolean }
const person = (username: string, over: Partial<Node> = {}): Node => ({ username, name: username, avatarUrl: null, bot: false, ...over })
type Rule = { type: 'REGULAR' | 'CODE_OWNER' | 'ANY_APPROVER' | 'REPORT_APPROVER' | null; name: string | null; eligibleApprovers: { username: string }[] | null }
const answer = (eligible: (Node | null)[] | null, approvals: Node[][], rules: Rule[] | null = []) => ({
  data: {
    project: {
      mergeRequest: { approvalState: { rules, suggestedApprovers: eligible === null ? null : { nodes: eligible } } },
      mergeRequests: { nodes: approvals.map(nodes => ({ approvedBy: { nodes } })) },
    },
  },
})

test('who owns an MR is asked by its path and number: the whole team GitLab names, and who approved the last merged MRs', () => {
  const asked = suggestedQuery('g/p', 7, featuresOf('gitlab.com'))
  expect(asked?.operation).toBe('Suggested')
  expect(asked?.query).toContain('suggestedApprovers(first: 50)')
  expect(asked?.query).toContain('mergeRequests(state: merged, sort: MERGED_AT_DESC, first: 30)')
  expect(asked?.query).not.toContain('g/p')
  expect(asked?.variables).toEqual({ path: 'g/p', iid: '7' })
})

test('the team GitLab names is ranked by who approves here most, its own order breaking ties, each with the rule naming them', () => {
  const [ines, mel, tess, rae] = [person('ines', { avatarUrl: '/uploads/-/system/user/avatar/4/a.png' }), person('mel'), person('tess'), person('rae')]
  // GitLab names the team in no order; Tess approved two of the last three merged MRs, Mel one, Ines none, and Rae, who
  // is not in the team, approved too.
  const rules: Rule[] = [
    { type: 'ANY_APPROVER', name: 'All Members', eligibleApprovers: [] },
    { type: 'REGULAR', name: 'Core team', eligibleApprovers: [{ username: 'ines' }, { username: 'mel' }, { username: 'tess' }] },
    { type: 'CODE_OWNER', name: '/docs/', eligibleApprovers: [{ username: 'mel' }] },
  ]
  expect(readSuggested('git.corp.com', answer([ines, null, mel, tess], [[tess, rae], [mel], [tess]], rules))).toEqual([
    { username: 'tess', name: 'tess', avatarUrl: null, isBot: false, team: 'Core team', approved: 2, outOf: 3 },
    { username: 'mel', name: 'mel', avatarUrl: null, isBot: false, team: 'Core team', approved: 1, outOf: 3 },
    { username: 'ines', name: 'ines', avatarUrl: 'https://git.corp.com/uploads/-/system/user/avatar/4/a.png', isBot: false, team: 'Core team', approved: 0, outOf: 3 },
  ])
  // A CODEOWNERS rule names the path its owners own; a token that may not read the rules sees none, so names no team.
  expect(rankSuggestions([mel], [], [{ type: 'CODE_OWNER', name: '/docs/', eligibleApprovers: [{ username: 'mel' }] }])[0]?.team).toBe('code owner of /docs/')
  expect(readSuggested('gitlab.com', answer([mel], [], null))?.[0]?.team).toBeNull()
})

test('a project whose rules name no one suggests who approved there most, the most recent first among equals, bots kept for the card to drop', () => {
  const bot = person('project_1_bot_ab', { bot: true })
  expect(
    readSuggested('gitlab.com', answer([], [[person('mel')], [person('ines'), bot], [person('ines')], [person('tess')]]))?.map(each => [each.username, each.approved, each.isBot])
  ).toEqual([
    ['ines', 2, false],
    ['mel', 1, false],
    ['project_1_bot_ab', 1, true],
    ['tess', 1, false],
  ])
  // Nothing eligible and nothing merged suggests no one; an MR GitLab did not answer reads as none known.
  expect(readSuggested('gitlab.com', answer(null, []))).toEqual([])
  expect(readSuggested('gitlab.com', { data: { project: { mergeRequest: null, mergeRequests: null } } })).toBeNull()
  expect(readSuggested('gitlab.com', { data: null })).toBeNull()
})

test('ranking keeps everyone GitLab names, once, and puts no one who approved less before one who approved more', () => {
  const names = fc.constantFrom('a', 'b', 'c', 'd', 'e')
  fc.assert(
    fc.property(fc.uniqueArray(names), fc.array(fc.array(names, { maxLength: 3 }), { maxLength: 8 }), (eligible, merged) => {
      const ranked = rankSuggestions(
        eligible.map(each => person(each)),
        merged.map(approvers => approvers.map(each => person(each))),
        []
      )
      expect(ranked.map(each => each.username).toSorted()).toEqual(eligible.length > 0 ? eligible.toSorted() : [...new Set(merged.flat())].toSorted())
      expect(ranked.every((each, at) => at === 0 || (ranked[at - 1]?.approved ?? 0) >= each.approved)).toBe(true)
      expect(ranked.every(each => each.outOf === merged.length)).toBe(true)
    })
  )
})
