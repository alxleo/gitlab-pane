// Talks to a server over stdio as ChatGPT's desktop app launches it: lists the tools and reads the panel by the URI the
// tool names, which needs no token. With --live it also calls the tool once, which reads your GitLab. Prints a verdict,
// never the MRs: no titles or project paths reach the terminal.
//
//   node chatgpt/probe.ts [--server chatgpt/package/dist/server.mjs] [--live]
import { strict as assert } from 'node:assert'
import { parseArgs } from 'node:util'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'

import { panelOf, stdioServer } from './host.ts'
import { panelUri } from './panel-uri.ts'
import { modelRows, panelIn, rowsOf } from './result.ts'

const { values } = parseArgs({
  options: { server: { type: 'string', default: new URL('./package/dist/server.mjs', import.meta.url).pathname }, live: { type: 'boolean', default: false } },
})

const client = new Client({ name: 'probe', version: '0.0.0' })
await client.connect(stdioServer(values.server))
try {
  const { uri, html } = await panelOf(client)
  assert.ok(html.includes('ui/initialize'), 'the panel bundle holds the ui/initialize handshake')
  // ChatGPT keeps a panel by its URI and draws a cached one with the new server's rows, so the URI must change whenever
  // the panel does: it names the panel's own hash.
  const listed = (await client.listResources()).resources.map(each => each.uri)
  assert.ok(listed.includes(uri), `the tool's panel ${uri} is among the resources the server lists`)
  assert.equal(uri, panelUri(html), "the panel's URI names the hash of the panel it serves")
  console.log(`ok: ${values.server} serves ${uri} (${Math.round(html.length / 1024)} kB), named by its hash`)

  if (values.live) {
    const result = await client.callTool({ name: 'list_my_mrs', arguments: {} })
    assert.notEqual(result.isError, true, `the tool read GitLab: ${JSON.stringify(result.content)}`)
    const mrs = modelRows(result.structuredContent)
    const rows = rowsOf(panelIn(result._meta))
    const fields = new Set(mrs.flatMap(mr => Object.keys(mr)))
    assert.equal(rows.length, mrs.length, 'the panel has a row for every MR the model is given')
    assert.ok(!fields.has('title'), 'the model is given no titles')
    console.log(`ok: ${mrs.length} MRs, the model sees ${[...fields].join(',')}`)
  }
} finally {
  await client.close()
}
