import type {
  AuthoredPlainQuery,
  AuthoredQuery,
  MergeStatusQuery,
  MrFieldsFragment,
  NoteFieldsFragment,
  PinnedPlainQuery,
  PinnedQuery,
  ReviewerFieldsFragment,
  ReviewerPlainFragment,
  UsualQuery,
} from './gitlab.generated.ts'
import type { RawResponse } from './gitlab-documents.ts'
import { isFilled, isSome } from './decode.ts'
import { Failure } from './failure.ts'
import { checkStatusOf, ciStatusOf, reviewStateOf } from './gitlab-status.ts'
import { cardKey, projectOf, siteOf } from './hosts.ts'
import { lead, ranOf } from './format.ts'
import { initials } from './identity.ts'
import { fromGitLab } from './markdown.ts'
import { firstDifference } from './order.ts'

import type { CiStatus, GitLabMarkdown, HostFeatures, Job, JobLink, MergeStatus, MrCard, Note, Person, PersonState, Pinned, ReviewState, Usual } from '../types'

/**
 * Which features a host lacks, from the answer it gave: GitLab validates a whole document and says, for each field its
 * schema does not have, `undefinedField` with the type and field in the error's `extensions` (never read from the message).
 */
export function missingFeatures(response: RawResponse<unknown>): (keyof HostFeatures)[] {
  return (response.errors ?? []).flatMap(error => {
    const { code, typeName, fieldName } = error.extensions ?? {}
    if (code !== 'undefinedField') {
      return []
    }
    return typeName === 'UserMergeRequestInteraction' && fieldName === 'reviewState'
      ? ['hasReviewStates' as const]
      : typeName === 'MergeRequest' && fieldName === 'mergeabilityChecks'
        ? ['hasMergeVerdict' as const]
        : typeName === 'Todo' && fieldName === 'targetEntity'
          ? ['hasTodoEntity' as const]
          : []
  })
}

/** Each MR's merge checks by card key; an MR missing from the answer, or sent with no checks, has none. */
export function readMergeStatus(host: string, response: RawResponse<MergeStatusQuery>): Map<string, MergeStatus> {
  const nodes = response.data?.currentUser?.authoredMergeRequests?.nodes ?? []
  return new Map(
    nodes.flatMap(node => {
      if (node === null) {
        return []
      }
      const checks = node.mergeabilityChecks.map(check => ({ id: check.identifier, status: checkStatusOf(check.status) }))
      return checks.length > 0 ? [[cardKey(host, node.project.fullPath, node.iid), checks] as const] : []
    })
  )
}

/** GitLab's `duration` counts only the time jobs ran, so a manual gate left waiting does not stretch it. */
export function readUsual(response: RawResponse<UsualQuery>): Usual | null {
  const seconds = present(response.data?.project?.pipelines?.nodes)
    .map(pipeline => pipeline.duration)
    .filter((value): value is number => typeof value === 'number')
    .sort((a, b) => a - b)
  if (seconds.length < 5) {
    return null
  }
  const at = (share: number) => seconds[Math.round((seconds.length - 1) * share)] ?? 0
  return { low: at(0.25), high: at(0.75) }
}

/** The nodes of a connection that GitLab sent: it may send none, or null in place of one it timed out. */
const present = <T>(nodes: readonly (T | null)[] | null | undefined): T[] => (nodes ?? []).filter(node => node !== null)

type NodeOf<Connection> = Connection extends { nodes: Array<infer Node> | null } ? NonNullable<Node> : never

// The shapes below are the generated types of MrFields and NoteFields (gitlab.generated.ts), which carry the schema's
// nullability: what the schema lets be null is null here too.
type RawReviewer = ReviewerFieldsFragment | ReviewerPlainFragment
/** An MR as either variant of the documents gives it: its reviewers come with their review state, or without. */
export type RawMr = MrFieldsFragment & { reviewers?: { nodes?: Array<RawReviewer | null> | null } | null }
export type RawNote = NoteFieldsFragment
type RawUser = NodeOf<RawMr['approvedBy']>
export type RawPipeline = NonNullable<RawMr['headPipeline']>
export type RawStage = NodeOf<RawPipeline['stages']>
export type RawJob = NodeOf<RawStage['jobs']>

/** GitLab gives an uploaded avatar as a path on its own host and a Gravatar one as a full URL. */
const absolute = (host: string, url: string | null | undefined): string | null => (isFilled(url) ? (url.startsWith('/') ? `${siteOf(host)}${url}` : url) : null)

/** A reviewer's review state; a host without the field gives none, which reads as not yet reviewed. */
const reviewOf = (reviewer: RawReviewer): ReviewState => reviewStateOf('mergeRequestInteraction' in reviewer ? reviewer.mergeRequestInteraction?.reviewState : undefined)

/** Markdown as GitLab stores it, HTML and all, its links made absolute; markdown.ts makes it drawable. */
export function cleanBody(body: string, host: string, path: string): GitLabMarkdown {
  const site = siteOf(host)
  return fromGitLab(
    body
      .replace(/\]\(\/uploads\//g, `](${site}/${path}/uploads/`)
      .replace(/\]\(\//g, `](${site}/`)
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

/** A note without an address of its own links to its MR. */
const toNote = (raw: RawNote, host: string, path: string, isOpen: boolean, mrUrl: string): Note => {
  const line = raw.position?.newLine ?? raw.position?.oldLine
  return {
    author: raw.author?.username ?? 'someone',
    body: cleanBody(raw.body, host, path),
    url: raw.url ?? mrUrl,
    at: raw.createdAt,
    ...(isSome(raw.position) ? { where: `${raw.position.filePath}${(line ?? 0) > 0 ? `:${line}` : ''}` } : {}),
    isOpen,
  }
}

const UNNAMED = '(unnamed)'

/** Letters of a description a row's hover card quotes. */
const LEAD_ROOM = 160

/** A job without a path of its own links to its pipeline. */
const toJob = (host: string, job: RawJob, pipelineUrl: string): Job => ({
  name: job.name ?? UNNAMED,
  status: ciStatusOf(job.status ?? ''),
  allowFailure: job.allowFailure,
  url: isFilled(job.webPath) ? `${siteOf(host)}${job.webPath}` : pipelineUrl,
  startedAt: job.startedAt,
  finishedAt: job.finishedAt,
})

const jobLink = (job: Job): JobLink => ({ name: job.name, url: job.url })

/** Who to talk to first; `open` is a person with open threads, who comes after one asking for changes. */
const STATE_RANK: Record<PersonState | 'open', number> = {
  requested_changes: 0,
  open: 1,
  approved: 2,
  reviewing: 3,
  commented: 4,
  unreviewed: 5,
}

/** A bot without a picture of its own gets a generated identicon, which says nothing of what it is. */
const isIdenticon = (url: string | null): boolean => url !== null && /[?&]d=identicon\b/.test(url)

/** Who to talk to, most pressing first: asked for changes, has open threads, approved, then the rest; bots after people. */
function toPeople(raw: RawMr, host: string, path: string, mrUrl: string, threads: { isOpen: boolean; notes: RawNote[] }[]): Person[] {
  const author = raw.author?.username
  const byName = new Map<string, { name: string; isBot: boolean; avatarUrl: string | null; review: ReviewState; isApprover: boolean; openThreads: number; notes: Note[] }>()
  const meet = (user: RawUser | null) => {
    if (user === null || user.username === author) {
      return undefined
    }
    const avatarUrl = absolute(host, user.avatarUrl)
    const known = byName.get(user.username) ?? {
      name: user.name,
      isBot: user.bot,
      avatarUrl: user.bot && isIdenticon(avatarUrl) ? null : avatarUrl,
      review: 'unreviewed',
      isApprover: false,
      openThreads: 0,
      notes: [],
    }
    byName.set(user.username, known)
    return known
  }
  present(raw.reviewers?.nodes).forEach((reviewer: RawReviewer) => {
    const person = meet(reviewer)
    if (person !== undefined) {
      person.review = reviewOf(reviewer)
    }
  })
  present(raw.approvedBy?.nodes).forEach(user => {
    const person = meet(user)
    if (person !== undefined) {
      person.isApprover = true
    }
  })
  threads.forEach(thread =>
    thread.notes.forEach((one, i) => {
      const person = meet(one.author)
      person?.notes.push(toNote(one, host, path, thread.isOpen, mrUrl))
      if (person !== undefined && i === 0 && thread.isOpen) {
        person.openThreads += 1
      }
    })
  )
  const people = [...byName].map(([username, person]) => {
    const state: PersonState =
      person.review === 'requested_changes'
        ? 'requested_changes'
        : person.isApprover || person.review === 'approved'
          ? 'approved'
          : person.review === 'review_started'
            ? 'reviewing'
            : person.notes.length > 0
              ? 'commented'
              : 'unreviewed'
    const notes = [...person.notes].sort((a, b) => firstDifference(Number(b.isOpen) - Number(a.isOpen), b.at.localeCompare(a.at)))
    return {
      username,
      name: person.name,
      isBot: person.isBot,
      initials: initials(person.name, username),
      avatarUrl: person.avatarUrl,
      state,
      openThreads: person.openThreads,
      notes,
      noteCount: notes.length,
    }
  })
  const shared = new Set(people.map(person => person.initials).filter((value, i, all) => all.indexOf(value) !== i))
  const order = (person: Person) => STATE_RANK[person.state === 'requested_changes' || person.openThreads === 0 ? person.state : 'open']
  // Bots leave a summary on nearly every MR; only one holding the merge, by an open thread or asking for changes, is shown.
  return people
    .filter(person => !person.isBot || person.state === 'requested_changes' || person.openThreads > 0)
    .map(person => (shared.has(person.initials) ? { ...person, initials: initials(person.name, person.username, true) } : person))
    .sort((a, b) => firstDifference(Number(a.isBot) - Number(b.isBot), order(a) - order(b), a.name.localeCompare(b.name)))
}

/** The card for an MR read from `host`. */
export function toCard(host: string, raw: RawMr): MrCard {
  const path = raw.project.fullPath
  const pipeline = raw.headPipeline
  const mrUrl = raw.webUrl ?? `${siteOf(host)}/${path}/-/merge_requests/${raw.iid}`
  const isBot = (note: RawNote) => note.author?.bot === true
  const threads = present(raw.discussions.nodes).flatMap(thread => {
    const notes = present(thread.notes.nodes).filter(one => !one.system)
    const [first] = notes
    return first !== undefined ? [{ isOpen: thread.resolvable && !thread.resolved, notes, first }] : []
  })
  const open = threads.filter(thread => thread.isOpen)
  const reviewers = present(raw.reviewers?.nodes).map(reviewer => ({
    username: reviewer.username,
    isBot: reviewer.bot,
    state: reviewOf(reviewer),
  }))
  const requested = reviewers.filter(reviewer => reviewer.state === 'requested_changes')
  const pipelineUrl = isFilled(pipeline?.path) ? `${siteOf(host)}${pipeline.path}` : mrUrl
  const stages = present(pipeline?.stages?.nodes).map(stage => {
    const stageJobs = present(stage.jobs?.nodes).map(job => toJob(host, job, pipelineUrl))
    return { name: stage.name ?? UNNAMED, status: ciStatusOf(stage.status ?? ''), jobs: stageJobs, ran: ranOf(stageJobs) }
  })
  const jobs = stages.flatMap(stage => stage.jobs)
  const description = cleanBody(raw.description ?? '', host, path)
  return {
    key: cardKey(host, path, raw.iid),
    url: mrUrl,
    host,
    path,
    project: projectOf(host, path),
    repo: { name: raw.project.name, url: raw.project.webUrl ?? `${siteOf(host)}/${path}` },
    iid: Number(raw.iid),
    title: raw.title,
    author: raw.author?.username ?? '',
    description,
    lead: description !== '' ? lead(description, LEAD_ROOM) : '',
    hasDescription: description.trim() !== '',
    branch: { source: raw.sourceBranch, target: raw.targetBranch },
    diff: isSome(raw.diffStatsSummary)
      ? {
          additions: raw.diffStatsSummary.additions,
          deletions: raw.diffStatsSummary.deletions,
          files: raw.diffStatsSummary.fileCount,
        }
      : null,
    isDraft: raw.draft,
    isOpen: raw.state === 'opened',
    updatedAt: raw.updatedAt,
    hasConflicts: raw.conflicts,
    needsRebase: raw.shouldBeRebased,
    changesRequestedBy: requested.filter(reviewer => !reviewer.isBot).map(reviewer => reviewer.username),
    approvalsLeft: raw.approvalsLeft ?? 0,
    approvalsRequired: raw.approvalsRequired ?? 0,
    // Filled from `mergeStatusQuery`, which reads it truer than this MR's own fields do.
    mergeStatus: null,
    approvers: present(raw.approvedBy?.nodes)
      .filter(user => !user.bot)
      .map(user => user.username),
    reviewers,
    people: toPeople(raw, host, path, mrUrl, threads),
    ...(isSome(pipeline)
      ? {
          pipeline: {
            id: Number(pipeline.id.split('/').pop()),
            status: ciStatusOf(pipeline.status),
            url: pipelineUrl,
            duration: pipeline.duration,
            startedAt: pipeline.startedAt,
            finishedAt: pipeline.finishedAt,
            stages,
            failed: jobs.filter(job => job.status === 'failed' && !job.allowFailure).map(jobLink),
            amber: jobs.filter(job => job.status === 'failed' && job.allowFailure).map(jobLink),
            blockedOn: jobs.filter(job => job.status === 'manual' && !job.allowFailure).map(job => job.name),
            moreJobs: 0,
            moreFailed: 0,
            moreAmber: 0,
          },
        }
      : {}),
    openThreads: open
      .filter(thread => !isBot(thread.first))
      .map(thread => ({
        ...toNote(thread.first, host, path, true, mrUrl),
        replies: thread.notes.slice(1).map(one => toNote(one, host, path, true, mrUrl)),
      })),
    threadsLeft: { loose: 0, held: 0 },
  }
}

/** How many of the authored MRs GitLab sent back null: parts of a heavy query it timed out. */
export const lostIn = (response: RawResponse<AuthoredQuery | AuthoredPlainQuery>): number =>
  (response.data?.currentUser?.authoredMergeRequests?.nodes ?? []).filter(node => node === null).length

const dataOf = <Data>(response: RawResponse<Data>): Data => {
  const { data } = response
  if (!isSome(data)) {
    const reason = (response.errors ?? []).map(error => error.message).join('; ')
    throw reason === '' ? new Failure('bad-answer', 'GitLab sent no data') : new Failure('server', reason)
  }
  return data
}

/** The authored MRs as cards. A read with no data at all throws; a partial one keeps what came back. */
export const readResponse = (host: string, response: RawResponse<AuthoredQuery | AuthoredPlainQuery>): MrCard[] =>
  present(dataOf(response).currentUser?.authoredMergeRequests?.nodes).map(raw => toCard(host, raw))

/** The one pinned MR as a card, or none when GitLab named no such MR or project (out of reach). */
export const readPinned = (host: string, response: RawResponse<PinnedQuery | PinnedPlainQuery>): MrCard[] => {
  const raw = dataOf(response).project?.mergeRequest
  return isSome(raw) ? [toCard(host, raw)] : []
}
