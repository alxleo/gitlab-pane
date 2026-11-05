import { parseJson } from '../hooks/decode.ts'
import type { On } from 'claude-code'

import { sent, serve } from './gitlab_fake'
import type { Answers } from './gitlab_fake'

/** What `$.process.run` resolves with. */
export const ran = (stdout: string, exitCode = 0, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

/**
 * A session that draws on the desktop, as the engine holds it: its id, the surface, and the panes it opened, which
 * `$.ui.panes()` lists (that is how a session knows its pane is drawn), and the plugin's store, holding `store` to start with.
 * The store is the one `$.store` is in the engine: JSON in, JSON out, a file of 4 MiB at most. It is returned as a map, so a test
 * can play another session by writing it. `isBroken` makes opening a pane fail.
 */
export function fakeSession(on: On, options: { id?: string; isBroken?: () => boolean; store?: Record<string, unknown> } = {}) {
  const store = new Map<string, unknown>(Object.entries(options.store ?? {}))
  const json = (value: unknown): unknown => (value === undefined ? undefined : parseJson(JSON.stringify(value)))
  on('store.get', (_, e) => ({ value: json(store.get(e.key)) }))
  on('store.set', (_, e) => {
    const next = new Map(store).set(e.key, json(e.value))
    if (JSON.stringify(Object.fromEntries(next)).length > STORE_BYTES) {
      throw new Error('the store would pass 4 MiB')
    }
    store.set(e.key, json(e.value))
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  const opened: string[] = []
  const titles: string[] = []
  const panes = new Set<string>()
  on('session.id', () => ({ value: options.id ?? 'session-a' }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
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
  return { opened, titles, panes, store }
}

/** The most the engine's store holds, in characters of JSON. */
export const STORE_BYTES = 4 * 1024 * 1024

/** A GitLab host as a test sets it: what it answers, and the one token it accepts (none: it rejects every token). */
export type FakeHost = { answers: Answers; accepts?: string }

export type FakeWorld = {
  /** Environment variables the session has; `SHELL` is a stale path, so the tools must fall back to sh. */
  env?: Record<string, string>
  /** The token `glab config get token --host <host>` prints, by host; a host not listed prints nothing. */
  glab?: Record<string, string>
  /** An HTTP status to answer the next request with instead of GitLab's own, once; an edge that fails now and then. */
  glitch?: () => number | undefined
  /** True while the network is down: every request fails as a dropped connection does. */
  isDown?: () => boolean
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
  on('http.fetch', (_, e) => {
    const request = sent(e.url, e.init)
    requests.push(`${request.host} ${request.operation}`)
    tokens.push(`${request.host} ${request.token ?? ''}`)
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
    return ran(world.glab?.[host] !== undefined ? `${world.glab[host]}\n` : '')
  }
  return { requests, glabAsked, tokens, glab }
}
