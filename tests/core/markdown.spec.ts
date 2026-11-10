import { expect, test } from 'vitest'
import fc from 'fast-check'

import { lead } from '../../hooks/format.ts'
import { cleanBody } from '../../hooks/gitlab.ts'
import { MAX_ROUNDS, cutToFit, flatOf, partsOf } from '../../hooks/markdown.ts'
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

test('the start of a text that fits is cut between characters, dropping a flag that does not fit whole', () => {
  const unbroken = flatOf(cleanBody(`${'x'.repeat(96)}🇺🇸tail`, HOST, 'g/p'))
  // Room 99 reaches into the flag, which is four units; the cut ends before it, not after half of it.
  expect(cutToFit(unbroken, 99, () => 0)).toBe(`${'x'.repeat(96)} …`)
  // Letters outside the basic plane are two UTF-16 units each: room 50 is cut after a whole one, never between its halves.
  const astral = flatOf(cleanBody(`a${'𠮷'.repeat(60)}`, HOST, 'g/p'))
  expect(cutToFit(astral, 50, () => 0)).toBe(`a${'𠮷'.repeat(24)} …`)
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

const wordArb = fc.stringMatching(/^[A-Za-z0-9]{1,8}$/u)
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

const partWords = (parts: Part[]): string[] => parts.flatMap(part => ('text' in part ? [part.text.replace(/`/gu, '')] : [part.summary, ...partWords(part.parts)]))

test('parsing the folds of a document loses no text, and keeps each fold, its summary and whether it is open', () => {
  fc.assert(
    fc.property(docArb, doc => {
      const parts = partsOf(cleanBody(sourceOf(doc), HOST, 'g/p'))
      const joined = (list: string[]) =>
        list
          .join(' ')
          .split(/\s+/u)
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

// ---- a strip made once leaves what it was nested in -------------------------------------------------------------------

/** The text as GitLab sends it, read and drawn with its folds closed. */
const drawn = (text: string): string => flatOf(cleanBody(text, HOST, 'g/p'))

/** The label of the fold a summary heads: `text` is written between `<summary>` and `</summary>`. */
function summaryOf(text: string): string {
  const fold = partsOf(cleanBody(`<details><summary>${text}</summary>x</details>`, HOST, 'g/p')).find(part => 'summary' in part)
  if (fold === undefined || !('summary' in fold)) {
    throw new Error('expected a fold')
  }
  return fold.summary
}

/** What each strip removes: a whole comment, any tag, and from a summary anything between `<` and `>`. */
const COMMENT = /<!--[\s\S]*?-->/u
const TAG = /<\/?[a-z][a-z0-9-]*\b[^>]*>/iu
const MARKUP = /<[^>]+>/u

/**
 * Text built of the pieces markup is made of, each put in at any place in what is built so far: inside another's
 * brackets, a piece is nested, and cutting it out joins what is left into a new piece.
 */
const markupArb = fc
  .array(fc.tuple(fc.constantFrom('<', '>', '!--', '<!--', '-->', '<!-- c -->', '<script>', '<b>', 'script', 'a', 'x', '\n'), fc.nat()), { maxLength: 12 })
  .map(steps =>
    steps.reduce((text, [piece, place]) => {
      const at = place % (text.length + 1)
      return `${text.slice(0, at)}${piece}${text.slice(at)}`
    }, '')
  )

test('a comment that cutting one out makes whole is cut out too', () => {
  // The comment inside the first one goes, and the two halves of the outer one are joined into a whole.
  expect(drawn('before <!-<!-- a -->- b --> after')).toBe('before  after')
  expect(drawn('before <!<!-- a -->-- b --> after')).toBe('before  after')
  // Three deep: each round cut out leaves the next whole.
  expect(drawn('<!-<!-<!-- a -->- b -->- c -->tail')).toBe('tail')
  // A tag cut out can join a comment too.
  expect(drawn('<!-- c -<b>-> after')).toBe('after')
})

test('a tag that cutting one out makes whole is cut out too', () => {
  expect(drawn('x <<script>script>y')).toBe('x y')
  expect(drawn('x <<b>b>y')).toBe('x y')
  expect(drawn('x <<<b>b>b>y')).toBe('x y')
  for (const text of ['x <<script>script>y', 'x <<b>b>y', 'x <scr<script>ipt>y', '<<<b>b>b>']) {
    const flat = drawn(text)
    expect(flat).not.toContain('<script')
    expect(flat).not.toMatch(TAG)
  }
})

test('a summary keeps no tag of its own, however its markup is nested', () => {
  expect(summaryOf('<<b>b>Title')).toBe('b>Title')
  expect(summaryOf('<b>Ti<i>tle</i></b>')).toBe('Title')
  expect(summaryOf('<scr<script>ipt>Title')).not.toMatch(MARKUP)
})

test('drawn text holds no whole comment, whatever pieces it is made of', () => {
  fc.assert(
    fc.property(markupArb, text => {
      expect(drawn(text)).not.toMatch(COMMENT)
    })
  )
})

test('drawn text holds no tag, whatever pieces it is made of', () => {
  fc.assert(
    fc.property(markupArb, text => {
      expect(drawn(text)).not.toMatch(TAG)
    })
  )
})

test('a summary holds nothing between < and >, whatever pieces it is made of', () => {
  fc.assert(
    fc.property(markupArb, text => {
      expect(summaryOf(text)).not.toMatch(MARKUP)
    })
  )
})

// ---- what a strip cuts is what it always cut ---------------------------------------------------------------------------

test('a comment or a tag that holds a < is cut out whole, not left behind', () => {
  // A candidate that stopped at the next `<` would leave each of these in the text.
  expect(drawn('x <!-- 1 < 2 --> y')).toBe('x  y')
  expect(drawn('x <!--<--> y')).toBe('x  y')
  expect(drawn('x <!-- a <!--> y')).toBe('x  y')
  expect(drawn('x <script<> y')).toBe('x  y')
  expect(drawn('x <b title="a<b"> y')).toBe('x  y')
})

test('an <a> whose attribute holds a < keeps its words but not its link', () => {
  expect(drawn('x <a href="https://x.test/a" title="a<b">words</a> y')).toBe('x words y')
})

// ---- a strip takes time in proportion to the text, however hostile it is ------------------------------------------------

/** What `toCard` runs for every MR on every poll: the description cleaned, then its lead drawn. Milliseconds. */
function msToLead(body: string): number {
  const start = performance.now()
  lead(cleanBody(body, HOST, 'g/p'), 240)
  return performance.now() - start
}

/** `open` as many times as `size` characters allow, then `close` as many times: markup nested as deep as it can be. */
const nestedTo = (open: string, close: string, size: number): string => {
  const depth = Math.floor(size / (open.length + close.length))
  return `${open.repeat(depth)}${close.repeat(depth)}`
}

/** Written to make a strip slow: each is quadratic in the text for a strip that repeats whole passes, or looks ahead from every `<`. */
const HOSTILE: [string, string][] = [
  ['tags nested in tags', nestedTo('<', 'b>', 200_000)],
  // A level of comment is eight characters here, so it takes this many to be as slow as the tags.
  ['comments nested in comments', `${'<!-'.repeat(75_000)}<!-- a -->${'- -->'.repeat(75_000)}`],
  ['a tag opened over and over and never closed', '<a'.repeat(100_000)],
  ['a tag name of hyphens, never closed', `<${'a-'.repeat(100_000)}`],
  ['a comment opened over and over and never closed', '<!--'.repeat(50_000)],
  ['a comment closed once, then opened over and over', `<!-- a -->${'<!--'.repeat(50_000)}`],
  ['a summary of < and nothing else', `<details><summary>${'<'.repeat(200_000)}</summary>x</details>`],
  ...['p', 'li', 'img', 'details'].map((name): [string, string] => [`<${name} opened over and over and never closed`, `<${name}`.repeat(Math.floor(200_000 / (name.length + 1)))]),
]

test.each(HOSTILE)('a body of %s is drawn in under a second', (_, body) => {
  expect(msToLead(body)).toBeLessThan(1000)
})

// ---- a strip that is still cutting when it reaches its last round leaves no markup ------------------------------------

/** Markup nested one level deeper than `MAX_ROUNDS` rounds can cut apart, with words around it that hold a `<` of their own. */
const pastTheCapArb = fc
  .record({
    kind: fc.constantFrom('tags', 'comments'),
    depth: fc.integer({ min: MAX_ROUNDS + 1, max: MAX_ROUNDS + 30 }),
    before: fc.constantFrom('', 'a < b ', '1 <3 2 '),
    after: fc.constantFrom('', ' c > d', ' 4 <- 5'),
  })
  .map(({ kind, depth, before, after }) => `${before}${kind === 'tags' ? nestedTo('<', 'b>', 3 * depth) : `${'<!-'.repeat(depth)}<!-- a -->${'- -->'.repeat(depth)}`}${after}`)

test('markup nested past the last round leaves no < in what is drawn', () => {
  fc.assert(
    fc.property(pastTheCapArb, text => {
      expect(drawn(text)).not.toContain('<')
    })
  )
})

test('markup within the rounds is cut to the last piece, and a < of its own is kept', () => {
  expect(drawn('a < b <<<b>b>b> c')).toBe('a < b  c')
})
