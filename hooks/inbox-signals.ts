// What the inbox's answers mean, whichever read gave them: an MR they name, and the signals on it its notes carry. Plain
// data in, plain data out; each `ask-inbox-*.ts` module reads its own answer with these, and inbox.ts keeps the result.
import { present, timeOf } from './decode.ts'
import { cut } from './graphemes.ts'
import { ACTOR_ROOM, EXCERPT_ROOM, HORIZON_MS, RULES } from './inbox-rules.ts'
import { foreign } from './model-text.ts'

import type { InboxMrFieldsFragment, InboxNoteFieldsFragment } from './gitlab.generated.ts'

import type { InboxKind, InboxMr, InboxSignal } from '../types'

/** What a document gave of the inbox: who is signed in, and the MRs it named. */
export type Found = { user: string | null; mrs: InboxMr[] }

/** What a system note's action says happened. Other actions (a title change, a branch) are not the inbox's news. */
const SYSTEM_KIND: Readonly<Record<string, InboxKind | undefined>> = {
  approved: 'approved',
  unapproved: 'unapproved',
  requested_changes: 'changes_requested',
  reviewed: 'review',
  commit: 'pushed',
}

/** The first words of what someone wrote, on one line. */
export const excerptOf = (body: string): string => foreign(body, EXCERPT_ROOM)
/** What a push says: GitLab's note is "added 2 commits", then the commits as HTML and a link, each its own paragraph. */
const pushOf = (body: string): string => excerptOf(body.split(/\n\s*\n/u, 1)[0] ?? '')
/** A username as the snapshot keeps it: cut between characters at the room it has. */
export const actorOf = (username: string): string => cut(username, ACTOR_ROOM, ACTOR_ROOM)

/** A note's id as the number in its link: `gid://gitlab/Note/123` is `123`. */
const noteIdOf = (id: string): string | null => /(\d+)$/u.exec(id)?.[1] ?? null

/** The kinds the rules count on an MR of this sort: a note of another kind is not kept. */
const wantedKinds = (isMine: boolean, isFollowed: boolean): ReadonlySet<InboxKind> =>
  new Set(RULES.filter(rule => (rule.scope === 'any' || (rule.scope === 'mine') === isMine) && (!rule.isFollowing || isFollowed)).flatMap(rule => rule.kinds))

/** What a document knows of how an MR came to be listed. */
type Why = { inQueue: boolean; isFollowed: boolean; cutoff: number | null }

export const PLAIN: Why = { inQueue: false, isFollowed: false, cutoff: null }

export function mrOf(host: string, me: string, fields: InboxMrFieldsFragment, signals: InboxSignal[], why: Why): InboxMr {
  const path = fields.project.fullPath
  const iid = Number(fields.iid)
  return {
    host,
    path,
    iid,
    title: fields.title,
    url: fields.webUrl ?? `https://${host}/${path}/-/merge_requests/${iid}`,
    author: fields.author?.username ?? '',
    authorName: fields.author?.name ?? '',
    isMine: fields.author?.username === me,
    state: fields.state,
    isDraft: fields.draft,
    ...why,
    signals,
  }
}

/**
 * The events in an MR's latest notes that the rules count, within the horizon, by someone other than the user and not a
 * bot: a comment, an approval, a push. Newest first.
 */
export function noteSignals(notes: readonly (InboxNoteFieldsFragment | null)[], me: string, isMine: boolean, isFollowed: boolean, now: number): InboxSignal[] {
  const wanted = wantedKinds(isMine, isFollowed)
  return notes.flatMap((note): InboxSignal[] => {
    const at = timeOf(note?.createdAt ?? null)
    if (note === null || at === null || at < now - HORIZON_MS || note.author === null || note.author.bot || note.author.username === me) {
      return []
    }
    const kind = note.system ? SYSTEM_KIND[note.systemNoteMetadata?.action ?? ''] : 'comment'
    if (kind === undefined || !wanted.has(kind)) {
      return []
    }
    return [
      { kind, actor: actorOf(note.author.username), at, note: noteIdOf(note.id), excerpt: kind === 'comment' ? excerptOf(note.body) : kind === 'pushed' ? pushOf(note.body) : '' },
    ]
  })
}

/** The notes GitLab sent of an MR, and whether it kept older ones back. */
type Notes = { pageInfo: { hasPreviousPage: boolean }; nodes: readonly (InboxNoteFieldsFragment | null)[] | null }

/** When the oldest note sent was written, if GitLab kept older ones back: nothing before it is counted, so counts are lower bounds. */
export function cutoffOf(notes: Notes): number | null {
  const times = present(notes.nodes).flatMap(note => timeOf(note.createdAt) ?? [])
  return notes.pageInfo.hasPreviousPage && times.length > 0 ? Math.min(...times) : null
}

/** The same MR as several documents saw it becomes one, with all their signals, newest first; a request counts once. */
function joined(first: InboxMr, all: readonly InboxMr[]): InboxMr {
  const signals = all.flatMap(mr => mr.signals).toSorted((a, b) => b.at - a.at)
  const request = signals.find(signal => signal.kind === 'review_requested')
  const seen = new Set<string>()
  return {
    ...first,
    isMine: all.some(mr => mr.isMine),
    inQueue: all.some(mr => mr.inQueue),
    isFollowed: all.some(mr => mr.isFollowed),
    // The latest cut is the one that hides most.
    cutoff: all.reduce<number | null>((latest, mr) => (mr.cutoff === null ? latest : Math.max(latest ?? 0, mr.cutoff)), null),
    signals: signals.filter(signal => {
      const id = `${signal.kind}|${signal.actor}|${signal.at}`
      const isRepeat = seen.has(id) || (signal.kind === 'review_requested' && signal !== request)
      seen.add(id)
      return !isRepeat
    }),
  }
}

/**
 * What a host's documents found, as one list: an MR any of them named once, and only those with something to count (an
 * open MR nobody touched lately has none, and is the Mine tab's business).
 */
export function combine(founds: readonly Found[]): Found {
  const user = founds.find(found => found.user !== null)?.user ?? null
  const byKey = new Map<string, { first: InboxMr; all: InboxMr[] }>()
  for (const mr of founds.flatMap(found => found.mrs)) {
    const key = `${mr.path}!${mr.iid}`
    const known = byKey.get(key)
    if (known === undefined) {
      byKey.set(key, { first: mr, all: [mr] })
    } else {
      known.all.push(mr)
    }
  }
  const mrs = [...byKey.values()].map(one => joined(one.first, one.all)).filter(mr => mr.signals.length > 0 || mr.inQueue)
  return { user, mrs }
}
