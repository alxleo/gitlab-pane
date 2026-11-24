// Run by .claude/settings.json after an agent edits a file. When the file is in the core (tsconfig.core.json's "include"),
// runs the core's tsc and oxlint and Biome's format check, and hands what they say back to the agent: exit 2 with the findings on
// stderr, which Claude Code shows the model. Silent, exit 0, for any other file or a clean one.
//
// It runs the binaries in this repository's own node_modules, at the versions package.json pins (`npm ci` installs them),
// and says so instead of checking when they are missing or are other versions. It starts them with an argument list, not a
// shell, so a path with spaces is no trouble.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

import { isRecord, parseJson } from '../hooks/decode.ts'
import { coreFiles } from './core.ts'
import { installed, pinned } from './pins.ts'

const ROOT = process.env['CLAUDE_PROJECT_DIR'] ?? join(import.meta.dirname, '..')
// oxlint loads oxlint.config.ts and the local rules, which import the core: Node finds its files with this loaded first.
const RESOLVE_TS = pathToFileURL(join(import.meta.dirname, 'resolve_ts.ts')).href

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

function main(): number {
  const file = editedFile()
  if (file === null || !coreFiles().includes(file)) {
    return 0
  }
  const tools = [
    { name: 'typescript', script: join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), args: ['-p', 'tsconfig.core.json'] },
    { name: 'oxlint', script: join(ROOT, 'node_modules', 'oxlint', 'bin', 'oxlint'), args: [file] },
    { name: '@biomejs/biome', script: join(ROOT, 'node_modules', '@biomejs', 'biome', 'bin', 'biome'), args: ['format', file] },
  ]
  const wrong = tools
    .filter(tool => installed(ROOT, tool.name) !== pinned(ROOT, tool.name))
    .map(tool => `${tool.name} is ${installed(ROOT, tool.name) ?? 'not installed'}, package.json pins ${pinned(ROOT, tool.name) ?? '(nothing)'}`)
  if (wrong.length > 0) {
    console.error(`tools/check_core.ts: nothing was checked after your edit of ${file}, because node_modules does not match package-lock.json (${wrong.join('; ')}). Run: npm ci`)
    return 2
  }
  const out = tools.map(tool => {
    const ran = spawnSync(process.execPath, ['--import', RESOLVE_TS, tool.script, ...tool.args], { cwd: ROOT, encoding: 'utf8' })
    const said = `${ran.stdout}${ran.stderr}`.trim()
    // A tool that exits 0 found nothing, whatever it prints (Biome says how many files it checked).
    if (ran.status === 0) {
      return ''
    }
    return said !== '' ? said : `${tool.name} did not run (${ran.error?.message ?? `exit ${ran.status}`})`
  })
  const said = out.filter(each => each !== '').join('\n')
  if (said !== '') {
    console.error(`The core checks (tsc -p tsconfig.core.json, oxlint, biome format) found problems after your edit of ${file}; formatting is fixed by npm run format:\n${said}`)
    return 2
  }
  return 0
}

process.exitCode = main()
