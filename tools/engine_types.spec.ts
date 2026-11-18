import { expect, test } from 'vitest'

import { isolatedEnv, versionFrom } from './engine_types.ts'

// Plain data only: npm run setup, lint and types run the tool against the real claude, so these tests need not.

test('claude is told to unpack under the folder it is given, by CLAUDE_CODE_TMPDIR, which it reads, and by TMPDIR, which some builds read', () => {
  const env = isolatedEnv('/work', '/bin')
  expect(env['CLAUDE_CODE_TMPDIR']).toBe('/work/tmp')
  expect(env['TMPDIR']).toBe('/work/tmp')
})

test('claude gets nothing of yours but PATH: an empty home and config folder, and an API address nothing answers', () => {
  expect(isolatedEnv('/work', '/bin')).toEqual({
    PATH: '/bin',
    HOME: '/work/home',
    CLAUDE_CONFIG_DIR: '/work/config',
    CLAUDE_CODE_TMPDIR: '/work/tmp',
    TMPDIR: '/work/tmp',
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
  })
})

test('the version is the first word claude --version prints', () => {
  expect(versionFrom('2.1.322 (Claude Code)\n')).toBe('2.1.322')
})

test('with no claude to run the version is empty, so the tool says claude is missing instead of crashing', () => {
  expect(versionFrom(undefined)).toBe('')
})
