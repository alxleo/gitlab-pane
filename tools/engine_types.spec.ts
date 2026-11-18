import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'vitest'

import { claudeVersion, head, unpackDeclarations } from './engine_types.ts'

test('with no claude on PATH the version is empty, so the tool can say so instead of crashing', () => {
  const path = process.env['PATH']
  process.env['PATH'] = mkdtempSync(join(tmpdir(), 'engine-types-empty-path-'))
  try {
    expect(claudeVersion()).toBe('')
  } finally {
    rmSync(process.env['PATH'], { recursive: true, force: true })
    process.env['PATH'] = path
  }
})

// The claude on PATH, as every check uses it: CI installs the pinned version before the tests run.
test("the claude on PATH unpacks its declarations into the folder it is given, not the machine's shared temp folder", () => {
  const version = claudeVersion()
  const work = mkdtempSync(join(tmpdir(), 'engine-types-spec-'))
  try {
    const source = unpackDeclarations(version, work)
    expect(source).toBeDefined()
    expect(head(source ?? '')).toBe(`// Written by Claude Code ${version}.`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}, 120_000)
