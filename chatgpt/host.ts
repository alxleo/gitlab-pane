// ChatGPT's side of the panel, played in a web page: what the harness shows and what the panel test drives. It does what
// a host does with an MCP server: reads the panel by the URI the tool names (as ChatGPT fetches and caches it, never the
// sources), opens it in a sandboxed iframe behind ext-apps' AppBridge, sends the thread entrypoint's `{}` call result,
// and answers the panel's tool calls through the server.
import { createServer as createHttp } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { build } from 'esbuild'

import { isRecord, parseJson } from '../hooks/decode.ts'
import { metaString } from './result.ts'

async function hostScript(): Promise<string> {
  const source = `
    import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge'
    const frame = document.querySelector('iframe')
    const log = document.querySelector('#log')
    const say = text => { if (log !== null) { const li = document.createElement('li'); li.textContent = text; log.prepend(li) } }
    // The styles the host hands the panel (its fonts and style variables), as the page was served with them.
    const styles = JSON.parse(document.querySelector('#styles').textContent)
    // What the panel put on the wire, before the bridge's own schema reads it.
    window.addEventListener('message', event => { if (event.data?.method === 'ui/message') say('on the wire: ui/message _meta ' + JSON.stringify(event.data.params?._meta ?? null)) })
    frame.addEventListener('load', async () => {
      const bridge = new AppBridge(null, { name: 'harness', version: '0' }, { openLinks: {}, serverTools: {}, message: { text: {} }, experimental: { 'openai/message': {} } }, { hostContext: { theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', displayMode: 'inline', ...(styles !== null ? { styles } : {}) } })
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

/**
 * What the host gives the panel beyond the theme, as MCP Apps' `hostContext.styles` carries it: style variables (its
 * fonts' names), and `css.fonts`, the faces they name. ChatGPT sends its own; the pictures send the bundled fonts.
 */
export type HostStyles = { variables: Record<string, string>; css: { fonts: string } }

/** The host page: the log beside the panel, or the panel alone (`isBare`), the width a conversation panel gets. */
const page = (script: string, styles: HostStyles | null, isBare: boolean) => `<!doctype html><html><head><meta charset="utf-8"><title>Panel harness</title>
<style>body{margin:0;display:flex;gap:16px;font:13px system-ui;background:#f4f4f4}iframe{width:420px;height:100vh;border:0;border-left:1px solid #ddd;background:#fff}
aside{flex:1;padding:12px}h2{font-size:13px;margin:0 0 8px}ul{padding-left:16px;font:12px ui-monospace,monospace;overflow-wrap:anywhere}
body.bare{display:block;background:none}body.bare iframe{display:block;border:0;background:none}</style></head>
<body${isBare ? ' class="bare"' : ''}>${isBare ? '' : '<aside><h2>Host side (what ChatGPT would receive)</h2><ul id="log"></ul></aside>'}<iframe src="/panel" sandbox="allow-scripts allow-same-origin"></iframe>
<script type="application/json" id="styles">${JSON.stringify(styles).replaceAll('<', '\\u003c')}</script>
<script type="module">${script}</script></body></html>`

/** A server ChatGPT would launch: `node <path>` over stdio, with this process's environment (the token, the host). */
export const stdioServer = (path: string): StdioClientTransport =>
  new StdioClientTransport({
    command: process.execPath,
    args: [path],
    env: Object.fromEntries(Object.entries(process.env).flatMap(([name, value]) => (value !== undefined ? [[name, value]] : []))),
  })

/** The panel as a host gets it: the resource the tool's `_meta.ui.resourceUri` names. */
export async function panelOf(client: Client): Promise<{ uri: string; html: string }> {
  const { tools } = await client.listTools()
  const uri = metaString(tools.find(tool => tool.name === 'list_my_mrs')?._meta, 'ui', 'resourceUri')
  const first = (await client.readResource({ uri })).contents[0]
  return { uri, html: first !== undefined && 'text' in first ? first.text : '' }
}

/** A tool call the panel sent through the host page, answered by the server. */
async function answerCall(client: Client, request: IncomingMessage, response: ServerResponse): Promise<void> {
  let body = ''
  for await (const chunk of request) {
    body += String(chunk)
  }
  const params = parseJson(body)
  const name = isRecord(params) && typeof params.name === 'string' ? params.name : ''
  const args = isRecord(params) && isRecord(params.arguments) ? params.arguments : {}
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(await client.callTool({ name, arguments: args })))
}

/**
 * Serves the host page around the panel on 127.0.0.1 until `close`: on `port` (0 picks a free one), handing the panel
 * `styles`, with the log beside it or, `isBare`, the panel alone.
 */
export async function serveHost(
  client: Client,
  { port = 0, styles = null, isBare = false }: { port?: number; styles?: HostStyles | null; isBare?: boolean } = {}
): Promise<{ url: string; uri: string; close: () => Promise<void> }> {
  const [{ uri, html }, script] = await Promise.all([panelOf(client), hostScript()])
  const server = createHttp((request, response) => {
    if (request.url === '/panel') {
      response.writeHead(200, { 'content-type': 'text/html' }).end(html)
    } else if (request.url === '/call' && request.method === 'POST') {
      answerCall(client, request, response).catch((error: unknown) => {
        response.writeHead(500).end(error instanceof Error ? error.message : String(error))
      })
    } else {
      response.writeHead(200, { 'content-type': 'text/html' }).end(page(script, styles, isBare))
    }
  })
  await new Promise<void>(resolve => {
    server.listen(port, '127.0.0.1', resolve)
  })
  const address = server.address()
  const bound = typeof address === 'object' && address !== null ? address.port : port
  const close = () =>
    new Promise<void>(resolve => {
      server.close(() => {
        resolve()
      })
    })
  return { url: `http://127.0.0.1:${bound}`, uri, close }
}
