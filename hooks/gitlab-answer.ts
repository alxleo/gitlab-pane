// How a GitLab host's answer is read and which token a host is sent, on plain data: the mod's `graphql.ts` and `tokens.ts`
// (through the session's `$`) and the ChatGPT plugin's `chatgpt/read.ts` (through Node) send and run what these decide.
import { decodeGraphql, isRecord, parseJson } from './decode.ts'
import { Failure } from './failure.ts'
import { bareHost } from './hosts.ts'
import type { RawResponse } from './gitlab-request.ts'

/** A host's answer to a request: its HTTP status and its body as text. */
export type Answer = { status: number; text: string }

/** Where a token came from, for saying which one a host refused; the token itself is never said. */
export type Source = 'the environment' | 'glab' | 'the plugin settings'

/** Whether a read is sent once more after this answer: GitLab's edge answers 52x now and then. A write is never sent twice. */
export const isWorthAnotherTry = (answer: Answer): boolean => answer.status >= 500

/** The refusal a 401 or 403 is, or null for any other status. A 401 means the token is to be asked for again. */
export function refusalOf(host: string, source: Source, status: number, needs: string): Failure | null {
  if (status === 401) {
    return new Failure('unauthorized', `${host} rejected the token from ${source} (HTTP 401)`)
  }
  if (status === 403) {
    return new Failure('unauthorized', `${host} refused the token from ${source} (HTTP 403): it needs ${needs}`)
  }
  return null
}

/**
 * A host's answer as GraphQL: a partial one (data beside errors, whatever the status) is kept; a refused token, a body that
 * is not JSON and an error page are failures that say why. `isCut` says whether the body may have been cut short by the
 * one who read it, which is then said instead of "not JSON". A read needs a token with the `read_api` scope, a write `api`.
 */
export function readAnswer<Data>(host: string, source: Source, answer: Answer, scope: 'read_api' | 'api', isCut: (text: string) => string | null): RawResponse<Data> {
  const refused = refusalOf(host, source, answer.status, `the ${scope} scope`)
  if (refused !== null) {
    throw refused
  }
  let raw: unknown
  try {
    raw = parseJson(answer.text)
  } catch {
    const cut = isCut(answer.text)
    throw cut !== null
      ? new Failure('bad-answer', `${host} answered ${cut}`)
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
 * The variables glab takes a token or a host from, in its order. glab answers `config get token --host <host>` from its
 * environment before its config, whatever host is asked, so a token meant for one host would come back for every other;
 * they are unset for that question, leaving only what glab stored for the host itself. `environmentToken` reads them instead.
 */
export const GLAB_VARIABLES = ['GITLAB_TOKEN', 'GITLAB_ACCESS_TOKEN', 'OAUTH_TOKEN', 'GITLAB_HOST', 'GL_HOST'] as const

export type GlabVariables = Partial<Record<(typeof GLAB_VARIABLES)[number], string>>

/** A value with its spaces trimmed, or null when there is nothing left. */
export const present = (value: string | undefined): string | null => (value !== undefined && value.trim() !== '' ? value.trim() : null)

/**
 * The token glab would send from its environment, for the host glab would talk to: `GITLAB_HOST` (or `GL_HOST`), else the
 * first host the person reads. A host variable that reads as no bare host (one with a path, say) names no host, rather than
 * letting the token fall to the first. Null for any other host.
 */
export function environmentToken(variables: GlabVariables, host: string, firstHost: string | undefined): string | null {
  const named = [variables.GITLAB_HOST, variables.GL_HOST].map(value => value?.trim() ?? '').find(value => value !== '')
  if ((named === undefined ? firstHost : bareHost(named)) !== host) {
    return null
  }
  return [variables.GITLAB_TOKEN, variables.GITLAB_ACCESS_TOKEN, variables.OAUTH_TOKEN].map(present).find(value => value !== null) ?? null
}
