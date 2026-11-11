// What GitLab's answers to the inbox documents mean: the MRs they name, and the signals on them. Plain data in, plain data
// out, typed by the generated types of the documents; inbox.ts sends the documents and keeps the result.
import { present, timeOf } from './decode.ts'
import { cut } from './graphemes.ts'
import { cardKey } from './hosts.ts'
import { ACTOR_ROOM, EXCERPT_ROOM, HORIZON_MS, RULES } from './inbox-rules.ts'
import { foreign } from './model-text.ts'

import type { InboxAuthoredQuery, InboxFollowProjectQuery, InboxFollowUserQuery, InboxQueueQuery, InboxTodosPlainQuery, InboxTodosQuery } from './gitlab.generated.ts'
import type { InboxKind, InboxMr, InboxSignal, OwnMrs } from '../types'

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
/** What a push says: GitLab's note is "added 2 commits", then the commits as HTML and a link, each its own paragraph. */
const pushOf = (body: string): string => excerptOf(body.split(/\n\s*\n/u, 1)[0] ?? '')
/** A username as the snapshot keeps it: cut between characters at the room it has. */
const actorOf = (username: string): string => cut(username, ACTOR_ROOM, ACTOR_ROOM)

/** A note's id as the number in its link: `gid://gitlab/Note/123` is `123`. */
const noteIdOf = (id: string): string | null => /(\d+)$/u.exec(id)?.[1] ?? null

/** The note a to-do's link points at: `…#note_123`. */
const noteOfUrl = (url: string | null): string | null => /#note_(\d+)$/u.exec(url ?? '')?.[1] ?? null

/** The kinds the rules count on an MR of this sort: a note of another kind is not kept. */
const wantedKinds = (isMine: boolean, isFollowed: boolean): ReadonlySet<InboxKind> =>
  new Set(RULES.filter(rule => (rule.scope === 'any' || (rule.scope === 'mine') === isMine) && (!rule.isFollowing || isFollowed)).flatMap(rule => rule.kinds))

/** What a document knows of how an MR came to be listed. */
type Why = { inQueue: boolean; isFollowed: boolean; cutoff: number | null }

const PLAIN: Why = { inQueue: false, isFollowed: false, cutoff: null }

function mrOf(host: string, me: string, fields: MrFields, signals: InboxSignal[], why: Why): InboxMr {
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
function noteSignals(notes: readonly (NoteFields | null)[], me: string, isMine: boolean, isFollowed: boolean, now: number): InboxSignal[] {
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
type Notes = { pageInfo: { hasPreviousPage: boolean }; nodes: readonly (NoteFields | null)[] | null }

/** When the oldest note sent was written, if GitLab kept older ones back: nothing before it is counted, so counts are lower bounds. */
function cutoffOf(notes: Notes): number | null {
  const times = present(notes.nodes).flatMap(note => timeOf(note.createdAt) ?? [])
  return notes.pageInfo.hasPreviousPage && times.length > 0 ? Math.min(...times) : null
}

/** A to-do as either document gives it: what it was about is `targetEntity` (GitLab 17.4 and newer) or `target`. */
type Todo = {
  action: string
  createdAt: string
  body: string
  targetUrl: string | null
  author: { username: string }
  target: MrFields | { webUrl: string | null } | null
}

/** The MRs that wait on the user's to-dos, with who asked or said what. */
function mrsOfTodos(host: string, me: string | null, todos: readonly Todo[]): Found {
  const mrs = todos.flatMap((todo): InboxMr[] => {
    const { target } = todo
    const kind = todoKind(todo.action)
    const at = timeOf(todo.createdAt)
    if (me === null || target === null || !('iid' in target) || kind === null || at === null) {
      return []
    }
    const signal: InboxSignal = { kind, actor: actorOf(todo.author.username), at, note: noteOfUrl(todo.targetUrl), excerpt: excerptOf(todo.body) }
    return [mrOf(host, me, target, [signal], PLAIN)]
  })
  return { user: me, mrs }
}

type EntityTodo = NonNullable<NonNullable<NonNullable<NonNullable<InboxTodosQuery['currentUser']>['todos']>['nodes']>[number]>
type PlainTodo = NonNullable<NonNullable<NonNullable<NonNullable<InboxTodosPlainQuery['currentUser']>['todos']>['nodes']>[number]>

/** The MRs that wait on the user's to-dos, from whichever document the host was sent. */
export function todoMrs(host: string, data: InboxTodosQuery | InboxTodosPlainQuery | null): Found {
  const nodes: readonly (EntityTodo | PlainTodo | null)[] = data?.currentUser?.todos?.nodes ?? []
  const todos = present(nodes).map((todo): Todo => ('targetEntity' in todo ? { ...todo, target: todo.targetEntity } : todo))
  return mrsOfTodos(host, data?.currentUser?.username ?? null, todos)
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
    const request: InboxSignal = { kind: 'review_requested', actor: actorOf(fields.author?.username ?? ''), at: asked, note: null, excerpt: '' }
    return [mrOf(host, me, fields, [request, ...noteSignals(present(fields.notes.nodes), me, false, false, now)], { ...PLAIN, inQueue: true, cutoff: cutoffOf(fields.notes) })]
  })
  return { user: me, mrs }
}

/**
 * The user's MRs merged since the horizon, as the answer to `InboxAuthored` lists them: the one place that says where in it
 * they are. Three readers take what each needs of them: the Jira moves (`ownMrs`), the rules (`authoredMrs`) and the merged
 * section (`mergedLately`, in landed.ts). They need different parts and keep different MRs of the nodes (the moves every one,
 * the rules those merged by someone else, the section the newest few with a branch and commits), so the nodes are shared and
 * not what is made of them.
 */
export const mergedNodes = (data: InboxAuthoredQuery | null) => present(data?.currentUser?.merged?.nodes)

/** From the same answer, for the Jira moves: who the user is on the host, and every MR of theirs merged since the horizon, by card key. */
export function ownMrs(host: string, data: InboxAuthoredQuery | null): OwnMrs {
  return {
    user: data?.currentUser?.username ?? null,
    merged: mergedNodes(data).map(mr => ({ key: cardKey(host, mr.project.fullPath, mr.iid), iid: Number(mr.iid), title: mr.title })),
  }
}

/** The user's open MRs with what others did on them lately, and the ones merged since the horizon by someone else. */
export function authoredMrs(host: string, data: InboxAuthoredQuery | null, now: number): Found {
  const me = data?.currentUser?.username ?? null
  if (me === null) {
    return { user: null, mrs: [] }
  }
  const opened = present(data?.currentUser?.opened?.nodes).map(fields =>
    mrOf(host, me, fields, noteSignals(present(fields.notes.nodes), me, true, false, now), { ...PLAIN, cutoff: cutoffOf(fields.notes) })
  )
  const merged = mergedNodes(data).flatMap((fields): InboxMr[] => {
    const at = timeOf(fields.mergedAt)
    const by = fields.mergeUser?.username
    return at === null || by === undefined || by === me ? [] : [mrOf(host, me, fields, [{ kind: 'merged', actor: actorOf(by), at, note: null, excerpt: '' }], PLAIN)]
  })
  return { user: me, mrs: [...opened, ...merged] }
}

/** The open and the lately merged MRs of a followed person or project. */
type Followed = NonNullable<InboxFollowUserQuery['user']>

function followedMrs(host: string, me: string | null, group: Followed | null | undefined, now: number): Found {
  if (me === null || group === null || group === undefined) {
    return { user: me, mrs: [] }
  }
  const opened = present(group.opened?.nodes).map(fields =>
    mrOf(host, me, fields, noteSignals(present(fields.notes.nodes), me, fields.author?.username === me, true, now), { ...PLAIN, isFollowed: true, cutoff: cutoffOf(fields.notes) })
  )
  const merged = present(group.merged?.nodes).flatMap((fields): InboxMr[] => {
    const at = timeOf(fields.mergedAt)
    const by = fields.mergeUser?.username
    return at === null || by === undefined || by === me
      ? []
      : [mrOf(host, me, fields, [{ kind: 'merged', actor: actorOf(by), at, note: null, excerpt: '' }], { ...PLAIN, isFollowed: true })]
  })
  return { user: me, mrs: [...opened, ...merged] }
}

/** A followed person's MRs: the open ones with what others did on them lately, and the ones merged by someone else. */
export const followedUserMrs = (host: string, data: InboxFollowUserQuery | null, now: number): Found => followedMrs(host, data?.currentUser?.username ?? null, data?.user, now)

/** A followed project's MRs, the same. */
export const followedProjectMrs = (host: string, data: InboxFollowProjectQuery | null, now: number): Found =>
  followedMrs(host, data?.currentUser?.username ?? null, data?.project, now)

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
