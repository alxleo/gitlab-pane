import type {
  CiJobStatus,
  MergeabilityCheckIdentifier,
  MergeabilityCheckStatus,
  MergeRequestReviewState,
  MrFieldsFragment,
  PipelineStatusEnum,
  ReviewerFieldsFragment,
} from '../hooks/gitlab.generated.ts'
import type { CheckStatus, MergeStatus } from '../types'
import type { RawJob, RawNote, RawPipeline, RawStage } from '../hooks/gitlab.ts'

/** The host the made-up GitLab answers as, unless a test says another. */
export const HOST = 'gitlab.com'

/** A second host, as a self-managed GitLab. */
export const SELF_MANAGED = 'git.corp.com'

export const NOW = Date.parse('2026-10-23T15:10:00Z')

export const job = (name: string, status: CiJobStatus, over: Partial<RawJob> = {}): RawJob => ({
  name,
  status,
  allowFailure: false,
  startedAt: '2026-10-23T14:50:00Z',
  finishedAt: ['RUNNING', 'MANUAL', 'CREATED'].includes(status) ? null : '2026-10-23T15:00:00Z',
  webPath: `/g/p/-/jobs/${name}`,
  ...over,
})

export const stage = (name: string, status: CiJobStatus, jobs: RawJob[]): RawStage => ({ name, status, jobs: { nodes: jobs } })

/** A pipeline of two stages; a failed one's jobs passed unless `stages` says which failed. */
export const pipe = (status: PipelineStatusEnum, over: Partial<RawPipeline> = {}): RawPipeline => {
  const jobStatus = status === 'FAILED' ? 'SUCCESS' : status
  return {
    id: 'gid://gitlab/Ci::Pipeline/99',
    status,
    duration: status === 'RUNNING' ? null : 597,
    startedAt: '2026-10-23T14:50:00Z',
    finishedAt: status === 'RUNNING' ? null : '2026-10-23T15:00:00Z',
    path: '/g/p/-/pipelines/99',
    stages: {
      nodes: [stage('build', jobStatus, [job('compile', jobStatus)]), stage('test', jobStatus, [job('unit', jobStatus)])],
    },
    ...over,
  }
}

export const project = (fullPath = 'g/p', host = HOST) => ({
  fullPath,
  name: fullPath.split('/').pop() ?? fullPath,
  webUrl: `https://${host}/${fullPath}`,
})

export const user = (username: string, bot = false) => ({
  username,
  name: username
    .split(/[._]/u)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' '),
  bot,
  avatarUrl: `/uploads/-/system/user/avatar/1/${username}.png?v=1`,
})

/** What `curl | base64` prints for a 24-pixel avatar: a PNG's first bytes, padded to a real one's size. */
export const AVATAR_BASE64 = `iVBORw0KGgo${'A'.repeat(1300)}\n`

export type MergeabilityCheck = { identifier: MergeabilityCheckIdentifier; status: MergeabilityCheckStatus }

/** The checks GitLab runs on an MR, in the order it lists them. */
const GITLAB_CHECKS: readonly MergeabilityCheckIdentifier[] = [
  'NOT_OPEN',
  'DRAFT_STATUS',
  'STATUS_CHECKS_MUST_PASS',
  'JIRA_ASSOCIATION_MISSING',
  'MERGE_TIME',
  'MERGE_REQUEST_BLOCKED',
  'REQUESTED_CHANGES',
  'TITLE_REGEX',
  'SECURITY_POLICY_VIOLATIONS',
  'LOCKED_LFS_FILES',
  'DISCUSSIONS_NOT_RESOLVED',
  'CI_MUST_PASS',
  'COMMITS_STATUS',
  'LOCKED_PATHS',
  'NOT_APPROVED',
  'SECURITY_POLICY_PIPELINE_CHECK',
  'NEED_REBASE',
  'CONFLICT',
]

/** GitLab's merge checks for an MR that can merge, with the ones in `over` given the status they name. */
export const checks = (over: Partial<Record<MergeabilityCheckIdentifier, MergeabilityCheckStatus>> = {}): MergeabilityCheck[] =>
  GITLAB_CHECKS.map(identifier => ({ identifier, status: over[identifier] ?? 'SUCCESS' }))

/** GitLab's merge checks as the pane holds them: all pass but the ones named, which take the status given. */
export const gitlabSays = (over: Partial<Record<string, CheckStatus>> = {}): MergeStatus =>
  checks().map(check => ({ id: check.identifier, status: over[check.identifier] ?? 'success' }))

/** An MR as the fake GitLab holds it: what MrFields asks for, and the merge checks that only the MergeStatus query gives. */
export type Mr = MrFieldsFragment & {
  /** The reviewers with their review state, as a current GitLab sends them. */
  reviewers: { nodes: Array<ReviewerFieldsFragment | null> | null } | null
  mergeabilityChecks?: MergeabilityCheck[]
  /** What the MergeStatus query says of merging it, beside its checks; by default its head is `head-<iid>` and the user may merge it. */
  merging?: Partial<{
    diffHeadSha: string | null
    rebaseInProgress: boolean
    autoMergeEnabled: boolean
    userPermissions: { canMerge: boolean; pushToSourceBranch: boolean }
    /** What a fresh read of one MR (`MoveState`) says beside: the last rebase's commit and the last merge error. */
    rebaseCommitSha: string | null
    mergeError: string | null
    /** Whether GitLab will squash it on merging (`squashOnMerge`): the project's rule where it has one, else the MR's own flag. */
    squashOnMerge: boolean
  }>
}

export const rawMr = (iid: number, over: Partial<Mr> = {}): Mr => ({
  iid: String(iid),
  state: 'opened',
  title: `fix: [ABC-1] thing ${iid}`,
  webUrl: `https://gitlab.com/g/p/-/merge_requests/${iid}`,
  draft: false,
  conflicts: false,
  shouldBeRebased: false,
  approvalsLeft: 1,
  approvalsRequired: 1,
  updatedAt: '2026-10-23T15:00:00Z',
  description: `## Summary\n\nDoes thing ${iid}.`,
  sourceBranch: `fix/thing-${iid}`,
  targetBranch: 'main',
  author: { username: 'alex' },
  diffStatsSummary: { additions: 10, deletions: 2, fileCount: 1 },
  project: project(),
  approvedBy: { nodes: [] },
  reviewers: { nodes: [] },
  headPipeline: pipe('SUCCESS'),
  discussions: { nodes: [] },
  ...over,
})

export const note = (body: string, author = 'reviewer', over: Partial<RawNote> = {}): RawNote => ({
  body,
  system: false,
  url: `https://gitlab.com/g/p/-/merge_requests/1#note_${body.length}`,
  createdAt: '2026-10-23T14:00:00Z',
  author: user(author),
  position: { filePath: 'src/a.ts', newLine: 8, oldLine: null },
  ...over,
})

export const thread = (body: string, author = 'reviewer', resolved = false, resolvable = true, bot = false) => ({
  resolvable,
  resolved,
  notes: { nodes: [note(body, author, { author: user(author, bot) })] },
})

export const reviewer = (username: string, reviewState: MergeRequestReviewState, bot = false) => ({
  ...user(username, bot),
  mergeRequestInteraction: { reviewState },
})

/** What the MergeStatus query answers for these MRs: the checks GitLab holds, none for an MR that has none. */
export const mergeStatuses = (mrs: readonly Mr[]) => ({
  data: {
    currentUser: {
      authoredMergeRequests: {
        nodes: mrs.map(mr => ({
          iid: mr.iid,
          project: { fullPath: mr.project.fullPath },
          mergeabilityChecks: mr.mergeabilityChecks ?? [],
          diffHeadSha: mr.merging?.diffHeadSha ?? `head-${mr.iid}`,
          rebaseInProgress: mr.merging?.rebaseInProgress ?? false,
          autoMergeEnabled: mr.merging?.autoMergeEnabled ?? false,
          userPermissions: mr.merging?.userPermissions ?? { canMerge: true, pushToSourceBranch: true },
        })),
      },
    },
  },
})

/** An MR as heavy as the pane meets: nine stages of twenty jobs, five failing, six long threads, three reviewers. */
export const heavyMr = (iid: number, over: Partial<Mr> = {}): Mr =>
  rawMr(iid, {
    description: `## What\n\n${'This change does a careful thing. '.repeat(60)}`,
    headPipeline: pipe('FAILED', {
      stages: {
        nodes: Array.from({ length: 9 }, (_, s) =>
          stage(
            `stage-${s}-with-a-long-name`,
            s === 4 ? 'FAILED' : 'SUCCESS',
            Array.from({ length: 20 }, (_job, j) => job(`job-${s}-${j}-with-a-long-name`, s === 4 && j < 5 ? 'FAILED' : 'SUCCESS'))
          )
        ),
      },
    }),
    reviewers: { nodes: [reviewer('first.reviewer', 'REQUESTED_CHANGES'), reviewer('second.reviewer', 'APPROVED'), reviewer('third.reviewer', 'UNREVIEWED')] },
    discussions: { nodes: Array.from({ length: 6 }, (_, t) => thread(`${'A long comment. '.repeat(40)}${t}`, t % 2 === 1 ? 'first.reviewer' : 'second.reviewer')) },
    ...over,
  })
