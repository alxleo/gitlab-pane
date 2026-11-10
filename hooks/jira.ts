import { field, records, text } from './decode.ts'

import type { Ticket } from '../types'

/** The start of a ticket's link for the `jiraUrl` setting, `<site>/browse/`; empty for anything but an http(s) address, so ticket keys are not linked or read. */
export const browseUrl = (site: unknown): string => (typeof site === 'string' && /^https?:\/\/\S+$/u.test(site.trim()) ? `${site.trim().replace(/\/+$/u, '')}/browse/` : '')

/** Where a ticket key links, or null while no Jira site is set (`browse` is empty). */
export const ticketUrl = (browse: string, key: string): string | null => (browse === '' ? null : `${browse}${key}`)

const TICKET_KEY = /^[A-Z][A-Z0-9]+-\d+$/u

/** The JQL `acli jira workitem search` takes for these keys; anything that is not a key is left out. */
export const ticketQuery = (keys: readonly string[]): string => `key in (${keys.filter(key => TICKET_KEY.test(key)).join(', ')})`

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
