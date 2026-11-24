// The card for an MR, from its fields as any variant of the MR documents gives them (mr-fragments.ts): who to talk to, its
// pipeline, its open threads. The modules that ask GitLab (ask-authored.ts, ask-pinned.ts) hand over the raw MR; this makes
// what the pane draws and keeps of it.
import { isFilled, isSome, present } from './decode'
import { ciStatusOf, reviewStateOf } from './gitlab-status'
import { absoluteUrl, cardKey, projectOf, siteOf } from './hosts'
import { lead, ranOf } from './format'
import { initials } from './identity'
import { fromGitLab } from './markdown'
import { threadsOf } from './mr-fragments'
import type { ListedPipeline, NodeOf, RawJob, RawMr, RawNote, RawReviewer, RawStage, RawUser, Thread } from './mr-fragments'
import { firstDifference } from './order'

import type { GitLabMarkdown, Job, JobLink, MrCard, Note, Person, PersonState, ReviewState } from '../types'

/** A reviewer's review state; a host without the field gives none, which reads as not yet reviewed. */
const reviewOf = (reviewer: RawReviewer): ReviewState => reviewStateOf('mergeRequestInteraction' in reviewer ? reviewer.mergeRequestInteraction?.reviewState : undefined)

/** Markdown as GitLab stores it, HTML and all, its links made absolute; markdown.ts makes it drawable. */
export function cleanBody(body: string, host: string, path: string): GitLabMarkdown {
  const site = siteOf(host)
  return fromGitLab(
    body
      .replace(/\]\(\/uploads\//gu, `](${site}/${path}/uploads/`)
      .replace(/\]\(\//gu, `](${site}/`)
      // From the start of a run of spaces and tabs only, so a run with no line end after it is read once, not once from each.
      .replace(/(?<![ \t])[ \t]+$/gmu, '')
      .replace(/\n{3,}/gu, '\n\n')
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

/** Letters of a description a card keeps as its lead; sessions of an earlier version still read the field. */
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
const isIdenticon = (url: string | null): boolean => url !== null && /[?&]d=identicon\b/u.test(url)

/** Who to talk to, most pressing first: asked for changes, has open threads, approved, then the rest; bots after people. */
function toPeople(raw: RawMr, host: string, path: string, mrUrl: string, threads: Thread[]): Person[] {
  const author = raw.author?.username
  const byName = new Map<string, { name: string; isBot: boolean; avatarUrl: string | null; review: ReviewState; isApprover: boolean; openThreads: number; notes: Note[] }>()
  const meet = (user: RawUser | null) => {
    if (user === null || user.username === author) {
      return undefined
    }
    const avatarUrl = absoluteUrl(host, user.avatarUrl)
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
  // The open threads each person started, which lead their notes: a card quotes the first of them.
  const started = new Set<Note>()
  threads.forEach(thread =>
    thread.notes.forEach((one, i) => {
      const person = meet(one.author)
      const made = toNote(one, host, path, thread.isOpen, mrUrl)
      person?.notes.push(made)
      if (person !== undefined && i === 0 && thread.isOpen) {
        person.openThreads += 1
        started.add(made)
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
    const notes = person.notes.toSorted((a, b) => firstDifference(Number(started.has(b)) - Number(started.has(a)), Number(b.isOpen) - Number(a.isOpen), b.at.localeCompare(a.at)))
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
    .toSorted((a, b) => firstDifference(Number(a.isBot) - Number(b.isBot), order(a) - order(b), a.name.localeCompare(b.name)))
}

/** The card for an MR read from `host`. */
export function toCard(host: string, raw: RawMr): MrCard {
  const path = raw.project.fullPath
  const pipeline = raw.headPipeline
  const mrUrl = raw.webUrl ?? `${siteOf(host)}/${path}/-/merge_requests/${raw.iid}`
  const isBot = (note: RawNote) => note.author?.bot === true
  const threads = threadsOf(raw).flatMap(thread => {
    const [first] = thread.notes
    return first !== undefined ? [{ ...thread, first }] : []
  })
  const open = threads.filter(thread => thread.isOpen)
  const reviewers = present(raw.reviewers?.nodes).map(reviewer => ({
    username: reviewer.username,
    isBot: reviewer.bot,
    state: reviewOf(reviewer),
  }))
  const requested = reviewers.filter(reviewer => reviewer.state === 'requested_changes')
  const pipelineUrl = isFilled(pipeline?.path) ? `${siteOf(host)}${pipeline.path}` : mrUrl
  // A listed pipeline's stages have no jobs: `needsJobs` says when the row draws from them, and they are read one by one.
  const stages = present(pipeline?.stages?.nodes).map((stage: NodeOf<ListedPipeline['stages']> | RawStage) => {
    const stageJobs = 'jobs' in stage ? present(stage.jobs?.nodes).map(job => toJob(host, job, pipelineUrl)) : []
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
    merging: null,
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
