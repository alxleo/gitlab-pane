// Adding a reviewer to an MR: one of the documents that change GitLab, sent once the person has confirmed it. GitLab tells
// the reviewer, so a mistaken press reaches a real person; the pane arms it first.
import type { AddReviewerMutation, AddReviewerMutationVariables } from './gitlab.generated'
import { present } from './decode'
import type { RawResponse, Request } from './gitlab-request'
import { why } from './write-model'
import type { Refusal } from './write-model'

// `APPEND` always: left out, GitLab takes the list as the MR's whole set of reviewers and drops everyone else on it.
const ADD_REVIEWER = /* GraphQL */ `
  mutation AddReviewer($path: ID!, $iid: String!, $username: String!) {
    mergeRequestSetReviewers(input: { projectPath: $path, iid: $iid, reviewerUsernames: [$username], operationMode: APPEND }) {
      errors
      mergeRequest { reviewers { nodes { username } } }
    }
  }
`

export type AddReviewerOperations = {
  AddReviewer: { variables: AddReviewerMutationVariables; data: AddReviewerMutation }
}

/** The document, which writes and so is never scored. */
export const ADD_REVIEWER_ASK = { documents: { AddReviewer: ADD_REVIEWER }, writes: ['AddReviewer'] } as const

/** Adds `username` to the MR's reviewers, keeping those it has. */
export const addReviewerWrite = (path: string, iid: number, username: string): Request<AddReviewerMutation> => ({
  operation: 'AddReviewer',
  query: ADD_REVIEWER,
  variables: { path, iid: String(iid), username } satisfies AddReviewerMutationVariables,
})

/**
 * Why GitLab did not add the reviewer, or null when they are among the MR's reviewers now. A refusal of the whole write
 * (a token that may only read) comes as errors beside no payload, which never name the scope, so the pane says what a
 * read-only token gets without claiming that is the cause. GitLab leaves out, without an error, someone who may not see
 * the MR, so the answer's reviewers are what say it took.
 */
export function addedRefusal(host: string, username: string, response: RawResponse<AddReviewerMutation>): Refusal | null {
  const made = response.data?.mergeRequestSetReviewers ?? null
  if (made === null) {
    const errors = (response.errors ?? []).map(error => error.message)
    return {
      reason:
        errors.length > 0
          ? `${host} refused: ${why(errors.join('; '))}. A token with only the read_api scope is refused so; adding a reviewer needs api`
          : `${host} sent no answer`,
      mayHaveLanded: false,
    }
  }
  if (made.errors.length > 0) {
    return { reason: why(made.errors.join('; ')), mayHaveLanded: false }
  }
  const reviewers = present(made.mergeRequest?.reviewers?.nodes).map(reviewer => reviewer.username)
  return reviewers.includes(username) ? null : { reason: `${host} did not add ${why(username)}: they may not have access to the project`, mayHaveLanded: false }
}
