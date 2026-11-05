/**
 * Text that reaches the model. A value from GitLab (a job name from the repo's CI config, a title, a branch) is written
 * by whoever can open an MR, so it enters a line only through `foreign`; the rest of a line is this code's own words.
 */

/** One line of text for the model: no line breaks or control characters in what GitLab supplied. */
export type ModelLine = string & { readonly __brand: 'ModelLine' }

/** The one place a string becomes a line; not exported, so only the constructors below make one. */
const brand = (text: string): ModelLine => text as ModelLine

/** Characters a name is cut to unless a caller says more, and a link. */
export const NAME_ROOM = 80
export const URL_ROOM = 300

/**
 * A foreign value as one line: control and format characters (bidi overrides, zero-width marks) gone, every run of
 * whitespace and line breaks one space, cut at `room` characters.
 */
export function foreign(text: string, room = NAME_ROOM): ModelLine {
  // Format characters go first: removed after the whitespace is joined, one between two spaces would leave a double space.
  const flat = text
    .replace(/\p{Cf}/gu, '')
    .replace(/[\p{Cc}\p{Z}\s]+/gu, ' ')
    .trim()
  const chars = [...flat]
  return brand(chars.length > room ? `${chars.slice(0, room - 1).join('')}…` : flat)
}

/**
 * What may stand in a `line` template: a number, another line, or a string literal type such as a status. A plain
 * `string` fails the literal test, and so does any branded one (Markdown, SVG source), whose key type is not a literal.
 */
export type Sayable<T> = T extends number | ModelLine ? T : T extends string ? (string extends T ? never : {} extends Record<T, 1> ? never : T) : never

/**
 * A line from this code's own words: the template's text is trusted, and a value must be a number, another line or a
 * string literal type such as a status; a `string` from GitLab, or any branded string, does not compile and goes
 * through `foreign` first.
 */
export function line<V extends readonly (number | string)[]>(parts: TemplateStringsArray, ...values: V & { [K in keyof V]: Sayable<V[K]> }): ModelLine {
  return brand(parts.reduce((out, text, i) => out + text + (i < values.length ? String(values[i]) : ''), ''))
}

/** No words. */
export const EMPTY = line``

/** Lines joined with ` · `, none left out when empty. */
export const dotted = (parts: readonly ModelLine[]): ModelLine => brand(parts.filter(Boolean).join(' · '))

/** Lines joined with `, `. */
export const commas = (parts: readonly ModelLine[]): ModelLine => brand(parts.join(', '))

/** Several lines as the text of one message. */
export const lines = (parts: readonly ModelLine[]): string => parts.join('\n')
