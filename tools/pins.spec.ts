import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from 'vitest'

import { CLAUDE_PACKAGE, installed, pinned, pinnedClaude } from './pins.ts'

const ROOT = join(import.meta.dirname, '..')

test('the Claude Code a tool runs is the one npm ci put in the checkout, at the exact version package.json pins', () => {
  expect(pinnedClaude('/repo')).toBe(join('/repo', 'node_modules', '.bin', 'claude'))
  expect(pinned(ROOT, CLAUDE_PACKAGE)).toMatch(/^\d+\.\d+\.\d+$/u)
  expect(installed(ROOT, CLAUDE_PACKAGE)).toBe(pinned(ROOT, CLAUDE_PACKAGE))
})

test('a tool package.json does not pin, or npm ci did not install, is said to be missing', () => {
  expect(pinned(ROOT, 'no-such-tool')).toBeNull()
  expect(installed(ROOT, 'no-such-tool')).toBeNull()
})

test('no tool starts the claude on PATH, which the desktop app updates by itself: each runs the pinned one', () => {
  const tools = readdirSync(import.meta.dirname).filter(name => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
  const bare = tools.filter(name => /\b(?:spawn|spawnSync|execFile|execFileSync)\(\s*['"`]claude['"`]/u.test(readFileSync(join(import.meta.dirname, name), 'utf8')))
  expect(bare).toEqual([])
})
