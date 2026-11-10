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

/** GitLab's `MergeabilityCheckStatus`, lower case, with `unknown` for a status the pane has no name for. */
export type CheckStatus = 'success' | 'checking' | 'failed' | 'warning' | 'inactive' | 'unknown'

/** One of GitLab's merge checks: `id` is its `MergeabilityCheckIdentifier` (`CI_MUST_PASS`), an identifier GitLab adds later included. */
export type MergeCheck = { id: string; status: CheckStatus }

/** Every merge check GitLab runs on an MR, in its own order, which is the order of its precedence. */
export type MergeStatus = MergeCheck[]

/** What GitLab says of merging an MR, read in the same answer as its merge checks. */
export type Merging = {
  /** The head commit the checks were made on, which a merge names so GitLab merges nothing newer; empty where GitLab gave none. */
  head: string
  isRebasing: boolean
  /** GitLab will merge it once its checks pass. */
  isAutoMerging: boolean
  /** The signed-in user may merge it, and push to its source branch (which a rebase does). */
  canMerge: boolean
  canPush: boolean
}

/** A move the pane can make for an MR, when GitLab's verdict names it: the one thing that moves the MR along. */
export type MoveKind = 'merge' | 'rebase' | 'rebase-merge' | 'conflicts'

/**
 * Something this session set out to write to GitLab, by its id in the ledger (`writes.ts`): armed, waiting for the press
 * that confirms it; sent, while GitLab carries it out; handed on (to Claude), which takes as long as it takes; or failed,
 * with why in a line, said beside it until it is tried again. `on` is what it was confirmed for (a merge's head, a
 * reply's text), so a confirm holds for what the person saw and nothing newer.
 */
export type Write<Kind extends string = string> =
  | { kind: Kind; state: 'armed' | 'sent' | 'handed'; on: string; at: number }
  | { kind: Kind; state: 'failed'; on: string; at: number; say: string }

/** A press this session made on a move, by card key, kept until the MR's head moves (`on`). */
export type Pressed = Write<MoveKind>

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

/** When the jobs of a stage ran, in epoch milliseconds: finished jobs' spans merged into runs, and the start of each job still running. */
export type Ran = { done: [number, number][]; running: number[] }

/**
 * A pipeline stage. `ran` is when its jobs ran, which is all the pane needs of a job that neither failed, runs nor waits
 * on a person; a card shared between sessions keeps `jobs` to those that do.
 */
export type Stage = { name: string; status: CiStatus; jobs: Job[]; ran: Ran }

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
  /**
   * Where a reply to the thread this note opens is posted: the MR's and the thread's GitLab IDs. Read with its MR's page
   * alone, so a card the sessions share never has it.
   */
  answer?: { mr: string; thread: string }
  /** The lines of the diff the thread was left on, ending at the commented line, as a unified-diff hunk; read with the page. */
  excerpt?: { path: string; hunk: string }
}

/**
 * The one reply box open on an MR's page: the thread it answers (by its first note's address; empty while none is open)
 * and the text it opened with. How far the reply got is its entry in the ledger of writes (`Write`).
 */
export type ReplyBox = { thread: string; text: string }

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
  /**
   * Their notes: the unresolved threads they started first, then their other notes in unresolved threads, then the rest,
   * newest first within each. A card shared between sessions keeps the first alone, as an excerpt.
   */
  notes: Note[]
  /** How many notes they wrote on the MR, whatever `notes` holds. */
  noteCount: number
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
  /** Empty on a card shared between sessions, which keeps `lead` and `hasDescription`; the whole text is fetched when the MR's page is opened. */
  description: GitLabMarkdown
  /** The description's first paragraph as one plain line. */
  lead: string
  hasDescription: boolean
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
  /** GitLab's own merge checks, under the project's merge rules; null while they were not read. */
  mergeStatus: MergeStatus | null
  /** What GitLab says of merging it, from the same read as `mergeStatus`; null while that was not read. */
  merging: Merging | null
  approvers: string[]
  reviewers: { username: string; isBot: boolean; state: ReviewState }[]
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
    /** Jobs worth listing that a card shared between sessions leaves out of its stages. */
    moreJobs: number
    /** Failed jobs and allowed-to-fail ones that a shared card leaves out of `failed` and `amber`, which keep the first few. */
    moreFailed: number
    moreAmber: number
  }
  /** The opening note of each unresolved thread a person, not a bot, started; a shared card keeps an excerpt of each and no replies. */
  openThreads: Note[]
  /** Open threads a shared card leaves out of `openThreads`, which keeps the first few: those no person's icon holds, and the rest. */
  threadsLeft: { loose: number; held: number }
  /** Why the MR's page, read whole, could not read where replies go; absent when it could, and on every shared card. */
  repliesOff?: string
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
  /** `MergeRequest.mergeabilityChecks`: without it no card has GitLab's merge checks, and the pane marks conflicts and rebases itself. */
  hasMergeVerdict: boolean
  /** `UserMergeRequestInteraction.reviewState`: without it a reviewer's state is not known. */
  hasReviewStates: boolean
  /** `Todo.targetEntity` (GitLab 17.4): without it the inbox asks for `target`, which GitLab 17.4 deprecated. */
  hasTodoEntity: boolean
  /** `Discussion.truncatedDiffLines`: without it an MR's page draws its threads with no lines of the diff. */
  hasDiffLines: boolean
}

export type Ticket = { type: string; status: string; summary: string }

/** How the last read of one GitLab host went. */
export type HostStatus = {
  /** When the host last answered, or null while it never has. */
  fetchedAt: number | null
  /** Why its last read failed, or null when it went well; the cards of that host shown are then from `fetchedAt`. */
  error: string | null
}

/** What the footer says of the last read: what the pane draws, so it changes only when the footer's words would. */
export type PollState = {
  /** When any host last answered, to the minute the footer counts in. */
  fetchedAt: number | null
  /** The last read's errors together (each host's own is in `hosts`); null when every host answered. */
  error: string | null
  /** Per configured host, how its last read went, so the pane and `watch_mr` tell a stale host from a fresh one. */
  hosts: Record<string, HostStatus>
  /** MRs the last read left out (GitLab timed parts of it out), drawn as the read before saw them. */
  kept?: number
}

/** When this session last read, and what it last read besides GitLab's MRs: nothing the pane draws, so writing it redraws nothing. */
export type ReadClock = {
  attemptedAt: number | null
  /** Reads in a row that failed on every host. */
  failures: number
  ticketsAt: number | null
  usualAt: number | null
  /** The version of the snapshot this session last drew from; empty before the first. */
  adopted: string
  /** How many refresh requests this session has seen the store count. */
  refreshed: number
  /** When this session last read the inbox, or last drew the leader's (the time of the pass, not of what it found). */
  inboxAt: number | null
  /** When the inbox snapshot this session last drew was read. */
  inboxSeen: number | null
}

/** What a session does with GitLab: `leader` reads for all, `follower` draws what the leader read, `wake-only` reads only its raised MRs, `idle` nothing. */
export type Role = 'leader' | 'follower' | 'wake-only' | 'idle'

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
  /** GitLab's latest notes stopped before the last seen mark, so the counts are lower bounds: drawn `30+`. */
  isCapped: boolean
  /** The newest few events the rule counts, seen or not. */
  activity: InboxActivity[]
}

export type InboxSection = {
  rule: string
  title: string
  /** Why the rule shows nothing, such as a host with no token or a session with no repo; null when there is no such reason. */
  note: string | null
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
  /** It is one of the people's or projects' MRs the `inboxFollow` setting names. */
  isFollowed: boolean
  /** When the oldest note read was written if GitLab had older ones it did not send, else null: nothing before it is counted. */
  cutoff: number | null
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

/** A person (`user`, without the `@`) or a project (`project`, `group/project`) the `inboxFollow` setting names. */
export type InboxFollow = { kind: 'user' | 'project'; name: string }

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
export type ProblemSource = 'gitlab' | 'jira' | 'usual' | 'avatars' | 'inbox' | 'pane' | 'store'

/** The last failure of each source, for `/gitlab` to list; a source that works again has none. */
export type Problems = { [Source in ProblemSource]?: { message: string; kind: FailureKind; at: number } }

/** What the person chose in the pane: one value, so a drawing reads it once and a choice that touches two things redraws once. */
export type Choices = {
  /** `drafts` and `more` when those folds of the list are open. */
  expanded: string[]
  /** By the card key of the MR read whole, the one person whose comments its page shows; empty for the whole MR. */
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
    'gitlab-pane': {
      /** What GitLab last said, and which MRs are marked seen; the built-in rules turn it into the inbox. */
      inbox: InboxState
      /** The inbox rule drawn open: one at most, as tabs. */
      inboxOpen: string[]
      /** Whether the inbox shows only the session's own repo. */
      inboxHere: boolean
      /** The people and projects the Following rule lists. */
      inboxFollow: InboxFollow[]
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
      /** Whether this session is reading GitLab now, for the ↻ beside the age of the cards. */
      reading: boolean
      reads: ReadClock
      /** The role the last tick of the lease gave this session. */
      role: Role
      /** MRs opened in the pane, by card key, whole: their description and threads, which the shared cards leave out. */
      details: Record<string, MrCard>
      /** The base of ticket links (`<jiraUrl>/browse/`); empty while no Jira site is set. */
      jira: string
      /** Avatar URLs that failed to fetch, not asked for again until the session loads the mod again. */
      unreachable: string[]
      scrolling: Scrolling
      problems: Problems
      /** What the session that reads GitLab last failed with, as its snapshot says. */
      reported: Problems
      /** Whether a wake quotes the end of a failed job's log: the `failureLogs` setting. */
      logs: boolean
      /** What this session set out to write to GitLab, by id: merges, rebases and hand-offs (`move:<card key>`), replies (`reply:<thread>`). */
      writes: Record<string, Write>
      /** The reply being written on an MR's page, if any. */
      reply: ReplyBox
      /** What was last typed in the reply box of each thread, by its first note's address; no drawing reads it. */
      typed: Record<string, string>
    }
  }
}
