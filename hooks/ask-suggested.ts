// Who GitLab suggests to approve an MR: the eligible approvers of its approval rules, its CODEOWNERS rules among them, less
// those who approved. A field of GitLab's paid tiers, so a Community Edition host lacks it, and a project without rules
// answers none. Asked only for MRs that still need approvals, one at a time, never in the list's own document: it costs
// ten and calls Gitaly for each MR.
import type { SuggestedQuery, SuggestedQueryVariables } from './gitlab.generated.ts'
import { present } from './decode.ts'
import type { RawResponse, Request } from './gitlab-request.ts'
import { absoluteUrl } from './hosts.ts'

import type { HostFeatures, Suggestion } from '../types'

const SUGGESTED = /* GraphQL */ `
  query Suggested($path: ID!, $iid: String!) {
    project(fullPath: $path) { mergeRequest(iid: $iid) { approvalState { suggestedApprovers(first: 5) { nodes { username name avatarUrl bot } } } } }
  }
`

export type SuggestedOperations = {
  Suggested: { variables: SuggestedQueryVariables; data: SuggestedQuery }
}

/** The document, and what GitLab scores it (`COMPLEXITY`). */
export const SUGGESTED_ASK = { documents: { Suggested: SUGGESTED }, complexity: { Suggested: 21 } } as const

/** Who GitLab suggests to approve the MR (`COMPLEXITY.Suggested`); none for a host that lacks the field. */
export const suggestedQuery = (path: string, iid: number, features: HostFeatures): Request<SuggestedQuery> | null =>
  features.hasSuggestedApprovers
    ? {
        operation: 'Suggested',
        query: SUGGESTED,
        variables: { path, iid: String(iid) } satisfies SuggestedQueryVariables,
      }
    : null

/** The people GitLab suggested, in its order, with their avatars made absolute on `host`; null when it answered no MR. */
export function readSuggested(host: string, response: RawResponse<SuggestedQuery>): Suggestion[] | null {
  const state = response.data?.project?.mergeRequest?.approvalState
  if (state === undefined) {
    return null
  }
  return present(state.suggestedApprovers?.nodes).map(user => ({ username: user.username, name: user.name, avatarUrl: absoluteUrl(host, user.avatarUrl), isBot: user.bot }))
}
