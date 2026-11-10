import { join } from 'node:path'

import type { Rule } from '@oxlint/plugins'
import { RuleTester } from 'oxlint/plugins-dev'
import { describe, it } from 'vitest'

import { ROOT } from './core.ts'
import plugin from './lint_rules.ts'

RuleTester.describe = describe
RuleTester.it = it
const tester = new RuleTester()

function ruleNamed(name: string): Rule {
  const rule = plugin.rules[name]
  if (rule === undefined) {
    throw new Error(`tools/lint_rules.ts has no rule ${name}`)
  }
  return rule
}

// A file of the core (tsconfig.core.json lists it) and one outside it, both in hooks/, where relative imports resolve.
const CORE_FILE = join(ROOT, 'hooks', 'attention.ts')
const ENGINE_FILE = join(ROOT, 'hooks', 'pane.tsx')
// A file the tests make up in hooks/, so that `./decode.ts` is the real decode.ts.
const HOOK = join(ROOT, 'hooks', 'made-up.ts')

tester.run('core-imports', ruleNamed('core-imports'), {
  valid: [
    { name: 'a core file imports another by its .ts path', filename: CORE_FILE, code: "import { isRecord } from './decode.ts'" },
    { name: 'a core file imports the types contract', filename: CORE_FILE, code: "import type { Mr } from '../types'" },
    { name: 'a core file re-exports a core file', filename: CORE_FILE, code: "export { isRecord } from './decode.ts'" },
    { name: 'a package other than the engine is left to tsconfig.core.json', filename: CORE_FILE, code: "import { parse } from 'graphql'" },
    { name: 'a file outside the core imports what it likes', filename: ENGINE_FILE, code: "import { h } from 'claude-code'\nimport { cardOf } from './card'" },
  ],
  invalid: [
    { name: 'a core file imports a file outside the core', filename: CORE_FILE, code: "import { paneOf } from './pane'", errors: [{ messageId: 'outside' }] },
    { name: 'a core file imports a core file without its extension', filename: CORE_FILE, code: "import { isRecord } from './decode'", errors: [{ messageId: 'outside' }] },
    { name: 'a core file reaches a dev tool', filename: CORE_FILE, code: "import { ROOT } from '../tools/core.ts'", errors: [{ messageId: 'outside' }] },
    { name: 'a core file re-exports all of a file outside the core', filename: CORE_FILE, code: "export * from './card.tsx'", errors: [{ messageId: 'outside' }] },
    { name: 'a core file names its module in import()', filename: CORE_FILE, code: "export const late = () => import('./pane.tsx')", errors: [{ messageId: 'outside' }] },
    { name: 'a core file computes its import()', filename: CORE_FILE, code: 'export const late = (name: string) => import(name)', errors: [{ messageId: 'unnamed' }] },
    { name: 'a core file imports the engine', filename: CORE_FILE, code: "import { h } from 'claude-code'", errors: [{ messageId: 'engine' }] },
    { name: 'a core file imports part of the engine', filename: CORE_FILE, code: "import type { Ui } from 'claude-code/ui'", errors: [{ messageId: 'engine' }] },
  ],
})

tester.run('no-type-assertion', ruleNamed('no-type-assertion'), {
  valid: [
    {
      name: 'a guard that tests its value through a guard imported by its .ts path',
      filename: HOOK,
      code: "import { isRecord } from './decode.ts'\nexport function isBox(value: unknown): value is { a: 1 } { return isRecord(value) }",
    },
    {
      name: 'a guard that tests its value through a guard imported without an extension',
      filename: HOOK,
      code: "import { isRecord as isObject } from './decode'\nexport const isBox = (value: unknown): value is { a: 1 } => isObject(value)",
    },
    {
      name: 'a guard that tests its value through a guard of the same file',
      filename: HOOK,
      code: "const isText = (value: unknown): value is string => typeof value === 'string'\nexport function isName(value: unknown): value is string { return isText(value) }",
    },
    { name: '`as const` is not an assertion', filename: HOOK, code: "export const sizes = ['s', 'm'] as const" },
  ],
  invalid: [
    {
      name: 'an imported function whose name reads like a guard, but whose return type is not `x is T`, does not test the value',
      filename: HOOK,
      code: "import { isSome } from './decode.ts'\nexport function isBox(value: unknown): value is { a: 1 } { return isSome(value) }",
      errors: [{ messageId: 'guard' }],
    },
    {
      name: 'a function imported from a module that does not resolve is not taken for a guard',
      filename: HOOK,
      code: "import { isBox as isAny } from './missing.ts'\nexport function isBox(value: unknown): value is { a: 1 } { return isAny(value) }",
      errors: [{ messageId: 'guard' }],
    },
    {
      name: 'a function imported from a package is not taken for a guard',
      filename: HOOK,
      code: "import { isBox as isAny } from 'some-package'\nexport function isBox(value: unknown): value is { a: 1 } { return isAny(value) }",
      errors: [{ messageId: 'guard' }],
    },
    {
      name: 'a guard that only compares with null is a cast',
      filename: HOOK,
      code: 'export function isBox(value: unknown): value is { a: 1 } { return value !== null }',
      errors: [{ messageId: 'guard' }],
    },
    { name: '`as T` is refused', filename: HOOK, code: 'export const n = JSON as unknown', errors: [{ messageId: 'forbidden' }] },
    {
      name: 'an overload implementation that returns more than its signatures is a cast',
      filename: HOOK,
      code: 'export function f(a: string): string\nexport function f(a: string | number): string | number { return a }',
      errors: [{ messageId: 'wider' }],
    },
  ],
})

tester.run('no-module-state', ruleNamed('no-module-state'), {
  valid: [{ name: 'a module-level const that is only read', filename: HOOK, code: 'const names = new Set<string>()\nexport const has = (name: string) => names.has(name)' }],
  invalid: [
    { name: 'a module-level let', filename: HOOK, code: 'let count = 0\nexport const next = () => count + 1', errors: [{ messageId: 'letting' }] },
    {
      name: 'a module-level const changed through a parameter it is passed to',
      filename: HOOK,
      code: 'const seen: string[] = []\nfunction remember(list: string[], name: string) { list.push(name) }\nexport const see = (name: string) => remember(seen, name)',
      errors: [{ messageId: 'mutated' }],
    },
  ],
})

tester.run('only-importers', ruleNamed('only-importers'), {
  valid: [
    {
      name: 'the listed file imports the name',
      filename: join(ROOT, 'hooks', 'gitlab.ts'),
      options: [{ restricted: { fromGitLab: { allowed: ['hooks/gitlab.ts'], module: 'markdown', reason: 'it says so' } } }],
      code: "import { fromGitLab } from './markdown.ts'",
    },
  ],
  invalid: [
    {
      name: 'another file imports the name',
      filename: HOOK,
      options: [{ restricted: { fromGitLab: { allowed: ['hooks/gitlab.ts'], module: 'markdown', reason: 'it says so' } } }],
      code: "import { fromGitLab } from './markdown.ts'",
      errors: [{ messageId: 'name' }],
    },
    {
      name: 'another file imports the module as a namespace',
      filename: HOOK,
      options: [{ restricted: { fromGitLab: { allowed: ['hooks/gitlab.ts'], module: 'markdown', reason: 'it says so' } } }],
      code: "import * as markdown from './markdown.ts'",
      errors: [{ messageId: 'namespace' }],
    },
  ],
})
