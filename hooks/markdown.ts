/**
 * GitLab's Markdown as the pane's Markdown element draws it. GitLab lets HTML through: `<details>` folds, `<br>`,
 * `<sup>` and the like. The element draws no HTML, so each fold becomes a part of its own and the rest becomes
 * Markdown or goes, as GitLab's sanitiser would drop it. Code is left exactly as written, tags and all.
 */

import { cut } from './graphemes.ts'

import type { GitLabMarkdown } from '../types'

/** Text the Markdown element draws: GitLab's own Markdown, read by this file. Never a plain string. */
export type MarkdownText = string & { readonly __brand: 'MarkdownText' }

/**
 * GitLab's own Markdown, as it came: made by the GitLab read (`gitlab.ts`) from a description or a note body, and by
 * nothing else, so a title or a name can never be read as Markdown to draw. Not for text from anywhere but GitLab's
 * description and note fields.
 */
export const fromGitLab = (text: string): GitLabMarkdown => brand<GitLabMarkdown>(text)

/** The one place a string becomes Markdown to draw; not exported, so only GitLab's Markdown read here gets through. */
const brand = <Stamp extends MarkdownText | GitLabMarkdown = MarkdownText>(text: string): Stamp => text as Stamp

/** No Markdown. */
export const EMPTY_MARKDOWN = brand('')

/**
 * The longest start of `markdown` whose drawing fits `room`, ended at a paragraph, a line or a word; empty if none does.
 * `sizeOf` measures a candidate's drawing.
 */
export function cutToFit(markdown: MarkdownText, room: number, sizeOf: (text: MarkdownText) => number): MarkdownText {
  let length = Math.min(markdown.length, room)
  while (length > 0) {
    const start = cut(markdown, length, length)
    const end = [start.lastIndexOf('\n\n'), start.lastIndexOf('\n'), start.lastIndexOf(' ')].find(at => at > start.length / 2) ?? start.length
    const candidate = brand(`${start.slice(0, end).trimEnd()} …`)
    if (sizeOf(candidate) <= room) {
      return candidate
    }
    length = Math.floor(length * 0.8)
  }
  return EMPTY_MARKDOWN
}

/** Markdown to draw, or a fold: its summary, what it holds, and whether GitLab shows it open. */
export type Part = { text: MarkdownText } | { summary: string; parts: Part[]; isOpen: boolean }

const FENCE = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[ \t]*$/gmu
const SPAN = /(`+)(?!`)[^\n]*?[^`\n]\1(?!`)/gu
/** The marker of a held piece of code: its number between two NUL characters, which is why the pattern names them. */
const HELD = /\0(\d+)\0/gu

/** Swaps code for markers, so nothing below reads inside it; `restore` puts it back. */
function holdCode(text: string) {
  const held: string[] = []
  const hold = (code: string) => `\0${held.push(code) - 1}\0`
  const masked = text.replace(FENCE, hold).replace(SPAN, hold)
  return { masked, restore: (out: string) => out.replace(HELD, (_, i: string) => held[Number(i)] ?? '') }
}

const ALERT = /^(\s*>\s*)\[!(note|tip|important|warning|caution)\]\s*$/gimu
const TAG = /<\/?[a-z][a-z0-9-]*\b[^>]*>/giu
/** Anything between `<` and `>`, which a summary's label has no use for. */
const MARKUP = /<[^>]+>/gu
const BRACKET = /[<>]/gu

/**
 * `text` without its comments: each `<!--` and what follows it through the first `-->` after it. Written as a scan, not a
 * pattern: a `<!--` with no `-->` after it fails only after reading to the end, and a pattern tries every `<!--` in turn.
 * The first one that fails ends the scan, since no later one has a `-->` either.
 */
function withoutComments(text: string): string {
  let kept = ''
  let from = 0
  for (let open = text.indexOf('<!--'); open !== -1; open = text.indexOf('<!--', from)) {
    const close = text.indexOf('-->', open + 4)
    if (close === -1) {
      break
    }
    kept += text.slice(from, open)
    from = close + 3
  }
  return `${kept}${text.slice(from)}`
}

/** The most rounds `removeAll` makes. Ordinary HTML needs two: one that cuts and one that finds nothing more. */
export const MAX_ROUNDS = 8

/**
 * `text` with what each of `steps` cuts out, and cut out again until a whole round finds none: one pass over markup nested
 * in markup (`<<b>b>`, `<!-<!-- a -->- b -->`) joins what is left of the outer into a new piece of it. A step is a pattern,
 * whose matches go, or a function that returns the text with its own cut. Each cut only shortens the text, so the rounds
 * end, and `MAX_ROUNDS` ends them sooner: markup nested deeper than that is written to make a strip slow, one level a
 * round, and no HTML is. If the last round still cut something, every `<` and `>` goes, which leaves no tag and no comment.
 * A pattern's `replace` stays inside the loop, on the text it last made, which is how CodeQL's
 * `js/incomplete-multi-character-sanitization` knows the strip is repeated; a `replace` handed in from outside is not. The
 * function step makes no `replace` call, so there is nothing for CodeQL to ask of it; the properties in
 * `tests/core/markdown.spec.ts` are what hold its cut to account.
 */
function removeAll(text: string, ...steps: (RegExp | ((text: string) => string))[]): string {
  // Every cut ends in `>`, so what follows the last `>` is never part of one, in any round. It is set aside: a pattern would
  // try each `<` in it and read to the end of the text for each, the cost of a pass over the text squared.
  const end = text.lastIndexOf('>') + 1
  const after = text.slice(end)
  let rest = text.slice(0, end)
  let before: string
  let rounds = 0
  do {
    before = rest
    for (const step of steps) {
      rest = typeof step === 'function' ? step(rest) : rest.replace(step, '')
    }
    rounds += 1
  } while (rest !== before && rounds < MAX_ROUNDS)
  return rest === before ? `${rest}${after}` : `${rest}${after}`.replace(BRACKET, '')
}

/**
 * HTML outside code as Markdown: the marks it means kept, the rest dropped. The tags turned into marks here, and the
 * `<details>` that `split` reads, end their attributes at the next `<`, not at the next `>`: a tag opened and never closed
 * is read up to that `<`, not to the end of the text once for every `<` in it. `TAG` below reads on to the `>` whatever it
 * crosses, so a tag with a `<` in its attributes is still cut out, but as plain text and not as a link, a bullet or a fold.
 */
function markdownOf(text: string): string {
  const marks = removeAll(text, withoutComments)
    .replace(/<picture\b[\s\S]*?<\/picture>/giu, '')
    .replace(/<img\b[^<>]*>/giu, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
    .split('\n')
    .map(line => line.replace(/<br\s*\/?>/giu, line.trimStart().startsWith('|') ? ' ' : '  \n'))
    .join('\n')
    .replace(/<(b|strong)>([\s\S]*?)<\/\1>/giu, '**$2**')
    .replace(/<(i|em)>([\s\S]*?)<\/\1>/giu, '*$2*')
    .replace(/<(s|del|strike)>([\s\S]*?)<\/\1>/giu, '~~$2~~')
    .replace(/<(code|kbd)>([\s\S]*?)<\/\1>/giu, '`$2`')
    .replace(/<a\b[^<>]*\bhref="([^"]+)"[^<>]*>([\s\S]*?)<\/a>/giu, (_, href: string, words: string) => (words.trim() !== '' ? `[${words.trim()}](${href})` : ''))
    .replace(/<hr\s*\/?>/giu, '\n\n---\n\n')
    .replace(/<\/?p\b[^<>]*>/giu, '\n\n')
    .replace(/<li\b[^<>]*>/giu, '\n- ')
  // Cutting a tag out can join the halves of a comment, and a comment the halves of a tag, so both go until neither is left.
  return removeAll(marks, withoutComments, TAG)
    .replace(/&nbsp;/gu, ' ')
    .replace(/^(\s*[-*+]) \[[xX]\] /gmu, '$1 ✓ ')
    .replace(/^(\s*[-*+]) \[ \] /gmu, '$1 ☐ ')
    .replace(ALERT, (_, quote: string, kind: string) => `${quote}**${kind.charAt(0).toUpperCase()}${kind.slice(1).toLowerCase()}**`)
    .replace(/^[ \t]+$/gmu, '')
    .replace(/\n{3,}/gu, '\n\n')
}

/** A summary as a plain label: no marks, one line. */
const labelOf = (text: string): string => removeAll(text, MARKUP).replace(/[*_`]/gu, '').replace(/\s+/gu, ' ').trim()

const OPEN_TAG = /<details\b([^<>]*)>/iu

/** Splits masked text at its outermost `<details>`, each fold read again for those inside it. */
function split(masked: string, restore: (out: string) => string): Part[] {
  const parts: Part[] = []
  const text = (raw: string) => {
    const out = restore(markdownOf(raw)).trim()
    if (out !== '') {
      parts.push({ text: brand(out) })
    }
  }
  let rest = masked
  for (let open = OPEN_TAG.exec(rest); open !== null; open = OPEN_TAG.exec(rest)) {
    text(rest.slice(0, open.index))
    const start = open.index + open[0].length
    const anyTag = /<(\/?)details\b[^<>]*>/giu
    anyTag.lastIndex = start
    let depth = 1
    let end = rest.length
    let after = rest.length
    for (let tag = anyTag.exec(rest); tag !== null; tag = anyTag.exec(rest)) {
      depth += tag[1] === '/' ? -1 : 1
      if (depth === 0) {
        end = tag.index
        after = tag.index + tag[0].length
        break
      }
    }
    const inner = rest.slice(start, end)
    const summary = /^\s*<summary\b[^>]*>([\s\S]*?)<\/summary>/iu.exec(inner)
    const label = labelOf(restore(summary?.[1] ?? ''))
    parts.push({
      summary: label === '' ? 'Details' : label,
      parts: split(summary !== null ? inner.slice(summary[0].length) : inner, restore),
      isOpen: /\bopen\b/iu.test(open[1] ?? ''),
    })
    rest = rest.slice(after)
  }
  text(rest)
  return parts
}

/** GitLab Markdown as parts: Markdown to draw, and a fold for each `<details>`. */
export function partsOf(source: GitLabMarkdown): Part[] {
  const { masked, restore } = holdCode(source)
  return split(masked, restore)
}

/** The same as one Markdown string, each fold its summary alone, as GitLab first shows a closed one. */
export function flatOf(source: GitLabMarkdown): MarkdownText {
  const flatten = (parts: Part[]): string =>
    parts.map(part => ('text' in part ? part.text : part.isOpen ? `▾ ${part.summary}\n\n${flatten(part.parts)}` : `▸ ${part.summary}`)).join('\n\n')
  return brand(flatten(partsOf(source)))
}
