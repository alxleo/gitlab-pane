// pane-preview: the GitLab pane as this checkout draws it, live in a browser, with your real GitLab data.
//
//   node --import ./tools/resolve_ts.ts tools/pane_preview.ts                       serve http://127.0.0.1:4780 until stopped
//   node --import ./tools/resolve_ts.ts tools/pane_preview.ts --port 4781           another port, for a second checkout
//
// (`npm run preview -- …` is the same; `--help` says more. `.claude/launch.json` starts it for the Claude app's browser
// pane.) It joins the two tools that already stand in for the desktop app: tools/pane_engine.ts runs a headless engine
// on this checkout's mod and plays the desktop's half of the protocol, and tools/pane_html.ts draws each tree the engine
// hands over with tools/screens/pane.css. The page redraws whenever the engine redraws, measures where each pressable
// element sits as the desktop does, and sends clicks, picks, typing and scrolls back by element key.
//
// It listens on 127.0.0.1 only and answers only pages it served: a press here is a press in GitLab.
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { isRecord, parseJson, text } from '../hooks/decode.ts'
import { decodeNode, escape, liveHtml } from './pane_html.ts'
import { Desktop, Engine, EngineGone, PLUGIN, ROOT, estimate, messageOf, openPane, spawnWire, title, type Json, type Keyed, type Measured } from './pane_engine.ts'

/** The port `.claude/launch.json` names; tools/pane_preview.spec.ts keeps the two equal. */
export const DEFAULT_PORT = 4780
const SCREENS = join(import.meta.dirname, 'screens')
/** How long a drawing waits for the page to measure it before the rig's estimate stands in. */
const MEASURE_MS = 3000
/** The most a page may send in one request. */
const BODY_MOST = 256 * 1024

export const USAGE = `pane-preview: the GitLab pane as this checkout draws it, live in a browser, from your real GitLab data.

  node --import ./tools/resolve_ts.ts tools/pane_preview.ts [--port N] [--width PX] [--log FILE]

Options:
  --port N        the port on 127.0.0.1 to serve (default ${DEFAULT_PORT}); it stops if the port is taken
  --width PX      the pane's width (default pane.css's)
  --log FILE      keep the engine's debug log there (default: the port's temporary folder, cleared on exit and next start)
  -h, --help      this

A headless \`claude -p\` runs this checkout's mod over any installed copy and reads GitLab with your settings. The page
redraws whenever the engine does; a click, a pick, typing, Enter and scrolling go back to the engine by element key, and
reach GitLab as they would from the desktop app. It never asks the model for a turn, and stops if one begins.`

class UsageError extends Error {}
class ActionError extends Error {}

export type Options = { readonly port: number; readonly width: number | null; readonly log: string | null }
export type Command = { readonly kind: 'help' } | { readonly kind: 'serve'; readonly options: Options }

/** A whole number from `least` to `most`, or a UsageError naming the option. */
function whole(given: string | undefined, name: string, least: number, most: number): number | null {
  if (given === undefined) {
    return null
  }
  const value = Number(given)
  if (!Number.isInteger(value) || value < least || value > most) {
    throw new UsageError(`--${name} is a whole number from ${least} to ${most}, not ${given}`)
  }
  return value
}

/** The command the arguments ask for, with a relative --log taken from `base`; throws saying what is wrong. */
export function parseCommand(argv: readonly string[], base: string): Command {
  const { positionals, values } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      port: { type: 'string' },
      width: { type: 'string' },
      log: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  if (values.help) {
    return { kind: 'help' }
  }
  if (positionals.length > 0) {
    throw new UsageError(`it takes no ${positionals.join(' ')}`)
  }
  return {
    kind: 'serve',
    options: {
      port: whole(values.port, 'port', 1024, 65_535) ?? DEFAULT_PORT,
      width: whole(values.width, 'width', 201, 10_000),
      log: values.log === undefined ? null : resolve(base, values.log),
    },
  }
}

// ---- what the page sends ------------------------------------------------------------------------------------------------

/** What the page asks of the engine, or tells it: everything names its element by key, as the tree carried it. */
export type Action =
  | { readonly kind: 'press'; readonly key: string }
  | { readonly kind: 'select'; readonly key: string; readonly value: string }
  | { readonly kind: 'input'; readonly key: string; readonly value: string; readonly submit: boolean }
  | { readonly kind: 'scroll'; readonly offset: number }
  /**
   * Where the page drew drawing `draw`'s pressable elements, in rows, and how many rows its window shows; `resized` when
   * it measured again because its window changed size.
   */
  | { readonly kind: 'measured'; readonly draw: number; readonly measured: Measured; readonly bodyRows: number; readonly resized: boolean }

/** What a page asks of the engine, which waits its turn; a measurement does not. */
type Asked = Exclude<Action, { readonly kind: 'measured' }>

/** What waits its turn with the engine: a page's ask, or a measurement of the drawing on screen that nothing waited for. */
type Queued = Asked | { readonly kind: 'remeasured'; readonly draw: number; readonly measured: Measured }

/**
 * How a measurement was taken: `waited`, by the drawing waiting for it; `unasked`, the first for the latest drawing when
 * none waited (a page that opened late, or answered after the wait), to be handed over; `stale`, for an older drawing or
 * one already measured, which changes nothing.
 */
export type Taken = 'waited' | 'unasked' | 'stale'

/**
 * The drawings sent to pages and their measurements: each drawing is numbered, may wait for its first measurement, and
 * takes only that one, so two pages of different sizes cannot set each other off.
 */
export class Measurements {
  readonly #waiting = new Map<number, (measured: Measured | null) => void>()
  #latest = 0
  #answered = 0

  /** Numbers a new drawing. */
  drawn(): number {
    this.#latest += 1
    return this.#latest
  }

  /** Whether drawing `draw` is still the one on screen. */
  isLatest(draw: number): boolean {
    return draw === this.#latest
  }

  /** The first measurement of drawing `draw`, or null if none comes within `ms`. */
  wait(draw: number, ms: number): Promise<Measured | null> {
    return new Promise(done => {
      this.#waiting.set(draw, done)
      setTimeout(() => {
        this.#waiting.delete(draw)
        done(null)
      }, ms)
    })
  }

  /**
   * Takes a page's measurement of drawing `draw`. One `resized` (the page's window changed size) counts even when the
   * drawing was measured already; the drawing it then asks for takes only its first measurement, so another tab's cannot
   * answer back.
   */
  take(draw: number, measured: Measured, resized: boolean): Taken {
    if (draw !== this.#latest || (draw === this.#answered && !resized)) {
      return 'stale'
    }
    this.#answered = draw
    const waiting = this.#waiting.get(draw)
    if (waiting === undefined) {
      return 'unasked'
    }
    this.#waiting.delete(draw)
    waiting(measured)
    return 'waited'
  }
}

/**
 * Whether a redraw keeps what the person has typed in a field rather than the text it draws: when it draws what it drew
 * before, or text this page sent it since (the mod's echo of typing, which arrives while more is typed). Any other text is
 * the mod's own, which replaces the typing, as the desktop's field does. The page runs this very function.
 */
export function keepsTyping(was: string, now: string, sent: readonly string[]): boolean {
  return now === was || sent.includes(now)
}

/**
 * The page's content security policy: only its own script runs (it draws other people's words), it talks only to this
 * server, and no other page may frame it, since a click in a frame would be a press in GitLab.
 */
export function policyFor(nonce: string): string {
  return `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'`
}

const keyIn = (value: Json): string => {
  const key = value['key']
  if (typeof key !== 'string' || key === '') {
    throw new ActionError('an action names no element key')
  }
  return key
}

const rowIn = (value: Json, name: string): number => {
  const row = value[name]
  if (typeof row !== 'number' || !Number.isInteger(row) || row < 0) {
    throw new ActionError(`${name} is not a row`)
  }
  return row
}

function keyedIn(value: unknown): Keyed {
  if (!isRecord(value)) {
    throw new ActionError('a measured element is not an object')
  }
  const top = rowIn(value, 'top')
  const bottom = rowIn(value, 'bottom')
  if (bottom < top) {
    throw new ActionError('a measured element ends above where it starts')
  }
  return { plugin: PLUGIN, key: keyIn(value), top, bottom }
}

/** The action a page sent, or an ActionError saying what is wrong with it. */
export function decodeAction(value: unknown, run: string): Action {
  if (!isRecord(value)) {
    throw new ActionError('an action is not an object')
  }
  // A page left open across a restart, perhaps of another checkout on the same port, must not press in this one's engine.
  if (value['run'] !== run) {
    throw new ActionError('this page was served by another run of the preview: reload it')
  }
  switch (value['kind']) {
    case 'press':
      return { kind: 'press', key: keyIn(value) }
    case 'select':
      if (typeof value['value'] !== 'string') {
        throw new ActionError('a pick has no value')
      }
      return { kind: 'select', key: keyIn(value), value: value['value'] }
    case 'input':
      if (typeof value['value'] !== 'string' || typeof value['submit'] !== 'boolean') {
        throw new ActionError('typing has no text, or does not say whether it is Enter')
      }
      return { kind: 'input', key: keyIn(value), value: value['value'], submit: value['submit'] }
    case 'scroll':
      return { kind: 'scroll', offset: rowIn(value, 'offset') }
    case 'measured': {
      const keyed = value['keyed']
      if (!Array.isArray(keyed)) {
        throw new ActionError('a measurement lists no elements')
      }
      return {
        kind: 'measured',
        draw: rowIn(value, 'draw'),
        measured: { rows: rowIn(value, 'rows'), keyed: keyed.map(keyedIn) },
        bodyRows: Math.max(1, rowIn(value, 'bodyRows')),
        resized: value['resized'] === true,
      }
    }
    default:
      throw new ActionError(`no action is called ${JSON.stringify(value['kind'])}`)
  }
}

/**
 * Whether a request comes from a page this server served: its Host is this server by name (not a name another site
 * rebound to 127.0.0.1), no other site's page sent it, and a POST is sent as JSON by a page of this origin. A press here
 * is a press in GitLab, so a page of any other site may not make one, nor hold the events open (each drawing would wait
 * for its measurement).
 */
export function isOwnRequest(method: string, headers: IncomingHttpHeaders, port: number): boolean {
  const host = headers.host ?? ''
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
    return false
  }
  // A browser names the page's origin on a request from another site's page, the event stream's included.
  if (headers.origin !== undefined && headers.origin !== `http://${host}`) {
    return false
  }
  if (method === 'GET') {
    return true
  }
  return method === 'POST' && headers.origin === `http://${host}` && (headers['content-type'] ?? '').startsWith('application/json')
}

// ---- the page -----------------------------------------------------------------------------------------------------------

/**
 * Runs in the page. It draws each frame into the pane's body, keeping the focused Input's typing until the mod draws other
 * text in it, and posts where each pressable element sits in rows (one line of the body's text) back with the frame's
 * number. A click on a keyed Button, a pick in a Select, an edit or Enter in an Input, and a scroll the person made are
 * posted by key; a scroll the engine sent moves the body without being posted back.
 */
const pageScript = (run: string): string => `(() => {
  // The run of the preview that served this page: every action names it, and a server of another run is not answered.
  const run = ${JSON.stringify(run)}
  const body = document.getElementById('body')
  const note = document.getElementById('note')
  const heading = document.getElementById('title')
  const row = () => parseFloat(getComputedStyle(body).lineHeight) || 18
  let drawn = 0
  let html = ''
  // Until then, a scroll is one this page made (a redraw that shortened the body, or the engine's own scroll), which the
  // engine already knows of: the desktop's half answers both itself.
  let quietUntil = 0
  const hush = () => { quietUntil = performance.now() + 150 }
  let scrollTimer = 0
  let resizeTimer = 0
  // Typing not yet sent, by field: each field waits on its own, and a press or pick sends it first, as the desktop's
  // field has told the mod its text by then.
  const typing = new Map()
  let stopped = false
  const keepsTyping = ${keepsTyping.toString()}
  // What this page has sent each field since its last Enter, so the mod's echo of it does not take back newer typing.
  const sent = new Map()
  const send = (key, value, submit) => {
    sent.set(key, submit ? [] : [...(sent.get(key) || []), value].slice(-50))
    act({ kind: 'input', key, value, submit })
  }
  const unsent = key => {
    const waiting = typing.get(key)
    if (waiting !== undefined) clearTimeout(waiting.timer)
    typing.delete(key)
  }
  const flush = () => {
    const waiting = [...typing]
    typing.clear()
    waiting.forEach(([key, { timer, value }]) => { clearTimeout(timer); send(key, value, false) })
  }
  const act = action => fetch('/act', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...action, run }) })
    .then(answer => answer.ok ? null : answer.text().then(said => { note.textContent = said }))
    .catch(() => undefined)
  const holderOf = (target, kind) => {
    const holder = target instanceof Element ? target.closest('[data-kind="' + kind + '"]') : null
    return holder !== null && body.contains(holder) ? holder : null
  }
  const measure = (resized = false) => {
    const unit = row()
    const origin = body.getBoundingClientRect().top - body.scrollTop
    const keyed = [...body.querySelectorAll('[data-press-key]')].flatMap(element => {
      const box = element.getBoundingClientRect()
      if (box.width === 0 && box.height === 0) return []
      const top = Math.max(0, Math.floor((box.top - origin) / unit))
      return [{ key: element.dataset.pressKey, top, bottom: Math.max(top, Math.ceil((box.bottom - origin) / unit) - 1) }]
    })
    act({ kind: 'measured', draw: drawn, rows: Math.ceil(body.scrollHeight / unit), bodyRows: Math.max(1, Math.floor(body.clientHeight / unit)), keyed, resized })
  }
  const show = frame => {
    drawn = frame.draw
    // An unchanged drawing leaves the page alone, so an open picker stays open; it is measured all the same.
    if (frame.html === html) return measure()
    html = frame.html
    const focused = document.activeElement
    const holder = focused !== null && body.contains(focused) ? focused.closest('[data-press-key]') : null
    const kept = holder === null ? null : { key: holder.dataset.pressKey, typed: 'drawn' in focused.dataset ? focused.value : null, was: focused.dataset.drawn, start: focused.selectionStart, end: focused.selectionEnd }
    const top = body.scrollTop
    hush()
    body.innerHTML = frame.html
    body.scrollTop = top
    const again = kept === null ? undefined : [...body.querySelectorAll('[data-press-key]')].find(element => element.dataset.pressKey === kept.key)
    const field = again === undefined ? null : again.matches('button') ? again : again.querySelector('input, textarea, select')
    if (field !== null) {
      if (kept.typed !== null && keepsTyping(kept.was, field.dataset.drawn, sent.get(kept.key) || [])) field.value = kept.typed
      field.focus({ preventScroll: true })
      if (kept.typed !== null && kept.start !== null && field.setSelectionRange) field.setSelectionRange(kept.start, kept.end)
    }
    measure()
  }
  const named = text => {
    heading.textContent = text
    document.title = text + ' · preview'
  }
  const events = new EventSource('/events')
  const read = handle => event => { if (!stopped) handle(JSON.parse(event.data)) }
  const stop = reason => { stopped = true; note.textContent = reason; note.className = 'stopped'; events.close() }
  events.addEventListener('hello', read(said => { if (said.run !== run) stop('this page was served by another run of the preview, perhaps of another checkout: reload it') }))
  events.addEventListener('frame', read(frame => { show(frame); if (frame.title !== '') named(frame.title) }))
  events.addEventListener('title', read(said => named(said.title)))
  events.addEventListener('note', read(said => { note.textContent = said.text }))
  events.addEventListener('scroll', read(said => { hush(); body.scrollTop = said.offset * row() }))
  events.addEventListener('stopped', read(said => stop('stopped: ' + said.reason)))
  events.onerror = () => { if (!stopped) note.textContent = 'the preview is not answering; it may have stopped' }
  body.addEventListener('click', event => {
    const button = holderOf(event.target, 'button')
    if (button !== null) {
      event.preventDefault()
      flush()
      act({ kind: 'press', key: button.dataset.pressKey })
    }
  })
  body.addEventListener('change', event => {
    const picker = holderOf(event.target, 'select')
    if (picker === null) return
    flush()
    act({ kind: 'select', key: picker.dataset.pressKey, value: event.target.value })
  })
  body.addEventListener('input', event => {
    const field = holderOf(event.target, 'input')
    if (field === null) return
    const key = field.dataset.pressKey
    const value = event.target.value
    unsent(key)
    typing.set(key, { value, timer: setTimeout(() => { typing.delete(key); send(key, value, false) }, 150) })
  })
  body.addEventListener('keydown', event => {
    const field = holderOf(event.target, 'input')
    // Enter that confirms what an input method was composing is not the person's Enter.
    if (field === null || event.key !== 'Enter' || event.shiftKey || event.isComposing) return
    event.preventDefault()
    unsent(field.dataset.pressKey)
    send(field.dataset.pressKey, event.target.value, true)
  })
  body.addEventListener('scroll', () => {
    if (performance.now() < quietUntil) return
    clearTimeout(scrollTimer)
    scrollTimer = setTimeout(() => act({ kind: 'scroll', offset: Math.round(body.scrollTop / row()) }), 120)
  })
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => { if (drawn > 0) measure(true) }, 200)
  })
})()`

/** The page: which checkout it shows, the pane with its title and scrolling body, and a line for what the engine said. */
export function pageShell(where: string, width: number | null, nonce: string, run: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>GitLab · preview</title>
<link rel="stylesheet" href="pane.css">
<style>
${width === null ? '' : `:root { --pane-width: ${width}px; }\n`}html, body { height: 100%; }
body { display: flex; flex-direction: column; gap: 8px; }
#where, #note { width: var(--pane-width); font-size: 11px; color: var(--faint); overflow-wrap: anywhere; }
#note { min-height: 1.4em; }
#note.stopped { color: var(--c-error); }
#pane { display: flex; flex-direction: column; flex: 1; min-height: 0; }
#pane > main { flex: 1; min-height: 0; overflow-y: auto; }
[data-kind="button"] { cursor: pointer; }
.select select { font: inherit; color: inherit; background: none; border: 0; }
.input input.field, .input textarea.field { font-family: inherit; color: inherit; resize: vertical; }
</style></head>
<body>
<div id="where">${escape(where)}</div>
<div id="pane"><header><span id="title">GitLab</span><span class="close">×</span></header><main id="body"><span class="text dim">starting the engine…</span></main></div>
<div id="note"></div>
<script nonce="${nonce}">${pageScript(run)}</script>
</body></html>
`
}

// ---- the server ---------------------------------------------------------------------------------------------------------

/** A page's stream of events, as the server holds it: an answer to `/events` kept open. */
export type Watcher = {
  readonly write: (said: string) => unknown
  readonly end: () => unknown
  readonly on: (event: 'close', heard: () => void) => unknown
}

const event = (name: string, data: Json): string => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`

/** The engine's pane, and every page watching it: what each is sent, and what each asks, one at a time. */
export class Preview {
  readonly #run: string
  readonly #pages = new Set<Watcher>()
  readonly #queue: Queued[] = []
  readonly #measurements = new Measurements()
  #desktop: Desktop | null = null
  #frame: Json | null = null
  #title = ''
  #stopped: string | null = null

  /** `run` names this run of the preview, so a page served by another is told to reload rather than drive this engine. */
  constructor(run: string) {
    this.#run = run
  }

  /** Sends one event to every page. */
  send(name: string, data: Json): void {
    const said = event(name, data)
    this.#pages.forEach(page => page.write(said))
  }

  /** A page started watching: it hears which run this is, then the latest drawing, or why the engine stopped. */
  watch(page: Watcher): void {
    this.#pages.add(page)
    page.on('close', () => this.#pages.delete(page))
    page.write(event('hello', { run: this.#run }))
    if (this.#stopped !== null) {
      page.write(event('stopped', { reason: this.#stopped }))
      page.end()
    } else if (this.#frame !== null) {
      page.write(event('frame', this.#frame))
    }
  }

  /**
   * Takes what a page sent: a measurement answers the drawing waiting for it at once, or, the first of the latest drawing
   * when none waited, is handed over in its turn; anything else waits its turn.
   */
  take(action: Action): void {
    if (action.kind !== 'measured') {
      this.#queue.push(action)
      return
    }
    const taken = this.#measurements.take(action.draw, action.measured, action.resized)
    if (taken === 'stale') {
      return
    }
    // Only the measurement taken sets the window's height, so one tab's height never meets another's rows.
    this.#desktop?.resize(action.bodyRows)
    if (taken === 'unasked') {
      this.#queue.push({ kind: 'remeasured', draw: action.draw, measured: action.measured })
    }
  }

  /** Measures a fresh drawing: every page draws it, and the first to measure it answers; with no page, the rig's estimate. */
  readonly measure = async (tree: Json): Promise<Measured> => {
    const draw = this.#measurements.drawn()
    const { html, unknown } = liveHtml(decodeNode(tree))
    // The wait starts before the drawing goes out, so no answer, however quick, comes before it.
    const measured = this.#pages.size > 0 ? this.#measurements.wait(draw, MEASURE_MS) : Promise.resolve(null)
    this.#frame = { draw, html, title: this.#title }
    this.send('frame', this.#frame)
    if (unknown.size > 0) {
      this.send('note', { text: `not drawn here: ${[...unknown].toSorted().join(', ')}` })
    }
    return (await measured) ?? estimate(tree)
  }

  async #perform(desktop: Desktop, action: Queued): Promise<string> {
    if (action.kind === 'remeasured') {
      // The engine redrew while it waited its turn: its rows and keys belong to a tree no longer on screen.
      if (!this.#measurements.isLatest(action.draw)) {
        return 'left a measurement of a drawing the engine has since replaced'
      }
      await desktop.remeasured(action.measured)
      return `measured the pane again: ${action.measured.rows} rows`
    }
    if (action.kind === 'press') {
      return desktop.pressKey(action.key)
    }
    if (action.kind === 'select') {
      return desktop.select(action.key, action.value)
    }
    if (action.kind === 'input') {
      return desktop.input(action.key, action.submit ? 'submit' : 'change', action.value)
    }
    const said = await desktop.scrollTo(action.offset)
    // The engine may keep the window elsewhere than the person put it.
    if (desktop.offset !== action.offset) {
      this.send('scroll', { offset: desktop.offset })
    }
    return said
  }

  /**
   * Runs the engine until it stops: opens the pane, then answers its redraws and scrolls and the pages' actions in turn. An
   * action the engine refuses is a note; an engine that has gone, or began a model turn, ends the run, so the caller stops.
   */
  async run(engine: Engine, bodyRows: number): Promise<never> {
    const desktop = new Desktop(engine, bodyRows, this.measure)
    this.#desktop = desktop
    await engine.ask({ subtype: 'initialize' })
    await desktop.draw()
    await openPane(engine, desktop)
    let titledAt = -1
    for (;;) {
      const action = this.#queue.shift()
      if (action !== undefined) {
        let said: string
        try {
          said = await this.#perform(desktop, action)
        } catch (error) {
          if (error instanceof EngineGone) {
            throw error
          }
          said = `refused: ${messageOf(error)}`
        }
        console.log(said)
        this.send('note', { text: said })
      }
      await desktop.settle(100, 2, offset => this.send('scroll', { offset }))
      if (desktop.draws !== titledAt) {
        titledAt = desktop.draws
        const now = await title(engine)
        if (now !== this.#title) {
          this.#title = now
          this.send('title', { title: now })
        }
      }
    }
  }

  /** Tells every page why the engine stopped, and lets each go, so the server can close. */
  stop(reason: string): void {
    this.#stopped = reason
    this.send('stopped', { reason })
    this.#pages.forEach(page => page.end())
  }
}

const NO_STORE = { 'cache-control': 'no-store' }

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((done, failed) => {
    let said = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      said += chunk
      if (said.length > BODY_MOST) {
        failed(new ActionError('too much in one request'))
        request.destroy()
      }
    })
    request.on('end', () => done(said))
    request.on('error', failed)
  })
}

/** Which checkout and branch the page shows, so a page served by another worktree is plain to see. */
function whereFrom(root: string): string {
  const branch = spawnSync('git', ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).stdout.trim()
  return `${root}${branch !== '' ? ` · ${branch}` : ''}`
}

/** Says who holds the port: another checkout's preview, by its checkout, or something else. */
async function holderOf(port: number): Promise<string> {
  try {
    // Something that holds the port and never answers is not waited on past this.
    const answer: unknown = await (await fetch(`http://127.0.0.1:${port}/about`, { signal: AbortSignal.timeout(2000) })).json()
    return `the preview of ${text(isRecord(answer) ? answer['where'] : undefined)}`
  } catch {
    return 'something that is not a preview'
  }
}

/** What the server serves in one run: fixed when it starts. */
export type Site = {
  readonly port: number
  readonly where: string
  readonly page: string
  readonly policy: string
  /** The folder of pane.css and fonts/. */
  readonly screens: string
  readonly fonts: ReadonlySet<string>
}

/** How the server answers a request: a reply as it is, or the page's event stream, or an action to read and take. */
export type Answer =
  | { readonly kind: 'reply'; readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly body: string | Buffer }
  | { readonly kind: 'events' }
  | { readonly kind: 'act' }

const reply = (status: number, headers: Readonly<Record<string, string>> = {}, body: string | Buffer = ''): Answer => ({
  kind: 'reply',
  status,
  headers: { ...NO_STORE, ...headers },
  body,
})

/** A file the page loads, read before anything is answered, so one that cannot be read is a 404, not a broken answer. */
function fileAnswer(path: string, type: string): Answer {
  try {
    return reply(200, { 'content-type': type }, readFileSync(path))
  } catch {
    return reply(404)
  }
}

/** How the server answers `method` on `url`: only a request from a page it served, and only for what it serves. */
export function answerOf(method: string, url: string, headers: IncomingHttpHeaders, site: Site): Answer {
  if (!isOwnRequest(method, headers, site.port)) {
    return reply(403, { 'content-type': 'text/plain; charset=utf-8' }, 'this preview answers only pages it served\n')
  }
  const path = new URL(url, 'http://127.0.0.1').pathname
  const font = path.startsWith('/fonts/') ? path.slice('/fonts/'.length) : ''
  if (method === 'GET' && path === '/') {
    return reply(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': site.policy, 'x-frame-options': 'DENY' }, site.page)
  }
  if (method === 'GET' && path === '/pane.css') {
    return fileAnswer(join(site.screens, 'pane.css'), 'text/css; charset=utf-8')
  }
  if (method === 'GET' && site.fonts.has(font)) {
    return fileAnswer(join(site.screens, 'fonts', font), 'font/woff2')
  }
  if (method === 'GET' && path === '/about') {
    return reply(200, { 'content-type': 'application/json' }, JSON.stringify({ where: site.where }))
  }
  if (method === 'GET' && path === '/events') {
    return { kind: 'events' }
  }
  if (method === 'POST' && path === '/act') {
    return { kind: 'act' }
  }
  return reply(404)
}

/** What run `run` serves on `port`: its page and the policy that lets the page's script, and only it, run. */
export function siteFor(port: number, where: string, width: number | null, run: string): Site {
  const nonce = randomUUID()
  return {
    port,
    where,
    page: pageShell(where, width, nonce, run),
    policy: policyFor(nonce),
    screens: SCREENS,
    fonts: new Set(readdirSync(join(SCREENS, 'fonts')).filter(name => name.endsWith('.woff2'))),
  }
}

async function serve(options: Options): Promise<number> {
  const run = randomUUID()
  const preview = new Preview(run)
  const site = siteFor(options.port, whereFrom(ROOT), options.width, run)

  const answer = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const answered = answerOf(request.method ?? 'GET', request.url ?? '/', request.headers, site)
    if (answered.kind === 'reply') {
      response.writeHead(answered.status, answered.headers).end(answered.body)
    } else if (answered.kind === 'events') {
      response.writeHead(200, { ...NO_STORE, 'content-type': 'text/event-stream', connection: 'keep-alive' })
      preview.watch(response)
    } else {
      try {
        preview.take(decodeAction(parseJson(await readBody(request)), run))
        response.writeHead(204, NO_STORE).end()
      } catch (error) {
        response.writeHead(400, { ...NO_STORE, 'content-type': 'text/plain; charset=utf-8' }).end(`refused: ${messageOf(error)}`)
      }
    }
  }
  const server = createServer((request, response) => {
    answer(request, response).catch((error: unknown) => {
      // An answer already begun cannot become an error: it is cut off instead, and the server carries on.
      if (response.headersSent) {
        response.destroy()
      } else {
        response.writeHead(500, NO_STORE).end(messageOf(error))
      }
    })
  })
  const listening = await new Promise<boolean>(done => {
    server.once('error', () => done(false))
    server.listen(options.port, '127.0.0.1', () => done(true))
  })
  if (!listening) {
    console.error(`pane-preview: port ${options.port} is taken, by ${await holderOf(options.port)}; stop it, or pass --port`)
    return 1
  }
  // The engine's folder (its working directory and log) is the port's own: the Claude app stops a preview with a kill no
  // handler sees, so whatever that one left behind is cleared by the next on the same port, not piled up.
  const folder = join(tmpdir(), `pane-preview-${options.port}`)
  rmSync(folder, { recursive: true, force: true })
  mkdirSync(folder)
  console.log(`pane-preview: http://127.0.0.1:${options.port} shows ${site.where}`)

  const log = options.log ?? join(folder, 'debug.log')
  const engine = new Engine(spawnWire(folder, log), log)
  const end = (code: number) => {
    engine.close()
    server.close()
    rmSync(folder, { recursive: true, force: true })
    return code
  }
  process.once('SIGINT', () => process.exit(end(130)))
  process.once('SIGTERM', () => process.exit(end(143)))
  try {
    return await preview.run(engine, 40)
  } catch (error) {
    const reason = messageOf(error)
    preview.stop(reason)
    console.error(`pane-preview: stopped: ${reason}`)
    engine
      .newLogLines()
      .slice(-15)
      .forEach(line => console.error(`  log ${line.slice(0, 220)}`))
    return end(1)
  }
}

async function main(argv: readonly string[]): Promise<number> {
  let command: Command
  try {
    // `npm run` runs from the repository's root; INIT_CWD is where it was called, which a relative --log means.
    command = parseCommand(argv, process.env['INIT_CWD'] ?? process.cwd())
  } catch (error) {
    console.error(`pane-preview: ${messageOf(error)}\n\n${USAGE}`)
    return 2
  }
  if (command.kind === 'help') {
    console.log(USAGE)
    return 0
  }
  return serve(command.options)
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2))
}
