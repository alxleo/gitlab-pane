import type { On } from 'claude-code'

import { sent, serve, traced } from './gitlab_fake'
import type { Answers } from './gitlab_fake'

/** What `$.process.run` resolves with. */
export const ran = (stdout: string, exitCode = 0, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

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
    const trace = traced(e.url, e.init)
    if (trace !== null) {
      requests.push(`${trace.host} trace ${trace.path}#${trace.job}`)
      tokens.push(`${trace.host} ${trace.token ?? ''}`)
      const log = hosts[trace.host]?.traces?.[`${trace.path}#${trace.job}`]
      const isAccepted = trace.token !== undefined && trace.token === hosts[trace.host]?.accepts
      return { value: { status: !isAccepted ? 401 : log === undefined ? 404 : 200, ok: isAccepted && log !== undefined, headers: {}, text: isAccepted ? (log ?? '404 Not found') : '401 Unauthorized' } }
    }
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
