import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { readHosts } from './data'
import { dataOf } from './decode'
import { isEqual } from './equal'
import { Failure, kindOf, messageOf } from './failure'
import { clear, quietly, record, reported } from './failures'
import { ask } from './graphql'
import { inboxBriefQuery } from './inbox-requests'
import { briefing, readBrief } from './inbox-brief'
import type { Brief } from './inbox-brief'
import { parseFollow } from './inbox-follow'
import { readHost } from './inbox-read'
import { isRefTo, parseRef, parseRemote } from './inbox-refs'
import { RULES, bounded, ownedSections, ruleNamed, sectionsOf, seenKeyOf, staleSeenKeys } from './inbox-rules'
import type { Context } from './inbox-rules'
import { NO_SNAPSHOT, carryOver, problemOf, readSnapshot } from './inbox-snapshot'
import { cardKey } from './hosts'
import { joined } from './in-flight'
import { keptLanded, knownLanded, withLanded } from './landed'
import type { Lately } from './landed'
import { readLanded } from './landed-read'
import { parseMrUrl } from './mr-url'

import type { InboxMr, InboxSnapshot, InboxState, Landed } from '../types'

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

/**
 * Reads the inbox of every host from GitLab: the user's pending to-dos, review queue and own MRs, as MRs with the events
 * the rules count, and the MRs they merged lately, as the inbox's own answer lists them; what landed of those is asked for
 * after (`askLanded`). It is the one read the reader's leader makes. It also drops the seen marks of MRs that are gone from a
 * host that answered whole, so the store keeps one small value per MR that is still listed. Whatever fails is in the snapshot,
 * not thrown, so a host that is down leaves the rest. The snapshot's `landed` is left for `publish`, which fills it in from the
 * one kept; `lately` is what it fills it in with.
 */
async function readInbox($: EngineInterface, hosts: readonly string[]): Promise<{ snapshot: InboxSnapshot; lately: Lately[]; now: number }> {
  const [now, follows] = await Promise.all([$.clock.now(), read($, inboxFollowAtom)])
  const reads = await Promise.all(hosts.map(async host => ({ host, ...(await readHost($, host, now, follows)) })))
  const listed = reads.flatMap(one => one.found.mrs)
  const snapshot: InboxSnapshot = {
    at: now,
    hosts: Object.fromEntries(reads.map(one => [one.host, { user: one.found.user, failure: one.failure }])),
    mrs: bounded(listed),
    landed: [],
  }
  // A mark goes when GitLab stops listing its MR, not when the MR only falls past what the snapshot keeps: it may come back.
  await Promise.all(staleSeenKeys(await $.store.keys(), { ...snapshot, mrs: listed }).map(key => $.store.delete(key)))
  return { snapshot, lately: reads.map(one => ({ host: one.host, merged: one.merged })), now }
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

/** The snapshot the atom shows, its merged MRs read entry by entry: the atom outlives a reload, so an older version may have left them in another shape. */
async function shownSnapshot($: EngineInterface): Promise<InboxSnapshot> {
  const { snapshot } = await read($, inboxAtom)
  return { ...snapshot, landed: keptLanded(snapshot.landed) }
}

/**
 * The one place the leader's snapshot is written, and shown: `change` gives the snapshot to put from the one kept (the store's,
 * or the one shown while the store has none), or null when there is nothing to put. The store is rewritten whole for any write,
 * so a snapshot that says what is there already writes nothing. The inbox's read and the later answer for what landed both go
 * through it. If they meet, the one that wrote last stands and the next read of the other sets it right, as both read what
 * they were given from the same entries.
 */
async function publish($: EngineInterface, change: (kept: InboxSnapshot) => InboxSnapshot | null): Promise<void> {
  const shared = readSnapshot(await $.store.get(INBOX_STORE))
  const snapshot = change(shared ?? (await shownSnapshot($)))
  if (snapshot === null) {
    return
  }
  if (shared === null || !isEqual({ ...shared, at: 0 }, { ...snapshot, at: 0 })) {
    await $.store.set(INBOX_STORE, snapshot).then(() => clear($, 'store'), reported($, 'store'))
  }
  await applyInbox($, snapshot)
}

/**
 * Asks GitLab for the commit and the build of the MRs the inbox just listed as merged lately, and puts what it finds in the
 * snapshot. It runs after the inbox is shown and on its own, so a slow answer holds back no to-do, no count and no wake: the list
 * is already drawn, with what was kept of each, and the answer fills it in. A failure is told as a problem of its own for
 * `/gitlab`, as the inbox is whole without it; a read that asked nothing of an MR whose commit failed earlier does not say it
 * works, so the problem stands until it is asked again.
 */
async function askLanded($: EngineInterface, lately: readonly Lately[], now: number, isAsked: boolean): Promise<void> {
  const { landed: kept } = await shownSnapshot($)
  const { landed, failure, isHeld } = await readLanded(
    $,
    lately.flatMap(one => one.merged ?? []),
    kept,
    now,
    isAsked
  )
  if (failure !== null) {
    await record($, 'merged', failure)
  } else if (!isHeld) {
    await clear($, 'merged')
  }
  // Only those entries are put in place: the snapshot may have been read again since, and what it dropped is not brought back.
  await publish($, current => {
    const next = withLanded(current.landed, landed)
    return isEqual(next, current.landed) ? null : { ...current, landed: next }
  })
}

/**
 * The leader's inbox: reads every host once, keeps the snapshot in the store when it changed, and shows it; then, apart, asks
 * for what landed of the MRs merged lately (`askLanded`). A call mid-read joins it, and one mid-ask of what landed leaves that
 * ask to finish alone, so a ↻ pressed during either asks nothing more than it did. `isAsked`: a person pressed ↻, which asks again
 * for the builds that could still change.
 */
export function leadInbox($: EngineInterface, hosts: readonly string[], isAsked: boolean): Promise<void> {
  return joined('inbox-sync', async () => {
    await update($, inboxAtom, state => ({ ...state, isSyncing: true }))
    try {
      // A session that has shown no inbox yet shows the store's while it reads: drawing it marks and prunes nothing.
      const stored = (await read($, inboxAtom)).snapshot.at === 0 ? readSnapshot(await $.store.get(INBOX_STORE)) : null
      if (stored !== null) {
        await applyInbox($, stored)
      }
      const { snapshot, lately, now } = await readInbox($, hosts)
      await publish($, kept => ({ ...snapshot, landed: knownLanded(lately, kept.landed) }))
      quietly(
        $,
        joined('landed-sync', () => askLanded($, lately, now, isAsked)),
        'merged'
      )
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
 * while `here` is on), and the keys of all of them, every repo's, which the list parks and folds by; whether this
 * session is reading the inbox now, which dims the pane's ↻; and the user's MRs merged lately, which Mine folds under
 * `▸ N merged`. One read of the inbox's atom serves all.
 */
export async function inboxNews($: EngineInterface): Promise<{ count: number; keys: string[]; isSyncing: boolean; landed: Landed[] }> {
  const { snapshot, seen, isSyncing } = await read($, inboxAtom)
  const newsIn = (sections: ReturnType<typeof sectionsOf>) => new Set(sections.flatMap(section => section.items.filter(item => item.unseen > 0).map(item => item.key)))
  // The atom outlives a reload, so a snapshot an older version kept has no merged MRs, or ones in another shape.
  return { count: newsIn(sectionsOf(snapshot, seen, await contextOf($))).size, keys: [...newsIn(sectionsOf(snapshot, seen))], isSyncing, landed: keptLanded(snapshot.landed) }
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
