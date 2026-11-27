// A made-up GitLab for the harness, the checks and the pictures: the repo's fixtures as MRs, answered by the mod's own
// test GitLab (`tests/gitlab_fake.ts`), so a merge merges the way the mod's tests see it. The requests go through
// `connect` as they would to gitlab.com, but no request leaves the process.
import { checks, commented, listed, mergeStatuses, pipe, rawMr, reviewer, thread, user } from '../tests/fixtures.ts'
import type { Mr } from '../tests/fixtures.ts'
import { moveAnswers, rebased, sent, serve } from '../tests/gitlab_fake.ts'
import type { Answers } from '../tests/gitlab_fake.ts'

import { connect } from './read.ts'
import type { GitLab, Send } from './read.ts'

/** The token the made-up GitLab accepts. */
const TOKEN = 'made-up'

/** Made-up MRs that show each kind of row: failed, conflicts, ready to merge, behind its target, waiting on an approval, running, draft. */
const mrs = (): Mr[] => [
  rawMr(412, {
    title: 'feat: [SHOP-88] basket keeps its items across devices',
    headPipeline: pipe('FAILED'),
    reviewers: { nodes: [reviewer('mira', 'REQUESTED_CHANGES')] },
    discussions: { nodes: [thread('This should not block the main thread.', 'mira')] },
    mergeabilityChecks: checks({ CI_MUST_PASS: 'FAILED' }),
  }),
  rawMr(398, {
    title: 'fix: retry the payment webhook once on a 502',
    conflicts: true,
    approvalsLeft: 0,
    approvedBy: { nodes: [user('tom')] },
    mergeabilityChecks: checks({ CONFLICT: 'FAILED' }),
  }),
  rawMr(405, {
    title: 'chore: raise the image cache to 7 days',
    approvalsLeft: 0,
    approvedBy: { nodes: [user('ana')] },
    reviewers: { nodes: [reviewer('ana', 'APPROVED')] },
    mergeabilityChecks: checks(),
  }),
  rawMr(409, {
    title: 'fix: the order page keeps its scroll position',
    approvalsLeft: 0,
    approvedBy: { nodes: [user('ana')] },
    shouldBeRebased: true,
    mergeabilityChecks: checks({ NEED_REBASE: 'FAILED' }),
  }),
  rawMr(414, {
    title: 'fix: the receipt names the store it came from',
    reviewers: { nodes: [reviewer('tom', 'UNREVIEWED')] },
    mergeabilityChecks: checks({ NOT_APPROVED: 'FAILED' }),
  }),
  rawMr(417, { title: 'feat: [SHOP-91] gift cards at checkout', headPipeline: pipe('RUNNING'), reviewers: { nodes: [reviewer('tom', 'UNREVIEWED')] } }),
  rawMr(420, { title: 'Draft: spike the new search ranking', draft: true, headPipeline: pipe('MANUAL') }),
]

/**
 * A GitLab that answers the plugin's documents from `mrs()`. `writes` hears of each write: a merge as `<iid>@<head>`, as
 * the mod's tests record one, and a rebase as `rebase <iid>`.
 */
export function fakeGitLab(): GitLab & { writes: string[] } {
  const all = mrs()
  const open = () => all.filter(mr => mr.state === 'opened')
  const writes: string[] = []
  const answers: Answers = {
    ...moveAnswers(
      () => all,
      () => [],
      writes
    ),
    Authored: () => ({ data: { currentUser: { authoredMergeRequests: { nodes: open().map(mr => listed(commented(mr))) } } } }),
    MergeStatus: () => mergeStatuses(open()),
    Pinned: ({ path, iid }) => {
      const mr = all.find(each => each.iid === iid && each.project.fullPath === path)
      return { data: { project: { mergeRequest: mr !== undefined ? commented(mr) : null } } }
    },
  }
  const answer = (status: number, text: string) => ({ status, text: async () => text })
  const send: Send = async (url, init) => {
    const rebase = rebased(url, init)
    if (rebase !== null) {
      writes.push(`rebase ${rebase.iid}`)
      return answer(202, '{"rebase_in_progress":true}')
    }
    const served = serve(sent(url, init), answers, TOKEN)
    return answer(served.status, served.text)
  }
  return { ...connect('gitlab.com', { token: TOKEN, source: 'the environment', send }), writes }
}
