// A reply to a thread on an MR's page, on plain data: the lines of the diff the thread was left on as one hunk to draw,
// the reply box's steps, and what GitLab's answer to a reply means. Pure; replies.ts holds the box and sends the reply.
import type { RawResponse } from './gitlab-documents.ts'
import type { ReplyMutation } from './gitlab.generated.ts'
import { shorten } from './graphemes.ts'

import type { FailureKind, ReplyBox } from '../types'

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

/** No reply box open. */
export const CLOSED: ReplyBox = { thread: '', text: '', stage: 'writing', reason: '' }

/** The box under `thread`, holding what was last typed there. */
export const openedBox = (thread: string, typed: Readonly<Record<string, string>>): ReplyBox => ({ thread, text: typed[thread] ?? '', stage: 'writing', reason: '' })

/** Enter in the box: text with something in it waits to be confirmed; nothing but spaces keeps the box as it is. */
export const reviewed = (box: ReplyBox, text: string): ReplyBox => (text.trim() !== '' ? { ...box, text, stage: 'confirming', reason: '' } : { ...box, text })

/** Whether a press may post the box's text under `thread`: only once it was confirmed, or to try again after a failure. */
export const isPostable = (box: ReplyBox, thread: string): boolean => thread !== '' && box.thread === thread && (box.stage === 'confirming' || box.stage === 'failed')

export type Posted = { isPosted: true } | { isPosted: false; reason: string }

/**
 * Whether a write that had no answer from GitLab may still have been made: a connection that dropped or ran out of time,
 * or GitLab's edge answering 5xx, may have done so after GitLab kept the reply. A refused token or a request GitLab could
 * not read was never made.
 */
export const mayHavePosted = (failure: { kind: FailureKind }): boolean => failure.kind === 'network' || failure.kind === 'timeout' || failure.kind === 'server'

/** Why a reply that never had GitLab's answer failed; one that may have been kept says to look before posting again. */
export const reasonOf = (failure: { kind: FailureKind; message: string }): string =>
  mayHavePosted(failure) ? `${failure.message}. It may have reached GitLab: look in the thread before posting again.` : failure.message

/** A box a reload caught while its reply was out, whose answer is lost with the reload: failed, since it may have posted. */
export const unanswered = (box: ReplyBox): ReplyBox =>
  box.stage === 'posting' ? { ...box, stage: 'failed', reason: reasonOf({ kind: 'network', message: 'The pane reloaded before GitLab answered' }) } : box

/** GitLab's words on one line. */
const oneLine = (words: readonly string[]): string => words.map(word => word.replace(/\s+/gu, ' ').trim()).join('; ')

/**
 * What GitLab's answer to a reply means. A refusal of the whole write (a token that may only read, a thread gone) comes
 * as errors beside no payload, which never name the scope and read the same for a thread one may not answer, so the pane
 * says what a read-only token gets without claiming that is the cause; the payload's own errors say why GitLab
 * kept no note; a reply of quick actions alone runs them and keeps none.
 */
export function postedOf(host: string, response: RawResponse<ReplyMutation>): Posted {
  const made = response.data?.createNote ?? null
  if (made === null) {
    const errors = (response.errors ?? []).map(error => error.message)
    return {
      isPosted: false,
      reason:
        errors.length > 0
          ? `${host} refused the reply: ${oneLine(errors)}. A token with only the read_api scope is refused so; replying needs api.`
          : `${host} sent no answer to the reply`,
    }
  }
  if (made.note !== null) {
    return { isPosted: true }
  }
  if (made.errors.length > 0) {
    return { isPosted: false, reason: `${host} did not post the reply: ${oneLine(made.errors)}` }
  }
  const quick = made.quickActionsStatus?.errorMessages ?? []
  return {
    isPosted: false,
    reason:
      made.quickActionsStatus?.commandsOnly === true
        ? `${host} ran the quick actions in the reply and kept no note${quick.length > 0 ? `: ${oneLine(quick)}` : ''}`
        : `${host} kept no note of the reply`,
  }
}
