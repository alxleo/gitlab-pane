import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { ensureDetail } from './detail'
import { quietly } from './failures'
import { replyMutation } from './page-documents'
import { ask } from './graphql'
import { CLOSED, decideArm, decidePost, mayTakeBack, openedBox, postedOf, replyId, sayOf, tooLong } from './reply-model'
import { refusalOf } from './write-model'
import { claimWrite, forgetWrite, setWrite } from './writes'

import type { Note, ReplyBox } from '../types'

// The reply box open on an MR's page, and what was typed in each thread's box. How far a reply got (confirmed, out,
// failed) is its entry in the ledger of writes, `reply:` and the thread. The engine reads an atom only in the file that
// declares it, so everything that reads or writes these goes through the functions below.
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

/** Enter in the box: text with something in it waits, armed, for the press that posts exactly it. Nothing is sent. */
export function confirmReply($: EngineInterface, thread: string, text: string): void {
  quietly($, armReply($, thread, text))
}

async function armReply($: EngineInterface, thread: string, text: string): Promise<void> {
  const at = await $.clock.now()
  await update($, typedAtom, typed => ({ ...typed, [thread]: text }))
  const say = tooLong(text)
  if (say !== null) {
    await update($, replyAtom, box => (box.thread === thread ? { ...box, say } : box))
    return
  }
  await claimWrite($, replyId(thread), held => decideArm(held, text, at))
}

/** Back from confirming, or from a failure, to the box with the text in it. */
export function editReply($: EngineInterface, thread: string): void {
  quietly($, takeBack($, thread, true))
}

/** Closes the box, and drops a reply confirmed or failed under it; what was typed stays for the next time it opens. */
export function closeReply($: EngineInterface, thread: string): void {
  quietly($, takeBack($, thread, false))
}

async function takeBack($: EngineInterface, thread: string, isEditing: boolean): Promise<void> {
  const at = await $.clock.now()
  const { isGone, held } = await forgetWrite($, replyId(thread), now => mayTakeBack(now, at))
  if (!isGone) {
    return
  }
  await update($, replyAtom, () => (isEditing ? { thread, text: held?.on ?? '', say: '' } : CLOSED))
}

/** Leaving the page: the box goes, what was typed staying; a reply confirmed, out or failed keeps its entry, to say how it ended. */
export function putAwayReply($: EngineInterface): void {
  quietly(
    $,
    update($, replyAtom, () => CLOSED)
  )
}

/**
 * Posts `text`, as confirmed and drawn under `note`'s thread on the MR `key` of `host`, as the token's owner, once
 * (`decidePost`). The MR is read whole again after a reply GitLab kept, or one whose fate is unknown, so the thread shows
 * it; the entry goes on success and says why on failure.
 */
export function postReply($: EngineInterface, key: string, host: string, note: Note, text: string): void {
  quietly($, post($, key, host, note, text))
}

async function post($: EngineInterface, key: string, host: string, note: Note, text: string): Promise<void> {
  const { answer } = note
  if (answer === undefined) {
    return
  }
  const id = replyId(note.url)
  const at = await $.clock.now()
  if ((await claimWrite($, id, held => decidePost(held, text, at))) === null) {
    return
  }
  const refusal = await ask($, host, replyMutation(answer.mr, answer.thread, text)).then(
    response => postedOf(host, response),
    (error: unknown) => refusalOf(error)
  )
  if (refusal === null || refusal.mayHaveLanded) {
    // The entry settles whatever this read does: a reply GitLab kept shows at the next read if not at this one.
    await ensureDetail($, key, true).catch(() => undefined)
  }
  if (refusal === null) {
    await Promise.all([
      setWrite($, id, null),
      update($, typedAtom, typed => Object.fromEntries(Object.entries(typed).filter(([thread]) => thread !== note.url))),
      update($, replyAtom, current => (current.thread === note.url ? CLOSED : current)),
    ])
    return
  }
  await setWrite($, id, { kind: 'reply', state: 'failed', on: text, at, say: sayOf(refusal) })
}
