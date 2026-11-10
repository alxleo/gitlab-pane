import { parseJson } from '../hooks/decode.ts'
import type { On, RenderSurface } from 'claude-code'

import { sent, serve, traced } from './gitlab_fake'
import type { Answers } from './gitlab_fake'

/** What `$.process.run` resolves with. */
export const ran = (stdout: string, exitCode = 0, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

/**
 * A session that draws on the desktop, as the engine holds it: its id, the surfaces it has (a test may empty them, as a
 * session run without a window has none), and the panes it opened, which `$.ui.panes()` lists (that is how a session knows
 * its pane is drawn), and the plugin's store, holding `store` to start with.
 * The store is the one `$.store` is in the engine: JSON in, JSON out, a file of 4 MiB at most. It is returned as a map, so a test
 * can play another session by writing it. `isBroken` makes opening a pane fail.
 */
export function fakeSession(on: On, options: { id?: string; isBroken?: () => boolean; store?: Record<string, unknown> } = {}) {
  const store = new Map<string, unknown>(Object.entries(options.store ?? {}))
  // The engine rewrites the whole file for every set and delete, so what is written is the size of the file after each.
  const writes = { count: 0, bytes: 0 }
  const rewrite = () => {
    writes.count += 1
    writes.bytes += JSON.stringify(Object.fromEntries(store)).length
  }
  const json = (value: unknown): unknown => (value === undefined ? undefined : parseJson(JSON.stringify(value)))
  // Keys a test makes unreadable, as a store file another process holds locked or left half written.
  const unreadable = new Set<string>()
  on('store.get', (_, e) => {
    if (unreadable.has(e.key)) {
      throw new Error(`the store could not be read for ${e.key}`)
    }
    return { value: json(store.get(e.key)) }
  })
  on('store.set', (_, e) => {
    const next = new Map(store).set(e.key, json(e.value))
    if (JSON.stringify(Object.fromEntries(next)).length > STORE_BYTES) {
      throw new Error('the store would pass 4 MiB')
    }
    store.set(e.key, json(e.value))
    rewrite()
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    store.delete(e.key)
    rewrite()
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  const opened: string[] = []
  const titles: string[] = []
  const panes = new Set<string>()
  on('session.id', () => ({ value: options.id ?? 'session-a' }))
  const surfaces: RenderSurface[] = ['desktop']
  on('session.surfaces', () => ({ value: [...surfaces] }))
  on('ui.open', (_, e) => {
    if (options.isBroken?.() === true) {
      throw new Error('no window to open in')
    }
    opened.push(e.id)
    titles.push(e.title ?? '')
    panes.add(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    panes.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [...panes].map(id => ({ id, title: 'GitLab', isShown: true, isFocused: false, isPlaced: true })) }))
  return { opened, titles, panes, surfaces, store, unreadable, writes }
}

/** The most the engine's store holds, in characters of JSON. */
const STORE_BYTES = 4 * 1024 * 1024

/** A GitLab host as a test sets it: what it answers, and the one token it accepts (none: it rejects every token). */
export type FakeHost = {
  answers: Answers
  accepts?: string
  /** The log of each job the REST API serves, by `<project path>#<job number>`; any other job is not found. */
  traces?: Record<string, string>
}

export type FakeWorld = {
  /** Environment variables the session has; `SHELL` is a stale path, so the tools must fall back to sh. */
  env?: Record<string, string>
  /** The token glab stored, which `glab config get token --host <host>` prints when its environment holds none; a host not listed prints nothing. */
  glab?: Record<string, string>
  /** An HTTP status to answer the next request with instead of GitLab's own, once; an edge that fails now and then. */
  glitch?: () => number | undefined
  /** True while the network is down: every request fails as a dropped connection does. */
  isDown?: () => boolean
  /** What each GraphQL answer waits on before it is given: a GitLab that is slow to answer. */
  held?: () => Promise<void>
}

/**
 * Stands in for the engine's network, environment and filesystem as a set of GitLab hosts, so the pane's HTTP is answered by
 * operation name. Gives what was asked: each `host operation`, and each host `glab` was asked a token for. `glab` answers
 * the process call for it, or undefined for any other command, for the test's own `process.run` hook to pass on.
 */
export function fakeGitLab(on: On, hosts: Record<string, FakeHost>, world: FakeWorld = {}) {
  const requests: string[] = []
  const glabAsked: string[] = []
  const tokens: string[] = []
  on('http.fetch', async (_, e) => {
    const trace = traced(e.url, e.init)
    if (trace !== null) {
      requests.push(`${trace.host} trace ${trace.path}#${trace.job}`)
      tokens.push(`${trace.host} ${trace.token ?? ''}`)
      const log = hosts[trace.host]?.traces?.[`${trace.path}#${trace.job}`]
      const isAccepted = trace.token !== undefined && trace.token === hosts[trace.host]?.accepts
      return {
        value: {
          status: !isAccepted ? 401 : log === undefined ? 404 : 200,
          ok: isAccepted && log !== undefined,
          headers: {},
          text: isAccepted ? (log ?? '404 Not found') : '401 Unauthorized',
        },
      }
    }
    const request = sent(e.url, e.init)
    requests.push(`${request.host} ${request.operation}`)
    tokens.push(`${request.host} ${request.token ?? ''}`)
    await world.held?.()
    if (world.isDown?.() === true) {
      return { deny: `$.http.fetch(${e.url}) failed: connection refused` }
    }
    const glitch = world.glitch?.()
    if (glitch !== undefined) {
      return { value: { status: glitch, ok: false, headers: {}, text: '<html>Gateway</html>' } }
    }
    const host = hosts[request.host]
    return { value: serve(request, host?.answers ?? {}, host?.accepts) }
  })
  on('env.get', (_, e) => ({ value: e.name === 'SHELL' ? '/usr/local/bin/zsh' : world.env?.[e.name] }))
  on('fs.exists', () => ({ value: false }))
  const glab = (argv: readonly string[]) => {
    const at = argv.indexOf('glab')
    if (at < 0) {
      return undefined
    }
    const host = argv[at + 5] ?? ''
    glabAsked.push(host)
    // As the real glab does: a token in its environment answers for whatever host is asked, unless `env -u` took it away.
    const isUnset = (name: string) => argv.slice(0, at).some((arg, i) => arg === '-u' && argv[i + 1] === name)
    const inherited = ['GITLAB_TOKEN', 'GITLAB_ACCESS_TOKEN', 'OAUTH_TOKEN'].map(name => (isUnset(name) ? undefined : world.env?.[name])).find(value => value !== undefined)
    const token = inherited ?? world.glab?.[host]
    return ran(token !== undefined ? `${token}\n` : '')
  }
  return { requests, glabAsked, tokens, glab }
}
