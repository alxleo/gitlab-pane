// The one part of the GitLab path that is not the core: how a token is found and how a document reaches GitLab. In the
// Claude Code mod these are `tokens.ts` and `graphql.ts`, which go through the session's `$` (its fetch, settings,
// in-memory atoms). Here they are Node's global fetch and the environment. Everything else is the core, imported as is.
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'

import { authoredQuery, jobsWanted, listedMrs } from '../../hooks/ask-authored.ts'
import { mergeStatusQuery, readMergeStatus } from '../../hooks/ask-merge-status.ts'
import type { GitLabVerdict } from '../../hooks/ask-merge-status.ts'
import { pinnedMr, pinnedQuery } from '../../hooks/ask-pinned.ts'
import { decodeGraphql } from '../../hooks/decode.ts'
import { Failure } from '../../hooks/failure.ts'
import { missingFeatures } from '../../hooks/gitlab-features.ts'
import type { RawResponse, Request } from '../../hooks/gitlab-request.ts'
import type { AuthoredPlainQuery, AuthoredQuery, MergeStatusQuery } from '../../hooks/gitlab.generated.ts'
import { redact } from '../../hooks/hosts.ts'
import { mergeReads } from '../../hooks/incremental.ts'
import { lines } from '../../hooks/model-text.ts'
import { toCard } from '../../hooks/mr-card.ts'
import { pinKey } from '../../hooks/mr-url.ts'
import { conflictsTask, nextMove } from '../../hooks/next-move.ts'
import { buildPane } from '../../hooks/pane-model.ts'
import type { RowModel } from '../../hooks/pane-model.ts'
import { slimCard, slimChecks } from '../../hooks/slim.ts'

import type { HostFeatures, MrCard, Pressed } from '../../types/index.d.ts'

/** How a document, or a REST call, reaches one host with the user's token. */
export type GitLab = {
  host: string
  graphql<Data>(request: Request<Data>): Promise<RawResponse<Data>>
  /** A PUT to `https://<host>/api/v4/<path>` (a rebase: GraphQL has none), sent once. */
  put(path: string): Promise<{ status: number; text: string }>
}

/** Where glab may be when the desktop app starts this server with a short PATH. */
const GLABS = ['glab', '/opt/homebrew/bin/glab', '/usr/local/bin/glab', `${homedir()}/.local/share/mise/shims/glab`]

/** A token for `host`: GITLAB_TOKEN, else the one glab stored for the host, as the mod's own `tokens.ts` asks for it. */
function tokenFor(host: string): string {
  const fromEnv = process.env.GITLAB_TOKEN ?? ''
  if (fromEnv !== '') {
    return fromEnv
  }
  for (const glab of GLABS) {
    try {
      const stored = execFileSync(glab, ['config', 'get', 'token', '--host', host], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      if (stored !== '') {
        return stored
      }
    } catch {
      // Not there, or no token for the host: try the next.
    }
  }
  throw new Failure('unauthorized', `no token for ${host}: set GITLAB_TOKEN or run glab auth login --hostname ${host}`)
}

/** The user's GitLab on `host`. Every request is sent once: a write must not go twice. */
export function connect(host: string): GitLab {
  const token = tokenFor(host)
  const send = async (url: string, init: RequestInit): Promise<Response> => {
    try {
      return await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } })
    } catch (error) {
      throw new Failure('network', redact(`${host} failed: ${error instanceof Error ? error.message : String(error)}`, [token]))
    }
  }
  return {
    host,
    async graphql<Data>(request: Request<Data>): Promise<RawResponse<Data>> {
      const answer = await send(`https://${host}/api/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: request.query, variables: request.variables, operationName: request.operation }),
      })
      if (answer.status === 401 || answer.status === 403) {
        throw new Failure('unauthorized', `${host} refused the token (HTTP ${answer.status})`)
      }
      return decodeGraphql<Data>(await answer.json())
    },
    async put(path: string) {
      const answer = await send(`https://${host}/api/v4/${path}`, { method: 'PUT', headers: { Accept: 'application/json' } })
      return { status: answer.status, text: await answer.text() }
    },
  }
}

/** The user's open MRs with GitLab's merge verdicts, read side by side as the mod's `read-gitlab.ts` reads them. */
export async function openMrs(gitlab: GitLab): Promise<MrCard[]> {
  let features: HostFeatures = { hasMergeVerdict: true, hasReviewStates: true, hasTodoEntity: true, hasDiffLines: true, hasCommentFilter: true }
  let authored = await gitlab.graphql(authoredQuery(features, { kind: 'open' }))
  const lacking = missingFeatures(authored)
  if (lacking.length > 0) {
    features = { ...features, ...Object.fromEntries(lacking.map(feature => [feature, false])) }
    authored = await gitlab.graphql(authoredQuery(features, { kind: 'open' }))
  }
  const asked = mergeStatusQuery(features)
  const status = asked === null ? null : await gitlab.graphql(asked).catch(() => null)
  // The list leaves out the jobs; an MR whose row draws from them is read again on its own, as `read-gitlab.ts` does.
  const withoutJobs = new Set<string>()
  const singles = await Promise.all(
    jobsWanted(gitlab.host, authored).map(pin =>
      gitlab
        .graphql(pinnedQuery(pin, features))
        .then(answer => pinnedMr(answer) ?? Promise.reject(new Failure('bad-answer', 'GitLab sent no MR')))
        .then(
          raw => [slimCard(toCard(gitlab.host, raw))],
          () => {
            withoutJobs.add(pinKey(pin))
            return []
          }
        )
    )
  )
  return cardsFrom(gitlab.host, authored, status, singles.flat(), withoutJobs)
}

/** GitLab's answers as cards with their verdicts: a failed verdict read leaves every card without one, as in the mod. */
export function cardsFrom(
  host: string,
  authored: RawResponse<AuthoredQuery | AuthoredPlainQuery>,
  status: RawResponse<MergeStatusQuery> | null,
  singles: readonly MrCard[] = [],
  withoutJobs: ReadonlySet<string> = new Set()
): MrCard[] {
  const verdicts: Map<string, GitLabVerdict> | null =
    status === null ? null : new Map([...readMergeStatus(host, status)].map(([key, verdict]) => [key, { ...verdict, checks: slimChecks(verdict.checks) ?? verdict.checks }]))
  const fetched = listedMrs(authored).map(raw => slimCard(toCard(host, raw)))
  return mergeReads({ scope: 'open', base: [], fetched, singles, pinned: new Set(), verdicts, withoutJobs })
}

/**
 * What the panel draws: the pane's own rows (`buildPane`, the model `pane.tsx` draws), in its sections, with every fold
 * open and no room limit, since an iframe has neither the engine's budget nor its folds. `handOff` is the task Claude is
 * handed for an MR's conflicts (`conflictsTask`), by card key, for the MRs whose one move is to hand them on.
 */
export type Panel = { sections: { label: string | null; rows: RowModel[] }[]; handOff: Record<string, string> }

export function panelOf(cards: readonly MrCard[], held: ReadonlyMap<string, Pressed>, now = Date.now()): Panel {
  const pane = buildPane(
    {
      cards,
      avatars: {},
      pinned: [],
      usual: {},
      browse: '',
      expanded: ['more', 'parked', 'drafts'],
      repoFilter: '',
      view: 'mine',
      news: { count: 0, keys: [] },
      landed: [],
      search: '',
      inbox: [],
      poll: { fetchedAt: now, error: null, hosts: {} },
      isReading: false,
      isSyncing: false,
      isWaking: false,
      failures: {},
      pressed: Object.fromEntries(held),
      // No thread works in a repo, so the core offers no conflicts move; the panel hands them on as a message instead.
      here: null,
    },
    now,
    { hasSvg: true },
    { room: Number.POSITIVE_INFINITY, sizeOf: () => 0 }
  )
  const folds = [pane.parked, pane.drafts].flatMap(fold => (fold !== null && fold.rows.length > 0 ? [{ label: fold.label, rows: fold.rows }] : []))
  // Whether conflicts would go to Claude from a session in the MR's repo: what the core says with `isHere`.
  const handOff = Object.fromEntries(cards.flatMap(card => (nextMove(card, undefined, true)?.press?.kind === 'conflicts' ? [[card.key, lines(conflictsTask(card))]] : [])))
  return { sections: [{ label: null, rows: pane.mine.rows }, ...folds], handOff }
}
