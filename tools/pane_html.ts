// pane-html: a tree the pane drew, turned into the web page tools/screens/pane.css styles as the desktop app draws it.
//
// `npm run screens` photographs these pages for the README, and `npm run preview` draws the engine's live tree with them,
// its keyed elements marked so a click, a pick or typing goes back by key. The page is this module's reading of the element
// tree, not the desktop app's own paint: when the app's look changes, change pane.css.
import MarkdownIt from 'markdown-it'

import { isRecord, isSome, text } from '../hooks/decode.ts'
import type { Drawn, Mark } from './screen_delta.ts'

class TreeError extends Error {}

// ---- the tree the pane drew ---------------------------------------------------------------------------------------------

type Props = Readonly<Record<string, unknown>>

/** One element of a drawn tree, as the engine hands it over: a field it adds that is not named here stops the run. */
export type Node = {
  readonly type: string
  readonly props: Props
  readonly children: readonly (Node | string)[]
  /** Style overrides while the pointer is over the element's keyed Box, or over its hover group (`scope`). */
  readonly hover: Props | null
}

/** Where the tree is drawn: the pane, under its title bar, or the band above the prompt, over an empty prompt box. */
type Site = 'pane' | 'band'

export type Scene = {
  readonly name: string
  readonly title: string
  readonly site: Site
  /** Hover groups lit, as if the pointer rested on them. */
  readonly hover: readonly string[]
  /** Keys of the Boxes the pointer is inside; an element's hover with no group applies while its keyed Box is in this. */
  readonly hoverKeys: readonly string[]
  readonly tree: Node
}

// What the engine keeps for a press, a hover group and the plugin that drew a part is accepted and not drawn.
const NODE_FIELDS = new Set(['type', 'props', 'children', 'hover', 'press', 'group', 'part'])
const SCENE_FIELDS = new Set(['name', 'title', 'site', 'hover', 'hoverKeys', 'tree'])

export const strings = (value: unknown, what: string): string[] => {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value) || !value.every((each): each is string => typeof each === 'string')) {
    throw new TreeError(`${what} is not a list of strings`)
  }
  return value
}

export function decodeNode(value: unknown): Node {
  if (!isRecord(value)) {
    throw new TreeError('an element of the tree is not an object')
  }
  const extra = Object.keys(value).filter(key => !NODE_FIELDS.has(key))
  if (extra.length > 0) {
    throw new TreeError(`an element has fields this script was not taught: ${extra.join(', ')}`)
  }
  const { type, props, children, hover } = value
  if (typeof type !== 'string') {
    throw new TreeError('an element has no type')
  }
  if ((props !== undefined && !isRecord(props)) || (hover !== undefined && hover !== null && !isRecord(hover)) || (children !== undefined && !Array.isArray(children))) {
    throw new TreeError(`<${type}> has props, hover or children of the wrong kind`)
  }
  return {
    type,
    props: props ?? {},
    children: (children ?? []).map((child: unknown) => (typeof child === 'string' ? child : decodeNode(child))),
    hover: hover ?? null,
  }
}

export function decodeScene(value: unknown): Scene {
  if (!isRecord(value)) {
    throw new TreeError('a scene is not an object')
  }
  const extra = Object.keys(value).filter(key => !SCENE_FIELDS.has(key))
  if (extra.length > 0) {
    throw new TreeError(`a scene has fields this script was not taught: ${extra.join(', ')}`)
  }
  const { name, title, site } = value
  if (typeof name !== 'string' || typeof title !== 'string') {
    throw new TreeError('a scene has no name or title')
  }
  // A version from before the band draws every scene in the pane and names no site.
  const at = site ?? 'pane'
  if (at !== 'pane' && at !== 'band') {
    throw new TreeError(`scene ${name} is drawn at no site this script knows: ${JSON.stringify(at)}`)
  }
  return { name, title, site: at, hover: strings(value['hover'], 'hover'), hoverKeys: strings(value['hoverKeys'], 'hoverKeys'), tree: decodeNode(value['tree']) }
}

// ---- element tree to HTML -----------------------------------------------------------------------------------------------

const THEME_KEYS = new Set(['text', 'inverseText', 'inactive', 'subtle', 'suggestion', 'remember', 'success', 'error', 'warning', 'merged', 'claude', 'permission'])
const STEPS = new Map([
  ['xs', 0.5],
  ['sm', 1],
  ['md', 2],
  ['lg', 3],
  ['xl', 4],
])
const SAFE_COLOUR = /^[#\w\s(),.%/-]+$/u
const SAFE_LENGTH = /^-?\d+(\.\d+)?(%|px)?$/u
const SIZES = new Set(['caption', 'footnote', 'body', 'heading', 'title'])
const WEIGHTS = new Set(['regular', 'medium', 'semibold', 'bold'])
const BORDER_STYLES = new Set(['single', 'double', 'round', 'bold', 'singleDouble', 'doubleSingle', 'classic', 'arrow', 'dashed', 'quote'])
const MARKDOWN = new MarkdownIt('commonmark', { html: false, linkify: false }).enable('table')
/** Markdown as a live page draws it: a link opens beside the page, as the desktop opens it in the browser, not over the pane. */
const LIVE_MARKDOWN = new MarkdownIt('commonmark', { html: false, linkify: false }).enable('table')
LIVE_MARKDOWN.renderer.rules['link_open'] = (tokens, at, options, _env, renderer) => {
  tokens[at]?.attrSet('target', '_blank')
  tokens[at]?.attrSet('rel', 'noopener noreferrer')
  return renderer.renderToken(tokens, at, options)
}

// What each element may carry. A tree with any other prop stops the run, so a prop the pane starts to use is drawn on
// purpose or ignored on purpose, never dropped by accident. `DRAWN` is what the renderer draws; `KEPT` is accepted and not
// drawn (an address, a hotkey, a sandbox flag: nothing a photograph shows).
const DRAWN = new Map<string, ReadonlySet<string>>([
  [
    'Box',
    new Set([
      'flexDirection',
      'flexWrap',
      'alignItems',
      'alignSelf',
      'justifyContent',
      'overflow',
      'flexGrow',
      'flexShrink',
      'gap',
      'rowGap',
      'columnGap',
      'width',
      'minWidth',
      'height',
      'minHeight',
      'margin',
      'marginX',
      'marginY',
      'marginTop',
      'marginBottom',
      'marginLeft',
      'marginRight',
      'padding',
      'paddingX',
      'paddingY',
      'paddingTop',
      'paddingBottom',
      'paddingLeft',
      'paddingRight',
      'backgroundColor',
      'borderStyle',
      'borderColor',
      'borderDimColor',
      'position',
      'top',
      'bottom',
      'left',
      'right',
      'display',
    ]),
  ],
  ['Text', new Set(['color', 'backgroundColor', 'dimColor', 'size', 'weight', 'bold', 'mono', 'tabular', 'italic', 'underline', 'strikethrough', 'inverse', 'wrap'])],
  ['Button', new Set(['label', 'variant', 'plain', 'dimColor'])],
  ['Select', new Set(['label', 'options', 'value'])],
  ['Input', new Set(['label', 'placeholder', 'value', 'rows'])],
  ['Link', new Set(['href', 'label'])],
  ['Svg', new Set(['source', 'alt', 'width', 'height'])],
  ['Image', new Set(['source', 'alt', 'columns', 'rows'])],
  ['Markdown', new Set(['text', 'dimColor'])],
  ['Code', new Set(['source', 'format', 'startLine', 'wrap'])],
])
const KEPT = new Map<string, ReadonlySet<string>>([
  // What picks a highlighter: the pictures draw code plain.
  ['Code', new Set(['key', 'path', 'language'])],
  ['Box', new Set(['key'])],
  ['Text', new Set(['dir'])],
  ['Button', new Set(['key', 'hotkey', 'action', 'role', 'autoFocus'])],
  ['Select', new Set(['key', 'autoFocus'])],
  // What Enter is called is drawn beside the field only while it has focus, and no scene has focus.
  ['Input', new Set(['key', 'autoFocus', 'submitLabel'])],
  ['Link', new Set()],
  ['Svg', new Set(['isInteractive'])],
  ['Image', new Set(['key'])],
  ['Markdown', new Set(['key', 'pressableLinks'])],
])
const HOVER_PROPS = new Set([
  'scope',
  'color',
  'backgroundColor',
  'dimColor',
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'inverse',
  'borderStyle',
  'borderColor',
  'borderDimColor',
  'display',
  'top',
  'left',
  'right',
  'bottom',
])

/** What the pointer is on: the hover groups it lights, and the keyed Boxes it is inside. */
type Lit = { readonly scopes: ReadonlySet<string>; readonly keys: ReadonlySet<string> }

/** Python's `html.escape`, which is what the pages were written with. */
export const escape = (raw: string): string => raw.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;')

const isText = (value: unknown): value is string => typeof value === 'string'

/** A theme key becomes the theme's variable; any other string is a raw colour, kept only if it looks like one. */
function colour(value: unknown): string | null {
  if (!isText(value)) {
    return null
  }
  if (THEME_KEYS.has(value)) {
    return `var(--c-${value})`
  }
  return SAFE_COLOUR.test(value) ? value : null
}

/** A number of cells across (`x`) or down (`y`), or a step name, in the page's own unit. */
function space(value: unknown, axis: 'x' | 'y'): string | null {
  const cells = isText(value) ? STEPS.get(value) : typeof value === 'number' ? value : undefined
  return cells === undefined ? null : `calc(var(--u${axis}) * ${cells})`
}

/** A width or height: cells when a number, as written when a percentage or pixels. */
function length(value: unknown, axis: 'x' | 'y'): string | null {
  if (isText(value) && SAFE_LENGTH.test(value)) {
    return value.endsWith('%') || value.endsWith('px') ? value : `${value}px`
  }
  return space(value, axis)
}

const either = (...values: (string | null)[]): string | null => values.find(each => each !== null && each !== '') ?? null

const style = (css: ReadonlyMap<string, string>): string => [...css].map(([name, value]) => `${name}: ${value}`).join('; ')

const kebab = (name: string): string => name.replace(/([A-Z])/gu, '-$1').toLowerCase()

/** The most specific of `paddingTop`, `paddingY` and `padding` that is set, as Ink resolves them. */
function side(props: Props, kind: string, edge: string, axis: 'x' | 'y'): string | null {
  const pair = axis === 'y' ? 'Y' : 'X'
  const name = [`${kind}${edge}`, `${kind}${pair}`, kind].find(each => isSome(props[each]))
  return name === undefined ? null : space(props[name], axis)
}

/** The class that draws the border (its width, shape and radius are pane.css's); the colour rides along as --bc. */
function border(props: Props, css: Map<string, string>): string {
  const kind = props['borderStyle']
  if (!isText(kind)) {
    return ''
  }
  const tone = colour(props['borderColor']) ?? 'var(--c-subtle)'
  css.set('--bc', props['borderDimColor'] === true ? `color-mix(in srgb, ${tone} 50%, transparent)` : tone)
  return BORDER_STYLES.has(kind) ? `border-${kind}` : 'border-single'
}

/** A Box's classes, its inline style (layout the tree sets), and whether it is drawn `display: none`. */
function boxStyle(props: Props): { readonly classes: string; readonly css: string; readonly hidden: boolean } {
  const css = new Map<string, string>()
  for (const [prop, name] of [
    ['flexDirection', 'flex-direction'],
    ['flexWrap', 'flex-wrap'],
    ['alignItems', 'align-items'],
    ['alignSelf', 'align-self'],
    ['justifyContent', 'justify-content'],
    ['overflow', 'overflow'],
  ] as const) {
    const value = props[prop]
    if (isText(value) && /^[\w-]+$/u.test(value)) {
      css.set(name, value)
    }
  }
  for (const [prop, name] of [
    ['flexGrow', 'flex-grow'],
    ['flexShrink', 'flex-shrink'],
  ] as const) {
    const value = props[prop]
    if (typeof value === 'number') {
      css.set(name, String(value))
    }
  }
  const gap = space(props['gap'], 'x')
  const rowGap = space('rowGap' in props ? props['rowGap'] : props['gap'], 'y')
  const columnGap = space('columnGap' in props ? props['columnGap'] : props['gap'], 'x')
  if (either(rowGap, gap) !== null) {
    css.set('row-gap', either(rowGap, gap) ?? '0')
  }
  if (either(columnGap, gap) !== null) {
    css.set('column-gap', either(columnGap, gap) ?? '0')
  }
  for (const prop of ['width', 'minWidth']) {
    const value = length(props[prop], 'x')
    if (value !== null) {
      css.set(kebab(prop), value)
    }
  }
  for (const prop of ['height', 'minHeight']) {
    const value = length(props[prop], 'y')
    if (value !== null) {
      css.set(kebab(prop), value)
    }
  }
  for (const kind of ['margin', 'padding']) {
    for (const [edge, axis] of [
      ['Top', 'y'],
      ['Bottom', 'y'],
      ['Left', 'x'],
      ['Right', 'x'],
    ] as const) {
      const value = side(props, kind, edge, axis)
      if (value !== null) {
        css.set(`${kind}-${edge.toLowerCase()}`, value)
      }
    }
  }
  const background = colour(props['backgroundColor'])
  if (background !== null) {
    css.set('background-color', background)
  }
  const classes = ['box', border(props, css)]
  if (props['position'] === 'absolute') {
    css.set('position', 'absolute')
    for (const [edge, axis] of [
      ['top', 'y'],
      ['bottom', 'y'],
      ['left', 'x'],
      ['right', 'x'],
    ] as const) {
      const value = props[edge]
      const cells = typeof value === 'number' ? space(value, axis) : null
      if (cells !== null) {
        css.set(edge, cells)
      }
    }
  }
  return { classes: classes.filter(each => each !== '').join(' '), css: style(css), hidden: props['display'] === 'none' }
}

function textClasses(props: Props): { readonly classes: string; readonly css: string } {
  const classes = ['text']
  const css = new Map<string, string>()
  const colourOf = colour(props['color'])
  if (colourOf !== null) {
    css.set('color', colourOf)
  }
  const background = colour(props['backgroundColor'])
  if (background !== null) {
    css.set('background-color', background)
  }
  if (props['dimColor'] === true) {
    classes.push('dim')
  }
  const size = props['size']
  if (isText(size) && SIZES.has(size)) {
    classes.push(size)
  }
  const named = props['weight']
  const weight = isText(named) && named !== '' ? named : props['bold'] === true ? 'semibold' : null
  if (weight !== null && WEIGHTS.has(weight)) {
    classes.push(`w-${weight}`)
  }
  for (const flag of ['mono', 'tabular']) {
    if (props[flag] === true) {
      classes.push(flag)
    }
  }
  if (props['italic'] === true) {
    css.set('font-style', 'italic')
  }
  const decorations = [props['underline'] === true ? 'underline' : '', props['strikethrough'] === true ? 'line-through' : ''].filter(each => each !== '')
  if (decorations.length > 0) {
    css.set('text-decoration', decorations.join(' '))
  }
  if (props['inverse'] === true) {
    const ink = css.get('color') ?? 'var(--ink)'
    css.set('color', 'var(--surface)')
    css.set('background-color', ink)
  }
  const wrap = props['wrap']
  if (isText(wrap) && (wrap.startsWith('truncate') || wrap === 'end' || wrap === 'middle')) {
    classes.push('cut')
    if (wrap === 'truncate-start') {
      classes.push('cut-start')
    }
  }
  return { classes: classes.join(' '), css: style(css) }
}

/** The hover props that apply now: a group's while the pointer is on the group, any other while it is in the keyed Box. */
function hovered(node: Node, key: string | null, lit: Lit): Props {
  const hover = node.hover ?? {}
  const scope = hover['scope']
  const applies = isText(scope) ? lit.scopes.has(scope) : key !== null && lit.keys.has(key)
  // A hover restyles a border the Box has; it adds none.
  return applies ? Object.fromEntries(Object.entries(hover).filter(([name]) => name !== 'scope' && (!name.startsWith('border') || 'borderStyle' in node.props))) : {}
}

/** Notes any prop or hover prop this renderer was not taught, under the name `Element.prop`. */
function unknownProps(node: Node): string[] {
  const known = new Set([...(DRAWN.get(node.type) ?? []), ...(KEPT.get(node.type) ?? [])])
  const props = DRAWN.has(node.type)
    ? Object.keys(node.props)
        .filter(name => !known.has(name))
        .map(name => `${node.type}.${name}`)
    : []
  return [
    ...props,
    ...Object.keys(node.hover ?? {})
      .filter(name => !HOVER_PROPS.has(name))
      .map(name => `${node.type}.hover.${name}`),
  ]
}

/** What a delta picture marks on an element: faded as drawn before, outlined as new or changed, or nothing. */
const MARK_CLASS: Record<Mark, string> = { same: ' delta-same', changed: ' delta-changed' }

/**
 * A delta picture's own look, on top of pane.css: faint enough to read past, the change at full strength and outlined.
 * The fade is a filter, not `opacity`, which pane.css sets on dim text: on the same element one would replace the other,
 * where a filter adds to it, so dim text fades as far as the rest.
 */
const DELTA_STYLE = '<style>.delta-same { filter: opacity(0.3); } .delta-changed { outline: 2px solid #d97706; outline-offset: 2px; border-radius: 3px; }</style>'

/**
 * How one tree is drawn: what the pointer lights, what a delta picture marks, and whether the page is live. `unknown`
 * collects what could not be drawn, so the run can say so.
 */
type Drawing = { readonly lit: Lit; readonly marks: ReadonlyMap<Drawn, Mark>; readonly live: boolean; readonly unknown: Set<string> }

/**
 * A live page's mark on an element a person can press, pick in or type in, as the desktop marks what it measures: the
 * element's key and which of the three it is. A picture draws none.
 */
function pressable(node: Node, drawing: Drawing, kind: 'button' | 'select' | 'input'): string {
  const key = node.props['key']
  return drawing.live && isText(key) && key !== '' ? ` data-press-key="${escape(key)}" data-kind="${kind}"` : ''
}

/** The tree as HTML. `key` is the nearest keyed Box around. */
function draw(node: Node | string, drawing: Drawing, key: string | null = null): string {
  if (isText(node)) {
    return escape(node)
  }
  unknownProps(node).forEach(name => drawing.unknown.add(name))
  const nearest = node.type === 'Box' && isText(node.props['key']) ? node.props['key'] : key
  const props = { ...node.props, ...hovered(node, nearest, drawing.lit) }
  const inner = node.children.map(child => draw(child, drawing, nearest)).join('')
  const label = escape(text(props['label']))
  const mark = drawing.marks.get(node)
  const marked = mark !== undefined ? MARK_CLASS[mark] : ''
  switch (node.type) {
    case 'Box': {
      const box = boxStyle(props)
      return `<div class="${box.classes}${marked}"${box.hidden ? ' data-hidden' : ''} style="${escape(box.css)}">${inner}</div>`
    }
    case 'Text': {
      const look = textClasses(props)
      return `<span class="${look.classes}${marked}" style="${escape(look.css)}">${inner}</span>`
    }
    case 'Link': {
      const href = text(props['href'])
      // A live page opens a link beside itself, as the desktop opens it in the browser.
      const away = drawing.live ? ' target="_blank" rel="noopener noreferrer"' : ''
      return `<a class="link${marked}" href="${escape(href)}"${away}>${inner === '' ? escape(text(props['label'] ?? props['href'])) : inner}</a>`
    }
    case 'Button': {
      const variant = props['variant']
      const classes = [
        'btn',
        props['plain'] === true ? 'plain' : '',
        variant === 'primary' || variant === 'secondary' ? variant : '',
        props['dimColor'] === true ? 'dim' : '',
      ].filter(each => each !== '')
      return `<button class="${classes.join(' ')}${marked}"${pressable(node, drawing, 'button')}>${inner === '' ? label : inner}</button>`
    }
    case 'Select': {
      // Closed, as a picker sits on the page: its label, the picked option's text (the first's when none is picked) and the
      // mark that opens the list. A live page's picker opens.
      const options = Array.isArray(props['options']) ? props['options'].filter(isRecord) : []
      const picked = options.find(option => option['value'] === props['value']) ?? options[0]
      const head = label !== '' ? `${label} ` : ''
      if (drawing.live) {
        const choices = options.map(option => {
          const value = text(option['value'])
          return `<option value="${escape(value)}"${option === picked ? ' selected' : ''}>${escape(text(option['label'] ?? option['value']))}</option>`
        })
        return `<span class="select${marked}"${pressable(node, drawing, 'select')}>${head}<select>${choices.join('')}</select></span>`
      }
      const shown = picked !== undefined ? text(picked['label'] ?? picked['value']) : ''
      return `<span class="select${marked}">${head}${escape(shown)}<span class="caret">▾</span></span>`
    }
    case 'Input': {
      // Without focus: its label, then the field with the text it holds, or its placeholder dim, as tall as its rows. A live
      // page's field takes typing, and notes the text it was drawn with.
      const value = text(props['value'])
      const rows = typeof props['rows'] === 'number' ? Math.max(1, Math.trunc(props['rows'])) : 1
      const head = label !== '' ? `<span>${label}</span>` : ''
      if (drawing.live) {
        const held = `class="field" placeholder="${escape(text(props['placeholder']))}" data-drawn="${escape(value)}"`
        const field = rows > 1 ? `<textarea ${held} rows="${rows}">${escape(value)}</textarea>` : `<input ${held} value="${escape(value)}">`
        return `<span class="input${marked}"${pressable(node, drawing, 'input')}>${head}${field}</span>`
      }
      const field = value !== '' ? escape(value) : `<span class="dim">${escape(text(props['placeholder']))}</span>`
      return `<span class="input${marked}">${head}<span class="field" style="min-height: ${rows * 1.5}em">${field}</span></span>`
    }
    case 'Svg': {
      // An Svg's size is CSS pixels, not cells.
      const [width, height] = [props['width'], props['height']]
      const size = `${typeof width === 'number' ? `width: ${Math.trunc(width)}px; ` : ''}${typeof height === 'number' ? `height: ${Math.trunc(height)}px` : ''}`
      return `<div class="svg${marked}" role="img" aria-label="${escape(text(props['alt']))}" style="${size}">${text(props['source'])}</div>`
    }
    case 'Image': {
      const source = props['source']
      const png = isRecord(source) ? source['png'] : undefined
      if (isText(png) && /^[A-Za-z0-9+/=]+$/u.test(png)) {
        const size = `width: ${space(props['columns'], 'x') ?? 'None'}; height: ${space(props['rows'], 'y') ?? 'None'}`
        return `<img class="svg${marked}" alt="${escape(text(props['alt']))}" style="${size}" src="data:image/png;base64,${png}">`
      }
      return undrawn(node, drawing.unknown)
    }
    case 'Markdown':
      return `<div class="md${props['dimColor'] === true ? ' dim' : ''}${marked}">${(drawing.live ? LIVE_MARKDOWN : MARKDOWN).render(text(props['text']))}</div>`
    case 'Code':
      return `<div class="code${props['wrap'] === 'truncate-end' ? ' cut' : ''}${marked}">${codeRows(text(props['source']), props['format'] === 'diff', props['startLine'])}</div>`
    default:
      return undrawn(node, drawing.unknown)
  }
}

/**
 * Code as the desktop draws it: a diff's hunks with each line's old and new number, its sign and its colour; plain code
 * numbered from `startLine` when it has one. A diff that parses as no hunks is drawn plain, as the engine draws it.
 */
function codeRows(source: string, isDiff: boolean, startLine: unknown): string {
  const row = (classes: string, gutters: readonly string[], body: string) =>
    `<div class="code-row${classes}">${gutters.map(gutter => `<span class="gutter">${escape(gutter)}</span>`).join('')}<span class="src">${escape(body)}</span></div>`
  const lines = source.split('\n')
  if (isDiff && lines.some(line => /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/u.test(line))) {
    let old = 0
    let now = 0
    return lines
      .flatMap(line => {
        const head = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line)
        if (head !== null) {
          old = Number(head[1])
          now = Number(head[2])
          return []
        }
        const sign = line.slice(0, 1)
        const numbers = [sign === '+' ? '' : String(old), sign === '-' ? '' : String(now)]
        old += sign === '+' ? 0 : 1
        now += sign === '-' ? 0 : 1
        return [row(sign === '+' ? ' add' : sign === '-' ? ' del' : '', numbers, line)]
      })
      .join('')
  }
  const first = typeof startLine === 'number' ? startLine : null
  return lines.map((line, at) => row('', first !== null ? [String(first + at)] : [], line)).join('')
}

function undrawn(node: Node, unknown: Set<string>): string {
  unknown.add(node.type)
  return `<div class="unknown">&lt;${escape(node.type)}&gt; is not drawn by this renderer</div>`
}

/**
 * The pane's body as a live page draws it: each keyed Button, Select and Input marked with its key, so the page can send a
 * click, a pick or typing back by it; no hover lit and no delta marked. `unknown` is what it could not draw.
 */
export function liveHtml(tree: Node): { readonly html: string; readonly unknown: ReadonlySet<string> } {
  const unknown = new Set<string>()
  const html = draw(tree, { lit: { scopes: new Set(), keys: new Set() }, marks: new Map(), live: true, unknown })
  return { html, unknown }
}

/**
 * The scene's page; `width` overrides pane.css's own only when the command line gave one. With `marks`, it is the scene's
 * delta picture: what was drawn before fades, and what is new or changed keeps its look, outlined.
 */
export function pageHtml(scene: Scene, width: number | null, marks: ReadonlyMap<Drawn, Mark> = new Map()): { readonly document: string; readonly unknown: Set<string> } {
  const unknown = new Set<string>()
  const body = draw(scene.tree, { lit: { scopes: new Set(scene.hover), keys: new Set(scene.hoverKeys) }, marks, live: false, unknown })
  const override = `${width === null ? '' : `<style>:root { --pane-width: ${width}px; }</style>`}${marks.size > 0 ? DELTA_STYLE : ''}`
  const title = escape(scene.title)
  const document = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<link rel="stylesheet" href="pane.css">
${override}</head>
<body>${
    scene.site === 'band'
      ? `<div id="band"><main>${body}</main><div class="prompt"></div></div>`
      : `<div id="pane"><header><span>${title}</span><span class="close">×</span></header><main>${body}</main></div>`
  }</body></html>
`
  return { document, unknown }
}
