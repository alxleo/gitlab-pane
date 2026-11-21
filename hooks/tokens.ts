import type { EngineInterface } from 'claude-code'

import { readHosts } from './data'
import { environmentToken, GLAB_VARIABLES, present } from './gitlab-answer'
import type { Source } from './gitlab-answer'
import { parseTokens } from './hosts'
import { remembered } from './in-flight'
import { runText } from './tools'
import type { Outcome } from './tools'

export type Found = { token: string; source: Source }

/**
 * The token glab reads from its environment, for the host glab would talk to (`environmentToken`), the first host the
 * settings name standing in when no host variable is set. The engine takes a variable's name only as a literal, so no host
 * has a variable of its own.
 */
async function fromEnvironment($: EngineInterface, host: string, hosts: readonly string[]): Promise<string | null> {
  const variables = {
    GITLAB_HOST: await $.env.get('GITLAB_HOST'),
    GL_HOST: await $.env.get('GL_HOST'),
    GITLAB_TOKEN: await $.env.get('GITLAB_TOKEN'),
    GITLAB_ACCESS_TOKEN: await $.env.get('GITLAB_ACCESS_TOKEN'),
    OAUTH_TOKEN: await $.env.get('OAUTH_TOKEN'),
  }
  return environmentToken(Object.fromEntries(Object.entries(variables).flatMap(([name, value]) => (value !== undefined ? [[name, value]] : []))), host, hosts[0])
}

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
