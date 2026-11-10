/**
 * GitLab's Markdown as the pane's Markdown element draws it. GitLab lets HTML through: `<details>` folds, `<br>`,
 * `<sup>` and the like. The element draws no HTML, so each fold becomes a part of its own and the rest becomes
 * Markdown or goes, as GitLab's sanitiser would drop it. Code is left exactly as written, tags and all.
 */

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

/** The start of `markdown` that fits `room` characters, ended with `…`. */
export const cutMarkdown = (markdown: MarkdownText, room: number): MarkdownText => (markdown.length > room ? brand(`${markdown.slice(0, room - 1)}…`) : markdown)

/**
 * The longest start of `markdown` whose drawing fits `room`, ended at a paragraph, a line or a word; empty if none does.
 * `sizeOf` measures a candidate's drawing.
 */
export function cutToFit(markdown: MarkdownText, room: number, sizeOf: (text: MarkdownText) => number): MarkdownText {
  let length = Math.min(markdown.length, room)
  while (length > 0) {
    const start = markdown.slice(0, length)
    const end = [start.lastIndexOf('\n\n'), start.lastIndexOf('\n'), start.lastIndexOf(' ')].find(at => at > length / 2) ?? length
    const cut = brand(`${start.slice(0, end).trimEnd()} …`)
    if (sizeOf(cut) <= room) {
      return cut
    }
    length = Math.floor(length * 0.8)
  }
  return EMPTY_MARKDOWN
}

/** Markdown to draw, or a fold: its summary, what it holds, and whether GitLab shows it open. */
export type Part = { text: MarkdownText } | { summary: string; parts: Part[]; isOpen: boolean }

const FENCE = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[ \t]*$/gm
const SPAN = /(`+)(?!`)[^\n]*?[^`\n]\1(?!`)/g
/** The marker of a held piece of code: its number between two NUL characters, which is why the pattern names them. */
const HELD = /\0(\d+)\0/g

/** Swaps code for markers, so nothing below reads inside it; `restore` puts it back. */
function holdCode(text: string) {
  const held: string[] = []
  const hold = (code: string) => `\0${held.push(code) - 1}\0`
  const masked = text.replace(FENCE, hold).replace(SPAN, hold)
  return { masked, restore: (out: string) => out.replace(HELD, (_, i: string) => held[Number(i)] ?? '') }
}

const ALERT = /^(\s*>\s*)\[!(note|tip|important|warning|caution)\]\s*$/gim

/** HTML outside code as Markdown: the marks it means kept, the rest dropped. */
function markdownOf(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<picture\b[\s\S]*?<\/picture>/gi, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .split('\n')
    .map(line => line.replace(/<br\s*\/?>/gi, line.trimStart().startsWith('|') ? ' ' : '  \n'))
    .join('\n')
    .replace(/<(b|strong)>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(i|em)>([\s\S]*?)<\/\1>/gi, '*$2*')
    .replace(/<(s|del|strike)>([\s\S]*?)<\/\1>/gi, '~~$2~~')
    .replace(/<(code|kbd)>([\s\S]*?)<\/\1>/gi, '`$2`')
    .replace(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, words: string) => (words.trim() !== '' ? `[${words.trim()}](${href})` : ''))
    .replace(/<hr\s*\/?>/gi, '\n\n---\n\n')
    .replace(/<\/?p\b[^>]*>/gi, '\n\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/?[a-z][a-z0-9-]*\b[^>]*>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/^(\s*[-*+]) \[[xX]\] /gm, '$1 ✓ ')
    .replace(/^(\s*[-*+]) \[ \] /gm, '$1 ☐ ')
    .replace(ALERT, (_, quote: string, kind: string) => `${quote}**${kind.charAt(0).toUpperCase()}${kind.slice(1).toLowerCase()}**`)
    .replace(/^[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
}

/** A summary as a plain label: no marks, one line. */
const labelOf = (text: string): string =>
  text
    .replace(/<[^>]+>/g, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const OPEN_TAG = /<details\b([^>]*)>/i

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
    const anyTag = /<(\/?)details\b[^>]*>/gi
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
    const summary = /^\s*<summary\b[^>]*>([\s\S]*?)<\/summary>/i.exec(inner)
    const label = labelOf(restore(summary?.[1] ?? ''))
    parts.push({
      summary: label === '' ? 'Details' : label,
      parts: split(summary !== null ? inner.slice(summary[0].length) : inner, restore),
      isOpen: /\bopen\b/i.test(open[1] ?? ''),
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
