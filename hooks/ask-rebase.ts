// A rebase of an MR's branch onto its target, which GraphQL lacks, so it goes over REST (moves.ts sends it).
import { isRecord, parseJson } from './decode'
import { why } from './write-model'
import type { Refusal } from './write-model'

/** The REST path that starts a rebase of the MR; GitLab answers `202 {"rebase_in_progress": true}` when it takes it. */
export const rebasePath = (path: string, iid: number): string => `projects/${encodeURIComponent(path)}/merge_requests/${iid}/rebase`

const jsonOrNull = (text: string): unknown => {
  try {
    return parseJson(text)
  } catch {
    return null
  }
}

/** Why GitLab would not start a rebase, in its words, or null when it took it. A server error may have come after it took it. */
export function rebaseRefusal(answer: { status: number; text: string }): Refusal | null {
  if (answer.status >= 200 && answer.status < 300) {
    return null
  }
  const said = jsonOrNull(answer.text)
  const message = isRecord(said) && typeof said.message === 'string' ? `: ${said.message}` : ''
  return { reason: why(`GitLab answered HTTP ${answer.status}${message}`), mayHaveLanded: answer.status >= 500 }
}
