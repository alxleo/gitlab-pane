import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

import { branchFree } from './release_tree.ts'

test('a root with no path named release passes', () => {
  expect(branchFree(['hooks', 'release-tree', 'releases.md'])).toEqual([])
})

test('a path named release at the root fails, since it makes `git checkout release` ambiguous', () => {
  expect(branchFree(['hooks', 'release'])).toEqual([expect.stringContaining('git checkout release')])
})

test('this repository has no path named release at its root', () => {
  expect(branchFree(readdirSync(join(import.meta.dirname, '..')))).toEqual([])
})
