/**
 * Reads of text in time in proportion to it, for what a regular expression reads in time squared. A pattern that looks
 * ahead from an opener for its closer reads to the end of the text for every opener that has none, and so for each `<b>`
 * of a text that is nothing else. Each read here remembers the closer it found last: a later opener whose closer is the
 * same, or that has none either, is answered without reading again.
 */

/**
 * Where `pattern` next matches at or after a position: the match, or null when it matches nowhere after it. Asked of
 * positions that only grow, the searches together read the text about once: an answer stands for every position from
 * the one asked up to where it matched, and no match stands for every position after.
 */
function searcher(text: string, pattern: RegExp): (from: number) => RegExpExecArray | null {
  const last: { from: number; found: RegExpExecArray | null } = { from: Infinity, found: null }
  return from => {
    if (from < last.from || (last.found !== null && from > last.found.index)) {
      pattern.lastIndex = from
      last.found = pattern.exec(text)
      last.from = from
    }
    return last.found
  }
}

/** The first of `sorted` at or after `from`, or undefined. */
function firstFrom(sorted: readonly number[], from: number): number | undefined {
  let low = 0
  let high = sorted.length
  while (low < high) {
    const middle = (low + high) >> 1
    if ((sorted[middle] ?? Infinity) < from) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  return sorted[low]
}

/**
 * `text` with each `[words](address)` made over by `by`, read as `/\[([^\]]*)\]\([^)]*\)/g` reads it: the words run to
 * the first `]`, which a `(` must follow, and the address to the first `)` after that. `bang` says whether the `!` of a
 * picture may (`may`) or must (`must`) come before it, and then is part of what `by` replaces, or is not read (`none`).
 * No `]` after an opener, or no `)` after that `]`, means none after a later opener either, which ends the read.
 */
export function replaceLinks(text: string, bang: 'none' | 'may' | 'must', by: (words: string) => string): string {
  const close = searcher(text, /\]/gu)
  const end = searcher(text, /\)/gu)
  const kept: string[] = []
  let from = 0
  for (let open = text.indexOf('[', from); open !== -1; open = text.indexOf('[', open + 1)) {
    const isBang = open - 1 >= from && text[open - 1] === '!'
    if (bang === 'must' && !isBang) {
      continue
    }
    const words = close(open + 1)
    if (words === null) {
      break
    }
    if (text[words.index + 1] !== '(') {
      continue
    }
    const address = end(words.index + 2)
    if (address === null) {
      break
    }
    kept.push(text.slice(from, isBang && bang !== 'none' ? open - 1 : open), by(text.slice(open + 1, words.index)))
    from = address.index + 1
    open = address.index
  }
  kept.push(text.slice(from))
  return kept.join('')
}

/**
 * `text` with each element made over by `by`, read as `/<opener>([\s\S]*?)<closer>/giu` reads it: an opener goes with the
 * first closer after it, whatever its case, and one with no closer is left as it is, the read going on from the character
 * after its start. `closerOf` names an opener's closer, as written (`</${open[1]}>` reads as `<\/\1>` does): letters and
 * `</>`, nothing a pattern reads as more than itself. `by` takes the opener's match and what is between it and its closer.
 */
export function replacePairs(text: string, opener: RegExp, closerOf: (open: RegExpExecArray) => string, by: (open: RegExpExecArray, inner: string) => string): string {
  const closers = new Map<string, (from: number) => RegExpExecArray | null>()
  const closerAfter = (open: RegExpExecArray, from: number) => {
    const closer = closerOf(open).toLowerCase()
    const known = closers.get(closer)
    const search = known ?? searcher(text, new RegExp(closer, 'giu'))
    if (known === undefined) {
      closers.set(closer, search)
    }
    return search(from)
  }
  const kept: string[] = []
  let from = 0
  opener.lastIndex = 0
  for (let open = opener.exec(text); open !== null; open = opener.exec(text)) {
    const inner = open.index + open[0].length
    const close = closerAfter(open, inner)
    if (close === null) {
      opener.lastIndex = open.index + 1
    } else {
      kept.push(text.slice(from, open.index), by(open, text.slice(inner, close.index)))
      from = close.index + close[0].length
      opener.lastIndex = from
    }
  }
  kept.push(text.slice(from))
  return kept.join('')
}

/**
 * `text` with each `<a href="…">words</a>` made over by `by`, read as `/<a\b[^<>]*\bhref="([^"]+)"[^<>]*>([\s\S]*?)<\/a>/giu`
 * reads it. That pattern tries an opener's `href="`s from the last, and each reads on to a `<` or `>`, so an opener that
 * says `href` over and over costs its length squared. Here the `<` or `>` that ends an opener's attributes is found once:
 * every `href="` but the last has its value end before it, so each of those ends the opener there, if it is a `>`; only the
 * last one's value can run past it. Each search is asked of positions that only grow, from one opener to the next. `by`
 * takes the address and the words, as written.
 */
export function replaceAnchors(text: string, by: (href: string, words: string) => string): string {
  const anchor = /<a\b/giu
  const hrefAt = searcher(text, /\bhref="/giu)
  const edgeOf = searcher(text, /[<>]/gu)
  const angleAfter = searcher(text, /[<>]/gu)
  const closerAtEdge = searcher(text, /<\/a>/giu)
  const closerPastEdge = searcher(text, /<\/a>/giu)
  const kept: string[] = []
  let from = 0
  for (let open = anchor.exec(text); open !== null; open = anchor.exec(text)) {
    const edge = edgeOf(open.index + 2)
    if (edge === null) {
      break
    }
    const starts: number[] = []
    for (let found = hrefAt(open.index + 2); found !== null && found.index < edge.index; found = hrefAt(found.index + 1)) {
      starts.push(found.index + found[0].length)
    }
    anchor.lastIndex = open.index + 1
    for (const value of starts.toReversed()) {
      const quote = text.indexOf('"', value)
      if (quote <= value) {
        continue
      }
      const end = quote < edge.index ? edge : angleAfter(quote + 1)
      const close = end !== null && text[end.index] === '>' ? (end === edge ? closerAtEdge : closerPastEdge)(end.index + 1) : null
      if (end !== null && close !== null) {
        kept.push(text.slice(from, open.index), by(text.slice(value, quote), text.slice(end.index + 1, close.index)))
        from = close.index + close[0].length
        anchor.lastIndex = from
        break
      }
    }
  }
  kept.push(text.slice(from))
  return kept.join('')
}

/** Adds `value` to the list `map` keeps under `key`. */
function listed<Key>(map: Map<Key, number[]>, key: Key, value: number): void {
  const list = map.get(key)
  if (list === undefined) {
    map.set(key, [value])
  } else {
    list.push(value)
  }
}

/**
 * `text` with each fenced block of code made over by `by`, read as `/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[ \t]*$/gmu`
 * reads it: a fence opens a block at the start of a line, and the first line after its own that holds the same fence
 * alone closes it. A fence of more than three that finds no closer is tried one shorter, down to three, as the pattern
 * gives back what it took. The lines that could close a block are listed once, by fence, so an opener with no closer is
 * answered from the list, not by reading to the end of the text.
 */
export function replaceFences(text: string, by: (code: string) => string): string {
  const closers = new Map<string, number[]>()
  const ends = new Map<number, number>()
  for (const line of text.matchAll(/^ {0,3}(`{3,}|~{3,})[ \t]*$/gmu)) {
    listed(closers, line[1] ?? '', line.index)
    ends.set(line.index, line.index + line[0].length)
  }
  const opener = /^ {0,3}(`{3,}|~{3,})/gmu
  const kept: string[] = []
  let from = 0
  for (let open = opener.exec(text); open !== null; open = opener.exec(text)) {
    const run = open[1] ?? ''
    const newline = text.indexOf('\n', open.index + open[0].length)
    if (newline === -1) {
      break
    }
    opener.lastIndex = open.index + 1
    for (let length = run.length; length >= 3; length -= 1) {
      const close = firstFrom(closers.get(run.slice(0, length)) ?? [], newline + 1)
      const end = close !== undefined ? ends.get(close) : undefined
      if (end !== undefined) {
        kept.push(text.slice(from, open.index), by(text.slice(open.index, end)))
        from = end
        opener.lastIndex = end
        break
      }
    }
  }
  kept.push(text.slice(from))
  return kept.join('')
}

/**
 * `text` with each span of code made over by `by`, read as /(`+)(?!`)[^\n]*?[^`\n]\1(?!`)/gu reads it: from a backtick,
 * the rest of its run opens a span, which the first later run of as many backticks on the same line closes. A run with
 * no closer is tried again from its next backtick, one shorter, as the pattern does. The runs are listed once, by length,
 * so an opener with no closer is answered from the list, not by reading to the end of its line.
 */
export function replaceSpans(text: string, by: (code: string) => string): string {
  const runs = [...text.matchAll(/`+/gu)].map(run => ({ start: run.index, end: run.index + run[0].length }))
  const byLength = new Map<number, number[]>()
  for (const run of runs) {
    listed(byLength, run.end - run.start, run.start)
  }
  const newline = searcher(text, /\n/gu)
  const kept: string[] = []
  let from = 0
  for (const run of runs) {
    const lineEnd = newline(run.end)?.index ?? text.length
    for (let at = Math.max(run.start, from); at < run.end; at += 1) {
      const length = run.end - at
      const close = firstFrom(byLength.get(length) ?? [], run.end + 1)
      if (close !== undefined && close < lineEnd) {
        kept.push(text.slice(from, at), by(text.slice(at, close + length)))
        from = close + length
        break
      }
    }
  }
  kept.push(text.slice(from))
  return kept.join('')
}
