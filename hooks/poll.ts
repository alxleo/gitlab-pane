import type { EngineInterface } from 'claude-code'

import { forgetGone, readWake } from './choices'
import {
  changePoll,
  mergeTickets,
  mergeUsual,
  markUnreachable,
  pinMr,
  readAnnounced,
  readAvatarsShown,
  readBrowse,
  readPinned as readPins,
  readPoll,
  readRows,
  readTicketsKnown,
  readUnreachable,
  readUsualKnown,
  setAnnounced,
  setAvatars,
  setRows,
  unpinKeys,
} from './data'
import { clear, quietly, record } from './failures'
import { serialised } from './in-flight'
import { decodeGraphql, stringRecord } from './decode'
import { authoredQuery, lostIn, mergeStatusQuery, pinnedQuery, readMergeStatus, readPinned, readResponse, readUsual, usualQuery } from './gitlab'
import type { RawResponse, Request } from './gitlab'
import { TICKET_FIELDS, readTickets, ticketQuery } from './jira'
import { ago, ticketOf } from './format'
import { describe } from './wake'
import { parseMrUrl, pinKey } from './mr-url'
import { dotted, EMPTY, foreign, line, lines, URL_ROOM, type ModelLine } from './model-text'
import { pictureUri, sizedAvatar } from './picture'
import { openPane } from './panes'
import { reconcile } from './reconcile'
import { isSettled } from './status'
import { runJson } from './tools'

import type { MergeStatus, MrCard, Pinned, Usual } from '../types'

const TICKETS_EVERY_MS = 15 * 60_000
const USUAL_EVERY_MS = 30 * 60_000

/** GitLab.com's edge answers 52x or drops the stream now and then; one retry rides that out. */
const isTransient = (stderr: string): boolean => /HTTP 5\d\d|stream error/i.test(stderr)

async function ask<Data>($: EngineInterface, { query, variables }: Request<Data>): Promise<RawResponse<Data>> {
  const fields = Object.entries(variables).flatMap(([name, value]) => ['-f', `${name}=${value}`])
  const answer = await runJson($, 'glab', ['api', 'graphql', '-f', `query=${query}`, ...fields], raw => decodeGraphql<Data>(raw), {
    timeoutMs: 90_000,
    retryIf: isTransient,
    isPartialOk: true,
  })
  if (!answer.ok) {
    throw new Error(answer.reason)
  }
  return answer.value
}

/**
 * The authored list, then only the pinned MRs it lacks, one query each. `lost` counts
 * authored MRs GitLab timed out and sent back null, whose keys it therefore never said.
 */
async function readGitLab($: EngineInterface, pinned: readonly Pinned[]): Promise<{ rows: MrCard[]; lost: number }> {
  // The merge verdict comes from a query of its own, read alongside; if it fails, no card says it can merge.
  const [authored, verdicts] = await Promise.all([
    ask($, authoredQuery()),
    ask($, mergeStatusQuery())
      .then(readMergeStatus)
      .catch(async (error: unknown) => {
        await record($, 'gitlab', `merge status: ${error instanceof Error ? error.message : String(error)}`)
        return new Map<string, MergeStatus>()
      }),
  ])
  const rows = readResponse(authored).map(row => ({ ...row, mergeStatus: verdicts.get(row.key) ?? null }))
  const missing = pinned.filter(pin => !rows.some(row => row.key === pinKey(pin)))
  for (const pin of missing) {
    rows.push(...readPinned(await ask($, pinnedQuery(pin))))
  }
  return { rows, lost: lostIn(authored) }
}

/**
 * Jira's view of the tickets the titles name, every 15 minutes or when a new one appears, while a Jira site is set; a
 * failure (no `acli` installed or signed in, say) keeps the last.
 */
async function readJira($: EngineInterface, rows: readonly MrCard[], now: number): Promise<void> {
  if ((await readBrowse($)) === '') {
    return
  }
  const keys = [...new Set(rows.map(row => ticketOf(row.title)).filter(key => key !== null))]
  const [known, poll] = await Promise.all([readTicketsKnown($), readPoll($)])
  const isDue = poll.ticketsAt === null || now - poll.ticketsAt >= TICKETS_EVERY_MS
  if (keys.length === 0 || (!isDue && keys.every(key => key in known))) {
    return
  }
  const search = ['jira', 'workitem', 'search', '--json', '--fields', TICKET_FIELDS, '--limit', String(keys.length), '--jql', ticketQuery(keys)]
  const found = await runJson($, 'acli', search, readTickets, { timeoutMs: 60_000 })
  if (!found.ok) {
    await record($, 'jira', found.reason)
    return
  }
  await clear($, 'jira')
  await mergeTickets($, found.value, now)
}

/** How long each repo's MR pipelines usually run, every 30 minutes or when a new repo appears; a failure keeps the last. */
async function readUsualTimes($: EngineInterface, rows: readonly MrCard[], now: number): Promise<void> {
  const projects = [...new Set(rows.map(row => row.project))]
  const [known, poll] = await Promise.all([readUsualKnown($), readPoll($)])
  const isDue = poll.usualAt === null || now - poll.usualAt >= USUAL_EVERY_MS
  if (projects.length === 0 || (!isDue && projects.every(path => path in known))) {
    return
  }
  const usual: Record<string, Usual> = {}
  for (const path of projects) {
    const times = readUsual(await ask($, usualQuery(path)))
    if (times !== null) {
      usual[path] = times
    }
  }
  await clear($, 'usual')
  await mergeUsual($, usual, now)
}

/** 20 pixels drawn at 14 stays fairly sharp on a Retina screen and costs about 1,000 characters of the drawing. */
const AVATAR_PX = 20
/** Base64 past this is no thumbnail: GitLab sent the full picture. */
const AVATAR_MOST = 6_000
const AVATAR_STORE = 'avatars'

/** Each person's avatar, fetched once and kept across sessions by the URL GitLab gave, so a new picture is a new URL. */
async function readAvatars($: EngineInterface, rows: readonly MrCard[]): Promise<void> {
  const urls = [...new Set(rows.flatMap(row => row.people.map(person => person.avatarUrl)))].filter(
    url => url !== null
  )
  const shown = await readAvatarsShown($)
  const known: Record<string, string> = Object.keys(shown).length > 0 ? shown : stringRecord(await $.store.get(AVATAR_STORE))
  // A picture that failed is not asked for again until the mod reloads.
  const unreachable = await readUnreachable($)
  const wanted = urls.filter(url => !(url in known) && !unreachable.includes(url))
  const fetched = await Promise.all(
    wanted.map(async url => {
      const run = await $.process.run(
        // The URL comes from GitLab's answer, so curl is held to https, redirects included.
        ['/bin/sh', '-c', 'curl -sfL --proto =https --proto-redir =https --max-time 10 --url "$1" | base64', 'avatar', sizedAvatar(url, AVATAR_PX)],
        { timeoutMs: 15_000 }
      )
      return [url, run.exitCode === 0 ? pictureUri(run.stdout, AVATAR_MOST) : null] as const
    })
  )
  const failed = fetched.filter(pair => pair[1] === null)
  await markUnreachable($, failed.map(pair => pair[0]))
  if (failed.length > 0) {
    await record($, 'avatars', `${failed.length} picture${failed.length === 1 ? '' : 's'} could not be fetched`)
  } else {
    await clear($, 'avatars')
  }
  const fresh = Object.fromEntries(fetched.flatMap(([url, picture]) => (picture !== null ? [[url, picture] as const] : [])))
  // Only the people on the pane are kept, so the store never outgrows them.
  const kept: Record<string, string> = Object.fromEntries(
    urls.flatMap(url => {
      const uri = fresh[url] ?? known[url]
      return uri !== undefined && uri !== '' ? [[url, uri]] : []
    })
  )
  await setAvatars($, kept)
  if (Object.keys(fresh).length > 0 || Object.keys(known).some(url => !(url in kept))) {
    await $.store.set(AVATAR_STORE, kept)
  }
}

/** Reads one after another; a caller arriving mid-read gets the next read, which sees its pin. */
export function refresh($: EngineInterface): Promise<void> {
  return serialised('refresh', () => readOnce($))
}

/** The only way text reaches the model unasked: lines built by model-text.ts, so a foreign value cannot arrive raw. */
function wake($: EngineInterface, news: readonly ModelLine[]) {
  return $.prompt.submit({ text: lines(news) })
}

/** One GitLab read for every row; wakes the session for a pinned MR's new result. */
async function readOnce($: EngineInterface): Promise<void> {
  const pinned = await readPins($)
  const attemptedAt = await $.clock.now()
  await clear($, 'gitlab')
  let rows: MrCard[]
  let kept: MrCard[]
  try {
    const answer = await readGitLab($, pinned)
    // A read GitLab partly timed out keeps the cards it left out as last seen, so none vanishes or closes for a poll.
    kept = answer.lost > 0 ? (await readRows($)).filter(row => !answer.rows.some(each => each.key === row.key)) : []
    rows = [...answer.rows, ...kept]
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await record($, 'gitlab', message)
    await changePoll($, poll => ({ ...poll, attemptedAt, error: message, failures: poll.failures + 1 }))
    return
  }
  const now = await $.clock.now()
  const reconciled = reconcile({ pinned, rows, announced: await readAnnounced($), now })
  reconciled.toasts.forEach(text => $.ui.toast(text))
  const open = reconciled.rows
  const isShown = (key: string) => open.some(row => row.key === key)
  await setRows($, open)
  // An MR read whole that has merged leaves its page, so the title and the list come back with it.
  if (await forgetGone($, isShown)) {
    quietly($, openPane($))
  }
  await setAnnounced($, reconciled.announced)
  if (reconciled.unpinned.length > 0) {
    await unpinKeys($, reconciled.unpinned)
  }
  await changePoll($, poll => ({ ...poll, fetchedAt: now, attemptedAt, error: null, failures: 0, kept: kept.length }))
  if (reconciled.wakes.length > 0 && (await readWake($))) {
    quietly($, wake($, reconciled.wakes))
  }
  quietly($, readJira($, open, now), 'jira')
  quietly($, readUsualTimes($, open, now), 'usual')
  quietly($, readAvatars($, open), 'avatars')
}

/** Every minute while a pinned pipeline runs, every three otherwise; backs off to ten after errors. */
export async function tick($: EngineInterface): Promise<void> {
  const [poll, rows, pinned, now] = await Promise.all([readPoll($), readRows($), readPins($), $.clock.now()])
  const pinnedKeys = new Set(pinned.map(pinKey))
  const isMoving = rows.some(row => pinnedKeys.has(row.key) && row.pipeline !== undefined && !isSettled(row.pipeline.status))
  const every = poll.failures > 0 ? Math.min(600_000, 60_000 * 2 ** poll.failures) : isMoving ? 60_000 : 180_000
  if (poll.attemptedAt === null || now - poll.attemptedAt >= every) {
    await refresh($)
  }
}

/** Pins an MR to this session and answers what it looks like now, saying so when that is stale. */
export async function pin($: EngineInterface, url: string, origin: 'raised' | 'watched'): Promise<ModelLine> {
  const parsed = parseMrUrl(url)
  if (parsed === null) {
    throw new Error(`Not a gitlab.com merge request URL: ${url}`)
  }
  await pinMr($, parsed, origin)
  await refresh($)
  const [rows, poll, now] = await Promise.all([readRows($), readPoll($), $.clock.now()])
  const row = rows.find(one => one.key === pinKey(parsed))
  const age = poll.fetchedAt !== null ? line`; this is ${ago(new Date(poll.fetchedAt).toISOString(), now)} old` : EMPTY
  const stale = poll.error !== null ? line`GitLab could not be read (${foreign(poll.error, URL_ROOM)})${age}` : EMPTY
  if (row !== undefined) {
    return dotted([describe(row, now), stale])
  }
  return line`Pinned !${parsed.iid}; ${stale.length > 0 ? stale : line`GitLab did not return it.`}`
}
