// Who owns an MR's code, to suggest as its reviewers. GitLab's suggested approvers are the eligible approvers of the MR's
// approval rules, its CODEOWNERS rules among them, less those who approved (`ApprovalState#suggested_approvers`), with no
// order: the first few of them are any few of the team. So the whole team is asked for, and ranked by how many of the
// project's last merged MRs each approved. A project whose rules name no one (any member may approve) suggests whoever
// approved there most; that needs the rules, which a token without the "Approval Rule: Read" permission is never shown
// (GitLab answers an empty list), so such a token is suggested no one there rather than people who may own nothing. The
// rule that names someone is their team, when GitLab shows the rules. A field of GitLab's paid tiers, so a Community
// Edition host lacks it. Asked only for MRs that still need approvals, one at a time, never in the list's own document:
// GitLab scores it 46 and it calls Gitaly for each MR.
import type { SuggestedQuery, SuggestedQueryVariables } from './gitlab.generated'
import { isSome, present } from './decode'
import { Failure } from './failure'
import type { RawResponse, Request } from './gitlab-request'
import { absoluteUrl } from './hosts'

import type { HostFeatures, Suggestion, Suggestions } from '../types'

// The last 30 merged MRs say who reviews in a project: enough to rank a team, few enough to stay cheap.
const SUGGESTED = /* GraphQL */ `
  query Suggested($path: ID!, $iid: String!) {
    project(fullPath: $path) {
      mergeRequest(iid: $iid) {
        approvalState {
          rules { type name eligibleApprovers { username } }
          suggestedApprovers(first: 50) { pageInfo { hasNextPage } nodes { username name avatarUrl bot } }
        }
      }
      mergeRequests(state: merged, sort: MERGED_AT_DESC, first: 30) {
        nodes { approvedBy(first: 10) { pageInfo { hasNextPage } nodes { username name avatarUrl bot } } }
      }
    }
  }
`

export type SuggestedOperations = {
  Suggested: { variables: SuggestedQueryVariables; data: SuggestedQuery }
}

/** The document, and what GitLab scores it (`COMPLEXITY`). */
export const SUGGESTED_ASK = { documents: { Suggested: SUGGESTED }, complexity: { Suggested: 46 } } as const

/** Who owns the MR's code (`COMPLEXITY.Suggested`); none for a host that lacks the field. */
export const suggestedQuery = (path: string, iid: number, features: HostFeatures): Request<SuggestedQuery> | null =>
  features.hasSuggestedApprovers
    ? {
        operation: 'Suggested',
        query: SUGGESTED,
        variables: { path, iid: String(iid) } satisfies SuggestedQueryVariables,
      }
    : null

type User = { username: string; name: string; avatarUrl: string | null; bot: boolean }
type Rule = { type: string | null; name: string | null; eligibleApprovers: readonly { username: string }[] | null }

/**
 * The team a rule names its approvers as: its name, or for a CODEOWNERS rule, the path it owns. None for "any member", nor
 * for a security or licence rule, whose people approve a finding, not own the code.
 */
function teamOf(rule: Rule): string | null {
  if (rule.type === 'ANY_APPROVER' || rule.type === 'REPORT_APPROVER' || rule.name === null || rule.name === '') {
    return null
  }
  return rule.type === 'CODE_OWNER' ? `code owner of ${rule.name}` : rule.name
}

/** Whether GitLab showed the rules and none names anyone: any member may approve. An empty list may be rules kept from the token. */
const isAnyMember = (rules: readonly Rule[]): boolean => rules.length > 0 && rules.every(rule => rule.type === 'ANY_APPROVER' || present(rule.eligibleApprovers).length === 0)

/**
 * The people to suggest, best first: those GitLab names as eligible (`eligible`, in its order), ranked by how many of the
 * project's last merged MRs they approved (`approvals`, one list of approvers an MR, newest first), each with the first
 * rule naming them as their team. Only where the rules name no one (`isAnyMember`), those who approved most, the most
 * recent first among equals; where they name someone who is not eligible now (the author, or all approved), no one.
 */
export function rankSuggestions(eligible: readonly User[], approvals: readonly (readonly User[])[], rules: readonly Rule[]): Omit<Suggestion, 'avatarUrl'>[] {
  const counts = new Map<string, number>()
  const seen = new Map<string, User>()
  for (const user of approvals.flat()) {
    counts.set(user.username, (counts.get(user.username) ?? 0) + 1)
    if (!seen.has(user.username)) {
      seen.set(user.username, user)
    }
  }
  const named = (username: string): string | null =>
    rules
      .filter(rule => present(rule.eligibleApprovers).some(each => each.username === username))
      .map(teamOf)
      .find(team => team !== null) ?? null
  const pool = eligible.length > 0 || !isAnyMember(rules) ? eligible : [...seen.values()]
  const approvedOf = (user: User): number => counts.get(user.username) ?? 0
  // The sort is stable, so among equals the pool's own order stands.
  return pool
    .toSorted((a, b) => approvedOf(b) - approvedOf(a))
    .map(user => ({ username: user.username, name: user.name, isBot: user.bot, team: named(user.username), approved: approvedOf(user) }))
}

/** Rank a complete sample; a partial answer fails so the caller keeps its last ranking and retries. */
export function readSuggested(host: string, response: RawResponse<SuggestedQuery>): Suggestions | null {
  if ((response.errors?.length ?? 0) > 0) {
    throw new Failure('bad-answer', 'GitLab sent a partial reviewer suggestion answer')
  }
  const project = response.data?.project
  const state = project?.mergeRequest?.approvalState
  if (state === undefined) {
    return null
  }
  const history = project?.mergeRequests?.nodes
  const eligible = state.suggestedApprovers
  const approvers = history?.map(mr => mr?.approvedBy)
  if (!isSome(eligible?.nodes) || !isSome(approvers) || approvers.some(page => !isSome(page?.nodes))) {
    throw new Failure('bad-answer', 'GitLab omitted reviewer eligibility or approval history')
  }
  // A page can be complete as sent and still cover only part of the pool. Do not offer a ranking from that sample.
  if (eligible.pageInfo.hasNextPage || approvers.some(page => page?.pageInfo.hasNextPage === true)) {
    return { outOf: 0, people: [] }
  }
  const candidates = present(eligible.nodes)
  const approvals = approvers.map(page => present(page?.nodes))
  const avatars = new Map([...candidates, ...approvals.flat()].map(user => [user.username, user.avatarUrl]))
  const people = rankSuggestions(candidates, approvals, present(state.rules)).map(each => ({
    ...each,
    avatarUrl: absoluteUrl(host, avatars.get(each.username)),
  }))
  return { outOf: approvals.length, people }
}
