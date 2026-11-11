import type { EngineInterface } from 'claude-code'

import { asFailure, together } from './failure'
import type { Failure } from './failure'
import { ask, askRest } from './graphql'
import { landedQuery } from './inbox-requests'
import { buildOf, isDue, keptFor, landedOf, landingOf, mergeRequestPath, squashShaOf } from './landed'
import type { Merged } from './landed'

import type { Landed } from '../types'

// What the leader asks GitLab of the user's MRs merged lately, after the inbox's own documents are in and shown: the squash
// commit of a merge that has no merge commit (REST, once, kept for good) and the build of the commit that landed (one small
// query an MR, until it ends). What each answer means, and what is still due, is landed.ts's to decide; this file sends and
// keeps what it decides.

/** The commit a merge put on its target branch: told by the inbox's answer, or asked of REST when that has no merge commit. */
async function shaOf($: EngineInterface, merged: Merged): Promise<string | null> {
  const first = landingOf(merged, undefined)
  if (first.kind === 'landed') {
    return first.sha
  }
  const answer = await askRest($, merged.host, mergeRequestPath(merged.path, merged.iid), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    needs: 'the read_api scope',
  })
  const asked = landingOf(merged, squashShaOf(answer))
  return asked.kind === 'landed' ? asked.sha : null
}

/** Runs one ask; what goes wrong is told in `failures`, with the MR named, and the ask gives none. */
async function attempt<T>(merged: Merged, failures: Failure[], work: () => Promise<T>): Promise<T | null> {
  try {
    return await work()
  } catch (error) {
    failures.push(asFailure(error, message => `${merged.path}!${merged.iid}: ${message}`))
    return null
  }
}

/**
 * One MR's entry after this pass: what is not due kept as it was, what is due asked now, with `checkedAt` the time it was. A
 * squash commit that could not be read leaves the entry with none and the time of the try, so it waits `RECHECK_MS` (or ↻)
 * for the next, as REST is no cheaper to a project that refuses it. A build's ask that fails leaves the entry as it was, and is
 * made again at the next read, as the inbox's own are.
 */
async function landedFor($: EngineInterface, merged: Merged, kept: Landed | undefined, now: number, isAsked: boolean, failures: Failure[]): Promise<Landed> {
  if (kept !== undefined && !isDue(kept, merged.mergedAt, now, isAsked)) {
    return landedOf(merged, kept.sha, kept.build, kept.checkedAt)
  }
  const sha = kept?.sha ?? (await attempt(merged, failures, () => shaOf($, merged)))
  if (sha === null) {
    return landedOf(merged, null, null, now)
  }
  const looked = await attempt(merged, failures, async () => ({
    build: buildOf(merged.host, merged.url, await ask($, merged.host, landedQuery(merged.path, sha, merged.targetBranch))),
  }))
  return looked !== null ? landedOf(merged, sha, looked.build, now) : landedOf(merged, sha, kept?.build ?? null, kept?.checkedAt ?? null)
}

/**
 * The user's MRs merged lately, each with its commit and build as far as GitLab has said them; `previous` is what the last read
 * kept, and `isAsked` that a person pressed ↻. A failure comes beside the entries, which are then as they were, and `isHeld`
 * says an earlier failure still stands: the MR it was of is not asked again yet.
 */
export async function readLanded(
  $: EngineInterface,
  lately: readonly Merged[],
  previous: readonly Landed[],
  now: number,
  isAsked: boolean
): Promise<{ landed: Landed[]; failure: Failure | null; isHeld: boolean }> {
  const failures: Failure[] = []
  const landed = await Promise.all(lately.map(merged => landedFor($, merged, keptFor(previous, merged), now, isAsked, failures)))
  const isHeld = lately.some(merged => {
    const kept = keptFor(previous, merged)
    return kept !== undefined && kept.sha === null && !isDue(kept, merged.mergedAt, now, isAsked)
  })
  return { landed, failure: failures.length > 0 ? together(failures) : null, isHeld }
}
