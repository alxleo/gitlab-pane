// What `mr-inbox inbox --json` prints, decoded without casts; kept apart from inbox.ts, which talks to the engine.
import { field, isRecord, records, text } from './decode'

import type { InboxActivity, InboxItem, InboxKind, InboxSection, InboxState } from '../types'

const ACTIVITY_KEPT = 3

const INBOX_KINDS: Record<InboxKind, true> = {
  changes_requested: true,
  unapproved: true,
  approved: true,
  review: true,
  comment: true,
  review_requested: true,
  pushed: true,
  opened: true,
  merged: true,
  unknown: true,
}

const isKind = (kind: string): kind is InboxKind => Object.hasOwn(INBOX_KINDS, kind)

/** A kind `mr-inbox` may add to without notice: one the pane has no word for is `unknown`, and drawn as such. */
const kindOf = (kind: string): InboxKind => (isKind(kind) ? kind : 'unknown')

/** Counts by kind; a card has never counted a kind the pane has no word for, and still does not. */
function countsOf(raw: Record<string, unknown>): InboxItem['counts'] {
  const counts: InboxItem['counts'] = {}
  for (const [name, count] of Object.entries(raw)) {
    const kind = kindOf(name)
    if (typeof count === 'number' && kind !== 'unknown') {
      counts[kind] = count
    }
  }
  return counts
}

/** The inbox as the pane keeps it, from `mr-inbox inbox --json`; throws on anything else. */
export function readInboxJson(raw: unknown): Pick<InboxState, 'sections' | 'syncedAt' | 'syncError'> {
  const sectionsRaw = field(raw, 'sections')
  if (!Array.isArray(sectionsRaw)) {
    throw new Error('mr-inbox answered without sections')
  }
  const sections: InboxSection[] = records(sectionsRaw).map(section => ({
    rule: text(section.rule),
    title: text(section.title),
    note: text(section.note) || null,
    items: records(section.items).map(
      (item): InboxItem => ({
        key: text(item.key),
        ref: text(item.ref),
        title: text(item.title),
        url: text(item.url),
        author: text(field(item.author, 'username')),
        authorName: text(field(item.author, 'name')),
        isMine: field(item.author, 'is_me') === true,
        state: text(item.state),
        isDraft: item.draft === true,
        unseen: typeof item.unseen === 'number' ? item.unseen : 0,
        counts: countsOf(isRecord(item.counts) ? item.counts : {}),
        activity: records(item.activity).slice(0, ACTIVITY_KEPT).map(
          (one): InboxActivity => ({
            kind: kindOf(text(one.kind)),
            actor: text(one.actor),
            at: text(one.at),
            url: text(one.url) || null,
            excerpt: text(one.excerpt),
          })
        ),
      })
    ),
  }))
  const sync = field(raw, 'sync')
  return {
    sections,
    syncedAt: text(field(sync, 'finished_at')) || null,
    syncError: field(sync, 'ok') === false ? text(field(sync, 'error')) || 'the last sync failed' : null,
  }
}
