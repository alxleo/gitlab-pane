import { expect, test } from 'vitest'
import fc from 'fast-check'

import { replaceAnchors, replaceFences, replaceLinks, replacePairs, replaceSpans } from '../../hooks/closers.ts'

// Each read in closers.ts takes the place of a pattern that is quadratic on hostile text, and must read every text as that
// pattern does. These hold each to its pattern, on texts short enough for the pattern to read as quickly.

/** Texts of up to `length` of `pieces`: what the pattern turns on, in any order. */
const textOf = (pieces: string[], length = 40) => fc.array(fc.constantFrom(...pieces), { maxLength: length }).map(list => list.join(''))

/** What a match is made over into: its parts between marks, so a match that starts, ends or splits anywhere else shows. */
const shown = (...parts: string[]) => `⟦${parts.join('|')}⟧`

/** The line and paragraph separators, which end a line for `^` and `$` as a line feed does. */
const SEPARATORS = [String.fromCodePoint(0x2028), String.fromCodePoint(0x2029)]

const RUNS = { numRuns: 3000 }

test('links are read as /\\[([^\\]]*)\\]\\([^)]*\\)/ reads them, with a ! before that may, must or need not be there', () => {
  const links = textOf(['[', ']', '(', ')', '!', 'x', '\n', ' ', '![', '](', ')('])
  fc.assert(
    fc.property(links, text => {
      const byPattern = (pattern: RegExp) => text.replace(pattern, (_, words: string) => shown(words))
      expect(replaceLinks(text, 'none', shown)).toBe(byPattern(/\[([^\]]*)\]\([^)]*\)/gu))
      expect(replaceLinks(text, 'may', shown)).toBe(byPattern(/!?\[([^\]]*)\]\([^)]*\)/gu))
      expect(replaceLinks(text, 'must', shown)).toBe(byPattern(/!\[([^\]]*)\]\([^)]*\)/gu))
    }),
    RUNS
  )
})

test('a tag and its closer are read as /<(b|strong)>([\\s\\S]*?)<\\/\\1>/giu reads them, a closer in any case', () => {
  const tags = textOf(['<b>', '</b>', '<B>', '</B>', '<strong>', '</strong>', '</STRONG>', '<ſtrong>', '</ſtrong>', '<i>', '</i>', 'x', '<', '>', '\n'])
  fc.assert(
    fc.property(tags, text => {
      const read = replacePairs(
        text,
        /<(b|strong)>/giu,
        open => `</${open[1] ?? ''}>`,
        (open, inner) => shown(open[1] ?? '', inner)
      )
      expect(read).toBe(text.replace(/<(b|strong)>([\s\S]*?)<\/\1>/giu, (_, name: string, inner: string) => shown(name, inner)))
    }),
    RUNS
  )
})

test('a picture is read as /<picture\\b([\\s\\S]*?)<\\/picture>/giu reads it', () => {
  const pictures = textOf(['<picture', '<picture>', '<PICTURE x>', '<pictures>', '</picture>', '</PICTURE>', 'x', ' ', '<', '>'])
  fc.assert(
    fc.property(pictures, text => {
      const read = replacePairs(
        text,
        /<picture\b/giu,
        () => '</picture>',
        (_, inner) => shown(inner)
      )
      expect(read).toBe(text.replace(/<picture\b([\s\S]*?)<\/picture>/giu, (_, inner: string) => shown(inner)))
    }),
    RUNS
  )
})

test('an <a> is read as /<a\\b[^<>]*\\bhref="([^"]+)"[^<>]*>([\\s\\S]*?)<\\/a>/giu reads it, an href over a > included', () => {
  // An opener, its attributes, how it ends, its words and its closer, each whole, broken or missing, among loose pieces.
  const anchor = fc
    .tuple(
      fc.constantFrom('<a', '<A', '<ab', '<aſ'),
      fc.array(fc.constantFrom(' href="u"', ' href="u>v"', ' href=""', ' href="', ' HREF="w"', 'href="h"', ' x', '"', '>'), { maxLength: 4 }),
      fc.constantFrom('>', '', '<', '">'),
      fc.constantFrom('', 'w', ' ', 'w>x', '"'),
      fc.constantFrom('</a>', '</A>', '', '<')
    )
    .map(([open, attributes, end, words, close]) => `${open}${attributes.join('')}${end}${words}${close}`)
  const anchors = fc.array(fc.oneof(anchor, fc.constantFrom('x', ' ', '"', '>', '<', '\n', '</a>')), { maxLength: 6 }).map(list => list.join(''))
  fc.assert(
    fc.property(anchors, text => {
      const read = replaceAnchors(text, (href, words) => shown(href, words))
      expect(read).toBe(text.replace(/<a\b[^<>]*\bhref="([^"]+)"[^<>]*>([\s\S]*?)<\/a>/giu, (_, href: string, words: string) => shown(href, words)))
    }),
    RUNS
  )
})

test('a fenced block is read as its pattern reads it, a fence with no closer tried one shorter', () => {
  const fences = textOf(['`', '``', '```', '````', '~~~', '~', ' ', '   ', '    ', '\n', '\n', '\r', 'x', '\t', ...SEPARATORS], 50)
  fc.assert(
    fc.property(fences, text => {
      expect(replaceFences(text, shown)).toBe(text.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[ \t]*$/gmu, code => shown(code)))
    }),
    RUNS
  )
})

test('a span of code is read as its pattern reads it, from a backtick inside a run too', () => {
  const spans = textOf(['`', '``', '```', 'x', ' ', '\n', '\r'])
  fc.assert(
    fc.property(spans, text => {
      expect(replaceSpans(text, shown)).toBe(text.replace(/(`+)(?!`)[^\n]*?[^`\n]\1(?!`)/gu, code => shown(code)))
    }),
    RUNS
  )
})

test('the shortest cases each read stops at', () => {
  // A fence of four with no closer of four is closed by one of three, as the pattern gives a backtick back.
  expect(replaceFences('````x\ny\n```', shown)).toBe(shown('````x\ny\n```'))
  // A run of two with no closer of two opens again from its second backtick.
  expect(replaceSpans('``a`b', shown)).toBe(`\`${shown('`a`')}b`)
  // The last href's value runs past the first >, and ends the opener at the > after it.
  expect(replaceAnchors('<a href="u>v">w</a>', (href, words) => shown(href, words))).toBe(shown('u>v', 'w'))
  expect(replaceLinks('a ![b](c) [d](e)', 'must', shown)).toBe(`a ${shown('b')} [d](e)`)
})
