// The one part of the read path that is not the core: how a token is found and how a document reaches GitLab. In the
// Claude Code mod these are `tokens.ts` and `graphql.ts`, which go through the session's `$` (its fetch, settings,
// in-memory atoms). Here they are Node's global fetch and the environment. Everything else is the core, imported as is.
import { execFileSync } from 'node:child_process'

import { authoredQuery } from '../../hooks/authored-request.ts'
import { decodeGraphql } from '../../hooks/decode.ts'
import { Failure } from '../../hooks/failure.ts'
import type { RawResponse, Request } from '../../hooks/gitlab-documents.ts'
import type { AuthoredPlainQuery, AuthoredQuery } from '../../hooks/gitlab.generated.ts'
import { missingFeatures, readResponse } from '../../hooks/gitlab.ts'
import { redact } from '../../hooks/hosts.ts'
import { cardFacts } from '../../hooks/row-facts.ts'
import { statusMark } from '../../hooks/status.ts'
import { foreign } from '../../hooks/model-text.ts'

import type { HostFeatures, MrCard } from '../../types/index.d.ts'

/** A row of the panel: what the core says of a card, flattened for an iframe that runs no core code. */
export type Row = {
  key: string
  url: string
  title: string
  ticket: string | null
  draft: boolean
  pipeline: { glyph: string; tone: string; url: string | null }
  verdict: { words: string; tone: string } | null
  badges: { glyph: string; words: string; tone: string }[]
  people: { call: string; initials: string; openThreads: number }[]
  updatedAt: string
}

/** A token for `host`: GITLAB_TOKEN, else the one glab stored for the host, as the mod's own `tokens.ts` asks for it. */
function tokenFor(host: string): string {
  const fromEnv = process.env.GITLAB_TOKEN ?? ''
  if (fromEnv !== '') {
    return fromEnv
  }
  try {
    const stored = execFileSync('glab', ['config', 'get', 'token', '--host', host], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (stored === '') {
      throw new Error('empty')
    }
    return stored
  } catch {
    throw new Failure('unauthorized', `no token for ${host}: set GITLAB_TOKEN or run glab auth login --hostname ${host}`)
  }
}

async function post<Data>(host: string, token: string, request: Request<Data>): Promise<RawResponse<Data>> {
  let answer: Response
  try {
    answer = await fetch(`https://${host}/api/graphql`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: request.query, variables: request.variables, operationName: request.operation }),
    })
  } catch (error) {
    throw new Failure('network', redact(`${host} failed: ${error instanceof Error ? error.message : String(error)}`, [token]))
  }
  if (answer.status === 401 || answer.status === 403) {
    throw new Failure('unauthorized', `${host} refused the token (HTTP ${answer.status}): it needs read_api`)
  }
  return decodeGraphql<Data>(await answer.json())
}

/** The user's open MRs on `host`, most pressing first, as the core ranks them. */
export async function openMrs(host: string): Promise<{ cards: MrCard[]; rows: Row[] }> {
  const token = tokenFor(host)
  let features: HostFeatures = { hasMergeVerdict: true, hasReviewStates: true, hasTodoEntity: true, hasDiffLines: true }
  let response = await post(host, token, authoredQuery(features, { kind: 'open' }))
  const lacking = missingFeatures(response)
  if (lacking.length > 0) {
    features = { ...features, ...Object.fromEntries(lacking.map(feature => [feature, false])) }
    response = await post(host, token, authoredQuery(features, { kind: 'open' }))
  }
  return rowsFrom(host, response)
}

/** GitLab's answer to the authored read as ranked cards and the rows the panel draws: the core, end to end. */
export function rowsFrom(host: string, response: RawResponse<AuthoredQuery | AuthoredPlainQuery>): { cards: MrCard[]; rows: Row[] } {
  const cards = readResponse(host, response)
  const ranked = cards.map(card => ({ card, facts: cardFacts(card, {}) })).toSorted((a, b) => a.facts.rank - b.facts.rank)
  const rows = ranked.map(({ card, facts }): Row => {
    const mark = statusMark(card.pipeline?.status)
    return {
      key: card.key,
      url: card.url,
      title: foreign(facts.title, 200),
      ticket: facts.ticket,
      draft: card.isDraft,
      pipeline: { glyph: mark.glyph, tone: mark.tone, url: card.pipeline?.url ?? null },
      verdict: facts.verdict === null ? null : { words: facts.verdict.words, tone: facts.verdict.tone },
      badges: facts.row.map(badge => ({ glyph: badge.glyph, words: badge.words, tone: badge.tone })),
      people: facts.people.map(person => ({ call: foreign(person.call), initials: person.initials, openThreads: person.openThreads })),
      updatedAt: card.updatedAt,
    }
  })
  return { cards: ranked.map(each => each.card), rows }
}
