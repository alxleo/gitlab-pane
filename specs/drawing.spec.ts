import { expect, test } from 'vitest'

import { CONTROL, HINT_ROOM, LINK, measure, opens } from '../hooks/drawing'
import { markWord, STATUS_WORD } from '../hooks/status'

import type { CiStatus } from '../types'

/** Plain printable text: a description's chip is as many cells wide as it has characters. */
const PLAIN = /^[ -~]+$/u

const statuses = Object.keys(STATUS_WORD).filter((status): status is CiStatus => status in STATUS_WORD)

test('every description a symbol shows under the pointer is plain text that fits the room a narrow pane leaves it', () => {
  const links = Object.keys(LINK).filter((link): link is keyof typeof LINK => link in LINK)
  const said = [...Object.values(CONTROL).map(control => control.hint), ...links.map(opens), ...statuses.map(markWord), markWord(undefined)]
  for (const words of said) {
    expect(words).toMatch(PLAIN)
    expect(words.length).toBeLessThanOrEqual(HINT_ROOM)
  }
})

test('a link mark says what it opens, and a pipeline mark its status, or that there is none', () => {
  expect(opens('mr')).toBe('opens the MR')
  expect(opens('commit')).toBe('opens the commit a merge takes')
  expect(markWord('success')).toBe('passed')
  expect(markWord(undefined)).toBe('no pipeline')
})

test('a tree is measured as the app receives it: each element in a hover group and each client region as the engine stamps it', () => {
  const plain = { type: 'Box', props: { key: 'a' }, children: [] }
  const grouped = { type: 'Box', props: { key: 'a', hover: { scope: 'hint-x' } }, children: [] }
  const region = { type: 'Client', props: { key: 'w', module: './hint-wait.tsx' } }
  // As the engine hands them to the app (read off `ui.drawn()`): the group's owner, the region's owner and its path.
  const groupedDrawn = { ...grouped, group: { plugin: 'gitlab-pane' } }
  const regionDrawn = { type: 'Client', props: { key: 'w', module: 'hooks/hint-wait.tsx' }, client: { plugin: 'gitlab-pane' } }
  expect(measure(plain)).toBe(JSON.stringify(plain).length)
  expect(measure(grouped)).toBe(JSON.stringify(groupedDrawn).length)
  expect(measure([grouped, grouped])).toBe(JSON.stringify([groupedDrawn, groupedDrawn]).length)
  expect(measure(region)).toBe(JSON.stringify(regionDrawn).length)
})

test('each control says something of its own, so two symbols never share a description', () => {
  const hints = Object.values(CONTROL).map(control => control.hint)
  expect(new Set(hints).size).toBe(hints.length)
})
