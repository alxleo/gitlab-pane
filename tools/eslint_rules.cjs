// The two rules ESLint has no built-in for, written here so that what each forbids and what it allows is in one place, and
// the allowance is an option of the rule in eslint.config.cjs, with its reason, never a comment next to the code.

const MUTATORS = new Set([
  'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin', 'set', 'add', 'delete', 'clear',
])

const isFunction = node =>
  node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression'

/** Calls `enter` on `node` and everything under it; `enter` answers false to skip a node's children. */
function walk(node, keys, enter) {
  if (!node || typeof node.type !== 'string' || enter(node) === false) {
    return
  }
  for (const key of keys[node.type] ?? []) {
    const child = node[key]
    for (const each of Array.isArray(child) ? child : [child]) {
      walk(each, keys, enter)
    }
  }
}

/** The enclosing function's name, for `function f` and `const f = () =>`, with whether it is exported. */
function enclosingName(node) {
  for (let each = node.parent; each; each = each.parent) {
    if (each.type === 'FunctionDeclaration' && each.id) {
      return { name: each.id.name, isExported: each.parent.type.startsWith('Export') }
    }
    if (
      (each.type === 'ArrowFunctionExpression' || each.type === 'FunctionExpression') &&
      each.parent.type === 'VariableDeclarator' &&
      each.parent.id.type === 'Identifier'
    ) {
      return { name: each.parent.id.name, isExported: each.parent.parent.parent.type.startsWith('Export') }
    }
  }
  return null
}

/** The variable an identifier names, looked up from where it stands. */
function variableNamed(identifier, source) {
  for (let scope = source.getScope(identifier); scope; scope = scope.upper) {
    const found = scope.set.get(identifier.name)
    if (found) {
      return found
    }
  }
  return undefined
}

/** The function a name stands for, when it is written in this file as `function f` or `const f = () =>`. */
function functionNamed(identifier, source) {
  const def = variableNamed(identifier, source)?.defs[0]
  if (def?.type === 'FunctionName') {
    return def.node
  }
  return def?.type === 'Variable' && def.node.init && isFunction(def.node.init) ? def.node.init : undefined
}

/** The bindings that now hold the object `identifier` names, or something inside it: `const a = box`, `const { b } = box.c`, a loop variable, a parameter. */
function aliasesOf(identifier, source) {
  let node = identifier
  for (;;) {
    const parent = node.parent
    const isPassedThrough =
      (parent.type === 'MemberExpression' && parent.object === node) ||
      (parent.type === 'ConditionalExpression' && parent.test !== node) ||
      parent.type === 'LogicalExpression'
    if (!isPassedThrough) {
      break
    }
    node = parent
  }
  const parent = node.parent
  if (parent.type === 'VariableDeclarator' && parent.init === node) {
    return source.getDeclaredVariables(parent)
  }
  if (parent.type === 'ForOfStatement' && parent.right === node && parent.left.type === 'VariableDeclaration') {
    return source.getDeclaredVariables(parent.left)
  }
  if (parent.type === 'AssignmentExpression' && parent.right === node && parent.left.type === 'Identifier') {
    const variable = variableNamed(parent.left, source)
    return variable ? [variable] : []
  }
  if (parent.type === 'CallExpression' && parent.callee !== node && parent.callee.type === 'Identifier') {
    const fn = functionNamed(parent.callee, source)
    const param = fn?.params[parent.arguments.indexOf(node)]
    return param?.type === 'Identifier' ? source.getDeclaredVariables(fn).filter(variable => variable.name === param.name) : []
  }
  return []
}

/** The function a call at module level runs: written in place, or declared in the module and named. */
function calledFunction(callee, source) {
  if (isFunction(callee)) {
    return callee
  }
  return callee.type === 'Identifier' ? functionNamed(callee, source) : undefined
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
const noModuleState = {
  meta: {
    type: 'problem',
    schema: [{ type: 'object', properties: { allowedModules: { type: 'object' } }, additionalProperties: false }],
    messages: {
      letting: '`{{name}}` is module-level `let`: state in a module is shared and lost on reload. Keep it in an atom or in what the caller owns.',
      closure: '`{{name}}` is `let` in a function that runs as the module loads: a closure kept at module level is state in a module, shared and lost on reload. Keep it in an atom or in what the caller owns.',
      mutated: '`{{name}}` is module-level and is changed here ({{how}}): state in a module is shared and lost on reload. Keep it in an atom or in what the caller owns.',
    },
  },
  create(context) {
    const allowed = (context.options[0] ?? {}).allowedModules ?? {}
    const file = context.filename.replaceAll('\\', '/')
    if (Object.keys(allowed).some(ending => file.endsWith(ending))) {
      return {}
    }
    return {
      Program(program) {
        const source = context.sourceCode
        const manager = source.scopeManager
        const scope = manager.scopes.find(each => each.type === 'module') ?? manager.globalScope
        const tracked = new Set()
        const inspected = new Set()

        /** Reports every change made to `variable`, and to each binding the object is passed on to. */
        const track = (variable, name) => {
          if (tracked.has(variable)) {
            return
          }
          tracked.add(variable)
          for (const reference of variable.references) {
            const how = mutation(reference.identifier)
            if (how) {
              context.report({ node: reference.identifier, messageId: 'mutated', data: { name, how } })
            }
            for (const alias of aliasesOf(reference.identifier, source)) {
              track(alias, name)
            }
          }
        }

        /** The functions called, in code that runs as the module loads, and not only declared. */
        const loading = start => {
          walk(start, source.visitorKeys, node => {
            if (isFunction(node)) {
              return false
            }
            const fn = node.type === 'CallExpression' ? calledFunction(node.callee, source) : undefined
            if (fn) {
              inspect(fn)
            }
            return true
          })
        }

        /** A function that runs as the module loads: no `let` in it, and no `const` in it that is changed. */
        const inspect = fn => {
          if (inspected.has(fn)) {
            return
          }
          inspected.add(fn)
          const own = manager.acquire(fn)
          const visit = inner => {
            for (const variable of inner.variables) {
              const def = variable.defs[0]
              if (def?.type !== 'Variable') {
                continue
              }
              if (def.parent.kind === 'const') {
                track(variable, variable.name)
              } else {
                context.report({ node: def.node, messageId: 'closure', data: { name: variable.name } })
              }
            }
            inner.childScopes.filter(child => child.variableScope === own.variableScope).forEach(visit)
          }
          if (own) {
            visit(own)
          }
          loading(fn.body)
        }

        for (const variable of scope.variables) {
          const def = variable.defs[0]
          if (!def) {
            continue
          }
          if (def.type === 'Variable' && def.parent.kind !== 'const') {
            context.report({ node: def.node, messageId: 'letting', data: { name: variable.name } })
          } else {
            track(variable, variable.name)
          }
        }
        loading(program)
      },
    }
  },
}

/** How `identifier`, a reference to a module-level binding, is changed where it stands; undefined when it is only read. */
function mutation(identifier) {
  let node = identifier
  while (node.parent.type === 'MemberExpression' && node.parent.object === node) {
    node = node.parent
    const call = node.parent
    if (call.type === 'CallExpression' && call.callee === node && !node.computed && MUTATORS.has(node.property.name)) {
      return `.${node.property.name}()`
    }
  }
  const parent = node.parent
  if (node !== identifier) {
    if (parent.type === 'AssignmentExpression' && parent.left === node) return 'assigned to'
    if (parent.type === 'UpdateExpression') return '++ or --'
    if (parent.type === 'UnaryExpression' && parent.operator === 'delete') return 'delete'
  }
  if (parent.type === 'CallExpression' && parent.arguments[0] === identifier && /^Object\.(assign|defineProperty)$/.test(textOf(parent.callee))) {
    return 'Object.assign'
  }
  return undefined
}

const textOf = callee =>
  callee.type === 'MemberExpression' && callee.object.type === 'Identifier' && !callee.computed ? `${callee.object.name}.${callee.property.name}` : ''

/** Whether the subtree under `node` names `name`. */
function mentions(node, name, keys) {
  let found = false
  walk(node, keys, each => {
    found ||= each.type === 'Identifier' && each.name === name
    return !found
  })
  return found
}

/** Whether a call is of a function that is itself a type guard, which the compiler can say where the types are loaded. */
function isGuardCall(call, context) {
  const services = context.sourceCode.parserServices
  if (!services?.program) {
    return false
  }
  const checker = services.program.getTypeChecker()
  const type = checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(call.callee))
  return type.getCallSignatures().some(signature => checker.getTypePredicateOfSignature(signature) !== undefined)
}

/** Whether a guard's body tests the value it narrows: `typeof`, `in`, `instanceof`, `Array.isArray`, `Object.hasOwn`, or another guard. */
function testsShape(body, name, context) {
  const keys = context.sourceCode.visitorKeys
  let found = false
  walk(body, keys, node => {
    if (found) {
      return false
    }
    const isTest =
      (node.type === 'UnaryExpression' && node.operator === 'typeof') ||
      (node.type === 'BinaryExpression' && (node.operator === 'in' || node.operator === 'instanceof')) ||
      (node.type === 'CallExpression' && (/^(Array\.isArray|Object\.hasOwn)$/.test(textOf(node.callee)) || isGuardCall(node, context)))
    found = isTest && mentions(node, name, keys)
    return !found
  })
  return found
}

const typeText = (node, source) => source.getText(node).replace(/\s+/g, '')

/** The parts of a return type that are alternatives: `A | B` is two, anything else is one. */
const alternatives = node => (node.type === 'TSUnionType' ? node.types : [node])

/**
 * The statements of one body, with each overloaded function's signatures and its implementation: `function f(a): A;
 * function f(a: A | B): A | B { … }`. Yields `{ signatures, implementation }` for each.
 */
function* overloaded(body) {
  const pending = new Map()
  for (const statement of body) {
    const node = statement.type.startsWith('Export') && statement.declaration ? statement.declaration : statement
    const isMethod = node.type === 'MethodDefinition'
    const fn = isMethod ? node.value : node
    const key = isMethod ? `${node.static ? 'static ' : ''}${node.key.name ?? node.key.value}` : node.id?.name
    if (key === undefined || (!isMethod && node.type !== 'TSDeclareFunction' && node.type !== 'FunctionDeclaration')) {
      continue
    }
    if (fn.type === 'TSDeclareFunction' || fn.type === 'TSEmptyBodyFunctionExpression') {
      pending.set(key, [...(pending.get(key) ?? []), fn])
    } else if (pending.has(key)) {
      yield { signatures: pending.get(key), implementation: fn }
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
const noTypeAssertion = {
  meta: {
    type: 'problem',
    schema: [{ type: 'object', properties: { allowed: { type: 'object' } }, additionalProperties: false }],
    messages: {
      forbidden: 'No `as T`: it hides a wrong type. Narrow with a type guard (`value is T`) or check the value, or give it its type where it is made.',
      angle: 'No `<T>x` assertion: it hides a wrong type. Narrow with a type guard or check the value.',
      second: 'A second assertion in {{name}}: the one allowed here is the only one.',
      exported: '{{name}} is exported, or not, other than the config says: a private constructor must stay private.',
      guard: 'The guard says `{{name}} is {{type}}` but its body never tests `{{name}}` (`typeof`, `in`, `instanceof`, `Array.isArray`, or a call of another guard): that is a cast. Test the shape, or drop the annotation and let the compiler work the guard out.',
      untyped: 'An overloaded function\'s implementation needs its return type written: it must be the signatures\' return types, no wider.',
      wider: 'The implementation returns `{{type}}`, which is not one of its overloads\' return types: an overload that returns more than it declares is a cast.',
    },
  },
  create(context) {
    const allowed = (context.options[0] ?? {}).allowed ?? {}
    const file = context.filename.replaceAll('\\', '/')
    const ending = Object.keys(allowed).find(each => file.endsWith(each))
    const source = context.sourceCode
    let used = 0

    const checkGuard = fn => {
      const predicate = fn.returnType?.typeAnnotation
      if (predicate?.type !== 'TSTypePredicate' || predicate.parameterName.type !== 'Identifier' || !predicate.typeAnnotation) {
        return
      }
      const name = predicate.parameterName.name
      if (!fn.body || !testsShape(fn.body, name, context)) {
        context.report({ node: predicate, messageId: 'guard', data: { name, type: source.getText(predicate.typeAnnotation.typeAnnotation) } })
      }
    }

    const checkOverloads = body => {
      for (const { signatures, implementation } of overloaded(body)) {
        const written = implementation.returnType?.typeAnnotation
        if (!written) {
          context.report({ node: implementation, messageId: 'untyped' })
          continue
        }
        const declared = new Set(signatures.flatMap(each => (each.returnType ? alternatives(each.returnType.typeAnnotation) : []).map(part => typeText(part, source))))
        for (const part of alternatives(written)) {
          if (!declared.has(typeText(part, source))) {
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
        const inside = ending ? enclosingName(node) : null
        if (!inside || inside.name !== allowed[ending].name) {
          context.report({ node, messageId: 'forbidden' })
        } else if (inside.isExported !== allowed[ending].isExported) {
          context.report({ node, messageId: 'exported', data: { name: inside.name } })
        } else if (++used > 1) {
          context.report({ node, messageId: 'second', data: { name: inside.name } })
        }
      },
    }
  },
}

module.exports = { rules: { 'no-module-state': noModuleState, 'no-type-assertion': noTypeAssertion } }
