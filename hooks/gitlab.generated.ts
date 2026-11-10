/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] }
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never }
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
  | 'WAITING_FOR_RESOURCE'

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
  | 'UNCHECKED'

export type MergeRequestReviewState = 'APPROVED' | 'REQUESTED_CHANGES' | 'REVIEWED' | 'REVIEW_STARTED' | 'UNAPPROVED' | 'UNREVIEWED'

export type MergeRequestState = 'all' | 'closed' | 'locked' | 'merged' | 'opened'

export type MergeStrategyEnum = 'ADD_TO_MERGE_TRAIN_WHEN_CHECKS_PASS' | 'MERGE_TRAIN' | 'MERGE_WHEN_CHECKS_PASS'

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
  | 'TITLE_REGEX'

export type MergeabilityCheckStatus = 'CHECKING' | 'FAILED' | 'INACTIVE' | 'SUCCESS' | 'WARNING'

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
  | 'WAITING_FOR_RESOURCE'

export type TodoActionEnum =
  | 'added_approver'
  | 'approval_required'
  | 'assigned'
  | 'build_failed'
  | 'directly_addressed'
  | 'duo_core_access_granted'
  | 'duo_enterprise_access_granted'
  | 'duo_pro_access_granted'
  | 'duo_workflow_input_required'
  | 'marked'
  | 'member_access_requested'
  | 'mentioned'
  | 'merge_train_removed'
  | 'okr_checkin_requested'
  | 'orbit_access_granted'
  | 'review_requested'
  | 'review_submitted'
  | 'ssh_key_expired'
  | 'ssh_key_expiring_soon'
  | 'transfer_failed'
  | 'unmergeable'

export type NoteFieldsFragment = {
  body: string
  system: boolean
  url: string | null
  createdAt: string
  author: { username: string; name: string; bot: boolean; avatarUrl: string | null } | null
  position: { filePath: string; newLine: number | null; oldLine: number | null } | null
}

export type MrFieldsFragment = {
  iid: string
  state: MergeRequestState
  title: string
  webUrl: string | null
  draft: boolean
  conflicts: boolean
  shouldBeRebased: boolean
  approvalsLeft: number | null
  approvalsRequired: number | null
  updatedAt: string
  description: string | null
  sourceBranch: string
  targetBranch: string
  author: { username: string } | null
  diffStatsSummary: { additions: number; deletions: number; fileCount: number } | null
  project: { fullPath: string; name: string; webUrl: string | null }
  approvedBy: { nodes: Array<{ username: string; name: string; bot: boolean; avatarUrl: string | null } | null> | null } | null
  headPipeline: {
    id: string
    status: PipelineStatusEnum
    duration: number | null
    startedAt: string | null
    finishedAt: string | null
    path: string | null
    stages: {
      nodes: Array<{
        name: string | null
        status: string | null
        jobs: {
          nodes: Array<{
            name: string | null
            status: CiJobStatus | null
            allowFailure: boolean
            startedAt: string | null
            finishedAt: string | null
            webPath: string | null
          } | null> | null
        } | null
      } | null> | null
    } | null
  } | null
  discussions: {
    nodes: Array<{
      resolvable: boolean
      resolved: boolean
      notes: {
        nodes: Array<{
          body: string
          system: boolean
          url: string | null
          createdAt: string
          author: { username: string; name: string; bot: boolean; avatarUrl: string | null } | null
          position: { filePath: string; newLine: number | null; oldLine: number | null } | null
        } | null> | null
      }
    } | null> | null
  }
}

export type ReviewerFieldsFragment = {
  username: string
  name: string
  bot: boolean
  avatarUrl: string | null
  mergeRequestInteraction: { reviewState: MergeRequestReviewState | null } | null
}

export type ReviewerPlainFragment = { username: string; name: string; bot: boolean; avatarUrl: string | null }

export type AuthoredQueryVariables = Exact<{
  state?: MergeRequestState | null | undefined
  after?: string | null | undefined
}>

export type AuthoredQuery = {
  currentUser: {
    authoredMergeRequests: {
      nodes: Array<{
        iid: string
        state: MergeRequestState
        title: string
        webUrl: string | null
        draft: boolean
        conflicts: boolean
        shouldBeRebased: boolean
        approvalsLeft: number | null
        approvalsRequired: number | null
        updatedAt: string
        description: string | null
        sourceBranch: string
        targetBranch: string
        reviewers: {
          nodes: Array<{
            username: string
            name: string
            bot: boolean
            avatarUrl: string | null
            mergeRequestInteraction: { reviewState: MergeRequestReviewState | null } | null
          } | null> | null
        } | null
        author: { username: string } | null
        diffStatsSummary: { additions: number; deletions: number; fileCount: number } | null
        project: { fullPath: string; name: string; webUrl: string | null }
        approvedBy: { nodes: Array<{ username: string; name: string; bot: boolean; avatarUrl: string | null } | null> | null } | null
        headPipeline: {
          id: string
          status: PipelineStatusEnum
          duration: number | null
          startedAt: string | null
          finishedAt: string | null
          path: string | null
          stages: {
            nodes: Array<{
              name: string | null
              status: string | null
              jobs: {
                nodes: Array<{
                  name: string | null
                  status: CiJobStatus | null
                  allowFailure: boolean
                  startedAt: string | null
                  finishedAt: string | null
                  webPath: string | null
                } | null> | null
              } | null
            } | null> | null
          } | null
        } | null
        discussions: {
          nodes: Array<{
            resolvable: boolean
            resolved: boolean
            notes: {
              nodes: Array<{
                body: string
                system: boolean
                url: string | null
                createdAt: string
                author: { username: string; name: string; bot: boolean; avatarUrl: string | null } | null
                position: { filePath: string; newLine: number | null; oldLine: number | null } | null
              } | null> | null
            }
          } | null> | null
        }
      } | null> | null
    } | null
  } | null
}

export type AuthoredPlainQueryVariables = Exact<{
  state?: MergeRequestState | null | undefined
  after?: string | null | undefined
}>

export type AuthoredPlainQuery = {
  currentUser: {
    authoredMergeRequests: {
      nodes: Array<{
        iid: string
        state: MergeRequestState
        title: string
        webUrl: string | null
        draft: boolean
        conflicts: boolean
        shouldBeRebased: boolean
        approvalsLeft: number | null
        approvalsRequired: number | null
        updatedAt: string
        description: string | null
        sourceBranch: string
        targetBranch: string
        reviewers: { nodes: Array<{ username: string; name: string; bot: boolean; avatarUrl: string | null } | null> | null } | null
        author: { username: string } | null
        diffStatsSummary: { additions: number; deletions: number; fileCount: number } | null
        project: { fullPath: string; name: string; webUrl: string | null }
        approvedBy: { nodes: Array<{ username: string; name: string; bot: boolean; avatarUrl: string | null } | null> | null } | null
        headPipeline: {
          id: string
          status: PipelineStatusEnum
          duration: number | null
          startedAt: string | null
          finishedAt: string | null
          path: string | null
          stages: {
            nodes: Array<{
              name: string | null
              status: string | null
              jobs: {
                nodes: Array<{
                  name: string | null
                  status: CiJobStatus | null
                  allowFailure: boolean
                  startedAt: string | null
                  finishedAt: string | null
                  webPath: string | null
                } | null> | null
              } | null
            } | null> | null
          } | null
        } | null
        discussions: {
          nodes: Array<{
            resolvable: boolean
            resolved: boolean
            notes: {
              nodes: Array<{
                body: string
                system: boolean
                url: string | null
                createdAt: string
                author: { username: string; name: string; bot: boolean; avatarUrl: string | null } | null
                position: { filePath: string; newLine: number | null; oldLine: number | null } | null
              } | null> | null
            }
          } | null> | null
        }
      } | null> | null
    } | null
  } | null
}

export type PinnedQueryVariables = Exact<{
  path: string
  iid: string
}>

export type PinnedQuery = {
  project: {
    mergeRequest: {
      iid: string
      state: MergeRequestState
      title: string
      webUrl: string | null
      draft: boolean
      conflicts: boolean
      shouldBeRebased: boolean
      approvalsLeft: number | null
      approvalsRequired: number | null
      updatedAt: string
      description: string | null
      sourceBranch: string
      targetBranch: string
      reviewers: {
        nodes: Array<{
          username: string
          name: string
          bot: boolean
          avatarUrl: string | null
          mergeRequestInteraction: { reviewState: MergeRequestReviewState | null } | null
        } | null> | null
      } | null
      author: { username: string } | null
      diffStatsSummary: { additions: number; deletions: number; fileCount: number } | null
      project: { fullPath: string; name: string; webUrl: string | null }
      approvedBy: { nodes: Array<{ username: string; name: string; bot: boolean; avatarUrl: string | null } | null> | null } | null
      headPipeline: {
        id: string
        status: PipelineStatusEnum
        duration: number | null
        startedAt: string | null
        finishedAt: string | null
        path: string | null
        stages: {
          nodes: Array<{
            name: string | null
            status: string | null
            jobs: {
              nodes: Array<{
                name: string | null
                status: CiJobStatus | null
                allowFailure: boolean
                startedAt: string | null
                finishedAt: string | null
                webPath: string | null
              } | null> | null
            } | null
          } | null> | null
        } | null
      } | null
      discussions: {
        nodes: Array<{
          resolvable: boolean
          resolved: boolean
          notes: {
            nodes: Array<{
              body: string
              system: boolean
              url: string | null
              createdAt: string
              author: { username: string; name: string; bot: boolean; avatarUrl: string | null } | null
              position: { filePath: string; newLine: number | null; oldLine: number | null } | null
            } | null> | null
          }
        } | null> | null
      }
    } | null
  } | null
}

export type PinnedPlainQueryVariables = Exact<{
  path: string
  iid: string
}>

export type PinnedPlainQuery = {
  project: {
    mergeRequest: {
      iid: string
      state: MergeRequestState
      title: string
      webUrl: string | null
      draft: boolean
      conflicts: boolean
      shouldBeRebased: boolean
      approvalsLeft: number | null
      approvalsRequired: number | null
      updatedAt: string
      description: string | null
      sourceBranch: string
      targetBranch: string
      reviewers: { nodes: Array<{ username: string; name: string; bot: boolean; avatarUrl: string | null } | null> | null } | null
      author: { username: string } | null
      diffStatsSummary: { additions: number; deletions: number; fileCount: number } | null
      project: { fullPath: string; name: string; webUrl: string | null }
      approvedBy: { nodes: Array<{ username: string; name: string; bot: boolean; avatarUrl: string | null } | null> | null } | null
      headPipeline: {
        id: string
        status: PipelineStatusEnum
        duration: number | null
        startedAt: string | null
        finishedAt: string | null
        path: string | null
        stages: {
          nodes: Array<{
            name: string | null
            status: string | null
            jobs: {
              nodes: Array<{
                name: string | null
                status: CiJobStatus | null
                allowFailure: boolean
                startedAt: string | null
                finishedAt: string | null
                webPath: string | null
              } | null> | null
            } | null
          } | null> | null
        } | null
      } | null
      discussions: {
        nodes: Array<{
          resolvable: boolean
          resolved: boolean
          notes: {
            nodes: Array<{
              body: string
              system: boolean
              url: string | null
              createdAt: string
              author: { username: string; name: string; bot: boolean; avatarUrl: string | null } | null
              position: { filePath: string; newLine: number | null; oldLine: number | null } | null
            } | null> | null
          }
        } | null> | null
      }
    } | null
  } | null
}

export type FailuresQueryVariables = Exact<{
  path: string
  iid: string
}>

export type FailuresQuery = {
  project: {
    mergeRequest: { headPipeline: { jobs: { nodes: Array<{ webPath: string | null; allowFailure: boolean; failureMessage: string | null } | null> | null } | null } | null } | null
  } | null
}

export type UsualQueryVariables = Exact<{
  path: string
}>

export type UsualQuery = { project: { pipelines: { nodes: Array<{ duration: number | null } | null> | null } | null } | null }

export type InboxMrFieldsFragment = {
  iid: string
  state: MergeRequestState
  title: string
  webUrl: string | null
  draft: boolean
  createdAt: string
  author: { username: string; name: string } | null
  project: { fullPath: string }
}

export type InboxNoteFieldsFragment = {
  id: string
  body: string
  system: boolean
  createdAt: string
  author: { username: string; name: string; bot: boolean } | null
  systemNoteMetadata: { action: string | null } | null
}

export type InboxNoteActionFieldsFragment = { systemNoteMetadata: { action: string | null } | null }

export type InboxMergedByFieldsFragment = { mergedAt: string | null; mergeUser: { username: string; name: string } | null }

export type InboxTodosQueryVariables = Exact<{ [key: string]: never }>

export type InboxTodosQuery = {
  currentUser: {
    username: string
    todos: {
      nodes: Array<{
        action: TodoActionEnum
        createdAt: string
        body: string
        targetUrl: string | null
        author: { username: string; name: string }
        targetEntity:
          | { webUrl: string }
          | {
              webUrl: string | null
              iid: string
              state: MergeRequestState
              title: string
              draft: boolean
              createdAt: string
              author: { username: string; name: string } | null
              project: { fullPath: string }
            }
          | { webUrl: string }
          | { webUrl: string }
          | { webUrl: string | null }
          | { webUrl: string }
          | null
      } | null> | null
    } | null
  } | null
}

export type InboxTodosPlainQueryVariables = Exact<{ [key: string]: never }>

export type InboxTodosPlainQuery = {
  currentUser: {
    username: string
    todos: {
      nodes: Array<{
        action: TodoActionEnum
        createdAt: string
        body: string
        targetUrl: string | null
        author: { username: string; name: string }
        target:
          | { webUrl: string }
          | {
              webUrl: string | null
              iid: string
              state: MergeRequestState
              title: string
              draft: boolean
              createdAt: string
              author: { username: string; name: string } | null
              project: { fullPath: string }
            }
          | { webUrl: string }
          | { webUrl: string }
          | { webUrl: string | null }
          | { webUrl: string }
      } | null> | null
    } | null
  } | null
}

export type InboxQueueQueryVariables = Exact<{ [key: string]: never }>

export type InboxQueueQuery = {
  currentUser: {
    username: string
    reviewRequestedMergeRequests: {
      nodes: Array<{
        iid: string
        state: MergeRequestState
        title: string
        webUrl: string | null
        draft: boolean
        createdAt: string
        approvedBy: { nodes: Array<{ username: string } | null> | null } | null
        notes: {
          pageInfo: { hasPreviousPage: boolean }
          nodes: Array<{
            id: string
            body: string
            system: boolean
            createdAt: string
            author: { username: string; name: string; bot: boolean } | null
            systemNoteMetadata: { action: string | null } | null
          } | null> | null
        }
        author: { username: string; name: string } | null
        project: { fullPath: string }
      } | null> | null
    } | null
  } | null
}

export type InboxAuthoredQueryVariables = Exact<{
  since: string
}>

export type InboxAuthoredQuery = {
  currentUser: {
    username: string
    opened: {
      nodes: Array<{
        iid: string
        state: MergeRequestState
        title: string
        webUrl: string | null
        draft: boolean
        createdAt: string
        notes: {
          pageInfo: { hasPreviousPage: boolean }
          nodes: Array<{
            id: string
            body: string
            system: boolean
            createdAt: string
            author: { username: string; name: string; bot: boolean } | null
            systemNoteMetadata: { action: string | null } | null
          } | null> | null
        }
        author: { username: string; name: string } | null
        project: { fullPath: string }
      } | null> | null
    } | null
    merged: {
      nodes: Array<{
        iid: string
        state: MergeRequestState
        title: string
        webUrl: string | null
        draft: boolean
        createdAt: string
        mergedAt: string | null
        author: { username: string; name: string } | null
        project: { fullPath: string }
        mergeUser: { username: string; name: string } | null
      } | null> | null
    } | null
  } | null
}

export type InboxFollowUserQueryVariables = Exact<{
  username: string
  since: string
}>

export type InboxFollowUserQuery = {
  currentUser: { username: string } | null
  user: {
    opened: {
      nodes: Array<{
        iid: string
        state: MergeRequestState
        title: string
        webUrl: string | null
        draft: boolean
        createdAt: string
        notes: {
          pageInfo: { hasPreviousPage: boolean }
          nodes: Array<{
            id: string
            body: string
            system: boolean
            createdAt: string
            author: { username: string; name: string; bot: boolean } | null
            systemNoteMetadata: { action: string | null } | null
          } | null> | null
        }
        author: { username: string; name: string } | null
        project: { fullPath: string }
      } | null> | null
    } | null
    merged: {
      nodes: Array<{
        iid: string
        state: MergeRequestState
        title: string
        webUrl: string | null
        draft: boolean
        createdAt: string
        mergedAt: string | null
        author: { username: string; name: string } | null
        project: { fullPath: string }
        mergeUser: { username: string; name: string } | null
      } | null> | null
    } | null
  } | null
}

export type InboxFollowProjectQueryVariables = Exact<{
  path: string
  since: string
}>

export type InboxFollowProjectQuery = {
  currentUser: { username: string } | null
  project: {
    opened: {
      nodes: Array<{
        iid: string
        state: MergeRequestState
        title: string
        webUrl: string | null
        draft: boolean
        createdAt: string
        notes: {
          pageInfo: { hasPreviousPage: boolean }
          nodes: Array<{
            id: string
            body: string
            system: boolean
            createdAt: string
            author: { username: string; name: string; bot: boolean } | null
            systemNoteMetadata: { action: string | null } | null
          } | null> | null
        }
        author: { username: string; name: string } | null
        project: { fullPath: string }
      } | null> | null
    } | null
    merged: {
      nodes: Array<{
        iid: string
        state: MergeRequestState
        title: string
        webUrl: string | null
        draft: boolean
        createdAt: string
        mergedAt: string | null
        author: { username: string; name: string } | null
        project: { fullPath: string }
        mergeUser: { username: string; name: string } | null
      } | null> | null
    } | null
  } | null
}

export type InboxBriefQueryVariables = Exact<{
  path: string
  iid: string
}>

export type InboxBriefQuery = {
  project: {
    mergeRequest: {
      description: string | null
      sourceBranch: string
      targetBranch: string
      iid: string
      state: MergeRequestState
      title: string
      webUrl: string | null
      draft: boolean
      createdAt: string
      discussions: {
        nodes: Array<{
          resolvable: boolean
          resolved: boolean
          notes: { nodes: Array<{ id: string; body: string; system: boolean; createdAt: string; author: { username: string; name: string; bot: boolean } | null } | null> | null }
        } | null> | null
      }
      author: { username: string; name: string } | null
      project: { fullPath: string }
    } | null
  } | null
}

export type MergeStatusQueryVariables = Exact<{ [key: string]: never }>

export type MergeStatusQuery = {
  currentUser: {
    authoredMergeRequests: {
      nodes: Array<{
        iid: string
        diffHeadSha: string | null
        rebaseInProgress: boolean
        autoMergeEnabled: boolean
        project: { fullPath: string }
        mergeabilityChecks: Array<{ identifier: MergeabilityCheckIdentifier; status: MergeabilityCheckStatus }>
        userPermissions: { canMerge: boolean; pushToSourceBranch: boolean }
      } | null> | null
    } | null
  } | null
}

export type MoveStateQueryVariables = Exact<{
  path: string
  iid: string
}>

export type MoveStateQuery = {
  project: {
    mergeRequest: {
      state: MergeRequestState
      detailedMergeStatus: DetailedMergeStatus | null
      diffHeadSha: string | null
      rebaseCommitSha: string | null
      rebaseInProgress: boolean
      mergeError: string | null
      availableAutoMergeStrategies: Array<string> | null
    } | null
  } | null
}

export type MergeMutationVariables = Exact<{
  path: string
  iid: string
  sha: string
  strategy?: MergeStrategyEnum | null | undefined
}>

export type MergeMutation = { mergeRequestAccept: { errors: Array<string>; mergeRequest: { state: MergeRequestState; mergeError: string | null } | null } | null }
