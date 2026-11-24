// Packages the ChatGPT plugin: the manifests, and the server with the core it imports and its MCP packages as one
// plain-JavaScript file, with the panel bundled beside it. An installed plugin is copied out of this repository, so
// nothing in it may import from outside the package, and the Node that ChatGPT's desktop app finds needs no TypeScript.
// Both manifests take the mod's version (`.claude-plugin/plugin.json`, which releases raise), so one number names both.
//
//   node --import ./tools/resolve_ts.ts chatgpt/build.ts [--out chatgpt/package] [--version X.Y.Z]
//
// `install.ts` installs the package on this machine, `tools/release_tree.ts` puts it in the release tree.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { build } from 'esbuild'

import { isRecord, parseJson } from '../hooks/decode.ts'
import { panelHtml } from './panel-build.ts'

const HERE = import.meta.dirname

/** The mod's version, which the package takes. */
export function modVersion(): string {
  const manifest = parseJson(readFileSync(join(HERE, '..', '.claude-plugin', 'plugin.json'), 'utf8'))
  if (!isRecord(manifest) || typeof manifest.version !== 'string') {
    throw new Error('.claude-plugin/plugin.json names no version')
  }
  return manifest.version
}

/** A manifest of this folder with `version` set. */
function stamped(file: string, version: string): string {
  const manifest = parseJson(readFileSync(join(HERE, file), 'utf8'))
  if (!isRecord(manifest)) {
    throw new Error(`${file} is not a JSON object`)
  }
  return `${JSON.stringify({ ...manifest, version }, null, 2)}\n`
}

/** Writes the package's manifests into `into`, each naming `version`. */
export function writeManifests(into: string, version: string): void {
  mkdirSync(join(into, '.codex-plugin'), { recursive: true })
  writeFileSync(join(into, 'plugin.json'), stamped('plugin.json', version))
  writeFileSync(join(into, '.codex-plugin', 'plugin.json'), stamped(join('.codex-plugin', 'plugin.json'), version))
  cpSync(join(HERE, 'mcp.json'), join(into, 'mcp.json'))
}

/** Writes the plugin package to `into`, which it empties first. */
export async function buildPackage(into: string, version: string): Promise<void> {
  rmSync(into, { recursive: true, force: true })
  mkdirSync(join(into, 'dist'), { recursive: true })
  writeManifests(into, version)
  await build({
    entryPoints: [join(HERE, 'server.ts')],
    outfile: join(into, 'dist', 'server.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfigRaw: {},
    logLevel: 'error',
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  })
  writeFileSync(join(into, 'dist', 'panel.bundled.html'), await panelHtml())
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: 'string', default: join(HERE, 'package') }, version: { type: 'string' } } })
  const version = values.version ?? modVersion()
  await buildPackage(values.out, version)
  console.log(`wrote the ChatGPT plugin ${version} to ${values.out}`)
}
