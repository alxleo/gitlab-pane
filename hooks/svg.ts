/**
 * SVG source built so that no value can become markup. `svg` escapes every value put into a template, for text and for
 * quoted attributes alike. The template's own text is trusted; a finished fragment goes into another drawing through
 * `raw`, which takes only what `svg` built, so a string from GitLab has no way in as markup.
 */

/** SVG source: built by `svg`, so every value in it was escaped. */
export type SvgSource = string & { readonly __brand: 'SvgSource' }

/** The key a `RawSvg` keeps its markup under. It is not exported, so no object written elsewhere can have it. */
const MARKUP: unique symbol = Symbol('markup')

/** A fragment built by `svg`, to put into another drawing as it is; only `raw` makes one. */
export type RawSvg = { readonly [MARKUP]: string }

/** Marks a built fragment (a constant, or several joined) as markup to nest as it is. */
export const raw = (fragment: SvgSource | readonly SvgSource[]): RawSvg => ({
  [MARKUP]: typeof fragment === 'string' ? fragment : fragment.join(''),
})

/** The one place a string becomes SVG source; not exported. */
const brand = (text: string): SvgSource => text as SvgSource

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }

const escaped = (text: string): string => text.replace(/[&<>"']/g, char => ESCAPES[char] ?? char)

/** `svg\`<text>${name}</text>\`` with `name` escaped; numbers print as they are, a `raw` fragment is put in unescaped. */
export function svg(parts: TemplateStringsArray, ...values: readonly (string | number | RawSvg)[]): SvgSource {
  const show = (value: string | number | RawSvg | undefined): string =>
    value === undefined ? '' : typeof value === 'object' ? value[MARKUP] : escaped(String(value))
  return brand(parts.reduce((out, text, i) => out + text + show(values[i]), ''))
}
