import type { EngineInterface } from 'claude-code'

import {
  heldTicket,
  knowTicketDetail,
  knowTickets,
  markTicketsRead,
  markUnreachable,
  markUsualRead,
  mergeUsual,
  readAvatarsShown,
  readBrowse,
  readReads,
  readUnreachable,
  readUsualKnown,
  setAvatars,
} from './data'
import { stringRecord, usualRecord } from './decode'
import { isEqual } from './equal'
import { asFailure, Failure, together } from './failure'
import { clear, quietly, record } from './failures'
import { joined } from './in-flight'
import { moveTickets } from './jira-mover'
import { readUsual, usualQuery } from './ask-usual'
import { ask } from './graphql'
import { detailArgs, readTicketDetails, readTickets, searchArgs } from './jira'
import { ticketOf } from './format'
import { pictureUri, sizedAvatar } from './picture'
import { isPassDue } from './snapshot'
import { failureOf, runJson } from './tools'

import type { MrCard } from '../types'

// What the leader reads beside the MRs: Jira's view of their tickets, how long each repo's pipelines usually run, and the
// people's pictures. The tickets and run times stay in this session's state; the pictures go to the store, for the sessions
// that only draw to find there.

export const TICKETS_EVERY_MS = 15 * 60_000
export const USUAL_EVERY_MS = 30 * 60_000

/**
 * Jira's view of the tickets the titles name, every 15 minutes or when a new one appears, while a Jira site is set; a
 * failure (no `acli` installed or signed in, say) keeps the last, and a key Jira does not know waits like the rest.
 */
export async function readJira($: EngineInterface, rows: readonly MrCard[], now: number): Promise<void> {
  if ((await readBrowse($)) === '') {
    return
  }
  const keys = [...new Set(rows.map(row => ticketOf(row.title)).filter(key => key !== null))]
  const reads = await readReads($)
  if (!isPassDue(keys, { at: reads.ticketsAt, asked: reads.ticketsAsked }, TICKETS_EVERY_MS, now)) {
    return
  }
  // Marked before the search, so a new snapshot taken in while it runs (up to a minute) starts no second one.
  await markTicketsRead($, now, keys)
  const found = await runJson($, 'acli', searchArgs(keys), readTickets, { timeoutMs: 60_000 })
  if (!found.ok) {
    await record($, 'jira', failureOf(found))
    return
  }
  await clear($, 'jira')
  await knowTickets($, found.value)
}

/**
 * A ticket opened under a card, read whole: its description and assignee, which the quarter-hourly read leaves out. What
 * was read is drawn at once, and read again on an opening once it is as old as the quarter-hourly read lets a ticket be. A
 * ticket Jira answers without is kept as not found. A failure is kept with the ticket (`failed`), so its panel says so and
 * no other's does, and asked again at its next opening; what an earlier read gave is kept over it. `/gitlab` says the last
 * such failure (`jira-ticket`), apart from the quarter-hourly read's.
 */
export function ensureTicket($: EngineInterface, key: string): Promise<void> {
  return joined(`ticket:${key}`, async () => {
    const now = await $.clock.now()
    const held = await heldTicket($, key)
    if ((await readBrowse($)) === '' || (held !== undefined && held.failed === undefined && now - held.at < TICKETS_EVERY_MS)) {
      return
    }
    const found = await runJson($, 'acli', detailArgs(key), readTicketDetails, { timeoutMs: 60_000 })
    if (!found.ok) {
      await record($, 'jira-ticket', failureOf(found))
      if (held === undefined || held.failed !== undefined) {
        await knowTicketDetail($, key, { assignee: '', description: '', isFound: false, at: now, failed: found.kind })
      }
      return
    }
    await clear($, 'jira-ticket')
    const detail = found.value[key]
    await knowTicketDetail($, key, detail !== undefined ? { ...detail, isFound: true, at: now } : { assignee: '', description: '', isFound: false, at: now })
  })
}

/**
 * How long each repo's MR pipelines usually run, every 30 minutes or when a new repo appears; one pass at a time, however
 * long it takes, each project saved as it is read, so one that fails keeps the last of its own and loses no other's. A
 * project that fails is asked again at the next pass, as one that refuses or times out is no cheaper to ask at every read.
 */
function readUsualTimes($: EngineInterface, rows: readonly MrCard[], now: number): Promise<void> {
  return joined('usual', async () => {
    const projects = [...new Map(rows.map(row => [row.project, row])).values()]
    const [known, reads] = await Promise.all([readUsualKnown($), readReads($)])
    const keys = projects.map(row => row.project)
    if (!isPassDue(keys, { at: reads.usualAt, asked: reads.usualAsked }, USUAL_EVERY_MS, now)) {
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
    await markUsualRead($, now, keys)
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
async function readAvatars($: EngineInterface, rows: readonly MrCard[]): Promise<void> {
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

/**
 * What the leader does with a read's open MRs once it has drawn them: their repos' run times, their people's pictures,
 * and the Jira moves they call for (after the inbox, which says who the user is and what merged), each failing alone.
 */
export function afterRead($: EngineInterface, open: readonly MrCard[], now: number): void {
  quietly($, readUsualTimes($, open, now), 'usual')
  quietly($, readAvatars($, open), 'avatars')
  quietly($, moveTickets($, open), 'jira-moves')
}

const USUAL_STORE = 'usual'

/** The pictures and run times the leader kept in the store, for a session that draws what the leader read. */
export async function loadShared($: EngineInterface): Promise<void> {
  const [pictures, times] = await Promise.all([$.store.get(AVATAR_STORE), $.store.get(USUAL_STORE)])
  await Promise.all([setAvatars($, stringRecord(pictures)), mergeUsual($, usualRecord(times))])
}
