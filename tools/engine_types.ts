// Lays the Claude Code API declarations out the way the engine does when it loads this mod from a folder:
// .claude-plugin/types/claude-code/index.d.ts, with the tsconfig.json the declarations' header documents, which the root
// tsconfig.json extends. The folder is git-ignored; nothing from Anthropic is committed. Run: node --import ./tools/resolve_ts.ts tools/engine_types.ts
//
// The declarations ship inside the claude binary as the bundled plugin-authoring skill, which the binary unpacks to
// $CLAUDE_CODE_TMPDIR/claude-<uid>/bundled-skills/<version>/<hash>/ the first time the skill's prompt is built. That needs no sign-in:
// `claude -p /plugin-authoring` unpacks it and then answers or fails, and either way the file is there. It runs with an
// empty HOME and config folder and a closed API address, so it has no credential to send and never spends a model call on
// your account (claude may still reach Anthropic unauthenticated, which changes nothing here).
//
// So the types are exactly those of the Claude Code package.json pins, which `npm ci` installs (tools/pins.ts). It does nothing
// when the folder already holds that version's file, so it is cheap to run before every check.
import { type SpawnSyncOptions, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { pinnedClaude } from './pins.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = join(root, '.claude-plugin', 'types')

// The options are those in the declarations' header.
const TSCONFIG = {
  compilerOptions: {
    target: 'es2023',
    lib: ['es2023'],
    types: [],
    module: 'esnext',
    moduleResolution: 'bundler',
    strict: true,
    noUncheckedIndexedAccess: true,
    noEmit: true,
    skipLibCheck: true,
    jsx: 'react',
    jsxFactory: 'h',
    jsxFragmentFactory: 'Fragment',
  },
}

const fail = (message: string): never => {
  console.error(`tools/engine_types.ts: ${message}`)
  process.exit(1)
}

/**
 * The version in what `claude --version` printed, or '' when it printed nothing. Node leaves the output undefined when
 * there is no claude to run, whatever its types say.
 */
export function versionFrom(printed: string | undefined): string {
  return printed === undefined ? '' : (printed.split(' ')[0] ?? '')
}

/**
 * How claude is run to unpack the skill: in `work`, so it reads no project's settings or instructions, with nothing of
 * this environment but PATH, a home, config folder and temp folder inside `work`, and an API address nothing answers. So
 * it has no credential of yours to send; it may still reach Anthropic unauthenticated, which spends nothing.
 *
 * claude puts its temp folder in CLAUDE_CODE_TMPDIR, else /tmp, and the native macOS builds ignore TMPDIR; the build CI
 * installs from npm has been seen to unpack under TMPDIR, for a reason not checked. Both name the same folder.
 */
export function unpackRun(work: string, path: string): SpawnSyncOptions {
  return {
    cwd: work,
    env: {
      PATH: path,
      HOME: join(work, 'home'),
      CLAUDE_CONFIG_DIR: join(work, 'config'),
      CLAUDE_CODE_TMPDIR: join(work, 'tmp'),
      TMPDIR: join(work, 'tmp'),
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
    },
    stdio: 'ignore',
    timeout: 120_000,
  }
}

const head = (file: string): string => readFileSync(file, 'utf8').split('\n', 1)[0] ?? ''
const stamp = (version: string): string => `// Written by Claude Code ${version}.`

/**
 * Has the pinned claude unpack its plugin-authoring skill inside `work`, an empty folder, and returns where its
 * declarations landed, or undefined when they are not there. Unpacking happens before any request, so the refused
 * request and the exit status are expected and ignored.
 */
function unpackDeclarations(version: string, work: string): string | undefined {
  for (const folder of ['home', 'config', 'tmp']) {
    mkdirSync(join(work, folder))
  }
  spawnSync(pinnedClaude(root), ['-p', '/plugin-authoring'], unpackRun(work, process.env['PATH'] ?? ''))
  const skills = join(work, 'tmp', readdirSync(join(work, 'tmp')).find(name => name.startsWith('claude-')) ?? 'missing', 'bundled-skills', version)
  const hashes = existsSync(skills) ? readdirSync(skills) : []
  return hashes.map(hash => join(skills, hash, 'plugin-authoring', 'types', 'claude-code.d.ts')).find(existsSync)
}

/** Lays claude `version`'s declarations in .claude-plugin/types/ and returns what went wrong, or '' when nothing did. */
function lay(version: string, target: string): string {
  const work = mkdtempSync(join(tmpdir(), 'engine-types-'))
  try {
    const source = unpackDeclarations(version, work)
    if (source === undefined) {
      return `claude ${version} did not unpack its bundled plugin-authoring skill under ${join(work, 'tmp')}.`
    }
    if (head(source) !== stamp(version)) {
      return `the unpacked declarations are not those of claude ${version}: ${head(source)}`
    }
    rmSync(dest, { recursive: true, force: true })
    mkdirSync(join(dest, 'claude-code'), { recursive: true })
    cpSync(source, target)
    writeFileSync(join(dest, '.gitignore'), '*\n')
    writeFileSync(join(dest, 'tsconfig.json'), `${JSON.stringify(TSCONFIG, null, 2)}\n`)
    return ''
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  const version = versionFrom(spawnSync(pinnedClaude(root), ['--version'], { encoding: 'utf8', timeout: 30_000 }).stdout)
  if (version === '') {
    fail(`\`${pinnedClaude(root)} --version\` printed nothing; run npm ci, which installs the Claude Code package.json pins.`)
  }
  const target = join(dest, 'claude-code', 'index.d.ts')
  const current = existsSync(target) && existsSync(join(dest, 'tsconfig.json')) && head(target) === stamp(version)
  if (!current) {
    const problem = lay(version, target)
    if (problem !== '') {
      fail(problem)
    }
    console.log(`Laid Claude Code ${version}'s declarations in .claude-plugin/types/.`)
  }
}
