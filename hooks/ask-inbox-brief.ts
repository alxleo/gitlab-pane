// One MR whole, for /mrs: its description and its threads. inbox-brief.ts makes the briefing the model reads of it.
import type { InboxBriefQuery, InboxBriefQueryVariables } from './gitlab.generated.ts'
import { documentOf } from './gitlab-document.ts'
import type { Request } from './gitlab-request.ts'
import { INBOX_FRAGMENTS } from './inbox-fragments.ts'

// 30 notes of 100 threads is `COMPLEXITY.InboxBrief`.
const INBOX_BRIEF = /* GraphQL */ `
  query InboxBrief($path: ID!, $iid: String!) {
    project(fullPath: $path) {
      mergeRequest(iid: $iid) {
        ...InboxMrFields
        description sourceBranch targetBranch
        discussions(first: 100) {
          nodes {
            resolvable resolved
            notes(first: 30) { nodes { id body system createdAt author { username name bot } } }
          }
        }
      }
    }
  }
`

export type InboxBriefOperations = {
  InboxBrief: { variables: InboxBriefQueryVariables; data: InboxBriefQuery }
}

/** The document, and what GitLab scores it (`COMPLEXITY`). */
export const INBOX_BRIEF_ASK = { documents: { InboxBrief: documentOf(INBOX_BRIEF, INBOX_FRAGMENTS) }, complexity: { InboxBrief: 33 } } as const

/** One MR with its description and threads, for `/mrs`. */
export const inboxBriefQuery = (path: string, iid: number): Request<InboxBriefQuery> => ({
  operation: 'InboxBrief',
  query: INBOX_BRIEF_ASK.documents.InboxBrief,
  variables: { path, iid: String(iid) } satisfies InboxBriefQueryVariables,
})

type BriefNote = { id: string; author: string; at: string; body: string }
type BriefThread = { isResolvable: boolean; isResolved: boolean; notes: BriefNote[] }

/** One MR as the briefing needs it. */
export type Brief = {
  path: string
  iid: number
  title: string
  url: string
  state: string
  isDraft: boolean
  author: string
  source: string
  target: string
  description: string
  threads: BriefThread[]
}

/** The MR a `InboxBrief` answer holds, or null when GitLab found none (no such MR, or one the token cannot see). */
export function readBrief(data: InboxBriefQuery | null): Brief | null {
  const mr = data?.project?.mergeRequest
  if (mr === null || mr === undefined) {
    return null
  }
  const threads = (mr.discussions.nodes ?? []).flatMap((thread): BriefThread[] => {
    if (thread === null) {
      return []
    }
    // A system note ("added 2 commits") is GitLab's own bookkeeping, not what anyone wrote.
    const notes = (thread.notes.nodes ?? []).flatMap((note): BriefNote[] =>
      note === null || note.system ? [] : [{ id: note.id, author: note.author?.username ?? 'ghost', at: note.createdAt, body: note.body }]
    )
    return notes.length > 0 ? [{ isResolvable: thread.resolvable, isResolved: thread.resolved, notes }] : []
  })
  return {
    path: mr.project.fullPath,
    iid: Number(mr.iid),
    title: mr.title,
    url: mr.webUrl ?? '',
    state: mr.state,
    isDraft: mr.draft,
    author: mr.author?.username ?? 'ghost',
    source: mr.sourceBranch,
    target: mr.targetBranch,
    description: mr.description ?? '',
    threads,
  }
}
