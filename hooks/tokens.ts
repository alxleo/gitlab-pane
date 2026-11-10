import type { EngineInterface } from 'claude-code'

import { readHosts } from './data'
import { bareHost, parseTokens } from './hosts'
import { remembered } from './in-flight'
import { runText } from './tools'
import type { Outcome } from './tools'

/** Where a token came from, for saying which one a host refused; the token itself is never said. */
type Source = 'the environment' | 'glab' | 'the plugin settings'

export type Found = { token: string; source: Source }

const present = (value: string | undefined): string | null => (value !== undefined && value.trim() !== '' ? value.trim() : null)

/**
 * The token glab reads from its environment, for the host glab would talk to: `GITLAB_HOST` (or `GL_HOST`), else the
 * first host the settings name. The variable names are the ones glab reads, in its order; the engine takes a name only as
 * a literal, so no host has a variable of its own. A host variable the pane cannot read as a bare host (one with a path,
 * say) names no host here, rather than letting the token fall to the first.
 */
async function fromEnvironment($: EngineInterface, host: string, hosts: readonly string[]): Promise<string | null> {
  const named = [await $.env.get('GITLAB_HOST'), await $.env.get('GL_HOST')].map(value => value?.trim() ?? '').find(value => value !== '')
  if ((named === undefined ? hosts[0] : bareHost(named)) !== host) {
    return null
  }
  const values = [await $.env.get('GITLAB_TOKEN'), await $.env.get('GITLAB_ACCESS_TOKEN'), await $.env.get('OAUTH_TOKEN')]
  return values.map(present).find(value => value !== null) ?? null
}

/**
 * The variables glab takes a token or a host from. glab answers `config get token --host <host>` from its environment
 * before its config, whatever host is asked, so a token meant for one host would come back for every other; they are
 * unset for that question, leaving only what glab stored for the host itself. `fromEnvironment` reads them instead.
 */
const GLAB_VARIABLES = ['GITLAB_TOKEN', 'GITLAB_ACCESS_TOKEN', 'OAUTH_TOKEN', 'GITLAB_HOST', 'GL_HOST'] as const

/** The token glab stored for the host, in its config file or the keyring; never one from its environment. */
async function fromGlab($: EngineInterface, host: string): Promise<string | null> {
  const unset = GLAB_VARIABLES.flatMap(name => ['-u', name])
  const ran = await runText($, 'env', [...unset, 'glab', 'config', 'get', 'token', '--host', host], { timeoutMs: 15_000 })
  return ran.ok ? present(ran.value) : null
}

/** Puts the tokens the settings hold in memory, for `tokenFor` to find. They are in no atom or store. */
export async function rememberSettings(setting: unknown, hosts: readonly string[], home: string | undefined): Promise<void> {
  await Promise.all(Object.entries(parseTokens(setting, hosts, home)).map(([host, token]) => remembered(`setting:${host}`, async () => token)))
}

/**
 * The token for a host, from the first of: the environment (`GITLAB_TOKEN` and glab's other names), glab's own stored one
 * (asked once per host per session and kept in memory), the plugin settings. Without any, the reason says where to put one.
 */
export async function tokenFor($: EngineInterface, host: string): Promise<Outcome<Found>> {
  const hosts = await readHosts($)
  const environment = await fromEnvironment($, host, hosts)
  if (environment !== null) {
    return { ok: true, value: { token: environment, source: 'the environment' } }
  }
  const glab = await remembered(`glab:${host}`, () => fromGlab($, host))
  if (glab !== null) {
    return { ok: true, value: { token: glab, source: 'glab' } }
  }
  const setting = await remembered(`setting:${host}`, async () => null)
  if (setting !== null) {
    return { ok: true, value: { token: setting, source: 'the plugin settings' } }
  }
  return {
    ok: false,
    kind: 'no-token',
    reason: `no GitLab token for ${host}: set GITLAB_TOKEN, sign in with \`glab auth login --hostname ${host}\`, or add one to the gitlabTokens setting`,
  }
}
