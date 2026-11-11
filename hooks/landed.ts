// The user's own MRs merged lately, as the Mine tab folds them under `▸ N merged`: which of the inbox's answer count, which
// commit each put on its target branch, and what is left to ask GitLab of each (the squash commit, the build). Pure, on plain
// data; landed-read.ts asks. The inbox carries the list (its snapshot is the one every session already shares), so a session
// that only draws has it without asking GitLab for anything.
import { dataOf, isFilled, isRecord, parseJson } from './decode.ts'
import { Failure } from './failure.ts'
import type { InboxAuthoredQuery, LandedQuery } from './gitlab.generated.ts'
import { CI_STATUSES, ciStatusOf } from './gitlab-status.ts'
import type { RawResponse } from './gitlab-documents.ts'
import { shorten } from './graphemes.ts'
import { siteOf } from './hosts.ts'
import { isSettled } from './status.ts'

import type { CiStatus, Landed, LandedBuild } from '../types'

/**
 * How long a merged MR stays in the Mine tab: a long weekend, so what merged on Friday is there on Monday. The section is a
 * way back to what has just landed, and the inbox's own horizon holds the rest.
 */
export const LANDED_WITHIN_MS = 3 * 86_400_000

/** The most MRs it lists, so the folded section stays one line and an open one a few, however many merge. The inbox read asks for ten, so the newest five are always among them. */
export const LANDED_SHOWN = 5

/**
 * How long after a merge GitLab may still be about to start a pipeline on the target branch. A look made after this that
 * finds none is the answer (a branch the project runs no pipeline on), and is not made again: nothing would stop it
 * until the MR left the section three days later.
 */
export const BUILD_APPEARS_MS = 10 * 60_000

/**
 * How long the pane leaves what a person may still change before it asks again: a build that failed (someone retries the
 * pipeline or a job, and the same commit then shows green), one that waits to be run by hand, and a squash commit GitLab would
 * not name. Asking every minute would put as many questions to GitLab for the whole three days on verdicts that rarely
 * change, and a retry shows within this long of being made; ↻ asks at once.
 */
export const RECHECK_MS = 10 * 60_000

/** Letters of a title the snapshot keeps, as it keeps the inbox's own: the snapshot is stored, and what a row says of a title is shorter still. */
const TITLE_ROOM = 100

/** An MR merged lately as the inbox's answer gives it, before the commit that landed is known. */
export type Merged = Pick<Landed, 'host' | 'path' | 'iid' | 'title' | 'url' | 'mergedAt' | 'targetBranch'> & {
  /** The merge commit; a fast-forward merge has none. */
  mergeCommitSha: string | null
  /** The head the MR had. */
  diffHeadSha: string | null
}

type Raw = NonNullable<NonNullable<NonNullable<InboxAuthoredQuery['currentUser']>['merged']>['nodes']>[number]

const present = <T>(list: readonly (T | null)[] | null | undefined): T[] => (list ?? []).flatMap(one => (one === null ? [] : [one]))

/**
 * The user's own MRs merged within `LANDED_WITHIN_MS`, newest first, at most `LANDED_SHOWN`; whoever merged them. The inbox's
 * own list leaves out those the user merged themselves, which this one is for.
 */
export function mergedLately(host: string, data: InboxAuthoredQuery | null, now: number): Merged[] {
  const merged = (raw: NonNullable<Raw>): Merged[] => {
    const at = raw.mergedAt === null ? Number.NaN : Date.parse(raw.mergedAt)
    if (Number.isNaN(at) || now - at > LANDED_WITHIN_MS) {
      return []
    }
    const path = raw.project.fullPath
    return [
      {
        host,
        path,
        iid: Number(raw.iid),
        title: shorten(raw.title, TITLE_ROOM),
        url: raw.webUrl ?? `${siteOf(host)}/${path}/-/merge_requests/${raw.iid}`,
        mergedAt: at,
        targetBranch: raw.targetBranch,
        mergeCommitSha: isFilled(raw.mergeCommitSha) ? raw.mergeCommitSha : null,
        diffHeadSha: isFilled(raw.diffHeadSha) ? raw.diffHeadSha : null,
      },
    ]
  }
  return present(data?.currentUser?.merged?.nodes)
    .flatMap(merged)
    .toSorted((a, b) => b.mergedAt - a.mergedAt)
    .slice(0, LANDED_SHOWN)
}

/** Which commit a merge put on its target branch, or what is still to ask for it. */
export type Landing = { kind: 'landed'; sha: string } | { kind: 'ask-squash-commit' } | { kind: 'unknown' }

/**
 * The commit a merge put on the target branch, in the order GitLab itself looks (`MergeRequest#merged_commit_sha`): the merge
 * commit, which a merge-commit merge has, squashed or not; else the squash commit; else the head the MR had, which a
 * fast-forward merge without a squash puts there.
 *
 * GraphQL has no squash commit, and its `squash` says what the MR was set to, which a project's own setting may have
 * overridden, so a merge with no merge commit is asked for it over REST (`squashShaOf`): `squash` is that answer, undefined
 * while it was not asked for, null once asked and none.
 */
export function landingOf(merged: Pick<Merged, 'mergeCommitSha' | 'diffHeadSha'>, squash: string | null | undefined): Landing {
  const { mergeCommitSha, diffHeadSha } = merged
  if (mergeCommitSha !== null) {
    return { kind: 'landed', sha: mergeCommitSha }
  }
  if (squash === undefined) {
    return { kind: 'ask-squash-commit' }
  }
  const sha = squash ?? diffHeadSha
  return sha !== null ? { kind: 'landed', sha } : { kind: 'unknown' }
}

/** The REST path of an MR, whose entity names its squash commit. */
export const mergeRequestPath = (path: string, iid: number): string => `projects/${encodeURIComponent(path)}/merge_requests/${iid}`

/** What GitLab's REST answer for an MR says of its squash commit: its sha, or null when it names none. One that is no entity throws. */
export function squashShaOf(answer: { status: number; text: string }): string | null {
  if (answer.status < 200 || answer.status >= 300) {
    throw new Failure(answer.status >= 500 ? 'server' : 'bad-answer', `GitLab answered HTTP ${answer.status} for the merge request`)
  }
  let entity: unknown
  try {
    entity = parseJson(answer.text)
  } catch {
    throw new Failure('bad-answer', 'GitLab answered a merge request that is not JSON')
  }
  if (!isRecord(entity)) {
    throw new Failure('bad-answer', 'GitLab answered a merge request that is not an object')
  }
  const sha = entity.squash_commit_sha
  return typeof sha === 'string' && sha !== '' ? sha : null
}

/** The newest pipeline GitLab ran on a commit on the target branch, or null when it ran none (or the project is out of reach). */
export function buildOf(host: string, fallback: string, response: RawResponse<LandedQuery>): LandedBuild | null {
  const [pipeline] = present(dataOf(response).project?.pipelines?.nodes)
  return pipeline !== undefined ? { status: ciStatusOf(pipeline.status), url: isFilled(pipeline.path) ? `${siteOf(host)}${pipeline.path}` : fallback } : null
}

/**
 * Whether a build will not change again: it passed, or it was stopped or skipped. A failed one may be run again (the same
 * commit then shows green) and a manual one waits for a person, so neither is final.
 */
const isFinal = (status: CiStatus): boolean => status === 'success' || status === 'canceled' || status === 'skipped'

/**
 * Whether anything is still to ask GitLab of an MR, given the entry kept for it, `now`, and whether a person pressed ↻:
 *
 * - a build that is final is never asked again, whatever ↻;
 * - ↻ asks for everything else;
 * - a build still running is asked again at every read;
 * - a build that failed or waits on a person, and a squash commit GitLab did not give, are asked again once `RECHECK_MS` has
 *   passed since `checkedAt`, when they were last asked;
 * - with no build seen, the look is made until one made after GitLab could have started a pipeline finds none.
 */
export function isDue(kept: Landed | undefined, mergedAt: number, now: number, isAsked: boolean): boolean {
  if (kept === undefined) {
    return true
  }
  if (kept.build !== null && isFinal(kept.build.status)) {
    return false
  }
  if (isAsked) {
    return true
  }
  const hasWaited = kept.checkedAt === null || now - kept.checkedAt >= RECHECK_MS
  if (kept.sha === null) {
    return hasWaited
  }
  if (kept.build === null) {
    return kept.checkedAt === null || kept.checkedAt - mergedAt < BUILD_APPEARS_MS
  }
  return isSettled(kept.build.status) ? hasWaited : true
}

/** The entry for an MR merged lately: what the inbox says of it, with the commit and the build as far as they are known. */
export const landedOf = (merged: Merged, sha: string | null, build: LandedBuild | null, checkedAt: number | null): Landed => ({
  host: merged.host,
  path: merged.path,
  iid: merged.iid,
  title: merged.title,
  url: merged.url,
  mergedAt: merged.mergedAt,
  targetBranch: merged.targetBranch,
  sha,
  build,
  checkedAt,
})

const isCiStatus = (value: unknown): value is CiStatus => typeof value === 'string' && Object.hasOwn(CI_STATUSES, value)

const isNumberOrNull = (value: unknown): boolean => value === null || typeof value === 'number'

/**
 * Whether a stored value is an entry as far as the pane reads one. The inbox's snapshot outlives a reload and is shared with
 * sessions on other versions, so what the code dereferences is checked, and an entry in another shape is left out.
 */
function isLanded(value: unknown): value is Landed {
  return (
    isRecord(value) &&
    typeof value.host === 'string' &&
    typeof value.path === 'string' &&
    typeof value.iid === 'number' &&
    typeof value.title === 'string' &&
    typeof value.url === 'string' &&
    typeof value.mergedAt === 'number' &&
    typeof value.targetBranch === 'string' &&
    (value.sha === null || typeof value.sha === 'string') &&
    (value.build === null || (isRecord(value.build) && isCiStatus(value.build.status) && typeof value.build.url === 'string')) &&
    isNumberOrNull(value.checkedAt)
  )
}

/** The entries a stored list holds; whatever is not one, and a stored value that is no list (an older snapshot has none), is left out. */
export const keptLanded = (value: unknown): Landed[] => (Array.isArray(value) ? value.filter(isLanded) : [])

/** The entry kept for an MR, by its host, project and number. */
export const keptFor = (kept: readonly Landed[], merged: Pick<Merged, 'host' | 'path' | 'iid'>): Landed | undefined =>
  kept.find(one => one.host === merged.host && one.path === merged.path && one.iid === merged.iid)

/** What one host's inbox answer said of the MRs merged lately: none when the document that tells it failed. */
export type Lately = { host: string; merged: readonly Merged[] | null }

/**
 * The entries for what the inbox says merged lately, before GitLab is asked of any: each as far as `kept` knows its commit and
 * build, so that the list is there at once and the asking fills it in. A host whose document failed keeps the entries it had.
 */
export const knownLanded = (lately: readonly Lately[], kept: readonly Landed[]): Landed[] =>
  lately.flatMap(one =>
    one.merged === null
      ? kept.filter(each => each.host === one.host)
      : one.merged.map(merged => {
          const was = keptFor(kept, merged)
          return landedOf(merged, was?.sha ?? null, was?.build ?? null, was?.checkedAt ?? null)
        })
  )

/** `kept` with each entry `found` has one for put in its place; an MR that is no longer on the list is not brought back by a late answer. */
export const withLanded = (kept: readonly Landed[], found: readonly Landed[]): Landed[] => kept.map(each => keptFor(found, each) ?? each)
