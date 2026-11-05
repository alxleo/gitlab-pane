// What GitLab's answers to the inbox documents mean: the MRs they name, and the signals on them. Plain data in, plain data
// out, typed by the generated types of the documents; inbox.ts sends the documents and keeps the result.
import { ACTOR_ROOM, EXCERPT_ROOM, HORIZON_MS, RULES } from './inbox-rules.ts'
import { foreign } from './model-text.ts'

import type { InboxAuthoredQuery, InboxQueueQuery, InboxTodosQuery } from './gitlab.generated.ts'
import type { InboxKind, InboxMr, InboxSignal } from '../types'

/** What a document gave of the inbox: who is signed in, and the MRs it named. */
export type Found = { user: string | null; mrs: InboxMr[] }

type Person = { username: string; name: string } | null

type MrFields = {
  iid: string
  state: string
  title: string
  webUrl: string | null
  draft: boolean
  author: Person
  project: { fullPath: string }
}

type NoteFields = {
  id: string
  body: string
  system: boolean
  createdAt: string
  author: { username: string; name: string; bot: boolean } | null
  systemNoteMetadata: { action: string | null } | null
}

/** What a system note's action says happened. Other actions (a title change, a branch) are not the inbox's news. */
const SYSTEM_KIND: Readonly<Record<string, InboxKind | undefined>> = {
  approved: 'approved',
  unapproved: 'unapproved',
  requested_changes: 'changes_requested',
  reviewed: 'review',
  commit: 'pushed',
}

/** What each to-do action asks, for those the rules count; the others (assigned, marked) are not the inbox's news. */
function todoKind(action: string): InboxKind | null {
  switch (action) {
    case 'review_requested':
    case 'approval_required':
      return 'review_requested'
    case 'mentioned':
    case 'directly_addressed':
      return 'mentioned'
    case 'review_submitted':
      return 'review'
    case 'build_failed':
      return 'build_failed'
    case 'unmergeable':
      return 'unmergeable'
    default:
      return null
  }
}

/** The first words of what someone wrote, on one line. */
const excerptOf = (body: string): string => foreign(body, EXCERPT_ROOM)

/** A note's id as the number in its link: `gid://gitlab/Note/123` is `123`. */
const noteIdOf = (id: string): string | null => /(\d+)$/.exec(id)?.[1] ?? null

/** The note a to-do's link points at: `…#note_123`. */
const noteOfUrl = (url: string | null): string | null => /#note_(\d+)$/.exec(url ?? '')?.[1] ?? null

const timeOf = (iso: string | null): number | null => {
  const at = iso === null ? Number.NaN : Date.parse(iso)
  return Number.isNaN(at) ? null : at
}

/** The kinds the rules count on an MR of this sort: a note of another kind is not kept. */
const wantedKinds = (isMine: boolean): ReadonlySet<InboxKind> =>
  new Set(RULES.filter(rule => rule.scope === 'any' || (rule.scope === 'mine') === isMine).flatMap(rule => rule.kinds))

function mrOf(host: string, me: string, fields: MrFields, signals: InboxSignal[], inQueue: boolean): InboxMr {
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
    inQueue,
    signals,
  }
}

/**
 * The events in an MR's latest notes that the rules count, within the horizon, by someone other than the user and not a
 * bot: a comment, an approval, a push. Newest first.
 */
function noteSignals(notes: readonly (NoteFields | null)[], me: string, isMine: boolean, now: number): InboxSignal[] {
  const wanted = wantedKinds(isMine)
  return notes.flatMap((note): InboxSignal[] => {
    const at = timeOf(note?.createdAt ?? null)
    if (note === null || at === null || at < now - HORIZON_MS || note.author === null || note.author.bot || note.author.username === me) {
      return []
    }
    const kind = note.system ? SYSTEM_KIND[note.systemNoteMetadata?.action ?? ''] : 'comment'
    if (kind === undefined || !wanted.has(kind)) {
      return []
    }
    return [{ kind, actor: note.author.username.slice(0, ACTOR_ROOM), at, note: noteIdOf(note.id), excerpt: kind === 'comment' || kind === 'pushed' ? excerptOf(note.body) : '' }]
  })
}

const present = <T>(list: readonly (T | null)[] | null | undefined): T[] => (list ?? []).flatMap(one => (one === null ? [] : [one]))

/** The MRs that wait on the user's to-dos, with who asked or said what. */
export function todoMrs(host: string, data: InboxTodosQuery | null): Found {
  const me = data?.currentUser?.username ?? null
  const mrs = present(data?.currentUser?.todos?.nodes).flatMap((todo): InboxMr[] => {
    const target = todo.targetEntity
    const kind = todoKind(todo.action)
    const at = timeOf(todo.createdAt)
    if (me === null || target === null || !('iid' in target) || kind === null || at === null) {
      return []
    }
    const signal: InboxSignal = { kind, actor: todo.author.username.slice(0, ACTOR_ROOM), at, note: noteOfUrl(todo.targetUrl), excerpt: excerptOf(todo.body) }
    return [mrOf(host, me, target, [signal], false)]
  })
  return { user: me, mrs }
}

/** The MRs the user is a reviewer of and has not approved, with the pushes since. */
export function queueMrs(host: string, data: InboxQueueQuery | null, now: number): Found {
  const me = data?.currentUser?.username ?? null
  const mrs = present(data?.currentUser?.reviewRequestedMergeRequests?.nodes).flatMap((fields): InboxMr[] => {
    const isApproved = present(fields.approvedBy?.nodes).some(one => one.username === me)
    const asked = timeOf(fields.createdAt)
    if (me === null || isApproved || fields.author?.username === me || asked === null) {
      return []
    }
    // The to-do, when there is one, says better who asked and when; `combine` keeps the newest request.
    const request: InboxSignal = { kind: 'review_requested', actor: (fields.author?.username ?? '').slice(0, ACTOR_ROOM), at: asked, note: null, excerpt: '' }
    return [mrOf(host, me, fields, [request, ...noteSignals(present(fields.notes.nodes), me, false, now)], true)]
  })
  return { user: me, mrs }
}

/** The user's open MRs with what others did on them lately, and the ones merged since the horizon by someone else. */
export function authoredMrs(host: string, data: InboxAuthoredQuery | null, now: number): Found {
  const me = data?.currentUser?.username ?? null
  if (me === null) {
    return { user: null, mrs: [] }
  }
  const opened = present(data?.currentUser?.opened?.nodes).map(fields => mrOf(host, me, fields, noteSignals(present(fields.notes.nodes), me, true, now), false))
  const merged = present(data?.currentUser?.merged?.nodes).flatMap((fields): InboxMr[] => {
    const at = timeOf(fields.mergedAt)
    const by = fields.mergeUser?.username
    return at === null || by === undefined || by === me ? [] : [mrOf(host, me, fields, [{ kind: 'merged', actor: by.slice(0, ACTOR_ROOM), at, note: null, excerpt: '' }], false)]
  })
  return { user: me, mrs: [...opened, ...merged] }
}

/** The same MR as several documents saw it becomes one, with all their signals, newest first; a request counts once. */
function joined(first: InboxMr, all: readonly InboxMr[]): InboxMr {
  const signals = all.flatMap(mr => mr.signals).sort((a, b) => b.at - a.at)
  const request = signals.find(signal => signal.kind === 'review_requested')
  const seen = new Set<string>()
  return {
    ...first,
    isMine: all.some(mr => mr.isMine),
    inQueue: all.some(mr => mr.inQueue),
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
