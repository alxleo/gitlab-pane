import type { ResolveFnOutput, ResolveHookContext } from 'node:module'

import { expect, test } from 'vitest'

import { resolveTs } from './resolve_ts.ts'

const CONTEXT: ResolveHookContext = { conditions: ['node', 'import'], importAttributes: {}, parentURL: 'file:///repo/hooks/decode.ts' }

/** An error as Node throws it for an import no file answers. */
const notFound = (specifier: string): Error => Object.assign(new Error(`Cannot find module '${specifier}'`), { code: 'ERR_MODULE_NOT_FOUND' })

/** Node's own resolution, which finds only `files` and refuses the rest with `refusal`. */
const nodeFinding =
  (files: readonly string[], refusal: (specifier: string) => Error = notFound) =>
  (specifier: string): ResolveFnOutput => {
    if (files.includes(specifier)) {
      return { url: `file:///repo/hooks/${specifier}`, format: 'module-typescript' }
    }
    throw refusal(specifier)
  }

test('a relative import Node cannot find is found by its .ts file', () => {
  expect(resolveTs('./failure', CONTEXT, nodeFinding(['./failure.ts'])).url).toBe('file:///repo/hooks/./failure.ts')
})

test('an import Node finds resolves as Node says, without trying .ts', () => {
  expect(resolveTs('./failure.ts', CONTEXT, nodeFinding(['./failure.ts', './failure.ts.ts'])).url).toBe('file:///repo/hooks/./failure.ts')
})

test('a relative import missing with .ts too fails with Node’s error for the import as written', () => {
  expect(() => resolveTs('./gone', CONTEXT, nodeFinding([]))).toThrow("Cannot find module './gone'")
})

test('a package Node cannot find is not tried with .ts', () => {
  expect(() => resolveTs('yaml', CONTEXT, nodeFinding(['yaml.ts']))).toThrow("Cannot find module 'yaml'")
})

test('a relative import Node refuses for another reason is not tried with .ts', () => {
  const refusal = (specifier: string): Error => Object.assign(new Error(`${specifier} is a directory`), { code: 'ERR_UNSUPPORTED_DIR_IMPORT' })
  expect(() => resolveTs('./types', CONTEXT, nodeFinding(['./types.ts'], refusal))).toThrow('./types is a directory')
})
