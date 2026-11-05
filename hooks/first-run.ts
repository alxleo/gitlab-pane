// What the pane says when nothing has been read yet and a source has failed: one line per source, with the fix. The hint
// follows the kind of failure, never its message, so a change in how tokens or hosts are found changes no wording here.
import type { FailureKind, Problems, ProblemSource } from '../types'

const NAMES: Record<ProblemSource, string> = {
  gitlab: 'GitLab',
  jira: 'Jira',
  usual: 'Pipeline times',
  avatars: 'Pictures',
  inbox: 'Inbox',
  pane: 'Pane',
}

/** The sources whose failure keeps the pane empty, in the order they are told. */
const FIRST: readonly ProblemSource[] = ['gitlab', 'jira', 'inbox']

const FIX: Record<FailureKind, string> = {
  'not-installed': 'its command-line tool is not installed: install it, then press refresh',
  'no-token': 'no access token: set one, or sign in, then press refresh',
  unauthorized: 'the token was refused: sign in again, or use one that can read merge requests, then press refresh',
  network: 'cannot be reached: check the network or VPN, then press refresh',
  timeout: 'took too long to answer: it is tried again, or press refresh',
  'bad-answer': 'answered something the pane could not read: press refresh, and see /gitlab',
  server: 'the server answered with an error: it is tried again, or press refresh',
}

/**
 * One line per failing source while nothing has been read, saying what to do. An optional tool that is simply absent
 * (Jira, the inbox) is not a failure to tell on a pane that is otherwise empty; a failure with no kind says its own words.
 */
export function firstRunLines(problems: Problems, hasRead: boolean): string[] {
  if (hasRead) {
    return []
  }
  return FIRST.flatMap(source => {
    const problem = problems[source]
    if (problem === undefined || (problem.kind === 'not-installed' && source !== 'gitlab')) {
      return []
    }
    return [`${NAMES[source]}: ${problem.kind !== undefined ? FIX[problem.kind] : problem.message}`]
  })
}
