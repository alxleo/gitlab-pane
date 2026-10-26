import { atom, read, update } from 'claude-code'
import type { EngineInterface, UiScrollArgs } from 'claude-code'

import { advance, ago, cardKey, describe, isSettled, parseMrUrl, pictureUri, pinKey, sizedAvatar, statusMark, ticketOf } from './ci'
import {
  PINS_PER_QUERY,
  PROJECTS_PER_QUERY,
  authoredQuery,
  lostIn,
  mergeStatusQuery,
  pinnedQuery,
  readMergeStatus,
  readResponse,
  readUsual,
  usualQuery,
} from './gitlab'
import type { RawResponse } from './gitlab'
import { isJiraOn, readTickets, ticketQuery } from './jira'

import type { MrCard, Pinned, PollState } from '../types'

// The engine lists each module's state from the atoms written in that file, so this file alone holds them.
const pinnedAtom = atom({ plugin: 'gitlab-ci', key: 'pinned' } as const, [])
const rowsAtom = atom({ plugin: 'gitlab-ci', key: 'rows' } as const, [])
const ticketsAtom = atom({ plugin: 'gitlab-ci', key: 'tickets' } as const, {})
const usualAtom = atom({ plugin: 'gitlab-ci', key: 'usual' } as const, {})
const avatarsAtom = atom({ plugin: 'gitlab-ci', key: 'avatars' } as const, {})
const expandedAtom = atom({ plugin: 'gitlab-ci', key: 'expanded' } as const, [])
const personAtom = atom({ plugin: 'gitlab-ci', key: 'person' } as const, {})
const foldsAtom = atom({ plugin: 'gitlab-ci', key: 'folds' } as const, [])
const repoFilterAtom = atom({ plugin: 'gitlab-ci', key: 'repoFilter' } as const, '')
const tabAtom = atom({ plugin: 'gitlab-ci', key: 'tab' } as const, 'mine')
const readingAtom = atom({ plugin: 'gitlab-ci', key: 'reading' } as const, '')
const announcedAtom = atom({ plugin: 'gitlab-ci', key: 'announced' } as const, {})
const wakeAtom = atom({ plugin: 'gitlab-ci', key: 'wake' } as const, true)
const pollAtom = atom({ plugin: 'gitlab-ci', key: 'poll' } as const, {
  fetchedAt: null,
  attemptedAt: null,
  error: null,
  failures: 0,
  ticketsAt: null,
  usualAt: null,
} satisfies PollState)

/** Runs work nobody awaits, so a session ending mid-call leaves no unhandled rejection. */
export const quietly = (work: Promise<unknown>): void => {
  work.catch(() => undefined)
}

/** Everything the pane draws, read at once; reading here makes the pane redraw when any of it changes. */
export async function view($: EngineInterface) {
  const [pinned, rows, tickets, usual, avatars, expanded, chosen, folds, repoFilter, tab, page, poll, isWaking, now] = await Promise.all([
    read($, pinnedAtom),
    read($, rowsAtom),
    read($, ticketsAtom),
    read($, usualAtom),
    read($, avatarsAtom),
    read($, expandedAtom),
    read($, personAtom),
    read($, foldsAtom),
    read($, repoFilterAtom),
    read($, tabAtom),
    read($, readingAtom),
    read($, pollAtom),
    read($, wakeAtom),
    $.clock.now(),
  ])
  return { pinned, rows, tickets, usual, avatars, expanded, chosen, folds, repoFilter, tab, page, poll, isWaking, now }
}

/** The pane's id; register.tsx names it again, since the engine reads a hook's matcher from that file alone. */
export const PANE_ID = 'gitlab-ci'

/** The pane's title names the view shown, since it is the one line of the pane that never scrolls away. */
async function paneTitle($: EngineInterface): Promise<string> {
  const [tab, page, rows] = await Promise.all([read($, tabAtom), read($, readingAtom), read($, rowsAtom)])
  const row = rows.find(each => each.key === page)
  return row ? `GitLab · !${row.iid}` : tab === 'inbox' ? 'GitLab · Inbox' : 'GitLab · Mine'
}

/** Opens the pane, or retitles it for the view now shown. */
export async function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE_ID, title: await paneTitle($) })
}

/** Shows the MR list (`mine`) or the inbox; only the open tab is drawn. */
export function openTab($: EngineInterface, tab: 'mine' | 'inbox') {
  quietly(update($, tabAtom, () => tab).then(() => openPane($)))
}

/** Why the pane's last scroll did not move, which /gitlab reports; a reload starts it over. */
export const scrolling = { refused: '' }

async function scrollPane($: EngineInterface, args: Omit<UiScrollArgs, 'in'>) {
  const result = await $.ui.scroll({ ...args, in: PANE_ID }).catch((error: unknown) => ({ deny: String(error) }))
  scrolling.refused = result.deny ?? ''
}

/** Opens one MR whole on a page of its own, drawn alone over the tab it was opened from. */
export function openReading($: EngineInterface, key: string) {
  quietly(
    update($, readingAtom, () => key)
      .then(() => openPane($))
      .then(() => scrollPane($, { to: 'start' }))
  )
}

/** Back from an MR's page to its tab, scrolled to the card it was read from. */
export function leaveReading($: EngineInterface) {
  quietly(
    (async () => {
      const key = await read($, readingAtom)
      await update($, readingAtom, () => '')
      await update($, foldsAtom, list => list.filter(id => !id.startsWith(`${key}#`)))
      await openPane($)
      await scrollToCard($, key)
    })()
  )
}

/**
 * The desktop tells the engine where keyed elements sit only when it next asks for a drawing, so a card just drawn
 * again is not yet there to scroll to. Each miss asks for that drawing and tries again.
 */
async function scrollToCard($: EngineInterface, rowKey: string) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    await $.clock.sleep(150 * attempt)
    await scrollPane($, { to: { key: cardKey(rowKey) }, block: 'start' })
    if (!scrolling.refused.startsWith('no element')) {
      return
    }
    $.ui.invalidate('ui.render')
  }
}

/** Opens or closes a row (or `drafts`) on what blocks it, never on one person's comments. */
export function toggle($: EngineInterface, key: string) {
  quietly(
    Promise.all([
      update($, expandedAtom, list => (list.includes(key) ? list.filter(one => one !== key) : [...list, key])),
      update($, personAtom, ({ [key]: _, ...rest }) => rest),
    ])
  )
}

/** Opens or closes one `<details>` fold, named `<row key>#<where>`, against how GitLab first shows it. */
export function toggleFold($: EngineInterface, id: string) {
  quietly(update($, foldsAtom, list => (list.includes(id) ? list.filter(one => one !== id) : [...list, id])))
}

/** Opens a row on one person's comments alone; asked again for the same person, closes it. */
export async function showPerson($: EngineInterface, key: string, username: string) {
  const [expanded, people] = await Promise.all([read($, expandedAtom), read($, personAtom)])
  if (expanded.includes(key) && people[key] === username) {
    await update($, expandedAtom, list => list.filter(one => one !== key))
    await update($, personAtom, ({ [key]: _, ...rest }) => rest)
    return
  }
  await update($, personAtom, previous => ({ ...previous, [key]: username }))
  await update($, expandedAtom, list => (list.includes(key) ? list : [...list, key]))
}

/** Narrows the list to one repo; the same repo again, or none, shows them all. */
export function filterRepo($: EngineInterface, project: string) {
  quietly(update($, repoFilterAtom, current => (current === project ? '' : project)))
}

export function toggleWake($: EngineInterface) {
  quietly(update($, wakeAtom, value => !value))
}

const TICKETS_EVERY_MS = 15 * 60_000
const USUAL_EVERY_MS = 30 * 60_000

// A login shell finds glab and glean wherever they are installed; the app's own PATH may not.
const shell = (tool: string, args: readonly string[]) => ['/bin/zsh', '-lc', `exec ${tool} "$@"`, tool, ...args]

/** GitLab.com's edge answers 52x or drops the stream now and then; one retry rides that out. */
const isTransient = (stderr: string): boolean => /HTTP 5\d\d|stream error/i.test(stderr)

async function ask($: EngineInterface, query: string): Promise<RawResponse> {
  const call = () => $.process.run(shell('glab', ['api', 'graphql', '-f', `query=${query}`]), { timeoutMs: 90_000 })
  const first = await call()
  const run = first.exitCode !== 0 && isTransient(first.stderr) ? await call() : first
  // glab exits non-zero on a partial GraphQL error yet still prints the data.
  try {
    return JSON.parse(run.stdout) as RawResponse
  } catch {
    throw new Error(run.stderr.trim().split('\n').pop() || `glab exited ${run.exitCode}`)
  }
}

/**
 * The authored list, then only the pinned MRs it lacks, a few per query to stay under GitLab's cost limit. `lost` counts
 * authored MRs GitLab timed out and sent back null, whose keys it therefore never said.
 */
async function readGitLab($: EngineInterface, pinned: readonly Pinned[]): Promise<{ rows: MrCard[]; lost: number }> {
  // The merge verdict comes from a query of its own, read alongside; if it fails, no card says it can merge.
  const [authored, verdicts] = await Promise.all([
    ask($, authoredQuery()),
    ask($, mergeStatusQuery())
      .then(readMergeStatus)
      .catch(() => new Map<string, string>()),
  ])
  const rows = readResponse(authored, 0).map(row => ({ ...row, mergeStatus: verdicts.get(row.key) ?? null }))
  const missing = pinned.filter(pin => !rows.some(row => row.key === pinKey(pin)))
  for (let i = 0; i < missing.length; i += PINS_PER_QUERY) {
    const chunk = missing.slice(i, i + PINS_PER_QUERY)
    rows.push(...readResponse(await ask($, pinnedQuery(chunk)), chunk.length))
  }
  return { rows, lost: lostIn(authored) }
}

/**
 * Jira's view of the tickets the titles name, every 15 minutes or when a new one appears, while a Jira site is set; a
 * failure (no `glean` installed, say) keeps the last.
 */
async function readJira($: EngineInterface, rows: readonly MrCard[], now: number): Promise<void> {
  if (!isJiraOn()) {
    return
  }
  const keys = [...new Set(rows.map(row => ticketOf(row.title)).filter((key): key is string => key !== null))]
  const [known, poll] = await Promise.all([read($, ticketsAtom), read($, pollAtom)])
  const isDue = !poll.ticketsAt || now - poll.ticketsAt >= TICKETS_EVERY_MS
  if (keys.length === 0 || (!isDue && keys.every(key => key in known))) {
    return
  }
  const run = await $.process.run(shell('glean', ['jira', 'audit', '--json', ticketQuery(keys)]), { timeoutMs: 60_000 })
  if (run.exitCode !== 0) {
    return
  }
  const tickets = readTickets(run.stdout)
  await update($, ticketsAtom, previous => ({ ...previous, ...tickets }))
  await update($, pollAtom, previous => ({ ...previous, ticketsAt: now }))
}

/** How long each repo's MR pipelines usually run, every 30 minutes or when a new repo appears; a failure keeps the last. */
async function readUsualTimes($: EngineInterface, rows: readonly MrCard[], now: number): Promise<void> {
  const projects = [...new Set(rows.map(row => row.project))]
  const [known, poll] = await Promise.all([read($, usualAtom), read($, pollAtom)])
  const isDue = !poll.usualAt || now - poll.usualAt >= USUAL_EVERY_MS
  if (projects.length === 0 || (!isDue && projects.every(path => path in known))) {
    return
  }
  const usual = {}
  for (let i = 0; i < projects.length; i += PROJECTS_PER_QUERY) {
    const chunk = projects.slice(i, i + PROJECTS_PER_QUERY)
    Object.assign(usual, readUsual(await ask($, usualQuery(chunk)), chunk))
  }
  await update($, usualAtom, previous => ({ ...previous, ...usual }))
  await update($, pollAtom, previous => ({ ...previous, usualAt: now }))
}

/** 20 pixels drawn at 14 stays fairly sharp on a Retina screen and costs about 1,000 characters of the drawing. */
const AVATAR_PX = 20
/** Base64 past this is no thumbnail: GitLab sent the full picture. */
const AVATAR_MOST = 6_000
const AVATAR_STORE = 'avatars'

// A picture that failed is not asked for again until the mod reloads.
const unreachable = new Set<string>()

/** Each person's avatar, fetched once and kept across sessions by the URL GitLab gave, so a new picture is a new URL. */
async function readAvatars($: EngineInterface, rows: readonly MrCard[]): Promise<void> {
  const urls = [...new Set(rows.flatMap(row => row.people.map(person => person.avatarUrl)))].filter(
    (url): url is string => url !== null
  )
  const shown = await read($, avatarsAtom)
  const known: Record<string, string> =
    Object.keys(shown).length > 0 ? shown : (((await $.store.get(AVATAR_STORE)) ?? {}) as Record<string, string>)
  const wanted = urls.filter(url => !(url in known) && !unreachable.has(url))
  const fetched = await Promise.all(
    wanted.map(async url => {
      const run = await $.process.run(
        ['/bin/sh', '-c', 'curl -sfL --max-time 10 "$1" | base64', 'avatar', sizedAvatar(url, AVATAR_PX)],
        { timeoutMs: 15_000 }
      )
      const uri = run.exitCode === 0 ? pictureUri(run.stdout, AVATAR_MOST) : null
      if (!uri) {
        unreachable.add(url)
      }
      return [url, uri] as const
    })
  )
  const fresh = Object.fromEntries(fetched.filter((pair): pair is readonly [string, string] => pair[1] !== null))
  // Only the people on the pane are kept, so the store never outgrows them.
  const kept: Record<string, string> = Object.fromEntries(
    urls.flatMap(url => {
      const uri = fresh[url] ?? known[url]
      return uri ? [[url, uri]] : []
    })
  )
  await update($, avatarsAtom, () => kept)
  if (Object.keys(fresh).length > 0 || Object.keys(known).some(url => !(url in kept))) {
    await $.store.set(AVATAR_STORE, kept)
  }
}

let running: Promise<void> | null = null
let queued: Promise<void> | null = null

/** Reads one after another; a caller arriving mid-read gets the next read, which sees its pin. */
export function refresh($: EngineInterface): Promise<void> {
  if (!running) {
    running = readOnce($).finally(() => {
      running = null
    })
    return running
  }
  queued ??= running.then(() => {
    queued = null
    return refresh($)
  })
  return queued
}

/** One GitLab read for every row; wakes the session for a pinned MR's new result. */
async function readOnce($: EngineInterface): Promise<void> {
  const pinned = await read($, pinnedAtom)
  const attemptedAt = await $.clock.now()
  let rows: MrCard[]
  let kept: MrCard[]
  try {
    const answer = await readGitLab($, pinned)
    // A read GitLab partly timed out keeps the cards it left out as last seen, so none vanishes or closes for a poll.
    kept = answer.lost > 0 ? (await read($, rowsAtom)).filter(row => !answer.rows.some(each => each.key === row.key)) : []
    rows = [...answer.rows, ...kept]
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await update($, pollAtom, poll => ({ ...poll, attemptedAt, error: message, failures: poll.failures + 1 }))
    return
  }
  const now = await $.clock.now()
  const announced = { ...(await read($, announcedAtom)) }
  const wakes: string[] = []
  const ended = new Set<string>()
  pinned.forEach(one => {
    const row = rows.find(each => each.key === pinKey(one))
    if (!row) {
      return
    }
    if (!row.isOpen) {
      ended.add(row.key)
      $.ui.toast(`!${row.iid} is closed or merged; unpinned.`)
      return
    }
    if (!row.pipeline) {
      return
    }
    const prior = announced[row.key]
    const next = advance(prior ?? [], row.pipeline)
    announced[row.key] = next.announced
    // The first sighting only seeds: what it shows was told when it was pinned.
    if (next.due && prior !== undefined) {
      wakes.push(`GitLab CI: ${describe(row, now)}`)
    }
  })
  const open = rows.filter(row => row.isOpen)
  const isShown = (key: string) => open.some(row => row.key === key)
  await update($, rowsAtom, () => open)
  // A row merged or closed since it was opened stays out of what is drawn and saved.
  await update($, expandedAtom, list => list.filter(key => key === 'drafts' || key === 'more' || isShown(key)))
  await update($, personAtom, people => Object.fromEntries(Object.entries(people).filter(([key]) => isShown(key))))
  await update($, foldsAtom, list => list.filter(id => isShown(id.split('#')[0] ?? '')))
  // An MR read whole that has merged leaves its page, so the title and the list come back with it.
  const page = await read($, readingAtom)
  if (page && !isShown(page)) {
    await update($, readingAtom, () => '')
    quietly(openPane($))
  }
  await update($, announcedAtom, () => announced)
  if (ended.size > 0) {
    await update($, pinnedAtom, list => list.filter(each => !ended.has(pinKey(each))))
  }
  await update($, pollAtom, poll => ({ ...poll, fetchedAt: now, attemptedAt, error: null, failures: 0, kept: kept.length }))
  const pinnedKeys = new Set(pinned.map(pinKey))
  $.ui.status(
    open
      .filter(row => pinnedKeys.has(row.key))
      .map(row => `${statusMark(row.pipeline?.status).glyph} !${row.iid}`)
      .join('  ') || undefined
  )
  if (wakes.length > 0) {
    wakes.forEach(text => $.ui.toast(text))
    if (await read($, wakeAtom)) {
      quietly($.prompt.submit({ text: wakes.join('\n') }))
    }
  }
  quietly(readJira($, open, now))
  quietly(readUsualTimes($, open, now))
  quietly(readAvatars($, open))
}

/** Every minute while a pinned pipeline runs, every three otherwise; backs off to ten after errors. */
export async function tick($: EngineInterface): Promise<void> {
  const [poll, rows, pinned, now] = await Promise.all([
    read($, pollAtom),
    read($, rowsAtom),
    read($, pinnedAtom),
    $.clock.now(),
  ])
  const pinnedKeys = new Set(pinned.map(pinKey))
  const isMoving = rows.some(row => pinnedKeys.has(row.key) && row.pipeline && !isSettled(row.pipeline.status))
  const every = poll.failures > 0 ? Math.min(600_000, 60_000 * 2 ** poll.failures) : isMoving ? 60_000 : 180_000
  if (poll.attemptedAt === null || now - poll.attemptedAt >= every) {
    await refresh($)
  }
}

/** Pins an MR to this session and answers what it looks like now, saying so when that is stale. */
export async function pin($: EngineInterface, url: string): Promise<string> {
  const parsed = parseMrUrl(url)
  if (!parsed) {
    throw new Error(`Not a gitlab.com merge request URL: ${url}`)
  }
  await update($, pinnedAtom, list => [...list.filter(one => pinKey(one) !== pinKey(parsed)), parsed])
  await refresh($)
  const [rows, poll, now] = await Promise.all([read($, rowsAtom), read($, pollAtom), $.clock.now()])
  const row = rows.find(one => one.key === pinKey(parsed))
  const stale =
    poll.error !== null
      ? `GitLab could not be read (${poll.error})${poll.fetchedAt ? `; this is ${ago(new Date(poll.fetchedAt).toISOString(), now)} old` : ''}`
      : ''
  if (row) {
    return stale ? `${describe(row, now)} · ${stale}` : describe(row, now)
  }
  return `Pinned !${parsed.iid}; ${stale || 'GitLab did not return it.'}`
}
