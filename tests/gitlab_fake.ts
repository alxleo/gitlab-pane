import { isRecord, parseJson, stringRecord } from '../hooks/decode.ts'
import type { Operations, RawResponse } from '../hooks/gitlab-documents.ts'

/** GitLab's answer to each operation the pane sends, typed by the document's generated types. A test sets the ones it needs. */
export type Answers = {
  [Name in keyof Operations]?: (variables: Operations[Name]['variables']) => RawResponse<Operations[Name]['data']>
}

/** The names of the schema's fields that vary between GitLab versions, as an introspection of a current GitLab lists them. */
export const CURRENT = { mergeRequest: { fields: [{ name: 'iid' }, { name: 'detailedMergeStatus' }] }, interaction: { fields: [{ name: 'reviewState' }] } }

/** What the probe reads of an older self-managed GitLab: neither `detailedMergeStatus` nor `reviewState` is in its schema. */
export const OLDER = { mergeRequest: { fields: [{ name: 'iid' }, { name: 'mergeStatus' }] }, interaction: { fields: [{ name: 'canMerge' }] } }

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

const set = <Handler>(handler: Handler | undefined, operation: string): Handler => {
  if (handler === undefined) {
    throw new Error(`the test set no answer for the ${operation} operation`)
  }
  return handler
}

/** What the pane sent: the host, the operation it names, its variables and the bearer token, checked to be GraphQL over JSON. */
export type Sent = { host: string; operation: string; variables: Record<string, string>; token: string | undefined }

/** The request `$.http.fetch(url, init)` is given, read as the pane's GraphQL POST; anything else throws. */
export function sent(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } | undefined): Sent {
  const match = /^https:\/\/([^/]+)\/api\/graphql$/.exec(url)
  if (match?.[1] === undefined || init?.method !== 'POST') {
    throw new Error(`the pane fetched something that is not a GraphQL POST: ${init?.method ?? 'GET'} ${url}`)
  }
  const body = parseJson(init.body ?? '')
  if (!isRecord(body) || typeof body.query !== 'string' || typeof body.operationName !== 'string') {
    throw new Error('the pane sent a body without a query and an operationName')
  }
  if (new RegExp(`^\\s*query\\s+${body.operationName}\\b`, 'm').exec(body.query) === null) {
    throw new Error(`the operationName ${body.operationName} is not the operation of the document sent`)
  }
  const header = Object.entries(init.headers ?? {}).find(([name]) => name.toLowerCase() === 'authorization')?.[1]
  return { host: match[1], operation: body.operationName, variables: stringRecord(body.variables), token: header?.replace(/^Bearer /, '') }
}

/**
 * What a GitLab host answers a request: 401 unless the bearer is the token that host accepts, else the test's answer to the
 * operation, a Probe answered as a current GitLab unless the test sets it (`OLDER` is what an older one lists).
 */
export function serve(request: Sent, answers: Answers, accepted: string | undefined): Served {
  if (accepted === undefined || request.token !== accepted) {
    return reply(401, { message: '401 Unauthorized' })
  }
  const { operation, variables } = request
  switch (operation) {
    case 'Probe':
      return reply(200, answers.Probe !== undefined ? answers.Probe({}) : { data: CURRENT })
    case 'Authored':
      return reply(200, set(answers.Authored, operation)({}))
    case 'AuthoredPlain':
      return reply(200, set(answers.AuthoredPlain, operation)({}))
    case 'MergeStatus':
      return reply(200, set(answers.MergeStatus, operation)({}))
    case 'Pinned':
      return reply(200, set(answers.Pinned, operation)({ path: need(variables, 'path'), iid: need(variables, 'iid') }))
    case 'PinnedPlain':
      return reply(200, set(answers.PinnedPlain, operation)({ path: need(variables, 'path'), iid: need(variables, 'iid') }))
    case 'Usual':
      return reply(200, set(answers.Usual, operation)({ path: need(variables, 'path') }))
    case 'InboxTodos':
      return reply(200, answers.InboxTodos !== undefined ? answers.InboxTodos({}) : NOTHING.InboxTodos)
    case 'InboxQueue':
      return reply(200, answers.InboxQueue !== undefined ? answers.InboxQueue({}) : NOTHING.InboxQueue)
    case 'InboxAuthored':
      return reply(200, answers.InboxAuthored !== undefined ? answers.InboxAuthored({ since: need(variables, 'since') }) : NOTHING.InboxAuthored)
    case 'InboxFollowUser':
      return reply(200, answers.InboxFollowUser !== undefined ? answers.InboxFollowUser({ username: need(variables, 'username'), since: need(variables, 'since') }) : { data: { currentUser: { username: 'me' }, user: null } })
    case 'InboxFollowProject':
      return reply(200, answers.InboxFollowProject !== undefined ? answers.InboxFollowProject({ path: need(variables, 'path'), since: need(variables, 'since') }) : { data: { currentUser: { username: 'me' }, project: null } })
    case 'InboxBrief':
      return reply(200, set(answers.InboxBrief, operation)({ path: need(variables, 'path'), iid: need(variables, 'iid') }))
    default:
      throw new Error(`the pane sent an operation the fake does not know: ${operation}`)
  }
}
