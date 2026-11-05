import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { isFilled } from './decode'
import { readInboxJson } from './inbox-json'
import { clear, record, reported } from './failures'
import { joined } from './in-flight'
import { runJson, runText } from './tools'

import type { InboxState } from '../types'

// mr-inbox owns the GitLab reads, the cache and the rules; this module only asks it.
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

/** Many sessions share one sync: mr-inbox skips it when another finished within this many seconds. */
const SYNC_IF_OLDER_THAN = '60'

/** mr-inbox's own `mr-inbox: ` lead says nothing the pane's line does not. */
const unprefixed = (reason: string): string => reason.replace(/^mr-inbox: /, '')

async function repoArgs($: EngineInterface): Promise<string[]> {
  try {
    const remote = (await $.session.repo())?.remote
    return isFilled(remote) ? ['--repo', remote] : []
  } catch {
    return []
  }
}

/** Reads the rules over mr-inbox's cache; never calls GitLab, so it is quick. A failure keeps the last sections. */
export async function readInbox($: EngineInterface): Promise<void> {
  const result = await runJson($, 'mr-inbox', ['inbox', '--json', ...(await repoArgs($))], readInboxJson, { timeoutMs: 30_000 })
  const readAt = await $.clock.now()
  if (result.ok) {
    await clear($, 'inbox')
  } else {
    await record($, 'inbox', unprefixed(result.reason))
  }
  await update($, inboxAtom, state =>
    result.ok ? { ...state, ...result.value, readAt, error: null } : { ...state, readAt, error: unprefixed(result.reason) }
  )
}

/** Brings mr-inbox's cache up to date, then reads the inbox; a call mid-sync joins it. */
export function syncInbox($: EngineInterface): Promise<void> {
  return joined('inbox-sync', async () => {
    await update($, inboxAtom, state => ({ ...state, isSyncing: true }))
    const ran = await runText($, 'mr-inbox', ['sync', '--if-older-than', SYNC_IF_OLDER_THAN, '--json', ...(await repoArgs($))], { timeoutMs: 600_000 })
    if (!ran.ok) {
      await record($, 'inbox', unprefixed(ran.reason))
    }
    await update($, inboxAtom, state => ({ ...state, isSyncing: false, ...(ran.ok ? {} : { error: unprefixed(ran.reason) }) }))
    await readInbox($)
  })
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
  update($, inboxOpenAtom, list => (list[0] === rule ? [] : [rule])).catch(reported($, 'inbox'))
}

export function toggleCard($: EngineInterface, key: string): void {
  update($, inboxCardsAtom, list => (list.includes(key) ? list.filter(one => one !== key) : [...list, key])).catch(
    reported($, 'inbox')
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

/** Marks one MR, or everything a rule shows, as looked at; the inbox is read again after. */
export async function markSeen($: EngineInterface, target: { key: string } | { rule: string }): Promise<void> {
  const args = 'key' in target ? ['seen', target.key] : ['seen', '--rule', target.rule, ...(await repoArgs($))]
  const ran = await runText($, 'mr-inbox', args, { timeoutMs: 30_000 })
  if (!ran.ok) {
    await record($, 'inbox', unprefixed(ran.reason))
    await update($, inboxAtom, state => ({ ...state, error: unprefixed(ran.reason) }))
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
    return { text: rules !== '' ? `${USAGE}\nRules: ${rules}` : USAGE }
  }
  const ran = await runText($, 'mr-inbox', ['brief', ...args, ...(await repoArgs($))], { timeoutMs: 120_000 })
  if (!ran.ok) {
    return { text: `/mrs failed: ${unprefixed(ran.reason)}` }
  }
  const count = (ran.value.match(/^## /gm) ?? []).length
  return {
    text: `Briefed ${count} MR${count === 1 ? '' : 's'} (${ran.value.length.toLocaleString('en-GB')} characters) into this conversation. Thread refs like repo!iid#note_N name each thread.`,
    context: [ran.value],
  }
}
