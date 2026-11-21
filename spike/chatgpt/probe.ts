// Talks to server.ts over stdio as ChatGPT's desktop app would launch it: lists the tools, reads the panel resource and
// calls the tool once. Prints a verdict, not the MRs: no titles or project paths reach the terminal.
import { strict as assert } from 'node:assert'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

import { panelUri } from './panel-uri.ts'

const client = new Client({ name: 'probe', version: '0.0.0' })
await client.connect(
  // The server to launch: the sources by default, or a packaged one (`node probe.ts dist/server.mjs`).
  new StdioClientTransport({
    command: process.execPath,
    args: [process.argv[2] ?? new URL('./server.ts', import.meta.url).pathname],
    env: { ...process.env } as Record<string, string>,
  })
)

const { tools } = await client.listTools()
const tool = tools.find(each => each.name === 'list_my_mrs')
console.log('tool', tool?.name, 'entrypoints', JSON.stringify(tool?._meta?.['openai/ui']), 'resource', JSON.stringify(tool?._meta?.ui))

const uri = String((tool?._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri ?? '')
const resource = await client.readResource({ uri })
const first = resource.contents[0]
const html = first !== undefined && 'text' in first ? first.text : ''
console.log('panel', first?.mimeType, `${Math.round(html.length / 1024)} kB`, html.includes('ui/initialize') ? 'bundle has the ui/initialize handshake' : 'NO handshake in bundle')
// ChatGPT keeps a panel by its URI and draws a cached one with the new server's rows, so a URI must change whenever the
// panel does: it names the panel's own hash. A fixed URI kept the panel from before a change, which then failed on rows
// the new server sent.
const listed = (await client.listResources()).resources.map(each => each.uri)
assert.ok(listed.includes(uri), `the tool's panel ${uri} is among the resources the server lists`)
assert.equal(uri, panelUri(html), "the panel's URI names the hash of the panel it serves")
console.log('panel uri', uri, 'names its contents')

const result = await client.callTool({ name: 'list_my_mrs', arguments: {} })
const mrs = (result.structuredContent as { mrs?: unknown[] } | undefined)?.mrs ?? []
const sections = (result._meta as { gitlabPane?: { sections?: { rows: unknown[] }[] } } | undefined)?.gitlabPane?.sections ?? []
const rows = sections.flatMap(section => section.rows)
const modelKeys = new Set(mrs.flatMap(mr => Object.keys(mr as object)))
console.log('call', result.isError === true ? `error: ${JSON.stringify(result.content)}` : `${mrs.length} MRs for the model, ${rows.length} rows for the panel`)
console.log('model sees fields', [...modelKeys].join(','), modelKeys.has('title') ? '(TITLE LEAKS)' : '(no titles)')
await client.close()
