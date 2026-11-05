import type { EngineInterface } from 'claude-code'

import { asFailure, Failure } from './failure'
import { lostIn, readMergeStatus, readPinned, readResponse } from './gitlab'
import { AUTHORED_PAGE, authoredQuery } from './authored-request'
import type { AuthoredScope } from './authored-request'
import { mergeStatusQuery, pinnedQuery } from './gitlab-documents'
import { askVariant } from './graphql'
import { cursorAfter, mergeReads, MOVING_MAX, movingRows, scopeFor } from './incremental'
import { pinKey } from './mr-url'
import { slimCard, slimChecks } from './slim'
import type { Cursor } from './snapshot'

import type { MrCard, Pinned } from '../types'

// Every question put to GitLab for the MRs. Only the leader asks the whole list; a session that draws what the leader
// read asks nothing, and one that raised an MR but draws no pane asks for those MRs alone (`readRaised`).

/** What the leader knows of a host before it reads it, and what it was asked for. */
export type HostAsk = {
  host: string
  /** The host's rows as the last read left them. */
  base: readonly MrCard[]
  /** Every MR pinned on the host by any session. */
  pinned: readonly Pinned[]
  /** Keys of the cards the last read had to ask for one by one. */
  extras: ReadonlySet<string>
  cursor: Cursor | undefined
  /** Whether a whole read is wanted, because a person asked for a fresh one. */
  isFresh: boolean
  now: number
}

export type HostRead = {
  rows: MrCard[]
  /** Authored MRs GitLab timed out and sent back null, whose keys it therefore never said. */
  lost: number
  /** What went wrong without failing the read. */
  notes: Failure[]
  /** The cards this read asked for one by one that the authored list lacks. */
  extras: string[]
  cursor: Cursor
  scope: AuthoredScope['kind']
}

const asPin = (card: MrCard): Pinned => ({ url: card.url, host: card.host, path: card.path, iid: card.iid })

/**
 * One host: the authored MRs (whole, or what changed since the last read), GitLab's merge verdicts for them, then the MRs
 * that are asked for one by one: pinned ones the list lacks (someone else's, or merged) and, in a delta, those whose
 * pipeline is running, as the delta does not say that it moved.
 */
export async function readHost($: EngineInterface, input: HostAsk): Promise<HostRead> {
  const { host, base, pinned, extras, cursor, now } = input
  const moving = movingRows(base)
  // Reading a running pipeline's MR one by one costs about two thirds of a whole read, so past a few, read whole.
  const wanted = scopeFor(cursor, now, input.isFresh)
  const scope: AuthoredScope = wanted.kind === 'since' && moving.length > MOVING_MAX ? { kind: 'open' } : wanted
  const notes: Failure[] = []
  // The merge verdict comes from a query of its own, read alongside; a host without it, or a failed read of it, leaves
  // every card without a verdict, and none says it can merge.
  const [authored, verdicts] = await Promise.all([
    askVariant($, host, features => authoredQuery(features, scope)),
    askVariant($, host, mergeStatusQuery)
      .then(answer => (answer !== null ? new Map([...readMergeStatus(host, answer)].map(([key, checks]) => [key, slimChecks(checks) ?? checks])) : null))
      .catch((error: unknown) => {
        notes.push(asFailure(error, message => `merge status: ${message}`))
        return null
      }),
  ])
  const fetched = readResponse(host, authored).map(slimCard)
  const lost = lostIn(authored)
  // A delta that fills a page may have more behind it, which a whole read has.
  if (scope.kind === 'since' && fetched.length + lost >= AUTHORED_PAGE) {
    return readHost($, { ...input, isFresh: true })
  }
  const fetchedKeys = new Set(fetched.map(card => card.key))
  const baseKeys = new Set(base.map(card => card.key))
  const pins = pinned.filter(pin => !fetchedKeys.has(pinKey(pin)) && (scope.kind === 'open' || extras.has(pinKey(pin)) || !baseKeys.has(pinKey(pin))))
  const asked = new Set(pins.map(pinKey))
  const movingSingles = scope.kind === 'since' ? moving.filter(row => !fetchedKeys.has(row.key) && !asked.has(row.key)).map(asPin) : []
  const singles = await Promise.all([...pins, ...movingSingles].map(async pin => readPinned(host, await askVariant($, host, features => pinnedQuery(pin, features))).map(slimCard)))
  const rows = mergeReads({ scope: scope.kind, base, fetched, singles: singles.flat(), pinned: new Set(pinned.map(pinKey)), verdicts })
  return {
    rows,
    lost,
    notes,
    extras: [...asked],
    // A read that lost MRs starts again from where it was, so they are asked for once more.
    cursor: lost > 0 && cursor !== undefined ? cursor : cursorAfter(scope, now, cursor),
    scope: scope.kind,
  }
}

export type Read = { host: string; answer: HostRead } | { host: string; failure: Failure }

/** Every configured host read at once; one that fails is told apart from the rest, which still count. */
export function readGitLab($: EngineInterface, inputs: readonly HostAsk[]): Promise<Read[]> {
  return Promise.all(
    inputs.map(input =>
      readHost($, input).then(
        (answer): Read => ({ host: input.host, answer }),
        (error: unknown): Read => ({ host: input.host, failure: asFailure(error) })
      )
    )
  )
}

/** One MR read on its own, as a shared card; none when GitLab names no such MR or project (out of reach). */
export async function readSingle($: EngineInterface, pin: Pinned): Promise<MrCard | null> {
  return readPinned(pin.host, await askVariant($, pin.host, features => pinnedQuery(pin, features))).map(slimCard)[0] ?? null
}

/** One MR read whole: its description and every thread, which the shared cards leave out. */
export async function readWhole($: EngineInterface, pin: Pinned): Promise<MrCard | null> {
  return readPinned(pin.host, await askVariant($, pin.host, features => pinnedQuery(pin, features)))[0] ?? null
}

/** Each of the MRs a session raised, read one by one, for a session that draws no pane. A host that fails loses only its own. */
export async function readRaised($: EngineInterface, pins: readonly Pinned[]): Promise<{ cards: MrCard[]; failures: Failure[] }> {
  const reads = await Promise.all(
    pins.map(pin =>
      readSingle($, pin).then(
        (card): MrCard[] | Failure => (card !== null ? [card] : []),
        (error: unknown): MrCard[] | Failure => asFailure(error)
      )
    )
  )
  return { cards: reads.flatMap(read => (read instanceof Failure ? [] : read)), failures: reads.flatMap(read => (read instanceof Failure ? [read] : [])) }
}
