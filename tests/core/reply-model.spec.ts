import { expect, test } from 'vitest'
import fc from 'fast-check'

import { CLOSED, decidePost, EXCERPT_LINES, LINE_MOST, hunkOf, openedBox, postedOf, replyId, sayOf } from '../../hooks/reply-model.ts'
import type { DiffLine } from '../../hooks/reply-model.ts'
import { refusalOf, SENT_HOLDS_MS } from '../../hooks/write-model.ts'
import { decodeGraphql, parseJson } from '../../hooks/decode.ts'
import { Failure } from '../../hooks/failure.ts'
import type { ReplyMutation } from '../../hooks/gitlab.generated.ts'
import type { RawResponse } from '../../hooks/gitlab-documents.ts'

import type { FailureKind, Write } from '../../types'

const context = (old: number, now: number, text: string): DiffLine => ({ oldLine: old, newLine: now, type: null, text: ` ${text}` })
const removed = (old: number, text: string): DiffLine => ({ oldLine: old, newLine: null, type: 'old', text: `-${text}` })
const added = (now: number, text: string): DiffLine => ({ oldLine: null, newLine: now, type: 'new', text: `+${text}` })

/** GitLab's answer as the pane reads it: through the JSON a host sends. */
const answer = (raw: unknown): RawResponse<ReplyMutation> => decodeGraphql<ReplyMutation>(parseJson(JSON.stringify(raw)))

test('the lines a thread was left on read as one diff hunk: its last few, up to the commented line, numbered from where they start', () => {
  const lines = [
    { oldLine: null, newLine: null, type: 'match', text: '@@ -1,9 +1,10 @@' },
    context(3, 3, 'import x'),
    context(4, 4, ''),
    context(5, 5, 'const a = 1'),
    removed(6, 'const b = 2'),
    added(6, 'const b = 3'),
    added(7, 'const c = 4'),
    context(7, 8, 'return a + b'),
  ]
  expect(EXCERPT_LINES).toBe(5)
  expect(hunkOf(lines)).toBe(['@@ -5,3 +5,4 @@', ' const a = 1', '-const b = 2', '+const b = 3', '+const c = 4', ' return a + b'].join('\n'))
  // Fewer lines than that are all kept.
  expect(hunkOf([context(4, 4, ''), added(5, 'x')])).toBe(['@@ -4,1 +4,2 @@', ' ', '+x'].join('\n'))
})

test("a hunk leaves out GitLab's own @@ line and no-newline marks, keeps tabs, drops the control characters a drawing refuses; no lines is none", () => {
  const lines: DiffLine[] = [
    { oldLine: null, newLine: null, type: 'match', text: '@@ -1 +1 @@' },
    { oldLine: 1, newLine: null, type: 'old-nonewline', text: '\\ No newline at end of file' },
    { oldLine: 2, newLine: 2, type: null, text: ' \tred\u001b[31m words\r' },
    // A line GitLab sends without its text still holds its place.
    { oldLine: null, newLine: 3, type: 'new', text: null },
  ]
  expect(hunkOf(lines)).toBe(['@@ -2,1 +2,2 @@', ' \tred[31m words', '+'].join('\n'))
  // A file that is all new has no old lines to number.
  expect(hunkOf([added(1, 'first'), added(2, 'second')])).toBe(['@@ -0,0 +1,2 @@', '+first', '+second'].join('\n'))
  // A line of a minified or generated file is cut, so five of them cannot crowd the page's other threads out.
  const long = hunkOf([added(1, 'x'.repeat(5_000))]) ?? ''
  expect(long.split('\n')[1]).toBe(`+${'x'.repeat(LINE_MOST - 1)}…`)
  expect(hunkOf([])).toBeNull()
  expect(hunkOf([{ oldLine: null, newLine: null, type: 'match', text: '@@ -1 +1 @@' }])).toBeNull()
})

test('a hunk always says as many old and new lines as it holds, and never more lines than an excerpt keeps', () => {
  const line = fc.oneof(
    fc.record({ oldLine: fc.nat(500), newLine: fc.nat(500), type: fc.constant(null), text: fc.string() }),
    fc.record({ oldLine: fc.nat(500), newLine: fc.constant(null), type: fc.constant('old'), text: fc.string() }),
    fc.record({ oldLine: fc.constant(null), newLine: fc.nat(500), type: fc.constant('new'), text: fc.string() }),
    fc.record({ oldLine: fc.constant(null), newLine: fc.constant(null), type: fc.constant('match'), text: fc.string() })
  )
  /** Whether a drawing of code takes the row: a tab is its only control character. */
  const isDrawable = (row: string) => !/(?!\t)\p{Cc}/u.test(row)
  fc.assert(
    fc.property(fc.array(line, { maxLength: 16 }), lines => {
      const hunk = hunkOf(lines)
      // None only when no line is the file's; then the checks below read an empty hunk.
      expect(hunk === null).toBe(lines.every(each => each.type === 'match'))
      const [head = '', ...body] = (hunk ?? '@@ -0,0 +0,0 @@').split('\n')
      const counts = /^@@ -\d+,(\d+) \+\d+,(\d+) @@$/u.exec(head)
      expect(body.length).toBeLessThanOrEqual(EXCERPT_LINES)
      expect(body.every(row => /^[ +-]/u.test(row) && isDrawable(row))).toBe(true)
      expect([counts?.[1], counts?.[2]]).toEqual([String(body.filter(row => !row.startsWith('+')).length), String(body.filter(row => !row.startsWith('-')).length)])
    })
  )
})

test('a reply GitLab kept is posted; one it refused, would not keep, or ran as quick actions alone says why in one line', () => {
  /** GitLab answered, and kept no note: the reply was not made. */
  const not = (reason: string) => ({ reason, mayHaveLanded: false })
  expect(postedOf('gitlab.com', answer({ data: { createNote: { errors: [], note: { id: 'gid://gitlab/Note/9' }, quickActionsStatus: null } } }))).toBeNull()
  // A token of read_api alone may not write: GitLab refuses the whole mutation, with no word of the scope.
  const refusal = answer({
    data: { createNote: null },
    errors: [{ message: "The resource that you are attempting to access does not exist or you don't have permission to perform this action" }],
  })
  expect(postedOf('gitlab.com', refusal)).toEqual(
    not(
      "gitlab.com refused the reply: The resource that you are attempting to access does not exist or you don't have permission to perform this action. A token with only the read_api scope is refused so; replying needs api."
    )
  )
  expect(postedOf('gitlab.com', answer({ data: { createNote: { errors: ["Note can't be blank", 'Note is\ntoo long'], note: null, quickActionsStatus: null } } }))).toEqual(
    not("gitlab.com did not post the reply: Note can't be blank; Note is too long")
  )
  expect(postedOf('gitlab.com', answer({ data: { createNote: { errors: [], note: null, quickActionsStatus: { commandsOnly: true, errorMessages: [] } } } }))).toEqual(
    not('gitlab.com ran the quick actions in the reply and kept no note')
  )
  expect(
    postedOf(
      'gitlab.com',
      answer({ data: { createNote: { errors: [], note: null, quickActionsStatus: { commandsOnly: true, errorMessages: ['Could not apply merge command.'] } } } })
    )
  ).toEqual(not('gitlab.com ran the quick actions in the reply and kept no note: Could not apply merge command.'))
  expect(postedOf('gitlab.com', answer({ data: null }))).toEqual(not('gitlab.com sent no answer to the reply'))
  // No answer at all: a refused token says so; a dropped connection, or GitLab's edge answering 52x, may have come after
  // GitLab kept the reply.
  const failed = (kind: FailureKind, message: string) => sayOf(refusalOf(new Failure(kind, message)))
  expect(failed('unauthorized', 'gitlab.com refused the token (HTTP 403): it needs the api scope')).toBe('gitlab.com refused the token (HTTP 403): it needs the api scope')
  expect(failed('network', 'gitlab.com failed: connection reset')).toBe('gitlab.com failed: connection reset. It may have reached GitLab: look in the thread before posting again.')
  expect(failed('server', 'gitlab.com answered HTTP 524')).toBe('gitlab.com answered HTTP 524. It may have reached GitLab: look in the thread before posting again.')
})

test('a reply box opens on what was last typed for its thread; each thread’s reply has its own entry in the ledger', () => {
  const thread = 'https://gitlab.com/g/p/-/merge_requests/12#note_1'
  expect(openedBox(thread, { [thread]: 'half a thought' })).toEqual({ thread, text: 'half a thought' })
  expect(openedBox('other', { [thread]: 'half a thought' }).text).toBe('')
  expect(CLOSED).toEqual({ thread: '', text: '' })
  expect(replyId(thread)).toBe(`reply:${thread}`)
})

test('post sends exactly the text it was drawn with, once, and only while that text waits confirmed or failed', () => {
  const at = 1_000
  const held = (state: 'armed' | 'sent' | 'handed', on = 'Renamed it.'): Write => ({ kind: 'reply', state, on, at: 0 })
  expect(decidePost(held('armed'), 'Renamed it.', at)).toEqual({ kind: 'reply', state: 'sent', on: 'Renamed it.', at })
  expect(decidePost({ kind: 'reply', state: 'failed', on: 'Renamed it.', at: 0, say: 'HTTP 502' }, 'Renamed it.', at)?.state).toBe('sent')
  // A second press, or one while the reply is out, sends nothing; nor does a drawing older than an edit, nor no confirm.
  expect(decidePost(held('sent'), 'Renamed it.', at)).toBeNull()
  expect(decidePost(held('armed', 'Renamed it, and more.'), 'Renamed it.', at)).toBeNull()
  expect(decidePost(undefined, 'Renamed it.', at)).toBeNull()
  // One a closed session left out has lost its answer, and may be posted again once looked for.
  expect(decidePost(held('sent'), 'Renamed it.', SENT_HOLDS_MS + 1)?.state).toBe('sent')
})
