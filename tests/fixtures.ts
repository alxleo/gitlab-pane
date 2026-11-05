import type { CiJobStatus, DetailedMergeStatus, MergeRequestReviewState, MrFieldsFragment, PipelineStatusEnum, ReviewerFieldsFragment } from '../hooks/gitlab.generated.ts'
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
    .split(/[._]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' '),
  bot,
  avatarUrl: `/uploads/-/system/user/avatar/1/${username}.png?v=1`,
})

/** What `curl | base64` prints for a 24-pixel avatar: a PNG's first bytes, padded to a real one's size. */
export const AVATAR_BASE64 = `iVBORw0KGgo${'A'.repeat(1300)}\n`

/** An MR as the fake GitLab holds it: what MrFields asks for, and the merge verdict that only the MergeStatus query gives. */
export type Mr = MrFieldsFragment & {
  /** The reviewers with their review state, as a current GitLab sends them. */
  reviewers: { nodes: Array<ReviewerFieldsFragment | null> | null } | null
  detailedMergeStatus?: DetailedMergeStatus | null
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

/** What the MergeStatus query answers for these MRs: the verdict GitLab holds, null for one that has none. */
export const mergeStatuses = (mrs: readonly Mr[]) => ({
  data: {
    currentUser: {
      authoredMergeRequests: {
        nodes: mrs.map(mr => ({ iid: mr.iid, project: { fullPath: mr.project.fullPath }, detailedMergeStatus: mr.detailedMergeStatus ?? null })),
      },
    },
  },
})
