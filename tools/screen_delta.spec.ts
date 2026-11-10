import { expect, test } from 'vitest'

import { deltaMarks } from './screen_delta.ts'
import type { Drawn } from './screen_delta.ts'

const box = (props: Record<string, unknown>, ...children: (Drawn | string)[]): Drawn => ({ type: 'Box', props, children })
const words = (text: string, props: Record<string, unknown> = {}): Drawn => ({ type: 'Text', props, children: [text] })

/** The marks as words, by the first string each marked element draws, for reading a test at a glance. */
const said = (tree: Drawn, base: Drawn) => {
  const first = (node: Drawn): string => node.children.map(child => (typeof child === 'string' ? child : first(child))).find(text => text !== '') ?? node.type
  return [...deltaMarks(tree, base)].map(([node, mark]) => `${mark}: ${first(node)}`)
}

test('an unchanged drawing is one faded whole', () => {
  const tree = box({ key: 'pane' }, words('Mine · 5'), words('updated just now'))
  expect(said(tree, tree)).toEqual(['same: Mine · 5'])
})

test('a new element stands out, and the ones beside it that were drawn before fade', () => {
  const base = box({ key: 'row' }, words('Tax rules'), words('3h'))
  const tree = box({ key: 'row' }, words('Tax rules'), words('needs 1 approval', { dimColor: true }), words('3h'))
  expect(said(tree, base)).toEqual(['same: Tax rules', 'changed: needs 1 approval', 'same: 3h'])
})

test('an element that only moved is the same element, so a change above it does not light everything below', () => {
  const footer = box({}, words('refresh'), words('wake Claude: on'))
  const base = box({ key: 'pane' }, box({ key: 'a' }, words('first'), words('second line')), footer)
  const tree = box({ key: 'pane' }, box({ key: 'a' }, words('first')), footer)
  expect(said(tree, base)).toEqual(['same: first', 'same: refresh'])
})

test('changed words mark their element, not the container that holds it', () => {
  const base = box({ key: 'row' }, words('discussions not resolved', { color: 'warning' }))
  const tree = box({ key: 'row' }, words('2 open threads', { color: 'warning' }))
  expect(said(tree, base)).toEqual(['changed: 2 open threads'])
})

test('an element whose own props changed is marked whole, its children with it', () => {
  const base = box({ key: 'row', borderColor: 'grey' }, words('Tax rules'))
  const tree = box({ key: 'row', borderColor: 'green' }, words('Tax rules'))
  expect(said(tree, base)).toEqual(['changed: Tax rules'])
})
