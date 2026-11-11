import type { EngineInterface } from 'claude-code'

import { Failure, kindOf, messageOf } from './failure'
import type { RawResponse } from './gitlab-documents'
import { ask, askVariant } from './graphql'
import { inboxAuthoredQuery, inboxFollowProjectQuery, inboxFollowUserQuery, inboxQueueQuery, inboxTodosQuery } from './inbox-requests'
import { authoredMrs, combine, followedProjectMrs, followedUserMrs, ownMrs, queueMrs, todoMrs } from './inbox-gitlab'
import type { Found } from './inbox-gitlab'
import { HORIZON_MS } from './inbox-rules'
import { noteOwn } from './jira-mover'
import { mergedLately } from './landed'
import type { Merged } from './landed'

import type { InboxFollow, InboxHost } from '../types'

// One GitLab host's inbox documents, asked at once, and what each makes of the inbox. inbox.ts sends one host after another and keeps
// what they found.

/** A document's data; an answer without any is the errors GitLab gave in its place. */
export function dataOf<Data>(answer: RawResponse<Data>): Data {
  if (answer.data === null || answer.data === undefined) {
    throw new Failure('bad-answer', answer.errors?.map(one => one.message).join('; ') ?? 'GitLab answered without data')
  }
  return answer.data
}

/**
 * What one host gave: the MRs the rules count, why a document failed, and the user's MRs merged lately, as the inbox's own
 * answer says (none when their document failed: the last read's stand). Their commits and builds are asked for apart from the
 * documents (`landed-read.ts`), so that a slow answer for one never holds back the rest.
 */
type HostRead = { found: Found; failure: InboxHost['failure']; merged: Merged[] | null }

type Tried = { label: string; found: Found } | { label: string; error: unknown }

async function tried(label: string, work: Promise<Found>): Promise<Tried> {
  try {
    return { label, found: await work }
  } catch (error) {
    return { label, error }
  }
}

/**
 * One host's documents (three, and one more per followed person or project), asked at once: a host that times one out loses only that one. What came is kept; why the
 * rest did not is the failure, with the document named unless every one failed the same way. The user's own answer also tells the
 * MRs they merged lately.
 */
export async function readHost($: EngineInterface, host: string, now: number, follows: readonly InboxFollow[]): Promise<HostRead> {
  const since = new Date(now - HORIZON_MS).toISOString()
  // The same answer tells the Jira moves who the user is here and which of their MRs merged, and the merged section what landed.
  const authored = ask($, host, inboxAuthoredQuery(since)).then(dataOf)
  const results = await Promise.all([
    tried(
      'to-dos',
      askVariant($, host, inboxTodosQuery).then(answer => todoMrs(host, dataOf(answer)))
    ),
    tried(
      'review queue',
      ask($, host, inboxQueueQuery()).then(answer => queueMrs(host, dataOf(answer), now))
    ),
    tried(
      'your MRs',
      authored.then(async data => {
        await noteOwn($, host, ownMrs(host, data))
        return authoredMrs(host, data, now)
      })
    ),
    ...follows.map(follow =>
      follow.kind === 'user'
        ? tried(
            `@${follow.name}`,
            ask($, host, inboxFollowUserQuery(follow.name, since)).then(answer => followedUserMrs(host, dataOf(answer), now))
          )
        : tried(
            follow.name,
            ask($, host, inboxFollowProjectQuery(follow.name, since)).then(answer => followedProjectMrs(host, dataOf(answer), now))
          )
    ),
  ])
  const founds = results.flatMap(one => ('found' in one ? [one.found] : []))
  const failed = results.flatMap(one => ('error' in one ? [{ label: one.label, error: one.error }] : []))
  const isSame = failed.length === results.length && new Set(failed.map(one => messageOf(one.error))).size === 1
  // Settled by now, as "your MRs" waited for it; a document that failed leaves none.
  const merged = await authored.then(
    data => mergedLately(host, data, now),
    () => null
  )
  const [first] = failed
  return {
    found: combine(founds),
    failure:
      first === undefined ? null : { kind: kindOf(first.error), message: isSame ? messageOf(first.error) : failed.map(one => `${one.label}: ${messageOf(one.error)}`).join('; ') },
    merged,
  }
}
