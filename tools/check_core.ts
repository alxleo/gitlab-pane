// Run by .claude/settings.json after an agent edits a file. When the file is in the core (tsconfig.core.json's "include"),
// runs the core's tsc and eslint and Biome's format check, and hands what they say back to the agent: exit 2 with the findings on
// stderr, which Claude Code shows the model. Silent, exit 0, for any other file or a clean one.
//
// It runs the binaries in this repository's own node_modules, at the versions package.json pins (`npm ci` installs them),
// and says so instead of checking when they are missing or are other versions. It starts them with an argument list, not a
// shell, so a path with spaces is no trouble.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { isRecord, parseJson } from '../hooks/decode.ts'

const ROOT = process.env['CLAUDE_PROJECT_DIR'] ?? join(import.meta.dirname, '..')

const readJson = (file: string): unknown => parseJson(readFileSync(file, 'utf8'))

/** The file the tool edited, from the hook's JSON on stdin, relative to the repository with `/` separators. */
function editedFile(): string | null {
  let input: unknown
  try {
    input = parseJson(readFileSync(0, 'utf8'))
  } catch {
    return null
  }
  const toolInput = isRecord(input) ? input['tool_input'] : undefined
  const path = isRecord(toolInput) ? toolInput['file_path'] : undefined
  return typeof path === 'string' ? relative(ROOT, path).split(sep).join('/') : null
}

/** The files tsconfig.core.json lists, which carries `//` comments that JSON does not allow. */
function core(): string[] {
  const text = readFileSync(join(ROOT, 'tsconfig.core.json'), 'utf8').replace(/^\s*\/\/.*$/gm, '')
  const parsed = parseJson(text)
  const include = isRecord(parsed) && Array.isArray(parsed['include']) ? parsed['include'] : []
  return include.filter((each): each is string => typeof each === 'string' && !each.endsWith('.d.ts'))
}

/** What package.json pins for a tool, as a version number (an `npm:name@` alias prefix is taken off). */
function pinned(name: string): string | null {
  const manifest = readJson(join(ROOT, 'package.json'))
  const dependencies = isRecord(manifest) ? manifest['devDependencies'] : undefined
  const spec = isRecord(dependencies) ? dependencies[name] : undefined
  return typeof spec === 'string' ? spec.replace(/^npm:[^@]+@/, '') : null
}

/** The version of a tool installed in node_modules, or null when it is not. */
function installed(name: string): string | null {
  const file = join(ROOT, 'node_modules', name, 'package.json')
  const manifest = existsSync(file) ? readJson(file) : null
  return isRecord(manifest) && typeof manifest['version'] === 'string' ? manifest['version'] : null
}

function main(): number {
  const file = editedFile()
  if (file === null || !core().includes(file)) {
    return 0
  }
  const tools = [
    { name: 'typescript-7', script: join(ROOT, 'node_modules', 'typescript-7', 'bin', 'tsc'), args: ['-p', 'tsconfig.core.json'] },
    { name: 'eslint', script: join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js'), args: ['--max-warnings', '0', file] },
    { name: '@biomejs/biome', script: join(ROOT, 'node_modules', '@biomejs', 'biome', 'bin', 'biome'), args: ['format', file] },
  ]
  const wrong = tools
    .filter(tool => installed(tool.name) !== pinned(tool.name))
    .map(tool => `${tool.name} is ${installed(tool.name) ?? 'not installed'}, package.json pins ${pinned(tool.name) ?? '(nothing)'}`)
  if (wrong.length > 0) {
    console.error(`tools/check_core.ts: nothing was checked after your edit of ${file}, because node_modules does not match package-lock.json (${wrong.join('; ')}). Run: npm ci`)
    return 2
  }
  const out = tools.map(tool => {
    const ran = spawnSync(process.execPath, [tool.script, ...tool.args], { cwd: ROOT, encoding: 'utf8' })
    const said = `${ran.stdout}${ran.stderr}`.trim()
    // A tool that exits 0 found nothing, whatever it prints (Biome says how many files it checked).
    if (ran.status === 0) {
      return ''
    }
    return said !== '' ? said : `${tool.name} did not run (${ran.error?.message ?? `exit ${ran.status}`})`
  })
  const said = out.filter(each => each !== '').join('\n')
  if (said !== '') {
    console.error(`The core checks (tsc -p tsconfig.core.json, eslint, biome format) found problems after your edit of ${file}; formatting is fixed by npm run format:\n${said}`)
    return 2
  }
  return 0
}

process.exitCode = main()
