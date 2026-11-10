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
const COMMENT = /<!--[\s\S]*?-->/gu
const TAG = /<\/?[a-z][a-z0-9-]*\b[^>]*>/giu
/** Anything between `<` and `>`, which a summary's label has no use for. */
const MARKUP = /<[^>]+>/gu

/**
 * `text` with every match of `patterns` cut out, and cut out again until a whole round finds none: one pass over markup
 * nested in markup (`<<b>b>`, `<!-<!-- a -->- b -->`) joins what is left of the outer into a new piece of it. Each cut
 * only shortens the text, so the rounds end. The `replace` stays inside the loop, on the text it last made, which is how
 * CodeQL's `js/incomplete-multi-character-sanitization` knows the strip is repeated; a step handed in from outside is not.
 */
function removeAll(text: string, ...patterns: RegExp[]): string {
  let rest = text
  let before: string
  do {
    before = rest
    for (const pattern of patterns) {
      rest = rest.replace(pattern, '')
    }
  } while (rest !== before)
  return rest
}

/** HTML outside code as Markdown: the marks it means kept, the rest dropped. */
function markdownOf(text: string): string {
  const marks = removeAll(text, COMMENT)
    .replace(/<picture\b[\s\S]*?<\/picture>/giu, '')
    .replace(/<img\b[^>]*>/giu, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
    .split('\n')
    .map(line => line.replace(/<br\s*\/?>/giu, line.trimStart().startsWith('|') ? ' ' : '  \n'))
    .join('\n')
    .replace(/<(b|strong)>([\s\S]*?)<\/\1>/giu, '**$2**')
    .replace(/<(i|em)>([\s\S]*?)<\/\1>/giu, '*$2*')
    .replace(/<(s|del|strike)>([\s\S]*?)<\/\1>/giu, '~~$2~~')
    .replace(/<(code|kbd)>([\s\S]*?)<\/\1>/giu, '`$2`')
    .replace(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/giu, (_, href: string, words: string) => (words.trim() !== '' ? `[${words.trim()}](${href})` : ''))
    .replace(/<hr\s*\/?>/giu, '\n\n---\n\n')
    .replace(/<\/?p\b[^>]*>/giu, '\n\n')
    .replace(/<li\b[^>]*>/giu, '\n- ')
  // Cutting a tag out can join the halves of a comment, and a comment the halves of a tag, so both go until neither is left.
  return removeAll(marks, COMMENT, TAG)
    .replace(/&nbsp;/gu, ' ')
    .replace(/^(\s*[-*+]) \[[xX]\] /gmu, '$1 ✓ ')
    .replace(/^(\s*[-*+]) \[ \] /gmu, '$1 ☐ ')
    .replace(ALERT, (_, quote: string, kind: string) => `${quote}**${kind.charAt(0).toUpperCase()}${kind.slice(1).toLowerCase()}**`)
    .replace(/^[ \t]+$/gmu, '')
    .replace(/\n{3,}/gu, '\n\n')
}

/** A summary as a plain label: no marks, one line. */
const labelOf = (text: string): string => removeAll(text, MARKUP).replace(/[*_`]/gu, '').replace(/\s+/gu, ' ').trim()

const OPEN_TAG = /<details\b([^>]*)>/iu

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
    const anyTag = /<(\/?)details\b[^>]*>/giu
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
