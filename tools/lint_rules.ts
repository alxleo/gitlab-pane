// The rules oxlint has no built-in for, written here so that what each forbids and what it allows is in one place, and the
// allowance is an option of the rule in oxlint.config.ts, with its reason, never a comment next to the code. oxlint loads
// this file as a JS plugin, with Node stripping its types; JS plugins are alpha in oxlint and not under semver, which
// tools/lint_rules.spec.ts is there to catch.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

import { definePlugin, defineRule } from '@oxlint/plugins'
import type { Context, ESTree, Scope, SourceCode, Variable } from '@oxlint/plugins'
import { parseSync } from 'oxc-parser'

import { isRecord } from '../hooks/decode.ts'
import { coreInclude, ROOT } from './core.ts'

type Node = ESTree.Node
type Identifier = Extract<Node, { type: 'Identifier' }>
type AnyFunction = ESTree.Function | ESTree.ArrowFunctionExpression

const MUTATORS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin', 'set', 'add', 'delete', 'clear'])

/** The node as a function with a body to run, `function f() {}`, `function () {}` or `() =>`; undefined for anything else. */
function asFunction(node: Node): AnyFunction | undefined {
  return node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression' ? node : undefined
}

/** A node of the tree, as a child slot read by name holds it; anything else there (a string, null) is not walked. */
const isNode = (value: unknown): value is Node => isRecord(value) && typeof value['type'] === 'string'

/** The rule's first option, which each rule here takes as an object. */
function optionsOf(context: Context): Record<string, unknown> {
  const first: unknown = context.options[0]
  return isRecord(first) ? first : {}
}

/** The file being linted, relative to the repository and `/`-separated, as the options and the core list name files. */
const fileOf = (context: Context): string => relative(ROOT, context.filename).split(sep).join('/')

/** Calls `enter` on `node` and everything under it; `enter` answers false to skip a node's children. */
function walk(node: Node, keys: SourceCode['visitorKeys'], enter: (node: Node) => boolean): void {
  if (!enter(node)) {
    return
  }
  for (const key of keys[node.type] ?? []) {
    const child: unknown = Reflect.get(node, key)
    const children: unknown[] = Array.isArray(child) ? child : [child]
    for (const each of children) {
      if (isNode(each)) {
        walk(each, keys, enter)
      }
    }
  }
}

/** The enclosing function's name, for `function f` and `const f = () =>`, with whether it is exported. */
function enclosingName(node: Node): { name: string; isExported: boolean } | null {
  for (let each = node.parent; each !== null; each = each.parent) {
    if (each.type === 'FunctionDeclaration' && each.id !== null) {
      return { name: each.id.name, isExported: each.parent.type.startsWith('Export') }
    }
    if ((each.type === 'ArrowFunctionExpression' || each.type === 'FunctionExpression') && each.parent.type === 'VariableDeclarator' && each.parent.id.type === 'Identifier') {
      return { name: each.parent.id.name, isExported: each.parent.parent.parent?.type.startsWith('Export') ?? false }
    }
  }
  return null
}

/** The variable an identifier names, looked up from where it stands. */
function variableNamed(identifier: Identifier, source: SourceCode): Variable | undefined {
  for (let scope: Scope | null = source.getScope(identifier); scope !== null; scope = scope.upper) {
    const found = scope.set.get(identifier.name)
    if (found !== undefined) {
      return found
    }
  }
  return undefined
}

/** The function a name stands for, when it is written in this file as `function f` or `const f = () =>`. */
function functionNamed(identifier: Identifier, source: SourceCode): AnyFunction | undefined {
  const def = variableNamed(identifier, source)?.defs[0]
  if (def?.type === 'FunctionName') {
    return asFunction(def.node)
  }
  return def?.type === 'Variable' && def.node.type === 'VariableDeclarator' && def.node.init !== null ? asFunction(def.node.init) : undefined
}

/** The bindings that now hold the object `identifier` names, or something inside it: `const a = box`, `const { b } = box.c`, a loop variable, a parameter. */
function aliasesOf(identifier: Identifier, source: SourceCode): Variable[] {
  // An identifier, and each expression it is passed up through, sits inside another node: the walk up never reaches the
  // Program, which alone has no parent.
  let node: Node = identifier
  let parent = node.parent
  while (
    (parent.type === 'MemberExpression' && parent.object === node) ||
    (parent.type === 'ConditionalExpression' && parent.test !== node) ||
    parent.type === 'LogicalExpression'
  ) {
    node = parent
    parent = node.parent
  }
  const held = node
  if (parent.type === 'VariableDeclarator' && parent.init === held) {
    return source.getDeclaredVariables(parent)
  }
  if (parent.type === 'ForOfStatement' && parent.right === held && parent.left.type === 'VariableDeclaration') {
    return source.getDeclaredVariables(parent.left)
  }
  if (parent.type === 'AssignmentExpression' && parent.right === held && parent.left.type === 'Identifier') {
    const variable = variableNamed(parent.left, source)
    return variable !== undefined ? [variable] : []
  }
  if (parent.type === 'CallExpression' && parent.callee !== held && parent.callee.type === 'Identifier') {
    const fn = functionNamed(parent.callee, source)
    const param = fn?.params[parent.arguments.findIndex(each => each === held)]
    return fn !== undefined && param?.type === 'Identifier' ? source.getDeclaredVariables(fn).filter(variable => variable.name === param.name) : []
  }
  return []
}

/** The function a call at module level runs: written in place, or declared in the module and named. */
const calledFunction = (callee: Node, source: SourceCode): AnyFunction | undefined => (callee.type === 'Identifier' ? functionNamed(callee, source) : asFunction(callee))

/** `Object.assign` for a callee written that way, '' for any other. */
const textOf = (callee: Node): string =>
  callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'Identifier' && callee.property.type === 'Identifier'
    ? `${callee.object.name}.${callee.property.name}`
    : ''

/** How `identifier`, a reference to a module-level binding, is changed where it stands; undefined when it is only read. */
function mutation(identifier: Identifier): string | undefined {
  let node: Node = identifier
  let parent = node.parent
  while (parent.type === 'MemberExpression' && parent.object === node) {
    const member = parent
    node = member
    parent = member.parent
    if (parent.type === 'CallExpression' && parent.callee === member && !member.computed && member.property.type === 'Identifier' && MUTATORS.has(member.property.name)) {
      return `.${member.property.name}()`
    }
  }
  if (node !== identifier) {
    if (parent.type === 'AssignmentExpression' && parent.left === node) {
      return 'assigned to'
    }
    if (parent.type === 'UpdateExpression') {
      return '++ or --'
    }
    if (parent.type === 'UnaryExpression' && parent.operator === 'delete') {
      return 'delete'
    }
  }
  if (parent.type === 'CallExpression' && parent.arguments[0] === identifier && /^Object\.(assign|defineProperty)$/u.test(textOf(parent.callee))) {
    return 'Object.assign'
  }
  return undefined
}

/**
 * No state kept in a module's variables. A reload starts them over, a second session shares them, and a test cannot reset
 * them. It flags a module-level `let` or `var`, and a module-level `const` (or an import) that code changes: an assignment
 * to one of its members, `++`, `delete`, `Object.assign` onto it, or a call of `push`, `set`, `add` and the like on it. The
 * change is followed through every binding the object is handed to: another `const`, a destructuring, a loop variable, a
 * parameter of a function it is passed to. A function that runs as the module loads (an IIFE, or a call of a function
 * written in the module) is module-level too: a `let` or `var` in it is state kept in a closure, and so is a `const` there
 * that code changes.
 * Option `allowedModules`: `{ [file path ending]: reason }`, the modules that may, each with why.
 */
const noModuleState = defineRule({
  meta: {
    type: 'problem',
    schema: [{ type: 'object', properties: { allowedModules: { type: 'object' } }, additionalProperties: false }],
    messages: {
      letting: '`{{name}}` is module-level `let`: state in a module is shared and lost on reload. Keep it in an atom or in what the caller owns.',
      closure:
        '`{{name}}` is `let` in a function that runs as the module loads: a closure kept at module level is state in a module, shared and lost on reload. Keep it in an atom or in what the caller owns.',
      mutated: '`{{name}}` is module-level and is changed here ({{how}}): state in a module is shared and lost on reload. Keep it in an atom or in what the caller owns.',
    },
  },
  create(context) {
    const allowed = optionsOf(context)['allowedModules']
    const file = fileOf(context)
    if (isRecord(allowed) && Object.keys(allowed).some(ending => file.endsWith(ending))) {
      return {}
    }
    return {
      Program(program) {
        const source = context.sourceCode
        const manager = source.scopeManager
        const scope = manager.scopes.find(each => each.type === 'module') ?? manager.globalScope
        const tracked = new Set<Variable>()
        const inspected = new Set<AnyFunction>()

        /** Reports every change made to `variable`, and to each binding the object is passed on to. */
        const track = (variable: Variable, name: string): void => {
          if (tracked.has(variable)) {
            return
          }
          tracked.add(variable)
          for (const reference of variable.references) {
            const how = mutation(reference.identifier)
            if (how !== undefined) {
              context.report({ node: reference.identifier, messageId: 'mutated', data: { name, how } })
            }
            for (const alias of aliasesOf(reference.identifier, source)) {
              track(alias, name)
            }
          }
        }

        /** The functions called, in code that runs as the module loads, and not only declared. */
        const loading = (start: Node): void => {
          walk(start, source.visitorKeys, node => {
            if (asFunction(node) !== undefined) {
              return false
            }
            const fn = node.type === 'CallExpression' ? calledFunction(node.callee, source) : undefined
            if (fn !== undefined) {
              inspect(fn)
            }
            return true
          })
        }

        /** A function that runs as the module loads: no `let` in it, and no `const` in it that is changed. */
        const inspect = (fn: AnyFunction): void => {
          if (inspected.has(fn)) {
            return
          }
          inspected.add(fn)
          const own = manager.acquire(fn)
          if (own !== null) {
            const visit = (inner: Scope): void => {
              for (const variable of inner.variables) {
                const def = variable.defs[0]
                if (def?.type !== 'Variable') {
                  continue
                }
                if (def.parent?.type === 'VariableDeclaration' && def.parent.kind === 'const') {
                  track(variable, variable.name)
                } else {
                  context.report({ node: def.node, messageId: 'closure', data: { name: variable.name } })
                }
              }
              inner.childScopes.filter(child => child.variableScope === own.variableScope).forEach(visit)
            }
            visit(own)
          }
          if (fn.body !== null) {
            loading(fn.body)
          }
        }

        for (const variable of scope?.variables ?? []) {
          const def = variable.defs[0]
          if (def === undefined) {
            continue
          }
          if (def.type === 'Variable' && !(def.parent?.type === 'VariableDeclaration' && def.parent.kind === 'const')) {
            context.report({ node: def.node, messageId: 'letting', data: { name: variable.name } })
          } else {
            track(variable, variable.name)
          }
        }
        loading(program)
      },
    }
  },
})

/** Whether the subtree under `node` names `name`. */
function mentions(node: Node, name: string, keys: SourceCode['visitorKeys']): boolean {
  let found = false
  walk(node, keys, each => {
    found ||= each.type === 'Identifier' && each.name === name
    return !found
  })
  return found
}

/** The name a module exports a binding under: `export { a }` and `export { 'a' }` alike. */
const exportName = (name: ESTree.ModuleExportName): string => (name.type === 'Literal' ? name.value : name.name)

/** The file a relative module specifier names, as TypeScript's bundler resolution finds it; null for a package. */
function moduleFile(specifier: string, from: string): string | null {
  if (!specifier.startsWith('.')) {
    return null
  }
  const base = resolve(dirname(from), specifier)
  return [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find(each => existsSync(each) && statSync(each).isFile()) ?? null
}

/**
 * Whether the module in `file` exports `name` as a type guard: `export function name(x): x is T` or `export const name =
 * (x): x is T =>`. The guard's own body is held to testing its value when that file is linted, so a call of it tests too.
 * Anything this does not find (a re-export, a namespace) is not taken for a guard.
 */
function exportsGuard(file: string, name: string): boolean {
  const { program } = parseSync(file, readFileSync(file, 'utf8'))
  for (const statement of program.body) {
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : null
    if (declaration?.type === 'FunctionDeclaration' && declaration.id?.name === name) {
      return declaration.returnType?.typeAnnotation.type === 'TSTypePredicate'
    }
    for (const each of declaration?.type === 'VariableDeclaration' ? declaration.declarations : []) {
      if (each.id.type === 'Identifier' && each.id.name === name && (each.init?.type === 'ArrowFunctionExpression' || each.init?.type === 'FunctionExpression')) {
        return each.init.returnType?.typeAnnotation.type === 'TSTypePredicate'
      }
    }
  }
  return false
}

/**
 * Whether a call is of a function that is itself a type guard: one written in this file, or imported by name from a module
 * of this repository, whose return type is `x is T`. The guard is found by its declaration, never by its name.
 */
function isGuardCall(call: ESTree.CallExpression, context: Context): boolean {
  if (call.callee.type !== 'Identifier') {
    return false
  }
  const fn = functionNamed(call.callee, context.sourceCode)
  if (fn !== undefined) {
    return fn.returnType?.typeAnnotation.type === 'TSTypePredicate'
  }
  const def = variableNamed(call.callee, context.sourceCode)?.defs[0]
  if (def?.type !== 'ImportBinding' || def.node.type !== 'ImportSpecifier' || def.parent?.type !== 'ImportDeclaration') {
    return false
  }
  const file = moduleFile(def.parent.source.value, context.filename)
  return file !== null && exportsGuard(file, exportName(def.node.imported))
}

/** Whether a guard's body tests the value it narrows: `typeof`, `in`, `instanceof`, `Array.isArray`, `Object.hasOwn`, or another guard. */
function testsShape(body: Node, name: string, context: Context): boolean {
  const keys = context.sourceCode.visitorKeys
  let found = false
  walk(body, keys, node => {
    if (found) {
      return false
    }
    const isTest =
      (node.type === 'UnaryExpression' && node.operator === 'typeof') ||
      (node.type === 'BinaryExpression' && (node.operator === 'in' || node.operator === 'instanceof')) ||
      (node.type === 'CallExpression' && (/^(Array\.isArray|Object\.hasOwn)$/u.test(textOf(node.callee)) || isGuardCall(node, context)))
    found = isTest && mentions(node, name, keys)
    return !found
  })
  return found
}

const typeText = (node: Node, source: SourceCode): string => source.getText(node).replace(/\s+/gu, '')

/** The parts of a return type that are alternatives: `A | B` is two, anything else is one. */
const alternatives = (node: ESTree.TSType): ESTree.TSType[] => (node.type === 'TSUnionType' ? node.types : [node])

/** What an `export` statement declares, or the statement itself. */
function declared(statement: Node): Node {
  if (statement.type === 'ExportNamedDeclaration') {
    return statement.declaration ?? statement
  }
  return statement.type === 'ExportDefaultDeclaration' ? statement.declaration : statement
}

/** A method's name as overloads share it: `static ` before a static one's. */
function methodKey(method: ESTree.MethodDefinition): string | undefined {
  const key = method.key
  const name = key.type === 'Identifier' || key.type === 'PrivateIdentifier' ? key.name : key.type === 'Literal' ? String(key.value) : undefined
  return name === undefined ? undefined : `${method.static ? 'static ' : ''}${name}`
}

/**
 * The statements of one body, with each overloaded function's signatures and its implementation: `function f(a): A;
 * function f(a: A | B): A | B { … }`. Yields `{ signatures, implementation }` for each.
 */
function* overloaded(body: readonly Node[]): Generator<{ signatures: ESTree.Function[]; implementation: ESTree.Function }> {
  const pending = new Map<string, ESTree.Function[]>()
  for (const statement of body) {
    const node = declared(statement)
    const isMethod = node.type === 'MethodDefinition' || node.type === 'TSAbstractMethodDefinition'
    const fn = isMethod ? node.value : node.type === 'TSDeclareFunction' || node.type === 'FunctionDeclaration' ? node : undefined
    const key = isMethod ? methodKey(node) : fn?.id?.name
    if (fn === undefined || key === undefined) {
      continue
    }
    const signatures = pending.get(key)
    if (fn.type === 'TSDeclareFunction' || fn.type === 'TSEmptyBodyFunctionExpression') {
      pending.set(key, [...(signatures ?? []), fn])
    } else if (signatures !== undefined) {
      yield { signatures, implementation: fn }
      pending.delete(key)
    }
  }
}

/**
 * No type assertions: `x as T` and `<T>x` tell the compiler what it should have been shown. `as const` is not one. Two
 * ways round that are shut as well. A type guard (`x is T`) is a promise the compiler cannot check, so its body must test the
 * value (`typeof`, `in`, `instanceof`, `Array.isArray`, `Object.hasOwn`, or a call of another guard); a guard that only
 * compares with `null` is left unannotated, and the compiler works the guard out. The implementation of overloaded
 * functions must return no more than their signatures do, or the overload is a cast: its return type is written, and is
 * the signatures' return types or a union of them.
 * Option `allowed`: `{ [file path ending]: { name, isExported } }`: in that file one assertion is allowed, inside that function,
 * which is exported or not as stated. The function is the file's single place where outside data, or a string, is given a type.
 */
const noTypeAssertion = defineRule({
  meta: {
    type: 'problem',
    schema: [{ type: 'object', properties: { allowed: { type: 'object' } }, additionalProperties: false }],
    messages: {
      forbidden: 'No `as T`: it hides a wrong type. Narrow with a type guard (`value is T`) or check the value, or give it its type where it is made.',
      angle: 'No `<T>x` assertion: it hides a wrong type. Narrow with a type guard or check the value.',
      second: 'A second assertion in {{name}}: the one allowed here is the only one.',
      exported: '{{name}} is exported, or not, other than the config says: a private constructor must stay private.',
      guard:
        'The guard says `{{name}} is {{type}}` but its body never tests `{{name}}` (`typeof`, `in`, `instanceof`, `Array.isArray`, or a call of another guard): that is a cast. Test the shape, or drop the annotation and let the compiler work the guard out.',
      untyped: "An overloaded function's implementation needs its return type written: it must be the signatures' return types, no wider.",
      wider: "The implementation returns `{{type}}`, which is not one of its overloads' return types: an overload that returns more than it declares is a cast.",
    },
  },
  create(context) {
    const allowed = optionsOf(context)['allowed']
    const file = fileOf(context)
    const here = isRecord(allowed) ? Object.entries(allowed).find(([ending]) => file.endsWith(ending))?.[1] : undefined
    const permit = isRecord(here) ? here : null
    const source = context.sourceCode
    let used = 0

    const checkGuard = (fn: AnyFunction): void => {
      const predicate = fn.returnType?.typeAnnotation
      if (predicate?.type !== 'TSTypePredicate' || predicate.parameterName.type !== 'Identifier' || predicate.typeAnnotation === null) {
        return
      }
      const name = predicate.parameterName.name
      if (fn.body === null || !testsShape(fn.body, name, context)) {
        context.report({ node: predicate, messageId: 'guard', data: { name, type: source.getText(predicate.typeAnnotation.typeAnnotation) } })
      }
    }

    const checkOverloads = (body: readonly Node[]): void => {
      for (const { signatures, implementation } of overloaded(body)) {
        const written = implementation.returnType?.typeAnnotation
        if (written === undefined) {
          context.report({ node: implementation, messageId: 'untyped' })
          continue
        }
        const declaredTypes = new Set(
          signatures.flatMap(each => {
            const returned = each.returnType?.typeAnnotation
            return returned === undefined ? [] : alternatives(returned).map(part => typeText(part, source))
          })
        )
        for (const part of alternatives(written)) {
          if (!declaredTypes.has(typeText(part, source))) {
            context.report({ node: written, messageId: 'wider', data: { type: source.getText(part) } })
          }
        }
      }
    }

    return {
      Program: node => checkOverloads(node.body),
      BlockStatement: node => checkOverloads(node.body),
      ClassBody: node => checkOverloads(node.body),
      TSModuleBlock: node => checkOverloads(node.body),
      FunctionDeclaration: checkGuard,
      FunctionExpression: checkGuard,
      ArrowFunctionExpression: checkGuard,
      TSTypeAssertion(node) {
        context.report({ node, messageId: 'angle' })
      },
      TSAsExpression(node) {
        const type = node.typeAnnotation
        if (type.type === 'TSTypeReference' && type.typeName.type === 'Identifier' && type.typeName.name === 'const') {
          return
        }
        const inside = permit !== null ? enclosingName(node) : null
        if (permit === null || inside === null || inside.name !== permit['name']) {
          context.report({ node, messageId: 'forbidden' })
        } else if (inside.isExported !== permit['isExported']) {
          context.report({ node, messageId: 'exported', data: { name: inside.name } })
        } else if (++used > 1) {
          context.report({ node, messageId: 'second', data: { name: inside.name } })
        }
      },
    }
  },
})

/** One name `only-importers` keeps to its listed importers. */
interface Restriction {
  readonly allowed: readonly string[]
  readonly module: string
  readonly reason: string
}

/** A restriction as the config writes it, or null when a field is missing, misspelled or of the wrong kind. */
function restrictionOf(value: unknown): Restriction | null {
  if (!isRecord(value) || Object.keys(value).some(key => !['allowed', 'module', 'reason'].includes(key))) {
    return null
  }
  const { allowed, module, reason } = value
  if (typeof module !== 'string' || typeof reason !== 'string' || !Array.isArray(allowed) || allowed.length === 0 || !allowed.every(each => typeof each === 'string')) {
    return null
  }
  return { allowed: allowed.filter(each => typeof each === 'string'), module, reason }
}

/**
 * A name only the listed files may import, so a function that stamps a value as trusted can be called from one place and
 * nowhere else. Options: `{ restricted: { <name>: { allowed: [<file ending>…], module: <source ending>, reason } } }`. It
 * refuses importing the name, re-exporting it, and a namespace import of its module, which would reach it by another way.
 */
const onlyImporters = defineRule({
  meta: {
    type: 'problem',
    schema: [{ type: 'object' }],
    messages: {
      name: '{{name}} may be imported only by {{allowed}}: {{reason}}',
      namespace: 'A namespace import of {{module}} reaches {{name}}, which only {{allowed}} may use: {{reason}}',
      malformed: 'The only-importers option for {{name}} needs `allowed` (file endings), `module` and `reason`; until it has them, nothing keeps {{name}} to its importers.',
    },
  },
  create(context) {
    const listed = optionsOf(context)['restricted']
    const entries = (isRecord(listed) ? Object.entries(listed) : []).map(([name, value]) => ({ name, rule: restrictionOf(value) }))
    const restricted = entries.flatMap(({ name, rule }) => (rule !== null ? [{ name, rule }] : []))
    const malformed = entries.filter(({ rule }) => rule === null).map(({ name }) => name)
    const file = fileOf(context)
    const refuse = (node: Node, name: string, rule: Restriction, messageId: 'name' | 'namespace'): void => {
      if (!rule.allowed.some(ending => file.endsWith(ending))) {
        context.report({ node, messageId, data: { name, allowed: rule.allowed.join(', '), reason: rule.reason, module: rule.module } })
      }
    }
    const endsModule = (source: string, rule: Restriction): boolean => source === rule.module || source.endsWith(`/${rule.module}`) || source.endsWith(`/${rule.module}.ts`)
    return {
      // A restriction the config gets wrong is said in every file, so the rule cannot drop out unseen.
      Program(program) {
        for (const name of malformed) {
          context.report({ node: program, messageId: 'malformed', data: { name } })
        }
      },
      ImportSpecifier(node) {
        for (const { name, rule } of restricted) {
          if (exportName(node.imported) === name) {
            refuse(node, name, rule, 'name')
          }
        }
      },
      ExportSpecifier(node) {
        for (const { name, rule } of restricted) {
          if (node.parent.type === 'ExportNamedDeclaration' && node.parent.source !== null && exportName(node.local) === name) {
            refuse(node, name, rule, 'name')
          }
        }
      },
      ImportNamespaceSpecifier(node) {
        for (const { name, rule } of restricted) {
          if (node.parent.type === 'ImportDeclaration' && endsModule(node.parent.source.value, rule)) {
            refuse(node, name, rule, 'namespace')
          }
        }
      },
    }
  },
})

/**
 * What the core may import: core files, each by its `.ts` path (tools/gitlab_schema.ts runs gitlab-documents.ts under plain
 * Node, which needs the extension), the types contract (`../types`), and no part of the engine (`claude-code`). The core is
 * what tsconfig.core.json includes, read when the rule starts; a file outside it is not checked. Every way a module is
 * named counts: `import`, `export … from`, `export * from`, `import x = require()`, a type's `import('…')`, and `import()`,
 * whose argument must then be written out.
 */
const coreImports = defineRule({
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      engine: 'The core runs on plain data and imports nothing from the engine. Put engine code in a file outside the core.',
      outside: 'The core imports only core files, each with its .ts extension, and ../types. If this module is pure, add it to tsconfig.core.json.',
      unnamed: 'An `import()` in the core names its module as a string, so the core-imports rule can check it.',
    },
  },
  create(context) {
    const include = coreInclude()
    const file = fileOf(context)
    if (!include.includes(file)) {
      return {}
    }
    const check = (node: Node, specifier: string): void => {
      if (specifier === 'claude-code' || specifier.startsWith('claude-code/')) {
        context.report({ node, messageId: 'engine' })
        return
      }
      if (!specifier.startsWith('.')) {
        return
      }
      const target = relative(ROOT, resolve(dirname(context.filename), specifier))
        .split(sep)
        .join('/')
      const isCoreFile = specifier.endsWith('.ts') && include.includes(target)
      const isContract = !/\.[a-z]+$/u.test(specifier) && include.includes(`${target}/index.d.ts`)
      if (!isCoreFile && !isContract) {
        context.report({ node, messageId: 'outside' })
      }
    }
    return {
      ImportDeclaration: node => check(node, node.source.value),
      ExportAllDeclaration: node => check(node, node.source.value),
      ExportNamedDeclaration(node) {
        if (node.source !== null) {
          check(node, node.source.value)
        }
      },
      ImportExpression(node) {
        if (node.source.type === 'Literal' && typeof node.source.value === 'string') {
          check(node, node.source.value)
        } else {
          context.report({ node, messageId: 'unnamed' })
        }
      },
      TSImportEqualsDeclaration(node) {
        if (node.moduleReference.type === 'TSExternalModuleReference') {
          check(node, node.moduleReference.expression.value)
        }
      },
      TSImportType: node => check(node, node.source.value),
    }
  },
})

export default definePlugin({
  meta: { name: 'local' },
  rules: { 'core-imports': coreImports, 'no-module-state': noModuleState, 'no-type-assertion': noTypeAssertion, 'only-importers': onlyImporters },
})
