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
const search = el('Input', { key: 'search', label: '🔍', placeholder: 'find', value: 'abc', submitLabel: 'find' })
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

test('a region is drawn as empty room, its module and data taken and none of them named as untaught', () => {
  const region = el('Client', { key: 'hint-mr-w', module: 'hooks/hint-wait.tsx', props: { lines: ['opens the MR'] }, width: '100%', height: 1 })
  const { html, unknown } = liveHtml(el('Box', {}, [region]))
  expect(html).toContain('<span class="client"></span>')
  expect(html).not.toContain('opens the MR')
  expect([...unknown]).toEqual([])
})

test('a button with no key is drawn but not marked, as the desktop measures only what it can press', () => {
  expect(liveHtml(tree).html).toContain('<button class="btn">unkeyed</button>')
})

test('a live picker opens on its options, the picked one selected and every label escaped', () => {
  expect(liveHtml(tree).html).toContain('📁 <select><option value="a">All</option><option value="b" selected>web &lt;app&gt;</option></select>')
})

test('a live field holds the text it was drawn with and notes it, and a field of several rows is a text area', () => {
  expect(liveHtml(tree).html).toContain('<input class="field" placeholder="find" data-drawn="abc" value="abc">')
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
    '<button class="btn">Mine · 2</button><button class="btn">unkeyed</button><span class="select">📁 web &lt;app&gt;<span class="caret">▾</span></span><span class="input"><span>🔍</span><span class="field" style="min-height: 1.5em">abc</span></span><a class="link" href="https://gitlab.example/x">open</a>'
  )
})

test('a link in live Markdown opens beside the page, and a picture’s does not', () => {
  const said = el('Markdown', { text: 'see [the job](https://gitlab.example/j)' })
  expect(liveHtml(said).html).toContain('<a href="https://gitlab.example/j" target="_blank" rel="noopener noreferrer">the job</a>')
  expect(pageHtml({ ...scene, tree: said }, null).document).toContain('<a href="https://gitlab.example/j">the job</a>')
})

test('HTML written in Markdown is drawn as its text on both pages', () => {
  const said = el('Markdown', { text: '<img src=x onerror=alert(1)>' })
  expect(liveHtml(said).html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  expect(liveHtml(said).html).not.toContain('<img')
  expect(pageHtml({ ...scene, tree: said }, null).document).not.toContain('<img')
})

test('a key, a placeholder, a drawn text and an address cannot leave their attribute', () => {
  const odd = el('Box', {}, [
    el('Button', { key: 'a"><b', label: 'x' }),
    el('Input', { key: 'f', placeholder: '"><i>', value: 'say "hi"' }),
    el('Select', { key: 's', options: [{ value: '"v"', label: 'v' }] }),
    el('Link', { href: 'https://gitlab.example/"><u>', label: 'go' }),
  ])
  const { html } = liveHtml(odd)
  expect(html).toContain('data-press-key="a&quot;&gt;&lt;b"')
  expect(html).toContain('placeholder="&quot;&gt;&lt;i&gt;" data-drawn="say &quot;hi&quot;" value="say &quot;hi&quot;"')
  expect(html).toContain('<option value="&quot;v&quot;" selected>v</option>')
  expect(html).toContain('href="https://gitlab.example/&quot;&gt;&lt;u&gt;"')
  expect(html).not.toMatch(/<[biu]>/u)
})

test('an Svg the mod drew is drawn as it is, at its size in pixels', () => {
  const picture = el('Svg', { source: '<svg viewBox="0 0 4 4"></svg>', alt: 'pipeline', width: 40.6, height: 12 })
  expect(liveHtml(picture).html).toBe('<div class="svg" role="img" aria-label="pipeline" style="width: 40px; height: 12px"><svg viewBox="0 0 4 4"></svg></div>')
})

test('what the renderer was not taught is named by both pages', () => {
  const odd = el('Box', {}, [el('Gauge'), el('Text', { glow: true }, ['x'])])
  expect([...liveHtml(odd).unknown].toSorted()).toEqual(['Gauge', 'Text.glow'])
  expect([...pageHtml({ ...scene, tree: odd }, null).unknown].toSorted()).toEqual(['Gauge', 'Text.glow'])
})
