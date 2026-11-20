// What was addressed to the user and is still pending in GitLab's own to-do list; the pane never marks one done.
import type { InboxTodosPlainQuery, InboxTodosQuery } from './gitlab.generated.ts'
import { present, timeOf } from './decode.ts'
import { documentOf } from './gitlab-document.ts'
import type { Request } from './gitlab-request.ts'
import { INBOX_FRAGMENTS } from './inbox-fragments.ts'
import { actorOf, excerptOf, mrOf, PLAIN } from './inbox-signals.ts'
import type { Found, MrFields } from './inbox-signals.ts'

import type { HostFeatures, InboxKind, InboxMr, InboxSignal } from '../types'

// `targetEntity` is GitLab 17.4 and newer, where `target` is deprecated. A host that says it has no `targetEntity` is sent
// the plain variant, which asks for `target` (see INBOX_TODOS_PLAIN).
const INBOX_TODOS = /* GraphQL */ `
  query InboxTodos {
    currentUser {
      username
      todos(
        state: [pending]
        type: [MERGEREQUEST]
        action: [review_requested, approval_required, mentioned, directly_addressed, review_submitted, build_failed, unmergeable]
        first: 50
      ) {
        nodes {
          action createdAt body targetUrl
          author { username name }
          targetEntity { webUrl ... on MergeRequest { ...InboxMrFields } }
        }
      }
    }
  }
`

const INBOX_TODOS_PLAIN = /* GraphQL */ `
  query InboxTodosPlain {
    currentUser {
      username
      todos(
        state: [pending]
        type: [MERGEREQUEST]
        action: [review_requested, approval_required, mentioned, directly_addressed, review_submitted, build_failed, unmergeable]
        first: 50
      ) {
        nodes {
          action createdAt body targetUrl
          author { username name }
          target { webUrl ... on MergeRequest { ...InboxMrFields } }
        }
      }
    }
  }
`

export type InboxTodosOperations = {
  InboxTodos: { variables: Record<string, never>; data: InboxTodosQuery }
  InboxTodosPlain: { variables: Record<string, never>; data: InboxTodosPlainQuery }
}

/** The documents, and what GitLab scores each (`COMPLEXITY`). */
export const INBOX_TODOS_ASK = {
  documents: { InboxTodos: documentOf(INBOX_TODOS, INBOX_FRAGMENTS), InboxTodosPlain: documentOf(INBOX_TODOS_PLAIN, INBOX_FRAGMENTS) },
  complexity: { InboxTodos: 39, InboxTodosPlain: 39 },
} as const

/** The user's pending to-dos on MRs of the kinds the inbox rules name; a host without `targetEntity` is asked for `target`. */
export const inboxTodosQuery = (features: HostFeatures): Request<InboxTodosQuery | InboxTodosPlainQuery> =>
  features.hasTodoEntity
    ? { operation: 'InboxTodos', query: INBOX_TODOS_ASK.documents.InboxTodos, variables: {} }
    : { operation: 'InboxTodosPlain', query: INBOX_TODOS_ASK.documents.InboxTodosPlain, variables: {} }

/** What each to-do action asks, for those the rules count; the others (assigned, marked) are not the inbox's news. */
function todoKind(action: string): InboxKind | null {
  switch (action) {
    case 'review_requested':
    case 'approval_required':
      return 'review_requested'
    case 'mentioned':
    case 'directly_addressed':
      return 'mentioned'
    case 'review_submitted':
      return 'review'
    case 'build_failed':
      return 'build_failed'
    case 'unmergeable':
      return 'unmergeable'
    default:
      return null
  }
}

/** The note a to-do's link points at: `…#note_123`. */
const noteOfUrl = (url: string | null): string | null => /#note_(\d+)$/u.exec(url ?? '')?.[1] ?? null

/** A to-do as either document gives it: what it was about is `targetEntity` (GitLab 17.4 and newer) or `target`. */
type Todo = {
  action: string
  createdAt: string
  body: string
  targetUrl: string | null
  author: { username: string }
  target: MrFields | { webUrl: string | null } | null
}

/** The MRs that wait on the user's to-dos, with who asked or said what. */
function mrsOfTodos(host: string, me: string | null, todos: readonly Todo[]): Found {
  const mrs = todos.flatMap((todo): InboxMr[] => {
    const { target } = todo
    const kind = todoKind(todo.action)
    const at = timeOf(todo.createdAt)
    if (me === null || target === null || !('iid' in target) || kind === null || at === null) {
      return []
    }
    const signal: InboxSignal = { kind, actor: actorOf(todo.author.username), at, note: noteOfUrl(todo.targetUrl), excerpt: excerptOf(todo.body) }
    return [mrOf(host, me, target, [signal], PLAIN)]
  })
  return { user: me, mrs }
}

type EntityTodo = NonNullable<NonNullable<NonNullable<NonNullable<InboxTodosQuery['currentUser']>['todos']>['nodes']>[number]>
type PlainTodo = NonNullable<NonNullable<NonNullable<NonNullable<InboxTodosPlainQuery['currentUser']>['todos']>['nodes']>[number]>

/** The MRs that wait on the user's to-dos, from whichever document the host was sent. */
export function todoMrs(host: string, data: InboxTodosQuery | InboxTodosPlainQuery | null): Found {
  const nodes: readonly (EntityTodo | PlainTodo | null)[] = data?.currentUser?.todos?.nodes ?? []
  const todos = present(nodes).map((todo): Todo => ('targetEntity' in todo ? { ...todo, target: todo.targetEntity } : todo))
  return mrsOfTodos(host, data?.currentUser?.username ?? null, todos)
}
