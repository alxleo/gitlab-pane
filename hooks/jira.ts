import type { Ticket } from '../types'

let browse = ''

/** Takes the `jiraUrl` setting; anything but an http(s) address leaves Jira out, so ticket keys are not linked or read. */
export function useJiraSite(site: unknown): void {
  browse = typeof site === 'string' && /^https?:\/\/\S+$/.test(site.trim()) ? `${site.trim().replace(/\/+$/, '')}/browse/` : ''
}

/** Where a ticket key links, or null while no Jira site is set. */
export const ticketUrl = (key: string): string | null => (browse ? `${browse}${key}` : null)

export const isJiraOn = (): boolean => browse !== ''

const TICKET_KEY = /^[A-Z][A-Z0-9]+-\d+$/

/** The JQL `glean jira audit` takes for these keys; anything that is not a key is left out. */
export const ticketQuery = (keys: readonly string[]): string =>
  `key in (${keys.filter(key => TICKET_KEY.test(key)).join(', ')})`

type Row = { key: string; type: string; status: string; summary: string }

/** `glean jira audit --json` rows, by key. */
export function readTickets(stdout: string): Record<string, Ticket> {
  const rows = JSON.parse(stdout) as Row[]
  return Object.fromEntries(
    rows.map(row => [row.key, { type: row.type, status: row.status, summary: row.summary }])
  )
}
