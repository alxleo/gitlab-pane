import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

// A module of guards written each way a guard is exported, and of look-alikes that are not guards, in a folder of its own,
// beside the made-up file that imports them.
const FIXTURES = mkdtempSync(join(tmpdir(), 'lint-rules-'))
writeFileSync(
  join(FIXTURES, 'guards.ts'),
  [
    "export function isText(value: unknown): value is string { return typeof value === 'string' }",
    "export const isWord = function (value: unknown): value is string { return typeof value === 'string' }",
    "export function isLong(value: unknown): boolean { return typeof value === 'string' && value.length > 9 }",
    "function isHidden(value: unknown): value is string { return typeof value === 'string' }",
    'export { isHidden }',
    'export default function isDefault(value: unknown): value is string { return typeof value === "string" }',
    '',
  ].join('\n')
)
const IMPORTER = join(FIXTURES, 'importer.ts')
const guardOf = (imported: string, local: string) => `${imported}\nexport function isBox(value: unknown): value is string { return ${local}(value) }`

// The one assertion `no-type-assertion` allows here: inside the private function `brand`.
const ALLOWED = [{ allowed: { 'hooks/made-up.ts': { name: 'brand', isExported: false } } }]

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
    { name: 'a core file re-exports a name from a file outside the core', filename: CORE_FILE, code: "export { paneOf } from './pane'", errors: [{ messageId: 'outside' }] },
    { name: 'a core file requires a file outside the core', filename: CORE_FILE, code: "import pane = require('./pane')", errors: [{ messageId: 'outside' }] },
    {
      name: 'a core file names a type from a file outside the core',
      filename: CORE_FILE,
      code: "export type Pane = import('./pane.tsx').Pane",
      errors: [{ messageId: 'outside' }],
    },
    { name: 'a core file names a type from the engine', filename: CORE_FILE, code: "export type Ui = typeof import('claude-code')", errors: [{ messageId: 'engine' }] },
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
    { name: 'a guard that calls an exported function guard', filename: IMPORTER, code: guardOf("import { isText } from './guards.ts'", 'isText') },
    { name: 'a guard that calls an exported function-expression guard', filename: IMPORTER, code: guardOf("import { isWord } from './guards.ts'", 'isWord') },
    {
      name: 'the one assertion the config allows, in the function it names',
      filename: HOOK,
      options: ALLOWED,
      code: 'type Html = string & { readonly html: true }\nfunction brand(text: string): Html { return text as Html }\nexport const html = brand',
    },
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
    { name: '`<T>x` is refused', filename: HOOK, code: 'export const n = <unknown>JSON', errors: [{ messageId: 'angle' }] },
    {
      name: 'an overload implementation that returns more than its signatures is a cast',
      filename: HOOK,
      code: 'export function f(a: string): string\nexport function f(a: string | number): string | number { return a }',
      errors: [{ messageId: 'wider' }],
    },
    {
      name: 'a method overload that returns more than its signatures is a cast',
      filename: HOOK,
      code: 'export class C {\n  f(a: string): string\n  f(a: string | number): string | number { return a }\n}',
      errors: [{ messageId: 'wider' }],
    },
    {
      name: 'an overload inside a function body that returns more than its signatures is a cast',
      filename: HOOK,
      code: 'export function outer() {\n  function f(a: string): string\n  function f(a: string | number): string | number { return a }\n  return f\n}',
      errors: [{ messageId: 'wider' }],
    },
    {
      name: 'an arrow guard that only compares with null is a cast',
      filename: HOOK,
      code: 'export const isBox = (value: unknown): value is { a: 1 } => value !== null',
      errors: [{ messageId: 'guard' }],
    },
    {
      name: 'a function-expression guard that only compares with null is a cast',
      filename: HOOK,
      code: 'export const isBox = function (value: unknown): value is { a: 1 } { return value !== null }',
      errors: [{ messageId: 'guard' }],
    },
    {
      name: 'an exported function whose return type is boolean is not a guard, whatever its name',
      filename: IMPORTER,
      code: guardOf("import { isLong } from './guards.ts'", 'isLong'),
      errors: [{ messageId: 'guard' }],
    },
    {
      name: 'a guard exported by name rather than by declaration is not followed',
      filename: IMPORTER,
      code: guardOf("import { isHidden } from './guards.ts'", 'isHidden'),
      errors: [{ messageId: 'guard' }],
    },
    {
      name: 'a default import is not followed',
      filename: IMPORTER,
      code: guardOf("import isDefault from './guards.ts'", 'isDefault'),
      errors: [{ messageId: 'guard' }],
    },
    {
      name: 'an assertion outside the function the config names is refused',
      filename: HOOK,
      options: ALLOWED,
      code: 'export const n = (text: string) => text as unknown',
      errors: [{ messageId: 'forbidden' }],
    },
    {
      name: 'the allowed function exported, when the config says it is private, is refused',
      filename: HOOK,
      options: ALLOWED,
      code: 'export function brand(text: string): unknown { return text as unknown }',
      errors: [{ messageId: 'exported' }],
    },
    {
      name: 'a second assertion in the allowed function is refused',
      filename: HOOK,
      options: ALLOWED,
      code: 'function brand(text: string): unknown { return (text as unknown) ?? (text as unknown) }\nexport const b = brand',
      errors: [{ messageId: 'second' }],
    },
  ],
})

tester.run('no-module-state', ruleNamed('no-module-state'), {
  valid: [
    { name: 'a module-level const that is only read', filename: HOOK, code: 'const names = new Set<string>()\nexport const has = (name: string) => names.has(name)' },
    {
      name: 'a module the config allows keeps state',
      filename: HOOK,
      options: [{ allowedModules: { 'hooks/made-up.ts': 'the test says so' } }],
      code: 'let count = 0\nexport const next = () => ++count',
    },
  ],
  invalid: [
    { name: 'a module-level let', filename: HOOK, code: 'let count = 0\nexport const next = () => count + 1', errors: [{ messageId: 'letting' }] },
    {
      name: 'a let in a function that runs as the module loads is state kept in a closure',
      filename: HOOK,
      code: 'export const next = (() => {\n  let count = 0\n  return () => count + 1\n})()',
      errors: [{ messageId: 'closure' }],
    },
    {
      name: 'a const changed in a function that runs as the module loads',
      filename: HOOK,
      code: 'function start() {\n  const seen: string[] = []\n  seen.push("a")\n  return seen\n}\nexport const seen = start()',
      errors: [{ messageId: 'mutated' }],
    },
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
    {
      name: 'another file re-exports the name',
      filename: HOOK,
      options: [{ restricted: { fromGitLab: { allowed: ['hooks/gitlab.ts'], module: 'markdown', reason: 'it says so' } } }],
      code: "export { fromGitLab } from './markdown.ts'",
      errors: [{ messageId: 'name' }],
    },
    {
      name: 'a restriction the config misspells is reported, not dropped',
      filename: HOOK,
      options: [{ restricted: { fromGitLab: { allowed: ['hooks/gitlab.ts'], module: 'markdown', why: 'it says so' } } }],
      code: "import { fromGitLab } from './markdown.ts'",
      errors: [{ messageId: 'malformed' }],
    },
  ],
})
