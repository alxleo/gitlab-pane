// Installs the built plugin where ChatGPT's desktop app finds a personal plugin: the package (plugin.json, mcp.json and
// dist/) copied to ~/.codex/plugins/gitlab-pane, and an entry for it in the personal marketplace,
// ~/.agents/plugins/marketplace.json, which is created if missing and otherwise keeps its other plugins. Run after
// `node build.ts`; restart the desktop app afterwards so it reads the new files.
//
//   node install.ts
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { isRecord, parseJson } from '../../hooks/decode.ts'

const NAME = 'gitlab-pane'
const here = import.meta.dirname
const target = join(homedir(), '.codex', 'plugins', NAME)
const marketplace = join(homedir(), '.agents', 'plugins', 'marketplace.json')

if (!existsSync(join(here, 'dist', 'server.mjs')) || !existsSync(join(here, 'dist', 'panel.bundled.html'))) {
  throw new Error('dist/ is not built: run `node build.ts` first')
}

rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
// The portable plugin.json and mcp.json, and the Codex overlay: ChatGPT's desktop app (its bundled Codex) finds MCP
// servers only through `.codex-plugin/plugin.json`'s `mcpServers`, which names `.mcp.json`; the root mcp.json alone
// installs a plugin whose server never starts.
for (const file of ['plugin.json', 'mcp.json', '.codex-plugin', 'dist']) {
  cpSync(join(here, file), join(target, file), { recursive: true })
}
// The packaged `.mcp.json` says `node`, which an app started from the Dock may not find on its PATH. This install is for
// this machine, so it names the Node that ran it, a pinned install, and launches it directly.
const server = { command: process.execPath, args: ['./dist/server.mjs'], cwd: '.' }
writeFileSync(join(target, '.mcp.json'), `${JSON.stringify({ mcpServers: { [NAME]: server } }, null, 2)}\n`)

const entry = {
  name: NAME,
  // Relative to the marketplace root, which for the personal marketplace is the home folder.
  source: { source: 'local', path: `./.codex/plugins/${NAME}` },
  policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
  category: 'Productivity',
}
const existing: unknown = existsSync(marketplace) ? parseJson(readFileSync(marketplace, 'utf8')) : null
const base = isRecord(existing) ? existing : { name: 'personal', interface: { displayName: 'Personal' } }
const others = Array.isArray(base.plugins) ? base.plugins.filter(plugin => !(isRecord(plugin) && plugin.name === NAME)) : []
mkdirSync(join(homedir(), '.agents', 'plugins'), { recursive: true })
writeFileSync(marketplace, `${JSON.stringify({ ...base, plugins: [...others, entry] }, null, 2)}\n`)
console.log(`installed ${NAME} at ${target}, listed in ${marketplace}; restart the ChatGPT desktop app`)
