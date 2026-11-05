import { initials } from './identity'

import type { CiStatus, Job, JobLink, MergeStatus, MrCard, Note, Person, PersonState, Pinned, ReviewState, Usual } from '../types'

const GITLAB = 'https://gitlab.com'

const CI_STATUSES: Record<CiStatus, true> = {
  created: true,
  waiting_for_resource: true,
  preparing: true,
  waiting_for_callback: true,
  pending: true,
  running: true,
  success: true,
  failed: true,
  canceling: true,
  canceled: true,
  skipped: true,
  manual: true,
  scheduled: true,
  unknown: true,
}

const REVIEW_STATES: Record<ReviewState, true> = {
  unreviewed: true,
  reviewed: true,
  requested_changes: true,
  approved: true,
  unapproved: true,
  review_started: true,
  unknown: true,
}

const MERGE_STATUSES: Record<MergeStatus, true> = {
  UNCHECKED: true,
  CHECKING: true,
  MERGEABLE: true,
  COMMITS_STATUS: true,
  CI_MUST_PASS: true,
  CI_STILL_RUNNING: true,
  DISCUSSIONS_NOT_RESOLVED: true,
  DRAFT_STATUS: true,
  NOT_OPEN: true,
  NOT_APPROVED: true,
  BLOCKED_STATUS: true,
  EXTERNAL_STATUS_CHECKS: true,
  PREPARING: true,
  JIRA_ASSOCIATION: true,
  CONFLICT: true,
  NEED_REBASE: true,
  APPROVALS_SYNCING: true,
  LOCKED_PATHS: true,
  LOCKED_LFS_FILES: true,
  MERGE_TIME: true,
  SECURITY_POLICIES_VIOLATIONS: true,
  TITLE_NOT_MATCHING: true,
  REQUESTED_CHANGES: true,
  SECURITY_POLICY_PIPELINE_CHECK: true,
  UNKNOWN: true,
}

// GitLab adds enum values without notice; one the pane does not know becomes `unknown`, drawn as such, and never a known one.
const known = <T extends string>(table: Record<T, true>, value: string): T | undefined => (Object.hasOwn(table, value) ? (value as T) : undefined)

/** GitLab's `CiJobStatus` or `PipelineStatusEnum` (or a stage's status, a plain string), lower cased. */
export const ciStatusOf = (status: string): CiStatus => known(CI_STATUSES, status.toLowerCase()) ?? 'unknown'

/** `MergeRequestReviewState`, lower cased; none yet reads as unreviewed. */
const reviewStateOf = (state: string | null | undefined): ReviewState => known(REVIEW_STATES, (state ?? 'unreviewed').toLowerCase()) ?? 'unknown'

export const mergeStatusOf = (status: string): MergeStatus => known(MERGE_STATUSES, status) ?? 'UNKNOWN'

const NOTE_FIELDS = `body system url createdAt author { username name bot avatarUrl } position { filePath newLine oldLine }`

// Stage jobs leave out retried ones, so a job that failed then passed on retry reads as passed.
const MR_FIELDS = `
  iid state title webUrl draft conflicts shouldBeRebased approvalsLeft approvalsRequired updatedAt
  description sourceBranch targetBranch
  author { username }
  diffStatsSummary { additions deletions fileCount }
  project { fullPath name webUrl }
  approvedBy { nodes { username name bot avatarUrl } }
  reviewers { nodes { username name bot avatarUrl mergeRequestInteraction { reviewState } } }
  headPipeline {
    id status duration startedAt finishedAt path
    stages { nodes { name status jobs { nodes { name status allowFailure startedAt finishedAt webPath } } } }
  }
  discussions(first: 100) { nodes { resolvable resolved notes(first: 20) { nodes { ${NOTE_FIELDS} } } } }
`

/** Every open MR the user authored; GitLab scores it 158 of the 250 a query may cost. */
export const authoredQuery = (): string =>
  `query { currentUser { authoredMergeRequests(state: opened, first: 50, sort: UPDATED_DESC) { nodes { ${MR_FIELDS} } } } }`

/**
 * GitLab's merge verdict for the same MRs, asked on its own: inside the authored query it answered CONFLICT, twice in a
 * row, for MRs that this query and each MR's own lookup called MERGEABLE.
 */
export const mergeStatusQuery = (): string =>
  `query { currentUser { authoredMergeRequests(state: opened, first: 50, sort: UPDATED_DESC) { nodes { iid project { fullPath } detailedMergeStatus } } } }`

/** Each MR's verdict by card key; an MR missing from the answer has none. */
export function readMergeStatus(response: RawResponse): Map<string, MergeStatus> {
  const nodes = response.data?.currentUser?.authoredMergeRequests?.nodes ?? []
  return new Map(
    nodes.flatMap(node => (node?.detailedMergeStatus ? [[`${node.project.fullPath}!${node.iid}`, mergeStatusOf(node.detailedMergeStatus)] as const] : []))
  )
}

/** Each pinned MR costs about 103, so a query takes at most this many. */
export const PINS_PER_QUERY = 2

/** Pinned MRs the authored list lacks (someone else's, or merged), by project and iid. */
export function pinnedQuery(pinned: readonly Pinned[]): string {
  if (pinned.length > PINS_PER_QUERY) {
    throw new Error(`A query takes at most ${PINS_PER_QUERY} pinned MRs, got ${pinned.length}.`)
  }
  const aliases = pinned
    .map(
      (mr, i) =>
        `p${i}: project(fullPath: ${JSON.stringify(mr.project)}) { mergeRequest(iid: ${JSON.stringify(String(mr.iid))}) { ${MR_FIELDS} } }`
    )
    .join('\n')
  return `query {\n${aliases}\n}`
}

/** Each project costs 11, so a query takes at most this many. */
export const PROJECTS_PER_QUERY = 15

/** The recent successful MR pipelines of each project, for how long one usually runs. */
export function usualQuery(projects: readonly string[]): string {
  const aliases = projects
    .map(
      (path, i) =>
        `h${i}: project(fullPath: ${JSON.stringify(path)}) { pipelines(source: "merge_request_event", status: SUCCESS, first: 20) { nodes { duration } } }`
    )
    .join('\n')
  return `query {\n${aliases}\n}`
}

/** GitLab's `duration` counts only the time jobs ran, so a manual gate left waiting does not stretch it. */
export function readUsual(response: RawResponse, projects: readonly string[]): Record<string, Usual> {
  const data = response.data ?? {}
  return Object.fromEntries(
    projects.flatMap((path, i) => {
      const project = data[`h${i}`] as { pipelines?: { nodes?: { duration: number | null }[] } } | null | undefined
      const seconds = (project?.pipelines?.nodes ?? [])
        .map(pipeline => pipeline.duration)
        .filter((value): value is number => typeof value === 'number')
        .sort((a, b) => a - b)
      if (seconds.length < 5) {
        return []
      }
      const at = (share: number) => seconds[Math.round((seconds.length - 1) * share)] ?? 0
      return [[path, { low: at(0.25), high: at(0.75) }]]
    })
  )
}

type RawUser = { username: string; name: string; bot: boolean; avatarUrl?: string | null }

/** GitLab gives an uploaded avatar as a path on its own host and a Gravatar one as a full URL. */
const absolute = (url: string | null | undefined): string | null => (url ? (url.startsWith('/') ? `${GITLAB}${url}` : url) : null)

type RawNote = {
  body: string
  system: boolean
  url: string
  createdAt: string
  author: RawUser | null
  position: { filePath: string; newLine: number | null; oldLine: number | null } | null
}

export type RawJob = {
  name: string
  status: string
  allowFailure: boolean
  startedAt: string | null
  finishedAt: string | null
  webPath: string
}

export type RawMr = {
  iid: string
  state: string
  title: string
  webUrl: string
  draft: boolean
  conflicts: boolean
  shouldBeRebased: boolean
  approvalsLeft: number | null
  approvalsRequired: number | null
  detailedMergeStatus?: string | null
  updatedAt: string
  description: string | null
  sourceBranch: string
  targetBranch: string
  author: { username: string } | null
  diffStatsSummary: { additions: number; deletions: number; fileCount: number } | null
  project: { fullPath: string; name: string; webUrl: string }
  approvedBy: { nodes: RawUser[] }
  reviewers: { nodes: (RawUser & { mergeRequestInteraction: { reviewState: string | null } | null })[] }
  headPipeline: {
    id: string
    status: string
    duration: number | null
    startedAt: string | null
    finishedAt: string | null
    path: string
    stages: { nodes: { name: string; status: string; jobs: { nodes: RawJob[] } }[] }
  } | null
  discussions: { nodes: { resolvable: boolean; resolved: boolean; notes: { nodes: RawNote[] } }[] }
}

export type RawResponse = {
  data?: {
    currentUser?: { authoredMergeRequests?: { nodes?: (RawMr | null)[] } } | null
    [alias: string]: unknown
  } | null
  errors?: { message: string }[]
}

/** Markdown as GitLab stores it, HTML and all, its links made absolute; markdown.ts makes it drawable. */
export function cleanBody(body: string, project: string): string {
  return body
    .replace(/\]\(\/uploads\//g, `](${GITLAB}/${project}/uploads/`)
    .replace(/\]\(\//g, `](${GITLAB}/`)
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const toNote = (raw: RawNote, project: string, isOpen: boolean): Note => {
  const line = raw.position?.newLine ?? raw.position?.oldLine
  return {
    author: raw.author?.username ?? 'someone',
    body: cleanBody(raw.body, project),
    url: raw.url,
    at: raw.createdAt,
    ...(raw.position ? { where: `${raw.position.filePath}${line ? `:${line}` : ''}` } : {}),
    isOpen,
  }
}

const toJob = (job: RawJob): Job => ({
  name: job.name,
  status: ciStatusOf(job.status),
  allowFailure: job.allowFailure,
  url: `${GITLAB}${job.webPath}`,
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
function toPeople(raw: RawMr, project: string, threads: { isOpen: boolean; notes: RawNote[] }[]): Person[] {
  const author = raw.author?.username
  const byName = new Map<
    string,
    { name: string; isBot: boolean; avatarUrl: string | null; review: ReviewState; isApprover: boolean; openThreads: number; notes: Note[] }
  >()
  const meet = (user: RawUser | null) => {
    if (!user || user.username === author) {
      return undefined
    }
    const avatarUrl = absolute(user.avatarUrl)
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
  raw.reviewers.nodes.forEach(reviewer => {
    const person = meet(reviewer)
    if (person) {
      person.review = reviewStateOf(reviewer.mergeRequestInteraction?.reviewState)
    }
  })
  raw.approvedBy.nodes.forEach(user => {
    const person = meet(user)
    if (person) {
      person.isApprover = true
    }
  })
  threads.forEach(thread =>
    thread.notes.forEach((one, i) => {
      const person = meet(one.author)
      person?.notes.push(toNote(one, project, thread.isOpen))
      if (person && i === 0 && thread.isOpen) {
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
    const notes = [...person.notes].sort((a, b) => Number(b.isOpen) - Number(a.isOpen) || b.at.localeCompare(a.at))
    return {
      username,
      name: person.name,
      isBot: person.isBot,
      initials: initials(person.name, username),
      avatarUrl: person.avatarUrl,
      state,
      openThreads: person.openThreads,
      notes,
    }
  })
  const shared = new Set(people.map(person => person.initials).filter((value, i, all) => all.indexOf(value) !== i))
  const order = (person: Person) =>
    STATE_RANK[person.state === 'requested_changes' || person.openThreads === 0 ? person.state : 'open']
  // Bots leave a summary on nearly every MR; only one holding the merge, by an open thread or asking for changes, is shown.
  return people
    .filter(person => !person.isBot || person.state === 'requested_changes' || person.openThreads > 0)
    .map(person => (shared.has(person.initials) ? { ...person, initials: initials(person.name, person.username, true) } : person))
    .sort((a, b) => Number(a.isBot) - Number(b.isBot) || order(a) - order(b) || a.name.localeCompare(b.name))
}

export function toCard(raw: RawMr): MrCard {
  const project = raw.project.fullPath
  const pipeline = raw.headPipeline
  const isBot = (note: RawNote) => note.author?.bot === true
  const threads = raw.discussions.nodes.flatMap(thread => {
    const notes = thread.notes.nodes.filter(one => !one.system)
    return notes[0] ? [{ isOpen: thread.resolvable && !thread.resolved, notes, first: notes[0] }] : []
  })
  const open = threads.filter(thread => thread.isOpen)
  const reviewers = raw.reviewers.nodes.map(reviewer => ({
    username: reviewer.username,
    isBot: reviewer.bot,
    state: reviewStateOf(reviewer.mergeRequestInteraction?.reviewState),
  }))
  const requested = reviewers.filter(reviewer => reviewer.state === 'requested_changes')
  const jobs = pipeline?.stages.nodes.flatMap(stage => stage.jobs.nodes.map(toJob)) ?? []
  return {
    key: `${project}!${raw.iid}`,
    url: raw.webUrl,
    project,
    repo: { name: raw.project.name, url: raw.project.webUrl },
    iid: Number(raw.iid),
    title: raw.title,
    author: raw.author?.username ?? '',
    description: cleanBody(raw.description ?? '', project),
    branch: { source: raw.sourceBranch, target: raw.targetBranch },
    diff: raw.diffStatsSummary
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
    approvers: raw.approvedBy.nodes.filter(user => !user.bot).map(user => user.username),
    reviewers,
    people: toPeople(raw, project, threads),
    ...(pipeline
      ? {
          pipeline: {
            id: Number(pipeline.id.split('/').pop()),
            status: ciStatusOf(pipeline.status),
            url: `${GITLAB}${pipeline.path}`,
            duration: pipeline.duration,
            startedAt: pipeline.startedAt,
            finishedAt: pipeline.finishedAt,
            stages: pipeline.stages.nodes.map(stage => ({
              name: stage.name,
              status: ciStatusOf(stage.status),
              jobs: stage.jobs.nodes.map(toJob),
            })),
            failed: jobs.filter(job => job.status === 'failed' && !job.allowFailure).map(jobLink),
            amber: jobs.filter(job => job.status === 'failed' && job.allowFailure).map(jobLink),
            blockedOn: jobs.filter(job => job.status === 'manual' && !job.allowFailure).map(job => job.name),
          },
        }
      : {}),
    openThreads: open
      .filter(thread => !isBot(thread.first))
      .map(thread => ({ ...toNote(thread.first, project, true), replies: thread.notes.slice(1).map(one => toNote(one, project, true)) })),
  }
}

/** How many of the authored MRs GitLab sent back null: parts of a heavy query it timed out. */
export const lostIn = (response: RawResponse): number =>
  (response.data?.currentUser?.authoredMergeRequests?.nodes ?? []).filter(node => node === null).length

/**
 * Authored and pinned MRs, each once. A read with no data at all throws; a partial one
 * (a pinned project out of reach) keeps what came back.
 */
export function readResponse(response: RawResponse, pinnedCount: number): MrCard[] {
  if (!response.data) {
    throw new Error(response.errors?.map(error => error.message).join('; ') || 'GitLab sent no data')
  }
  const data = response.data
  const authored = data.currentUser?.authoredMergeRequests?.nodes ?? []
  const pinned = Array.from({ length: pinnedCount }, (_, i) => {
    const project = data[`p${i}`] as { mergeRequest?: RawMr | null } | null | undefined
    return project?.mergeRequest ?? null
  })
  const cards = new Map<string, MrCard>()
  ;[...pinned, ...authored].forEach(raw => {
    if (raw) {
      const card = toCard(raw)
      cards.set(card.key, card)
    }
  })
  return [...cards.values()]
}
