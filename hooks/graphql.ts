import type { EngineInterface } from 'claude-code'

import { decodeGraphql, isRecord, parseJson } from './decode'
import { Failure, messageOf } from './failure'
import type { RawResponse, Request } from './gitlab-documents'
import { isWrite } from './merge-gitlab'
import { redact } from './hosts'
import { missingFeatures } from './gitlab'
import { featuresOf, forgetFound, learnLack } from './in-flight'
import { tokenFor } from './tokens'
import { failureOf } from './tools'
import type { Found } from './tokens'

import type { HostFeatures } from '../types'

/** The most of an answer the engine's `$.http.fetch` reads; it cuts the rest off, which no longer parses. */
const ENGINE_READS_BYTES = 4 * 1024 * 1024

/**
 * Whether an answer may be one the engine cut: within a tenth of its limit, counted in bytes as the engine counts, since
 * text heavy in multi-byte characters (box drawing, progress bars) is far fewer characters than bytes.
 */
export const mayBeCut = (text: string): boolean => new TextEncoder().encode(text).length > ENGINE_READS_BYTES * 0.9

type Answer = { status: number; text: string }

/** The engine's `plugin: $.http.fetch(url) failed: …` as `host failed: …`, which says as much on a pane's one line. */
const plainly = (host: string, message: string): string => message.replace(/^(?:[^:]*: )?(?:\$\.http\.fetch(?:\([^)]*\))?(?: over \S+)?:? )+/u, `${host} `)

/** The engine words a dropped connection `… failed: …` and a policy refusal `… refused: …`; only the first is worth another try. */
const isDropped = (error: unknown): boolean => /\bfailed\b/u.test(messageOf(error)) && !/\brefused:/u.test(messageOf(error))

/**
 * GitLab's edge answers 52x now and then, and drops a connection; one more try rides that out. A write is sent once: a
 * connection that dropped may have reached GitLab, and a merge must not be asked for twice.
 */
async function post($: EngineInterface, host: string, token: string, request: Request<unknown>): Promise<Answer> {
  const send = () =>
    $.http.fetch(`https://${host}/api/graphql`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: request.query, variables: request.variables, operationName: request.operation }),
    })
  if (isWrite(request)) {
    return send()
  }
  try {
    const first = await send()
    if (first.status < 500) {
      return first
    }
  } catch (error) {
    if (!isDropped(error)) {
      throw error
    }
  }
  return send()
}

/**
 * A host's answer as GraphQL: a partial one (data beside errors, whatever the status) is kept; a rejected token is not. A
 * read needs a token with the `read_api` scope, a write one with `api`.
 */
function read<Data>(host: string, found: Found, answer: Answer, scope: 'read_api' | 'api'): RawResponse<Data> {
  if (answer.status === 401) {
    forgetFound()
    throw new Failure('unauthorized', `${host} rejected the token from ${found.source} (HTTP 401)`)
  }
  if (answer.status === 403) {
    throw new Failure('unauthorized', `${host} refused the token from ${found.source} (HTTP 403): it needs the ${scope} scope`)
  }
  let raw: unknown
  try {
    raw = parseJson(answer.text)
  } catch {
    throw mayBeCut(answer.text)
      ? new Failure('bad-answer', `${host} answered more than the ${ENGINE_READS_BYTES / 1024 / 1024} MiB the engine reads`)
      : answer.status >= 500
        ? new Failure('server', `${host} answered HTTP ${answer.status}`)
        : new Failure('bad-answer', `${host} answered HTTP ${answer.status}, which is not JSON: is https://${host}/api/graphql a GitLab?`)
  }
  if (isRecord(raw) && !('data' in raw) && !('errors' in raw) && answer.status >= 400) {
    throw new Failure(answer.status >= 500 ? 'server' : 'bad-answer', `${host} answered HTTP ${answer.status}${typeof raw.message === 'string' ? `: ${raw.message}` : ''}`)
  }
  return decodeGraphql<Data>(raw)
}

/**
 * Sends one document to a host and gives GitLab's answer: a POST of `{query, variables, operationName}` to
 * `https://<host>/api/graphql` with the host's token as a bearer. Whatever fails says why, with no token in the words. A
 * write (`WRITES`) is sent once, and needs a token with the `api` scope.
 */
export async function ask<Data>($: EngineInterface, host: string, request: Request<Data>): Promise<RawResponse<Data>> {
  const found = await tokenFor($, host)
  if (!found.ok) {
    throw failureOf(found)
  }
  const { token } = found.value
  try {
    return read<Data>(host, found.value, await post($, host, token, request), isWrite(request) ? 'api' : 'read_api')
  } catch (error) {
    throw new Failure(error instanceof Failure ? error.kind : /\baborted\b/u.test(messageOf(error)) ? 'timeout' : 'network', redact(plainly(host, messageOf(error)), [token]))
  }
}

/**
 * Sends one request to a host's REST API, `https://<host>/api/v4/<path>`, with the host's token, once. Gives GitLab's
 * status and text, whatever the status, but for a rejected token (401, forgotten so it is asked for again) and a refused
 * one (403, said to need what `needs` names). Whatever else fails says why, with no token in the words.
 */
export async function askRest($: EngineInterface, host: string, path: string, init: { method: 'GET' | 'PUT'; headers: Record<string, string>; needs: string }): Promise<Answer> {
  const found = await tokenFor($, host)
  if (!found.ok) {
    throw failureOf(found)
  }
  const { token, source } = found.value
  let answer: Answer
  try {
    answer = await $.http.fetch(`https://${host}/api/v4/${path}`, { method: init.method, headers: { ...init.headers, Authorization: `Bearer ${token}` } })
  } catch (error) {
    throw new Failure(/\baborted\b/u.test(messageOf(error)) ? 'timeout' : 'network', redact(plainly(host, messageOf(error)), [token]))
  }
  if (answer.status === 401) {
    forgetFound()
    throw new Failure('unauthorized', `${host} rejected the token from ${source} (HTTP 401)`)
  }
  if (answer.status === 403) {
    throw new Failure('unauthorized', `${host} refused the token from ${source} (HTTP 403): it needs ${init.needs}`)
  }
  return answer
}

/**
 * Sends the document `build` makes for what the host is known to have. If the host answers that a field of it is
 * undefined, it is remembered to lack the feature, and the document without it is sent once more. `build` gives none for
 * a host that lacks what the document is for, and nothing is sent.
 */
export function askVariant<Data>($: EngineInterface, host: string, build: (features: HostFeatures) => Request<Data>): Promise<RawResponse<Data>>
export function askVariant<Data>($: EngineInterface, host: string, build: (features: HostFeatures) => Request<Data> | null): Promise<RawResponse<Data> | null>
export async function askVariant<Data>($: EngineInterface, host: string, build: (features: HostFeatures) => Request<Data> | null): Promise<RawResponse<Data> | null> {
  const first = build(featuresOf(host))
  if (first === null) {
    return null
  }
  const answer = await ask($, host, first)
  const lacks = missingFeatures(answer)
  if (lacks.length === 0) {
    return answer
  }
  const again = build(lacks.map(feature => learnLack(host, feature)).at(-1) ?? featuresOf(host))
  return again !== null ? ask($, host, again) : null
}
