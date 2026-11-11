import { isRecord, parseJson, stringRecord } from '../hooks/decode.ts'
import type { Operations, RawResponse } from '../hooks/gitlab-documents.ts'
import type { MergeStrategyEnum } from '../hooks/gitlab.generated.ts'

/** GitLab's answer to each operation the pane sends, typed by the document's generated types. A test sets the ones it needs. */
export type Answers = {
  [Name in keyof Operations]?: (variables: Operations[Name]['variables']) => RawResponse<Operations[Name]['data']>
}

/** GitLab's answer to a document with a field its schema lacks, as an older self-managed GitLab gives it: no data, and where. */
export const undefinedField = (typeName: string, fieldName: string) => ({
  errors: [{ message: `Field '${fieldName}' doesn't exist on type '${typeName}'`, extensions: { code: 'undefinedField', typeName, fieldName } }],
})

/** What an account with nothing waiting on it answers to the three inbox documents unless a test sets them: the user is `me`. */
const NOTHING = {
  InboxTodos: { data: { currentUser: { username: 'me', todos: { nodes: [] } } } },
  InboxQueue: { data: { currentUser: { username: 'me', reviewRequestedMergeRequests: { nodes: [] } } } },
  InboxAuthored: { data: { currentUser: { username: 'me', opened: { nodes: [] }, merged: { nodes: [] } } } },
} as const

/** What `$.http.fetch` resolves with. */
export type Served = { status: number; ok: boolean; headers: Record<string, string>; text: string }

const reply = (status: number, body: unknown): Served => ({ status, ok: status >= 200 && status < 300, headers: {}, text: JSON.stringify(body) })

const need = (variables: Record<string, string>, name: string): string => {
  const value = variables[name]
  if (value === undefined) {
    throw new Error(`the request left out the ${name} variable`)
  }
  return value
}

/** What an authored request asked for: the open MRs (the only state the pane names), or those changed after a moment. */
const authoredScope = (variables: Record<string, string>): { state?: 'opened'; after?: string } => ({
  ...(variables.state === 'opened' ? { state: 'opened' as const } : {}),
  ...(variables.after !== undefined ? { after: variables.after } : {}),
})

const set = <Handler>(handler: Handler | undefined, operation: string): Handler => {
  if (handler === undefined) {
    throw new Error(`the test set no answer for the ${operation} operation`)
  }
  return handler
}

/** What the pane sent: the host, the operation it names, its variables and the bearer token, checked to be GraphQL over JSON. */
export type Sent = { host: string; operation: string; variables: Record<string, string>; token: string | undefined }

/**
 * The request `$.http.fetch(url, init)` is given, read as the pane's GraphQL POST; anything else throws. This is a core file, so
 * `init` cannot name the engine's `HttpInit`; its body is `unknown` because the engine's is text or bytes, and only text is a document.
 */
export function sent(url: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } | undefined): Sent {
  const match = /^https:\/\/([^/]+)\/api\/graphql$/u.exec(url)
  if (match?.[1] === undefined || init?.method !== 'POST') {
    throw new Error(`the pane fetched something that is not a GraphQL POST: ${init?.method ?? 'GET'} ${url}`)
  }
  if (typeof init.body !== 'string' && init.body !== undefined) {
    throw new Error('the pane sent bytes, not a GraphQL document')
  }
  const body = parseJson(init.body ?? '')
  if (!isRecord(body) || typeof body.query !== 'string' || typeof body.operationName !== 'string') {
    throw new Error('the pane sent a body without a query and an operationName')
  }
  if (new RegExp(`^\\s*(?:query|mutation)\\s+${body.operationName}\\b`, 'mu').exec(body.query) === null) {
    throw new Error(`the operationName ${body.operationName} is not the operation of the document sent`)
  }
  const header = Object.entries(init.headers ?? {}).find(([name]) => name.toLowerCase() === 'authorization')?.[1]
  return { host: match[1], operation: body.operationName, variables: stringRecord(body.variables), token: header?.replace(/^Bearer /u, '') }
}

/** A job's log asked for on the REST API: the host, the project path and job number it names, and the bearer token. */
export type Traced = { host: string; path: string; job: string; token: string | undefined }

/** The request `$.http.fetch(url, init)` is given, read as a GET of a job's trace, or none when it is something else. */
export function traced(url: string, init: { method?: string; headers?: Record<string, string> } | undefined): Traced | null {
  const match = /^https:\/\/([^/]+)\/api\/v4\/projects\/([^/]+)\/jobs\/(\d+)\/trace$/u.exec(url)
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
    return null
  }
  if (init?.method !== undefined && init.method !== 'GET') {
    throw new Error(`the pane read a job's trace with ${init.method}`)
  }
  const header = Object.entries(init?.headers ?? {}).find(([name]) => name.toLowerCase() === 'authorization')?.[1]
  return { host: match[1], path: decodeURIComponent(match[2]), job: match[3], token: header?.replace(/^Bearer /u, '') }
}

/** GitLab's merge strategies by the name a request gives. */
const STRATEGIES: Readonly<Record<string, MergeStrategyEnum>> = {
  MERGE_TRAIN: 'MERGE_TRAIN',
  ADD_TO_MERGE_TRAIN_WHEN_CHECKS_PASS: 'ADD_TO_MERGE_TRAIN_WHEN_CHECKS_PASS',
  MERGE_WHEN_CHECKS_PASS: 'MERGE_WHEN_CHECKS_PASS',
}

/** A rebase asked for on the REST API: the host, and the project path and MR number it names. */
export type Rebased = { host: string; path: string; iid: string; token: string | undefined }

/** The request `$.http.fetch(url, init)` is given, read as a PUT of an MR's rebase, or none when it is something else. */
export function rebased(url: string, init: { method?: string; headers?: Record<string, string> } | undefined): Rebased | null {
  const match = /^https:\/\/([^/]+)\/api\/v4\/projects\/([^/]+)\/merge_requests\/(\d+)\/rebase$/u.exec(url)
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
    return null
  }
  if (init?.method !== 'PUT') {
    throw new Error(`the pane asked for a rebase with ${init?.method ?? 'GET'}`)
  }
  const header = Object.entries(init.headers ?? {}).find(([name]) => name.toLowerCase() === 'authorization')?.[1]
  return { host: match[1], path: decodeURIComponent(match[2]), iid: match[3], token: header?.replace(/^Bearer /u, '') }
}

/**
 * What a GitLab host answers a request: 401 unless the bearer is the token that host accepts, else the test's answer to the
 * operation.
 */
export function serve(request: Sent, answers: Answers, accepted: string | undefined): Served {
  if (accepted === undefined || request.token !== accepted) {
    return reply(401, { message: '401 Unauthorized' })
  }
  const { operation, variables } = request
  switch (operation) {
    case 'Authored':
      return reply(200, set(answers.Authored, operation)(authoredScope(variables)))
    case 'AuthoredPlain':
      return reply(200, set(answers.AuthoredPlain, operation)(authoredScope(variables)))
    case 'MergeStatus':
      return reply(200, set(answers.MergeStatus, operation)({}))
    case 'Failures':
      return reply(200, set(answers.Failures, operation)({ path: need(variables, 'path'), iid: need(variables, 'iid') }))
    case 'Pinned':
      return reply(200, set(answers.Pinned, operation)({ path: need(variables, 'path'), iid: need(variables, 'iid') }))
    case 'PinnedPlain':
      return reply(200, set(answers.PinnedPlain, operation)({ path: need(variables, 'path'), iid: need(variables, 'iid') }))
    case 'Usual':
      return reply(200, set(answers.Usual, operation)({ path: need(variables, 'path') }))
    case 'Threads':
      return reply(200, set(answers.Threads, operation)({ path: need(variables, 'path'), iid: need(variables, 'iid') }))
    case 'ThreadsPlain':
      return reply(200, set(answers.ThreadsPlain, operation)({ path: need(variables, 'path'), iid: need(variables, 'iid') }))
    case 'Reply':
      return reply(200, set(answers.Reply, operation)({ mr: need(variables, 'mr'), thread: need(variables, 'thread'), body: need(variables, 'body') }))
    case 'InboxTodos':
      return reply(200, answers.InboxTodos !== undefined ? answers.InboxTodos({}) : NOTHING.InboxTodos)
    case 'InboxTodosPlain':
      return reply(200, answers.InboxTodosPlain !== undefined ? answers.InboxTodosPlain({}) : NOTHING.InboxTodos)
    case 'InboxQueue':
      return reply(200, answers.InboxQueue !== undefined ? answers.InboxQueue({}) : NOTHING.InboxQueue)
    case 'InboxAuthored':
      return reply(200, answers.InboxAuthored !== undefined ? answers.InboxAuthored({ since: need(variables, 'since') }) : NOTHING.InboxAuthored)
    case 'InboxFollowUser':
      return reply(
        200,
        answers.InboxFollowUser !== undefined
          ? answers.InboxFollowUser({ username: need(variables, 'username'), since: need(variables, 'since') })
          : { data: { currentUser: { username: 'me' }, user: null } }
      )
    case 'InboxFollowProject':
      return reply(
        200,
        answers.InboxFollowProject !== undefined
          ? answers.InboxFollowProject({ path: need(variables, 'path'), since: need(variables, 'since') })
          : { data: { currentUser: { username: 'me' }, project: null } }
      )
    case 'InboxBrief':
      return reply(200, set(answers.InboxBrief, operation)({ path: need(variables, 'path'), iid: need(variables, 'iid') }))
    case 'MoveState':
      return reply(200, set(answers.MoveState, operation)({ path: need(variables, 'path'), iid: need(variables, 'iid') }))
    case 'Merge': {
      const strategy = STRATEGIES[variables.strategy ?? '']
      return reply(
        200,
        set(answers.Merge, operation)({ path: need(variables, 'path'), iid: need(variables, 'iid'), sha: need(variables, 'sha'), ...(strategy !== undefined ? { strategy } : {}) })
      )
    }
    default:
      throw new Error(`the pane sent an operation the fake does not know: ${operation}`)
  }
}
