/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
export type CiJobStatus =
  | 'CANCELED'
  | 'CANCELING'
  | 'CREATED'
  | 'FAILED'
  | 'MANUAL'
  | 'PENDING'
  | 'PREPARING'
  | 'RUNNING'
  | 'SCHEDULED'
  | 'SKIPPED'
  | 'SUCCESS'
  | 'WAITING_FOR_CALLBACK'
  | 'WAITING_FOR_RESOURCE';

export type DetailedMergeStatus =
  | 'APPROVALS_SYNCING'
  | 'BLOCKED_STATUS'
  | 'CHECKING'
  | 'CI_MUST_PASS'
  | 'CI_STILL_RUNNING'
  | 'COMMITS_STATUS'
  | 'CONFLICT'
  | 'DISCUSSIONS_NOT_RESOLVED'
  | 'DRAFT_STATUS'
  | 'EXTERNAL_STATUS_CHECKS'
  | 'JIRA_ASSOCIATION'
  | 'LOCKED_LFS_FILES'
  | 'LOCKED_PATHS'
  | 'MERGEABLE'
  | 'MERGE_TIME'
  | 'NEED_REBASE'
  | 'NOT_APPROVED'
  | 'NOT_OPEN'
  | 'PREPARING'
  | 'REQUESTED_CHANGES'
  | 'SECURITY_POLICIES_VIOLATIONS'
  | 'SECURITY_POLICY_PIPELINE_CHECK'
  | 'TITLE_NOT_MATCHING'
  | 'UNCHECKED';

export type MergeRequestReviewState =
  | 'APPROVED'
  | 'REQUESTED_CHANGES'
  | 'REVIEWED'
  | 'REVIEW_STARTED'
  | 'UNAPPROVED'
  | 'UNREVIEWED';

export type MergeRequestState =
  | 'all'
  | 'closed'
  | 'locked'
  | 'merged'
  | 'opened';

export type PipelineStatusEnum =
  | 'CANCELED'
  | 'CANCELING'
  | 'CREATED'
  | 'FAILED'
  | 'MANUAL'
  | 'PENDING'
  | 'PREPARING'
  | 'RUNNING'
  | 'SCHEDULED'
  | 'SKIPPED'
  | 'SUCCESS'
  | 'WAITING_FOR_CALLBACK'
  | 'WAITING_FOR_RESOURCE';

export type NoteFieldsFragment = { body: string, system: boolean, url: string | null, createdAt: string, author: { username: string, name: string, bot: boolean, avatarUrl: string | null } | null, position: { filePath: string, newLine: number | null, oldLine: number | null } | null };

export type MrFieldsFragment = { iid: string, state: MergeRequestState, title: string, webUrl: string | null, draft: boolean, conflicts: boolean, shouldBeRebased: boolean, approvalsLeft: number | null, approvalsRequired: number | null, updatedAt: string, description: string | null, sourceBranch: string, targetBranch: string, author: { username: string } | null, diffStatsSummary: { additions: number, deletions: number, fileCount: number } | null, project: { fullPath: string, name: string, webUrl: string | null }, approvedBy: { nodes: Array<{ username: string, name: string, bot: boolean, avatarUrl: string | null } | null> | null } | null, reviewers: { nodes: Array<{ username: string, name: string, bot: boolean, avatarUrl: string | null, mergeRequestInteraction: { reviewState: MergeRequestReviewState | null } | null } | null> | null } | null, headPipeline: { id: string, status: PipelineStatusEnum, duration: number | null, startedAt: string | null, finishedAt: string | null, path: string | null, stages: { nodes: Array<{ name: string | null, status: string | null, jobs: { nodes: Array<{ name: string | null, status: CiJobStatus | null, allowFailure: boolean, startedAt: string | null, finishedAt: string | null, webPath: string | null } | null> | null } | null } | null> | null } | null } | null, discussions: { nodes: Array<{ resolvable: boolean, resolved: boolean, notes: { nodes: Array<{ body: string, system: boolean, url: string | null, createdAt: string, author: { username: string, name: string, bot: boolean, avatarUrl: string | null } | null, position: { filePath: string, newLine: number | null, oldLine: number | null } | null } | null> | null } } | null> | null } };

export type AuthoredQueryVariables = Exact<{ [key: string]: never; }>;


export type AuthoredQuery = { currentUser: { authoredMergeRequests: { nodes: Array<{ iid: string, state: MergeRequestState, title: string, webUrl: string | null, draft: boolean, conflicts: boolean, shouldBeRebased: boolean, approvalsLeft: number | null, approvalsRequired: number | null, updatedAt: string, description: string | null, sourceBranch: string, targetBranch: string, author: { username: string } | null, diffStatsSummary: { additions: number, deletions: number, fileCount: number } | null, project: { fullPath: string, name: string, webUrl: string | null }, approvedBy: { nodes: Array<{ username: string, name: string, bot: boolean, avatarUrl: string | null } | null> | null } | null, reviewers: { nodes: Array<{ username: string, name: string, bot: boolean, avatarUrl: string | null, mergeRequestInteraction: { reviewState: MergeRequestReviewState | null } | null } | null> | null } | null, headPipeline: { id: string, status: PipelineStatusEnum, duration: number | null, startedAt: string | null, finishedAt: string | null, path: string | null, stages: { nodes: Array<{ name: string | null, status: string | null, jobs: { nodes: Array<{ name: string | null, status: CiJobStatus | null, allowFailure: boolean, startedAt: string | null, finishedAt: string | null, webPath: string | null } | null> | null } | null } | null> | null } | null } | null, discussions: { nodes: Array<{ resolvable: boolean, resolved: boolean, notes: { nodes: Array<{ body: string, system: boolean, url: string | null, createdAt: string, author: { username: string, name: string, bot: boolean, avatarUrl: string | null } | null, position: { filePath: string, newLine: number | null, oldLine: number | null } | null } | null> | null } } | null> | null } } | null> | null } | null } | null };

export type MergeStatusQueryVariables = Exact<{ [key: string]: never; }>;


export type MergeStatusQuery = { currentUser: { authoredMergeRequests: { nodes: Array<{ iid: string, detailedMergeStatus: DetailedMergeStatus | null, project: { fullPath: string } } | null> | null } | null } | null };

export type PinnedQueryVariables = Exact<{
  path: string;
  iid: string;
}>;


export type PinnedQuery = { project: { mergeRequest: { iid: string, state: MergeRequestState, title: string, webUrl: string | null, draft: boolean, conflicts: boolean, shouldBeRebased: boolean, approvalsLeft: number | null, approvalsRequired: number | null, updatedAt: string, description: string | null, sourceBranch: string, targetBranch: string, author: { username: string } | null, diffStatsSummary: { additions: number, deletions: number, fileCount: number } | null, project: { fullPath: string, name: string, webUrl: string | null }, approvedBy: { nodes: Array<{ username: string, name: string, bot: boolean, avatarUrl: string | null } | null> | null } | null, reviewers: { nodes: Array<{ username: string, name: string, bot: boolean, avatarUrl: string | null, mergeRequestInteraction: { reviewState: MergeRequestReviewState | null } | null } | null> | null } | null, headPipeline: { id: string, status: PipelineStatusEnum, duration: number | null, startedAt: string | null, finishedAt: string | null, path: string | null, stages: { nodes: Array<{ name: string | null, status: string | null, jobs: { nodes: Array<{ name: string | null, status: CiJobStatus | null, allowFailure: boolean, startedAt: string | null, finishedAt: string | null, webPath: string | null } | null> | null } | null } | null> | null } | null } | null, discussions: { nodes: Array<{ resolvable: boolean, resolved: boolean, notes: { nodes: Array<{ body: string, system: boolean, url: string | null, createdAt: string, author: { username: string, name: string, bot: boolean, avatarUrl: string | null } | null, position: { filePath: string, newLine: number | null, oldLine: number | null } | null } | null> | null } } | null> | null } } | null } | null };

export type UsualQueryVariables = Exact<{
  path: string;
}>;


export type UsualQuery = { project: { pipelines: { nodes: Array<{ duration: number | null } | null> | null } | null } | null };
