// What package.json pins for a dev tool, what `npm ci` installed of it, and where the pinned Claude Code is. The tools run
// these binaries from this repository's node_modules, never whichever is on PATH: the desktop app updates its own Claude
// Code by itself, and the checks must not move with it. package.json is the one place the version is written; Renovate
// raises it there (renovate.json).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { isRecord, parseJson } from '../hooks/decode.ts'

const readJson = (file: string): unknown => parseJson(readFileSync(file, 'utf8'))

/** What package.json at `root` pins for a dev tool: an exact version. */
export function pinned(root: string, name: string): string | null {
  const manifest = readJson(join(root, 'package.json'))
  const dependencies = isRecord(manifest) ? manifest['devDependencies'] : undefined
  const spec = isRecord(dependencies) ? dependencies[name] : undefined
  return typeof spec === 'string' ? spec : null
}

/** The version of a tool installed in `root`'s node_modules, or null when it is not. */
export function installed(root: string, name: string): string | null {
  const file = join(root, 'node_modules', name, 'package.json')
  const manifest = existsSync(file) ? readJson(file) : null
  return isRecord(manifest) && typeof manifest['version'] === 'string' ? manifest['version'] : null
}

/** The Claude Code package, whose version package.json pins. */
export const CLAUDE_PACKAGE = '@anthropic-ai/claude-code'

/** The pinned Claude Code that `npm ci` puts in `root`'s node_modules. */
export const pinnedClaude = (root: string): string => join(root, 'node_modules', '.bin', 'claude')
