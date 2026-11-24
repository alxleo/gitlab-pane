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
/** GitLab's rules where any member may approve: the "All Members" rule, which names no one. */
const ANY_MEMBER: Rule = { type: 'ANY_APPROVER', name: 'All Members', eligibleApprovers: [] }

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
    ANY_MEMBER,
    { type: 'REGULAR', name: 'Core team', eligibleApprovers: [{ username: 'ines' }, { username: 'mel' }, { username: 'tess' }] },
    { type: 'CODE_OWNER', name: '/docs/', eligibleApprovers: [{ username: 'mel' }] },
  ]
  expect(readSuggested('git.corp.com', answer([ines, null, mel, tess], [[tess, rae], [mel], [tess]], rules))).toEqual({
    outOf: 3,
    people: [
      { username: 'tess', name: 'tess', avatarUrl: null, isBot: false, team: 'Core team', approved: 2 },
      { username: 'mel', name: 'mel', avatarUrl: null, isBot: false, team: 'Core team', approved: 1 },
      { username: 'ines', name: 'ines', avatarUrl: 'https://git.corp.com/uploads/-/system/user/avatar/4/a.png', isBot: false, team: 'Core team', approved: 0 },
    ],
  })
  // A CODEOWNERS rule names the path its owners own; a token that may not read the rules is shown none, so names no team.
  const owner: Rule = { type: 'CODE_OWNER', name: '/docs/', eligibleApprovers: [{ username: 'mel' }] }
  expect(rankSuggestions([mel], [], [owner])[0]?.team).toBe('code owner of /docs/')
  expect(readSuggested('gitlab.com', answer([mel], [], null))?.people[0]?.team).toBeNull()
  // A security or licence rule's people approve a finding, not own the code: it names no team, and the next rule does.
  const security: Rule = { type: 'REPORT_APPROVER', name: 'Coverage-Check', eligibleApprovers: [{ username: 'mel' }] }
  expect(rankSuggestions([mel], [], [security])[0]?.team).toBeNull()
  expect(rankSuggestions([mel], [], [security, owner])[0]?.team).toBe('code owner of /docs/')
  // A rule with no name says nothing, so the next rule naming them is their team.
  const unnamed: Rule[] = [
    { type: 'REGULAR', name: null, eligibleApprovers: [{ username: 'mel' }] },
    { type: 'REGULAR', name: '', eligibleApprovers: [{ username: 'mel' }] },
  ]
  expect(rankSuggestions([mel], [], unnamed)[0]?.team).toBeNull()
  expect(rankSuggestions([mel], [], [...unnamed, { type: 'REGULAR', name: 'Docs team', eligibleApprovers: [{ username: 'mel' }] }])[0]?.team).toBe('Docs team')
})

test('a project whose rules name no one suggests who approved there most, the most recent first among equals, bots kept for the card to drop', () => {
  const bot = person('project_1_bot_ab', { bot: true })
  const merged = [[person('mel')], [person('ines'), bot], [person('ines')], [person('tess')]]
  expect(readSuggested('gitlab.com', answer([], merged, [ANY_MEMBER]))?.people.map(each => [each.username, each.approved, each.isBot])).toEqual([
    ['ines', 2, false],
    ['mel', 1, false],
    ['project_1_bot_ab', 1, true],
    ['tess', 1, false],
  ])
  // Nothing eligible and nothing merged suggests no one; an MR GitLab did not answer reads as none known.
  expect(readSuggested('gitlab.com', answer(null, [], [ANY_MEMBER]))).toEqual({ outOf: 0, people: [] })
  expect(readSuggested('gitlab.com', { data: { project: { mergeRequest: null, mergeRequests: null } } })).toBeNull()
  expect(readSuggested('gitlab.com', { data: null })).toBeNull()
})

test('no one eligible where a rule names someone, or where the rules are not shown, suggests no one, never the frequent approvers', () => {
  const merged = [[person('rae')], [person('sam')], [person('rae')]]
  // The only code owner is the author, whom GitLab leaves out; or the whole team has approved and approvals are still left.
  expect(rankSuggestions([], merged, [{ type: 'CODE_OWNER', name: '/src/', eligibleApprovers: [{ username: 'me' }] }])).toEqual([])
  expect(rankSuggestions([], merged, [ANY_MEMBER, { type: 'REGULAR', name: 'Core team', eligibleApprovers: [{ username: 'ines' }] }])).toEqual([])
  // A token without "Approval Rule: Read" is shown no rules at all: rules that name a team look like none, so no one.
  expect(rankSuggestions([], merged, [])).toEqual([])
})

test('ranking keeps everyone GitLab names, once, and puts no one who approved less before one who approved more', () => {
  const names = fc.constantFrom('a', 'b', 'c', 'd', 'e')
  fc.assert(
    fc.property(fc.uniqueArray(names), fc.array(fc.array(names, { maxLength: 3 }), { maxLength: 8 }), (eligible, merged) => {
      const ranked = rankSuggestions(
        eligible.map(each => person(each)),
        merged.map(approvers => approvers.map(each => person(each))),
        [ANY_MEMBER]
      )
      expect(ranked.map(each => each.username).toSorted()).toEqual(eligible.length > 0 ? eligible.toSorted() : [...new Set(merged.flat())].toSorted())
      expect(ranked.every((each, at) => at === 0 || (ranked[at - 1]?.approved ?? 0) >= each.approved)).toBe(true)
    })
  )
})
