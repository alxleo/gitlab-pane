// pane-screens: the README's screenshots of the GitLab pane, drawn by the mod's own code and photographed headless.
//
//   node tools/pane_screens.ts render                      write docs/screens/<scene>.png for every scene
//   node tools/pane_screens.ts render --scene inbox        one scene
//   node tools/pane_screens.ts render --out /tmp/shots     somewhere else, to compare two runs
//   node tools/pane_screens.ts render --verify             draw twice, fail unless both are byte-identical
//   node tools/pane_screens.ts render --check              draw, and fail unless docs/screens already holds exactly these PNGs; writes nothing
//   node tools/pane_screens.ts setup [--with-deps]         fetch the Chromium it photographs with (once per Playwright version)
//
// (`npm run screens -- <command>` is the same.) How it works, so nobody has to remember it:
//
//   1. tools/screens/scenes.ts runs under `claude plugin test`, in a scratch copy of the mod, with GitLab
//      answered by made-up data (acme-corp, alice, bob) and the clock held still. For each scene it prints the element
//      tree the pane draws on the desktop surface, exactly as the engine validated it.
//   2. This script turns that tree into a web page (tools/screens/pane.css) and Chromium photographs it, with the fonts
//      in tools/screens/fonts, so a Mac and a CI runner draw the same letters.
//
// `render` talks to no one: not GitLab, not Anthropic, nothing on the network, and it reads none of your Claude config. The page is this script's reading of the element tree, not the
// desktop app's own paint: when the app's look changes, change pane.css.
//
// Same commit, same machine kind: the same bytes. A Mac and a Linux runner agree on what is drawn, not on every pixel.
import { spawnSync } from 'node:child_process'
import { closeSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import MarkdownIt from 'markdown-it'
import { chromium, type BrowserContext, type Page } from 'playwright'

import { isRecord, isSome, parseJson } from '../hooks/decode.ts'

const ROOT = join(import.meta.dirname, '..')
const SCREENS = join(import.meta.dirname, 'screens')
const SCENES_FILE = join(SCREENS, 'scenes.ts')
const SHOTS = join(ROOT, 'docs', 'screens')
// The Claude Code that CI pins (CLAUDE_CODE_VERSION in check.yml and screens.yml): another version may draw the pane differently.
const EXPECTED_CLAUDE = '2.1.318'
const MARKER = 'PANE-SCENE '
const LISTED = 'PANE-SCENES '

class ScreensError extends Error {}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// ---- the tree the pane drew ---------------------------------------------------------------------------------------------

type Props = Readonly<Record<string, unknown>>

/** One element of a drawn tree, as the engine hands it over: a field it adds that is not named here stops the run. */
type Node = {
  readonly type: string
  readonly props: Props
  readonly children: readonly (Node | string)[]
  /** Style overrides while the pointer is over the element's keyed Box, or over its hover group (`scope`). */
  readonly hover: Props | null
}

type Scene = {
  readonly name: string
  readonly title: string
  /** Hover groups lit, as if the pointer rested on them. */
  readonly hover: readonly string[]
  /** Keys of the Boxes the pointer is inside; an element's hover with no group applies while its keyed Box is in this. */
  readonly hoverKeys: readonly string[]
  readonly tree: Node
}

// What the engine keeps for a press, a hover group and the plugin that drew a part is accepted and not drawn.
const NODE_FIELDS = new Set(['type', 'props', 'children', 'hover', 'press', 'group', 'part'])
const SCENE_FIELDS = new Set(['name', 'title', 'hover', 'hoverKeys', 'tree'])

const strings = (value: unknown, what: string): string[] => {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value) || !value.every((each): each is string => typeof each === 'string')) {
    throw new ScreensError(`${what} is not a list of strings`)
  }
  return value
}

function decodeNode(value: unknown): Node {
  if (!isRecord(value)) {
    throw new ScreensError('an element of the tree is not an object')
  }
  const extra = Object.keys(value).filter(key => !NODE_FIELDS.has(key))
  if (extra.length > 0) {
    throw new ScreensError(`an element has fields this script was not taught: ${extra.join(', ')}`)
  }
  const { type, props, children, hover } = value
  if (typeof type !== 'string') {
    throw new ScreensError('an element has no type')
  }
  if ((props !== undefined && !isRecord(props)) || (hover !== undefined && hover !== null && !isRecord(hover)) || (children !== undefined && !Array.isArray(children))) {
    throw new ScreensError(`<${type}> has props, hover or children of the wrong kind`)
  }
  return {
    type,
    props: props ?? {},
    children: (children ?? []).map((child: unknown) => (typeof child === 'string' ? child : decodeNode(child))),
    hover: hover ?? null,
  }
}

function decodeScene(value: unknown): Scene {
  if (!isRecord(value)) {
    throw new ScreensError('a scene is not an object')
  }
  const extra = Object.keys(value).filter(key => !SCENE_FIELDS.has(key))
  if (extra.length > 0) {
    throw new ScreensError(`a scene has fields this script was not taught: ${extra.join(', ')}`)
  }
  const { name, title } = value
  if (typeof name !== 'string' || typeof title !== 'string') {
    throw new ScreensError('a scene has no name or title')
  }
  return { name, title, hover: strings(value['hover'], 'hover'), hoverKeys: strings(value['hoverKeys'], 'hoverKeys'), tree: decodeNode(value['tree']) }
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
const SAFE_COLOUR = /^[#\w\s(),.%/-]+$/
const SAFE_LENGTH = /^-?\d+(\.\d+)?(%|px)?$/
const SIZES = new Set(['caption', 'footnote', 'body', 'heading', 'title'])
const WEIGHTS = new Set(['regular', 'medium', 'semibold', 'bold'])
const BORDER_STYLES = new Set(['single', 'double', 'round', 'bold', 'singleDouble', 'doubleSingle', 'classic', 'arrow', 'dashed', 'quote'])
const MARKDOWN = new MarkdownIt('commonmark', { html: false, linkify: false }).enable('table')

// What each element may carry. A tree with any other prop stops the run, so a prop the pane starts to use is drawn on
// purpose or ignored on purpose, never dropped by accident. `DRAWN` is what the renderer draws; `KEPT` is accepted and not
// drawn (an address, a hotkey, a sandbox flag: nothing a photograph shows).
const DRAWN = new Map<string, ReadonlySet<string>>([
  [
    'Box',
    new Set([
      'flexDirection', 'flexWrap', 'alignItems', 'alignSelf', 'justifyContent', 'overflow', 'flexGrow', 'flexShrink', 'gap',
      'rowGap', 'columnGap', 'width', 'minWidth', 'height', 'minHeight', 'margin', 'marginX', 'marginY', 'marginTop',
      'marginBottom', 'marginLeft', 'marginRight', 'padding', 'paddingX', 'paddingY', 'paddingTop', 'paddingBottom',
      'paddingLeft', 'paddingRight', 'backgroundColor', 'borderStyle', 'borderColor', 'borderDimColor', 'position', 'top',
      'bottom', 'left', 'right', 'display',
    ]),
  ],
  [
    'Text',
    new Set(['color', 'backgroundColor', 'dimColor', 'size', 'weight', 'bold', 'mono', 'tabular', 'italic', 'underline', 'strikethrough', 'inverse', 'wrap']),
  ],
  ['Button', new Set(['label', 'variant', 'plain', 'dimColor'])],
  ['Link', new Set(['href', 'label'])],
  ['Svg', new Set(['source', 'alt', 'width', 'height'])],
  ['Image', new Set(['source', 'alt', 'columns', 'rows'])],
  ['Markdown', new Set(['text', 'dimColor'])],
])
const KEPT = new Map<string, ReadonlySet<string>>([
  ['Box', new Set(['key'])],
  ['Text', new Set(['dir'])],
  ['Button', new Set(['key', 'hotkey', 'action', 'role', 'autoFocus'])],
  ['Link', new Set()],
  ['Svg', new Set(['isInteractive'])],
  ['Image', new Set(['key'])],
  ['Markdown', new Set(['key', 'pressableLinks'])],
])
const HOVER_PROPS = new Set([
  'scope', 'color', 'backgroundColor', 'dimColor', 'bold', 'italic', 'underline', 'strikethrough', 'inverse', 'borderStyle',
  'borderColor', 'borderDimColor', 'display', 'top', 'left', 'right', 'bottom',
])

/** What the pointer is on: the hover groups it lights, and the keyed Boxes it is inside. */
type Lit = { readonly scopes: ReadonlySet<string>; readonly keys: ReadonlySet<string> }

/** Python's `html.escape`, which is what the pages were written with. */
const escape = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;')

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

const kebab = (name: string): string => name.replace(/([A-Z])/g, '-$1').toLowerCase()

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
  for (const [prop, name] of [['flexDirection', 'flex-direction'], ['flexWrap', 'flex-wrap'], ['alignItems', 'align-items'], ['alignSelf', 'align-self'], ['justifyContent', 'justify-content'], ['overflow', 'overflow']] as const) {
    const value = props[prop]
    if (isText(value) && /^[\w-]+$/.test(value)) {
      css.set(name, value)
    }
  }
  for (const [prop, name] of [['flexGrow', 'flex-grow'], ['flexShrink', 'flex-shrink']] as const) {
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
    for (const [edge, axis] of [['Top', 'y'], ['Bottom', 'y'], ['Left', 'x'], ['Right', 'x']] as const) {
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
    for (const [edge, axis] of [['top', 'y'], ['bottom', 'y'], ['left', 'x'], ['right', 'x']] as const) {
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
  const props = DRAWN.has(node.type) ? Object.keys(node.props).filter(name => !known.has(name)).map(name => `${node.type}.${name}`) : []
  return [...props, ...Object.keys(node.hover ?? {}).filter(name => !HOVER_PROPS.has(name)).map(name => `${node.type}.hover.${name}`)]
}

/** The tree as HTML; `unknown` collects what it could not draw, so the run can say so. `key` is the nearest keyed Box around. */
function draw(node: Node | string, lit: Lit, unknown: Set<string>, key: string | null = null): string {
  if (isText(node)) {
    return escape(node)
  }
  unknownProps(node).forEach(name => unknown.add(name))
  const nearest = node.type === 'Box' && isText(node.props['key']) ? node.props['key'] : key
  const props = { ...node.props, ...hovered(node, nearest, lit) }
  const inner = node.children.map(child => draw(child, lit, unknown, nearest)).join('')
  const label = escape(String(props['label'] ?? ''))
  switch (node.type) {
    case 'Box': {
      const box = boxStyle(props)
      return `<div class="${box.classes}"${box.hidden ? ' data-hidden' : ''} style="${escape(box.css)}">${inner}</div>`
    }
    case 'Text': {
      const text = textClasses(props)
      return `<span class="${text.classes}" style="${escape(text.css)}">${inner}</span>`
    }
    case 'Link': {
      const href = String(props['href'] ?? '')
      return `<a class="link" href="${escape(href)}">${inner === '' ? escape(String(props['label'] ?? props['href'] ?? '')) : inner}</a>`
    }
    case 'Button': {
      const variant = props['variant']
      const classes = ['btn', props['plain'] === true ? 'plain' : '', variant === 'primary' || variant === 'secondary' ? variant : '', props['dimColor'] === true ? 'dim' : ''].filter(each => each !== '')
      return `<button class="${classes.join(' ')}">${inner === '' ? label : inner}</button>`
    }
    case 'Svg': {
      // An Svg's size is CSS pixels, not cells.
      const [width, height] = [props['width'], props['height']]
      const size = `${typeof width === 'number' ? `width: ${Math.trunc(width)}px; ` : ''}${typeof height === 'number' ? `height: ${Math.trunc(height)}px` : ''}`
      return `<div class="svg" role="img" aria-label="${escape(String(props['alt'] ?? ''))}" style="${size}">${String(props['source'] ?? '')}</div>`
    }
    case 'Image': {
      const source = props['source']
      const png = isRecord(source) ? source['png'] : undefined
      if (isText(png) && /^[A-Za-z0-9+/=]+$/.test(png)) {
        const size = `width: ${space(props['columns'], 'x') ?? 'None'}; height: ${space(props['rows'], 'y') ?? 'None'}`
        return `<img class="svg" alt="${escape(String(props['alt'] ?? ''))}" style="${size}" src="data:image/png;base64,${png}">`
      }
      return undrawn(node, unknown)
    }
    case 'Markdown':
      return `<div class="md${props['dimColor'] === true ? ' dim' : ''}">${MARKDOWN.render(String(props['text'] ?? ''))}</div>`
    default:
      return undrawn(node, unknown)
  }
}

function undrawn(node: Node, unknown: Set<string>): string {
  unknown.add(node.type)
  return `<div class="unknown">&lt;${escape(node.type)}&gt; is not drawn by this renderer</div>`
}

/** The scene's page; `width` overrides pane.css's own only when the command line gave one. */
function pageHtml(scene: Scene, width: number | null): { readonly document: string; readonly unknown: Set<string> } {
  const unknown = new Set<string>()
  const body = draw(scene.tree, { scopes: new Set(scene.hover), keys: new Set(scene.hoverKeys) }, unknown)
  const override = width === null ? '' : `<style>:root { --pane-width: ${width}px; }</style>`
  const title = escape(scene.title)
  const document = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<link rel="stylesheet" href="pane.css">
${override}</head>
<body><div id="pane"><header><span>${title}</span><span class="close">×</span></header><main>${body}</main></div></body></html>
`
  return { document, unknown }
}

// ---- the scenes, from the engine ----------------------------------------------------------------------------------------

/** A scratch copy of the mod with the scenes as its only test, so `claude plugin test` never sees the real ones. */
function stageMod(into: string): string {
  const mod = join(into, 'mod')
  mkdirSync(join(mod, '.claude-plugin'), { recursive: true })
  copyFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), join(mod, '.claude-plugin', 'plugin.json'))
  cpSync(join(ROOT, 'hooks'), join(mod, 'hooks'), { recursive: true })
  cpSync(join(ROOT, 'types'), join(mod, 'types'), { recursive: true })
  mkdirSync(join(mod, 'tests'))
  // The helpers the scenes import (fixtures, the fake GitLab); none of the mod's own tests.
  for (const helper of readdirSync(join(ROOT, 'tests'), { withFileTypes: true }).filter(entry => entry.isFile() && !entry.name.endsWith('.test.ts')).map(entry => entry.name)) {
    copyFileSync(join(ROOT, 'tests', helper), join(mod, 'tests', helper))
  }
  mkdirSync(join(mod, 'tools', 'screens'), { recursive: true })
  copyFileSync(SCENES_FILE, join(mod, 'tools', 'screens', 'scenes.test.ts'))
  return mod
}

/** Only what `claude plugin test` needs: no token, base URL or session of the caller's reaches it. */
const cleanEnv = (home: string): Record<string, string> => ({
  PATH: process.env['PATH'] ?? '/usr/bin:/bin',
  HOME: home,
  CLAUDE_CONFIG_DIR: join(home, 'config'),
  NO_COLOR: '1',
  TZ: 'UTC',
  LANG: 'C.UTF-8',
})

/** What `claude plugin test` said, less the trees: they are nearly all of its output and never say why a test failed. */
function saidWithoutTrees(output: string): string {
  const lines = output.split('\n').filter(line => !line.startsWith(MARKER) && !line.startsWith(LISTED))
  const failed = lines.filter(line => line.startsWith('(fail)')).map(line => line.slice('(fail) '.length))
  return `${failed.length > 0 ? `failed: ${failed.join('; ')}\n` : ''}${lines.join('\n').slice(-4000)}`
}

/** Runs the scenes under the engine and reads the trees back, or says exactly which scene failed and why. */
function drawScenes(claude: string, work: string): Scene[] {
  const mod = stageMod(work)
  const home = join(work, 'home')
  mkdirSync(join(home, 'config'), { recursive: true })
  // One stream, so lines come back in the order they were written.
  const log = join(work, 'test.log')
  const fd = openSync(log, 'w')
  const ran = spawnSync(claude, ['plugin', 'test', mod], { stdio: ['ignore', fd, fd], env: cleanEnv(home) })
  closeSync(fd)
  const output = readFileSync(log, 'utf8')
  if (ran.status !== 0) {
    throw new ScreensError(`\`claude plugin test\` failed (${ran.status ?? ran.error?.message ?? 'no exit status'}):\n${saidWithoutTrees(output)}`)
  }
  const lines = output.split('\n')
  let listed: unknown[]
  let scenes: Scene[]
  try {
    listed = lines.filter(line => line.startsWith(LISTED)).map(line => parseJson(line.slice(LISTED.length)))
    scenes = lines.filter(line => line.startsWith(MARKER)).map(line => decodeScene(parseJson(line.slice(MARKER.length))))
  } catch (error) {
    throw new ScreensError(`a scene did not read as this script expects (the engine's drawing changed?):\n${messageOf(error)}`)
  }
  const names = listed.length === 1 ? strings(listed[0], 'the list of scenes') : []
  if (listed.length !== 1) {
    throw new ScreensError(`scenes.ts did not say which scenes to expect, once:\n${saidWithoutTrees(output)}`)
  }
  const drawn = new Set(scenes.map(scene => scene.name))
  const lost = names.filter(name => !drawn.has(name))
  const stray = [...drawn].filter(name => !names.includes(name)).sort()
  if (lost.length > 0 || stray.length > 0 || drawn.size !== scenes.length) {
    throw new ScreensError(
      `the scenes drawn are not the scenes listed (listed ${JSON.stringify(names)}; lost ${lost.length > 0 ? lost.join(', ') : 'none'}; unlisted ${stray.length > 0 ? stray.join(', ') : 'none'}); the engine said:\n${saidWithoutTrees(output)}`
    )
  }
  return scenes
}

function claudeVersion(claude: string): string {
  const ran = spawnSync(claude, ['--version'], { encoding: 'utf8' })
  const version = ran.stdout.split(/\s+/)[0]
  if (ran.status !== 0 || version === undefined || version === '') {
    throw new ScreensError(`cannot run \`${claude} --version\`: ${ran.error?.message ?? ran.stderr}`)
  }
  return version
}

// ---- the photograph -----------------------------------------------------------------------------------------------------

/** Fonts Chromium took from the machine for any text on the page: every glyph should come from tools/screens/fonts. */
async function fontsBorrowed(context: BrowserContext, page: Page): Promise<Set<string>> {
  const session = await context.newCDPSession(page)
  await session.send('DOM.enable')
  await session.send('CSS.enable')
  const document = await session.send('DOM.getDocument', { depth: 0 })
  const found = await session.send('DOM.querySelectorAll', { nodeId: document.root.nodeId, selector: '#pane *' })
  const borrowed = new Set<string>()
  for (const nodeId of found.nodeIds) {
    const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId })
    fonts.filter(font => font.isCustomFont !== true && font.glyphCount > 0).forEach(font => borrowed.add(font.familyName))
  }
  await session.detach()
  return borrowed
}

async function photograph(pages: ReadonlyMap<string, string>, out: string, scale: number): Promise<void> {
  mkdirSync(out, { recursive: true })
  const browser = await chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb'] }).catch((error: unknown) => {
    throw new ScreensError(`Chromium would not start (${messageOf(error)}); install it with: npm run screens -- setup`)
  })
  try {
    const context = await browser.newContext({ viewport: { width: 700, height: 900 }, deviceScaleFactor: scale, colorScheme: 'light', locale: 'en-GB', timezoneId: 'UTC', reducedMotion: 'reduce' })
    for (const [name, path] of pages) {
      const page = await context.newPage()
      await page.goto(pathToFileURL(path).href)
      await page.evaluate('document.fonts.ready.then(() => true)')
      const borrowed = await fontsBorrowed(context, page)
      if (borrowed.size > 0) {
        throw new ScreensError(
          `scene ${name} drew with fonts of this machine, not the bundled ones: ${[...borrowed].sort().join(', ')}. Add the missing glyph to tools/screens/fonts (see SOURCES.md), or the shot changes from machine to machine.`
        )
      }
      await page.locator('#pane').screenshot({ path: join(out, `${name}.png`), animations: 'disabled', omitBackground: false })
      await page.close()
    }
  } finally {
    await browser.close()
  }
}

// ---- render -------------------------------------------------------------------------------------------------------------

type Options = {
  readonly scenes: readonly string[]
  readonly width: number | null
  readonly scale: number
  readonly claude: string
  readonly keep: string | null
  readonly allowUnknown: boolean
}

/** Draws the scenes with the engine and photographs each; only when every check has passed do the PNGs reach `out`. */
async function produce(options: Options, out: string): Promise<Scene[]> {
  const version = claudeVersion(options.claude)
  if (version !== EXPECTED_CLAUDE) {
    throw new ScreensError(
      `${options.claude} is Claude Code ${version}; the pane is drawn by ${EXPECTED_CLAUDE}, the version CI pins, and another version may draw it differently. Install it (npm install --global @anthropic-ai/claude-code@${EXPECTED_CLAUDE}) or point --claude at it.`
    )
  }
  const work = mkdtempSync(join(tmpdir(), 'pane-screens-'))
  try {
    const drawn = drawScenes(options.claude, work)
    const missing = options.scenes.filter(name => !drawn.some(scene => scene.name === name))
    if (missing.length > 0) {
      throw new ScreensError(`no such scene: ${missing.join(', ')}; there are ${drawn.map(scene => scene.name).join(', ')}`)
    }
    const scenes = options.scenes.length > 0 ? drawn.filter(scene => options.scenes.includes(scene.name)) : drawn
    const site = join(work, 'site')
    cpSync(join(SCREENS, 'fonts'), join(site, 'fonts'), { recursive: true })
    copyFileSync(join(SCREENS, 'pane.css'), join(site, 'pane.css'))
    const pages = new Map<string, string>()
    const undrawn = new Map<string, Set<string>>()
    for (const each of scenes) {
      const page = pageHtml(each, options.width)
      if (page.unknown.size > 0) {
        undrawn.set(each.name, page.unknown)
      }
      const path = join(site, `${each.name}.html`)
      writeFileSync(path, page.document, 'utf8')
      pages.set(each.name, path)
    }
    const shots = join(work, 'shots')
    await photograph(pages, shots, options.scale)
    if (options.keep !== null) {
      mkdirSync(options.keep, { recursive: true })
      for (const each of scenes) {
        writeFileSync(join(options.keep, `${each.name}.json`), JSON.stringify(each, null, 1), 'utf8')
        copyFileSync(join(site, `${each.name}.html`), join(options.keep, `${each.name}.html`))
      }
    }
    if (undrawn.size > 0 && !options.allowUnknown) {
      const said = [...undrawn].map(([name, names]) => `${name}: ${[...names].sort().join(', ')}`).join('; ')
      throw new ScreensError(
        `the pane draws what this renderer was not taught (${said}); an unknown element shows as a red dashed box and an unknown prop is dropped. Teach tools/pane_screens.ts (DRAWN and KEPT list the props), or pass --allow-unknown. Nothing was written.`
      )
    }
    mkdirSync(out, { recursive: true })
    for (const each of scenes) {
      copyFileSync(join(shots, `${each.name}.png`), join(out, `${each.name}.png`))
    }
    return scenes
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

const same = (a: string, b: string): boolean => existsSync(a) && existsSync(b) && readFileSync(a).equals(readFileSync(b))

async function render(values: { readonly out: string; readonly options: Options; readonly verify: boolean; readonly check: boolean; readonly fresh: string | null }): Promise<number> {
  const { out, options } = values
  const scratch = mkdtempSync(join(tmpdir(), 'pane-screens-out-'))
  try {
    // --check draws into a scratch folder and compares with `out`; it writes nothing there.
    const target = values.check ? join(scratch, 'now') : out
    const scenes = await produce(options, target)
    const others = existsSync(out) ? readdirSync(out).filter(name => name.endsWith('.png') && !scenes.some(scene => `${scene.name}.png` === name)) : []
    if (others.length > 0 && options.scenes.length === 0) {
      console.error(`note: ${others.join(', ')} in ${out} is no scene (any more); delete it if it is stale`)
    }
    if (values.verify) {
      const again = join(scratch, 'again')
      await produce({ ...options, keep: null }, again)
      const differing = scenes.filter(scene => !same(join(target, `${scene.name}.png`), join(again, `${scene.name}.png`)))
      if (differing.length > 0) {
        throw new ScreensError(`two draws of the same commit gave different PNGs: ${differing.map(scene => scene.name).join(', ')}`)
      }
      console.error(`verified: two draws, ${scenes.length} identical PNGs`)
    }
    if (values.check) {
      const stale = scenes.filter(scene => !same(join(target, `${scene.name}.png`), join(out, `${scene.name}.png`)))
      if (stale.length > 0) {
        // The fresh render is kept where asked, so the difference can be looked at.
        if (values.fresh !== null) {
          cpSync(target, values.fresh, { recursive: true })
        }
        throw new ScreensError(`${stale.map(scene => `${scene.name}.png`).join(', ')} is stale: run npm run screens -- render and commit docs/screens`)
      }
      console.error(`checked: ${scenes.length} PNGs in ${out} are what the pane draws`)
    }
    scenes.forEach(scene => console.log(join(out, `${scene.name}.png`)))
    return 0
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

function setup(withDeps: boolean): number {
  const cli = join(ROOT, 'node_modules', 'playwright', 'cli.js')
  return spawnSync(process.execPath, [cli, 'install', ...(withDeps ? ['--with-deps'] : []), 'chromium'], { stdio: 'inherit' }).status ?? 1
}

// ---- the command line ---------------------------------------------------------------------------------------------------

const USAGE = `usage: node tools/pane_screens.ts render [--out DIR] [--scene NAME]... [--width PX] [--scale N] [--claude BIN] [--keep DIR] [--verify] [--check [--fresh DIR]] [--allow-unknown]
       node tools/pane_screens.ts scenes [--claude BIN]
       node tools/pane_screens.ts setup [--with-deps]`

/** Every scene drawn under the engine, no browser: what \`npm test\` runs, so a change that breaks a scene fails there. */
function scenesOnly(claude: string): number {
  const work = mkdtempSync(join(tmpdir(), 'pane-scenes-'))
  try {
    const drawn = drawScenes(claude, work)
    console.log(`scenes: ${drawn.length} drawn, as listed`)
    return 0
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/** A whole number in a range, or a ScreensError naming the option. */
function integer(text: string | undefined, name: string, least: number, most: number, fallback: number | null): number | null {
  if (text === undefined) {
    return fallback
  }
  const number = Number(text)
  if (!Number.isInteger(number) || number < least || number > most) {
    throw new ScreensError(`bad option: --${name} must be a whole number from ${least} to ${most}`)
  }
  return number
}

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      scene: { type: 'string', multiple: true },
      width: { type: 'string' },
      scale: { type: 'string' },
      claude: { type: 'string' },
      keep: { type: 'string' },
      verify: { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
      'allow-unknown': { type: 'boolean', default: false },
      fresh: { type: 'string' },
      'with-deps': { type: 'boolean', default: false },
    },
  })
  const [command] = positionals
  if (command === 'render') {
    const options: Options = {
      scenes: values.scene ?? [],
      width: integer(values.width, 'width', 201, 10_000, null),
      scale: integer(values.scale, 'scale', 1, 4, 2) ?? 2,
      claude: values.claude ?? 'claude',
      keep: values.keep === undefined ? null : resolve(values.keep),
      allowUnknown: values['allow-unknown'],
    }
    return render({ out: resolve(values.out ?? SHOTS), options, verify: values.verify, check: values.check, fresh: values.fresh === undefined ? null : resolve(values.fresh) })
  }
  if (command === 'scenes') {
    return scenesOnly(values.claude ?? 'claude')
  }
  if (command === 'setup') {
    return setup(values['with-deps'])
  }
  console.error(`${USAGE}\n(${basename(import.meta.filename)})`)
  return 2
}

try {
  process.exitCode = await main()
} catch (error) {
  console.error(`pane-screens: ${messageOf(error)}`)
  process.exitCode = 1
}
