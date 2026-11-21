// What a host has of GitLab's newer fields, learned from the errors it answers: an older self-managed GitLab refuses a whole
// document for one field it lacks, so the pane learns the lack once and sends the variant without that field from then on.
import type { RawResponse } from './gitlab-request.ts'

import type { HostFeatures } from '../types'

/**
 * Which features a host lacks, from the answer it gave: GitLab validates a whole document and says, for each field its
 * schema does not have, `undefinedField` with the type and field in the error's `extensions` (never read from the message),
 * and for an argument, `argumentNotAccepted` with the field and argument.
 */
export function missingFeatures(response: RawResponse<unknown>): (keyof HostFeatures)[] {
  return (response.errors ?? []).flatMap(error => {
    const { code, typeName, fieldName, name, argumentName } = error.extensions ?? {}
    if (code === 'argumentNotAccepted') {
      return name === 'notes' && argumentName === 'filter' ? ['hasCommentFilter' as const] : []
    }
    if (code !== 'undefinedField') {
      return []
    }
    return typeName === 'UserMergeRequestInteraction' && fieldName === 'reviewState'
      ? ['hasReviewStates' as const]
      : typeName === 'MergeRequest' && fieldName === 'mergeabilityChecks'
        ? ['hasMergeVerdict' as const]
        : typeName === 'Todo' && fieldName === 'targetEntity'
          ? ['hasTodoEntity' as const]
          : typeName === 'Discussion' && fieldName === 'truncatedDiffLines'
            ? ['hasDiffLines' as const]
            : // The Community Edition has no approval state at all; an older paid one has it without the suggestions.
              (typeName === 'MergeRequest' && fieldName === 'approvalState') || (typeName === 'MergeRequestApprovalState' && fieldName === 'suggestedApprovers')
              ? ['hasSuggestedApprovers' as const]
              : []
  })
}

/**
 * Whether a host gets the current MR documents (the list and one MR): reviewers with their review state, and comments
 * filtered from the system notes (GitLab 16.5). A host lacking either gets the plain ones, which have neither.
 */
export const isCurrent = (features: HostFeatures): boolean => features.hasReviewStates && features.hasCommentFilter
