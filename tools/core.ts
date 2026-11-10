// The core: the files that run on plain data, listed once, in tsconfig.core.json's "include". The lint config, the local
// lint rules and the on-edit hook (tools/check_core.ts) all read the list here, so there is one reader of the one list.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { isRecord, parseJson } from '../hooks/decode.ts'

/** The repository's root, which every path in the list is relative to. */
export const ROOT = join(import.meta.dirname, '..')

/**
 * The include list of a parsed tsconfig.core.json. Anything but a list of paths throws: an empty or unread core would
 * leave the core's rules nothing to check, and they would pass in silence.
 */
export function includeOf(parsed: unknown): string[] {
  const include = isRecord(parsed) ? parsed['include'] : undefined
  if (!Array.isArray(include) || include.length === 0 || !include.every(each => typeof each === 'string')) {
    throw new Error('tsconfig.core.json has no "include" list of paths, so the core cannot be known')
  }
  return include.filter(each => typeof each === 'string')
}

/** Everything tsconfig.core.json includes, `/`-separated and relative to the root, declarations among them. */
export function coreInclude(): string[] {
  // The file carries `//` comments, which TypeScript allows and JSON does not, so they are stripped before it is read.
  return includeOf(parseJson(readFileSync(join(ROOT, 'tsconfig.core.json'), 'utf8').replace(/^\s*\/\/.*$/gmu, '')))
}

/** The core's source files: what it includes, less the declarations. */
export const coreFiles = (): string[] => coreInclude().filter(file => /\.tsx?$/u.test(file) && !file.endsWith('.d.ts'))
