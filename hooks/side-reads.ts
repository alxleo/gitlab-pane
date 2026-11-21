import type { EngineInterface } from 'claude-code'

import {
  knowTickets,
  markTicketsRead,
  markUnreachable,
  markUsualRead,
  mergeUsual,
  readAvatarsShown,
  readSuggestedKnown,
  readBrowse,
  readReads,
  readUnreachable,
  readUsualKnown,
  setAvatars,
  setSuggested,
} from './data'
import { stringRecord, suggestedRecord, usualRecord } from './decode'
import { isEqual } from './equal'
import { suggestionsFor } from './face-model'
import { asFailure, Failure, together } from './failure'
import { clear, quietly, record, reported } from './failures'
import { joined } from './in-flight'
import { moveTickets, readUsers } from './jira-mover'
import { readSuggested, suggestedQuery } from './ask-suggested'
import { readUsual, usualQuery } from './ask-usual'
import { ask, askVariant } from './graphql'
import { readTickets, searchArgs } from './jira'
import { ticketOf } from './format'
import { pictureUri, sizedAvatar } from './picture'
import { isPassDue } from './snapshot'
import { failureOf, runJson } from './tools'

import type { MrCard, Suggested } from '../types'

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

const SUGGESTED_STORE = 'suggested'

/**
 * Who GitLab suggests to approve each MR of the user's that is short of reviewers (`suggestionsFor`), asked again when
 * the MR has changed since, or at the next read after the ask failed; one pass at a time, each MR alone, so one that fails
 * keeps its last and loses no other's.
 * Kept only for those MRs, so it never outgrows them. Only the leader asks; the store carries them to the sessions that draw.
 */
function readSuggestions($: EngineInterface, rows: readonly MrCard[]): Promise<void> {
  return joined('suggested', async () => {
    const [known, users] = await Promise.all([readSuggestedKnown($), readUsers($)])
    const failures: Failure[] = []
    const kept: [string, Suggested[string]][] = []
    for (const card of rows) {
      const held = known[card.key]
      const fate = suggestionsFor(card, users[card.host] ?? null)
      if (fate === 'keep' && held !== undefined) {
        kept.push([card.key, held])
      }
      if (fate !== 'ask') {
        continue
      }
      try {
        // A host without the field answers none, and is not asked again.
        const answer = held?.on === card.updatedAt ? null : await askVariant($, card.host, features => suggestedQuery(card.path, card.iid, features))
        const people = answer !== null ? readSuggested(card.host, answer) : null
        kept.push([card.key, people !== null ? { on: card.updatedAt, people } : (held ?? { on: '', people: [] })])
      } catch (error) {
        failures.push(asFailure(error, message => `${card.project}: ${message}`))
        kept.push([card.key, held ?? { on: '', people: [] }])
      }
    }
    const next: Suggested = Object.fromEntries(kept)
    await setSuggested($, next)
    if (!isEqual(next, known)) {
      await $.store.set(SUGGESTED_STORE, next)
    }
    if (failures.length > 0) {
      await record($, 'suggested', together(failures))
    } else {
      await clear($, 'suggested')
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
  const suggested = await readSuggestedKnown($)
  // The people a card suggests are on the pane too, faded.
  const people = rows.flatMap(row => [...row.people, ...(suggested[row.key]?.people ?? [])])
  const urls = [...new Set(people.map(person => person.avatarUrl))].filter(url => url !== null)
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
 * What the leader does with a read's open MRs once it has drawn them: their repos' run times, who GitLab suggests as
 * their reviewers and then their people's pictures, theirs among them, and the Jira moves they call for (after the inbox,
 * which says who the user is and what merged), each failing alone.
 */
export function afterRead($: EngineInterface, open: readonly MrCard[], now: number): void {
  quietly($, readUsualTimes($, open, now), 'usual')
  quietly(
    $,
    readSuggestions($, open)
      .catch(reported($, 'suggested'))
      .then(() => readAvatars($, open)),
    'avatars'
  )
  quietly($, moveTickets($, open), 'jira-moves')
}

const USUAL_STORE = 'usual'

/** The pictures, run times and suggested reviewers the leader kept in the store, for a session that draws what the leader read. */
export async function loadShared($: EngineInterface): Promise<void> {
  const [pictures, times, suggested] = await Promise.all([$.store.get(AVATAR_STORE), $.store.get(USUAL_STORE), $.store.get(SUGGESTED_STORE)])
  await Promise.all([setAvatars($, stringRecord(pictures)), mergeUsual($, usualRecord(times)), setSuggested($, suggestedRecord(suggested))])
}
