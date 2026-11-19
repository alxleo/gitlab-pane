import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Script } from 'node:vm'

import { expect, test } from 'vitest'

import { isRecord, parseJson, text } from '../hooks/decode.ts'
import { Engine, EngineGone, type Json, type Wire } from './pane_engine.ts'
import {
  DEFAULT_PORT,
  Measurements,
  Preview,
  answerOf,
  decodeAction,
  isOwnRequest,
  keepsTyping,
  pageShell,
  parseCommand,
  policyFor,
  type Answer,
  type Site,
  type Watcher,
} from './pane_preview.ts'

test('with no arguments it serves the default port at the pane’s own width, with the log in a temporary folder', () => {
  expect(parseCommand([], '/work')).toEqual({ kind: 'serve', options: { port: DEFAULT_PORT, width: null, log: null } })
})

test('--help asks for the help, and a relative --log is taken from where it was called', () => {
  expect(parseCommand(['--help'], '/work')).toEqual({ kind: 'help' })
  expect(parseCommand(['-h'], '/work')).toEqual({ kind: 'help' })
  expect(parseCommand(['--port', '4781', '--width', '520', '--log', 'engine.log'], '/work')).toEqual({
    kind: 'serve',
    options: { port: 4781, width: 520, log: '/work/engine.log' },
  })
})

test('a port below 1024 or past 65535, a width too narrow to draw, a word it does not take and an unknown option are refused', () => {
  expect(() => parseCommand(['--port', '80'], '/work')).toThrow('--port is a whole number from 1024 to 65535, not 80')
  expect(() => parseCommand(['--port', '70000'], '/work')).toThrow('--port')
  expect(() => parseCommand(['--width', '100'], '/work')).toThrow('--width')
  expect(() => parseCommand(['serve'], '/work')).toThrow('it takes no serve')
  expect(() => parseCommand(['--open'], '/work')).toThrow("Unknown option '--open'")
})

test('the Claude app starts the preview on the port the tool serves by default', () => {
  const launch: unknown = parseJson(readFileSync(join(import.meta.dirname, '..', '.claude', 'launch.json'), 'utf8'))
  const configurations = isRecord(launch) && Array.isArray(launch['configurations']) ? launch['configurations'].filter(isRecord) : []
  const preview = configurations.find(each => each['name'] === 'pane-preview')
  expect(preview?.['port']).toBe(DEFAULT_PORT)
  expect(preview?.['runtimeExecutable']).toBe('npm')
  expect(preview?.['runtimeArgs']).toEqual(['run', 'preview', '--', '--port', String(DEFAULT_PORT)])
})

// ---- what the page sends ------------------------------------------------------------------------------------------------

const RUN = 'run-1'
const from = (action: Json): Json => ({ ...action, run: RUN })

test('a click, a pick, typing, Enter, a scroll and a measurement each read back as the action the page meant', () => {
  expect(decodeAction(from({ kind: 'press', key: 'tab-mine' }), RUN)).toEqual({ kind: 'press', key: 'tab-mine' })
  expect(decodeAction(from({ kind: 'select', key: 'repo', value: 'all' }), RUN)).toEqual({ kind: 'select', key: 'repo', value: 'all' })
  expect(decodeAction(from({ kind: 'input', key: 'search', value: 'het', submit: false }), RUN)).toEqual({ kind: 'input', key: 'search', value: 'het', submit: false })
  expect(decodeAction(from({ kind: 'input', key: 'search', value: '', submit: true }), RUN)).toEqual({ kind: 'input', key: 'search', value: '', submit: true })
  expect(decodeAction(from({ kind: 'scroll', offset: 25 }), RUN)).toEqual({ kind: 'scroll', offset: 25 })
  expect(decodeAction(from({ kind: 'measured', draw: 3, rows: 80, bodyRows: 30, keyed: [{ key: 'tab-mine', top: 0, bottom: 1 }], resized: true }), RUN)).toEqual({
    kind: 'measured',
    draw: 3,
    measured: { rows: 80, keyed: [{ plugin: 'gitlab-pane', key: 'tab-mine', top: 0, bottom: 1 }] },
    bodyRows: 30,
    resized: true,
  })
})

test('a window measured as no rows tall is taken as one row, and a measurement that does not say it was resized was not', () => {
  expect(decodeAction(from({ kind: 'measured', draw: 1, rows: 0, bodyRows: 0, keyed: [] }), RUN)).toMatchObject({ bodyRows: 1, resized: false })
})

test('an action from a page another run of the preview served is refused, so it cannot press in this engine', () => {
  expect(() => decodeAction({ kind: 'press', key: 'merge-42', run: 'run-0' }, RUN)).toThrow('served by another run of the preview: reload it')
  expect(() => decodeAction({ kind: 'press', key: 'merge-42' }, RUN)).toThrow('served by another run of the preview')
})

test('an action with no key, an empty key, no text, a row that is no row or an unknown kind is refused', () => {
  expect(() => decodeAction(from({ kind: 'press' }), RUN)).toThrow('names no element key')
  expect(() => decodeAction(from({ kind: 'press', key: '' }), RUN)).toThrow('names no element key')
  expect(() => decodeAction(from({ kind: 'select', key: 'repo' }), RUN)).toThrow('a pick has no value')
  expect(() => decodeAction(from({ kind: 'input', key: 'search', value: 'het' }), RUN)).toThrow('Enter')
  expect(() => decodeAction(from({ kind: 'scroll', offset: -1 }), RUN)).toThrow('offset is not a row')
  expect(() => decodeAction(from({ kind: 'scroll', offset: 2.5 }), RUN)).toThrow('offset is not a row')
  expect(() => decodeAction(from({ kind: 'measured', draw: 1, rows: 3, bodyRows: 3, keyed: [{ key: 'a', top: 4, bottom: 2 }] }), RUN)).toThrow('ends above')
  expect(() => decodeAction(from({ kind: 'measured', draw: 1, rows: 3, bodyRows: 3 }), RUN)).toThrow('lists no elements')
  expect(() => decodeAction(from({ kind: 'merge', key: 'x' }), RUN)).toThrow('no action is called "merge"')
  expect(() => decodeAction(['press'], RUN)).toThrow('not an object')
})

// ---- who may ask ----------------------------------------------------------------------------------------------------------

test('a page this server served may watch and act', () => {
  expect(isOwnRequest('GET', { host: '127.0.0.1:4780' }, 4780)).toBe(true)
  expect(isOwnRequest('GET', { host: 'localhost:4780' }, 4780)).toBe(true)
  expect(isOwnRequest('POST', { host: 'localhost:4780', origin: 'http://localhost:4780', 'content-type': 'application/json' }, 4780)).toBe(true)
})

test('a request to another name that resolves here is refused, so a rebound site cannot read the pane', () => {
  expect(isOwnRequest('GET', { host: 'evil.example:4780' }, 4780)).toBe(false)
  expect(isOwnRequest('GET', { host: '127.0.0.1:4781' }, 4780)).toBe(false)
  expect(isOwnRequest('GET', {}, 4780)).toBe(false)
})

test('a press from another site’s page, from no page, or not sent as JSON is refused', () => {
  const host = '127.0.0.1:4780'
  expect(isOwnRequest('POST', { host, origin: 'https://evil.example', 'content-type': 'application/json' }, 4780)).toBe(false)
  expect(isOwnRequest('POST', { host, 'content-type': 'application/json' }, 4780)).toBe(false)
  expect(isOwnRequest('POST', { host, origin: `http://${host}`, 'content-type': 'text/plain' }, 4780)).toBe(false)
  expect(isOwnRequest('PUT', { host, origin: `http://${host}`, 'content-type': 'application/json' }, 4780)).toBe(false)
})

// ---- what the server answers --------------------------------------------------------------------------------------------

const SCREENS = join(import.meta.dirname, 'screens')
const site: Site = {
  port: 4780,
  where: '/work · main',
  page: '<!doctype html><title>page</title>',
  policy: policyFor('n0nce'),
  screens: SCREENS,
  fonts: new Set(readdirSync(join(SCREENS, 'fonts')).filter(name => name.endsWith('.woff2'))),
}
const own = { host: '127.0.0.1:4780' }
const posted = { ...own, origin: 'http://127.0.0.1:4780', 'content-type': 'application/json' }
const statusOf = (answer: Answer): number | string => (answer.kind === 'reply' ? answer.status : answer.kind)

test('the page is served with its policy and refuses to be framed', () => {
  const page = answerOf('GET', '/', own, site)
  expect(page.kind === 'reply' ? page.headers : {}).toMatchObject({ 'content-security-policy': site.policy, 'x-frame-options': 'DENY', 'cache-control': 'no-store' })
  expect(page.kind === 'reply' ? page.body : '').toBe(site.page)
})

test('a forged Host, another site’s press and a press not sent as JSON are refused before anything is served', () => {
  expect(statusOf(answerOf('GET', '/', { host: 'evil.example:4780' }, site))).toBe(403)
  expect(statusOf(answerOf('GET', '/events', { host: 'evil.example:4780' }, site))).toBe(403)
  expect(statusOf(answerOf('POST', '/act', { ...posted, origin: 'https://evil.example' }, site))).toBe(403)
  expect(statusOf(answerOf('POST', '/act', { ...posted, 'content-type': 'text/plain' }, site))).toBe(403)
})

test('a page it served watches the events and sends actions', () => {
  expect(statusOf(answerOf('GET', '/events', own, site))).toBe('events')
  expect(statusOf(answerOf('POST', '/act', posted, site))).toBe('act')
})

test('the stylesheet and the bundled fonts are served, and nothing else by a path', () => {
  const [font] = [...site.fonts]
  expect(statusOf(answerOf('GET', '/pane.css', own, site))).toBe(200)
  expect(statusOf(answerOf('GET', `/fonts/${font ?? ''}`, own, site))).toBe(200)
  expect(statusOf(answerOf('GET', '/fonts/..%2Fpane.css', own, site))).toBe(404)
  expect(statusOf(answerOf('GET', '/fonts/../pane_preview.ts', own, site))).toBe(404)
  expect(statusOf(answerOf('POST', '/', posted, site))).toBe(404)
})

test('a file that cannot be read, as when the branch changed under the preview, is a 404, not a broken answer', () => {
  expect(statusOf(answerOf('GET', '/pane.css', own, { ...site, screens: join(import.meta.dirname, 'no-such-folder') }))).toBe(404)
})

// ---- measurements -------------------------------------------------------------------------------------------------------

const measuredRows = (rows: number) => ({ rows, keyed: [] })

test('a drawing that waits takes the first measurement of it, and a second page’s is stale', async () => {
  const measurements = new Measurements()
  const draw = measurements.drawn()
  const waited = measurements.wait(draw, 1000)
  expect(measurements.take(draw, measuredRows(51), false)).toBe('waited')
  expect(measurements.take(draw, measuredRows(70), false)).toBe('stale')
  expect(await waited).toEqual(measuredRows(51))
})

test('the first measurement of the latest drawing that nothing waited for is unasked, so it is handed over', async () => {
  const measurements = new Measurements()
  expect(measurements.take(measurements.drawn(), measuredRows(51), false)).toBe('unasked')
  const late = measurements.drawn()
  expect(await measurements.wait(late, 5)).toBeNull()
  expect(measurements.take(late, measuredRows(40), false)).toBe('unasked')
})

test('a measurement of an older drawing changes nothing', () => {
  const measurements = new Measurements()
  const old = measurements.drawn()
  measurements.drawn()
  expect(measurements.take(old, measuredRows(51), false)).toBe('stale')
})

test('a window that changed size is measured again, and the drawing that asks for takes one answer, so two tabs settle', () => {
  const measurements = new Measurements()
  const draw = measurements.drawn()
  expect(measurements.take(draw, measuredRows(51), false)).toBe('unasked')
  expect(measurements.take(draw, measuredRows(60), true)).toBe('unasked')
  const next = measurements.drawn()
  expect(measurements.take(next, measuredRows(60), false)).toBe('unasked')
  expect(measurements.take(next, measuredRows(51), false)).toBe('stale')
})

// ---- the run ------------------------------------------------------------------------------------------------------------

const TREE = {
  type: 'Box',
  props: { flexDirection: 'column' },
  children: [{ type: 'Button', props: { key: 'tab-mine', label: 'Mine · 2' }, press: { plugin: 'gitlab-pane', handle: 1 } }],
}

/** An engine in this process: it answers each ask as a quiet pane would, and goes when told, or when asked `dieOn`. */
function standIn(dieOn: string | null = null): { readonly engine: Engine; readonly die: (how: string) => void } {
  let heard: (line: string) => void = () => undefined
  let gone: (how: string) => void = () => undefined
  const answers: Record<string, Json> = { ui_render: { tree: TREE }, ui_panes: { panes: [{ id: 'gitlab-pane', title: 'GitLab · Mine' }] } }
  const wire: Wire = {
    send: line => {
      const message: unknown = parseJson(line)
      const request = isRecord(message) && isRecord(message['request']) ? message['request'] : {}
      const subtype = text(request['subtype'])
      if (subtype === dieOn) {
        setTimeout(() => gone('exited (1)'), 0)
        return
      }
      const id = isRecord(message) ? message['request_id'] : ''
      const response = { subtype: 'success', request_id: id, response: answers[subtype] ?? {} }
      setTimeout(() => heard(JSON.stringify({ type: 'control_response', response })), 0)
    },
    onLine: listen => {
      heard = listen
    },
    onGone: listen => {
      gone = listen
    },
    close: () => gone('closed'),
  }
  return { engine: new Engine(wire, null), die: how => gone(how) }
}

/** A page watching: what it heard, by event, and whether it was let go. */
function watcher(): { readonly page: Watcher; readonly heard: string[]; readonly ended: () => boolean } {
  const heard: string[] = []
  let ended = false
  const page: Watcher = {
    write: said => heard.push(said.split('\n')[0]?.replace('event: ', '') ?? ''),
    end: () => {
      ended = true
    },
    on: () => undefined,
  }
  return { page, heard, ended: () => ended }
}

test('an engine that exits during a press ends the run, so the preview stops rather than serve a frozen pane', async () => {
  const { engine } = standIn('ui_press')
  const preview = new Preview(RUN)
  const running = preview.run(engine, 40)
  preview.take({ kind: 'press', key: 'tab-mine' })
  await expect(running).rejects.toBeInstanceOf(EngineGone)
  await expect(running).rejects.toThrow('the engine exited (1) during ui_press')
})

test('an engine that dies while the pane is quiet ends the run too', async () => {
  const { engine, die } = standIn()
  const running = new Preview(RUN).run(engine, 40)
  setTimeout(() => die('exited (137)'), 50)
  await expect(running).rejects.toThrow('the engine exited (137) during a quiet spell')
})

test('a press the engine refuses is a note, and the run goes on', async () => {
  const { engine, die } = standIn()
  const preview = new Preview(RUN)
  const running = preview.run(engine, 40)
  const notes: string[] = []
  // A page measures each drawing it is sent, as the real one does, so no drawing waits out its time.
  const measures = (said: string): void => {
    const frame: unknown = said.startsWith('event: frame\n') ? parseJson(said.slice(said.indexOf('data: ') + 'data: '.length)) : null
    if (isRecord(frame) && typeof frame['draw'] === 'number') {
      preview.take({ kind: 'measured', draw: frame['draw'], measured: { rows: 3, keyed: [] }, bodyRows: 40, resized: false })
    }
  }
  preview.watch({
    write: said => {
      notes.push(said)
      measures(said)
    },
    end: () => undefined,
    on: () => undefined,
  })
  preview.take({ kind: 'press', key: 'no-such-button' })
  setTimeout(() => die('exited (0)'), 300)
  await expect(running).rejects.toBeInstanceOf(EngineGone)
  expect(notes.some(said => said.includes("refused: no Button 'no-such-button' in the drawing"))).toBe(true)
})

test('a page first hears which run serves it, and one that comes after the engine stopped hears why and is let go', () => {
  const preview = new Preview(RUN)
  const early = watcher()
  preview.watch(early.page)
  expect(early.heard).toEqual(['hello'])
  preview.stop('the engine exited (1) during ui_press')
  expect(early.heard).toEqual(['hello', 'stopped'])
  expect(early.ended()).toBe(true)
  const late = watcher()
  preview.watch(late.page)
  expect(late.heard).toEqual(['hello', 'stopped'])
  expect(late.ended()).toBe(true)
})

// ---- the page -----------------------------------------------------------------------------------------------------------

test('a redraw keeps the typing when it draws the text it drew before or the mod echoes text the page sent', () => {
  expect(keepsTyping('abc', 'abc', [])).toBe(true)
  expect(keepsTyping('abc', 'abcdef', ['abcd', 'abcdef'])).toBe(true)
})

test('a redraw with text of the mod’s own replaces the typing, as after Enter clears the field', () => {
  expect(keepsTyping('hello', '', [])).toBe(false)
  expect(keepsTyping('abc', 'xyz', ['abcd'])).toBe(false)
})

test('the page runs only its own script, talks only to the server, and no other page may frame it', () => {
  const policy = policyFor('n0nce')
  expect(policy).toContain("script-src 'nonce-n0nce';")
  expect(policy).toContain("default-src 'none'")
  expect(policy).toContain("connect-src 'self'")
  expect(policy).toContain("frame-ancestors 'none'")
  expect(policy).toContain("form-action 'none'")
  expect(policy).toContain("base-uri 'none'")
})

test('the page’s script names its run and holds the typing rule, and is valid JavaScript', () => {
  const script = /<script nonce="n0nce">([\s\S]*)<\/script>/u.exec(pageShell('/work', null, 'n0nce', RUN))?.[1] ?? ''
  expect(script).toContain('const run = "run-1"')
  expect(script).toContain('const keepsTyping = function keepsTyping(')
  expect(() => new Script(script)).not.toThrow()
})

test('the page names its checkout, sets the width asked for, and runs only the script its nonce allows', () => {
  const page = pageShell('/work/<tree> · main', 520, 'n0nce', RUN)
  expect(page).toContain('<div id="where">/work/&lt;tree&gt; · main</div>')
  expect(page).toContain(':root { --pane-width: 520px; }')
  expect(page).toContain('<script nonce="n0nce">')
  expect(pageShell('/work', null, 'n0nce', RUN)).not.toContain('--pane-width:')
})
