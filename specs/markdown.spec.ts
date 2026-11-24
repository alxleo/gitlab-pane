import { expect, test } from 'vitest'
import fc from 'fast-check'

import { excerpt, lead } from '../hooks/format'
import { cleanBody } from '../hooks/mr-card'
import { MAX_ROUNDS, cutToFit, flatOf, linkMarkdown, partsOf } from '../hooks/markdown'
import type { Part } from '../hooks/markdown'
import { HOST } from '../tests/fixtures'

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

test('a link the pane draws is one link whatever its words and address hold, and none for an address that is not http(s)', () => {
  expect(linkMarkdown('🎫 ABC-1', 'https://jira.example.com/browse/ABC-1')).toBe('[🎫 ABC-1](https://jira.example.com/browse/ABC-1)')
  expect(linkMarkdown('a [b](c) *d*', 'https://x.example/a_(b)<c>')).toBe('[a \\[b\\]\\(c\\) \\*d\\*](https://x.example/a_%28b%29%3Cc%3E)')
  expect(linkMarkdown('x', 'javascript:alert(1)')).toBeNull()
  expect(linkMarkdown('x', 'https://a b')).toBeNull()
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

/**
 * Node's count of the processor time this process has spent, which the specs here run under. The core's specs compile
 * without Node's types, so the one function this file calls is declared here.
 */
declare const process: { cpuUsage(since?: { user: number; system: number }): { user: number; system: number } }

/**
 * What reading a body costs, in milliseconds of processor time, which a busy machine does not inflate as it does the time
 * on the clock: the slowest of what a poll runs on it (its lead, or a note's first line) and
 * what an MR's page runs on it (its parts), each from the body as GitLab sends it.
 */
function msToRead(body: string): number {
  const reads = [() => lead(cleanBody(body, HOST, 'g/p'), 240), () => excerpt(cleanBody(body, HOST, 'g/p')), () => partsOf(cleanBody(body, HOST, 'g/p'))]
  return Math.max(
    ...reads.map(read => {
      const start = process.cpuUsage()
      read()
      const { user, system } = process.cpuUsage(start)
      return (user + system) / 1000
    })
  )
}

/** A megabyte of text, which GitLab takes as one description or one comment; the timings read fractions of it. */
const MEGABYTE = 1_000_000

/** `open` as many times as `size` characters allow, then `close` as many times: markup nested as deep as it can be. */
const nestedTo = (open: string, close: string, size: number): string => {
  const depth = Math.floor(size / (open.length + close.length))
  return `${open.repeat(depth)}${close.repeat(depth)}`
}

/** `piece` over and over, `size` characters of it. */
const over = (piece: string, size: number): string => piece.repeat(Math.floor(size / piece.length))

/** `piece` run one longer each time, each ended by `end`, `size` characters of runs: no two runs the same length. */
const runsOf = (piece: string, end: string, size: number): string => Array.from({ length: Math.ceil(Math.sqrt(2 * size)) }, (_, at) => `${piece.repeat(at + 1)}${end}`).join('')

/**
 * Written to make a reading slow: each is quadratic in the text, or worse, for a pattern that reads to the end of the text
 * from every opener it finds, or a strip that repeats whole passes, or a fold read once for each fold around it.
 */
const HOSTILE: [string, (size: number) => string][] = [
  ['tags nested in tags', size => nestedTo('<', 'b>', size)],
  ['tags that each leave a < behind when cut out', size => over('a<<b>', size)],
  ['comments nested in comments', size => `${'<!-'.repeat(size / 8)}<!-- a -->${'- -->'.repeat(size / 8)}`],
  ['a tag opened over and over and never closed', size => over('<a', size)],
  ['a tag name of hyphens, never closed', size => `<${over('a-', size)}`],
  ['a comment opened over and over and never closed', size => over('<!--', size)],
  ['a comment closed once, then opened over and over', size => `<!-- a -->${over('<!--', size)}`],
  ['a summary of < and nothing else', size => `<details><summary>${over('<', size)}</summary>x</details>`],
  ...['p', 'li', 'img', 'details'].map((name): [string, (size: number) => string] => [`<${name} opened over and over and never closed`, size => over(`<${name}`, size)]),
  ...['b', 'strong', 'i', 'em', 's', 'code', 'kbd', 'picture', 'a href="x"'].map((tag): [string, (size: number) => string] => [
    `<${tag}> opened over and over and never closed`,
    size => over(`<${tag}>`, size),
  ]),
  ['<b> closed only by </i>', size => over('<b>x</i>', size)],
  ['an <a> that says href over and over', size => `<a${over(' href="x"', size)}`],
  ['folds nested in folds', size => nestedTo('<details>', '</details>', size)],
  ['a fold opened over and over and never closed', size => over('<details>', size)],
  ['a fold with a summary opened over and over and never closed', size => over('<details><summary>', size)],
  ['a link opened over and over and never closed', size => over('[a](', size)],
  ['a picture opened over and over and never closed', size => over('![a](', size)],
  ['[ and nothing else', size => over('[', size)],
  ['![ and nothing else', size => over('![', size)],
  ['a fence opened over and over and never closed', size => over('```x\n', size)],
  ['fences of every length, none closed', size => runsOf('`', 'x\n', size).replace(/^`{1,2}x\n/gmu, '')],
  ['backtick runs of every length on one line', size => runsOf('`', 'x', size)],
  ['one fence as long as the text, of backticks', size => `${over('`', size)}\nx\n`],
  ['one fence as long as the text, of tildes', size => `${over('~', size)}\nx\n`],
  ['spaces inside a line', size => `x${over(' ', size)}y`],
  ['tabs inside a line', size => `x${over('\t', size)}y`],
  ['form feeds inside a line', size => `x${over('\f', size)}y`],
  ['lines of a form feed alone, then a task', size => `x\n${over('\f\n', size)}- [x] y`],
  ['lines of a form feed alone, then a callout', size => `x\n${over('\f\n', size)}> [!NOTE]`],
]

/** The middle one of `values`. */
const median = (values: readonly number[]): number => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)] ?? Number.NaN

/**
 * How many times longer `large` takes to read than `small`: pairs of readings, the small then the large, and the middle of
 * five pairs' ratios, after two pairs that are not counted, whose first readings of a text are up to twice as slow as the
 * rest. The two readings of a pair meet the machine in the same state, so a spell in which it runs everything slower slows
 * both; one pair that a collection of garbage skews is outvoted by the rest.
 */
const slowdown = (small: string, large: string): number => {
  const ratios = [0, 1, 2, 3, 4, 5, 6].map(() => {
    const ofSmall = msToRead(small)
    return msToRead(large) / ofSmall
  })
  return median(ratios.slice(2))
}

// Each took minutes on a megabyte before it was made linear. A reading in proportion to the text takes about four times as
// long on four times the text, and one that is quadratic again sixteen times. Eight is where a reading that grows as the
// text's length to the power 1.5 would sit, so it catches anything that grows that fast or faster. Processor time alone does
// not hold the bar on a shared runner, where a core can take about twice the processor time for the same work for a spell
// (a busy twin on the same core, a lower clock): when one fell between the small readings and the large ones, a linear
// reading measured 8.009 (main, 20 November). In pairs, a spell slows both readings of a pair or neither, but for a pair it
// begins or ends in, and the middle of five outvotes those two. It does not catch a milder slide, such as a sort that makes
// a reading n log n.
test.each(HOSTILE)('%s takes about four times as long to read at four times the length, and under eight', (_, make) => {
  expect(slowdown(make(MEGABYTE / 32), make(MEGABYTE / 8))).toBeLessThan(8)
})

// ---- a fold nested past reading -----------------------------------------------------------------------------------------

/** The fold depth of `parts`: none for text alone. */
const depthOf = (parts: Part[]): number => Math.max(0, ...parts.map(part => ('summary' in part ? 1 + depthOf(part.parts) : 0)))

test('folds nested thousands deep are read as folds sixteen deep, the deeper ones as their words', () => {
  // About as deep as a stack of calls, one per fold, can go.
  const text = `${'<details><summary>s</summary>'.repeat(6_000)}words${'</details>'.repeat(6_000)}`
  const parts = partsOf(cleanBody(text, HOST, 'g/p'))
  expect(depthOf(parts)).toBe(16)
  expect(flatOf(cleanBody(text, HOST, 'g/p'))).toBe('▸ s')
  expect(lead(cleanBody(`Lead.\n\n${text}`, HOST, 'g/p'))).toBe('Lead.')
})

test('folds nested sixteen deep are each a fold', () => {
  const text = `${'<details open><summary>s</summary>'.repeat(16)}words${'</details>'.repeat(16)}`
  const parts = partsOf(cleanBody(text, HOST, 'g/p'))
  expect(depthOf(parts)).toBe(16)
  expect(flatOf(cleanBody(text, HOST, 'g/p'))).toBe(`${'▾ s\n\n'.repeat(16)}words`)
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

test('markup nested past the last round leaves no < in what is drawn, and keeps the words after it', () => {
  fc.assert(
    fc.property(pastTheCapArb, text => {
      expect(drawn(`${text} tail words`)).not.toContain('<')
      expect(drawn(`${text} tail words`)).toMatch(/ tail words$/u)
    })
  )
})

test('markup within the rounds is cut to the last piece, and a < of its own is kept', () => {
  expect(drawn('a < b <<<b>b>b> c')).toBe('a < b  c')
  // Seven deep is cut in seven rounds, and an eighth finds nothing more: the last round there is.
  expect(drawn(`a < b ${nestedTo('<', 'b>', 3 * 7)} c`)).toBe('a < b  c')
})

test('markup nested eight deep is still being cut in the last round, so every < goes', () => {
  expect(drawn(`a < b ${nestedTo('<', 'b>', 3 * 8)} c`)).toBe('a  b  c')
})
