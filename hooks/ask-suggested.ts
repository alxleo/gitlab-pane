// Who owns an MR's code, to suggest as its reviewers. GitLab's suggested approvers are the eligible approvers of the MR's
// approval rules, its CODEOWNERS rules among them, less those who approved (`ApprovalState#suggested_approvers`), with no
// order: the first few of them are any few of the team. So the whole team is asked for, and ranked by how many of the
// project's last merged MRs each approved; a project whose rules name no one (any member may approve) suggests whoever
// approved there most. The rule that names someone is their team, when GitLab shows the rules: a token without the
// "Approval Rule: Read" permission sees none. A field of GitLab's paid tiers, so a Community Edition host lacks it. Asked
// only for MRs that still need approvals, one at a time, never in the list's own document: GitLab scores it 41 and it
// calls Gitaly for each MR.
import type { SuggestedQuery, SuggestedQueryVariables } from './gitlab.generated'
import { present } from './decode'
import type { RawResponse, Request } from './gitlab-request'
import { absoluteUrl } from './hosts'

import type { HostFeatures, Suggestion } from '../types'

// The last 30 merged MRs say who reviews in a project: enough to rank a team, few enough to stay cheap.
const SUGGESTED = /* GraphQL */ `
  query Suggested($path: ID!, $iid: String!) {
    project(fullPath: $path) {
      mergeRequest(iid: $iid) {
        approvalState {
          rules { type name eligibleApprovers { username } }
          suggestedApprovers(first: 50) { nodes { username name avatarUrl bot } }
        }
      }
      mergeRequests(state: merged, sort: MERGED_AT_DESC, first: 30) { nodes { approvedBy(first: 10) { nodes { username name avatarUrl bot } } } }
    }
  }
`

export type SuggestedOperations = {
  Suggested: { variables: SuggestedQueryVariables; data: SuggestedQuery }
}

/** The document, and what GitLab scores it (`COMPLEXITY`). */
export const SUGGESTED_ASK = { documents: { Suggested: SUGGESTED }, complexity: { Suggested: 41 } } as const

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

/** The team a rule names its approvers as: its name, or for a CODEOWNERS rule, the path it owns; none for "any member". */
function teamOf(rule: Rule): string | null {
  if (rule.type === 'ANY_APPROVER' || rule.name === null || rule.name === '') {
    return null
  }
  return rule.type === 'CODE_OWNER' ? `code owner of ${rule.name}` : rule.name
}

/**
 * The people to suggest, best first: those GitLab names as eligible (`eligible`, in its order), ranked by how many of the
 * project's last merged MRs they approved (`approvals`, one list of approvers an MR, newest first), each with the first
 * rule naming them as their team; with none eligible, those who approved most, the most recent first among equals.
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
  const pool = eligible.length > 0 ? eligible : [...seen.values()]
  const approvedOf = (user: User): number => counts.get(user.username) ?? 0
  // The sort is stable, so among equals the pool's own order stands.
  return pool
    .toSorted((a, b) => approvedOf(b) - approvedOf(a))
    .map(user => ({ username: user.username, name: user.name, isBot: user.bot, team: named(user.username), approved: approvedOf(user), outOf: approvals.length }))
}

/** The people to suggest, best first, with their avatars made absolute on `host`; null when GitLab answered no MR. */
export function readSuggested(host: string, response: RawResponse<SuggestedQuery>): Suggestion[] | null {
  const project = response.data?.project
  const state = project?.mergeRequest?.approvalState
  if (state === undefined) {
    return null
  }
  const approvals = present(project?.mergeRequests?.nodes).map(mr => present(mr.approvedBy?.nodes))
  const avatars = new Map([...present(state.suggestedApprovers?.nodes), ...approvals.flat()].map(user => [user.username, user.avatarUrl]))
  return rankSuggestions(present(state.suggestedApprovers?.nodes), approvals, present(state.rules)).map(each => ({
    ...each,
    avatarUrl: absoluteUrl(host, avatars.get(each.username)),
  }))
}
