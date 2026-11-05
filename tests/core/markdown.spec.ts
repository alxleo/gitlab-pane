import { expect, test } from 'vitest'

import { cleanBody } from '../../hooks/gitlab.ts'
import { flatOf, partsOf } from '../../hooks/markdown.ts'
import { HOST } from '../fixtures.ts'

test('code keeps the tags it quotes; HTML elsewhere becomes Markdown or goes, as GitLab draws it', () => {
  const text = [
    'Made `<meta>` tags self-closing; builds say `v<version> - <sha>`.',
    '',
    '```html',
    '<script>run()</script>',
    '```',
    '',
    'Line one<br>line two, <b>bold</b>, <em>slanted</em>, <a href="https://x.test/a">a link</a> and <unknown>plain</unknown>.',
    '',
    '> <sup>Reviewed by a bot.</sup>',
  ].join('\n')
  const flat = flatOf(cleanBody(text, HOST, 'g/p'))
  expect(flat).toContain('`<meta>`')
  expect(flat).toContain('`v<version> - <sha>`')
  expect(flat).toContain('<script>run()</script>')
  expect(flat).toContain('Line one  \nline two, **bold**, *slanted*, [a link](https://x.test/a) and plain.')
  expect(flat).toContain('> Reviewed by a bot.')
})

test('a table cell keeps its line when a <br> breaks it', () => {
  expect(flatOf(cleanBody('| a | one<br>two |', HOST, 'g/p'))).toBe('| a | one two |')
})

test('task boxes and callouts read as marks, outside code only', () => {
  const flat = flatOf(cleanBody('- [x] done\n- [ ] to do\n\n> [!NOTE]\n> Mind this.\n\n`- [x] quoted`', HOST, 'g/p'))
  expect(flat).toContain('- ✓ done\n- ☐ to do')
  expect(flat).toContain('> **Note**\n> Mind this.')
  expect(flat).toContain('`- [x] quoted`')
})

test('each <details> is a fold under its summary, nested ones inside, open ones open', () => {
  const text = [
    'Before.',
    '<details>',
    '<summary><b>Evidence</b></summary>',
    '',
    '| Rule | After |',
    '| --- | ---: |',
    '| A | 1 |',
    '',
    '<details open><summary>Raw</summary>',
    '',
    'Inner words.',
    '</details>',
    '</details>',
    'After, with `<details>` quoted.',
  ].join('\n')
  const parts = partsOf(cleanBody(text, HOST, 'g/p'))
  expect(parts.length).toBe(3)
  expect(parts[0]).toEqual({ text: 'Before.' })
  const fold = parts[1]
  if (fold === undefined || !('summary' in fold)) {
    throw new Error('expected a fold')
  }
  expect(fold.summary).toBe('Evidence')
  expect(fold.isOpen).toBe(false)
  expect(fold.parts[0]).toEqual({ text: '| Rule | After |\n| --- | ---: |\n| A | 1 |' })
  expect(fold.parts[1]).toEqual({ summary: 'Raw', isOpen: true, parts: [{ text: 'Inner words.' }] })
  expect(parts[2]).toEqual({ text: 'After, with `<details>` quoted.' })
  // Closed, as GitLab first shows it: the summary alone.
  expect(flatOf(cleanBody(text, HOST, 'g/p'))).toBe('Before.\n\n▸ Evidence\n\nAfter, with `<details>` quoted.')
})
