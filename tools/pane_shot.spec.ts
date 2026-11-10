import { expect, test } from 'vitest'

import { chooseWindow, hasMoved, inPixels, isTitle, likeness, locate, lua, onScreen, parseCommand, parking, plain, sameSession, strokes, target } from './pane_shot.ts'
import type { Desk, Line, Located, Window } from './pane_shot.ts'

/** A window like the desktop app's: 1,000 by 800 points, its corner at 100,50 on the screen. */
const window: Window = { id: 7, app: 'Claude', bounds: { x: 100, y: 50, w: 1000, h: 800 } }
const line = (read: string, x: number, y: number, w = 80, h = 14): Line => ({ text: read, x, y, w, h })

/** What a read of that window finds, in screen points: a session header, a transcript, and the pane on the right. */
const lines: Line[] = [
  line('Fix the inbox ▾', 300, 60, 160),
  line('Ask', 120, 62, 30),
  line('GitLab', 300, 400),
  line('the GitLab pane draws cards', 300, 420, 200),
  line('GitLab · Mine', 800, 70, 110),
  line('Mine · 5', 790, 120),
  line('Mine', 790, 160, 40),
  line('read whole', 790, 300),
  line('read whole thread', 790, 200, 120),
]

const pane = (): Located => {
  const found = locate(lines, window, 'GitLab')
  if (found === null) {
    throw new Error('the pane was not found')
  }
  return found
}

test('a read of a frame twice the window size lands in screen points from the window corner', () => {
  const read = { width: 2000, lines: [line('GitLab · Mine', 1400, 40, 220, 28)] }
  expect(onScreen(read, window)).toEqual([line('GitLab · Mine', 800, 70, 110, 14)])
})

test('the header reads the title alone or followed by the view, never a word that starts with it', () => {
  expect(isTitle(' GitLab ', 'GitLab')).toBe(true)
  expect(isTitle('GitLab · !57', 'GitLab')).toBe(true)
  expect(isTitle('GitLabs', 'GitLab')).toBe(false)
  expect(isTitle('my GitLab', 'GitLab')).toBe(false)
})

test('the pane is found by its header in the top band on the right, not by the same word in the transcript', () => {
  expect(pane()).toEqual({ pane: { x: 786, y: 58, w: 310, h: 788 }, titleAt: { x: 800, y: 70, w: 110, h: 14 }, session: 'Fix the inbox ▾' })
})

test('a window showing no pane header finds none, even with the title in its transcript', () => {
  expect(
    locate(
      lines.filter(each => !each.text.startsWith('GitLab ·')),
      window,
      'GitLab'
    )
  ).toBeNull()
})

test('the session is the longest line in the header band left of the pane, and empty when none is read', () => {
  expect(pane().session).toBe('Fix the inbox ▾')
  expect(locate([line('GitLab', 800, 70)], window, 'GitLab')?.session).toBe('')
})

test('reading keeps letters and digits in any script, lower case', () => {
  expect(plain('Read whole ▸ (3)')).toBe('readwhole3')
  expect(plain('Überprüfen · 2')).toBe('überprüfen2')
  expect(plain('↻ 🔔')).toBe('')
})

test('likeness is twice the characters shared in order over both lengths', () => {
  expect(likeness('', '')).toBe(1)
  expect(likeness('abcd', 'abcd')).toBe(1)
  expect(likeness('abcd', 'wxyz')).toBe(0)
  expect(likeness('abcd', 'abxd')).toBe(0.75)
})

test('a session header whose ▾ reads as V and then as v is the same session; another session is not', () => {
  expect(sameSession('Fix the inbox V', 'Fix the inbox v')).toBe(true)
  expect(sameSession('Fix the inbox ▾', 'Fix the inbox V')).toBe(true)
  expect(sameSession('Fix the inbox', 'Fix the index')).toBe(false)
  expect(sameSession('Fix the inbox', 'Release notes')).toBe(false)
})

test('the pane moved when its title is more than four points from where it was', () => {
  const was = { x: 800, y: 70, w: 110, h: 14 }
  expect(hasMoved(was, { ...was, x: 804, y: 66, w: 140 })).toBe(false)
  expect(hasMoved(was, { ...was, x: 805 })).toBe(true)
  expect(hasMoved(was, { ...was, y: 75 })).toBe(true)
})

test('a press goes to an exact read before a partial one above it, and to the topmost of equals', () => {
  expect(target(lines, pane(), 'read whole')).toEqual({ line: 'read whole', at: { x: 830, y: 307 } })
  expect(target(lines, pane(), 'Mine')).toEqual({ line: 'Mine', at: { x: 810, y: 167 } })
  expect(target([...lines, line('Mine', 790, 140, 40)], pane(), 'mine')?.at).toEqual({ x: 810, y: 147 })
})

test('a press never lands on the header, outside the pane, or on text it does not read', () => {
  expect(target(lines, pane(), 'GitLab')).toBeNull()
  expect(target(lines, pane(), 'Fix the inbox')).toBeNull()
  expect(target(lines, pane(), 'merge')).toBeNull()
  expect(target(lines, pane(), '🔔')).toBeNull()
  expect(target([line('Mine', 790, 900)], pane(), 'Mine')).toBeNull()
})

test('a scroll is whole wheel steps of 400 pixels, at least one, down when negative', () => {
  expect(strokes(20_000)).toEqual({ count: 50, step: 400 })
  expect(strokes(-1000)).toEqual({ count: 2, step: -400 })
  expect(strokes(-100)).toEqual({ count: 1, step: -400 })
})

test('the pointer parks on the header, past the title', () => {
  expect(parking(pane())).toEqual({ x: 970, y: 77 })
})

test('the pane is cut from a frame at twice the scale, offset from the window corner', () => {
  expect(inPixels(pane().pane, window, 2)).toEqual({ x: 1372, y: 16, w: 620, h: 1576 })
})

const desk = (front: number, ...windows: Window[]): Desk => ({ windows, front })
const work: Window = { id: 9, app: 'Claude Work', bounds: { x: 0, y: 0, w: 1200, h: 900 } }
const small: Window = { id: 3, app: 'Claude', bounds: { x: 0, y: 0, w: 400, h: 300 } }
const chrome: Window = { id: 1, app: 'Google Chrome', bounds: { x: 0, y: 0, w: 2000, h: 1400 } }

const app = (name: string | null) => ({ app: name, window: null })

test('the window looked in is the largest of the app named', () => {
  expect(chooseWindow(desk(1, chrome, small, window, work), app('Claude')).id).toBe(7)
})

test('a window named by its number is the one looked in, whatever its size, and only in the app named', () => {
  expect(chooseWindow(desk(1, chrome, small, window, work), { app: null, window: 3 }).id).toBe(3)
  expect(chooseWindow(desk(1, chrome, small, window, work), { app: 'Claude', window: 3 }).id).toBe(3)
  expect(() => chooseWindow(desk(1, chrome, small), { app: 'Claude Work', window: 3 })).toThrow('no window 3 of Claude Work on screen')
  expect(() => chooseWindow(desk(1, chrome), { app: null, window: 3 })).toThrow('no window 3 on screen')
})

test('with no app named, the Claude app in front is chosen, or the only one running', () => {
  expect(chooseWindow(desk(9, window, work), app(null)).id).toBe(9)
  expect(chooseWindow(desk(1, chrome, small, window), app(null)).id).toBe(7)
})

test('with no app named, two Claude apps behind another and none at all are refused with what to do', () => {
  expect(() => chooseWindow(desk(1, chrome, window, work), app(null))).toThrow('both Claude and Claude Work are open: say which with --app')
  expect(() => chooseWindow(desk(1, chrome), app(null))).toThrow('no Claude or Claude Work window on screen')
  expect(() => chooseWindow(desk(1, chrome), app('Claude Work'))).toThrow('no Claude Work window on screen')
})

test('only whole finite numbers go into the Lua', () => {
  expect(lua(12.6)).toBe('13')
  expect(lua(-400)).toBe('-400')
  expect(() => lua(Number.NaN)).toThrow('not a number')
  expect(() => lua(Number.POSITIVE_INFINITY)).toThrow('not a number')
})

test('no command, or --help, asks for the help', () => {
  expect(parseCommand([])).toEqual({ kind: 'help' })
  expect(parseCommand(['capture', '--help'])).toEqual({ kind: 'help' })
  expect(parseCommand(['-h'])).toEqual({ kind: 'help' })
})

test('a capture takes its file, where to scroll, and the pane, app, window and session to find', () => {
  const argv = ['capture', '-o', '/tmp/p.png', '--to', 'bottom', '--app', 'Claude Work', '--window', '88', '--session', 'Fix the inbox', '--raise']
  expect(parseCommand(argv)).toEqual({
    kind: 'capture',
    out: '/tmp/p.png',
    to: 'bottom',
    where: { pane: 'GitLab', app: 'Claude Work', window: 88, session: 'Fix the inbox', raise: true },
  })
})

test('a press takes what each button reads, in order, and its file only if asked', () => {
  expect(parseCommand(['press', 'read whole', 'Mine'])).toEqual({
    kind: 'press',
    presses: ['read whole', 'Mine'],
    out: null,
    where: { pane: 'GitLab', app: null, window: null, session: null, raise: false },
  })
})

test('a tour takes its folder and how many pages, twelve by default', () => {
  expect(parseCommand(['tour', '-o', '/tmp/shots', '--pages', '3'])).toMatchObject({ kind: 'tour', out: '/tmp/shots', pages: 3 })
  expect(parseCommand(['tour', '-o', '/tmp/shots'])).toMatchObject({ pages: 12 })
})

test('arguments that cannot be meant are refused with what is wrong', () => {
  expect(() => parseCommand(['capture'])).toThrow('capture needs -o')
  expect(() => parseCommand(['capture', '-o', 'p.png', '--to', 'middle'])).toThrow('--to is here, top or bottom, not middle')
  expect(() => parseCommand(['capture', '-o', 'p.png', 'extra'])).toThrow('capture takes no extra')
  expect(() => parseCommand(['press'])).toThrow('press needs what a button reads')
  expect(() => parseCommand(['press', '↻'])).toThrow('nothing to read in "↻"')
  expect(() => parseCommand(['tour', '-o', 'shots', '--pages', '0'])).toThrow('--pages is a whole number of at least 1, not 0')
  expect(() => parseCommand(['windows', '--window', 'big'])).toThrow("--window is a window's number from `windows`, not big")
  expect(() => parseCommand(['shoot'])).toThrow('no command shoot')
  expect(() => parseCommand(['capture', '--colour', 'red'])).toThrow("Unknown option '--colour'")
})
