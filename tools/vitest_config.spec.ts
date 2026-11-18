import { realpathSync } from 'node:fs'
import { join } from 'node:path'

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

test('each kind of spec runs with exactly the ban: reads of the repository and its packages, and for the tools their parsers', () => {
  const ban = ['--permission', `--allow-fs-read=${ROOT}`, `--allow-fs-read=${realpathSync(join(ROOT, 'node_modules'))}`]
  expect(PROJECTS.map(({ test: project }) => [project.name, project.execArgv])).toEqual([
    ['core', ban],
    ['tools', [...ban, '--allow-addons', '--disable-warning=PERM0001']],
  ])
})
