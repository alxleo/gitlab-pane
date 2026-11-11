import type { EngineInterface } from 'claude-code'

import { asFailure, together } from './failure'
import type { Failure } from './failure'
import type { InboxAuthoredQuery } from './gitlab.generated'
import { ask, askRest } from './graphql'
import { landedQuery } from './inbox-requests'
import { buildOf, isBuildDue, keptFor, landedOf, landingOf, mergeRequestPath, mergedLately, squashShaOf } from './landed'
import type { Merged } from './landed'

import type { Landed } from '../types'

// What the leader asks GitLab of the user's MRs merged lately, beside the inbox's own documents: the squash commit of a merge
// that has no merge commit (REST, once, kept for good) and the build of the commit that landed (one small query an MR, until it
// finishes). What each answer means, and what is still due, is landed.ts's to decide; this file sends and keeps what it decides.

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

/** One MR's entry after this pass: what was settled before kept, what is due asked now. An ask that fails leaves the entry as it was. */
async function landedFor($: EngineInterface, merged: Merged, kept: Landed | undefined, now: number, failures: Failure[]): Promise<Landed> {
  const sha = kept?.sha ?? (await attempt(merged, failures, () => shaOf($, merged)))
  if (sha === null) {
    return landedOf(merged, null, null, null)
  }
  const looked = isBuildDue(kept, merged.mergedAt)
    ? await attempt(merged, failures, async () => ({ build: buildOf(merged.host, merged.url, await ask($, merged.host, landedQuery(merged.path, sha, merged.targetBranch))) }))
    : null
  return looked !== null ? landedOf(merged, sha, looked.build, now) : landedOf(merged, sha, kept?.build ?? null, kept?.checkedAt ?? null)
}

/**
 * The user's MRs merged lately on a host, from the inbox's answer, each with its commit and build as far as GitLab has said
 * them; `previous` is what the last read kept. A failure comes beside the entries, which are then as they were.
 */
export async function readLanded(
  $: EngineInterface,
  host: string,
  data: InboxAuthoredQuery | null,
  previous: readonly Landed[],
  now: number
): Promise<{ landed: Landed[]; failure: Failure | null }> {
  const failures: Failure[] = []
  const landed = await Promise.all(mergedLately(host, data, now).map(merged => landedFor($, merged, keptFor(previous, merged), now, failures)))
  return { landed, failure: failures.length > 0 ? together(failures) : null }
}
