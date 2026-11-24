// The fields of an MR as a card needs them, shared by the list (ask-authored.ts) and one MR (ask-pinned.ts): the GraphQL
// fragments, the shapes GitLab answers them with, and the one place the two variants of an MR's threads become one.
import type {
  CommentFieldsFragment,
  MrFieldsFragment,
  NoteFieldsFragment,
  PipelineFieldsFragment,
  PipelineJobsFragment,
  ReviewerFieldsFragment,
  ReviewerPlainFragment,
  ThreadFieldsFragment,
} from './gitlab.generated'
import { present } from './decode'

/**
 * Every document the pane sends is a static GraphQL text with its values passed as variables, never spliced in. The
 * GraphQL comment before each is how the type generator finds it.
 */
const MR_FRAGMENT = /* GraphQL */ `
  fragment MrFields on MergeRequest {
    iid state title webUrl draft conflicts shouldBeRebased approvalsLeft approvalsRequired updatedAt
    description sourceBranch targetBranch
    author { username }
    diffStatsSummary { additions deletions fileCount }
    project { fullPath name webUrl }
    approvedBy { nodes { username name bot avatarUrl } }
  }
`

// An MR's comments, each with the thread it is in: system notes (pushes, label changes) were four in five of the notes
// and a third of a read's time, and no card shows one. The filter needs GitLab 16.5; an older host gets THREADS_FRAGMENT.
const COMMENTS_FRAGMENT = /* GraphQL */ `
  fragment CommentFields on MergeRequest {
    notes(filter: ONLY_COMMENTS, first: 100) { nodes { ...NoteFields discussion { id resolvable resolved } } }
  }
`

const THREADS_FRAGMENT = /* GraphQL */ `
  fragment ThreadFields on MergeRequest {
    discussions(first: 100) { nodes { resolvable resolved notes(first: 20) { nodes { ...NoteFields } } } }
  }
`

// The list's pipeline is its stages without their jobs: asking every job of every MR was half of a read that timed out.
// `needsJobs` says which MRs' rows draw from their jobs, and those are read one by one with PIPELINE_JOBS_FRAGMENT.
const PIPELINE_FRAGMENT = /* GraphQL */ `
  fragment PipelineFields on Pipeline {
    id status duration startedAt finishedAt path warnings
    stages { nodes { name status } }
  }
`

// Stage jobs leave out retried ones, so a job that failed then passed on retry reads as passed.
const PIPELINE_JOBS_FRAGMENT = /* GraphQL */ `
  fragment PipelineJobs on Pipeline {
    id status duration startedAt finishedAt path warnings
    stages { nodes { name status jobs { nodes { name status allowFailure startedAt finishedAt webPath } } } }
  }
`

// A reviewer's review state needs GitLab 16 or newer; a host without it gets the plain reviewer and the plain documents.
const REVIEWER_FRAGMENT = /* GraphQL */ `
  fragment ReviewerFields on MergeRequestReviewer {
    username name bot avatarUrl mergeRequestInteraction { reviewState }
  }
`

const REVIEWER_PLAIN_FRAGMENT = /* GraphQL */ `
  fragment ReviewerPlain on MergeRequestReviewer {
    username name bot avatarUrl
  }
`

const NOTE_FRAGMENT = /* GraphQL */ `
  fragment NoteFields on Note {
    body system url createdAt
    author { username name bot avatarUrl }
    position { filePath newLine oldLine }
  }
`

/** The MR fragments, in the order a document carries those it uses (`documentOf`). */
export const MR_FRAGMENTS = [
  MR_FRAGMENT,
  COMMENTS_FRAGMENT,
  THREADS_FRAGMENT,
  PIPELINE_FRAGMENT,
  PIPELINE_JOBS_FRAGMENT,
  REVIEWER_FRAGMENT,
  REVIEWER_PLAIN_FRAGMENT,
  NOTE_FRAGMENT,
] as const

/** The nodes of a connection that GitLab sent: it may send none, or null in place of one it timed out. */
export type NodeOf<Connection> = Connection extends { nodes: Array<infer Node> | null } ? NonNullable<Node> : never

// The shapes below are the generated types of the fragments (gitlab.generated.ts), which carry the schema's nullability:
// what the schema lets be null is null here too.
export type RawReviewer = ReviewerFieldsFragment | ReviewerPlainFragment
/** A pipeline read whole, its stages with their jobs, as an MR read on its own gives it. */
export type RawPipeline = PipelineJobsFragment
/** A pipeline as the list gives it: its stages without their jobs. */
export type ListedPipeline = PipelineFieldsFragment
/**
 * An MR as any variant of the documents gives it: its comments with their threads or its threads whole, its pipeline whole
 * or listed, its reviewers with their review state or without.
 */
export type RawMr = MrFieldsFragment &
  (CommentFieldsFragment | ThreadFieldsFragment) & { headPipeline: RawPipeline | ListedPipeline | null; reviewers?: { nodes?: Array<RawReviewer | null> | null } | null }
export type RawNote = NoteFieldsFragment
export type RawUser = NodeOf<RawMr['approvedBy']>
export type RawStage = NodeOf<RawPipeline['stages']>
export type RawJob = NodeOf<RawStage['jobs']>
export type Thread = { isOpen: boolean; notes: RawNote[] }

/**
 * An MR's threads, in the order each began, their system notes left out. Comments come in the order written, each naming
 * its thread, so a thread's notes are those naming it, in that order; the filter that sends them sends no system note.
 */
export function threadsOf(raw: CommentFieldsFragment | ThreadFieldsFragment): Thread[] {
  if ('discussions' in raw) {
    return present(raw.discussions.nodes).map(thread => ({ isOpen: thread.resolvable && !thread.resolved, notes: present(thread.notes.nodes).filter(one => !one.system) }))
  }
  const threads = new Map<string, Thread>()
  present(raw.notes.nodes).forEach(({ discussion, ...one }) => {
    if (discussion === null) {
      return
    }
    const thread = threads.get(discussion.id) ?? { isOpen: discussion.resolvable && !discussion.resolved, notes: [] }
    thread.notes.push(one)
    threads.set(discussion.id, thread)
  })
  return [...threads.values()]
}
