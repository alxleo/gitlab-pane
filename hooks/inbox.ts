import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { readHosts } from './data'
import { isEqual } from './equal'
import { Failure, kindOf } from './failure'
import { clear, quietly, record, reported } from './failures'
import type { RawResponse } from './gitlab-documents'
import { ask, askVariant } from './graphql'
import { inboxAuthoredQuery, inboxBriefQuery, inboxFollowProjectQuery, inboxFollowUserQuery, inboxQueueQuery, inboxTodosQuery } from './inbox-requests'
import { briefing, readBrief } from './inbox-brief'
import type { Brief } from './inbox-brief'
import { authoredMrs, combine, followedProjectMrs, followedUserMrs, queueMrs, todoMrs } from './inbox-gitlab'
import type { Found } from './inbox-gitlab'
import { parseFollow } from './inbox-follow'
import { isRefTo, parseRef, parseRemote } from './inbox-refs'
import { HORIZON_MS, RULES, bounded, ownedSections, ruleNamed, sectionsOf, seenKeyOf, staleSeenKeys } from './inbox-rules'
import type { Context } from './inbox-rules'
import { NO_SNAPSHOT, carryOver, problemOf, readSnapshot } from './inbox-snapshot'
import { cardKey } from './hosts'
import { joined } from './in-flight'
import { parseMrUrl } from './mr-url'

import type { InboxFollow, InboxHost, InboxMr, InboxSnapshot, InboxState } from '../types'

// GitLab owns the data, the rules are inbox-rules.ts, and this module only asks, keeps and marks. What the pane draws is
// the rules applied to the last snapshot and the marks, so a mark shows at once and needs no read.
const inboxAtom = atom({ plugin: 'gitlab-pane', key: 'inbox' } as const, {
  snapshot: NO_SNAPSHOT,
  seen: {},
  isSyncing: false,
  readAt: null,
} satisfies InboxState)
const inboxOpenAtom = atom({ plugin: 'gitlab-pane', key: 'inboxOpen' } as const, [])
const inboxCardsAtom = atom({ plugin: 'gitlab-pane', key: 'inboxCards' } as const, [])
const inboxHereAtom = atom({ plugin: 'gitlab-pane', key: 'inboxHere' } as const, false)
const inboxFollowAtom = atom({ plugin: 'gitlab-pane', key: 'inboxFollow' } as const, [])

/** A mod loading takes the `inboxFollow` setting: the people and projects the Following rule lists. */
export async function setFollow($: EngineInterface, setting: unknown): Promise<void> {
  await update($, inboxFollowAtom, () => parseFollow(setting))
}

/**
 * What narrows and explains the sections: the "here" switch with the session's repo while it has one, and how many
 * entries are followed. Asks the session for its repo only while the switch is on.
 */
async function contextOf($: EngineInterface): Promise<Context> {
  const [isOn, follows] = await Promise.all([read($, inboxHereAtom), read($, inboxFollowAtom)])
  const remote = isOn ? ((await $.session.repo().catch(() => null))?.remote ?? '') : ''
  return { here: { isOn, repo: parseRemote(remote) }, followCount: follows.length }
}

/** Switches the Inbox between every repo and the session's own. */
export function toggleHere($: EngineInterface): void {
  quietly(
    $,
    update($, inboxHereAtom, isOn => !isOn),
    'inbox'
  )
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** A document's data; an answer without any is the errors GitLab gave in its place. */
function dataOf<Data>(answer: RawResponse<Data>): Data {
  if (answer.data === null || answer.data === undefined) {
    throw new Failure('bad-answer', answer.errors?.map(one => one.message).join('; ') ?? 'GitLab answered without data')
  }
  return answer.data
}

type HostRead = { found: Found; failure: InboxHost['failure'] }

type Tried = { label: string; found: Found } | { label: string; error: unknown }

async function tried(label: string, work: Promise<Found>): Promise<Tried> {
  try {
    return { label, found: await work }
  } catch (error) {
    return { label, error }
  }
}

/**
 * One host's documents (three, and one more per followed person or project), asked at once: a host that times one out loses only that one. What came is kept; why the
 * rest did not is the failure, with the document named unless every one failed the same way.
 */
async function readHost($: EngineInterface, host: string, now: number, follows: readonly InboxFollow[]): Promise<HostRead> {
  const since = new Date(now - HORIZON_MS).toISOString()
  const results = await Promise.all([
    tried(
      'to-dos',
      askVariant($, host, inboxTodosQuery).then(answer => todoMrs(host, dataOf(answer)))
    ),
    tried(
      'review queue',
      ask($, host, inboxQueueQuery()).then(answer => queueMrs(host, dataOf(answer), now))
    ),
    tried(
      'your MRs',
      ask($, host, inboxAuthoredQuery(since)).then(answer => authoredMrs(host, dataOf(answer), now))
    ),
    ...follows.map(follow =>
      follow.kind === 'user'
        ? tried(
            `@${follow.name}`,
            ask($, host, inboxFollowUserQuery(follow.name, since)).then(answer => followedUserMrs(host, dataOf(answer), now))
          )
        : tried(
            follow.name,
            ask($, host, inboxFollowProjectQuery(follow.name, since)).then(answer => followedProjectMrs(host, dataOf(answer), now))
          )
    ),
  ])
  const founds = results.flatMap(one => ('found' in one ? [one.found] : []))
  const failed = results.flatMap(one => ('error' in one ? [{ label: one.label, error: one.error }] : []))
  const [first] = failed
  const isSame = failed.length === results.length && new Set(failed.map(one => messageOf(one.error))).size === 1
  return {
    found: combine(founds),
    failure:
      first === undefined ? null : { kind: kindOf(first.error), message: isSame ? messageOf(first.error) : failed.map(one => `${one.label}: ${messageOf(one.error)}`).join('; ') },
  }
}

/**
 * Reads the inbox of every host from GitLab: the user's pending to-dos, review queue and own MRs, as MRs with the events
 * the rules count. It is the one read the reader's leader makes. It also drops the seen marks of MRs that are gone from a
 * host that answered whole, so the store keeps one small value per MR that is still listed. Whatever fails is in the
 * snapshot, not thrown, so a host that is down leaves the rest.
 */
async function readInbox($: EngineInterface, hosts: readonly string[]): Promise<InboxSnapshot> {
  const [now, follows] = await Promise.all([$.clock.now(), read($, inboxFollowAtom)])
  const reads = await Promise.all(hosts.map(async host => ({ host, ...(await readHost($, host, now, follows)) })))
  const listed = reads.flatMap(one => one.found.mrs)
  const snapshot: InboxSnapshot = {
    at: now,
    hosts: Object.fromEntries(reads.map(one => [one.host, { user: one.found.user, failure: one.failure }])),
    mrs: bounded(listed),
  }
  // A mark goes when GitLab stops listing its MR, not when the MR only falls past what the snapshot keeps: it may come back.
  await Promise.all(staleSeenKeys(await $.store.keys(), { ...snapshot, mrs: listed }).map(key => $.store.delete(key)))
  return snapshot
}

/** The marks of the MRs a snapshot lists, from the store, by key. */
async function marksOf($: EngineInterface, mrs: readonly InboxMr[], snapshot: InboxSnapshot): Promise<Record<string, number>> {
  const keys = mrs.flatMap(mr => seenKeyOf(snapshot, mr) ?? [])
  const marks = await Promise.all(keys.map(async key => [key, await $.store.get(key)] as const))
  return Object.fromEntries(marks.flatMap(([key, at]) => (typeof at === 'number' ? [[key, at]] : [])))
}

/**
 * Shows a snapshot: the pane draws the rules over it from now on. A host that did not answer at all keeps what it last
 * said, with the reason; every session calls this, with its own read or the leader's.
 */
async function applyInbox($: EngineInterface, snapshot: InboxSnapshot): Promise<void> {
  const readAt = await $.clock.now()
  const shown = carryOver((await read($, inboxAtom)).snapshot, snapshot)
  const seen = await marksOf($, shown.mrs, shown)
  const problem = problemOf(shown)
  const failing = Object.values(shown.hosts).find(one => one.failure !== null)?.failure
  if (problem === null || failing === null || failing === undefined) {
    await clear($, 'inbox')
  } else {
    await record($, 'inbox', new Failure(failing.kind, problem))
  }
  await update($, inboxAtom, state => (isEqual(state.snapshot, shown) && isEqual(state.seen, seen) ? { ...state, readAt } : { ...state, snapshot: shown, seen, readAt }))
}

/** Where the leader keeps the inbox for the sessions that only draw it: a key of its own, so a mark written beside it is never lost. */
const INBOX_STORE = 'inbox-snapshot'

/** The leader's inbox: reads every host once, keeps the snapshot in the store when it changed, and shows it. A call mid-read joins it. */
export function leadInbox($: EngineInterface, hosts: readonly string[]): Promise<void> {
  return joined('inbox-sync', async () => {
    await update($, inboxAtom, state => ({ ...state, isSyncing: true }))
    try {
      // A session that has shown no inbox yet shows the store's while it reads: drawing it marks and prunes nothing.
      const stored = (await read($, inboxAtom)).snapshot.at === 0 ? readSnapshot(await $.store.get(INBOX_STORE)) : null
      if (stored !== null) {
        await applyInbox($, stored)
      }
      const snapshot = await readInbox($, hosts)
      const shared = readSnapshot(await $.store.get(INBOX_STORE))
      // The store is rewritten whole for any write, so a read that found what is there already writes nothing.
      if (shared === null || !isEqual({ ...shared, at: 0 }, { ...snapshot, at: 0 })) {
        await $.store.set(INBOX_STORE, snapshot).then(() => clear($, 'store'), reported($, 'store'))
      }
      await applyInbox($, snapshot)
    } finally {
      await update($, inboxAtom, state => ({ ...state, isSyncing: false }))
    }
  })
}

/** What a session that only draws does with the inbox: shows the leader's snapshot. Gives when that was read, or none if the leader has shared none. */
export async function followInbox($: EngineInterface): Promise<number | null> {
  const snapshot = readSnapshot(await $.store.get(INBOX_STORE))
  if (snapshot === null) {
    return null
  }
  await applyInbox($, snapshot)
  return snapshot.at
}

/** When the leader's snapshot in the store was read, or none. */
export async function sharedInboxAt($: EngineInterface): Promise<number | null> {
  return readSnapshot(await $.store.get(INBOX_STORE))?.at ?? null
}

/**
 * The MRs with news, each once whichever rules list it: how many the inbox counts as it is shown (narrowed to this repo
 * while `here` is on), and the keys of all of them, every repo's, which the list parks and folds by.
 */
export async function inboxNews($: EngineInterface): Promise<{ count: number; keys: string[] }> {
  const { snapshot, seen } = await read($, inboxAtom)
  const newsIn = (sections: ReturnType<typeof sectionsOf>) => new Set(sections.flatMap(section => section.items.filter(item => item.unseen > 0).map(item => item.key)))
  return { count: newsIn(sectionsOf(snapshot, seen, await contextOf($))).size, keys: [...newsIn(sectionsOf(snapshot, seen))] }
}

export async function inboxView($: EngineInterface) {
  const [inbox, open, cards, now, context] = await Promise.all([read($, inboxAtom), read($, inboxOpenAtom), read($, inboxCardsAtom), $.clock.now(), contextOf($)])
  return { inbox, isHere: context.here.isOn, sections: sectionsOf(inbox.snapshot, inbox.seen, context), problem: problemOf(inbox.snapshot), open, cards, now }
}

/** Opens one rule, as a tab, closing the one open before; the open one closes. */
export function toggleRule($: EngineInterface, rule: string): void {
  quietly(
    $,
    update($, inboxOpenAtom, list => (list[0] === rule ? [] : [rule])),
    'inbox'
  )
}

export function toggleCard($: EngineInterface, key: string): void {
  quietly(
    $,
    update($, inboxCardsAtom, list => (list.includes(key) ? list.filter(one => one !== key) : [...list, key])),
    'inbox'
  )
}

/** Puts `/mrs --rule <rule>` in the prompt box for you to send; where a surface draws its own box, copies it. */
export async function discussRule($: EngineInterface, rule: string): Promise<void> {
  const command = `/mrs --rule ${rule}`
  const filled = await $.prompt.fill({ text: command, mode: 'insert' }).catch(() => ({ isFilled: false }))
  if (filled.isFilled) {
    return
  }
  const copied = await $.ui.copy({ text: command }).catch(() => ({ isCopied: false }))
  $.ui.toast(copied.isCopied ? `Copied ${command}: paste it in the prompt` : `Type ${command} in the prompt to discuss these`)
}

/**
 * Marks one MR, or everything a rule shows, as looked at. The mark is the time, kept in the plugin store under a key of its
 * own, on this machine: GitLab is not told, and its to-dos stay as they are.
 */
export async function markSeen($: EngineInterface, target: { key: string } | { rule: string }): Promise<void> {
  const { snapshot, seen } = await read($, inboxAtom)
  const sections = ownedSections(sectionsOf(snapshot, seen, await contextOf($)))
  const keys = new Set('key' in target ? [target.key] : (sections.find(section => section.rule === target.rule)?.items ?? []).map(item => item.key))
  const marks = snapshot.mrs.flatMap(mr => (keys.has(cardKey(mr.host, mr.path, mr.iid)) ? (seenKeyOf(snapshot, mr) ?? []) : []))
  const at = await $.clock.now()
  await Promise.all(marks.map(key => $.store.set(key, at)))
  await update($, inboxAtom, state => ({ ...state, seen: { ...state.seen, ...Object.fromEntries(marks.map(key => [key, at])) } }))
}

const USAGE = 'Usage: /mrs <repo!iid or MR URL …> or /mrs --rule <name>'
/** The most MRs one briefing carries, so it stays a briefing. */
const BRIEF_MOST = 10

type Wanted = { hosts: string[]; path: string; iid: number }

/** Where an argument of `/mrs` points: a URL on a configured host, or a reference found in the inbox, or in the session's repo, or on any host. */
async function wanted($: EngineInterface, arg: string, hosts: readonly string[], mrs: readonly InboxMr[]): Promise<Wanted | string> {
  if (/^https?:\/\//u.test(arg)) {
    const parsed = parseMrUrl(arg, hosts)
    return parsed === null ? `${arg} is not a merge request on ${hosts.join(', ')}` : { hosts: [parsed.host], path: parsed.path, iid: parsed.iid }
  }
  const ref = parseRef(arg)
  if (ref === null) {
    return `${arg} is not repo!iid or a merge request URL`
  }
  const listed = mrs.filter(mr => isRefTo(ref, mr.path, mr.iid))
  const [only] = listed
  if (only !== undefined && listed.length === 1) {
    return { hosts: [only.host], path: only.path, iid: only.iid }
  }
  if (ref.path.includes('/')) {
    return { hosts: [...hosts], path: ref.path, iid: ref.iid }
  }
  const remote = parseRemote((await $.session.repo().catch(() => null))?.remote ?? '')
  if (remote !== null && hosts.includes(remote.host) && isRefTo(ref, remote.path, ref.iid)) {
    return { hosts: [remote.host], path: remote.path, iid: ref.iid }
  }
  return listed.length > 1
    ? `${arg} names more than one MR in your inbox: use group/project!${ref.iid}`
    : `${arg} is not in your inbox or this session's repo: use group/project!${ref.iid} or the URL`
}

/** The first host that holds the MR; one that fails is a failure only if none does. */
async function briefOf($: EngineInterface, target: Wanted): Promise<Brief | null> {
  const failures: Failure[] = []
  for (const host of target.hosts) {
    try {
      const found = readBrief(dataOf(await ask($, host, inboxBriefQuery(target.path, target.iid))))
      if (found !== null) {
        return found
      }
    } catch (error) {
      failures.push(new Failure(kindOf(error), messageOf(error)))
    }
  }
  const [first] = failures
  if (first !== undefined && failures.length === target.hosts.length) {
    throw first
  }
  return null
}

/** The MRs a rule shows, as what to ask GitLab for; at most the briefing carries. */
function ruleTargets(name: string, snapshot: InboxSnapshot, seen: Readonly<Record<string, number>>, context: Context): Wanted[] {
  const items = ownedSections(sectionsOf(snapshot, seen, context)).find(section => section.rule === name)?.items ?? []
  return items
    .slice(0, BRIEF_MOST)
    .flatMap(item => snapshot.mrs.filter(mr => cardKey(mr.host, mr.path, mr.iid) === item.key))
    .map(mr => ({ hosts: [mr.host], path: mr.path, iid: mr.iid }))
}

/** `/mrs`: a Markdown briefing on several MRs, handed to the model and kept out of the transcript. */
export async function briefCommand($: EngineInterface, input: string): Promise<{ text: string; context?: string[] }> {
  const args = input.trim().split(/\s+/u).filter(Boolean)
  const { snapshot, seen } = await read($, inboxAtom)
  const context = await contextOf($)
  if (args.length === 0) {
    const rules = sectionsOf(snapshot, seen, context)
      .map(section => `${section.rule} (${section.items.length})`)
      .join(', ')
    return { text: `${USAGE}\nRules: ${rules}` }
  }
  const hosts = await readHosts($)
  const rule = args[0] === '--rule' ? ruleNamed(args.slice(1).join(' ')) : undefined
  if (args[0] === '--rule' && rule === undefined) {
    return { text: `/mrs: ${args.slice(1).join(' ')} is not a rule. Rules: ${RULES.map(one => one.name).join(', ')}` }
  }
  const asked = rule === undefined ? await Promise.all(args.slice(0, BRIEF_MOST).map(arg => wanted($, arg, hosts, snapshot.mrs))) : ruleTargets(rule.name, snapshot, seen, context)
  const stray = asked.find((one): one is string => typeof one === 'string')
  if (stray !== undefined) {
    return { text: `/mrs: ${stray}` }
  }
  const targets = asked.filter((one): one is Wanted => typeof one !== 'string')
  const briefs: Brief[] = []
  const missing: string[] = []
  try {
    for (const target of targets) {
      const brief = await briefOf($, target)
      if (brief === null) {
        missing.push(`${target.path}!${target.iid}`)
      } else {
        briefs.push(brief)
      }
    }
  } catch (error) {
    return { text: `/mrs failed: ${messageOf(error)}` }
  }
  if (briefs.length === 0) {
    return { text: rule === undefined ? `/mrs: GitLab returned none of ${missing.join(', ')}` : `/mrs: nothing in ${rule.title} right now` }
  }
  const left = rule === undefined ? args.length - BRIEF_MOST : 0
  const text = briefing(briefs)
  const notes = [...(missing.length > 0 ? [`Not found: ${missing.join(', ')}.`] : []), ...(left > 0 ? [`${left} more were left out: ${BRIEF_MOST} at most.`] : [])]
  return {
    text: [
      `Briefed ${briefs.length} MR${briefs.length === 1 ? '' : 's'} (${text.length.toLocaleString('en-GB')} characters) into this conversation. Thread refs like repo!iid#note_N name each thread.`,
      ...notes,
    ].join(' '),
    context: [text],
  }
}
