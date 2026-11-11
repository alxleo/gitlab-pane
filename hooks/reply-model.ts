// A reply to a thread on an MR's page, on plain data: the lines of the diff the thread was left on as one hunk to draw,
// the reply box, and what GitLab's answer to a reply means. How far a reply got is its entry in the ledger of writes
// (write-model.ts). Pure; replies.ts holds the box and sends the reply.
import type { RawResponse } from './gitlab-documents.ts'
import type { ReplyMutation } from './gitlab.generated.ts'
import { shorten } from './graphemes.ts'
import { liveOf } from './write-model.ts'
import type { Refusal } from './write-model.ts'

import type { ReplyBox, Write } from '../types'

/** One line of the diff as GitLab sends it under a thread: `type` is `new`, `old`, null for context, or one of its own marks. */
export type DiffLine = { oldLine: number | null; newLine: number | null; type: string | null; text: string | null }

/** How many lines of the diff a thread shows, ending at the commented line: enough to recognise the place, not to review it. */
export const EXCERPT_LINES = 5

/** The text without what a drawing of code refuses: every control character but the tab. */
const drawable = (text: string): string => text.replace(/(?!\t)\p{Cc}/gu, '')

const signOf = (line: DiffLine): string => (line.type === 'new' ? '+' : line.type === 'old' ? '-' : ' ')

/**
 * The most characters of a line an excerpt keeps: a drawing cuts a long line only where it is drawn, and its whole length
 * counts against the page's room, so five lines of a minified file would push the page's other threads off it.
 */
export const LINE_MOST = 200

/** A line as a hunk holds it: its sign, then its text without the sign GitLab put first, nothing a drawing refuses, cut to LINE_MOST. */
const rowOf = (line: DiffLine): string => {
  const sign = signOf(line)
  const text = line.text ?? ''
  return `${sign}${shorten(drawable(text.startsWith(sign) ? text.slice(1) : text), LINE_MOST)}`
}

/**
 * The last few lines GitLab sent above a thread, up to the commented line, as one unified-diff hunk whose header numbers
 * them as in the file: old lines from the first that has an old number, new ones likewise. GitLab's own `@@` line and its
 * no-newline marks are not lines of the file. None when no line is left.
 */
export function hunkOf(lines: readonly DiffLine[]): string | null {
  const kept = lines.filter(line => line.type === null || line.type === 'new' || line.type === 'old').slice(-EXCERPT_LINES)
  if (kept.length === 0) {
    return null
  }
  const olds = kept.filter(line => line.type !== 'new')
  const news = kept.filter(line => line.type !== 'old')
  const start = (numbers: (number | null)[]) => numbers.find(number => number !== null) ?? 0
  const head = `@@ -${start(olds.map(line => line.oldLine))},${olds.length} +${start(news.map(line => line.newLine))},${news.length} @@`
  return [head, ...kept.map(rowOf)].join('\n')
}

/**
 * The longest reply the pane takes, in characters. A reply waiting to be confirmed is drawn whole, and its size counts
 * against the page's room, so a longer one would push its own buttons, and the threads after it, off the page.
 */
export const REPLY_MOST = 5_000

/** No reply box open. */
export const CLOSED: ReplyBox = { thread: '', text: '', say: '' }

/** The box under `thread`, holding what was last typed there, cut to what the pane takes. */
export const openedBox = (thread: string, typed: Readonly<Record<string, string>>): ReplyBox => ({ thread, text: shorten(typed[thread] ?? '', REPLY_MOST), say: '' })

/** Why the pane will not take `text` as a reply, or null when it will. */
export const tooLong = (text: string): string | null =>
  text.length > REPLY_MOST ? `${text.length.toLocaleString('en')} characters: the pane takes ${REPLY_MOST.toLocaleString('en')}; post a longer reply on GitLab` : null

/** The ledger's id of the reply under a thread, by its first note's address. */
export const replyId = (thread: string): string => `reply:${thread}`

/**
 * What Enter in the box records against the reply held under its thread (as it holds at `at`): the text armed, waiting
 * for `post`; nothing while a reply is out, or for text with nothing in it or longer than the pane takes.
 */
export function decideArm(held: Write | undefined, text: string, at: number): Write | null {
  const isOut = liveOf(held, at)?.state === 'sent'
  return isOut || text.trim() === '' || tooLong(text) !== null ? null : { kind: 'reply', state: 'armed', on: text, at }
}

/** Whether `edit` or `cancel` may take the reply held back: any time but while it is out. */
export const mayTakeBack = (held: Write | undefined, at: number): boolean => liveOf(held, at)?.state !== 'sent'

/**
 * What a press on `post` records against the reply held under its thread (as it holds at `at`): the reply sent, exactly
 * the text the press was drawn with, only while that text waits confirmed or failed; else nothing, so a second press, one
 * while it is out, or one from a drawing older than an edit sends nothing.
 */
export function decidePost(held: Write | undefined, text: string, at: number): Write | null {
  const live = liveOf(held, at)
  return (live?.state === 'armed' || live?.state === 'failed') && live.on === text ? { kind: 'reply', state: 'sent', on: text, at } : null
}

/** Why a reply was not posted; one that may have been kept all the same says to look before posting again. */
export const sayOf = (refusal: Refusal): string =>
  refusal.mayHaveLanded ? `${refusal.reason}. It may have reached GitLab: look in the thread before posting again.` : refusal.reason

/** GitLab, answering, turned the reply down: it was not made. */
const refused = (reason: string): Refusal => ({ reason, mayHaveLanded: false })

/** GitLab's words on one line. */
const oneLine = (words: readonly string[]): string => words.map(word => word.replace(/\s+/gu, ' ').trim()).join('; ')

/**
 * What GitLab's answer to a reply means. A refusal of the whole write (a token that may only read, a thread gone) comes
 * as errors beside no payload, which never name the scope and read the same for a thread one may not answer, so the pane
 * says what a read-only token gets without claiming that is the cause; the payload's own errors say why GitLab
 * kept no note; a reply of quick actions alone runs them and keeps none. Null when GitLab kept it.
 */
export function postedOf(host: string, response: RawResponse<ReplyMutation>): Refusal | null {
  const made = response.data?.createNote ?? null
  if (made === null) {
    const errors = (response.errors ?? []).map(error => error.message)
    return refused(
      errors.length > 0
        ? `${host} refused the reply: ${oneLine(errors)}. A token with only the read_api scope is refused so; replying needs api.`
        : `${host} sent no answer to the reply`
    )
  }
  if (made.note !== null) {
    return null
  }
  if (made.errors.length > 0) {
    return refused(`${host} did not post the reply: ${oneLine(made.errors)}`)
  }
  const quick = made.quickActionsStatus?.errorMessages ?? []
  return refused(
    made.quickActionsStatus?.commandsOnly === true
      ? `${host} ran the quick actions in the reply and kept no note${quick.length > 0 ? `: ${oneLine(quick)}` : ''}`
      : `${host} kept no note of the reply`
  )
}
