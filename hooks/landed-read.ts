import type { EngineInterface } from 'claude-code'

import { asFailure, together } from './failure'
import type { Failure } from './failure'
import { ask, askRest } from './graphql'
import { landedQuery } from './inbox-requests'
import { answeredBuild, buildOf, isDue, keptFor, landedOf, landingOf, mergeRequestPath, squashShaOf, unanswered } from './landed'
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

/** Runs one ask; what goes wrong is told in `failures`, with the MR named, and the ask gives none. What it answers comes boxed, as an answer may be null. */
async function attempt<T>(merged: Merged, failures: Failure[], work: () => Promise<T>): Promise<{ answer: T } | null> {
  try {
    return { answer: await work() }
  } catch (error) {
    failures.push(asFailure(error, message => `${merged.path}!${merged.iid}: ${message}`))
    return null
  }
}

/**
 * One MR's entry after this pass: what is not due kept as it was, what is due asked now, with `checkedAt` the time it was,
 * whether it was answered or not: an ask that fails waits `RECHECK_MS` (or ↻) for the next, as a project that refuses or times
 * out is no cheaper to ask at every read (`unanswered`). A squash commit that could not be named leaves the entry with none.
 */
async function landedFor($: EngineInterface, merged: Merged, kept: Landed | undefined, now: number, isAsked: boolean, failures: Failure[]): Promise<Landed> {
  if (kept !== undefined && !isDue(kept, merged.mergedAt, now, isAsked)) {
    return landedOf(merged, kept)
  }
  const known = kept?.sha ?? null
  const read = known !== null ? { answer: known } : await attempt(merged, failures, () => shaOf($, merged))
  if (read === null) {
    return unanswered(merged, null, kept, now)
  }
  const sha = read.answer
  if (sha === null) {
    return landedOf(merged, { sha: null, build: null, checkedAt: now, hasFailed: false })
  }
  const looked = await attempt(merged, failures, async () => buildOf(merged.host, merged.url, await ask($, merged.host, landedQuery(merged.path, sha, merged.targetBranch))))
  return looked !== null ? answeredBuild(merged, sha, kept, looked.answer, now) : unanswered(merged, sha, kept, now)
}

/**
 * The user's MRs merged lately, each with its commit and build as far as GitLab has said them; `previous` is what the last read
 * kept, and `isAsked` that a person pressed ↻. A failure comes beside the entries, which are then as they were, and `isHeld`
 * says an earlier failure still stands: the MR it failed on is not asked again yet.
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
    return kept !== undefined && kept.hasFailed && !isDue(kept, merged.mergedAt, now, isAsked)
  })
  return { landed, failure: failures.length > 0 ? together(failures) : null, isHeld }
}
