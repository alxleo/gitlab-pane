import type { AuthoredQuery, AuthoredQueryVariables, MergeStatusQuery, MrFieldsFragment, NoteFieldsFragment, PinnedQuery, PinnedQueryVariables, UsualQuery, UsualQueryVariables } from './gitlab.generated.ts'
import { isFilled, isSome } from './decode.ts'
import { ciStatusOf, mergeStatusOf, reviewStateOf } from './gitlab-status.ts'
import { initials } from './identity.ts'
import { firstDifference } from './order.ts'

import type { CiStatus, Job, JobLink, MergeStatus, MrCard, Note, Person, PersonState, Pinned, ReviewState, Usual } from '../types'

const GITLAB = 'https://gitlab.com'

/**
 * Every document the pane sends is a static GraphQL text with its values passed as variables, never spliced in. The
 * GraphQL comment before each is how the type generator finds it. A document names the fragments it uses and only
 * those, as GitLab refuses an unused one.
 */
const NOTE_FRAGMENT = /* GraphQL */ `
  fragment NoteFields on Note {
    body system url createdAt
    author { username name bot avatarUrl }
    position { filePath newLine oldLine }
  }
`

// Stage jobs leave out retried ones, so a job that failed then passed on retry reads as passed.
const MR_FRAGMENT = /* GraphQL */ `
  fragment MrFields on MergeRequest {
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
    discussions(first: 100) { nodes { resolvable resolved notes(first: 20) { nodes { ...NoteFields } } } }
  }
`

const AUTHORED = /* GraphQL */ `
  query Authored {
    currentUser { authoredMergeRequests(state: opened, first: 50, sort: UPDATED_DESC) { nodes { ...MrFields } } }
  }
`

const MERGE_STATUS = /* GraphQL */ `
  query MergeStatus {
    currentUser { authoredMergeRequests(state: opened, first: 50, sort: UPDATED_DESC) { nodes { iid project { fullPath } detailedMergeStatus } } }
  }
`

const PINNED = /* GraphQL */ `
  query Pinned($path: ID!, $iid: String!) {
    project(fullPath: $path) { mergeRequest(iid: $iid) { ...MrFields } }
  }
`

const USUAL = /* GraphQL */ `
  query Usual($path: ID!) {
    project(fullPath: $path) { pipelines(source: "merge_request_event", status: SUCCESS, first: 20) { nodes { duration } } }
  }
`

/**
 * A document and its variables, and (in the type alone, never set) what GitLab answers it with. `glab` sends the
 * variables as strings (`-f`, as `-F` would turn `12` into a number).
 */
export type Request<Data> = { query: string; variables: Record<string, string>; readonly answer?: Data }

/** `glab api graphql`'s answer to a document: its data, or none, and the errors beside either. */
export type RawResponse<Data> = { data?: Data | null; errors?: { message: string }[] }

/** The operations the pane sends, by name, with what each takes and answers: the fakes in the tests key on this. */
export type Operations = {
  Authored: { variables: AuthoredQueryVariables; data: AuthoredQuery }
  MergeStatus: { variables: Record<string, never>; data: MergeStatusQuery }
  Pinned: { variables: PinnedQueryVariables; data: PinnedQuery }
  Usual: { variables: UsualQueryVariables; data: UsualQuery }
}

/** The text sent for each document, by operation name, for tools/gitlab_schema.py to check against GitLab's schema. */
export const DOCUMENTS = {
  Authored: AUTHORED + MR_FRAGMENT + NOTE_FRAGMENT,
  MergeStatus: MERGE_STATUS,
  Pinned: PINNED + MR_FRAGMENT + NOTE_FRAGMENT,
  Usual: USUAL,
} as const

/** Every open MR the user authored; GitLab scores it 158 of the 250 a query may cost. */
export const authoredQuery = (): Request<AuthoredQuery> => ({ query: DOCUMENTS.Authored, variables: {} })

/**
 * GitLab's merge verdict for the same MRs, asked on its own: inside the authored query it answered CONFLICT, twice in a
 * row, for MRs that this query and each MR's own lookup called MERGEABLE.
 */
export const mergeStatusQuery = (): Request<MergeStatusQuery> => ({ query: DOCUMENTS.MergeStatus, variables: {} })

/** Each MR's verdict by card key; an MR missing from the answer has none. */
export function readMergeStatus(response: RawResponse<MergeStatusQuery>): Map<string, MergeStatus> {
  const nodes = response.data?.currentUser?.authoredMergeRequests?.nodes ?? []
  return new Map(
    nodes.flatMap(node =>
      isFilled(node?.detailedMergeStatus) ? [[`${node.project.fullPath}!${node.iid}`, mergeStatusOf(node.detailedMergeStatus)] as const] : []
    )
  )
}

/**
 * A pinned MR the authored list lacks (someone else's, or merged), one query each. It costs about 103 of the 250 a query
 * may, so two would fit, but one per query needs no aliases that change with how many are pinned, and a project out of
 * reach loses its own MR and no other.
 */
export const pinnedQuery = (pin: Pinned): Request<PinnedQuery> => ({
  query: DOCUMENTS.Pinned,
  variables: { path: pin.project, iid: String(pin.iid) } satisfies PinnedQueryVariables,
})

/** The recent successful MR pipelines of a project, for how long one usually runs; it costs 11, so one query each is cheap. */
export const usualQuery = (project: string): Request<UsualQuery> => ({ query: DOCUMENTS.Usual, variables: { path: project } satisfies UsualQueryVariables })

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
const present = <T>(nodes: readonly (T | null)[] | null | undefined): T[] => (nodes ?? []).filter((node): node is T => node !== null)

type NodeOf<Connection> = Connection extends { nodes: Array<infer Node> | null } ? NonNullable<Node> : never

// The shapes below are the generated types of MrFields and NoteFields (gitlab.generated.ts), which carry the schema's
// nullability: what the schema lets be null is null here too.
export type RawMr = MrFieldsFragment
export type RawNote = NoteFieldsFragment
type RawUser = NodeOf<RawMr['approvedBy']>
type RawReviewer = NodeOf<RawMr['reviewers']>
export type RawPipeline = NonNullable<RawMr['headPipeline']>
export type RawStage = NodeOf<RawPipeline['stages']>
export type RawJob = NodeOf<RawStage['jobs']>

/** GitLab gives an uploaded avatar as a path on its own host and a Gravatar one as a full URL. */
const absolute = (url: string | null | undefined): string | null => (isFilled(url) ? (url.startsWith('/') ? `${GITLAB}${url}` : url) : null)

/** Markdown as GitLab stores it, HTML and all, its links made absolute; markdown.ts makes it drawable. */
export function cleanBody(body: string, project: string): string {
  return body
    .replace(/\]\(\/uploads\//g, `](${GITLAB}/${project}/uploads/`)
    .replace(/\]\(\//g, `](${GITLAB}/`)
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** A note without an address of its own links to its MR. */
const toNote = (raw: RawNote, project: string, isOpen: boolean, mrUrl: string): Note => {
  const line = raw.position?.newLine ?? raw.position?.oldLine
  return {
    author: raw.author?.username ?? 'someone',
    body: cleanBody(raw.body, project),
    url: raw.url ?? mrUrl,
    at: raw.createdAt,
    ...(isSome(raw.position) ? { where: `${raw.position.filePath}${(line ?? 0) > 0 ? `:${line}` : ''}` } : {}),
    isOpen,
  }
}

const UNNAMED = '(unnamed)'

/** A job without a path of its own links to its pipeline. */
const toJob = (job: RawJob, pipelineUrl: string): Job => ({
  name: job.name ?? UNNAMED,
  status: ciStatusOf(job.status ?? ''),
  allowFailure: job.allowFailure,
  url: isFilled(job.webPath) ? `${GITLAB}${job.webPath}` : pipelineUrl,
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
function toPeople(raw: RawMr, project: string, mrUrl: string, threads: { isOpen: boolean; notes: RawNote[] }[]): Person[] {
  const author = raw.author?.username
  const byName = new Map<
    string,
    { name: string; isBot: boolean; avatarUrl: string | null; review: ReviewState; isApprover: boolean; openThreads: number; notes: Note[] }
  >()
  const meet = (user: RawUser | null) => {
    if (user === null || user.username === author) {
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
  present(raw.reviewers?.nodes).forEach((reviewer: RawReviewer) => {
    const person = meet(reviewer)
    if (person !== undefined) {
      person.review = reviewStateOf(reviewer.mergeRequestInteraction?.reviewState)
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
      person?.notes.push(toNote(one, project, thread.isOpen, mrUrl))
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
    }
  })
  const shared = new Set(people.map(person => person.initials).filter((value, i, all) => all.indexOf(value) !== i))
  const order = (person: Person) =>
    STATE_RANK[person.state === 'requested_changes' || person.openThreads === 0 ? person.state : 'open']
  // Bots leave a summary on nearly every MR; only one holding the merge, by an open thread or asking for changes, is shown.
  return people
    .filter(person => !person.isBot || person.state === 'requested_changes' || person.openThreads > 0)
    .map(person => (shared.has(person.initials) ? { ...person, initials: initials(person.name, person.username, true) } : person))
    .sort((a, b) => firstDifference(Number(a.isBot) - Number(b.isBot), order(a) - order(b), a.name.localeCompare(b.name)))
}

export function toCard(raw: RawMr): MrCard {
  const project = raw.project.fullPath
  const pipeline = raw.headPipeline
  const mrUrl = raw.webUrl ?? `${GITLAB}/${project}/-/merge_requests/${raw.iid}`
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
    state: reviewStateOf(reviewer.mergeRequestInteraction?.reviewState),
  }))
  const requested = reviewers.filter(reviewer => reviewer.state === 'requested_changes')
  const pipelineUrl = isFilled(pipeline?.path) ? `${GITLAB}${pipeline.path}` : mrUrl
  const stages = present(pipeline?.stages?.nodes).map(stage => ({
    name: stage.name ?? UNNAMED,
    status: ciStatusOf(stage.status ?? ''),
    jobs: present(stage.jobs?.nodes).map(job => toJob(job, pipelineUrl)),
  }))
  const jobs = stages.flatMap(stage => stage.jobs)
  return {
    key: `${project}!${raw.iid}`,
    url: mrUrl,
    project,
    repo: { name: raw.project.name, url: raw.project.webUrl ?? `${GITLAB}/${project}` },
    iid: Number(raw.iid),
    title: raw.title,
    author: raw.author?.username ?? '',
    description: cleanBody(raw.description ?? '', project),
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
    approvers: present(raw.approvedBy?.nodes).filter(user => !user.bot).map(user => user.username),
    reviewers,
    people: toPeople(raw, project, mrUrl, threads),
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
          },
        }
      : {}),
    openThreads: open
      .filter(thread => !isBot(thread.first))
      .map(thread => ({
        ...toNote(thread.first, project, true, mrUrl),
        replies: thread.notes.slice(1).map(one => toNote(one, project, true, mrUrl)),
      })),
  }
}

/** How many of the authored MRs GitLab sent back null: parts of a heavy query it timed out. */
export const lostIn = (response: RawResponse<AuthoredQuery>): number =>
  (response.data?.currentUser?.authoredMergeRequests?.nodes ?? []).filter(node => node === null).length

const dataOf = <Data>(response: RawResponse<Data>): Data => {
  const { data } = response
  if (!isSome(data)) {
    const reason = (response.errors ?? []).map(error => error.message).join('; ')
    throw new Error(reason === '' ? 'GitLab sent no data' : reason)
  }
  return data
}

/** The authored MRs as cards. A read with no data at all throws; a partial one keeps what came back. */
export const readResponse = (response: RawResponse<AuthoredQuery>): MrCard[] =>
  present(dataOf(response).currentUser?.authoredMergeRequests?.nodes).map(toCard)

/** The one pinned MR as a card, or none when GitLab named no such MR or project (out of reach). */
export const readPinned = (response: RawResponse<PinnedQuery>): MrCard[] => {
  const raw = dataOf(response).project?.mergeRequest
  return isSome(raw) ? [toCard(raw)] : []
}
