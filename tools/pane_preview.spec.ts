import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Script } from 'node:vm'

import { expect, test } from 'vitest'

import { isRecord, parseJson } from '../hooks/decode.ts'
import { DEFAULT_PORT, Measurements, decodeAction, isOwnRequest, keepsTyping, pageShell, parseCommand, policyFor } from './pane_preview.ts'

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

test('a click, a pick, typing, Enter, a scroll and a measurement each read back as the action the page meant', () => {
  expect(decodeAction({ kind: 'press', key: 'tab-mine' })).toEqual({ kind: 'press', key: 'tab-mine' })
  expect(decodeAction({ kind: 'select', key: 'repo', value: 'all' })).toEqual({ kind: 'select', key: 'repo', value: 'all' })
  expect(decodeAction({ kind: 'input', key: 'search', value: 'het', submit: false })).toEqual({ kind: 'input', key: 'search', value: 'het', submit: false })
  expect(decodeAction({ kind: 'input', key: 'search', value: '', submit: true })).toEqual({ kind: 'input', key: 'search', value: '', submit: true })
  expect(decodeAction({ kind: 'scroll', offset: 25 })).toEqual({ kind: 'scroll', offset: 25 })
  expect(decodeAction({ kind: 'measured', draw: 3, rows: 80, bodyRows: 30, keyed: [{ key: 'tab-mine', top: 0, bottom: 1 }] })).toEqual({
    kind: 'measured',
    draw: 3,
    measured: { rows: 80, keyed: [{ plugin: 'gitlab-pane', key: 'tab-mine', top: 0, bottom: 1 }] },
    bodyRows: 30,
  })
})

test('a window measured as no rows tall is taken as one row', () => {
  expect(decodeAction({ kind: 'measured', draw: 1, rows: 0, bodyRows: 0, keyed: [] })).toMatchObject({ bodyRows: 1 })
})

test('an action with no key, an empty key, no text, a row that is no row or an unknown kind is refused', () => {
  expect(() => decodeAction({ kind: 'press' })).toThrow('names no element key')
  expect(() => decodeAction({ kind: 'press', key: '' })).toThrow('names no element key')
  expect(() => decodeAction({ kind: 'select', key: 'repo' })).toThrow('a pick has no value')
  expect(() => decodeAction({ kind: 'input', key: 'search', value: 'het' })).toThrow('Enter')
  expect(() => decodeAction({ kind: 'scroll', offset: -1 })).toThrow('offset is not a row')
  expect(() => decodeAction({ kind: 'scroll', offset: 2.5 })).toThrow('offset is not a row')
  expect(() => decodeAction({ kind: 'measured', draw: 1, rows: 3, bodyRows: 3, keyed: [{ key: 'a', top: 4, bottom: 2 }] })).toThrow('ends above')
  expect(() => decodeAction({ kind: 'measured', draw: 1, rows: 3, bodyRows: 3 })).toThrow('lists no elements')
  expect(() => decodeAction({ kind: 'merge', key: 'x' })).toThrow('no action is called "merge"')
  expect(() => decodeAction(['press'])).toThrow('not an object')
})

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

test('a redraw keeps the typing when it draws the text it drew before or the mod echoes text the page sent', () => {
  expect(keepsTyping('abc', 'abc', [])).toBe(true)
  expect(keepsTyping('abc', 'abcdef', ['abcd', 'abcdef'])).toBe(true)
})

test('a redraw with text of the mod’s own replaces the typing, as after Enter clears the field', () => {
  expect(keepsTyping('hello', '', [])).toBe(false)
  expect(keepsTyping('abc', 'xyz', ['abcd'])).toBe(false)
})

const measuredRows = (rows: number) => ({ rows, keyed: [] })

test('a drawing that waits takes the first measurement of it, and a second page’s is stale', async () => {
  const measurements = new Measurements()
  const draw = measurements.drawn()
  const waited = measurements.wait(draw, 1000)
  expect(measurements.take(draw, measuredRows(51))).toBe('waited')
  expect(measurements.take(draw, measuredRows(70))).toBe('stale')
  expect(await waited).toEqual(measuredRows(51))
})

test('the first measurement of the latest drawing that nothing waited for is unasked, so it is handed over', async () => {
  const measurements = new Measurements()
  expect(measurements.take(measurements.drawn(), measuredRows(51))).toBe('unasked')
  const late = measurements.drawn()
  expect(await measurements.wait(late, 5)).toBeNull()
  expect(measurements.take(late, measuredRows(40))).toBe('unasked')
})

test('a measurement of an older drawing changes nothing', () => {
  const measurements = new Measurements()
  const old = measurements.drawn()
  measurements.drawn()
  expect(measurements.take(old, measuredRows(51))).toBe('stale')
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

test('the page’s script, with the typing rule written into it, is valid JavaScript', () => {
  const script = /<script nonce="n0nce">([\s\S]*)<\/script>/u.exec(pageShell('/work', null, 'n0nce'))?.[1] ?? ''
  expect(script).toContain('const keepsTyping = function keepsTyping(')
  expect(() => new Script(script)).not.toThrow()
})

test('the page names its checkout, sets the width asked for, and runs only the script its nonce allows', () => {
  const page = pageShell('/work/<tree> · main', 520, 'n0nce')
  expect(page).toContain('<div id="where">/work/&lt;tree&gt; · main</div>')
  expect(page).toContain(':root { --pane-width: 520px; }')
  expect(page).toContain('<script nonce="n0nce">')
  expect(pageShell('/work', null, 'n0nce')).not.toContain('--pane-width:')
})
