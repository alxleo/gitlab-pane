// Installs the ChatGPT plugin from a release tree the way ChatGPT's desktop app does, with Codex (the app's own, or the
// one CI pins), in a Codex home of its own: the tree as a marketplace, the plugin from it, and then asks Codex's app-server
// which tools the plugin's server has. It fails unless Codex starts the server and sees both tools. A plugin can install
// and still start no server (an mcp.json Codex skips), which only this shows.
//
//   node chatgpt/codex-check.ts --tree DIR [--codex BIN]
import { strict as assert } from 'node:assert'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { isRecord, parseJson } from '../hooks/decode.ts'

/** The Codex inside ChatGPT's desktop app on a Mac; elsewhere, `codex` on the PATH. */
const BUNDLED = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex'
const WANTED = ['list_my_mrs', 'press_move']
/** How long Codex's app-server may take to answer one request, starting the plugin's server included. */
const ANSWER_MS = 120_000

/** The tools Codex's app-server says the server `name` has, over its stdio JSON-RPC. */
async function toolsOf(codex: string, home: string, name: string): Promise<string[]> {
  const server = spawn(codex, ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, CODEX_HOME: home } })
  const answers = new Map<number, (message: Record<string, unknown>) => void>()
  let buffer = ''
  server.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString()
    for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
      const message = parseJson(buffer.slice(0, at))
      buffer = buffer.slice(at + 1)
      if (isRecord(message) && typeof message.id === 'number') {
        answers.get(message.id)?.(message)
      }
    }
  })
  // A server that never comes up must fail here with a reason, not run the CI job out of time.
  const ask = (id: number, method: string, params: unknown) =>
    new Promise<Record<string, unknown>>((settle, refuse) => {
      const late = setTimeout(() => {
        refuse(new Error(`Codex did not answer ${method} within ${ANSWER_MS / 1000} s`))
      }, ANSWER_MS)
      answers.set(id, answer => {
        clearTimeout(late)
        settle(answer)
      })
      server.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  try {
    await ask(1, 'initialize', { clientInfo: { name: 'codex-check', version: '0' }, capabilities: null })
    server.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`)
    const status = await ask(2, 'mcpServerStatus/list', { detail: 'toolsAndAuthOnly', serverName: name })
    const data = isRecord(status.result) && Array.isArray(status.result.data) ? status.result.data : []
    const first: unknown = data[0]
    return isRecord(first) && isRecord(first.tools) ? Object.keys(first.tools) : []
  } finally {
    server.kill()
  }
}

const { values } = parseArgs({ options: { tree: { type: 'string' }, codex: { type: 'string' } } })
if (values.tree === undefined) {
  throw new Error('usage: node chatgpt/codex-check.ts --tree DIR [--codex BIN]')
}
const tree = resolve(values.tree)
const codex = values.codex ?? (existsSync(BUNDLED) ? BUNDLED : 'codex')
const home = mkdtempSync(join(tmpdir(), 'codex-check-'))
try {
  const run = (...args: string[]) => execFileSync(codex, args, { env: { ...process.env, CODEX_HOME: home }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const version = run('--version').trim()
  run('plugin', 'marketplace', 'add', tree)
  run('plugin', 'add', 'gitlab-pane@gitlab-pane')
  const tools = (await toolsOf(codex, home, 'gitlab-pane')).toSorted()
  assert.deepEqual(tools, WANTED, `${version} starts the plugin's server with its tools (it saw: ${tools.length > 0 ? tools.join(', ') : 'no server'})`)
  console.log(`ok: ${version} installs gitlab-pane from ${tree} and starts its server with ${tools.join(', ')}`)
} finally {
  rmSync(home, { recursive: true, force: true })
}
