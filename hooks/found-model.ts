// What a search on the Mine tab shows: the MRs the pane holds that match, wherever they are kept. Open MRs as their cards,
// in every repo and fold; the user's MRs merged lately as the merged section's rows; others' MRs from the inbox as one link
// each. Pure, on plain data; the draw files only map it to elements.
import { cardKey } from './hosts'
import { shortHash } from './identity'
import { LANDED_SHOWN, LANDED_WITHIN_MS } from './landed'
import { mergedModel, mrLinkText } from './landed-model'
import type { MergedRow } from './landed-model'
import { found } from './search'
import type { Findable, Query } from './search'

import type { InboxMr, Landed, MrCard } from '../types'

/** The most inbox MRs a search lists: one is what is looked for, and the inbox has its own tab for the rest. */
export const INBOX_FOUND_SHOWN = 5

/** An inbox MR a search found: its link, and the repo, who wrote it and, once it is not open, what became of it. */
export type InboxRow = { key: string; boxKey: string; mr: { href: string; text: string }; about: string }

/** What matched: the rows shown, and how many merged and inbox MRs matched past the few shown. */
export type Matches = { cards: MrCard[]; merged: MergedRow[]; inbox: InboxRow[]; left: { merged: number; inbox: number } }

/**
 * While a search is on, what the Mine tab shows in place of the list and its folds: how many it found, all of them counted,
 * the open MRs as the list draws its rows, then the user's merged MRs and the inbox's that match, each with a line saying how
 * many more matched than are shown, or none.
 */
export type FoundList<Row> = {
  heading: string
  isEmpty: boolean
  rows: Row[]
  merged: MergedRow[]
  mergedMore: string | null
  inbox: InboxRow[]
  inboxMore: string | null
}

export function foundList<Row>(matches: Matches, rowsOf: (cards: readonly MrCard[]) => Row[]): FoundList<Row> {
  const { cards, merged, inbox, left } = matches
  const count = cards.length + merged.length + inbox.length + left.merged + left.inbox
  return {
    heading: `Found · ${count}`,
    isEmpty: count === 0,
    rows: rowsOf(cards),
    merged,
    mergedMore: left.merged > 0 ? `+${left.merged} more merged` : null,
    inbox,
    inboxMore: left.inbox > 0 ? `+${left.inbox} more in the Inbox tab` : null,
  }
}

const repoName = (path: string): string => path.split('/').pop() ?? path

const cardFindable = (card: MrCard): Findable => ({ iid: card.iid, title: card.title, branch: card.branch.source, repo: card.path, people: [card.author] })
const landedFindable = (each: Landed): Findable => ({ iid: each.iid, title: each.title, branch: '', repo: each.path, people: [] })
const inboxFindable = (mr: InboxMr): Findable => ({ iid: mr.iid, title: mr.title, branch: '', repo: mr.path, people: [mr.author, mr.authorName] })

/**
 * Every MR the pane holds that matches, best first: the open `cards` (in the order given, which breaks ties), then the
 * user's MRs merged lately that are not cards, then the inbox's MRs that are neither, at most `INBOX_FOUND_SHOWN`.
 */
export function matchesOf(query: Query, held: { cards: readonly MrCard[]; landed: readonly Landed[]; inbox: readonly InboxMr[]; now: number }): Matches {
  const cards = found(query, held.cards, cardFindable)
  const cardKeys = new Set(held.cards.map(card => card.key))
  // The merged MRs the pane holds (the newest few of each host) that are not cards, newest first, as the merged section has
  // them, so that of matches as good the newest are kept; the search keeps the few that match best.
  const lately = held.landed
    .filter(each => held.now - each.mergedAt <= LANDED_WITHIN_MS && !cardKeys.has(cardKey(each.host, each.path, each.iid)))
    .toSorted((a, b) => b.mergedAt - a.mergedAt)
  const landedFound = found(query, lately, landedFindable)
  const landed = landedFound.slice(0, LANDED_SHOWN)
  const order = new Map(landed.map((each, i) => [cardKey(each.host, each.path, each.iid), i]))
  // The merged section's own rows, open, in the order the search ranks them rather than by when they merged.
  const merged = (mergedModel(landed, { cardKeys, repoFilter: '', isOpen: true, now: held.now })?.rows ?? []).toSorted((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0))
  const shown = new Set([...cardKeys, ...merged.map(row => row.key)])
  const inboxFound = found(query, held.inbox, inboxFindable)
    .map(mr => ({ mr, key: cardKey(mr.host, mr.path, mr.iid) }))
    .filter(({ key }, i, all) => !shown.has(key) && all.findIndex(other => other.key === key) === i)
  const inbox = inboxFound.slice(0, INBOX_FOUND_SHOWN).map(({ mr, key }) => ({
    key,
    boxKey: `found-${shortHash(key)}`,
    mr: { href: mr.url, text: mrLinkText(mr.iid, mr.title) },
    about: [repoName(mr.path), mr.authorName !== '' ? mr.authorName : mr.author, ...(mr.state !== 'opened' ? [mr.state] : [])].join(' · '),
  }))
  return { cards, merged, inbox, left: { merged: landedFound.length - landed.length, inbox: inboxFound.length - inbox.length } }
}
