// The inbox's built-in rules, and how they turn what GitLab said into sections. Plain data in, plain data out: the engine
// side (inbox.ts) reads GitLab, keeps the snapshot and the seen marks, and calls these.
import { cardKey } from './hosts.ts'
import { shortHash } from './identity.ts'

import type { InboxActivity, InboxItem, InboxKind, InboxMr, InboxSection, InboxSnapshot } from '../types'

/** Whose MRs a rule looks at: the user's own, everyone else's, or both. */
type Scope = 'mine' | 'others' | 'any'

/**
 * A rule is a title and the kinds of event it counts, on whose MRs. An MR shows under a rule while it has an event of
 * those kinds since it was marked seen; under a queue rule it shows for as long as it is in the queue.
 */
export type Rule = {
  /** What `/mrs --rule` takes, and the key of the tab. */
  name: string
  title: string
  kinds: readonly InboxKind[]
  scope: Scope
  isQueue: boolean
  /** Only MRs of the people and projects the `inboxFollow` setting names. */
  isFollowing: boolean
}

/**
 * The rules, in the order an MR is given to the first that has it. What blocks a merge comes before what is said about it.
 */
export const RULES: readonly Rule[] = [
  { name: 'review-requested', title: 'Review requested', kinds: ['review_requested', 'pushed'], scope: 'others', isQueue: true, isFollowing: false },
  { name: 'mentions', title: 'Mentions', kinds: ['mentioned'], scope: 'any', isQueue: false, isFollowing: false },
  { name: 'build-failed', title: 'Build failed', kinds: ['build_failed'], scope: 'any', isQueue: false, isFollowing: false },
  { name: 'cant-merge', title: "Can't merge", kinds: ['unmergeable'], scope: 'any', isQueue: false, isFollowing: false },
  {
    name: 'on-my-mrs',
    title: 'On my MRs',
    kinds: ['changes_requested', 'unapproved', 'approved', 'review', 'comment', 'pushed', 'merged'],
    scope: 'mine',
    isQueue: false,
    isFollowing: false,
  },
  {
    name: 'following',
    title: 'Following',
    kinds: ['changes_requested', 'unapproved', 'approved', 'review', 'comment', 'pushed', 'merged'],
    scope: 'others',
    isQueue: false,
    isFollowing: true,
  },
]

/** The rule a person typed: its name, or its title in any case. */
export const ruleNamed = (text: string): Rule | undefined => {
  const wanted = text.trim().toLowerCase()
  return RULES.find(rule => rule.name === wanted || rule.title.toLowerCase() === wanted)
}

/** Activity older than this never counts, so an MR nobody ever marked seen does not bring its whole history. */
export const HORIZON_MS = 14 * 24 * 3_600_000
/** The most MRs and the most events per MR a snapshot keeps; with the cuts below it stays under 128 kB as JSON. */
export const MAX_MRS = 50
export const MAX_SIGNALS = 10
/** Characters of what someone wrote, of a username and of a title that the inbox keeps. */
export const EXCERPT_ROOM = 80
export const ACTOR_ROOM = 40
const TITLE_ROOM = 100
const ACTIVITY_SHOWN = 3

const seenPrefix = (host: string, user: string): string => `seen:${shortHash(`${host}/${user}`)}:`

/** The key of an MR's seen mark in the plugin store: per signed-in user and host, so two accounts keep their own. */
export const seenKey = (host: string, user: string, path: string, iid: number): string => `${seenPrefix(host, user)}${shortHash(`${path}!${iid}`)}`

/** The seen key of an MR in a snapshot; null while its host has never said who the user is. */
export function seenKeyOf(snapshot: InboxSnapshot, mr: InboxMr): string | null {
  const user = snapshot.hosts[mr.host]?.user
  return typeof user === 'string' ? seenKey(mr.host, user, mr.path, mr.iid) : null
}

/**
 * The store keys of marks for MRs the snapshot no longer lists. Only a host that answered is looked at: one that did not
 * says nothing of its MRs, and its marks stay.
 */
export function staleSeenKeys(storeKeys: readonly string[], snapshot: InboxSnapshot): string[] {
  const wanted = new Set(snapshot.mrs.flatMap(mr => seenKeyOf(snapshot, mr) ?? []))
  const answered = Object.entries(snapshot.hosts).flatMap(([host, { user, failure }]) => (user !== null && failure === null ? [seenPrefix(host, user)] : []))
  return storeKeys.filter(key => answered.some(prefix => key.startsWith(prefix)) && !wanted.has(key))
}

/** Each MR's shortest `repo!iid` that no other MR in the list shares, by card key. */
function refsOf(mrs: readonly InboxMr[]): Map<string, string> {
  const named = (mr: InboxMr, depth: number) => `${mr.path.split('/').slice(-depth).join('/')}!${mr.iid}`
  const refs = new Map<string, string>()
  for (const mr of mrs) {
    const depth = mr.path.split('/').length
    let at = 1
    while (at < depth && mrs.some(other => other !== mr && named(other, at) === named(mr, at))) {
      at += 1
    }
    refs.set(cardKey(mr.host, mr.path, mr.iid), named(mr, at))
  }
  return refs
}

/** A flag and a time as one number to order by, the flag first: epoch milliseconds stay under 2^41. */
const rank = (isFirst: boolean, at: number): number => (isFirst ? 2 ** 42 : 0) + at

const isoOf = (at: number): string => new Date(at).toISOString()

/** Whether a rule looks at this MR at all. */
const isInScope = (rule: Rule, mr: InboxMr): boolean =>
  (rule.scope === 'any' || (rule.scope === 'mine') === mr.isMine) &&
  (!rule.isFollowing || mr.isFollowed) &&
  // A queue rule is about review: an MR is in it for being asked, not for what happens on an MR followed.
  (!rule.isQueue || mr.inQueue || mr.signals.some(signal => signal.kind === 'review_requested'))

/** A project on a host. */
type Repo = { host: string; path: string }

/** What narrows the sections to the session's repo, and what explains an empty one. */
export type Context = {
  /** The Inbox's "here" switch, and the session's repo while it has one. */
  here: { isOn: boolean; repo: Repo | null }
  /** How many entries `inboxFollow` names. */
  followCount: number
}

/** Every repo, nobody followed. */
const EVERYWHERE: Context = { here: { isOn: false, repo: null }, followCount: 0 }

/** Why a rule that shows nothing shows nothing, when there is a reason to give. */
function noteOf(rule: Rule, snapshot: InboxSnapshot, context: Context): string | null {
  const tokenless = Object.entries(snapshot.hosts).flatMap(([host, one]) => (one.failure?.kind === 'no-token' ? [host] : []))
  if (context.here.isOn && context.here.repo === null) {
    return 'this session has no GitLab repo'
  }
  if (tokenless.length > 0) {
    return `no token for ${tokenless.join(', ')}`
  }
  return rule.isFollowing && context.followCount === 0 ? 'name people or projects in the inboxFollow setting' : null
}

/**
 * The sections as the pane shows them: each MR once, under the first rule that has it, and whether all of a rule's MRs
 * show above it. What a rule's "mark all seen" and `/mrs --rule` act on is this, the MRs its tab shows.
 */
export function ownedSections(sections: readonly InboxSection[]): (InboxSection & { isAllAbove: boolean })[] {
  const firstRule = new Map<string, string>()
  for (const section of sections) {
    for (const item of section.items) {
      if (!firstRule.has(item.key)) {
        firstRule.set(item.key, section.rule)
      }
    }
  }
  return sections.map(section => ({
    ...section,
    items: section.items.filter(item => firstRule.get(item.key) === section.rule),
    isAllAbove: section.items.length > 0 && section.items.every(item => firstRule.get(item.key) !== section.rule),
  }))
}

/**
 * The sections the rules make of a snapshot, given when each MR was marked seen (by seen key). Within a section an MR with
 * news comes first, the newest first; a queue keeps the MRs without news after them.
 */
export function sectionsOf(snapshot: InboxSnapshot, seen: Readonly<Record<string, number>>, context: Context = EVERYWHERE): InboxSection[] {
  const { repo } = context.here
  const mrs = !context.here.isOn ? snapshot.mrs : snapshot.mrs.filter(mr => repo !== null && mr.host === repo.host && mr.path === repo.path)
  const refs = refsOf(snapshot.mrs)
  return RULES.map(rule => {
    const items = mrs.flatMap((mr): { item: InboxItem; latest: number }[] => {
      if (!isInScope(rule, mr)) {
        return []
      }
      const counted = mr.signals.filter(signal => rule.kinds.includes(signal.kind))
      const since = seen[seenKeyOf(snapshot, mr) ?? ''] ?? 0
      const fresh = counted.filter(signal => signal.at > since)
      if (fresh.length === 0 && !(rule.isQueue && mr.inQueue)) {
        return []
      }
      const counts: InboxItem['counts'] = {}
      for (const signal of fresh) {
        counts[signal.kind] = (counts[signal.kind] ?? 0) + 1
      }
      const key = cardKey(mr.host, mr.path, mr.iid)
      return [
        {
          latest: counted[0]?.at ?? 0,
          item: {
            key,
            ref: refs.get(key) ?? `${mr.path}!${mr.iid}`,
            title: mr.title,
            url: mr.url,
            author: mr.author,
            authorName: mr.authorName,
            isMine: mr.isMine,
            state: mr.state,
            isDraft: mr.isDraft,
            unseen: fresh.length,
            isCapped: mr.cutoff !== null && mr.cutoff > since,
            counts,
            activity: counted.slice(0, ACTIVITY_SHOWN).map(
              (signal): InboxActivity => ({
                kind: signal.kind,
                actor: signal.actor,
                at: isoOf(signal.at),
                url: signal.note === null ? null : `${mr.url}#note_${signal.note}`,
                excerpt: signal.excerpt,
              })
            ),
          },
        },
      ]
    })
    items.sort((a, b) => rank(b.item.unseen > 0, b.latest) - rank(a.item.unseen > 0, a.latest))
    return { rule: rule.name, title: rule.title, note: items.length === 0 ? noteOf(rule, snapshot, context) : null, items: items.map(one => one.item) }
  })
}

/** The newest event of an MR, for ordering. */
const newest = (mr: InboxMr): number => mr.signals[0]?.at ?? 0

/**
 * The MRs a snapshot keeps: each with its newest events, and the ones with the newest news if there are more than fit.
 * A queue MR outranks any other, as it shows for as long as it waits.
 */
export function bounded(mrs: readonly InboxMr[]): InboxMr[] {
  return mrs
    .map(mr => ({ ...mr, title: mr.title.slice(0, TITLE_ROOM), signals: mr.signals.slice(0, MAX_SIGNALS) }))
    .sort((a, b) => rank(b.inQueue, newest(b)) - rank(a.inQueue, newest(a)))
    .slice(0, MAX_MRS)
}
