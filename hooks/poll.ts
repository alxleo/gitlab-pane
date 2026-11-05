import type { EngineInterface } from 'claude-code'

import { forgetGone, readWake } from './choices'
import {
  changePoll,
  mergeTickets,
  mergeUsual,
  markUnreachable,
  pinMr,
  markUsualRead,
  readAnnounced,
  readAvatarsShown,
  readBrowse,
  readFeaturesKnown,
  readHosts,
  readPinned as readPins,
  readPoll,
  readRows,
  readTicketsKnown,
  readUnreachable,
  readUsualKnown,
  setAnnounced,
  setAvatars,
  setFeatures,
  setRows,
  unpinKeys,
} from './data'
import { Failure, kindOf } from './failure'
import { clear, quietly, record } from './failures'
import { joined, serialised } from './in-flight'
import { stringRecord } from './decode'
import { lostIn, readFeatures, readMergeStatus, readPinned, readResponse, readUsual } from './gitlab'
import { authoredQuery, mergeStatusQuery, pinnedQuery, probeQuery, usualQuery } from './gitlab-documents'
import { ask } from './graphql'
import { projectOf } from './hosts'
import { TICKET_FIELDS, readTickets, ticketQuery } from './jira'
import { ago, ticketOf } from './format'
import { describe } from './wake'
import { parseMrUrl, pinKey } from './mr-url'
import { dotted, EMPTY, foreign, line, lines, URL_ROOM, type ModelLine } from './model-text'
import { pictureUri, sizedAvatar } from './picture'
import { openPane } from './panes'
import { reconcile } from './reconcile'
import { isSettled, statusMark } from './status'
import { failureOf, runJson } from './tools'

import type { HostFeatures, MergeStatus, MrCard, Pinned, Usual } from '../types'

const TICKETS_EVERY_MS = 15 * 60_000
const USUAL_EVERY_MS = 30 * 60_000

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** An error as a failure that keeps its kind. */
const asFailure = (error: unknown, label = (message: string) => message): Failure => new Failure(kindOf(error), label(messageOf(error)))

/** Several failures as one, in the kind of the first, with their words joined. */
const together = (list: readonly Failure[]): Failure => new Failure(list[0]?.kind ?? 'unknown', list.map(one => one.message).join('; '))

/** What a host's schema has of the fields older GitLab versions lack: asked the first time the host is read, then kept. */
async function featuresOf($: EngineInterface, host: string): Promise<HostFeatures> {
  const known = (await readFeaturesKnown($))[host]
  if (known !== undefined) {
    return known
  }
  const probed = readFeatures(await ask($, host, probeQuery()))
  await setFeatures($, host, probed)
  return probed
}

type HostRead = { rows: MrCard[]; lost: number; notes: Failure[] }

/**
 * One host's authored list, then only the pinned MRs on it that the list lacks, one query each. `lost` counts authored
 * MRs GitLab timed out and sent back null, whose keys it therefore never said. `notes` are what went wrong without
 * failing the read.
 */
async function readHost($: EngineInterface, host: string, pinned: readonly Pinned[]): Promise<HostRead> {
  const features = await featuresOf($, host)
  const notes: Failure[] = []
  // The merge verdict comes from a query of its own, read alongside; a host without it, or a failed read of it, leaves
  // every card without a verdict, and none says it can merge.
  const [authored, verdicts] = await Promise.all([
    ask($, host, authoredQuery(features)),
    features.hasMergeVerdict
      ? ask($, host, mergeStatusQuery())
          .then(answer => readMergeStatus(host, answer))
          .catch((error: unknown) => {
            notes.push(asFailure(error, message => `merge status: ${message}`))
            return new Map<string, MergeStatus>()
          })
      : Promise.resolve(new Map<string, MergeStatus>()),
  ])
  const rows = readResponse(host, authored).map(row => ({ ...row, mergeStatus: verdicts.get(row.key) ?? null }))
  const missing = pinned.filter(pin => !rows.some(row => row.key === pinKey(pin)))
  for (const pin of missing) {
    rows.push(...readPinned(host, await ask($, host, pinnedQuery(pin, features))))
  }
  return { rows, lost: lostIn(authored), notes }
}

type Read = { host: string; answer: HostRead } | { host: string; failure: Failure }

/** Every configured host read at once; one that fails is told apart from the rest, which still count. */
async function readGitLab($: EngineInterface, hosts: readonly string[], pinned: readonly Pinned[]): Promise<Read[]> {
  return Promise.all(
    hosts.map(host =>
      readHost(
        $,
        host,
        pinned.filter(pin => pin.host === host)
      ).then(
        (answer): Read => ({ host, answer }),
        (error: unknown): Read => ({ host, failure: asFailure(error) })
      )
    )
  )
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
    await record($, 'jira', failureOf(found))
    return
  }
  await clear($, 'jira')
  await mergeTickets($, found.value, now)
}

/**
 * How long each repo's MR pipelines usually run, every 30 minutes or when a new repo appears; one pass at a time, however
 * long it takes, each project saved as it is read, so one that fails keeps the last of its own and loses no other's.
 */
function readUsualTimes($: EngineInterface, rows: readonly MrCard[], now: number): Promise<void> {
  return joined('usual', async () => {
    const projects = [...new Map(rows.map(row => [row.project, row])).values()]
    const [known, poll] = await Promise.all([readUsualKnown($), readPoll($)])
    const isDue = poll.usualAt === null || now - poll.usualAt >= USUAL_EVERY_MS
    if (projects.length === 0 || (!isDue && projects.every(row => row.project in known))) {
      return
    }
    const failures: Failure[] = []
    for (const row of projects) {
      try {
        const times = readUsual(await ask($, row.host, usualQuery(row.path)))
        if (times !== null) {
          await mergeUsual($, { [row.project]: times })
        }
      } catch (error) {
        failures.push(asFailure(error, message => `${row.project}: ${message}`))
      }
    }
    await markUsualRead($, now)
    if (failures.length > 0) {
      await record($, 'usual', together(failures))
    } else {
      await clear($, 'usual')
    }
  })
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
    await record($, 'avatars', new Failure('network', `${failed.length} picture${failed.length === 1 ? '' : 's'} could not be fetched`))
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

/** One GitLab read of every configured host, for every row; wakes the session for a pinned MR's new result. */
async function readOnce($: EngineInterface): Promise<void> {
  const [pinned, hosts] = await Promise.all([readPins($), readHosts($)])
  const attemptedAt = await $.clock.now()
  await clear($, 'gitlab')
  const reads = await readGitLab($, hosts, pinned)
  // With several hosts, each failure says whose it is.
  const labelled = (host: string, one: Failure) => new Failure(one.kind, hosts.length > 1 ? `${host}: ${one.message}` : one.message)
  const failures = reads.flatMap(read => ('failure' in read ? [labelled(read.host, read.failure)] : []))
  const answers = reads.flatMap(read => ('answer' in read ? [{ host: read.host, ...read.answer }] : []))
  const notes = answers.flatMap(answer => answer.notes.map(note => labelled(answer.host, note)))
  if (answers.length === 0) {
    const all = together(failures)
    await record($, 'gitlab', all)
    await changePoll($, poll => ({ ...poll, attemptedAt, error: all.message, failures: poll.failures + 1 }))
    return
  }
  const fresh = answers.flatMap(answer => answer.rows)
  // A read GitLab partly timed out, or a host that failed, keeps the cards it left out as last seen, so none vanishes or
  // closes for a poll.
  const behind = new Set([...reads.flatMap(read => ('failure' in read ? [read.host] : [])), ...answers.filter(answer => answer.lost > 0).map(answer => answer.host)])
  const kept = behind.size > 0 ? (await readRows($)).filter(row => behind.has(row.host) && !fresh.some(each => each.key === row.key)) : []
  const rows = [...fresh, ...kept]
  if (failures.length + notes.length > 0) {
    await record($, 'gitlab', together([...failures, ...notes]))
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
  await changePoll($, poll => ({ ...poll, fetchedAt: now, attemptedAt, error: failures.length > 0 ? together(failures).message : null, failures: 0, kept: kept.length }))
  const pinnedKeys = new Set(pinned.map(pinKey))
  const marks = open
    .filter(row => pinnedKeys.has(row.key))
    .map(row => `${statusMark(row.pipeline?.status).glyph} !${row.iid}`)
    .join('  ')
  $.ui.status(marks === '' ? undefined : marks)
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
  const hosts = await readHosts($)
  const parsed = parseMrUrl(url, hosts)
  if (parsed === null) {
    throw new Error(`Not a merge request URL on ${hosts.join(', ')}: ${url}`)
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
