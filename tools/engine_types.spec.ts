import { expect, test } from 'vitest'

import { noVersion, unpackRun, versionFrom } from './engine_types.ts'

// Plain data only: npm run setup, lint and types run the tool against the real claude, so these tests need not.

test('claude is told to unpack under the folder it is given, by CLAUDE_CODE_TMPDIR, which it reads, and by TMPDIR, which some builds read', () => {
  const { env } = unpackRun('/work', '/bin')
  expect(env?.['CLAUDE_CODE_TMPDIR']).toBe('/work/tmp')
  expect(env?.['TMPDIR']).toBe('/work/tmp')
})

test('claude runs in that folder with nothing of yours but PATH: an empty home and config folder, and an API address nothing answers', () => {
  expect(unpackRun('/work', '/bin')).toEqual({
    cwd: '/work',
    env: {
      PATH: '/bin',
      HOME: '/work/home',
      CLAUDE_CONFIG_DIR: '/work/config',
      CLAUDE_CODE_TMPDIR: '/work/tmp',
      TMPDIR: '/work/tmp',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
    },
    stdio: 'ignore',
    timeout: 120_000,
  })
})

test('the version is the first word claude --version prints', () => {
  expect(versionFrom('2.1.322 (Claude Code)\n')).toBe('2.1.322')
})

test('with no claude to run the version is empty, so the tool says claude is missing instead of crashing', () => {
  expect(versionFrom(undefined)).toBe('')
  // npm ci never ran: there is nothing to start, and no output at all.
  const missing = Object.assign(new Error('spawnSync /repo/node_modules/.bin/claude ENOENT'), { code: 'ENOENT' })
  expect(noVersion('/repo/node_modules/.bin/claude', { error: missing, stderr: undefined })).toBe(
    '`/repo/node_modules/.bin/claude --version` printed no version (spawnSync /repo/node_modules/.bin/claude ENOENT). Run npm ci, which installs the Claude Code package.json pins, or, after an install with --ignore-scripts, npm rebuild @anthropic-ai/claude-code.'
  )
  // An install with --ignore-scripts: the stub runs, says why on stderr, and prints no version.
  expect(noVersion('claude', { error: undefined, stderr: 'Error: claude native binary not installed.\n\nEither postinstall did not run' })).toContain(
    '(Error: claude native binary not installed.)'
  )
})
