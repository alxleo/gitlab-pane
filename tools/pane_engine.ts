// pane-engine: a real, headless Claude Code engine running this checkout's mod, and the desktop app's half of the protocol
// that asks it for drawings and hands it presses, picks, typing and scrolls.
//
// `npm run rig` prints what comes back; `npm run preview` draws it in a browser. Each starts a fresh `claude -p` process
// on this checkout's mod as it is on disk, over any installed copy: no /reload-plugins. The desktop half answers the engine
// as the app does: it asks for a drawing when told to redraw or after a press, and reports where pressable elements sit
// after each drawing and scroll. Like the app, it hands the engine a new measurement only when the window's offset changes,
// with a person's scroll or with its own ask after one; every other ask repeats the measurement it last handed over.
//
// It speaks the engine's internal control protocol of the build it runs against, and stops with the engine's own error
// when a shape changes. It never sends a message to the model, and stops at once if a model turn begins.
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { createInterface } from 'node:readline'
import { setTimeout as sleep } from 'node:timers/promises'

import { isRecord, parseJson, text } from '../hooks/decode.ts'
import { pinnedClaude } from './pins.ts'

export const PANE_ID = 'gitlab-pane'
/** The plugin a measured element belongs to: the mod's id. */
export const PLUGIN = 'gitlab-pane'
/** The checkout this file is in: the mod the engine runs is this one, whichever copy is installed. */
export const ROOT = join(import.meta.dirname, '..')
/** Characters a row holds, for estimating how many rows text takes. */
const WIDTH = 90
/** The most pressable elements the desktop reports with a measurement. */
const KEYED_MOST = 512

export class RigError extends Error {}

export type Json = Record<string, unknown>

/** A pressable element, by its key, and the content rows it spans. */
export type Keyed = { readonly plugin: string; readonly key: string; readonly top: number; readonly bottom: number }

/** How tall a drawing is in rows, and where its pressable elements sit. */
export type Measured = { readonly rows: number; readonly keyed: readonly Keyed[] }

export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const num = (value: unknown): number => (typeof value === 'number' ? value : 0)
export const record = (value: unknown): Json => (isRecord(value) ? value : {})
const rowsOf = (length: number): number => Math.max(1, Math.ceil(length / WIDTH))
/** The reason an answer gives, or the whole answer when it gives none; an object is printed as JSON, not as `[object Object]`. */
export const reasonOf = (reason: unknown, answer: Json): string => (typeof reason === 'string' ? reason : JSON.stringify(reason ?? answer))
/** The key a drawn element is pressed by, or empty when it has none. */
export const keyOf = (element: Json): string => text(record(element['props'])['key'])

// ---- the engine ---------------------------------------------------------------------------------------------------------

/** The engine has gone: it exited, or never started. Nothing more can be asked of it, so whoever runs it stops. */
export class EngineGone extends RigError {}

/** The line-by-line connection to an engine. The real one is a `claude -p` process; a spec's is a stand-in. */
export type Wire = {
  /** Sends one line to the engine. */
  readonly send: (line: string) => void
  /** Hears each line the engine writes. */
  readonly onLine: (heard: (line: string) => void) => void
  /** Hears, once, how the engine went. */
  readonly onGone: (heard: (how: string) => void) => void
  readonly close: () => void
}

/** A headless `claude -p` of the pinned Claude Code in `cwd`, on this checkout's mod, writing its debug log to `debugFile`. */
export function spawnWire(cwd: string, debugFile: string): Wire {
  const proc: ChildProcessByStdio<Writable, Readable, null> = spawn(
    pinnedClaude(ROOT),
    [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--plugin-dir',
      ROOT,
      '--debug-file',
      debugFile,
    ],
    { stdio: ['pipe', 'pipe', 'ignore'], cwd }
  )
  return {
    send: line => proc.stdin.write(line),
    onLine: heard => createInterface({ input: proc.stdout }).on('line', heard),
    onGone: heard => {
      proc.on('exit', code => heard(`exited (${code ?? -1})`))
      // A `claude` that cannot be started is said so by the next ask, not thrown where nothing catches it.
      proc.on('error', error => heard(`could not start (${error.message})`))
    },
    close: () => proc.kill('SIGKILL'),
  }
}

/** A headless engine spoken to over its stream-json control protocol. */
export class Engine {
  readonly #wire: Wire
  readonly #debugFile: string | null
  readonly #events: Json[] = []
  readonly #responses = new Map<string, Json>()
  #ids = 0
  #debugSeen = 0
  #gone: string | null = null

  constructor(wire: Wire, debugFile: string | null) {
    this.#wire = wire
    this.#debugFile = debugFile
    wire.onGone(how => {
      this.#gone ??= how
    })
    wire.onLine(line => {
      let message: unknown
      try {
        message = parseJson(line)
      } catch {
        return
      }
      if (!isRecord(message)) {
        return
      }
      if (message['type'] === 'control_response') {
        const response = record(message['response'])
        this.#responses.set(text(response['request_id']), response)
      } else {
        this.#events.push(message)
      }
    })
  }

  /** Throws EngineGone once the engine has gone, naming what was going on. */
  #alive(during: string): void {
    if (this.#gone !== null) {
      throw new EngineGone(`the engine ${this.#gone} during ${during}`)
    }
  }

  async ask(request: Json, waitSeconds = 60): Promise<Json> {
    const subtype = String(request['subtype'])
    this.#alive(subtype)
    this.#ids += 1
    const id = `rig-${this.#ids}`
    this.#wire.send(`${JSON.stringify({ type: 'control_request', request_id: id, request })}\n`)
    const end = Date.now() + waitSeconds * 1000
    while (Date.now() < end) {
      const response = this.#responses.get(id)
      if (response !== undefined) {
        this.#responses.delete(id)
        if (response['subtype'] !== 'success') {
          throw new RigError(`${subtype}: ${reasonOf(response['error'], response)}`)
        }
        return record(response['response'])
      }
      this.#alive(subtype)
      await sleep(20)
    }
    throw new RigError(`${subtype}: no answer in ${waitSeconds.toFixed(0)}s`)
  }

  /** The engine's next event within `timeoutMs`, or null when it was quiet; EngineGone once it has gone and said all it wrote. */
  async nextEvent(timeoutMs: number): Promise<Json | null> {
    const end = Date.now() + timeoutMs
    while (this.#events.length === 0 && Date.now() < end) {
      await sleep(20)
    }
    const event = this.#events.shift()
    if (event === undefined) {
      this.#alive('a quiet spell')
      return null
    }
    const type = event['type']
    if (type === 'assistant' || type === 'user' || type === 'result') {
      throw new RigError(`a model turn began (${type}); the rig never asks for one`)
    }
    return event
  }

  newLogLines(): string[] {
    if (this.#debugFile === null || !existsSync(this.#debugFile)) {
      return []
    }
    const written = readFileSync(this.#debugFile, 'utf8').split('\n')
    const fresh = written.slice(this.#debugSeen)
    this.#debugSeen = written.length
    const trouble = ['refused', 'fail', 'skipped', 'denied', 'threw', 'error', 'warn']
    return fresh.filter(line => line.includes('ui.scroll ') || (line.includes('gitlab-pane') && trouble.some(word => line.toLowerCase().includes(word))))
  }

  close(): void {
    this.#wire.close()
  }
}

// ---- the drawing --------------------------------------------------------------------------------------------------------

export function textOf(node: Json): string {
  const props = record(node['props'])
  if ('label' in props) {
    return String(props['label'])
  }
  if ('text' in props) {
    return String(props['text'])
  }
  const children = node['children']
  return Array.isArray(children) ? children.filter((child): child is string => typeof child === 'string').join('') : ''
}

const childrenOf = (node: Json): unknown[] => {
  const children = node['children']
  return Array.isArray(children) ? children : []
}

export function walk(node: unknown): Json[] {
  return isRecord(node) ? [node, ...childrenOf(node).flatMap(walk)] : []
}

/** Python's `str.splitlines` for the texts of a Markdown element: no empty last line. */
function lines(words: string): string[] {
  const parts = words.split(/\r\n|\r|\n/u)
  return parts[parts.length - 1] === '' ? parts.slice(0, -1) : parts
}

/** Rows `node` takes when drawn from row `top`, noting where each keyed element sits. */
function place(node: unknown, top: number, keyed: Keyed[]): number {
  if (typeof node === 'string') {
    return rowsOf(node.length)
  }
  if (!isRecord(node)) {
    return 0
  }
  const props = record(node['props'])
  if (props['display'] === 'none' || props['position'] === 'absolute') {
    return 0
  }
  const kind = node['type']
  let rows: number
  if (kind === 'Markdown') {
    rows = lines(text(props['text'])).reduce((total, line) => total + rowsOf(line.length), 0)
    rows = rows === 0 ? 1 : rows
  } else if (kind === 'Text' || kind === 'Button' || kind === 'Link' || kind === 'Svg' || kind === 'Image') {
    rows = rowsOf(textOf(node).length)
  } else {
    const children = childrenOf(node).filter(child => child !== null && child !== false && child !== undefined)
    const border = typeof props['borderStyle'] === 'string' && props['borderStyle'] !== '' ? 2 : 0
    const pad = num(props['paddingY']) * 2 + num(props['paddingTop']) + num(props['paddingBottom'])
    const marginTop = num(props['marginTop'])
    const inner = top + Math.floor(border / 2) + (num(props['paddingY']) !== 0 ? num(props['paddingY']) : num(props['paddingTop'])) + marginTop
    let used = 0
    if (props['flexDirection'] === 'column') {
      const gap = num('rowGap' in props ? props['rowGap'] : props['gap'])
      children.forEach((child, index) => {
        used += place(child, inner + used, keyed) + (index < children.length - 1 ? gap : 0)
      })
    } else {
      used = Math.max(0, ...children.map(child => place(child, inner, keyed)))
    }
    rows = used + border + pad + marginTop
  }
  // The desktop measures only elements it can press (`[data-press-key]`), so a keyed Box is never reported.
  const key = text(props['key'])
  if (key !== '' && isRecord(node['press'])) {
    keyed.push({ plugin: PLUGIN, key, top, bottom: top + Math.max(rows, 1) - 1 })
  }
  return rows
}

/** The rows a drawing takes and where its pressable elements sit, estimated from its text: what the rig hands over. */
export function estimate(tree: Json): Measured {
  const keyed: Keyed[] = []
  const rows = place(tree, 0, keyed)
  return { rows, keyed }
}

/** Measures a fresh drawing: the rig estimates it, the preview asks the page that drew it. */
export type Measure = (tree: Json) => Promise<Measured>

type Handed = { readonly offset: number; readonly contentRows: number; readonly keyed: readonly Keyed[] }

/** What the desktop answers the engine with when the person types in an Input: each edit, or Enter. */
export type InputKind = 'change' | 'submit'

/** The desktop's half of the protocol, as the app plays it. */
export class Desktop {
  readonly #engine: Engine
  readonly #measure: Measure
  #bodyRows: number
  #offset = 0
  #tree: Json = {}
  #measured: Measured = { rows: 0, keyed: [] }
  /** What every ask carries: the window and measurement as of the window's last move. */
  #handed: Handed | null = null
  draws = 0
  readonly scrolls: { readonly offset: number; readonly landed: string }[] = []
  /** What the window showed, in order: the view and the row it started at, after each drawing and each move. */
  readonly shown: string[] = []

  constructor(engine: Engine, bodyRows: number, measure: Measure = tree => Promise.resolve(estimate(tree))) {
    this.#engine = engine
    this.#bodyRows = bodyRows
    this.#measure = measure
  }

  get offset(): number {
    return this.#offset
  }
  get rows(): number {
    return this.#measured.rows
  }
  get tree(): Json {
    return this.#tree
  }

  /** The window is now `bodyRows` tall; the next ask says so. */
  resize(bodyRows: number): void {
    this.#bodyRows = bodyRows
  }

  /**
   * The drawing on screen was measured after its drawing stopped waiting (a page that opened late): the engine is handed
   * it with a new ask, as the desktop hands over a measurement that changed.
   */
  async remeasured(measured: Measured): Promise<void> {
    this.#measured = measured
    await this.#handOver()
  }

  async draw(): Promise<void> {
    const handed = this.#handed ?? { offset: 0, contentRows: 0, keyed: [] }
    const answer = await this.#engine.ask({
      subtype: 'ui_render',
      surface: 'desktop',
      component: 'Pane',
      instance_id: PANE_ID,
      props: { scroll: { offset: handed.offset, bodyRows: this.#bodyRows } },
      content_rows: handed.contentRows,
      keyed: handed.keyed,
    })
    this.#tree = record(answer['tree'])
    this.draws += 1
    this.#measured = await this.#measure(this.#tree)
    this.#saw()
    if (this.#handed === null) {
      // The first measurement changes the window's width from its placeholder, which hands it over.
      await this.#handOver()
    } else if (this.#clamped(this.#offset) !== this.#offset) {
      // A shorter tree pulls the window up, and the browser's scroll event reports it as the person's.
      await this.scrollTo(this.#offset)
    }
  }

  #clamped(row: number): number {
    return Math.max(0, Math.min(row, this.#measured.rows - this.#bodyRows))
  }

  /** Hands the latest measurement to the engine with a new ask, as the desktop does once its window moved. */
  async #handOver(): Promise<void> {
    this.#handed = { offset: this.#offset, contentRows: this.#measured.rows, keyed: this.#measured.keyed.slice(0, KEYED_MOST) }
    await this.draw()
  }

  /** Notes what the window shows now, unless it showed just that last. A shorter tree has pulled the window up before it shows. */
  #saw(): void {
    const now = `${viewOf(this.#tree)} at ${this.#clamped(this.#offset)}`
    if (this.shown.at(-1) !== now) {
      this.shown.push(now)
    }
  }

  async #moved(): Promise<void> {
    this.#offset = this.#clamped(this.#offset)
    // The window moves over the tree it holds; the drawing the move asks for comes after.
    this.#saw()
    if (this.#handed === null || this.#handed.offset !== this.#offset) {
      await this.#handOver()
    }
  }

  /**
   * Answers the engine's redraws and scrolls until it is quiet for `quietMs`. `onScroll` hears each scroll the engine
   * sent, once the window has moved there.
   */
  async settle(quietMs: number, mostSeconds = 30, onScroll: (offset: number) => void = () => undefined): Promise<void> {
    const end = Date.now() + mostSeconds * 1000
    while (Date.now() < end) {
      const event = await this.#engine.nextEvent(quietMs)
      if (event === null) {
        return
      }
      if (event['type'] !== 'system') {
        continue
      }
      if (event['subtype'] === 'ui_invalidate' && event['event'] === 'ui.render') {
        await this.draw()
      } else if (event['subtype'] === 'ui_scroll' && event['instance_id'] === PANE_ID) {
        this.#offset = Math.trunc(num(event['offset']))
        this.scrolls.push({ offset: this.#offset, landed: this.#landedOn(this.#offset) })
        await this.#moved()
        onScroll(this.#offset)
      }
    }
  }

  /** The element of type `type` whose key is `key`, in the drawing on screen. */
  #keyed(type: string, key: string): Json {
    const found = walk(this.#tree).find(element => element['type'] === type && keyOf(element) === key && isRecord(element['press']))
    if (found === undefined) {
      throw new RigError(`no ${type} '${key}' in the drawing`)
    }
    return found
  }

  #find(spec: string): Json {
    const buttons = walk(this.#tree).filter(element => isRecord(element['press']))
    const found = buttons.find(element => {
      const key = keyOf(element)
      return key === spec || key.startsWith(`${spec}-`) || textOf(element) === spec
    })
    if (found === undefined) {
      throw new RigError(`no button '${spec}' in the drawing; there are: ${buttons.slice(0, 30).map(textOf).join(', ')}`)
    }
    return found
  }

  /** Scrolls the window as the person's wheel does, which hands the engine a fresh measurement. */
  async scrollTo(row: number): Promise<string> {
    const before = this.#offset
    this.#offset = this.#clamped(row)
    const answer = await this.#engine.ask({
      subtype: 'ui_scroll',
      component: 'Pane',
      instance_id: PANE_ID,
      offset: this.#offset,
      by: this.#offset - before,
      body_rows: this.#bodyRows,
      content_rows: this.#measured.rows,
      keyed: this.#measured.keyed.slice(0, KEYED_MOST),
      surface: 'desktop',
    })
    this.#offset = typeof answer['offset'] === 'number' ? Math.trunc(answer['offset']) : this.#offset
    await this.#moved()
    const moved = answer['moved'] === true ? 'moved' : reasonOf(answer['deny'], answer)
    return `scrolled to row ${row}: ${moved}, at ${this.#offset}, on ${this.#landedOn(this.#offset)}`
  }

  /** Presses the button `spec` names (its key, the start of its key, or its words), or scrolls to `scroll:ROW`. */
  async press(spec: string): Promise<string> {
    if (spec.startsWith('scroll:')) {
      return this.scrollTo(Number(spec.slice('scroll:'.length)))
    }
    return this.#pressed(this.#find(spec))
  }

  /** Presses the Button whose key is exactly `key`, as a click on it does. */
  async pressKey(key: string): Promise<string> {
    return this.#pressed(this.#keyed('Button', key))
  }

  async #pressed(element: Json): Promise<string> {
    const key = keyOf(element)
    const press = record(element['press'])
    await this.#engine.ask({ subtype: 'ui_press', plugin: press['plugin'], handle: press['handle'], key, surface: 'desktop' })
    return `pressed ${key}`
  }

  /** Picks `value` in the Select whose key is `key`: one of its options as last drawn, or nothing is sent. */
  async select(key: string, value: string): Promise<string> {
    const element = this.#keyed('Select', key)
    const options = record(element['props'])['options']
    const values = Array.isArray(options) ? options.map(option => record(option)['value']) : []
    if (!values.includes(value)) {
      throw new RigError(`'${value}' is none of the options of Select '${key}'`)
    }
    const press = record(element['press'])
    await this.#engine.ask({ subtype: 'ui_select', plugin: press['plugin'], handle: press['handle'], value, ...this.#site(key) })
    return `picked ${value} in ${key}`
  }

  /** Hands the Input whose key is `key` the text it holds now: after an edit (`change`), or on Enter (`submit`). */
  async input(key: string, kind: InputKind, value: string): Promise<string> {
    const press = record(this.#keyed('Input', key)['press'])
    await this.#engine.ask({ subtype: 'ui_input', plugin: press['plugin'], handle: press['handle'], kind, value, ...this.#site(key) })
    return `${kind === 'submit' ? 'submitted' : 'typed'} ${JSON.stringify(value)} in ${key}`
  }

  /** Where an element sits, so a handle a redraw retired is found again by its key. */
  #site(key: string): Json {
    return { key, component: 'Pane', instance_id: PANE_ID, surface: 'desktop' }
  }

  /** The first pressable element the window shows, in the drawing on screen. */
  #landedOn(offset: number): string {
    const shown = this.#measured.keyed.filter(item => item.bottom >= offset)
    const first = shown.reduce<Keyed | null>((best, item) => (best === null || item.top < best.top || (item.top === best.top && item.bottom < best.bottom) ? item : best), null)
    return first === null ? 'nothing pressable' : first.key
  }

  texts(): string[] {
    return walk(this.#tree)
      .map(textOf)
      .filter(each => each.trim() !== '')
  }
}

/** The pane's title as the engine names it, or why it has none. */
export async function title(engine: Engine): Promise<string> {
  try {
    const panes = (await engine.ask({ subtype: 'ui_panes' }, 10))['panes']
    const found = Array.isArray(panes) ? panes.map(record).find(pane => pane['id'] === PANE_ID) : undefined
    return found === undefined ? '(not open)' : String(found['title'])
  } catch (error) {
    return `(unread: ${messageOf(error)})`
  }
}

/** Which view a drawing is: an MR's page, the inbox, the list, or something else, such as the pane's failure to draw. */
export function viewOf(tree: Json): string {
  const keys = new Set(walk(tree).map(keyOf))
  if (keys.has('back-top')) {
    return 'page'
  }
  if ([...keys].some(key => key.startsWith('inbox'))) {
    return 'inbox'
  }
  return keys.has('tab-mine') ? 'list' : 'other'
}

/**
 * Opens the pane as a person does, with its tab, unless it is open: only a session whose pane is open reads GitLab, and
 * nothing is attached when the session starts.
 */
export async function openPane(engine: Engine, desktop: Desktop): Promise<void> {
  if ((await title(engine)) === '(not open)') {
    await desktop.press('tab-mine')
  }
}
