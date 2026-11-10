import type { EngineInterface } from 'claude-code'

import {
  markUnreachable,
  markUsualRead,
  mergeTickets,
  mergeUsual,
  readAvatarsShown,
  readBrowse,
  readReads,
  readTicketsKnown,
  readUnreachable,
  readUsualKnown,
  setAvatars,
} from './data'
import { stringRecord, usualRecord } from './decode'
import { isEqual } from './equal'
import { asFailure, Failure, together } from './failure'
import { clear, record } from './failures'
import { joined } from './in-flight'
import { readUsual } from './gitlab'
import { usualQuery } from './gitlab-documents'
import { ask } from './graphql'
import { TICKET_FIELDS, readTickets, ticketQuery } from './jira'
import { ticketOf } from './format'
import { pictureUri, sizedAvatar } from './picture'
import { failureOf, runJson } from './tools'

import type { MrCard } from '../types'

// What the leader reads beside the MRs: Jira's view of their tickets, how long each repo's pipelines usually run, and the
// people's pictures. The tickets and run times stay in this session's state; the pictures go to the store, for the sessions
// that only draw to find there.

export const TICKETS_EVERY_MS = 15 * 60_000
export const USUAL_EVERY_MS = 30 * 60_000

/**
 * Jira's view of the tickets the titles name, every 15 minutes or when a new one appears, while a Jira site is set; a
 * failure (no `acli` installed or signed in, say) keeps the last.
 */
export async function readJira($: EngineInterface, rows: readonly MrCard[], now: number): Promise<void> {
  if ((await readBrowse($)) === '') {
    return
  }
  const keys = [...new Set(rows.map(row => ticketOf(row.title)).filter(key => key !== null))]
  const [known, reads] = await Promise.all([readTicketsKnown($), readReads($)])
  const isDue = reads.ticketsAt === null || now - reads.ticketsAt >= TICKETS_EVERY_MS
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
export function readUsualTimes($: EngineInterface, rows: readonly MrCard[], now: number): Promise<void> {
  return joined('usual', async () => {
    const projects = [...new Map(rows.map(row => [row.project, row])).values()]
    const [known, reads] = await Promise.all([readUsualKnown($), readReads($)])
    const isDue = reads.usualAt === null || now - reads.usualAt >= USUAL_EVERY_MS
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
    // The run times are GitLab's, so only the leader reads them; the store carries them to the sessions that draw.
    const after = await readUsualKnown($)
    if (!isEqual(after, known)) {
      await $.store.set(USUAL_STORE, after)
    }
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

/**
 * Each person's avatar, fetched once and kept across sessions by the URL GitLab gave, so a new picture is a new URL. The
 * store is written only when a picture was fetched or a person left the pane: the store is a file every session rewrites
 * whole, and the pictures are its largest value after the snapshot.
 */
export async function readAvatars($: EngineInterface, rows: readonly MrCard[]): Promise<void> {
  const urls = [...new Set(rows.flatMap(row => row.people.map(person => person.avatarUrl)))].filter(url => url !== null)
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
  await markUnreachable(
    $,
    failed.map(pair => pair[0])
  )
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

const USUAL_STORE = 'usual'

/** The pictures and run times the leader kept in the store, for a session that draws what the leader read. */
export async function loadShared($: EngineInterface): Promise<void> {
  const [pictures, times] = await Promise.all([$.store.get(AVATAR_STORE), $.store.get(USUAL_STORE)])
  await Promise.all([setAvatars($, stringRecord(pictures)), mergeUsual($, usualRecord(times))])
}
