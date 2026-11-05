import { field, records, text } from './decode'

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

/** The JQL `acli jira workitem search` takes for these keys; anything that is not a key is left out. */
export const ticketQuery = (keys: readonly string[]): string =>
  `key in (${keys.filter(key => TICKET_KEY.test(key)).join(', ')})`

/** The fields a ticket's hover card shows, as `acli` names them. */
export const TICKET_FIELDS = 'key,issuetype,status,summary'

/** `acli jira workitem search --json` rows, Jira's own issue shape, by key; throws when the answer is not a list. */
export function readTickets(raw: unknown): Record<string, Ticket> {
  if (!Array.isArray(raw)) {
    throw new Error('acli answered something other than a list of tickets')
  }
  return Object.fromEntries(
    records(raw)
      .filter(row => text(row.key) !== '')
      .map(row => {
        const fields = field(row, 'fields')
        return [
          text(row.key),
          {
            type: text(field(field(fields, 'issuetype'), 'name')),
            status: text(field(field(fields, 'status'), 'name')),
            summary: text(field(fields, 'summary')),
          },
        ]
      })
  )
}
