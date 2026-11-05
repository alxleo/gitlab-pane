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
 * a literal, so no host has a variable of its own.
 */
async function fromEnvironment($: EngineInterface, host: string, hosts: readonly string[]): Promise<string | null> {
  const named = [await $.env.get('GITLAB_HOST'), await $.env.get('GL_HOST')].map(value => bareHost(value ?? '')).find(value => value !== '')
  if ((named ?? hosts[0]) !== host) {
    return null
  }
  const values = [await $.env.get('GITLAB_TOKEN'), await $.env.get('GITLAB_ACCESS_TOKEN'), await $.env.get('OAUTH_TOKEN')]
  return values.map(present).find(value => value !== null) ?? null
}

/** The token glab holds for the host: its environment, its config file or the keyring, whichever `glab config get` finds. */
async function fromGlab($: EngineInterface, host: string): Promise<string | null> {
  const ran = await runText($, 'glab', ['config', 'get', 'token', '--host', host], { timeoutMs: 15_000 })
  return ran.ok ? present(ran.value) : null
}

/** Puts the tokens the settings hold in memory, for `tokenFor` to find. They are in no atom or store. */
export async function rememberSettings(setting: unknown, hosts: readonly string[]): Promise<void> {
  await Promise.all(Object.entries(parseTokens(setting, hosts)).map(([host, token]) => remembered(`setting:${host}`, async () => token)))
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
