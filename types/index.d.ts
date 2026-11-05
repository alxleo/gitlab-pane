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

/** What happened to an MR that an inbox rule counts; each has its own glyph and word in the pane. */
export type InboxKind =
  | 'changes_requested'
  | 'unapproved'
  | 'approved'
  | 'review'
  | 'comment'
  | 'mentioned'
  | 'review_requested'
  | 'pushed'
  | 'merged'
  | 'build_failed'
  | 'unmergeable'

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
  /** `host/group/project!iid`: unique across hosts. */
  key: string
  url: string
  /** The GitLab host the MR lives on, such as `gitlab.com`. */
  host: string
  /** `group/project` on that host, as GitLab names it. */
  path: string
  /** `host/group/project`: where the MR lives, what the pane groups, filters and keeps run times by. */
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
  host: string
  /** `group/project` on that host. */
  path: string
  iid: number
  /**
   * `raised` when this session created the MR, which alone wakes it; `watched` when pinned with `watch_mr`. A pin kept
   * from before this was recorded has none, and wakes as every pin then did.
   */
  origin?: 'raised' | 'watched'
}

/** What a GitLab host's schema has of the fields that older versions lack, from its first probe. */
export type HostFeatures = {
  /** `MergeRequest.detailedMergeStatus` (GitLab 15.3): without it no card has a merge verdict. */
  hasMergeVerdict: boolean
  /** `UserMergeRequestInteraction.reviewState`: without it a reviewer's state is not known. */
  hasReviewStates: boolean
}

export type Ticket = { type: string; status: string; summary: string }

/** How the last read of one GitLab host went. */
export type HostStatus = {
  /** When the host last answered, or null while it never has. */
  fetchedAt: number | null
  /** Why its last read failed, or null when it went well; the cards of that host shown are then from `fetchedAt`. */
  error: string | null
}

export type PollState = {
  /** When any host last answered. */
  fetchedAt: number | null
  attemptedAt: number | null
  /** The last read's errors together (each host's own is in `hosts`); null when every host answered. */
  error: string | null
  /** Per configured host, how its last read went, so the pane and `watch_mr` tell a stale host from a fresh one. */
  hosts: Record<string, HostStatus>
  failures: number
  /** MRs the last read left out (GitLab timed parts of it out), drawn as the read before saw them. */
  kept?: number
  ticketsAt: number | null
  usualAt: number | null
}

/** One event a rule counted on an MR, as the pane draws it. */
export type InboxActivity = {
  kind: InboxKind
  actor: string
  /** ISO time. */
  at: string
  url: string | null
  excerpt: string
}

/** One MR a rule shows. */
export type InboxItem = {
  /** `host/group/project!iid`, the card key. */
  key: string
  /** The shortest unique `repo!iid`. */
  ref: string
  title: string
  url: string
  author: string
  /** The author's display name; empty when GitLab gives none. */
  authorName: string
  /** You wrote it, so your name says nothing on its card. */
  isMine: boolean
  state: string
  isDraft: boolean
  /** Human activity the rule counts since the MR was last marked seen. */
  unseen: number
  /** The rule's unseen activity by kind, such as `{ approved: 2, comment: 3 }`. */
  counts: Partial<Record<InboxKind, number>>
  /** The newest few events the rule counts, seen or not. */
  activity: InboxActivity[]
}

export type InboxSection = {
  rule: string
  title: string
  items: InboxItem[]
}

/** One thing that happened to an MR, kept compact because the inbox snapshot is stored. */
export type InboxSignal = {
  kind: InboxKind
  actor: string
  /** When it happened, in epoch milliseconds. */
  at: number
  /** The note's id when the event has a comment to link to. */
  note: string | null
  /** The first words of what was written, or empty. */
  excerpt: string
}

/** An MR the inbox read, with the signals the rules may count; the rules decide where it shows. */
export type InboxMr = {
  host: string
  /** `group/project`. */
  path: string
  iid: number
  title: string
  url: string
  author: string
  authorName: string
  isMine: boolean
  state: string
  isDraft: boolean
  /** You are a reviewer of it and have not approved it. */
  inQueue: boolean
  /** Newest first. */
  signals: InboxSignal[]
}

/** How the last read of one host went for the inbox. */
export type InboxHost = {
  /** The signed-in user; null while the host has never answered. */
  user: string | null
  /** Why the read failed in whole or in part, or null. */
  failure: { kind: FailureKind; message: string } | null
}

/**
 * What one read of the configured hosts found, before any rule is applied or any MR marked seen. It is what the reader's
 * leader keeps in the plugin store for the other sessions: at most 50 MRs of 10 signals, under 128 kB as JSON.
 */
export type InboxSnapshot = {
  /** When the read ended, epoch ms; 0 while there has been none. */
  at: number
  hosts: Record<string, InboxHost>
  mrs: InboxMr[]
}

export type InboxState = {
  snapshot: InboxSnapshot
  /** When each MR was marked seen (epoch ms), by the key of its entry in the plugin store. */
  seen: Record<string, number>
  isSyncing: boolean
  readAt: number | null
}

/**
 * Why something failed, decided where it is detected: a tool that is not installed (exit 127), no token for a GitLab
 * host, a token GitLab refused (401, 403), a connection that dropped, a request that ran out of time, an answer that is
 * not what was asked for, a GitLab or its edge that answered with an error, a tool that ran and failed.
 */
export type FailureKind = 'not-installed' | 'no-token' | 'unauthorized' | 'network' | 'timeout' | 'bad-answer' | 'server' | 'failed' | 'unknown'

/** What a background job reports failing, by where it ran. */
export type ProblemSource = 'gitlab' | 'jira' | 'usual' | 'avatars' | 'inbox' | 'pane'

/** The last failure of each source, for `/gitlab` to list; a source that works again has none. */
export type Problems = { [Source in ProblemSource]?: { message: string; kind: FailureKind; at: number } }

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
      /** What GitLab last said, and which MRs are marked seen; the built-in rules turn it into the inbox. */
      inbox: InboxState
      /** The inbox rule drawn open: one at most, as tabs. */
      inboxOpen: string[]
      /** Inbox MRs, by key, opened to their recent activity. */
      inboxCards: string[]
      /** This session's MRs, drawn first and the only ones that wake it. */
      pinned: Pinned[]
      /** The GitLab hosts the settings name, home first. */
      hosts: string[]
      rows: MrCard[]
      /** Jira tickets by key, as acli last read them. */
      tickets: Record<string, Ticket>
      /** Pipeline run times by project, as `host/group/project`. */
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
