// ChatGPT's side of the panel, played in a web page: what the harness shows and what the panel test drives. It does what
// a host does with an MCP server: reads the panel by the URI the tool names (as ChatGPT fetches and caches it, never the
// sources), opens it in a sandboxed iframe behind ext-apps' AppBridge, sends the thread entrypoint's `{}` call result,
// and answers the panel's tool calls through the server.
import { createServer as createHttp } from 'node:http'

import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { build } from 'esbuild'

import { parseJson } from '../../hooks/decode.ts'

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

/** The panel as a host gets it: the resource the tool's `_meta.ui.resourceUri` names. */
export async function panelOf(client: Client): Promise<{ uri: string; html: string }> {
  const { tools } = await client.listTools()
  const meta = tools.find(tool => tool.name === 'list_my_mrs')?._meta?.ui
  const uri = typeof meta === 'object' && meta !== null && 'resourceUri' in meta && typeof meta.resourceUri === 'string' ? meta.resourceUri : ''
  const first = (await client.readResource({ uri })).contents[0]
  return { uri, html: first !== undefined && 'text' in first ? first.text : '' }
}

/** Serves the host page around the panel on 127.0.0.1 (`port` 0 picks a free one) until `close`. */
export async function serveHost(client: Client, port = 0): Promise<{ url: string; uri: string; close: () => Promise<void> }> {
  const [{ uri, html }, script] = await Promise.all([panelOf(client), hostScript()])
  const server = createHttp(async (request, response) => {
    if (request.url === '/panel') {
      response.writeHead(200, { 'content-type': 'text/html' }).end(html)
    } else if (request.url === '/call' && request.method === 'POST') {
      let body = ''
      for await (const chunk of request) body += chunk
      const params = parseJson(body)
      const name = typeof params === 'object' && params !== null && 'name' in params && typeof params.name === 'string' ? params.name : ''
      const args =
        typeof params === 'object' && params !== null && 'arguments' in params && typeof params.arguments === 'object' && params.arguments !== null ? params.arguments : {}
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(await client.callTool({ name, arguments: Object.fromEntries(Object.entries(args)) })))
    } else {
      response.writeHead(200, { 'content-type': 'text/html' }).end(page(script))
    }
  })
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve))
  const address = server.address()
  const bound = typeof address === 'object' && address !== null ? address.port : port
  return { url: `http://127.0.0.1:${bound}`, uri, close: () => new Promise(resolve => server.close(() => resolve())) }
}
