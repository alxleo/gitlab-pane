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

/**
 * `claude` by bare name where a tool picks what to run: the first argument of a spawn, a default after `??` or `||`, or a
 * value given to a name or a field. Comparisons and list entries (a theme's key, say) are not runs.
 */
const BARE_CLAUDE = /(?:\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync)\(\s*|\?\?\s*|\|\|\s*|(?<![=!<>])=(?!=)\s*|:\s*)(['"`])claude\1/u

test('no tool starts the claude on PATH, which the desktop app updates by itself: each runs the pinned one', () => {
  const tools = readdirSync(import.meta.dirname, { recursive: true, encoding: 'utf8' }).filter(name => /\.tsx?$/u.test(name) && !name.endsWith('.spec.ts'))
  expect(tools).toContain('pane_screens.ts')
  expect(tools.filter(name => BARE_CLAUDE.test(readFileSync(join(import.meta.dirname, name), 'utf8')))).toEqual([])
  // The forms a tool has used, or could: each is caught.
  for (const form of ["spawn('claude', [])", "values.claude ?? 'claude'", "values.claude || 'claude'", "const BIN = 'claude'", "{ claude: 'claude' }"]) {
    expect(BARE_CLAUDE.test(form)).toBe(true)
  }
  for (const form of ["new Set(['merged', 'claude', 'permission'])", "theme === 'claude'", "join(root, 'node_modules', '.bin', 'claude')"]) {
    expect(BARE_CLAUDE.test(form)).toBe(false)
  }
})
