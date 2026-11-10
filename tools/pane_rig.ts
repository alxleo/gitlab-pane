// pane-rig: drive the GitLab pane through a real, headless Claude Code engine, standing in for the desktop app.
//
//   node tools/pane_rig.ts flow                                       draw the pane once GitLab has answered
//   node tools/pane_rig.ts flow --press tab-mine --press scroll:25 --press open-42 --press back-top
//
// (`npm run rig -- flow …` is the same.) Each run starts a fresh `claude -p` process on this checkout's mod as it is on disk,
// over any installed copy: no /reload-plugins. The rig answers the engine as the desktop does: it asks for a drawing when told to redraw or after a
// press, and measures where pressable elements sit after each drawing and scroll. Like the desktop, it hands the engine a
// new measurement only when the window's offset changes, with a person's scroll or with its own ask after one; every other
// ask repeats the measurement it last handed over. Row numbers are its own estimate; which keys are present, and the order
// of the asks, are what it gets right. A step prints what was drawn, the scrolls the engine sent and which element each
// landed on, the pane's title, and the engine's own log lines about the mod.
//
// It checks behaviour, not looks: the README's screenshots show how the terminal draws it. It speaks the engine's internal
// control protocol of the build it runs against, and stops with the engine's own error when a shape changes. It never sends a
// message to the model, and stops at once if a model turn begins.
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { createInterface } from 'node:readline'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'

import { isRecord, parseJson, text } from '../hooks/decode.ts'

const PANE_ID = 'gitlab-pane'
const PLUGIN = 'gitlab-pane'
/** The checkout this file is in: the mod the rig drives is this one, whichever copy is installed. */
const ROOT = join(import.meta.dirname, '..')
/** Characters a row holds, for estimating how many rows text takes. */
const WIDTH = 90

class RigError extends Error {}

type Json = Record<string, unknown>

type Keyed = { readonly plugin: string; readonly key: string; readonly top: number; readonly bottom: number }

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const num = (value: unknown): number => (typeof value === 'number' ? value : 0)
const record = (value: unknown): Json => (isRecord(value) ? value : {})
const rowsOf = (length: number): number => Math.max(1, Math.ceil(length / WIDTH))
/** The reason an answer gives, or the whole answer when it gives none; an object is printed as JSON, not as `[object Object]`. */
const reasonOf = (reason: unknown, answer: Json): string => (typeof reason === 'string' ? reason : JSON.stringify(reason ?? answer))
/** The key a drawn element is pressed by, or empty when it has none. */
const keyOf = (element: Json): string => text(record(element['props'])['key'])

// ---- the engine ---------------------------------------------------------------------------------------------------------

/** A headless claude process spoken to over its stream-json control protocol. */
class Engine {
  readonly #proc: ChildProcessByStdio<Writable, Readable, null>
  readonly #debugFile: string
  readonly #events: Json[] = []
  readonly #responses = new Map<string, Json>()
  #ids = 0
  #debugSeen = 0
  #exited: number | null = null

  constructor(cwd: string, debugFile: string) {
    this.#debugFile = debugFile
    this.#proc = spawn(
      'claude',
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
    this.#proc.on('exit', code => {
      this.#exited = code ?? -1
    })
    createInterface({ input: this.#proc.stdout }).on('line', line => {
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

  async ask(request: Json, waitSeconds = 60): Promise<Json> {
    this.#ids += 1
    const id = `rig-${this.#ids}`
    const subtype = String(request['subtype'])
    this.#proc.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: id, request })}\n`)
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
      if (this.#exited !== null) {
        throw new RigError(`the engine exited (${this.#exited}) during ${subtype}`)
      }
      await sleep(20)
    }
    throw new RigError(`${subtype}: no answer in ${waitSeconds.toFixed(0)}s`)
  }

  async nextEvent(timeoutMs: number): Promise<Json | null> {
    const end = Date.now() + timeoutMs
    while (this.#events.length === 0 && Date.now() < end) {
      await sleep(20)
    }
    const event = this.#events.shift()
    if (event === undefined) {
      return null
    }
    const type = event['type']
    if (type === 'assistant' || type === 'user' || type === 'result') {
      throw new RigError(`a model turn began (${type}); the rig never asks for one`)
    }
    return event
  }

  newLogLines(): string[] {
    if (!existsSync(this.#debugFile)) {
      return []
    }
    const written = readFileSync(this.#debugFile, 'utf8').split('\n')
    const fresh = written.slice(this.#debugSeen)
    this.#debugSeen = written.length
    const trouble = ['refused', 'fail', 'skipped', 'denied', 'threw', 'error', 'warn']
    return fresh.filter(line => line.includes('ui.scroll ') || (line.includes('gitlab-pane') && trouble.some(word => line.toLowerCase().includes(word))))
  }

  close(): void {
    this.#proc.kill('SIGKILL')
  }
}

// ---- the drawing --------------------------------------------------------------------------------------------------------

function textOf(node: Json): string {
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

function walk(node: unknown): Json[] {
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

type Handed = { readonly offset: number; readonly contentRows: number; readonly keyed: readonly Keyed[] }

/** The desktop's half of the protocol, as the app plays it. */
class Desktop {
  readonly #engine: Engine
  readonly #bodyRows: number
  #offset = 0
  #tree: Json = {}
  #rows = 0
  #keyed: Keyed[] = []
  /** What every ask carries: the window and measurement as of the window's last move. */
  #handed: Handed | null = null
  draws = 0
  readonly scrolls: { readonly offset: number; readonly landed: string }[] = []

  constructor(engine: Engine, bodyRows: number) {
    this.#engine = engine
    this.#bodyRows = bodyRows
  }

  get offset(): number {
    return this.#offset
  }
  get rows(): number {
    return this.#rows
  }
  get tree(): Json {
    return this.#tree
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
    this.#measure()
    if (this.#handed === null) {
      // The first measurement changes the window's width from its placeholder, which hands it over.
      await this.#handOver()
    } else if (this.#clamped(this.#offset) !== this.#offset) {
      // A shorter tree pulls the window up, and the browser's scroll event reports it as the person's.
      await this.scrollTo(this.#offset)
    }
  }

  #measure(): void {
    this.#keyed = []
    this.#rows = place(this.#tree, 0, this.#keyed)
  }

  #clamped(row: number): number {
    return Math.max(0, Math.min(row, this.#rows - this.#bodyRows))
  }

  /** Hands the latest measurement to the engine with a new ask, as the desktop does once its window moved. */
  async #handOver(): Promise<void> {
    this.#handed = { offset: this.#offset, contentRows: this.#rows, keyed: this.#keyed.slice(0, 512) }
    await this.draw()
  }

  async #moved(): Promise<void> {
    this.#measure()
    this.#offset = this.#clamped(this.#offset)
    if (this.#handed === null || this.#handed.offset !== this.#offset) {
      await this.#handOver()
    }
  }

  /** Answers the engine's redraws and scrolls until it is quiet for `quietMs`. */
  async settle(quietMs: number, mostSeconds = 30): Promise<void> {
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
      }
    }
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
    this.#measure()
    this.#offset = this.#clamped(row)
    const answer = await this.#engine.ask({
      subtype: 'ui_scroll',
      component: 'Pane',
      instance_id: PANE_ID,
      offset: this.#offset,
      by: this.#offset - before,
      body_rows: this.#bodyRows,
      content_rows: this.#rows,
      keyed: this.#keyed.slice(0, 512),
      surface: 'desktop',
    })
    this.#offset = typeof answer['offset'] === 'number' ? Math.trunc(answer['offset']) : this.#offset
    await this.#moved()
    const moved = answer['moved'] === true ? 'moved' : reasonOf(answer['deny'], answer)
    return `scrolled to row ${row}: ${moved}, at ${this.#offset}, on ${this.#landedOn(this.#offset)}`
  }

  async press(spec: string): Promise<string> {
    if (spec.startsWith('scroll:')) {
      return this.scrollTo(Number(spec.slice('scroll:'.length)))
    }
    const element = this.#find(spec)
    const key = keyOf(element)
    const press = record(element['press'])
    await this.#engine.ask({ subtype: 'ui_press', plugin: press['plugin'], handle: press['handle'], key, surface: 'desktop' })
    return `pressed ${key}`
  }

  /** The first pressable element the window shows, in the drawing on screen. */
  #landedOn(offset: number): string {
    const shown = this.#keyed.filter(item => item.bottom >= offset)
    const first = shown.reduce<Keyed | null>((best, item) => (best === null || item.top < best.top || (item.top === best.top && item.bottom < best.bottom) ? item : best), null)
    return first === null ? 'nothing pressable' : first.key
  }

  texts(): string[] {
    return walk(this.#tree)
      .map(textOf)
      .filter(each => each.trim() !== '')
  }
}

async function title(engine: Engine): Promise<string> {
  try {
    const panes = (await engine.ask({ subtype: 'ui_panes' }, 10))['panes']
    const found = Array.isArray(panes) ? panes.map(record).find(pane => pane['id'] === PANE_ID) : undefined
    return found === undefined ? '(not open)' : String(found['title'])
  } catch (error) {
    return `(unread: ${messageOf(error)})`
  }
}

async function describe(desktop: Desktop, engine: Engine, show: number, scrollsBefore: number): Promise<string[]> {
  const keys = new Set(walk(desktop.tree).map(keyOf))
  const view = keys.has('back-top') ? 'page' : [...keys].some(key => key.startsWith('inbox')) ? 'inbox' : 'list'
  return [
    `  view ${view} · title ${await title(engine)} · ${desktop.draws} drawings · offset ${desktop.offset} of ${desktop.rows} rows`,
    ...desktop.scrolls.slice(scrollsBefore).map(scroll => `  scrolled to row ${scroll.offset}: lands on ${scroll.landed}`),
    ...desktop
      .texts()
      .slice(0, show)
      .map(each => `  · ${each.slice(0, 110)}`),
    ...engine.newLogLines().map(line => `  log ${line.slice(0, 220)}`),
  ]
}

// ---- the command --------------------------------------------------------------------------------------------------------

type Options = {
  readonly presses: readonly string[]
  readonly waitSeconds: number
  readonly settleMs: number
  readonly bodyRows: number
  readonly show: number
  readonly log: string | null
}

async function flow(options: Options): Promise<number> {
  const folder = mkdtempSync(join(tmpdir(), 'pane-rig-'))
  const engine = new Engine(folder, options.log ?? join(folder, 'debug.log'))
  try {
    await engine.ask({ subtype: 'initialize' })
    const desktop = new Desktop(engine, options.bodyRows)
    await desktop.draw()
    const startedAt = Date.now()
    // Only a session whose pane is open reads GitLab, and nothing is attached when the session starts, so the pane stays shut
    // until a person opens it: the rig opens it as they would, with its tab.
    if ((await title(engine)) === '(not open)') {
      await desktop.press('tab-mine')
    }
    const seconds = () => ((Date.now() - startedAt) / 1000).toFixed(1)
    const hasCards = () => desktop.texts().some(each => /^Mine · [1-9]/u.test(each.trim()))
    let cardsAt = hasCards() ? seconds() : null
    const end = startedAt + options.waitSeconds * 1000
    // Read once the pane says how old its cards are, with no ↻ beside the age, or says the read failed.
    const isRead = () => desktop.texts().some(each => /^updated |^GitLab read failed/u.test(each.trim()))
    while (!isRead()) {
      if (Date.now() > end) {
        throw new RigError('GitLab never answered')
      }
      await desktop.settle(options.settleMs, 1)
      cardsAt ??= hasCards() ? seconds() : null
    }
    const readAt = seconds()
    await desktop.settle(options.settleMs)
    console.log(`ready: first cards at ${cardsAt ?? readAt}s, the read done at ${readAt}s`)
    console.log((await describe(desktop, engine, options.show, 0)).join('\n'))
    for (const spec of options.presses) {
      const before = desktop.scrolls.length
      const step = await desktop.press(spec)
      await desktop.settle(options.settleMs)
      console.log(step)
      console.log((await describe(desktop, engine, options.show, before)).join('\n'))
    }
    return 0
  } catch (error) {
    console.error(`stopped: ${messageOf(error)}`)
    engine
      .newLogLines()
      .slice(-15)
      .forEach(line => console.error(`  log ${line.slice(0, 220)}`))
    return 1
  } finally {
    engine.close()
    rmSync(folder, { recursive: true, force: true })
  }
}

/** A positive whole number option, or the way it should have been written. */
function count(given: string | undefined, name: string, fallback: number, least: number): number {
  const value = given === undefined ? fallback : Number(given)
  if (!Number.isFinite(value) || value < least) {
    throw new RigError(`bad option: --${name} must be a number of at least ${least}`)
  }
  return value
}

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      press: { type: 'string', short: 'p', multiple: true },
      'wait-rows': { type: 'string' },
      'settle-ms': { type: 'string' },
      'body-rows': { type: 'string' },
      show: { type: 'string' },
      log: { type: 'string' },
    },
  })
  if (positionals[0] !== 'flow') {
    console.error('usage: node tools/pane_rig.ts flow [--press KEY|scroll:ROW]... [--wait-rows S] [--settle-ms MS] [--body-rows N] [--show N] [--log FILE]')
    return 2
  }
  return flow({
    presses: values.press ?? [],
    waitSeconds: count(values['wait-rows'], 'wait-rows', 120, Number.MIN_VALUE),
    settleMs: count(values['settle-ms'], 'settle-ms', 1500, 1),
    bodyRows: count(values['body-rows'], 'body-rows', 40, 1),
    show: count(values.show, 'show', 6, 0),
    log: values.log === undefined ? null : resolve(values.log),
  })
}

try {
  process.exitCode = await main()
} catch (error) {
  console.error(`pane-rig: ${messageOf(error)}`)
  process.exitCode = 2
}
