// The two rules ESLint has no built-in for, written here so that what each forbids and what it allows is in one place, and
// the allowance is an option of the rule in eslint.config.cjs, with its reason, never a comment next to the code.

const MUTATORS = new Set([
  'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin', 'set', 'add', 'delete', 'clear',
])

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

/**
 * No state kept in a module's variables. A reload starts them over, a second session shares them, and a test cannot reset
 * them. It flags a module-level `let` or `var`, and a module-level `const` (or an import) that code changes: an assignment
 * to one of its members, `++`, `delete`, `Object.assign` onto it, or a call of `push`, `set`, `add` and the like on it.
 * Option `allowedModules`: `{ [file path ending]: reason }`, the modules that may, each with why.
 */
const noModuleState = {
  meta: {
    type: 'problem',
    schema: [{ type: 'object', properties: { allowedModules: { type: 'object' } }, additionalProperties: false }],
    messages: {
      letting: '`{{name}}` is module-level `let`: state in a module is shared and lost on reload. Keep it in an atom or in what the caller owns.',
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
      Program() {
        const source = context.sourceCode
        const scope = source.scopeManager.scopes.find(each => each.type === 'module') ?? source.scopeManager.globalScope
        for (const variable of scope.variables) {
          const def = variable.defs[0]
          if (!def) {
            continue
          }
          if (def.type === 'Variable' && def.parent.kind !== 'const') {
            context.report({ node: def.node, messageId: 'letting', data: { name: variable.name } })
            continue
          }
          for (const reference of variable.references) {
            const how = mutation(reference.identifier)
            if (how) {
              context.report({ node: reference.identifier, messageId: 'mutated', data: { name: variable.name, how } })
            }
          }
        }
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

/**
 * No type assertions: `x as T` and `<T>x` tell the compiler what it should have been shown. `as const` is not one. Option
 * `allowed`: `{ [file path ending]: { name, isExported } }`: in that file one assertion is allowed, inside that function,
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
    },
  },
  create(context) {
    const allowed = (context.options[0] ?? {}).allowed ?? {}
    const file = context.filename.replaceAll('\\', '/')
    const ending = Object.keys(allowed).find(each => file.endsWith(each))
    let used = 0
    return {
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
