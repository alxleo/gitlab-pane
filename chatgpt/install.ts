// Installs this checkout's ChatGPT plugin on this machine, to try a change before it is released: builds the package into
// ~/.codex/plugins/gitlab-pane and lists it in the personal marketplace, ~/.agents/plugins/marketplace.json, which is made
// if missing and otherwise keeps its other plugins. The version is the mod's with `-local.<hash>` after it, so ChatGPT's
// Codex takes each build as new rather than keeping the copy it cached. Then, in ChatGPT, install "GitLab MRs" from the
// "Personal" marketplace (once), quit the app and open a new chat.
//
//   node --import ./tools/resolve_ts.ts chatgpt/install.ts
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { isRecord, parseJson } from '../hooks/decode.ts'
import { buildPackage, modVersion, writeManifests } from './build.ts'

const NAME = 'gitlab-pane'
/** The Codex inside ChatGPT's desktop app on a Mac. */
const CODEX = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex'
const target = join(homedir(), '.codex', 'plugins', NAME)
const marketplace = join(homedir(), '.agents', 'plugins', 'marketplace.json')

await buildPackage(target, modVersion())
const built = createHash('sha256')
  .update(readFileSync(join(target, 'dist', 'server.mjs')))
  .update(readFileSync(join(target, 'dist', 'panel.bundled.html')))
  .digest('hex')
  .slice(0, 8)
const version = `${modVersion()}-local.${built}`
writeManifests(target, version)

const entry = {
  name: NAME,
  // Relative to the marketplace root, which for the personal marketplace is the home folder.
  source: { source: 'local', path: `./.codex/plugins/${NAME}` },
  policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
  category: 'Productivity',
}
const existing: unknown = existsSync(marketplace) ? parseJson(readFileSync(marketplace, 'utf8')) : null
const base = isRecord(existing) ? existing : { name: 'personal', interface: { displayName: 'Personal' } }
const listed: unknown[] = Array.isArray(base.plugins) ? base.plugins : []
const others = listed.filter(plugin => !(isRecord(plugin) && plugin.name === NAME))
mkdirSync(join(homedir(), '.agents', 'plugins'), { recursive: true })
writeFileSync(marketplace, `${JSON.stringify({ ...base, plugins: [...others, entry] }, null, 2)}\n`)
// ChatGPT's bundled Codex keeps an installed plugin in its own cache: adding it again copies this build there.
const added = existsSync(CODEX) ? spawnSync(CODEX, ['plugin', 'add', `${NAME}@personal`], { stdio: 'ignore' }).status === 0 : false
console.log(
  `built ${NAME} ${version} at ${target}, listed in ${marketplace}; ${added ? 'ChatGPT has it' : 'install "GitLab MRs" from the Personal marketplace in ChatGPT'}; quit ChatGPT and open a new chat`
)
