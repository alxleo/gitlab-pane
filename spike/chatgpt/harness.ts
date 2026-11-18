// A stand-in for ChatGPT's side of the panel, to see it drawn without installing anything into ChatGPT: a page that
// plays the MCP Apps host (ext-apps' AppBridge) around the panel's iframe, and answers its tool calls through the real
// server in memory. By default GitLab's answer is made up (the repo's test fixtures), so a picture shows no real MR.
//
//   node harness.ts [--port 4319] [--live]
import { createServer as createHttp } from 'node:http'
import { parseArgs } from 'node:util'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { build } from 'esbuild'

import { fakeGitLab } from './fake.ts'
import { panelHtml } from './panel-build.ts'
import { connect } from './read.ts'
import { createServer } from './server.ts'

const { values } = parseArgs({ options: { port: { type: 'string', default: '4319' }, live: { type: 'boolean', default: false } } })

// Live reads (and writes!) the real GitLab; by default a made-up one answers, and a merge there merges nothing real.
const gitlabFor = values.live ? connect : () => fakeGitLab()

async function hostScript(): Promise<string> {
  const source = `
    import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge'
    const frame = document.querySelector('iframe')
    const log = document.querySelector('#log')
    const say = text => { const li = document.createElement('li'); li.textContent = text; log.prepend(li) }
    // What the panel put on the wire, before the bridge's own schema reads it.
    window.addEventListener('message', event => { if (event.data?.method === 'ui/message') say('on the wire: ui/message _meta ' + JSON.stringify(event.data.params?._meta ?? null)) })
    frame.addEventListener('load', async () => {
      const bridge = new AppBridge(null, { name: 'harness', version: '0' }, { openLinks: {}, serverTools: {}, message: { text: {} }, experimental: { 'openai/message': {} } }, { hostContext: { theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', displayMode: 'inline' } })
      const call = async params => (await fetch('/call', { method: 'POST', body: JSON.stringify(params) })).json()
      bridge.oncalltool = async params => { say('tools/call ' + params.name); return call(params) }
      bridge.onopenlink = async params => { say('ui/open-link ' + params.url); return {} }
      bridge.onmessage = async params => { say('ui/message ' + JSON.stringify(params)); return {} }
      bridge.oninitialized = async () => { say('ui/initialize done; thread entrypoint opens with {}'); bridge.sendToolInput({ arguments: {} }); bridge.sendToolResult(await call({ name: 'list_my_mrs', arguments: {} })) }
      await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow))
    })`
  const out = await build({
    stdin: { contents: source, resolveDir: import.meta.dirname, loader: 'js' },
    bundle: true,
    format: 'esm',
    write: false,
    logLevel: 'silent',
    tsconfigRaw: {},
  })
  return out.outputFiles[0]?.text ?? ''
}

const page = (script: string) => `<!doctype html><html><head><meta charset="utf-8"><title>Panel harness</title>
<style>body{margin:0;display:flex;gap:16px;font:13px system-ui;background:#f4f4f4}iframe{width:380px;height:100vh;border:0;border-left:1px solid #ddd;background:#fff}
aside{flex:1;padding:12px}h2{font-size:13px;margin:0 0 8px}ul{padding-left:16px;font:12px ui-monospace,monospace;overflow-wrap:anywhere}</style></head>
<body><aside><h2>Host side (what ChatGPT would receive)</h2><ul id="log"></ul></aside><iframe src="/panel" sandbox="allow-scripts allow-same-origin"></iframe>
<script type="module">${script}</script></body></html>`

const client = new Client({ name: 'harness', version: '0' })
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
await createServer(gitlabFor).connect(serverSide)
await client.connect(clientSide)
const [html, script] = await Promise.all([panelHtml(), hostScript()])

createHttp(async (request, response) => {
  if (request.url === '/panel') {
    response.writeHead(200, { 'content-type': 'text/html' }).end(html)
  } else if (request.url === '/call' && request.method === 'POST') {
    let body = ''
    for await (const chunk of request) body += chunk
    const params = JSON.parse(body)
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(await client.callTool(params)))
  } else {
    response.writeHead(200, { 'content-type': 'text/html' }).end(page(script))
  }
}).listen(Number(values.port), '127.0.0.1', () => console.log(`harness on http://127.0.0.1:${values.port} (${values.live ? 'live GitLab' : 'made-up MRs'})`))
