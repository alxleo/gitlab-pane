import { expect, test } from 'vitest'

import { Failure } from '../../hooks/failure.ts'
import { FOLLOW_MS, FOLLOW_TRIES } from '../../hooks/next-move.ts'
import { liveOf, LOST, refusalOf, SENT_HOLDS_MS } from '../../hooks/write-model.ts'

import type { FailureKind, Write } from '../../types'

test('a write that failed on the way back may have reached GitLab; one GitLab or the engine refused did not, and it says why in a line', () => {
  const landed = (kind: FailureKind, message: string) => refusalOf(new Failure(kind, message)).mayHaveLanded
  expect(landed('network', 'gitlab.com failed: connection reset')).toBe(true)
  expect(landed('timeout', 'aborted')).toBe(true)
  expect(landed('server', 'gitlab.com answered HTTP 502')).toBe(true)
  expect(landed('unauthorized', 'HTTP 401')).toBe(false)
  expect(landed('bad-answer', 'not JSON')).toBe(false)
  // The engine refused to send it: it never left the machine.
  expect(landed('network', 'gitlab.com refused: blocked by policy')).toBe(false)
  expect(refusalOf(new Failure('failed', 'GitLab said\nno‮')).reason).toBe('GitLab said no')
})

test('a write sent longer ago than any is followed says its answer was lost, rather than under way for ever; the others hold', () => {
  // The longest a write is followed, a merge's looks (each also waiting on GitLab), fits inside it.
  expect(2 * FOLLOW_MS * FOLLOW_TRIES).toBeLessThanOrEqual(SENT_HOLDS_MS)
  const sent: Write = { kind: 'reply', state: 'sent', on: 'Renamed it.', at: 0 }
  expect(liveOf(sent, SENT_HOLDS_MS)).toBe(sent)
  expect(liveOf(sent, SENT_HOLDS_MS + 1)).toEqual({ kind: 'reply', state: 'failed', on: 'Renamed it.', at: 0, say: LOST })
  // A hand-off to Claude takes as long as Claude does; a failure says why until it is tried again.
  const handed: Write = { kind: 'conflicts', state: 'handed', on: 'abc123', at: 0 }
  expect(liveOf(handed, 86_400_000)).toBe(handed)
  expect(liveOf(undefined, 0)).toBeUndefined()
})
