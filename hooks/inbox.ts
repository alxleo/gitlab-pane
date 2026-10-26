import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { InboxActivity, InboxItem, InboxSection, InboxState } from '../types'

// mr-inbox owns the GitLab reads, the cache and the rules (~/work/mr-inbox); this module only asks it.
const inboxAtom = atom({ plugin: 'gitlab-ci', key: 'inbox' } as const, {
  sections: [],
  syncedAt: null,
  syncError: null,
  isSyncing: false,
  readAt: null,
  error: null,
} satisfies InboxState)
const inboxOpenAtom = atom({ plugin: 'gitlab-ci', key: 'inboxOpen' } as const, [])
const inboxCardsAtom = atom({ plugin: 'gitlab-ci', key: 'inboxCards' } as const, [])

// A login shell finds mr-inbox in ~/.local/bin; the app's own PATH may not.
const mrInbox = (args: readonly string[]) => ['/bin/zsh', '-lc', 'exec mr-inbox "$@"', 'mr-inbox', ...args]

/** Many sessions share one sync: mr-inbox skips it when another finished within this many seconds. */
const SYNC_IF_OLDER_THAN = '60'
const ACTIVITY_KEPT = 3

type Ran = { exitCode: number; stdout: string; stderr: string }

async function run($: EngineInterface, args: readonly string[], timeoutMs: number): Promise<Ran> {
  try {
    return await $.process.run(mrInbox(args), { timeoutMs })
  } catch (error) {
    return { exitCode: -1, stdout: '', stderr: error instanceof Error ? error.message : String(error) }
  }
}

const reason = (ran: Ran): string =>
  ran.exitCode === 127
    ? 'mr-inbox is not installed (see ~/work/mr-inbox)'
    : ran.stderr.trim().split('\n').pop()?.replace(/^mr-inbox: /, '') || `mr-inbox exited ${ran.exitCode}`

async function repoArgs($: EngineInterface): Promise<string[]> {
  try {
    const remote = (await $.session.repo())?.remote
    return remote ? ['--repo', remote] : []
  } catch {
    return []
  }
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** The inbox as the pane keeps it, from `mr-inbox inbox --json`; throws on anything else. */
export function readInboxJson(stdout: string): Pick<InboxState, 'sections' | 'syncedAt' | 'syncError'> {
  const raw = JSON.parse(stdout) as { sync?: Record<string, unknown>; sections?: unknown }
  if (!Array.isArray(raw.sections)) {
    throw new Error('mr-inbox answered without sections')
  }
  const sections: InboxSection[] = raw.sections.map((section: Record<string, unknown>) => ({
    rule: text(section.rule),
    title: text(section.title),
    note: text(section.note) || null,
    items: ((section.items as Record<string, unknown>[] | undefined) ?? []).map(
      (item): InboxItem => ({
        key: text(item.key),
        ref: text(item.ref),
        title: text(item.title),
        url: text(item.url),
        author: text((item.author as { username?: unknown } | undefined)?.username),
        isMine: (item.author as { is_me?: unknown } | undefined)?.is_me === true,
        state: text(item.state),
        isDraft: item.draft === true,
        unseen: typeof item.unseen === 'number' ? item.unseen : 0,
        counts: Object.fromEntries(
          Object.entries((item.counts as Record<string, unknown> | undefined) ?? {}).filter(
            (entry): entry is [string, number] => typeof entry[1] === 'number'
          )
        ),
        activity: ((item.activity as Record<string, unknown>[] | undefined) ?? []).slice(0, ACTIVITY_KEPT).map(
          (one): InboxActivity => ({
            kind: text(one.kind),
            actor: text(one.actor),
            at: text(one.at),
            url: text(one.url) || null,
            excerpt: text(one.excerpt),
          })
        ),
      })
    ),
  }))
  const sync = raw.sync ?? {}
  return {
    sections,
    syncedAt: text(sync.finished_at) || null,
    syncError: sync.ok === false ? text(sync.error) || 'the last sync failed' : null,
  }
}

/** Reads the rules over mr-inbox's cache; never calls GitLab, so it is quick. A failure keeps the last sections. */
export async function readInbox($: EngineInterface): Promise<void> {
  const ran = await run($, ['inbox', '--json', ...(await repoArgs($))], 30_000)
  const readAt = await $.clock.now()
  if (ran.exitCode !== 0) {
    await update($, inboxAtom, state => ({ ...state, readAt, error: reason(ran) }))
    return
  }
  try {
    const inbox = readInboxJson(ran.stdout)
    await update($, inboxAtom, state => ({ ...state, ...inbox, readAt, error: null }))
  } catch (error) {
    await update($, inboxAtom, state => ({ ...state, readAt, error: error instanceof Error ? error.message : String(error) }))
  }
}

let syncing: Promise<void> | null = null

/** Brings mr-inbox's cache up to date, then reads the inbox; a call mid-sync joins it. */
export function syncInbox($: EngineInterface): Promise<void> {
  syncing ??= (async () => {
    await update($, inboxAtom, state => ({ ...state, isSyncing: true }))
    const ran = await run($, ['sync', '--if-older-than', SYNC_IF_OLDER_THAN, '--json', ...(await repoArgs($))], 600_000)
    await update($, inboxAtom, state => ({ ...state, isSyncing: false, ...(ran.exitCode === 0 ? {} : { error: reason(ran) }) }))
    await readInbox($)
  })().finally(() => {
    syncing = null
  })
  return syncing
}

/** On the mod's timer: keeps the inbox fresh wherever a surface can draw the pane. */
export async function inboxTick($: EngineInterface): Promise<void> {
  if ((await $.session.surfaces()).length > 0) {
    await syncInbox($)
  }
}

export async function inboxView($: EngineInterface) {
  const [inbox, open, cards, now] = await Promise.all([
    read($, inboxAtom),
    read($, inboxOpenAtom),
    read($, inboxCardsAtom),
    $.clock.now(),
  ])
  return { inbox, open, cards, now }
}

/** Opens one rule, as a tab, closing the one open before; the open one closes. */
export function toggleRule($: EngineInterface, rule: string): void {
  update($, inboxOpenAtom, list => (list[0] === rule ? [] : [rule])).catch(() => undefined)
}

export function toggleCard($: EngineInterface, key: string): void {
  update($, inboxCardsAtom, list => (list.includes(key) ? list.filter(one => one !== key) : [...list, key])).catch(
    () => undefined
  )
}

/** Puts `/mrs --rule <rule>` in the prompt box for Alex to send; where a surface draws its own box, copies it. */
export async function discussRule($: EngineInterface, rule: string): Promise<void> {
  const command = `/mrs --rule ${rule}`
  const filled = await $.prompt.fill({ text: command, mode: 'insert' }).catch(() => ({ isFilled: false }))
  if (filled.isFilled) {
    return
  }
  const copied = await $.ui.copy({ text: command }).catch(() => ({ isCopied: false }))
  $.ui.toast(copied.isCopied ? `Copied ${command}: paste it in the prompt` : `Type ${command} in the prompt to discuss these`)
}

/** Marks one MR, or everything a rule shows, as looked at; the inbox is read again after. */
export async function markSeen($: EngineInterface, target: { key: string } | { rule: string }): Promise<void> {
  const args = 'key' in target ? ['seen', target.key] : ['seen', '--rule', target.rule, ...(await repoArgs($))]
  const ran = await run($, args, 30_000)
  if (ran.exitCode !== 0) {
    await update($, inboxAtom, state => ({ ...state, error: reason(ran) }))
    return
  }
  await readInbox($)
}

const USAGE = 'Usage: /mrs <repo!iid or MR URL …> or /mrs --rule <name>'

/** `/mrs`: a Markdown briefing on several MRs, handed to the model and kept out of the transcript. */
export async function briefCommand($: EngineInterface, input: string): Promise<{ text: string; context?: string[] }> {
  const args = input.trim().split(/\s+/).filter(Boolean)
  if (args.length === 0) {
    const { sections } = await read($, inboxAtom)
    const rules = sections.map(section => `${section.rule} (${section.items.length})`).join(', ')
    return { text: rules ? `${USAGE}\nRules: ${rules}` : USAGE }
  }
  const ran = await run($, ['brief', ...args, ...(await repoArgs($))], 120_000)
  if (ran.exitCode !== 0) {
    return { text: `/mrs failed: ${reason(ran)}` }
  }
  const count = (ran.stdout.match(/^## /gm) ?? []).length
  return {
    text: `Briefed ${count} MR${count === 1 ? '' : 's'} (${ran.stdout.length.toLocaleString('en-GB')} characters) into this conversation. Thread refs like repo!iid#note_N name each thread.`,
    context: [ran.stdout],
  }
}
