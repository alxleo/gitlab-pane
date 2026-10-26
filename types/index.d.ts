export type JobLink = { name: string; url: string }

export type Job = {
  name: string
  /** GitLab's job status, lower case. */
  status: string
  allowFailure: boolean
  url: string
  startedAt: string | null
  finishedAt: string | null
}

export type Stage = { name: string; status: string; jobs: Job[] }

export type Note = {
  author: string
  /** Markdown, cleaned of HTML and hidden markers. */
  body: string
  url: string
  at: string
  /** `path:line` of a note on the diff. */
  where?: string
  /** In a thread still unresolved. */
  isOpen: boolean
}

export type Reviewer = {
  username: string
  isBot: boolean
  /** GitLab's review state, lower case: `unreviewed`, `approved`, `requested_changes`, ... */
  state: string
}

/** Someone other than the author and no bot, who reviewed or commented. */
export type Person = {
  username: string
  name: string
  /** Two or three letters, told apart from anyone else's on the same MR. */
  initials: string
  /** Their GitLab avatar's absolute URL, when they have one. */
  avatarUrl: string | null
  /** `requested_changes`, `approved`, `reviewing`, `commented` or `unreviewed`. */
  state: string
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
  description: string
  branch: { source: string; target: string }
  diff: { additions: number; deletions: number; files: number } | null
  isDraft: boolean
  isOpen: boolean
  updatedAt: string
  hasConflicts: boolean
  needsRebase: boolean
  /** People who requested changes; a bot's request is in `bots`. */
  changesRequestedBy: string[]
  /** Approvals still needed; a bot's approval never counts. */
  approvalsLeft: number
  approvalsRequired: number
  approvers: string[]
  reviewers: Reviewer[]
  people: Person[]
  pipeline?: {
    id: number
    status: string
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
  /** The opening note of each unresolved thread a person started. */
  openThreads: Note[]
  /** What bots hold the merge on; their threads keep who and where, never the body. */
  bots: { threads: Note[]; changesBy: string[] }
}

/** How long a successful MR pipeline in a project runs, the middle half of the recent ones, in seconds. */
export type Usual = { low: number; high: number }

export type Pinned = { url: string; project: string; iid: number }

export type Ticket = { type: string; status: string; summary: string }

export type PollState = {
  fetchedAt: number | null
  attemptedAt: number | null
  /** The last read's error; the cards shown are then from `fetchedAt`. */
  error: string | null
  failures: number
  ticketsAt: number | null
  usualAt: number | null
}

/** One event `mr-inbox` matched a rule on. */
export type InboxActivity = {
  /** `comment`, `review`, `approved`, `unapproved`, `changes_requested`, `merged`, `opened`, ... */
  kind: string
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
  /** Alex wrote it, so his name says nothing on its card. */
  isMine: boolean
  state: string
  isDraft: boolean
  /** Human activity since the MR was last marked seen. */
  unseen: number
  /** The rule's matching activity by kind, such as `{ approved: 2, comment: 3 }`. */
  counts: Record<string, number>
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
      /** Jira tickets by key, as glean last read them. */
      tickets: Record<string, Ticket>
      /** Pipeline run times by project path. */
      usual: Record<string, Usual>
      /** Small avatar pictures as `data:` URIs, by the avatar URL GitLab gave. */
      avatars: Record<string, string>
      /** Card keys drawn open, `drafts` and `more` when those folds are open. */
      expanded: string[]
      /** Per open card key, the one person whose comments it shows. */
      person: Record<string, string>
      /** A project path the list is narrowed to; empty shows every repo. */
      repoFilter: string
      /** The pane's open tab: `mine` (the MR list) or `inbox`. */
      tab: string
      /** Per card key, `<pipeline id>:<what>` already announced. */
      announced: Record<string, string[]>
      wake: boolean
      poll: PollState
    }
  }
}
