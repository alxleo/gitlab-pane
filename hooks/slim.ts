// A card as the sessions share it. Every session draws the cards one of them read, so the cards pass through the store
// (a file all sessions rewrite whole, capped at 4 MiB) and through `$.state`, and a card is kept to what a row, a hover
// card and a wake say. What only an opened card or a page says (the description, the threads' words, the jobs that
// neither failed nor wait) is read again for the one card the person opens: `withDetail` puts it back. Pure.
import { excerpt } from './format.ts'
import { cleanBody } from './gitlab.ts'
import { JOBS_SHOWN, listedJobs } from './job-lines.ts'

import type { MrCard, Note } from '../types'

/** A note as an excerpt: its words are the first line worth reading, and nothing answers it. */
const quoted = (note: Note, card: MrCard): Note => ({
  author: note.author,
  body: cleanBody(excerpt(note.body), card.host, card.path),
  url: note.url,
  at: note.at,
  ...(note.where !== undefined ? { where: note.where } : {}),
  isOpen: note.isOpen,
})

/**
 * The card without its heavy words: no description (its first line stays as `lead`), each person's latest note as an
 * excerpt (`noteCount` still says how many), each open thread as an excerpt with no replies, and of the stages' jobs only
 * those the card lists (`moreJobs` counts the rest); `ran` keeps when every job ran.
 */
export function slimCard(card: MrCard): MrCard {
  const { pipeline } = card
  const kept = pipeline !== undefined ? new Set(listedJobs(pipeline.stages).slice(0, JOBS_SHOWN)) : new Set()
  return {
    ...card,
    description: cleanBody('', card.host, card.path),
    people: card.people.map(person => ({ ...person, notes: person.notes.slice(0, 1).map(note => quoted(note, card)) })),
    openThreads: card.openThreads.map(note => quoted(note, card)),
    ...(pipeline !== undefined
      ? {
          pipeline: {
            ...pipeline,
            stages: pipeline.stages.map(stage => ({ ...stage, jobs: stage.jobs.filter(job => kept.has(job)) })),
            moreJobs: pipeline.moreJobs + listedJobs(pipeline.stages).length - kept.size,
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
  }
}
