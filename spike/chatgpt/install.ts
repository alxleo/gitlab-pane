// Installs the built plugin where ChatGPT's desktop app finds a personal plugin: the package (plugin.json, mcp.json, the
// Codex overlay and dist/) copied to ~/.codex/plugins/gitlab-pane, and an entry for it in the personal marketplace,
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
// The portable plugin.json and mcp.json carry the server; ChatGPT's bundled Codex reads mcp.json only when it names the
// Agent Plugins schema, and otherwise installs a plugin with no server. The Codex overlay adds the name and category the
// app shows. Codex finds `node` on the PATH it takes from the login shell.
for (const file of ['plugin.json', 'mcp.json', '.codex-plugin', 'dist']) {
  cpSync(join(here, file), join(target, file), { recursive: true })
}

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
