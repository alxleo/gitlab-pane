import { expect, test } from 'vitest'

import { PROJECTS } from '../vitest.config.ts'
import { ROOT } from './core.ts'

// Without these, removing the ban from vitest.config.ts would leave every test green.

test('a tool spec may read the repository and nothing else, and may not write, start a process or thread, or connect', () => {
  const { permission } = process
  expect(permission.has('fs.read', ROOT)).toBe(true)
  expect(permission.has('fs.read', '/etc')).toBe(false)
  expect(permission.has('fs.write')).toBe(false)
  expect(permission.has('child')).toBe(false)
  expect(permission.has('worker')).toBe(false)
  expect(permission.has('net')).toBe(false)
})

test('every kind of spec runs under the ban, reading only the repository, and none is let write, spawn or connect', () => {
  for (const { test: project } of PROJECTS) {
    expect(project.execArgv.slice(0, 2)).toEqual(['--permission', `--allow-fs-read=${ROOT}`])
    expect(project.execArgv.filter(flag => /^--allow-(?:fs-write|child-process|worker|net|wasi|inspector)/u.test(flag))).toEqual([])
  }
  expect(PROJECTS.map(({ test: project }) => project.name)).toEqual(['core', 'tools'])
})
