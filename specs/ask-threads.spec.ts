import { expect, test } from 'vitest'

import { withThreads } from '../hooks/ask-threads'
import { toCard } from '../hooks/mr-card'
import { slimCard } from '../hooks/slim'
import { HOST, note, rawMr, thread } from '../tests/fixtures'

test("a page's threads gain where a reply goes and the lines they were left on, joined by their first note's address; a shared card keeps neither", () => {
  const onDiff = thread('Rename this, please.', 'tim')
  const general = { ...thread('Why?', 'mel'), notes: { nodes: [note('Why?', 'mel', { position: null })] } }
  const card = toCard(HOST, rawMr(12, { discussions: { nodes: [onDiff, general] } }))
  const [first, second] = card.openThreads
  if (first === undefined || second === undefined) {
    throw new Error('no threads')
  }
  const lines = [
    { oldLine: 7, newLine: 7, type: null, text: ' const a = 1' },
    { oldLine: null, newLine: 8, type: 'new', text: '+const b = 2' },
  ]
  const threads = {
    data: {
      project: {
        mergeRequest: {
          id: 'gid://gitlab/MergeRequest/912',
          discussions: {
            nodes: [
              { replyId: 'gid://gitlab/Discussion/a1', truncatedDiffLines: lines, notes: { nodes: [{ url: first.url }] } },
              { replyId: 'gid://gitlab/Discussion/b2', truncatedDiffLines: null, notes: { nodes: [{ url: second.url }] } },
              // A thread the whole read does not hold (resolved since, or a bot's) answers nothing.
              { replyId: 'gid://gitlab/Discussion/c3', truncatedDiffLines: lines, notes: { nodes: [{ url: 'https://gitlab.com/elsewhere' }] } },
              null,
            ],
          },
        },
      },
    },
  }
  const read = withThreads(card, { response: threads })
  expect(read.openThreads.map(open => open.answer)).toEqual([
    { mr: 'gid://gitlab/MergeRequest/912', thread: 'gid://gitlab/Discussion/a1' },
    { mr: 'gid://gitlab/MergeRequest/912', thread: 'gid://gitlab/Discussion/b2' },
  ])
  expect(read.openThreads.map(open => open.excerpt)).toEqual([{ path: 'src/a.ts', hunk: '@@ -7,1 +7,2 @@\n const a = 1\n+const b = 2' }, undefined])
  // Everything else on the card is as the whole read left it.
  expect({ ...read, openThreads: card.openThreads }).toEqual(card)
  // An MR GitLab no longer names leaves the threads as they were; a read that failed, or came back as errors alone, says why.
  expect(withThreads(card, { response: { data: { project: null } } })).toEqual(card)
  expect(withThreads(card, { reason: 'gitlab.com answered HTTP 400' })).toEqual({ ...card, repliesOff: 'gitlab.com answered HTTP 400' })
  expect(withThreads(card, { response: { errors: [{ message: 'Timeout on validation of query' }] } })).toEqual({ ...card, repliesOff: 'Timeout on validation of query' })
  expect(slimCard(read).openThreads.map(open => [open.answer, open.excerpt])).toEqual([
    [undefined, undefined],
    [undefined, undefined],
  ])
})
