// The panel end to end without ChatGPT: headless Chromium opens the host page of `host.ts`, which reads the panel by the
// URI the tool names and drives it through ext-apps' AppBridge, as ChatGPT does. It fails on any error the panel throws or
// shows, in any frame.
//
//   node --import ./tools/resolve_ts.ts chatgpt/panel-test.ts          the server in memory against the made-up GitLab: every row drawn, then ✓ merge
//                                       pressed twice on !405, which the made-up GitLab merges
//   node --import ./tools/resolve_ts.ts chatgpt/panel-test.ts --live   the packaged server (chatgpt/package, `node --import ./tools/resolve_ts.ts chatgpt/build.ts` first)
//                                       over stdio, as ChatGPT launches it, against your real GitLab: every row drawn,
//                                       and nothing pressed
import { strict as assert } from 'node:assert'
import { parseArgs } from 'node:util'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { chromium } from 'playwright'

import { fakeGitLab } from './fake.ts'
import { panelOf, serveHost, stdioServer } from './host.ts'
import { panelHtml } from './panel-build.ts'
import { panelUri } from './panel-uri.ts'
import { modelRows } from './result.ts'
import { createServer } from './server.ts'

const { values } = parseArgs({ options: { live: { type: 'boolean', default: false } } })
const gitlab = fakeGitLab()
const client = new Client({ name: 'panel-test', version: '0' })
if (values.live) {
  await client.connect(stdioServer(new URL('./package/dist/server.mjs', import.meta.url).pathname))
} else {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await createServer({ html: await panelHtml(), connectTo: () => gitlab }).connect(serverSide)
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
    .filter({ hasText: /^read \d/u })
    .waitFor({ timeout: 30_000 })
    .catch(async () => {
      errors.push(`status: ${await status.textContent()}`)
    })
  assert.deepEqual(errors, [], 'the panel draws the rows without an error')

  const listed = await client.callTool({ name: 'list_my_mrs', arguments: {} })
  const expected = modelRows(listed.structuredContent).length
  assert.ok(expected > 0, 'the tool lists MRs')
  const cards = panel.locator('li.card')
  assert.equal(await cards.count(), expected, 'a card for every MR the tool lists')
  assert.equal(await panel.locator('#count').textContent(), String(expected))
  const edges = await cards.evaluateAll(nodes => nodes.map(node => [...node.classList].find(name => name.startsWith('edge-')) ?? 'none'))
  assert.ok(!edges.includes('none'), 'every card has a coloured edge')
  // Every card is drawn alike: one that passed and waits on an approval has its link and faces on a second line too.
  assert.equal(await panel.locator('li.card .line2').count(), expected, 'every card has its second line')
  assert.equal(await panel.locator('li.card', { hasText: '!414' }).locator('.line2').count(), 1, 'the MR waiting on an approval has its second line')
  assert.equal(host.uri, panelUri((await panelOf(client)).html), "the panel's URI names its hash")

  if (!values.live) {
    const move = panel.locator('li.card', { hasText: '!405' }).locator('button.move')
    assert.equal(await move.textContent(), '✓ merge')
    await move.click()
    await panel.locator('li.card', { hasText: '!405' }).locator('button.move.armed').waitFor()
    assert.deepEqual(gitlab.writes, [], 'one press sends nothing')
    await panel.locator('li.card', { hasText: '!405' }).locator('button.move.armed').click()
    await status.filter({ hasText: '!405 merged' }).waitFor({ timeout: 15_000 })
    assert.deepEqual(gitlab.writes, ['405@head-405'], 'one merge, on the head the row was read on')
    assert.equal(await panel.locator('li.card', { hasText: '!405' }).count(), 0, 'the merged MR leaves the panel')
    assert.deepEqual(errors, [], 'nothing failed while pressing')
  }
  console.log(`ok: ${expected} cards drawn from ${host.uri}, each with an edge${values.live ? ' (live, nothing pressed)' : '; ✓ merge on !405 armed, then merged'}`)
} finally {
  await browser.close()
  await host.close()
  await client.close()
}
