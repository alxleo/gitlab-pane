import { expect, test } from 'vitest'

import { liveHtml, pageHtml, type Node, type Scene } from './pane_html.ts'

const el = (type: string, props: Record<string, unknown> = {}, children: readonly (Node | string)[] = []): Node => ({ type, props, children, hover: null })

const repos = el('Select', {
  key: 'repo',
  label: '📁',
  value: 'b',
  options: [
    { value: 'a', label: 'All' },
    { value: 'b', label: 'web <app>' },
  ],
})
const search = el('Input', { key: 'search', label: '🔍', placeholder: 'find', value: 'het', submitLabel: 'find' })
const tree = el('Box', { flexDirection: 'column' }, [
  el('Button', { key: 'tab-mine', label: 'Mine · 2' }),
  el('Button', { label: 'unkeyed' }),
  repos,
  search,
  el('Link', { href: 'https://gitlab.example/x', label: 'open' }),
])
const scene: Scene = { name: 'live', title: 'GitLab', site: 'pane', hover: [], hoverKeys: [], tree }

test('a live page marks each keyed button, picker and field with its key and kind', () => {
  const { html } = liveHtml(tree)
  expect(html).toContain('<button class="btn" data-press-key="tab-mine" data-kind="button">Mine · 2</button>')
  expect(html).toContain('data-press-key="repo" data-kind="select"')
  expect(html).toContain('data-press-key="search" data-kind="input"')
})

test('a button with no key is drawn but not marked, as the desktop measures only what it can press', () => {
  expect(liveHtml(tree).html).toContain('<button class="btn">unkeyed</button>')
})

test('a live picker opens on its options, the picked one selected and every label escaped', () => {
  expect(liveHtml(tree).html).toContain('📁 <select><option value="a">All</option><option value="b" selected>web &lt;app&gt;</option></select>')
})

test('a live field holds the text it was drawn with and notes it, and a field of several rows is a text area', () => {
  expect(liveHtml(tree).html).toContain('<input class="field" placeholder="find" data-drawn="het" value="het">')
  expect(liveHtml(el('Input', { key: 'reply', value: 'a\nb', rows: 3 })).html).toContain('<textarea class="field" placeholder="" data-drawn="a\nb" rows="3">a\nb</textarea>')
})

test('a live link opens beside the page', () => {
  expect(liveHtml(tree).html).toContain('<a class="link" href="https://gitlab.example/x" target="_blank" rel="noopener noreferrer">open</a>')
})

test('a picture marks nothing and draws the picker closed and the field as text, as it did before the live page', () => {
  const { document } = pageHtml(scene, null)
  expect(document).not.toContain('data-press-key')
  expect(document).not.toContain('target=')
  expect(document).toContain(
    '<button class="btn">Mine · 2</button><button class="btn">unkeyed</button><span class="select">📁 web &lt;app&gt;<span class="caret">▾</span></span><span class="input"><span>🔍</span><span class="field" style="min-height: 1.5em">het</span></span><a class="link" href="https://gitlab.example/x">open</a>'
  )
})

test('what the renderer was not taught is named by both pages', () => {
  const odd = el('Box', {}, [el('Gauge'), el('Text', { glow: true }, ['x'])])
  expect([...liveHtml(odd).unknown].toSorted()).toEqual(['Gauge', 'Text.glow'])
  expect([...pageHtml({ ...scene, tree: odd }, null).unknown].toSorted()).toEqual(['Gauge', 'Text.glow'])
})
