import type {
  CiJobStatus,
  MergeabilityCheckIdentifier,
  MergeabilityCheckStatus,
  MergeRequestReviewState,
  MrFieldsFragment,
  PipelineStatusEnum,
  ReviewerFieldsFragment,
  ThreadFieldsFragment,
  CommentFieldsFragment,
} from '../hooks/gitlab.generated'
import type { CheckStatus, MergeStatus } from '../types'
import { present } from '../hooks/decode'
import type { ListedPipeline, RawJob, RawNote, RawPipeline, RawStage } from '../hooks/mr-fragments'

/** An element of a drawn tree, as far as `unhinted` reads one. */
type DrawnNode = { type?: unknown; props?: Record<string, unknown>; hover?: unknown; children?: unknown[] }

const isNode = (node: unknown): node is DrawnNode => typeof node === 'object' && node !== null && (!('children' in node) || Array.isArray(node.children))

/** A Box's hover, as far as these read one: the group it joins, and whether the group reveals it. */
const hoverOf = (node: DrawnNode): { scope: string; reveals: boolean } | null => {
  // A drawn element keeps its hover beside its props.
  const { hover } = node
  return node.type === 'Box' && typeof hover === 'object' && hover !== null && 'scope' in hover && typeof hover.scope === 'string'
    ? { scope: hover.scope, reveals: 'display' in hover && hover.display === 'flex' }
    : null
}

/**
 * The descriptions drawn under `node`, a list of lines each, read from the region that waits to show them (`hint-wait.tsx`),
 * with its key and the hover group that reveals it: what a pointer resting on each symbol of that group would show.
 */
export const hintsIn = (node: unknown, scope = ''): { key: string; scope: string; lines: string[] }[] => {
  if (!isNode(node)) {
    return []
  }
  const hover = hoverOf(node)
  const within = hover?.reveals === true ? hover.scope : scope
  const props = node.props?.['props']
  const lines = typeof props === 'object' && props !== null && 'lines' in props && Array.isArray(props.lines) ? props.lines.map(String) : []
  // A drawn region names its module by its path in the mod.
  const here = node.type === 'Client' && node.props?.['module'] === 'hooks/hint-wait.tsx' ? [{ key: String(node.props['key']), scope: within, lines }] : []
  return [...here, ...(node.children ?? []).flatMap(child => hintsIn(child, within))]
}

/** The symbols under `node`, each its box's key and the group it joins: a Box whose hover tints it and names a group. */
export const symbolsIn = (node: unknown): { key: string; scope: string }[] => {
  if (!isNode(node)) {
    return []
  }
  const hover = hoverOf(node)
  const key = node.props?.['key']
  return [...(hover !== null && !hover.reveals ? [{ key: String(key), scope: hover.scope }] : []), ...(node.children ?? []).flatMap(symbolsIn)]
}

/**
 * What the symbol in the box keyed `key` (`hint-…`) says once the pointer rests on it, read from `tree`: the description its
 * hover group reveals in the line under its block. A found element carries no hover, so the box is looked up by its key.
 */
export const saysOf = (tree: unknown, key: string | undefined): string[] => {
  const group = symbolsIn(tree).find(symbol => symbol.key === key)?.scope
  return hintsIn(tree)
    .filter(hint => group !== undefined && hint.scope === group)
    .flatMap(hint => hint.lines)
}

/**
 * The symbols a desktop drawing shows without a description to say what they mean: a picture, any link (each says what it
 * opens), or a label of symbols and digits alone (`☆`, `○`, `✓1`), anywhere but inside a box whose hover group reveals
 * exactly one description in `tree`; every group revealing more than one; and every block whose line of descriptions has
 * no margin under it to lie over. Every symbol says what it means once the pointer rests, in a blank row, so this is empty
 * on every desktop view; a symbol drawn some new way shows up here.
 */
export const unhinted = (tree: unknown): string[] => {
  const counts = new Map<string, number>()
  for (const hint of hintsIn(tree)) {
    counts.set(hint.scope, (counts.get(hint.scope) ?? 0) + 1)
  }
  const walk = (node: unknown, isHinted: boolean): string[] => {
    if (!isNode(node)) {
      return []
    }
    const hover = hoverOf(node)
    // A description's own box draws no symbol, and a symbol's group must reveal one description.
    if (hover?.reveals === true) {
      return []
    }
    const here = isHinted || (hover !== null && counts.get(hover.scope) === 1)
    const text = [...(node.children ?? []), node.props?.['label']].filter((part): part is string => typeof part === 'string').join('')
    const isSymbol = node.type === 'Svg' || node.type === 'Link' || ((node.type === 'Text' || node.type === 'Button') && text.trim() !== '' && !/\p{L}/u.test(text))
    const said = node.type === 'Svg' ? String(node.props?.['alt']) : text
    // A block's line of descriptions lies over the blank row under it, which its own margin and its column's gap make: a
    // block with none would have its descriptions drawn over what follows it.
    const holdsLine = (node.children ?? []).some(child => isNode(child) && child.props?.['position'] === 'absolute' && child.props['bottom'] === -1)
    const isCramped = holdsLine && Number(node.props?.['marginBottom'] ?? 0) < 1
    return [
      ...(isSymbol && !here ? [`${String(node.type)} ${said}`] : []),
      ...(isCramped ? [`${String(node.props?.['key'] ?? node.type)} keeps no room under it for what its symbols say`] : []),
      ...(node.children ?? []).flatMap(child => walk(child, here)),
    ]
  }
  const twice = [...counts].filter(([, count]) => count > 1).map(([scope]) => `${scope} reveals ${counts.get(scope)} descriptions`)
  return [...walk(tree, false), ...twice]
}

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
    warnings: false,
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

/**
 * An MR as the fake GitLab holds it: what MrFields asks for, its whole pipeline and its threads, and the merge checks that
 * only the MergeStatus query gives. `listed` and `commented` give it as each document asks for it.
 */
export type Mr = MrFieldsFragment & {
  headPipeline: RawPipeline | null
  discussions: ThreadFieldsFragment['discussions']
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

/** The MR as a list read gives it: its pipeline's stages without their jobs. */
export const listed = <Read extends { headPipeline: RawPipeline | null }>(mr: Read): Omit<Read, 'headPipeline'> & { headPipeline: ListedPipeline | null } => ({
  ...mr,
  headPipeline:
    mr.headPipeline === null
      ? null
      : { ...mr.headPipeline, stages: { nodes: (mr.headPipeline.stages?.nodes ?? []).map(one => (one === null ? null : { name: one.name, status: one.status })) } },
})

/**
 * The MR as a GitLab with the comment filter sends it: its comments in the order written, each with the thread it is in,
 * in place of the threads; no system note.
 */
export const commented = <Read extends { discussions: ThreadFieldsFragment['discussions'] }>(mr: Read): Omit<Read, 'discussions'> & CommentFieldsFragment => {
  const { discussions, ...rest } = mr
  const notes = (discussions.nodes ?? []).flatMap((thread, i) =>
    thread === null
      ? []
      : present(thread.notes.nodes)
          .filter(one => !one.system)
          .map(one => ({ ...one, discussion: { id: `gid://gitlab/Discussion/${i}`, resolvable: thread.resolvable, resolved: thread.resolved } }))
  )
  return { ...rest, notes: { nodes: notes.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt)) } }
}

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
