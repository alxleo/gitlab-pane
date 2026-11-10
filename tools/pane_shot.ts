// pane-shot: photograph the pane in the running Claude desktop app as the person sees it, and press its buttons by what they read.
//
//   node tools/pane_shot.ts windows                                    the Claude app's windows on screen
//   node tools/pane_shot.ts capture -o pane.png                        the pane as it is now
//   node tools/pane_shot.ts capture --to bottom -o bottom.png          scrolled to its end first
//   node tools/pane_shot.ts tour -o shots/                             top to bottom, a page per file
//   node tools/pane_shot.ts press "read whole" Mine -o after.png       click buttons by what they read, then capture
//
// (`npm run shot -- …` is the same; `--help` says more.) Mac only. `pane_rig.ts` checks what the engine is handed with no
// screen; this checks what the desktop app draws and does with it. The pane is found by reading its title off the window
// with macOS text recognition, and found again before every scroll and click, so a pane that moved or a session that
// changed is never scrolled, clicked or cropped by mistake. Clicks and scrolls go through Hammerspoon, which holds the
// Accessibility grant; screenshots need the Screen Recording grant for the terminal that runs this.
//
// What live checks taught, and where each is kept:
// - The app ignores a click unless its window is in front: events posted to it in the background never reach the pane. Each
//   click, scroll and pointer move goes in one Hammerspoon call that first checks the window is in front and where it was
//   read, so a person switching away or moving the window in between is caught; it refuses rather than take focus.
//   `--raise` brings the window forward only when no key or pointer has moved for a while, and gives focus back at the end.
// - A hover card opens in the flow and moves what is below it, so the pointer is parked on the pane's header before every
//   read, with a mouse-moved event, since moving the pointer alone tells the app nothing. It is put back at the end if it
//   is still where this left it.
// - The window can move or change size between steps, so each read finds the pane again, a crop is cut from the same frame
//   its pane was found in, and a click goes where the latest read put its word.
// - Text recognition can misread the session's name in the window's header (its ▾ came back as "V", then "v"), so names
//   are compared by their letters and digits with that mark dropped, and `--session` names the session a capture must be from.
//
// Run it when the person says the pane is in front, never on a timer. Only the pane is written: the whole-window frames it
// reads, which show other sessions, stay in a temporary folder that is deleted when it exits, Ctrl-C included.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'

import { field, isRecord, parseJson, records, text } from '../hooks/decode.ts'

/** The desktop apps that draw a mod's pane, tried in this order when `--app` is not given. */
const CLAUDE_APPS = ['Claude', 'Claude Work']
/** The most one wheel event moves: 400 pixels moved a session's transcript when tried by hand; 2,000 never moved the pane. */
const STEP_PIXELS = 400
/** Far enough to reach either end of any pane drawn so far. */
const TO_THE_END = 20_000
/** A docked pane's header sits in the window's top band, right of this share of its width; the same word in a transcript never does. */
const PANE_FROM = 0.35
/** How far down the window, in points, a pane's header is looked for. */
const HEADER_BAND = 80
/** How far down the window the session's name is looked for. */
const SESSION_BAND = 35
/** Where the pane's edges sit from its title's box, in points. */
const PANE_INSET = { left: 14, top: 12, edge: 4 }
/** A pane or window further than this, in points, from where it was read has moved. */
const MOVE_TOLERANCE = 4
/** Seconds with no key or pointer moving before `--raise` takes focus. */
const IDLE_SECONDS = 5
const SETTLE_MS = { park: 800, scroll: 600, click: 1500, raise: 400 }

const USAGE = `pane-shot: photograph the pane in the running Claude desktop app, and press its buttons by what they read. Mac only.

  node tools/pane_shot.ts windows                       the Claude app's windows on screen, largest first
  node tools/pane_shot.ts capture -o FILE.png           the pane as it is now
  node tools/pane_shot.ts capture --to top|bottom -o FILE.png
  node tools/pane_shot.ts tour -o FOLDER [--pages N]    scrolled to its top, then a page per file to its end, then back
  node tools/pane_shot.ts press TEXT... [-o FILE.png]   click each button by its words, in order, then capture

Options:
  --pane TITLE      the pane's title as its header reads (default GitLab; "GitLab · Mine" matches)
  --app NAME        the app whose window holds the pane (default: Claude or Claude Work, the one in front)
  --window ID       the window, as \`windows\` lists it (default: the app's window in front, else its largest)
  --session NAME    refuse unless the window's header reads NAME (its letters and digits, any case)
  --raise           bring the window forward if no key or pointer has moved for ${IDLE_SECONDS}s, and give focus back at the end
  -o, --out PATH    the PNG to write, or the folder for tour's pages
  -h, --help        this

Needs Hammerspoon with its \`hs\` command (hs.ipc), and the Screen Recording grant for this terminal. A click, a scroll or a
pointer move needs the app's window in front; without --raise it refuses rather than take focus, and a capture of a window
behind others says it was read without parking the pointer. Prints one JSON line on success.`

class ShotError extends Error {}
class UsageError extends Error {}

export type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
export type Point = { readonly x: number; readonly y: number }
/** A word read off a window, its box in screen points, origin top-left (or in a frame's pixels, in a `Read`). */
export type Word = Rect & { readonly text: string }
/** A line read off a window, with the box of each of its words. */
export type Line = Word & { readonly words: readonly Word[] }
export type Window = { readonly id: number; readonly app: string; readonly bounds: Rect }
/** The windows on screen and the one in front (0 for none). */
export type Desk = { readonly windows: readonly Window[]; readonly front: number }
/** What a read of the window found: the pane, its title's box, and the session the window shows. */
export type Located = { readonly pane: Rect; readonly titleAt: Rect; readonly session: string }
/** What text recognition read off a captured frame: its width in pixels and each line's box in pixels. */
export type Read = { readonly width: number; readonly lines: readonly Line[] }

export type Where = {
  readonly pane: string
  readonly app: string | null
  readonly window: number | null
  readonly session: string | null
  readonly raise: boolean
}
export type Command =
  | { readonly kind: 'help' }
  | { readonly kind: 'windows'; readonly app: string | null }
  | { readonly kind: 'capture'; readonly where: Where; readonly out: string; readonly to: 'here' | 'top' | 'bottom' }
  | { readonly kind: 'press'; readonly where: Where; readonly presses: readonly string[]; readonly out: string | null }
  | { readonly kind: 'tour'; readonly where: Where; readonly out: string; readonly pages: number }

// ---- what is read off the screen: plain data in, plain data out ---------------------------------------------------------

/** A read's lines and words moved into screen points: the frame is `scale` pixels to a point and starts at the window's corner. */
export function onScreen(read: Read, window: Window): Line[] {
  const scale = read.width / window.bounds.w
  const place = (box: Word): Word => ({
    text: box.text,
    x: window.bounds.x + box.x / scale,
    y: window.bounds.y + box.y / scale,
    w: box.w / scale,
    h: box.h / scale,
  })
  return read.lines.map(line => ({ ...place(line), words: line.words.map(place) }))
}

/** The header reads the title, alone or followed by more: "GitLab · Mine" names the view shown. */
export const isTitle = (read: string, title: string): boolean => read.trim() === title || read.trim().startsWith(`${title} `)

/** The docked pane whose header reads `title`, from the lines read off `window`, or null when none shows. */
export function locate(lines: readonly Line[], window: Window, title: string): Located | null {
  const { x: wx, y: wy, w: ww, h: wh } = window.bounds
  const hits = lines.filter(line => isTitle(line.text, title) && line.x - wx > ww * PANE_FROM && line.y - wy < HEADER_BAND)
  const hit = hits.toSorted((a, b) => a.y - b.y)[0]
  if (hit === undefined) {
    return null
  }
  const left = hit.x - PANE_INSET.left
  const top = hit.y - PANE_INSET.top
  const pane = { x: left, y: top, w: wx + ww - left - PANE_INSET.edge, h: wy + wh - top - PANE_INSET.edge }
  // The session's name is the longest line in the window's top band, left of the pane.
  const header = lines.filter(line => line.y - wy < SESSION_BAND && line.x < left).map(line => line.text.trim())
  const session = header.reduce((longest, each) => (each.length > longest.length ? each : longest), '')
  return { pane, titleAt: { x: hit.x, y: hit.y, w: hit.w, h: hit.h }, session }
}

const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Letters and digits only, lower case: what reading text off the screen gets right. */
export const plain = (read: string): string =>
  Array.from(SEGMENTER.segment(read.toLowerCase()), part => part.segment)
    .filter(char => /[\p{L}\p{N}]/u.test(char))
    .join('')

/** A session's name as it can be compared: its letters and digits, without the ▾ after it, which reads as "V" or "v" too. */
export const sessionName = (read: string): string => plain(read.replace(/\s+[▾▼Vv]\s*$/u, ''))

/** Two reads of the window's header name the same session. A misread letter makes them differ: that refuses, never passes. */
export const sameSession = (a: string, b: string): boolean => sessionName(a) === sessionName(b)

/** The pane's title sits elsewhere than it did: the window moved or changed size, or another view is showing. */
export const hasMoved = (was: Rect, now: Rect): boolean => Math.abs(was.x - now.x) > MOVE_TOLERANCE || Math.abs(was.y - now.y) > MOVE_TOLERANCE

/** The words of `read` that have letters or digits, each as `plain` gives it. */
const tokens = (read: string): string[] =>
  read
    .split(/\s+/u)
    .map(plain)
    .filter(token => token !== '')

/**
 * Where to click for `wanted`: the middle of its words, read whole and in order, in the topmost line of the pane below its
 * header that has them. A line that is nothing but those words comes before a line that has more.
 */
export function target(lines: readonly Line[], found: Located, wanted: string): { readonly line: string; readonly at: Point } | null {
  const want = tokens(wanted)
  const { pane, titleAt } = found
  const inPane = (word: Word): boolean =>
    word.x >= pane.x && word.x + word.w <= pane.x + pane.w && word.y > titleAt.y + titleAt.h + MOVE_TOLERANCE && word.y + word.h < pane.y + pane.h
  const runs = lines.flatMap(line => {
    const words = line.words.filter(word => plain(word.text) !== '')
    return words.flatMap((_, start) => {
      const run = words.slice(start, start + want.length)
      const matches = want.length > 0 && run.length === want.length && run.every((word, at) => plain(word.text) === want[at] && inPane(word))
      return matches ? [{ line, run, whole: words.length === want.length }] : []
    })
  })
  const top = (run: readonly Word[]): number => Math.min(...run.map(word => word.y))
  const best = runs.toSorted((a, b) => (a.whole !== b.whole ? (a.whole ? -1 : 1) : top(a.run) - top(b.run)))[0]
  if (best === undefined) {
    return null
  }
  const left = Math.min(...best.run.map(word => word.x))
  const right = Math.max(...best.run.map(word => word.x + word.w))
  const bottom = Math.max(...best.run.map(word => word.y + word.h))
  return { line: best.line.text, at: { x: (left + right) / 2, y: (top(best.run) + bottom) / 2 } }
}

/** A scroll of `pixels` (negative is down) as equal wheel events of at most 400 pixels each: a short page is not overshot. */
export function strokes(pixels: number): { readonly count: number; readonly step: number } {
  const count = Math.max(1, Math.round(Math.abs(pixels) / STEP_PIXELS))
  return { count, step: Math.round(pixels / count) }
}

/** Where the pointer waits while the pane is read: on the header, past the title, where no row's hover card can open. */
export const parking = (found: Located): Point => ({ x: found.titleAt.x + found.titleAt.w + 60, y: found.titleAt.y + found.titleAt.h / 2 })

const largestFirst = (a: Window, b: Window): number => b.bounds.w * b.bounds.h - a.bounds.w * a.bounds.h

/**
 * The window the pane is looked for in: the one `--window` names, or else, of the app named (or the Claude app in front, or
 * the only one running), the window in front if it is one of its own, or its largest.
 */
export function chooseWindow(seen: Desk, { app, window: id }: Pick<Where, 'app' | 'window'>): Window {
  if (id !== null) {
    const named = seen.windows.find(window => window.id === id && (app === null || window.app === app))
    if (named === undefined) {
      throw new ShotError(`no window ${id}${app === null ? '' : ` of ${app}`} on screen: \`windows\` lists them`)
    }
    return named
  }
  const front = seen.windows.find(window => window.id === seen.front)
  const running = CLAUDE_APPS.filter(name => seen.windows.some(window => window.app === name))
  const chosen = app ?? (front !== undefined && CLAUDE_APPS.includes(front.app) ? front.app : running.length === 1 ? (running[0] ?? null) : null)
  if (chosen === null) {
    throw new ShotError(running.length === 0 ? `no ${CLAUDE_APPS.join(' or ')} window on screen` : `both ${running.join(' and ')} are open: say which with --app`)
  }
  const picked = front?.app === chosen ? front : seen.windows.filter(window => window.app === chosen).toSorted(largestFirst)[0]
  if (picked === undefined) {
    throw new ShotError(`no ${chosen} window on screen`)
  }
  return picked
}

/** A frame's rectangle in its own pixels for a rectangle in screen points, `scale` pixels to a point. */
export const inPixels = (rect: Rect, window: Window, scale: number): Rect => ({
  x: Math.round((rect.x - window.bounds.x) * scale),
  y: Math.round((rect.y - window.bounds.y) * scale),
  w: Math.round(rect.w * scale),
  h: Math.round(rect.h * scale),
})

/** A number as Lua reads it: only numbers ever go into the Lua this sends, never text read off the screen or typed. */
export function lua(value: number): string {
  if (!Number.isFinite(value)) {
    throw new ShotError(`not a number for Hammerspoon: ${value}`)
  }
  return String(Math.round(value))
}

// ---- the command line ---------------------------------------------------------------------------------------------------

/** The command the arguments ask for, with paths taken from `base` (where `npm run` was called); throws saying what is wrong. */
export function parseCommand(argv: readonly string[], base: string): Command {
  const { positionals, values } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      out: { type: 'string', short: 'o' },
      pane: { type: 'string', default: 'GitLab' },
      app: { type: 'string' },
      window: { type: 'string' },
      session: { type: 'string' },
      to: { type: 'string', default: 'here' },
      pages: { type: 'string', default: '12' },
      raise: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  const [verb, ...rest] = positionals
  if (values.help || verb === undefined) {
    return { kind: 'help' }
  }
  const app = values.app ?? null
  const window = values.window === undefined ? null : Number(values.window)
  if (window !== null && !(Number.isInteger(window) && window > 0)) {
    throw new UsageError(`--window is a window's number from \`windows\`, not ${values.window}`)
  }
  const session = values.session ?? null
  if (session !== null && sessionName(session) === '') {
    throw new UsageError(`--session needs a name with letters or digits, not ${JSON.stringify(session)}`)
  }
  const where: Where = { pane: values.pane, app, window, session, raise: values.raise }
  const out = values.out === undefined ? null : resolve(base, values.out)
  const needsOut = (): string => {
    if (out === null) {
      throw new UsageError(`${verb} needs -o`)
    }
    return out
  }
  const none = () => {
    if (rest.length > 0) {
      throw new UsageError(`${verb} takes no ${rest.join(' ')}`)
    }
  }
  switch (verb) {
    case 'windows':
      none()
      return { kind: 'windows', app }
    case 'capture': {
      none()
      const to = values.to
      if (to !== 'here' && to !== 'top' && to !== 'bottom') {
        throw new UsageError(`--to is here, top or bottom, not ${to}`)
      }
      return { kind: 'capture', where, out: needsOut(), to }
    }
    case 'press': {
      const unreadable = rest.find(each => tokens(each).length === 0)
      if (rest.length === 0 || unreadable !== undefined) {
        throw new UsageError(rest.length === 0 ? 'press needs what a button reads' : `nothing to read in ${JSON.stringify(unreadable)}`)
      }
      return { kind: 'press', where, presses: rest, out }
    }
    case 'tour': {
      none()
      const pages = Number(values.pages)
      if (!Number.isInteger(pages) || pages < 1) {
        throw new UsageError(`--pages is a whole number of at least 1, not ${values.pages}`)
      }
      return { kind: 'tour', where, out: needsOut(), pages }
    }
    default:
      throw new UsageError(`no command ${verb}`)
  }
}

// ---- the Mac: screencapture, text recognition, Hammerspoon --------------------------------------------------------------

/**
 * Reads the text off a PNG with macOS's Vision, each line with the box of each of its words, or crops one: JavaScript for
 * Automation, which reaches Vision from `osascript`. It gets the file's paths and numbers as arguments, never as code.
 */
const MAC_SCRIPT = `
ObjC.import('AppKit'); ObjC.import('CoreGraphics'); ObjC.import('Vision')
function run(argv) {
  const rep = $.NSBitmapImageRep.imageRepWithContentsOfFile(argv[1])
  if (rep.isNil()) return JSON.stringify({ error: 'cannot open ' + argv[1] })
  const width = Number(rep.pixelsWide), height = Number(rep.pixelsHigh)
  if (argv[0] === 'crop') {
    const n = argv.slice(3).map(Number)
    const part = $.CGImageCreateWithImageInRect(rep.CGImage, { origin: { x: n[0], y: n[1] }, size: { width: n[2], height: n[3] } })
    const png = $.NSBitmapImageRep.alloc.initWithCGImage(part).representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({}))
    return JSON.stringify({ written: png.writeToFileAtomically(argv[2], true) })
  }
  const request = $.VNRecognizeTextRequest.alloc.init
  request.recognitionLevel = $.VNRequestTextRecognitionLevelAccurate
  request.usesLanguageCorrection = false
  const error = Ref()
  if (!$.VNImageRequestHandler.alloc.initWithCGImageOptions(rep.CGImage, $({})).performRequestsError($([request]), error)) {
    return JSON.stringify({ error: 'text recognition failed: ' + String(error[0]) })
  }
  const place = (text, box) => ({
    text: text, x: box.origin.x * width, y: (1 - box.origin.y - box.size.height) * height, w: box.size.width * width, h: box.size.height * height,
  })
  const results = request.results, lines = []
  for (let i = 0; !results.isNil() && i < results.count; i++) {
    const result = results.objectAtIndex(i), candidate = result.topCandidates(1).objectAtIndex(0), read = candidate.string.js, words = []
    for (const match of read.matchAll(/\\S+/g)) {
      const word = candidate.boundingBoxForRangeError({ location: match.index, length: match[0].length }, null)
      if (!word.isNil()) words.push(place(match[0], word.boundingBox))
    }
    lines.push(Object.assign(place(read, result.boundingBox), { words: words }))
  }
  return JSON.stringify({ width: width, lines: lines })
}`

const num = (value: unknown): number => (typeof value === 'number' ? value : Number.NaN)
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const box = (each: Record<string, unknown>): Word => ({ text: text(each['text']), x: num(each['x']), y: num(each['y']), w: num(each['w']), h: num(each['h']) })

/** Runs a program to its end and answers what it printed, or says why it could not. */
function call(program: string, args: readonly string[], input: string, missing: string): string {
  const done = spawnSync(program, args, { input, encoding: 'utf8', timeout: 30_000 })
  if (done.error !== undefined) {
    throw new ShotError(text(field(done.error, 'code')) === 'ENOENT' ? missing : `${program} did not answer: ${done.error.message}`)
  }
  if (done.status !== 0) {
    throw new ShotError(`${program} failed: ${done.stderr.trim() !== '' ? done.stderr.trim() : done.stdout.trim()}`)
  }
  return done.stdout
}

/** The JSON object a program printed last: Hammerspoon prints the extensions it loads first. */
function lastJson(output: string, program: string): Record<string, unknown> {
  const last = output.trim().split('\n').at(-1) ?? ''
  const answer: unknown = last.startsWith('{') ? parseJson(last) : null
  if (!isRecord(answer)) {
    throw new ShotError(`${program} answered ${JSON.stringify(last.slice(0, 200))}`)
  }
  const error = text(answer['error'])
  if (error !== '') {
    throw new ShotError(error)
  }
  return answer
}

function mac(args: readonly string[]): Record<string, unknown> {
  return lastJson(call('osascript', ['-l', 'JavaScript', '-', ...args], MAC_SCRIPT, 'osascript is missing: this runs on a Mac'), 'osascript')
}

function hammerspoon(chunk: string): Record<string, unknown> {
  const missing = "Hammerspoon's `hs` command is not installed: run hs.ipc.cliInstall() in Hammerspoon's console"
  return lastJson(call('hs', ['-c', chunk], '', missing), 'Hammerspoon')
}

function desk(): Desk {
  const answer = hammerspoon(`
    local list = {}
    for _, w in ipairs(hs.window.visibleWindows()) do
      local f, a = w:frame(), w:application()
      if w:isStandard() then table.insert(list, { id = w:id(), app = a and a:name() or '', x = f.x, y = f.y, w = f.w, h = f.h }) end
    end
    local front = hs.window.frontmostWindow()
    return hs.json.encode({ windows = list, front = front and front:id() or 0 })`)
  const windows = records(answer['windows']).map(each => ({
    id: num(each['id']),
    app: text(each['app']),
    bounds: { x: num(each['x']), y: num(each['y']), w: num(each['w']), h: num(each['h']) },
  }))
  return { windows, front: num(answer['front']) }
}

const pointTo = (at: Point): string => `{ x = ${lua(at.x)}, y = ${lua(at.y)} }`
/** Lua that answers, from inside the call it is in, that `window` is no longer in front, naming what is. */
const unlessInFront = (window: Window): string => `
    local front = hs.window.frontmostWindow()
    if front == nil or front:id() ~= ${lua(window.id)} then
      local app = front and front:application()
      return hs.json.encode({ done = false, front = app and app:name() or 'no window' })
    end`
/** Lua that moves the pointer to `at` and tells the app under it, which moving the pointer alone does not. */
const movePointer = (at: Point): string => `hs.mouse.absolutePosition(${pointTo(at)}); hs.eventtap.event.newMouseEvent(hs.eventtap.event.types.mouseMoved, ${pointTo(at)}):post()`

type Outcome = { readonly done: boolean; readonly front: string; readonly moved: boolean }

/**
 * Runs `body` in Hammerspoon only if `window` is in front and where it was read, checked in the same call, so a switch or a
 * drag in between is caught. `body` may refuse part way with `unlessInFront`.
 */
function inFront(window: Window, body: string): Outcome {
  const { x, y, w, h } = window.bounds
  const answer = hammerspoon(`${unlessInFront(window)}
    local f, near = front:frame(), function(a, b) return math.abs(a - b) <= ${lua(MOVE_TOLERANCE)} end
    if not (near(f.x, ${lua(x)}) and near(f.y, ${lua(y)}) and near(f.w, ${lua(w)}) and near(f.h, ${lua(h)})) then
      return hs.json.encode({ done = false, moved = true })
    end
    ${body}
    return hs.json.encode({ done = true })`)
  return { done: answer['done'] === true, front: text(answer['front']), moved: answer['moved'] === true }
}

// ---- a visit: one command's reads and acts, and what it puts back -------------------------------------------------------

/** A read of the pane, with the window and the frame it came from, and whether the pointer was parked for it. */
type Found = Located & { readonly window: Window; readonly frame: string; readonly scale: number; readonly lines: readonly Line[]; readonly parked: boolean }
/** What a new read must agree with: the session it shows, and where the pane's title sits when that must not have moved. */
type Expect = { readonly session: string | null; readonly titleAt: Rect | null }

const anything: Expect = { session: null, titleAt: null }
const unmoved = (found: Located): Expect => ({ session: found.session, titleAt: found.titleAt })
const sameSessionAs = (found: Located): Expect => ({ session: found.session, titleAt: null })

class Visit {
  readonly #where: Where
  readonly #scratch = mkdtempSync(join(tmpdir(), 'pane-shot-'))
  /** The window the first read chose: every later read is of the same one. */
  #window: number | null = null
  /** Where the person's pointer was before this first moved it, and where this last put it. */
  #pointer: { readonly was: Point; readonly put: Point } | null = null
  /** The window that was in front before `--raise` took focus, to give focus back to. */
  #raisedFrom: number | null = null
  #frames = 0
  #closed = false

  constructor(where: Where) {
    this.#where = where
  }

  /** A path in the folder that is deleted when the visit ends. */
  scratch(name: string): string {
    return join(this.#scratch, name)
  }

  /** Grabs the window and finds the pane in it, refusing a read that disagrees with `expect` or with `--session`. */
  find(expect: Expect): Omit<Found, 'parked'> {
    const window = chooseWindow(desk(), { app: this.#where.app, window: this.#where.window ?? this.#window })
    this.#window = window.id
    this.#frames += 1
    const frame = this.scratch(`frame-${this.#frames}.png`)
    call('screencapture', ['-x', '-o', '-l', lua(window.id), frame], '', 'screencapture is missing: this runs on a Mac')
    const answer = mac(['read', frame])
    const read: Read = { width: num(answer['width']), lines: records(answer['lines']).map(each => ({ ...box(each), words: records(each['words']).map(box) })) }
    if (!(read.width > 0)) {
      throw new ShotError(`text recognition gave no width for the frame (${JSON.stringify(answer['width'])})`)
    }
    const lines = onScreen(read, window)
    const located = locate(lines, window, this.#where.pane)
    if (located === null) {
      throw new ShotError(`no pane titled ${JSON.stringify(this.#where.pane)} shows in the ${window.app} window (or this terminal lacks the Screen Recording grant)`)
    }
    for (const session of [this.#where.session, expect.session]) {
      if (session !== null && !sameSession(located.session, session)) {
        throw new ShotError(`the window shows another session (${JSON.stringify(located.session)}, not ${JSON.stringify(session)})`)
      }
    }
    if (expect.titleAt !== null && hasMoved(expect.titleAt, located.titleAt)) {
      throw new ShotError('the pane moved or the window changed')
    }
    return { ...located, window, frame, scale: read.width / window.bounds.w, lines }
  }

  /** Finds the pane with the pointer parked on its header when the window is in front, so no hover card has moved its rows. */
  async look(expect: Expect = anything): Promise<Found> {
    const first = this.find(expect)
    const spot = parking(first)
    if (!this.#act(first, 'park the pointer', movePointer(spot), spot, false)) {
      return { ...first, parked: false }
    }
    await sleep(SETTLE_MS.park)
    return { ...this.find(unmoved(first)), parked: true }
  }

  /** Writes the pane, cut from the frame it was found in, to `out`. */
  crop(found: Found, out: string): void {
    const at = inPixels(found.pane, found.window, found.scale)
    if (mac(['crop', found.frame, out, ...[at.x, at.y, at.w, at.h].map(lua)])['written'] !== true) {
      throw new ShotError(`could not write ${out}`)
    }
  }

  /** Scrolls the pane by `pixels` (negative is down) with the pointer over its middle, if it is where `was` found it. */
  async scroll(was: Found, pixels: number): Promise<void> {
    const found = this.find(unmoved(was))
    const middle = { x: found.pane.x + found.pane.w / 2, y: found.pane.y + found.pane.h / 2 }
    const { count, step } = strokes(pixels)
    // Events posted with only a location of their own came back with the pane unmoved; with the pointer over the pane, the
    // wheel goes where a person's would. Each step checks again that the window is still in front.
    this.#act(
      found,
      'scroll',
      `hs.mouse.absolutePosition(${pointTo(middle)}); hs.timer.usleep(50000)
      for i = 1, ${lua(count)} do
        ${unlessInFront(found.window)}
        local e = hs.eventtap.event.newScrollEvent({ 0, ${lua(step)} }, {}, 'pixel'); e:location(${pointTo(middle)}); e:post(); hs.timer.usleep(10000)
      end`,
      middle,
      true
    )
    await sleep(SETTLE_MS.scroll)
  }

  /**
   * Clicks the words `wanted` in the pane, in a window still showing `first`'s session; answers the line they were in. The
   * pane is read afresh first, so a window that moved since is clicked where it is now.
   */
  async press(first: Found, wanted: string): Promise<string> {
    const found = await this.look(sameSessionAs(first))
    const hit = target(found.lines, found, wanted)
    if (hit === null) {
      throw new ShotError(`nothing in the pane reads ${JSON.stringify(wanted)}`)
    }
    this.#act(found, `press ${JSON.stringify(wanted)}`, `hs.eventtap.leftClick(${pointTo(hit.at)})`, hit.at, true)
    await sleep(SETTLE_MS.click)
    return hit.line
  }

  /** With `--raise`, brings the window forward when the person has left the keyboard and pointer alone. */
  async raise(): Promise<void> {
    if (!this.#where.raise) {
      return
    }
    const window = chooseWindow(desk(), { app: this.#where.app, window: this.#where.window ?? this.#window })
    this.#window = window.id
    const answer = hammerspoon(`
      local front = hs.window.frontmostWindow()
      local was = front and front:id() or 0
      if was == ${lua(window.id)} then return hs.json.encode({ was = 0 }) end
      if hs.host.idleTime() < ${lua(IDLE_SECONDS)} then return hs.json.encode({ busy = true }) end
      local mine = hs.window.get(${lua(window.id)})
      if mine == nil then return hs.json.encode({ error = 'the window went away' }) end
      mine:focus()
      return hs.json.encode({ was = was })`)
    if (answer['busy'] === true) {
      throw new ShotError(`not raising the ${window.app} window: a key or the pointer moved in the last ${IDLE_SECONDS}s`)
    }
    const was = num(answer['was'])
    this.#raisedFrom = was > 0 ? was : null
    await sleep(SETTLE_MS.raise)
  }

  /**
   * Puts back what the visit moved, once: the pointer, if it is still where this left it (a person who has moved it since
   * keeps it where they put it), then the focus `--raise` took, if the window is still in front. The frames go whatever happens.
   */
  close(): void {
    if (this.#closed) {
      return
    }
    this.#closed = true
    try {
      if (this.#pointer !== null) {
        const { was, put } = this.#pointer
        hammerspoon(`
          local p = hs.mouse.absolutePosition()
          if math.abs(p.x - ${lua(put.x)}) <= 2 and math.abs(p.y - ${lua(put.y)}) <= 2 then ${movePointer(was)} end
          return hs.json.encode({})`)
      }
      if (this.#raisedFrom !== null && this.#window !== null) {
        hammerspoon(`
          local front = hs.window.frontmostWindow()
          local back = hs.window.get(${lua(this.#raisedFrom)})
          if front ~= nil and front:id() == ${lua(this.#window)} and back ~= nil then back:focus() end
          return hs.json.encode({})`)
      }
    } catch (error) {
      console.error(`pane-shot: could not put things back: ${messageOf(error)}`)
    } finally {
      rmSync(this.#scratch, { recursive: true, force: true })
    }
  }

  /**
   * Runs `body`, which leaves the pointer at `put`, with the window in front and unmoved. Answers whether it ran; when it did
   * not, a `required` act refuses, naming what is in front instead.
   */
  #act({ window }: { readonly window: Window }, what: string, body: string, put: Point, required: boolean): boolean {
    const was = this.#pointer?.was ?? this.#whereThePointerIs()
    const result = inFront(window, body)
    if (result.done) {
      this.#pointer = { was, put }
    }
    if (result.moved) {
      throw new ShotError(`not going to ${what}: the ${window.app} window moved or changed size since it was read`)
    }
    if (!result.done && required) {
      throw new ShotError(
        `not going to ${what}: ${result.front} is in front, and the ${window.app} window ignores clicks and scrolls behind it (bring it forward, or pass --raise)`
      )
    }
    return result.done
  }

  #whereThePointerIs(): Point {
    const answer = hammerspoon('local p = hs.mouse.absolutePosition(); return hs.json.encode({ x = p.x, y = p.y })')
    return { x: num(answer['x']), y: num(answer['y']) }
  }
}

// ---- the commands -------------------------------------------------------------------------------------------------------

const said = (found: Found) => ({
  session: found.session,
  window: found.window.id,
  pane: found.pane,
  ...(found.parked ? {} : { note: 'read without parking the pointer: the window was behind another, so a hover card may show' }),
})

async function capture(visit: Visit, command: Extract<Command, { kind: 'capture' }>): Promise<Record<string, unknown>> {
  await visit.raise()
  const before = await visit.look()
  if (command.to === 'here') {
    visit.crop(before, command.out)
    return { path: command.out, ...said(before) }
  }
  const beforePath = visit.scratch('before.png')
  visit.crop(before, beforePath)
  await visit.scroll(before, command.to === 'top' ? TO_THE_END : -TO_THE_END)
  const after = await visit.look(unmoved(before))
  visit.crop(after, command.out)
  const moved = !readFileSync(beforePath).equals(readFileSync(command.out))
  return { path: command.out, ...said(after), ...(moved ? {} : { unmoved: `the pane did not move: it was at its ${command.to} already, or the scroll missed it` }) }
}

async function press(visit: Visit, command: Extract<Command, { kind: 'press' }>): Promise<Record<string, unknown>> {
  await visit.raise()
  const first = await visit.look()
  const pressed: string[] = []
  for (const wanted of command.presses) {
    pressed.push(await visit.press(first, wanted))
  }
  if (command.out === null) {
    return { session: first.session, pressed }
  }
  const last = await visit.look(sameSessionAs(first))
  visit.crop(last, command.out)
  return { path: command.out, ...said(last), pressed }
}

async function tour(visit: Visit, command: Extract<Command, { kind: 'tour' }>): Promise<Record<string, unknown>> {
  mkdirSync(command.out, { recursive: true })
  await visit.raise()
  let found = await visit.look()
  await visit.scroll(found, TO_THE_END)
  found = await visit.look(unmoved(found))
  const pages: string[] = []
  let previous = Buffer.alloc(0)
  for (let page = 1; page <= command.pages; page += 1) {
    const path = join(command.out, `page-${String(page).padStart(2, '0')}.png`)
    visit.crop(found, path)
    const data = readFileSync(path)
    if (data.equals(previous)) {
      unlinkSync(path)
      break
    }
    pages.push(path)
    previous = data
    await visit.scroll(found, -Math.trunc(found.pane.h * 0.8))
    found = await visit.look(unmoved(found))
  }
  await visit.scroll(found, TO_THE_END)
  return { session: found.session, pages, ...(pages.length === 1 ? { note: 'one page only: the pane fits on one screen, or the scroll missed it' } : {}) }
}

async function main(argv: readonly string[]): Promise<number> {
  let command: Command
  try {
    // `npm run` runs from the repository's root; INIT_CWD is where it was called, which a relative -o means.
    command = parseCommand(argv, process.env['INIT_CWD'] ?? process.cwd())
  } catch (error) {
    console.error(`pane-shot: ${messageOf(error)}\n\n${USAGE}`)
    return 2
  }
  if (command.kind === 'help') {
    console.log(USAGE)
    return 0
  }
  if (process.platform !== 'darwin') {
    console.error('pane-shot: this reads the desktop app off a Mac screen; elsewhere, `npm run rig` drives the pane without one')
    return 1
  }
  if (command.kind === 'windows') {
    const { windows, front } = desk()
    const apps = command.app === null ? CLAUDE_APPS : [command.app]
    windows
      .filter(window => apps.includes(window.app))
      .toSorted(largestFirst)
      .forEach(window => {
        const { x, y, w, h } = window.bounds
        console.log(`${window.id}  ${window.app}  ${w.toFixed(0)}x${h.toFixed(0)} at ${x.toFixed(0)},${y.toFixed(0)}${window.id === front ? '  (in front)' : ''}`)
      })
    return 0
  }
  const visit = new Visit(command.where)
  // Node runs no `finally` on Ctrl-C: put things back and delete the frames, which show other sessions, before going.
  const interrupted = (code: number) => () => {
    visit.close()
    process.exit(code)
  }
  process.once('SIGINT', interrupted(130))
  process.once('SIGTERM', interrupted(143))
  try {
    const result = command.kind === 'capture' ? await capture(visit, command) : command.kind === 'press' ? await press(visit, command) : await tour(visit, command)
    console.log(JSON.stringify(result))
    return 0
  } catch (error) {
    if (!(error instanceof ShotError)) {
      throw error
    }
    console.error(`pane-shot: ${error.message}`)
    return 1
  } finally {
    visit.close()
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2))
}
