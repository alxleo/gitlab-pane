import { expect, test } from 'vitest'
import fc from 'fast-check'

import { CLOSED, EXCERPT_LINES, LINE_MOST, hunkOf, isPostable, mayHavePosted, openedBox, postedOf, reasonOf, reviewed, unanswered } from '../../hooks/reply-model.ts'
import type { DiffLine } from '../../hooks/reply-model.ts'
import { decodeGraphql, parseJson } from '../../hooks/decode.ts'
import type { ReplyMutation } from '../../hooks/gitlab.generated.ts'
import type { RawResponse } from '../../hooks/gitlab-documents.ts'

import type { FailureKind } from '../../types'

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
  expect(postedOf('gitlab.com', answer({ data: { createNote: { errors: [], note: { id: 'gid://gitlab/Note/9' }, quickActionsStatus: null } } }))).toEqual({ isPosted: true })
  // A token of read_api alone may not write: GitLab refuses the whole mutation, with no word of the scope.
  const refused = answer({
    data: { createNote: null },
    errors: [{ message: "The resource that you are attempting to access does not exist or you don't have permission to perform this action" }],
  })
  expect(postedOf('gitlab.com', refused)).toEqual({
    isPosted: false,
    reason:
      "gitlab.com refused the reply: The resource that you are attempting to access does not exist or you don't have permission to perform this action. A token with only the read_api scope is refused so; replying needs api.",
  })
  expect(postedOf('gitlab.com', answer({ data: { createNote: { errors: ["Note can't be blank", 'Note is\ntoo long'], note: null, quickActionsStatus: null } } }))).toEqual({
    isPosted: false,
    reason: "gitlab.com did not post the reply: Note can't be blank; Note is too long",
  })
  expect(postedOf('gitlab.com', answer({ data: { createNote: { errors: [], note: null, quickActionsStatus: { commandsOnly: true, errorMessages: [] } } } }))).toEqual({
    isPosted: false,
    reason: 'gitlab.com ran the quick actions in the reply and kept no note',
  })
  expect(
    postedOf(
      'gitlab.com',
      answer({ data: { createNote: { errors: [], note: null, quickActionsStatus: { commandsOnly: true, errorMessages: ['Could not apply merge command.'] } } } })
    )
  ).toEqual({ isPosted: false, reason: 'gitlab.com ran the quick actions in the reply and kept no note: Could not apply merge command.' })
  expect(postedOf('gitlab.com', answer({ data: null }))).toEqual({ isPosted: false, reason: 'gitlab.com sent no answer to the reply' })
  // No answer at all: a refused token says so; a dropped connection may have dropped after GitLab kept the reply.
  expect(reasonOf({ kind: 'unauthorized', message: 'gitlab.com refused the token from GITLAB_TOKEN (HTTP 403): it needs the api scope' })).toBe(
    'gitlab.com refused the token from GITLAB_TOKEN (HTTP 403): it needs the api scope'
  )
  expect(reasonOf({ kind: 'network', message: 'gitlab.com failed: connection reset' })).toBe(
    'gitlab.com failed: connection reset. It may have reached GitLab: look in the thread before posting again.'
  )
  // GitLab's edge answers 52x now and then, after GitLab itself may have kept the reply.
  expect(reasonOf({ kind: 'server', message: 'gitlab.com answered HTTP 524' })).toBe(
    'gitlab.com answered HTTP 524. It may have reached GitLab: look in the thread before posting again.'
  )
  const kinds: FailureKind[] = ['network', 'timeout', 'server', 'unauthorized', 'bad-answer', 'no-token']
  expect(kinds.map(kind => mayHavePosted({ kind }))).toEqual([true, true, true, false, false, false])
})

test('a reply box opens on what was last typed for its thread, asks to confirm only text with something in it, and posts only from there', () => {
  const thread = 'https://gitlab.com/g/p/-/merge_requests/12#note_1'
  const open = openedBox(thread, { [thread]: 'half a thought' })
  expect(open).toEqual({ thread, text: 'half a thought', stage: 'writing', reason: '' })
  expect(openedBox('other', { [thread]: 'half a thought' }).text).toBe('')
  expect(isPostable(open, thread)).toBe(false)
  // Enter on nothing, or on spaces, keeps the box open with what is in it.
  expect(reviewed(open, '  \n')).toEqual({ ...open, text: '  \n' })
  const confirming = reviewed(open, 'Done, renamed.')
  expect(confirming).toEqual({ thread, text: 'Done, renamed.', stage: 'confirming', reason: '' })
  expect([isPostable(confirming, thread), isPostable(confirming, 'other')]).toEqual([true, false])
  expect(isPostable({ ...confirming, stage: 'failed', reason: 'down' }, thread)).toBe(true)
  expect(isPostable({ ...confirming, stage: 'posting' }, thread)).toBe(false)
  expect(isPostable(CLOSED, '')).toBe(false)
  // A reload while a reply was out loses its answer: the box says so and offers the text again, never stays posting.
  expect(unanswered({ ...confirming, stage: 'posting' })).toEqual({
    ...confirming,
    stage: 'failed',
    reason: 'The pane reloaded before GitLab answered. It may have reached GitLab: look in the thread before posting again.',
  })
  expect(unanswered(confirming)).toBe(confirming)
})
