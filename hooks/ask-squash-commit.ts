// The squash commit a merge put on its target branch, which GraphQL lacks, so it is read over REST from the MR's entity
// (landed.ts says when; landed-read.ts asks).
import { isRecord, parseJson } from './decode.ts'
import { Failure } from './failure.ts'

/** The REST path of an MR, whose entity names its squash commit. */
export const mergeRequestPath = (path: string, iid: number): string => `projects/${encodeURIComponent(path)}/merge_requests/${iid}`

/** What GitLab's REST answer for an MR says of its squash commit: its sha, or null when it names none. One that is no entity throws. */
export function squashShaOf(answer: { status: number; text: string }): string | null {
  if (answer.status < 200 || answer.status >= 300) {
    throw new Failure(answer.status >= 500 ? 'server' : 'bad-answer', `GitLab answered HTTP ${answer.status} for the merge request`)
  }
  let entity: unknown
  try {
    entity = parseJson(answer.text)
  } catch {
    throw new Failure('bad-answer', 'GitLab answered a merge request that is not JSON')
  }
  if (!isRecord(entity)) {
    throw new Failure('bad-answer', 'GitLab answered a merge request that is not an object')
  }
  const sha = entity.squash_commit_sha
  return typeof sha === 'string' && sha !== '' ? sha : null
}
