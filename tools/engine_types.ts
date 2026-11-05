// Lays the Claude Code API declarations out the way the engine does when it loads this mod from a folder:
// .claude-plugin/types/claude-code/index.d.ts, with the tsconfig.json the declarations' header documents, which the root
// tsconfig.json extends. The folder is git-ignored; nothing from Anthropic is committed. Run: node tools/engine_types.ts
//
// The declarations ship inside the claude binary as the bundled plugin-authoring skill, which the binary unpacks to
// $TMPDIR/claude-<uid>/bundled-skills/<version>/<hash>/ the first time the skill's prompt is built. That needs no sign-in
// and no network: `claude -p /plugin-authoring` unpacks it and then answers or fails, and either way the file is there.
// It runs with an empty HOME and config folder and a closed API address, so it never spends a model call on your account.
//
// So the types are exactly those of the claude on PATH, which CI pins (CLAUDE_CODE_VERSION in check.yml). It does nothing
// when the folder already holds that version's file, so it is cheap to run before every check.
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

const version = spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout.split(' ')[0] ?? ''
if (version === '') {
  fail('`claude --version` printed nothing; is Claude Code on PATH?')
}
const firstLine = `// Written by Claude Code ${version}.`
const target = join(dest, 'claude-code', 'index.d.ts')
const head = (file: string) => readFileSync(file, 'utf8').split('\n', 1)[0]

if (existsSync(target) && existsSync(join(dest, 'tsconfig.json')) && head(target) === firstLine) {
  process.exit(0)
}

const work = mkdtempSync(join(tmpdir(), 'engine-types-'))
try {
  for (const folder of ['home', 'config', 'tmp']) {
    mkdirSync(join(work, folder))
  }
  // Unpacking happens before any request, so the refused request and the exit status are expected and ignored.
  spawnSync('claude', ['-p', '/plugin-authoring'], {
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: join(work, 'home'),
      CLAUDE_CONFIG_DIR: join(work, 'config'),
      TMPDIR: join(work, 'tmp'),
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
    },
    stdio: 'ignore',
    timeout: 120_000,
  })

  const skills = join(work, 'tmp', readdirSync(join(work, 'tmp')).find(name => name.startsWith('claude-')) ?? 'missing', 'bundled-skills', version)
  const hashes = existsSync(skills) ? readdirSync(skills) : []
  const source = hashes.map(hash => join(skills, hash, 'plugin-authoring', 'types', 'claude-code.d.ts')).find(existsSync)
  if (source === undefined) {
    fail(`claude ${version} did not unpack its bundled plugin-authoring skill under ${skills}.`)
  } else if (head(source) !== firstLine) {
    fail(`the unpacked declarations are not those of claude ${version}: ${head(source)}`)
  } else {
    rmSync(dest, { recursive: true, force: true })
    mkdirSync(join(dest, 'claude-code'), { recursive: true })
    cpSync(source, target)
    writeFileSync(join(dest, '.gitignore'), '*\n')
    writeFileSync(join(dest, 'tsconfig.json'), `${JSON.stringify(TSCONFIG, null, 2)}\n`)
    console.log(`Laid Claude Code ${version}'s declarations in .claude-plugin/types/.`)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
