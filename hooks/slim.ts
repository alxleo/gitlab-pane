// A card as the sessions share it. Every session draws the cards one of them read, so the cards pass through the store
// (a file all sessions rewrite whole, capped at 4 MiB) and through `$.state`, and a card is kept to what a row, a hover
// card and a wake say. What only an opened card or a page says (the description, the threads' words, the jobs that
// neither failed nor wait) is read again for the one card the person opens: `withDetail` puts it back. Pure.
import { excerpt } from './format.ts'
import { cleanBody } from './gitlab.ts'
import { listedJobs } from './job-lines.ts'
import { isSettled } from './status.ts'

import type { Job, MergeStatus, MrCard, Note } from '../types'

/** A note as an excerpt: its words are the first line worth reading, and nothing answers it. */
const quoted = (note: Note, card: MrCard): Note => ({
  author: note.author,
  body: cleanBody(excerpt(note.body), card.host, card.path),
  url: note.url,
  at: note.at,
  ...(note.where !== undefined ? { where: note.where } : {}),
  isOpen: note.isOpen,
})

/** The most jobs, and open threads, a shared card keeps by name; it counts the rest, and an opened card is read whole. */
const SHARED_KEPT = 3

/**
 * The checks a row reads: those that fail, warn or are still being made, and one that passed, which is all that tells a
 * merge that can go ahead; the rest say nothing a row shows.
 */
export const slimChecks = (checks: MergeStatus | null): MergeStatus | null => {
  if (checks === null) {
    return null
  }
  const passed = checks.find(check => check.status === 'success')
  return [...checks.filter(check => ['failed', 'warning', 'checking', 'unknown'].includes(check.status)), ...(passed !== undefined ? [passed] : [])]
}

/**
 * The card without its heavy words: no description (its first line stays as `lead`), each person's latest note as an
 * excerpt (`noteCount` still says how many), the first few open threads as excerpts with no replies and the first few failed
 * jobs, the rest counted; of the stages' jobs only those the card lists, and when each ran only where a row shows it. The
 * store every session rewrites whole holds fifty of these in a few hundred kilobytes.
 */
export function slimCard(card: MrCard): MrCard {
  const { pipeline } = card
  const listed = pipeline !== undefined ? listedJobs(pipeline.stages) : []
  const kept = new Set<Job>(listed.slice(0, SHARED_KEPT))
  const held = new Set(card.people.map(person => person.username))
  const threads = [...card.openThreads.filter(note => !held.has(note.author)), ...card.openThreads.filter(note => held.has(note.author))]
  const keptThreads = threads.slice(0, SHARED_KEPT)
  const left = threads.slice(SHARED_KEPT)
  return {
    ...card,
    description: cleanBody('', card.host, card.path),
    people: card.people.map(person => ({ ...person, notes: person.notes.slice(0, 1).map(note => quoted(note, card)) })),
    openThreads: keptThreads.map(note => quoted(note, card)),
    threadsLeft: {
      loose: card.threadsLeft.loose + left.filter(note => !held.has(note.author)).length,
      held: card.threadsLeft.held + left.filter(note => held.has(note.author)).length,
    },
    mergeStatus: slimChecks(card.mergeStatus),
    // Each reviewer is a person on the card, with their state; the list of them alone is read by no row.
    reviewers: [],
    ...(pipeline !== undefined
      ? {
          pipeline: {
            ...pipeline,
            // A pipeline that has settled with its duration needs only the time of a stage a row names (one that did not pass).
            stages: pipeline.stages.map(stage => ({
              ...stage,
              jobs: stage.jobs.filter(job => kept.has(job)),
              ran: isSettled(pipeline.status) && pipeline.duration !== null && stage.status === 'success' ? { done: [], running: [] } : stage.ran,
            })),
            moreJobs: pipeline.moreJobs + listed.length - kept.size,
            failed: pipeline.failed.slice(0, SHARED_KEPT),
            moreFailed: pipeline.moreFailed + Math.max(0, pipeline.failed.length - SHARED_KEPT),
            amber: pipeline.amber.slice(0, SHARED_KEPT),
            moreAmber: pipeline.moreAmber + Math.max(0, pipeline.amber.length - SHARED_KEPT),
          },
        }
      : {}),
  }
}

/**
 * A shared card with the words of the same card read whole. A read of a card that has changed since says nothing of this
 * one's threads, so then the shared card stands as it is.
 */
export function withDetail(shared: MrCard, whole: MrCard | undefined): MrCard {
  if (whole === undefined || whole.updatedAt !== shared.updatedAt) {
    return shared
  }
  return {
    ...shared,
    description: whole.description,
    people: shared.people.map(person => ({ ...person, notes: whole.people.find(each => each.username === person.username)?.notes ?? person.notes })),
    openThreads: whole.openThreads,
    threadsLeft: whole.threadsLeft,
    // The jobs, too, if it is the same pipeline in the same state; one that moved since is the shared card's to say.
    ...(shared.pipeline !== undefined && whole.pipeline !== undefined && shared.pipeline.id === whole.pipeline.id && shared.pipeline.status === whole.pipeline.status
      ? { pipeline: { ...shared.pipeline, failed: whole.pipeline.failed, moreFailed: whole.pipeline.moreFailed, amber: whole.pipeline.amber, moreAmber: whole.pipeline.moreAmber } }
      : {}),
  }
}
