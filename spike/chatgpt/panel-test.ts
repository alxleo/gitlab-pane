// The panel end to end without ChatGPT: headless Chromium opens the host page of `host.ts`, which reads the panel by the
// URI the tool names and drives it through ext-apps' AppBridge, as ChatGPT does. It fails on any error the panel throws or
// shows, in any frame.
//
//   node panel-test.ts          the server in memory against the made-up GitLab: every row drawn, then ✓ merge pressed
//                               twice on !405, which the made-up GitLab merges
//   node panel-test.ts --live   the packaged server (dist/server.mjs, `node build.ts` first) over stdio, as ChatGPT
//                               launches it, against your real GitLab: every row drawn, and nothing pressed
import { strict as assert } from 'node:assert'
import { parseArgs } from 'node:util'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { chromium } from 'playwright'

import { fakeGitLab } from './fake.ts'
import { serveHost } from './host.ts'
import { panelUri } from './panel-uri.ts'
import { createServer } from './server.ts'

const { values } = parseArgs({ options: { live: { type: 'boolean', default: false } } })
const gitlab = fakeGitLab()
const client = new Client({ name: 'panel-test', version: '0' })
if (values.live) {
  const env = Object.fromEntries(Object.entries(process.env).flatMap(([name, value]) => (value !== undefined ? [[name, value]] : [])))
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [new URL('./dist/server.mjs', import.meta.url).pathname], env }))
} else {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await (await createServer(() => gitlab)).connect(serverSide)
  await client.connect(clientSide)
}

const host = await serveHost(client)
const browser = await chromium.launch()
const errors: string[] = []
try {
  const page = await browser.newPage()
  page.on('pageerror', error => errors.push(`thrown: ${error.message}`))
  page.on('console', message => {
    if (message.type() === 'error') {
      errors.push(`console: ${message.text()}`)
    }
  })
  await page.goto(host.url)
  const panel = page.frameLocator('iframe')
  const status = panel.locator('#status')
  // The panel says `read hh:mm` once it has drawn a call's result, and the failure's words otherwise.
  await status
    .filter({ hasText: /^read \d/ })
    .waitFor({ timeout: 30_000 })
    .catch(async () => {
      errors.push(`status: ${await status.textContent()}`)
    })
  assert.deepEqual(errors, [], 'the panel draws the rows without an error')

  const listed = await client.callTool({ name: 'list_my_mrs', arguments: {} })
  const content = listed.structuredContent
  const expected = typeof content === 'object' && content !== null && 'mrs' in content && Array.isArray(content.mrs) ? content.mrs.length : -1
  const cards = panel.locator('li.card')
  assert.equal(await cards.count(), expected, 'a card for every MR the tool lists')
  assert.equal(await panel.locator('#count').textContent(), String(expected))
  const edges = await cards.evaluateAll(nodes => nodes.map(node => [...node.classList].find(name => name.startsWith('edge-')) ?? 'none'))
  assert.ok(!edges.includes('none'), 'every card has a coloured edge')
  assert.match(host.uri, /^ui:\/\/gitlab-pane\/panel-[0-9a-f]{12}\.html$/, "the panel's URI names its hash")

  if (!values.live) {
    assert.equal(host.uri, panelUri((await client.readResource({ uri: host.uri })).contents.flatMap(each => ('text' in each ? [each.text] : [])).join('')))
    const move = panel.locator('li.card', { hasText: '!405' }).locator('button.move')
    assert.equal(await move.textContent(), '✓ merge')
    await move.click()
    await panel.locator('li.card', { hasText: '!405' }).locator('button.move.armed').waitFor()
    assert.deepEqual(gitlab.writes, [], 'one press sends nothing')
    await panel.locator('li.card', { hasText: '!405' }).locator('button.move.armed').click()
    await status.filter({ hasText: '!405 merged' }).waitFor({ timeout: 15_000 })
    assert.deepEqual(gitlab.writes, ['merge !405 on head-405'])
    assert.equal(await panel.locator('li.card', { hasText: '!405' }).count(), 0, 'the merged MR leaves the panel')
    assert.deepEqual(errors, [], 'nothing failed while pressing')
  }
  console.log(`ok: ${expected} cards drawn from ${host.uri}, each with an edge${values.live ? ' (live, nothing pressed)' : '; ✓ merge on !405 armed, then merged'}`)
} finally {
  await browser.close()
  await host.close()
  await client.close()
}
