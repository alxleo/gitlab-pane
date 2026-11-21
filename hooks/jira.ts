import { field, records, text } from './decode.ts'
import { LINK } from './drawing.ts'
import { drawnLine } from './format.ts'
import { cut } from './graphemes.ts'
import { linkMarkdown } from './markdown.ts'
import type { MarkdownText } from './markdown.ts'

import type { Ticket, TicketDetail } from '../types'

/** The start of a ticket's link for the `jiraUrl` setting, `<site>/browse/`; empty for anything but an http(s) address, so ticket keys are not linked or read. */
export const browseUrl = (site: unknown): string => (typeof site === 'string' && /^https?:\/\/\S+$/u.test(site.trim()) ? `${site.trim().replace(/\/+$/u, '')}/browse/` : '')

/** Where a ticket key links, or null while no Jira site is set (`browse` is empty). */
export const ticketUrl = (browse: string, key: string): string | null => (browse === '' ? null : `${browse}${key}`)

/**
 * A ticket key as a card draws it: its words, and with a Jira site set the link drawn, whose plain click opens the ticket
 * under the card and whose ⌘, ctrl or alt click opens it in Jira.
 */
export type TicketChip = { key: string; text: string; link: MarkdownText | null }

export const ticketChip = (browse: string, key: string): TicketChip => {
  const href = ticketUrl(browse, key)
  return { key, text: key, link: href !== null ? linkMarkdown(`${LINK.jira} ${key}`, href) : null }
}

const TICKET_KEY = /^[A-Z][A-Z0-9]+-\d+$/u

/** Whether a string is a ticket key, the only thing the pane hands acli of an MR's title. */
export const isTicketKey = (key: string): boolean => TICKET_KEY.test(key)

/** The JQL `acli jira workitem search` takes for these keys; anything that is not a key is left out. */
export const ticketQuery = (keys: readonly string[]): string => `key in (${keys.filter(isTicketKey).join(', ')})`

/** The fields an MR's page shows of its ticket, as `acli` names them; the status carries its category. */
const TICKET_FIELDS = 'key,issuetype,status,summary'

/** The argv after `acli` that reads the tickets a JQL query finds, at most `limit`, as JSON. */
const queryArgs = (limit: number, jql: string): string[] => ['jira', 'workitem', 'search', '--json', '--fields', TICKET_FIELDS, '--limit', String(limit), '--jql', jql]

/** The argv after `acli` that reads these tickets as JSON. */
export const searchArgs = (keys: readonly string[]): string[] => queryArgs(keys.length, ticketQuery(keys))

/** A status name as a JQL string: in double quotes, its quotes and backslashes escaped. */
const jqlString = (name: string): string => `"${name.replace(/["\\]/gu, '\\$&')}"`

/**
 * The argv after `acli` that reads which of these tickets have ever been in one of these statuses, as JSON. JQL takes a
 * status no workflow has without complaint, so the names of every project's workflow can be asked at once.
 */
export const reviewedArgs = (keys: readonly string[], names: readonly string[]): string[] => {
  const asked = keys.filter(isTicketKey)
  return queryArgs(asked.length, `${ticketQuery(asked)} AND status WAS IN (${names.map(jqlString).join(', ')})`)
}

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

/** The argv after `acli` that reads one ticket's description and assignee, as JSON, when it is opened under a card. */
export const detailArgs = (key: string): string[] => ['jira', 'workitem', 'search', '--json', '--fields', 'key,description,assignee', '--limit', '1', '--jql', ticketQuery([key])]

/** The most of a description kept: what opens under a card is a glance, and the whole is a ⌘-click away in Jira. */
const DESCRIPTION_ROOM = 600

/** Blocks of Jira's document format that end a line of their own. */
const BLOCKS = new Set(['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote', 'rule', 'tableRow'])

/** Inline nodes whose words are in their attributes, and which attribute: a mention's name, an emoji, a status, a link. */
const WORDS_IN: Readonly<Record<string, readonly string[]>> = { mention: ['text'], emoji: ['text', 'shortName'], status: ['text'], inlineCard: ['url'] }

/**
 * Jira's description as plain lines: the text of its document format (ADF), a block a line, list items as `• `, a table
 * row's cells joined by ` · `, a mention or a link by its words; blank lines dropped. A description written as a plain
 * string keeps its lines.
 */
function adfText(node: unknown): string {
  const lines: string[] = []
  if (typeof node === 'string') {
    // One at a time: spreading a long description's lines into a call runs out of stack.
    for (const each of node.split(/\r?\n/u)) {
      lines.push(each)
    }
  } else {
    let line = ''
    // Inside a table cell a paragraph ends no line: the row does.
    let inCell = 0
    const walk = (each: unknown): void => {
      const kind = text(field(each, 'type'))
      if (kind === 'text') {
        line += text(field(each, 'text'))
        return
      }
      if (kind === 'hardBreak') {
        lines.push(line)
        line = ''
        return
      }
      const attrs = field(each, 'attrs')
      const words = (WORDS_IN[kind] ?? []).map(name => text(field(attrs, name))).find(said => said !== '')
      if (words !== undefined) {
        line += words
        return
      }
      if (kind === 'listItem') {
        line += '• '
      }
      const isCell = kind === 'tableCell' || kind === 'tableHeader'
      if (isCell && line.trim() !== '') {
        line += ' · '
      }
      inCell += isCell ? 1 : 0
      const content = field(each, 'content')
      if (Array.isArray(content)) {
        content.forEach(walk)
      }
      inCell -= isCell ? 1 : 0
      if (BLOCKS.has(kind) && inCell === 0 && line.trim() !== '' && line.trim() !== '•') {
        lines.push(line)
        line = ''
      }
    }
    walk(node)
    lines.push(line)
  }
  return lines
    .map(drawnLine)
    .filter(each => each !== '' && each !== '•')
    .join('\n')
}

/** `acli`'s answer for tickets read whole: each one's assignee by name and its description, cut, by key. */
export function readTicketDetails(raw: unknown): Record<string, Pick<TicketDetail, 'assignee' | 'description'>> {
  if (!Array.isArray(raw)) {
    throw new Error('acli answered something other than a list of tickets')
  }
  return Object.fromEntries(
    records(raw)
      .filter(row => text(row.key) !== '')
      .map(row => {
        const fields = field(row, 'fields')
        const description = adfText(field(fields, 'description'))
        const kept = cut(description, DESCRIPTION_ROOM, DESCRIPTION_ROOM * 2)
        return [
          text(row.key),
          {
            assignee: drawnLine(text(field(field(fields, 'assignee'), 'displayName'))),
            description: kept === description ? description : `${kept.trimEnd()}…`,
          },
        ]
      })
  )
}

/** The most tickets read whole kept: every drawing reads them all, so the oldest read go. */
const TICKETS_HELD = 30

/** The tickets read whole with `key`'s latest read among them, newest read first, past `TICKETS_HELD` the oldest let go. */
export const keptTicketDetails = (held: Readonly<Record<string, TicketDetail>>, key: string, detail: TicketDetail): Record<string, TicketDetail> =>
  Object.fromEntries(
    Object.entries({ ...held, [key]: detail })
      .toSorted(([, a], [, b]) => b.at - a.at)
      .slice(0, TICKETS_HELD)
  )

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
