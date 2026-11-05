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

export type MergeabilityCheckIdentifier =
  | 'CI_MUST_PASS'
  | 'COMMITS_STATUS'
  | 'CONFLICT'
  | 'DISCUSSIONS_NOT_RESOLVED'
  | 'DRAFT_STATUS'
  | 'JIRA_ASSOCIATION_MISSING'
  | 'LOCKED_LFS_FILES'
  | 'LOCKED_PATHS'
  | 'MERGE_REQUEST_BLOCKED'
  | 'MERGE_TIME'
  | 'NEED_REBASE'
  | 'NOT_APPROVED'
  | 'NOT_OPEN'
  | 'REQUESTED_CHANGES'
  | 'SECURITY_POLICY_PIPELINE_CHECK'
  | 'SECURITY_POLICY_VIOLATIONS'
  | 'STATUS_CHECKS_MUST_PASS'
  | 'TITLE_REGEX';

export type MergeabilityCheckStatus =
  | 'CHECKING'
  | 'FAILED'
  | 'INACTIVE'
  | 'SUCCESS'
  | 'WARNING';

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

export type MrFieldsFragment = { iid: string, state: MergeRequestState, title: string, webUrl: string | null, draft: boolean, conflicts: boolean, shouldBeRebased: boolean, approvalsLeft: number | null, approvalsRequired: number | null, updatedAt: string, description: string | null, sourceBranch: string, targetBranch: string, author: { username: string } | null, diffStatsSummary: { additions: number, deletions: number, fileCount: number } | null, project: { fullPath: string, name: string, webUrl: string | null }, approvedBy: { nodes: Array<{ username: string, name: string, bot: boolean, avatarUrl: string | null } | null> | null } | null, headPipeline: { id: string, status: PipelineStatusEnum, duration: number | null, startedAt: string | null, finishedAt: string | null, path: string | null, stages: { nodes: Array<{ name: string | null, status: string | null, jobs: { nodes: Array<{ name: string | null, status: CiJobStatus | null, allowFailure: boolean, startedAt: string | null, finishedAt: string | null, webPath: string | null } | null> | null } | null } | null> | null } | null } | null, discussions: { nodes: Array<{ resolvable: boolean, resolved: boolean, notes: { nodes: Array<{ body: string, system: boolean, url: string | null, createdAt: string, author: { username: string, name: string, bot: boolean, avatarUrl: string | null } | null, position: { filePath: string, newLine: number | null, oldLine: number | null } | null } | null> | null } } | null> | null } };

export type ReviewerFieldsFragment = { username: string, name: string, bot: boolean, avatarUrl: string | null, mergeRequestInteraction: { reviewState: MergeRequestReviewState | null } | null };

export type ReviewerPlainFragment = { username: string, name: string, bot: boolean, avatarUrl: string | null };

export type AuthoredQueryVariables = Exact<{ [key: string]: never; }>;


export type AuthoredQuery = { currentUser: { authoredMergeRequests: { nodes: Array<{ iid: string, state: MergeRequestState, title: string, webUrl: string | null, draft: boolean, conflicts: boolean, shouldBeRebased: boolean, approvalsLeft: number | null, approvalsRequired: number | null, updatedAt: string, description: string | null, sourceBranch: string, targetBranch: string, reviewers: { nodes: Array<{ username: string, name: string, bot: boolean, avatarUrl: string | null, mergeRequestInteraction: { reviewState: MergeRequestReviewState | null } | null } | null> | null } | null, author: { username: string } | null, diffStatsSummary: { additions: number, deletions: number, fileCount: number } | null, project: { fullPath: string, name: string, webUrl: string | null }, approvedBy: { nodes: Array<{ username: string, name: string, bot: boolean, avatarUrl: string | null } | null> | null } | null, headPipeline: { id: string, status: PipelineStatusEnum, duration: number | null, startedAt: string | null, finishedAt: string | null, path: string | null, stages: { nodes: Array<{ name: string | null, status: string | null, jobs: { nodes: Array<{ name: string | null, status: CiJobStatus | null, allowFailure: boolean, startedAt: string | null, finishedAt: string | null, webPath: string | null } | null> | null } | null } | null> | null } | null } | null, discussions: { nodes: Array<{ resolvable: boolean, resolved: boolean, notes: { nodes: Array<{ body: string, system: boolean, url: string | null, createdAt: string, author: { username: string, name: string, bot: boolean, avatarUrl: string | null } | null, position: { filePath: string, newLine: number | null, oldLine: number | null } | null } | null> | null } } | null> | null } } | null> | null } | null } | null };

export type AuthoredPlainQueryVariables = Exact<{ [key: string]: never; }>;


export type AuthoredPlainQuery = { currentUser: { authoredMergeRequests: { nodes: Array<{ iid: string, state: MergeRequestState, title: string, webUrl: string | null, draft: boolean, conflicts: boolean, shouldBeRebased: boolean, approvalsLeft: number | null, approvalsRequired: number | null, updatedAt: string, description: string | null, sourceBranch: string, targetBranch: string, reviewers: { nodes: Array<{ username: string, name: string, bot: boolean, avatarUrl: string | null } | null> | null } | null, author: { username: string } | null, diffStatsSummary: { additions: number, deletions: number, fileCount: number } | null, project: { fullPath: string, name: string, webUrl: string | null }, approvedBy: { nodes: Array<{ username: string, name: string, bot: boolean, avatarUrl: string | null } | null> | null } | null, headPipeline: { id: string, status: PipelineStatusEnum, duration: number | null, startedAt: string | null, finishedAt: string | null, path: string | null, stages: { nodes: Array<{ name: string | null, status: string | null, jobs: { nodes: Array<{ name: string | null, status: CiJobStatus | null, allowFailure: boolean, startedAt: string | null, finishedAt: string | null, webPath: string | null } | null> | null } | null } | null> | null } | null } | null, discussions: { nodes: Array<{ resolvable: boolean, resolved: boolean, notes: { nodes: Array<{ body: string, system: boolean, url: string | null, createdAt: string, author: { username: string, name: string, bot: boolean, avatarUrl: string | null } | null, position: { filePath: string, newLine: number | null, oldLine: number | null } | null } | null> | null } } | null> | null } } | null> | null } | null } | null };

export type MergeStatusQueryVariables = Exact<{ [key: string]: never; }>;


export type MergeStatusQuery = { currentUser: { authoredMergeRequests: { nodes: Array<{ iid: string, project: { fullPath: string }, mergeabilityChecks: Array<{ identifier: MergeabilityCheckIdentifier, status: MergeabilityCheckStatus }> } | null> | null } | null } | null };

export type PinnedQueryVariables = Exact<{
  path: string;
  iid: string;
}>;


export type PinnedQuery = { project: { mergeRequest: { iid: string, state: MergeRequestState, title: string, webUrl: string | null, draft: boolean, conflicts: boolean, shouldBeRebased: boolean, approvalsLeft: number | null, approvalsRequired: number | null, updatedAt: string, description: string | null, sourceBranch: string, targetBranch: string, reviewers: { nodes: Array<{ username: string, name: string, bot: boolean, avatarUrl: string | null, mergeRequestInteraction: { reviewState: MergeRequestReviewState | null } | null } | null> | null } | null, author: { username: string } | null, diffStatsSummary: { additions: number, deletions: number, fileCount: number } | null, project: { fullPath: string, name: string, webUrl: string | null }, approvedBy: { nodes: Array<{ username: string, name: string, bot: boolean, avatarUrl: string | null } | null> | null } | null, headPipeline: { id: string, status: PipelineStatusEnum, duration: number | null, startedAt: string | null, finishedAt: string | null, path: string | null, stages: { nodes: Array<{ name: string | null, status: string | null, jobs: { nodes: Array<{ name: string | null, status: CiJobStatus | null, allowFailure: boolean, startedAt: string | null, finishedAt: string | null, webPath: string | null } | null> | null } | null } | null> | null } | null } | null, discussions: { nodes: Array<{ resolvable: boolean, resolved: boolean, notes: { nodes: Array<{ body: string, system: boolean, url: string | null, createdAt: string, author: { username: string, name: string, bot: boolean, avatarUrl: string | null } | null, position: { filePath: string, newLine: number | null, oldLine: number | null } | null } | null> | null } } | null> | null } } | null } | null };

export type PinnedPlainQueryVariables = Exact<{
  path: string;
  iid: string;
}>;


export type PinnedPlainQuery = { project: { mergeRequest: { iid: string, state: MergeRequestState, title: string, webUrl: string | null, draft: boolean, conflicts: boolean, shouldBeRebased: boolean, approvalsLeft: number | null, approvalsRequired: number | null, updatedAt: string, description: string | null, sourceBranch: string, targetBranch: string, reviewers: { nodes: Array<{ username: string, name: string, bot: boolean, avatarUrl: string | null } | null> | null } | null, author: { username: string } | null, diffStatsSummary: { additions: number, deletions: number, fileCount: number } | null, project: { fullPath: string, name: string, webUrl: string | null }, approvedBy: { nodes: Array<{ username: string, name: string, bot: boolean, avatarUrl: string | null } | null> | null } | null, headPipeline: { id: string, status: PipelineStatusEnum, duration: number | null, startedAt: string | null, finishedAt: string | null, path: string | null, stages: { nodes: Array<{ name: string | null, status: string | null, jobs: { nodes: Array<{ name: string | null, status: CiJobStatus | null, allowFailure: boolean, startedAt: string | null, finishedAt: string | null, webPath: string | null } | null> | null } | null } | null> | null } | null } | null, discussions: { nodes: Array<{ resolvable: boolean, resolved: boolean, notes: { nodes: Array<{ body: string, system: boolean, url: string | null, createdAt: string, author: { username: string, name: string, bot: boolean, avatarUrl: string | null } | null, position: { filePath: string, newLine: number | null, oldLine: number | null } | null } | null> | null } } | null> | null } } | null } | null };

export type ProbeQueryVariables = Exact<{ [key: string]: never; }>;


export type ProbeQuery = { mergeRequest: { fields: Array<{ name: string }> | null } | null, interaction: { fields: Array<{ name: string }> | null } | null };

export type UsualQueryVariables = Exact<{
  path: string;
}>;


export type UsualQuery = { project: { pipelines: { nodes: Array<{ duration: number | null } | null> | null } | null } | null };
