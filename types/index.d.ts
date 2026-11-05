export type JobLink = { name: string; url: string }

/**
 * GitLab's job and pipeline status, lower case. `unknown` is a status GitLab sent that the pane has no name for, kept
 * apart so it is never drawn as one it does.
 */
export type CiStatus =
  | 'created'
  | 'waiting_for_resource'
  | 'preparing'
  | 'waiting_for_callback'
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'canceling'
  | 'canceled'
  | 'skipped'
  | 'manual'
  | 'scheduled'
  | 'unknown'

/** GitLab's `MergeRequestReviewState`, lower case, with `unknown` for a state the pane has no name for. */
export type ReviewState = 'unreviewed' | 'reviewed' | 'requested_changes' | 'approved' | 'unapproved' | 'review_started' | 'unknown'

/** Where a person stands on an MR, worked out from their review state, approval and notes. */
export type PersonState = 'requested_changes' | 'approved' | 'reviewing' | 'commented' | 'unreviewed'

/** GitLab's `DetailedMergeStatus`, with `UNKNOWN` for a verdict the pane has no name for. */
export type MergeStatus =
  | 'UNCHECKED'
  | 'CHECKING'
  | 'MERGEABLE'
  | 'COMMITS_STATUS'
  | 'CI_MUST_PASS'
  | 'CI_STILL_RUNNING'
  | 'DISCUSSIONS_NOT_RESOLVED'
  | 'DRAFT_STATUS'
  | 'NOT_OPEN'
  | 'NOT_APPROVED'
  | 'BLOCKED_STATUS'
  | 'EXTERNAL_STATUS_CHECKS'
  | 'PREPARING'
  | 'JIRA_ASSOCIATION'
  | 'CONFLICT'
  | 'NEED_REBASE'
  | 'APPROVALS_SYNCING'
  | 'LOCKED_PATHS'
  | 'LOCKED_LFS_FILES'
  | 'MERGE_TIME'
  | 'SECURITY_POLICIES_VIOLATIONS'
  | 'TITLE_NOT_MATCHING'
  | 'REQUESTED_CHANGES'
  | 'SECURITY_POLICY_PIPELINE_CHECK'
  | 'UNKNOWN'

/** What `mr-inbox` matched a rule on; `unknown` is a kind the pane has no word for. */
export type InboxKind =
  | 'changes_requested'
  | 'unapproved'
  | 'approved'
  | 'review'
  | 'comment'
  | 'review_requested'
  | 'pushed'
  | 'opened'
  | 'merged'
  | 'unknown'

export type Job = {
  name: string
  status: CiStatus
  allowFailure: boolean
  url: string
  startedAt: string | null
  finishedAt: string | null
}

export type Stage = { name: string; status: CiStatus; jobs: Job[] }

/** Markdown as GitLab sent it for a description or a note: the only text `markdown.ts` reads to draw. Made by `fromGitLab` in `markdown.ts`. */
export type GitLabMarkdown = string & { readonly __brand: 'GitLabMarkdown' }

export type Note = {
  author: string
  /** Markdown, cleaned of HTML and hidden markers. */
  body: GitLabMarkdown
  url: string
  at: string
  /** `path:line` of a note on the diff. */
  where?: string
  /** In a thread still unresolved. */
  isOpen: boolean
  /** The answers under an open thread's opening note, oldest first. */
  replies?: Note[]
}

export type Reviewer = {
  username: string
  isBot: boolean
  state: ReviewState
}

/** Someone other than the author, a bot included, who reviewed or commented. */
export type Person = {
  username: string
  name: string
  /** A bot's threads and request for changes are its icon's, and never make the MR need you now. */
  isBot: boolean
  /** Two or three letters, told apart from anyone else's on the same MR. */
  initials: string
  /** Their GitLab avatar's absolute URL, when they have one; a bot's generated identicon is none. */
  avatarUrl: string | null
  state: PersonState
  /** Threads they started that are still unresolved. */
  openThreads: number
  /** Their notes, those in unresolved threads first, then newest first. */
  notes: Note[]
}

/** One merge request as the pane draws it, from one GraphQL read. */
export type MrCard = {
  /** `group/project!iid`. */
  key: string
  url: string
  project: string
  repo: { name: string; url: string }
  iid: number
  title: string
  author: string
  description: GitLabMarkdown
  branch: { source: string; target: string }
  diff: { additions: number; deletions: number; files: number } | null
  isDraft: boolean
  isOpen: boolean
  updatedAt: string
  hasConflicts: boolean
  needsRebase: boolean
  /** People who requested changes; a bot's request is on its icon in `people`. */
  changesRequestedBy: string[]
  /** Approvals still needed; a bot's approval never counts. */
  approvalsLeft: number
  approvalsRequired: number
  /** GitLab's own verdict, under the project's merge rules; null while it was not read. */
  mergeStatus: MergeStatus | null
  approvers: string[]
  reviewers: Reviewer[]
  people: Person[]
  pipeline?: {
    id: number
    status: CiStatus
    url: string
    /** Seconds GitLab counts as running, once it has settled. */
    duration: number | null
    startedAt: string | null
    finishedAt: string | null
    stages: Stage[]
    /** Failed jobs that may not fail. */
    failed: JobLink[]
    /** Failed jobs allowed to fail: amber, not red. */
    amber: JobLink[]
    /** Manual jobs the pipeline waits on. */
    blockedOn: string[]
  }
  /** The opening note of each unresolved thread a person, not a bot, started. */
  openThreads: Note[]
}

/** How long a successful MR pipeline in a project runs, the middle half of the recent ones, in seconds. */
export type Usual = { low: number; high: number }

export type Pinned = {
  url: string
  project: string
  iid: number
  /**
   * `raised` when this session created the MR, which alone wakes it; `watched` when pinned with `watch_mr`. A pin kept
   * from before this was recorded has none, and wakes as every pin then did.
   */
  origin?: 'raised' | 'watched'
}

export type Ticket = { type: string; status: string; summary: string }

export type PollState = {
  fetchedAt: number | null
  attemptedAt: number | null
  /** The last read's error; the cards shown are then from `fetchedAt`. */
  error: string | null
  failures: number
  /** MRs the last read left out (GitLab timed parts of it out), drawn as the read before saw them. */
  kept?: number
  ticketsAt: number | null
  usualAt: number | null
}

/** One event `mr-inbox` matched a rule on. */
export type InboxActivity = {
  kind: InboxKind
  actor: string
  at: string
  url: string | null
  excerpt: string
}

/** One MR a rule shows, as `mr-inbox inbox --json` gives it. */
export type InboxItem = {
  /** `group/project!iid`, what `mr-inbox seen` takes. */
  key: string
  /** The shortest unique `repo!iid`. */
  ref: string
  title: string
  url: string
  author: string
  /** The author's display name, as mr-inbox gives it; empty when it gives none. */
  authorName: string
  /** You wrote it, so your name says nothing on its card. */
  isMine: boolean
  state: string
  isDraft: boolean
  /** Human activity since the MR was last marked seen. */
  unseen: number
  /** The rule's matching activity by kind, such as `{ approved: 2, comment: 3 }`. */
  counts: Partial<Record<InboxKind, number>>
  activity: InboxActivity[]
}

export type InboxSection = {
  rule: string
  title: string
  /** Why a rule shows nothing, such as needing the session's repo. */
  note: string | null
  items: InboxItem[]
}

export type InboxState = {
  sections: InboxSection[]
  /** When `mr-inbox` last finished a sync, and whether that went well. */
  syncedAt: string | null
  syncError: string | null
  isSyncing: boolean
  readAt: number | null
  /** Why the last read of the inbox failed; the sections are then from an earlier read. */
  error: string | null
}

/** What a background job reports failing, by where it ran. */
export type ProblemSource = 'gitlab' | 'jira' | 'usual' | 'avatars' | 'inbox' | 'pane'

/** Why a source failed, which decides what the pane tells the person to do about it. */
export type FailureKind = 'not-installed' | 'no-token' | 'unauthorized' | 'network' | 'timeout' | 'bad-answer' | 'server'

/** The last failure of each source, for `/gitlab` to list; a source that works again has none. `kind` is absent where the failure was not classified. */
export type Problems = { [Source in ProblemSource]?: { message: string; at: number; kind?: FailureKind } }

/** What the person chose in the pane: one value, so a drawing reads it once and a choice that touches two things redraws once. */
export type Choices = {
  /** Card keys drawn open, `drafts` and `more` when those folds are open. */
  expanded: string[]
  /** Per open card key, the one person whose comments it shows. */
  person: Record<string, string>
  /** `<details>` folds drawn the other way from how GitLab first shows them, as `<card key>#<where>`. */
  folds: string[]
  /** A project path the list is narrowed to; empty shows every repo. */
  repoFilter: string
  /** The pane's open tab: `mine` (the MR list) or `inbox`. */
  tab: string
  /** The card key of the MR read whole on a page of its own, over the open tab; empty when none. */
  reading: string
  /** Whether a pinned MR's news wakes the session. */
  wake: boolean
}

/** Why the pane's last scroll did not move, and how far going back from an MR's page got; `/gitlab` reports both. */
export type Scrolling = { refused: string; goingBack: string }

declare module 'claude-code' {
  interface PluginState {
    'gitlab-ci': {
      /** The rules `mr-inbox` evaluates over its own cache. */
      inbox: InboxState
      /** The inbox rule drawn open: one at most, as tabs. */
      inboxOpen: string[]
      /** Inbox MRs, by key, opened to their recent activity. */
      inboxCards: string[]
      /** This session's MRs, drawn first and the only ones that wake it. */
      pinned: Pinned[]
      rows: MrCard[]
      /** Jira tickets by key, as acli last read them. */
      tickets: Record<string, Ticket>
      /** Pipeline run times by project path. */
      usual: Record<string, Usual>
      /** Small avatar pictures as `data:` URIs, by the avatar URL GitLab gave. */
      avatars: Record<string, string>
      /** What the person chose in the pane. */
      choices: Choices
      /** Per card key, `<pipeline id>:<what>` already announced. */
      announced: Record<string, string[]>
      poll: PollState
      /** The base of ticket links (`<jiraUrl>/browse/`); empty while no Jira site is set. */
      jira: string
      /** Avatar URLs that failed to fetch, not asked for again until the session loads the mod again. */
      unreachable: string[]
      scrolling: Scrolling
      problems: Problems
    }
  }
}
