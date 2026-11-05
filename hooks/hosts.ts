// The GitLab hosts the pane talks to, and what names things on them. A host is a bare name such as `gitlab.com` or
// `git.example.com:8443`; the pane always speaks https to it.
import { isFilled } from './decode.ts'

import type { HostStatus } from '../types'

/** The host used when the setting names none; its projects are drawn without the host before them. */
const DEFAULT_HOST = 'gitlab.com'

const HOST = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/

/** `https://GitLab.Example.com/` as `gitlab.example.com`; anything that is not a bare host name is empty. */
export function bareHost(text: string): string {
  const host = text
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
  return HOST.test(host) ? host : ''
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : typeof value === 'string' ? [value] : [])

/**
 * The hosts setting: a list, or one comma-separated string, as bare host names without repeats, in the order given. The
 * first is home. A setting with no valid host gives gitlab.com.
 */
export function parseHosts(setting: unknown): string[] {
  const hosts = [
    ...new Set(
      strings(setting)
        .flatMap(entry => entry.split(','))
        .map(bareHost)
        .filter(isFilled)
    ),
  ]
  return hosts.length > 0 ? hosts : [DEFAULT_HOST]
}

/** The tokens setting: `host=token` entries, and a bare token for the first host. Gives each host's token. */
export function parseTokens(setting: unknown, hosts: readonly string[]): Record<string, string> {
  const pairs = strings(setting)
    .flatMap(entry => entry.split(','))
    .map(entry => entry.trim())
    .filter(isFilled)
    .flatMap((entry): [string, string][] => {
      const at = entry.indexOf('=')
      if (at < 0) {
        const [home] = hosts
        return home === undefined ? [] : [[home, entry]]
      }
      const host = bareHost(entry.slice(0, at))
      const token = entry.slice(at + 1).trim()
      return host !== '' && token !== '' ? [[host, token]] : []
    })
  return Object.fromEntries(pairs.filter(([host]) => hosts.includes(host)))
}

/** `https://<host>`: where a host's pages and uploads live. */
export const siteOf = (host: string): string => `https://${host}`

/** `host/group/project`: where an MR lives, the identity the pane groups, filters and keeps run times by. */
export const projectOf = (host: string, path: string): string => `${host}/${path}`

/** The card key, unique across hosts: `host/group/project!iid`. */
export const cardKey = (host: string, path: string, iid: number | string): string => `${projectOf(host, path)}!${iid}`

/** How a project reads in the pane: `group/project`, with its host before it unless that is gitlab.com. */
export const projectLabel = (host: string, path: string): string => (host === DEFAULT_HOST ? path : projectOf(host, path))

/** Text with a token's every appearance, and anything shaped like a GitLab token or a bearer header, hidden. */
export function redact(text: string, secrets: readonly string[]): string {
  return secrets
    .filter(isFilled)
    .reduce((safe, secret) => safe.split(secret).join('[token]'), text)
    .replace(/\b(?:glpat|gloas|glcbt|glptt|gldt|glrt|glsoat|glffct)-[\w-]+/g, '[token]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [token]')
}

/** What a read found of one host: why it failed, or null when it answered. */
export type HostRead = { host: string; error: string | null }

/** The hosts' statuses after a read at `at`: an answering host is fresh as of now, a failing one keeps when it last answered. */
export const hostStatuses = (previous: Readonly<Record<string, HostStatus>>, reads: readonly HostRead[], at: number): Record<string, HostStatus> =>
  Object.fromEntries(reads.map(({ host, error }) => [host, { fetchedAt: error === null ? at : (previous[host]?.fetchedAt ?? null), error }]))

/** Which hosts are fresh and which stale, as `gitlab.com fresh, git.corp.com stale`; empty while there is only one host to say it of. */
export const hostsLine = (statuses: Readonly<Record<string, HostStatus>>): string =>
  Object.keys(statuses).length > 1
    ? Object.entries(statuses)
        .map(([host, { error }]) => `${host} ${error === null ? 'fresh' : 'stale'}`)
        .join(', ')
    : ''
