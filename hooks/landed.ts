// The user's own MRs merged lately, as the Mine tab folds them under `▸ N merged`: which of the inbox's answer count, which
// commit each put on its target branch, and what is left to ask GitLab of each (the squash commit, the build). Pure, on plain
// data; landed-read.ts asks. The inbox carries the list (its snapshot is the one every session already shares), so a session
// that only draws has it without asking GitLab for anything.
import { dataOf, isFilled, isRecord, parseJson, present, timeOf } from './decode.ts'
import { Failure } from './failure.ts'
import type { InboxAuthoredQuery, LandedQuery } from './gitlab.generated.ts'
import { CI_STATUSES, ciStatusOf } from './gitlab-status.ts'
import type { RawResponse } from './gitlab-documents.ts'
import { cut } from './graphemes.ts'
import { siteOf } from './hosts.ts'
import { mergedNodes } from './inbox-gitlab.ts'
import { TITLE_ROOM } from './inbox-rules.ts'
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
 * How long after a merge a build that has not ended is asked for at every read: a pipeline on the target branch is queued,
 * runs and ends within the hour, and the fold says a failure as soon as it does. One still unfinished after that is stuck (no
 * runner, a job waiting on a resource) or very long, and is asked for at the `RECHECK_MS` pace like the rest.
 */
export const BUILD_RUNS_MS = 60 * 60_000

/**
 * How long the pane leaves what may still change, or what could not be asked, before it asks again: a build that failed or
 * was canceled (someone retries the pipeline or a job, and the same commit then shows green), one that waits to be run by hand,
 * a build still unfinished an hour on, a squash commit GitLab would not name, and anything whose ask failed. Asking every
 * minute would put as many questions to GitLab for the whole three days on verdicts that rarely change, or on a project that
 * refuses or times out; a retry shows within this long of being made, and ↻ asks at once.
 */
export const RECHECK_MS = 10 * 60_000

/** An MR merged lately as the inbox's answer gives it, before the commit that landed is known. */
export type Merged = Pick<Landed, 'host' | 'path' | 'iid' | 'title' | 'url' | 'mergedAt' | 'targetBranch'> & {
  /** The merge commit; a fast-forward merge has none. */
  mergeCommitSha: string | null
  /** The head the MR had. */
  diffHeadSha: string | null
}

/**
 * What of some MRs is shown: those merged within `LANDED_WITHIN_MS` of `now`, newest first, at most `LANDED_SHOWN`. The read
 * keeps to it and so does the drawing, as what the snapshot kept (an entry a failing host left in it, or another host's) may be older or more.
 */
export const recentOf = <T extends { mergedAt: number }>(entries: readonly T[], now: number): T[] =>
  entries
    .filter(each => now - each.mergedAt <= LANDED_WITHIN_MS)
    .toSorted((a, b) => b.mergedAt - a.mergedAt)
    .slice(0, LANDED_SHOWN)

/**
 * The user's own MRs merged lately (`recentOf`) as the inbox's answer lists them, whoever merged them. The inbox's own list
 * leaves out those the user merged themselves, which this one is for.
 */
export function mergedLately(host: string, data: InboxAuthoredQuery | null, now: number): Merged[] {
  const merged = (raw: ReturnType<typeof mergedNodes>[number]): Merged[] => {
    const at = timeOf(raw.mergedAt)
    if (at === null) {
      return []
    }
    const path = raw.project.fullPath
    return [
      {
        host,
        path,
        iid: Number(raw.iid),
        title: cut(raw.title, TITLE_ROOM, TITLE_ROOM),
        url: raw.webUrl ?? `${siteOf(host)}/${path}/-/merge_requests/${raw.iid}`,
        mergedAt: at,
        targetBranch: raw.targetBranch,
        mergeCommitSha: isFilled(raw.mergeCommitSha) ? raw.mergeCommitSha : null,
        diffHeadSha: isFilled(raw.diffHeadSha) ? raw.diffHeadSha : null,
      },
    ]
  }
  return recentOf(mergedNodes(data).flatMap(merged), now)
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

/**
 * The newest pipeline GitLab ran on a commit on the target branch that no schedule started, or null when it ran none (or the
 * project is out of reach). The document asks for the newest pipelines and, beside them, for the scheduled ones among the newest:
 * a nightly pipeline runs on the branch's head, is newer than the merge's own, and says nothing of the merge (GitLab's own
 * `merge_pipeline` leaves schedules out).
 */
export function buildOf(host: string, fallback: string, response: RawResponse<LandedQuery>): LandedBuild | null {
  const project = dataOf(response).project
  const scheduled = new Set(present(project?.scheduled?.nodes).map(one => one.id))
  const pipeline = present(project?.pipelines?.nodes).find(one => !scheduled.has(one.id))
  return pipeline !== undefined ? { status: ciStatusOf(pipeline.status), url: isFilled(pipeline.path) ? `${siteOf(host)}${pipeline.path}` : fallback } : null
}

/**
 * Whether a build will not change again: it passed, or it was skipped. A failed one may be run again (the same commit then
 * shows green), as may a canceled one (GitLab's `Ci::Processable#retryable?` counts `canceled?`), and a manual one waits for a
 * person, so none of those is final.
 */
const isFinal = (status: CiStatus): boolean => status === 'success' || status === 'skipped'

/**
 * Whether anything is still to ask GitLab of an MR, given the entry kept for it, `now`, and whether a person pressed ↻:
 *
 * - a build that is final is never asked again, whatever ↻;
 * - ↻ asks for everything else;
 * - a build that has not ended is asked again at every read in the `BUILD_RUNS_MS` after the merge;
 * - after that, a build that has not ended, one that ended and may be run again (failed, canceled or manual), a squash commit
 *   GitLab did not give, and anything whose last ask failed are asked again once `RECHECK_MS` has passed since `checkedAt`,
 *   when they were last asked;
 * - with no build seen, the look is made until one made after GitLab could have started a pipeline finds none, and a look
 *   that got no answer is no such look.
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
  if (kept.hasFailed || kept.sha === null) {
    return hasWaited
  }
  if (kept.build === null) {
    return kept.checkedAt === null || kept.checkedAt - mergedAt < BUILD_APPEARS_MS
  }
  return isSettled(kept.build.status) || now - mergedAt >= BUILD_RUNS_MS ? hasWaited : true
}

/** What is known of an MR from asking GitLab: the part of an entry that is not the inbox's. */
type Asked = Pick<Landed, 'sha' | 'build' | 'checkedAt' | 'hasFailed'>

/** What an MR no one has asked GitLab of yet is known as. */
const NOT_ASKED: Asked = { sha: null, build: null, checkedAt: null, hasFailed: false }

/** The entry for an MR merged lately: what the inbox says of it, with the commit and the build as far as they are known. */
export const landedOf = (merged: Merged, asked: Asked): Landed => ({
  host: merged.host,
  path: merged.path,
  iid: merged.iid,
  title: merged.title,
  url: merged.url,
  mergedAt: merged.mergedAt,
  targetBranch: merged.targetBranch,
  sha: asked.sha,
  build: asked.build,
  checkedAt: asked.checkedAt,
  hasFailed: asked.hasFailed,
})

/**
 * The entry after the build of the commit `sha` was asked for and GitLab answered: the build it named, else the one already
 * known, as a commit's merge pipeline does not go away (the ten newest pipelines asked for may all be schedules', which reads as
 * none), at `now`.
 */
export const answeredBuild = (merged: Merged, sha: string, kept: Landed | undefined, found: LandedBuild | null, now: number): Landed =>
  landedOf(merged, { sha, build: found ?? kept?.build ?? null, checkedAt: now, hasFailed: false })

/**
 * The entry after an ask that got no answer: what was known stays, `now` is the time of the try so that the next waits
 * `RECHECK_MS`, and the entry says the ask failed, so that the problem stands and a look that found nothing is not taken for
 * the answer that none is run.
 */
export const unanswered = (merged: Merged, sha: string | null, kept: Landed | undefined, now: number): Landed =>
  landedOf(merged, { sha, build: kept?.build ?? null, checkedAt: now, hasFailed: true })

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
    isNumberOrNull(value.checkedAt) &&
    typeof value.hasFailed === 'boolean'
  )
}

/**
 * An entry kept by a version that did not say whether its last ask failed, as one whose last ask did not: it is asked again by
 * the rules, which is all a version that kept no such mark did.
 */
const withFailed = (value: unknown): unknown => (isRecord(value) && value.hasFailed === undefined ? { ...value, hasFailed: false } : value)

/** The entries a stored list holds; whatever is not one, and a stored value that is no list (an older snapshot has none), is left out. */
export const keptLanded = (value: unknown): Landed[] => (Array.isArray(value) ? value.map(withFailed).filter(isLanded) : [])

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
  lately.flatMap(one => (one.merged === null ? kept.filter(each => each.host === one.host) : one.merged.map(merged => landedOf(merged, keptFor(kept, merged) ?? NOT_ASKED))))

/** `kept` with each entry `found` has one for put in its place; an MR that is no longer on the list is not brought back by a late answer. */
export const withLanded = (kept: readonly Landed[], found: readonly Landed[]): Landed[] => kept.map(each => keptFor(found, each) ?? each)
