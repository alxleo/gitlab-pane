import { field, records, text } from './decode.ts'

import type { Ticket } from '../types'

/** The start of a ticket's link for the `jiraUrl` setting, `<site>/browse/`; empty for anything but an http(s) address, so ticket keys are not linked or read. */
export const browseUrl = (site: unknown): string => (typeof site === 'string' && /^https?:\/\/\S+$/u.test(site.trim()) ? `${site.trim().replace(/\/+$/u, '')}/browse/` : '')

/** Where a ticket key links, or null while no Jira site is set (`browse` is empty). */
export const ticketUrl = (browse: string, key: string): string | null => (browse === '' ? null : `${browse}${key}`)

const TICKET_KEY = /^[A-Z][A-Z0-9]+-\d+$/u

/** Whether a string is a ticket key, the only thing the pane hands acli of an MR's title. */
export const isTicketKey = (key: string): boolean => TICKET_KEY.test(key)

/** The JQL `acli jira workitem search` takes for these keys; anything that is not a key is left out. */
export const ticketQuery = (keys: readonly string[]): string => `key in (${keys.filter(isTicketKey).join(', ')})`

/** The fields an MR's page shows of its ticket, as `acli` names them; the status carries its category. */
const TICKET_FIELDS = 'key,issuetype,status,summary'

/** The argv after `acli` that reads these tickets as JSON. */
export const searchArgs = (keys: readonly string[]): string[] => [
  'jira',
  'workitem',
  'search',
  '--json',
  '--fields',
  TICKET_FIELDS,
  '--limit',
  String(keys.length),
  '--jql',
  ticketQuery(keys),
]

/** The argv after `acli` that moves a ticket to a status; it asks no question and answers JSON. */
export const transitionArgs = (ticket: string, status: string): string[] => ['jira', 'workitem', 'transition', '--key', ticket, '--status', status, '--yes', '--json']

/** What `acli jira workitem transition` said of one ticket. */
export type Transition = { kind: 'moved' } | { kind: 'no-step' } | { kind: 'refused'; message: string }

/**
 * acli's answer for one ticket. It exits 0 whether or not the ticket moved, and says which in each result; throws when the
 * answer says nothing of the ticket.
 */
export function readTransition(raw: unknown, ticket: string): Transition {
  const result = records(field(raw, 'results')).find(one => text(one.id) === ticket)
  if (result === undefined) {
    throw new Error(`acli said nothing of ${ticket}`)
  }
  if (text(result.status) === 'SUCCESS') {
    return { kind: 'moved' }
  }
  const message = text(result.message)
  return /no allowed transitions/iu.test(message) ? { kind: 'no-step' } : { kind: 'refused', message: message !== '' ? message : 'Jira did not move it' }
}

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
        const status = field(fields, 'status')
        const category = text(field(field(status, 'statusCategory'), 'key'))
        return [
          text(row.key),
          {
            type: text(field(field(fields, 'issuetype'), 'name')),
            status: text(field(status, 'name')),
            // Jira's category of the status, whatever the workflow names it: `new`, `indeterminate` or `done`.
            isDone: category !== '' ? category === 'done' : null,
            summary: text(field(fields, 'summary')),
          },
        ]
      })
  )
}
