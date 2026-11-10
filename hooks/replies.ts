import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { ensureDetail } from './detail'
import { asFailure } from './failure'
import { quietly } from './failures'
import { replyMutation } from './page-documents'
import { ask } from './graphql'
import { joined } from './in-flight'
import { CLOSED, isPostable, mayHavePosted, openedBox, postedOf, reasonOf, reviewed, unanswered } from './reply-model'
import type { Posted } from './reply-model'

import type { Note, ReplyBox } from '../types'

// The reply being written on an MR's page, and what was typed in each thread's box. The engine reads an atom only in the
// file that declares it, so everything that reads or writes them goes through the functions below.
const replyAtom = atom({ plugin: 'gitlab-pane', key: 'reply' } as const, CLOSED)
// Not read by the drawing, so typing into a box redraws nothing: the box keeps what is typed in it, and a box opened again
// starts from what was typed there before.
const typedAtom = atom({ plugin: 'gitlab-pane', key: 'typed' } as const, {})

/** The reply box the page draws; reading it here makes the pane redraw when it changes. */
export function drawnReply($: EngineInterface): Promise<ReplyBox> {
  return read($, replyAtom)
}

/** Opens the box under the thread `thread` (its first note's address), closing any other. */
export function openReply($: EngineInterface, thread: string): void {
  quietly(
    $,
    read($, typedAtom).then(typed => update($, replyAtom, () => openedBox(thread, typed)))
  )
}

/** Keeps what is in the box as it is typed, for when it is opened again. */
export function typeReply($: EngineInterface, thread: string, text: string): void {
  quietly(
    $,
    update($, typedAtom, typed => ({ ...typed, [thread]: text }))
  )
}

/** Enter in the box: its text waits to be confirmed. Nothing is sent. */
export function confirmReply($: EngineInterface, thread: string, text: string): void {
  quietly($, Promise.all([update($, typedAtom, typed => ({ ...typed, [thread]: text })), update($, replyAtom, box => (box.thread === thread ? reviewed(box, text) : box))]))
}

/** Back from confirming, or from a failure, to the box with the text in it. */
export function editReply($: EngineInterface): void {
  quietly(
    $,
    update($, replyAtom, (box): ReplyBox => ({ ...box, stage: 'writing', reason: '' }))
  )
}

/** Closes the box; what was typed in it stays for the next time it opens. */
export function closeReply($: EngineInterface): void {
  quietly(
    $,
    update($, replyAtom, () => CLOSED)
  )
}

/** Leaving the page: a box being written goes, what was typed staying; one posting or failed stays, to say how it ended. */
export function putAwayReply($: EngineInterface): void {
  quietly(
    $,
    update($, replyAtom, box => (box.stage === 'posting' || box.stage === 'failed' ? box : CLOSED))
  )
}

/** A mod loading: a reply that was out when it went has lost its answer, and its box says so instead of posting for good. */
export async function forgetPosting($: EngineInterface): Promise<void> {
  if ((await read($, replyAtom)).stage === 'posting') {
    await update($, replyAtom, unanswered)
  }
}

/**
 * Posts the confirmed text under `note`'s thread on the MR `key` of `host`, as the token's owner, once: a press while it
 * is out joins it, and a box that was not confirmed sends nothing. The MR is read whole again after a reply GitLab kept,
 * or one whose fate is unknown, so the thread shows it; the box closes on success and keeps the text, saying why, on failure.
 */
export function postReply($: EngineInterface, key: string, host: string, note: Note): void {
  quietly(
    $,
    joined(`reply:${note.url}`, () => post($, key, host, note))
  )
}

async function post($: EngineInterface, key: string, host: string, note: Note): Promise<void> {
  const box = await read($, replyAtom)
  const { answer } = note
  if (answer === undefined || !isPostable(box, note.url)) {
    return
  }
  await update($, replyAtom, () => ({ ...box, stage: 'posting', reason: '' }))
  let posted: Posted
  let isUnknown = false
  try {
    posted = postedOf(host, await ask($, host, replyMutation(answer.mr, answer.thread, box.text)))
  } catch (error) {
    const failure = asFailure(error)
    isUnknown = mayHavePosted(failure)
    posted = { isPosted: false, reason: reasonOf(failure) }
  }
  if (posted.isPosted || isUnknown) {
    // The box settles whatever this read does: a reply GitLab kept shows at the next read if not at this one.
    await ensureDetail($, key, true).catch(() => undefined)
  }
  if (posted.isPosted) {
    await Promise.all([
      update($, typedAtom, typed => Object.fromEntries(Object.entries(typed).filter(([thread]) => thread !== note.url))),
      update($, replyAtom, current => (current.thread === note.url ? CLOSED : current)),
    ])
    return
  }
  const { reason } = posted
  await update($, replyAtom, (current): ReplyBox => (current.thread === note.url ? { ...current, stage: 'failed', reason } : current))
}
