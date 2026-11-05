// The request for the user's authored MRs, whole or as the changes since a moment: the one document that comes in two scopes.
import { DOCUMENTS } from './gitlab-documents.ts'
import type { Request } from './gitlab-documents.ts'
import type { AuthoredPlainQuery, AuthoredQuery, AuthoredQueryVariables } from './gitlab.generated.ts'

import type { HostFeatures } from '../types'

/** How many authored MRs one read asks for: the `first:` of the Authored documents, past which a delta may have more behind it. */
export const AUTHORED_PAGE = 50

/** What an authored read asks for: every open MR, or every MR of any state that changed after a moment. */
export type AuthoredScope = { kind: 'open' } | { kind: 'since'; after: string }

/**
 * The user's authored MRs, the heaviest document (`COMPLEXITY.Authored`). A read `since` a moment asks for
 * MRs of every state updated after it, so one merged or closed since comes back as such instead of vanishing.
 */
export const authoredQuery = (features: HostFeatures, scope: AuthoredScope): Request<AuthoredQuery | AuthoredPlainQuery> => {
  const variables: Record<string, string> = scope.kind === 'open' ? ({ state: 'opened' } satisfies AuthoredQueryVariables) : ({ after: scope.after } satisfies AuthoredQueryVariables)
  return features.hasReviewStates
    ? { operation: 'Authored', query: DOCUMENTS.Authored, variables }
    : { operation: 'AuthoredPlain', query: DOCUMENTS.AuthoredPlain, variables }
}
