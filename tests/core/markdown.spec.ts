import { expect, test } from 'vitest'
import fc from 'fast-check'

import { cleanBody } from '../../hooks/gitlab.ts'
import { flatOf, partsOf } from '../../hooks/markdown.ts'
import type { Part } from '../../hooks/markdown.ts'
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

// ---- properties -------------------------------------------------------------------------------------------------------

/** A document as written: prose, code (which keeps its tags), and folds with a summary, open or closed, nesting. */
type Doc = ({ kind: 'prose'; words: string[] } | { kind: 'code'; code: string } | { kind: 'fold'; summary: string[]; isOpen: boolean; inside: Doc })[]

const wordArb = fc.stringMatching(/^[A-Za-z0-9]{1,8}$/)
const docArb: fc.Arbitrary<Doc> = fc.letrec<{ doc: Doc; part: Doc[number] }>(tie => ({
  doc: fc.array(tie('part'), { maxLength: 4 }),
  part: fc.oneof(
    { weight: 3, arbitrary: fc.record({ kind: fc.constant('prose' as const), words: fc.array(wordArb, { minLength: 1, maxLength: 6 }) }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('code' as const), code: fc.constantFrom('<script>run()</script>', '<b>bold</b>', 'a <details> b', '</details>') }) },
    {
      weight: 2,
      arbitrary: fc.record({ kind: fc.constant('fold' as const), summary: fc.array(wordArb, { minLength: 1, maxLength: 3 }), isOpen: fc.boolean(), inside: tie('doc') }),
    }
  ),
})).doc

const sourceOf = (doc: Doc): string =>
  doc
    .map(part =>
      part.kind === 'prose'
        ? part.words.join(' ')
        : part.kind === 'code'
          ? `\`${part.code}\``
          : `<details${part.isOpen ? ' open' : ''}>\n<summary>${part.summary.join(' ')}</summary>\n\n${sourceOf(part.inside)}\n\n</details>`
    )
    .join('\n\n')

/** Every word, in reading order: a fold's summary, then what is inside it. */
const wordsOf = (doc: Doc): string[] => doc.flatMap(part => (part.kind === 'prose' ? part.words : part.kind === 'code' ? [part.code] : [...part.summary, ...wordsOf(part.inside)]))

const partWords = (parts: Part[]): string[] => parts.flatMap(part => ('text' in part ? [part.text.replace(/`/g, '')] : [part.summary, ...partWords(part.parts)]))

test('parsing the folds of a document loses no text, and keeps each fold, its summary and whether it is open', () => {
  fc.assert(
    fc.property(docArb, doc => {
      const parts = partsOf(cleanBody(sourceOf(doc), HOST, 'g/p'))
      const joined = (list: string[]) =>
        list
          .join(' ')
          .split(/\s+/)
          .filter(word => word !== '')
          .join(' ')
      expect(joined(partWords(parts))).toBe(joined(wordsOf(doc)))
      const folds = (list: Part[]): { summary: string; isOpen: boolean }[] =>
        list.flatMap(part => ('text' in part ? [] : [{ summary: part.summary, isOpen: part.isOpen }, ...folds(part.parts)]))
      const written = (list: Doc): { summary: string; isOpen: boolean }[] =>
        list.flatMap(part => (part.kind === 'fold' ? [{ summary: part.summary.join(' '), isOpen: part.isOpen }, ...written(part.inside)] : []))
      expect(folds(parts)).toEqual(written(doc))
    })
  )
})
