// release-tree: the files the plugin ships, copied out of the repository and checked.
//
//   node tools/release_tree.ts build DIR    copy the files named in release/files into DIR (made empty first), then check them
//   node tools/release_tree.ts check        build into a scratch directory and check, leaving nothing behind
//
// (`npm run release-tree -- build DIR` is the same.) Installing the plugin copies its whole source, and the repository holds
// far more than runs: tools, tests, screenshots, fonts, and the npm package that runs them. The release job publishes the
// tree this builds, to the `release` branch, and the marketplace installs from there.
//
// The check starts at the modules named in hooks/hooks.json and follows every import that survives type-stripping (not
// `import type`, not `export type`), in the built tree and not in the repository, so a file the allowlist forgot is found
// as a file that is missing. Each `import` and `export … from` statement is classified on its own. It fails when:
//
//   - a listed file is missing, listed twice, a directory, or a development file (tools/, tests/, package.json, a tsconfig)
//   - a module that loads imports a relative path the tree does not hold, or a package other than 'claude-code'
//     (the mod cannot load npm packages)
//   - a module that loads calls `import(…)`: the engine refuses dynamic import
//   - a .ts or .tsx file under hooks/ is shipped and nothing loads it
//   - plugin.json names a `types` file the tree does not hold
//   - the README links or shows a relative path (the tree holds no docs/ or CONTRIBUTING.md): links there are absolute
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { isRecord, parseJson } from '../hooks/decode.ts'

const ROOT = join(import.meta.dirname, '..')
const MANIFEST = join(ROOT, 'release', 'files')
const SUFFIXES = ['.ts', '.tsx', '.js', '.mjs']
const ENGINE = 'claude-code'
// What the plugin never needs and a team must not receive, even if the allowlist were to name it.
const DEVELOPMENT = /^(tools|tests|docs|\.github|node_modules)\/|^package(-lock)?\.json$|^tsconfig[^/]*\.json$/
const LINK = /\]\((?<md>[^)\s]+)|\b(?:src|href)=["'](?<html>[^"']+)/g

type Entry = { readonly source: string; readonly destination: string }

function entries(): Entry[] {
  const found: Entry[] = []
  readFileSync(MANIFEST, 'utf8')
    .split('\n')
    .forEach((raw, index) => {
      const line = raw.trim()
      if (line === '' || line.startsWith('#')) {
        return
      }
      const parts = line.split(/\s+/)
      const [source, destination] = [parts[0], parts[parts.length - 1]]
      if (parts.length > 2 || /[*?[\]]/.test(line) || source === undefined || destination === undefined) {
        throw new Error(`${relative(ROOT, MANIFEST)}:${index + 1}: one path, or a source and a destination; no patterns`)
      }
      found.push({ source, destination })
    })
  return found
}

function build(destination: string): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })
  for (const entry of entries()) {
    if (seen.has(entry.destination)) {
      problems.push(`${entry.destination} is listed twice`)
      continue
    }
    seen.add(entry.destination)
    const source = join(ROOT, entry.source)
    if (!existsSync(source) || !statSync(source).isFile()) {
      problems.push(`${entry.source} is listed but is not a file`)
      continue
    }
    if (DEVELOPMENT.test(entry.source) || DEVELOPMENT.test(entry.destination)) {
      problems.push(`${entry.source} is a development file: the plugin does not ship it`)
      continue
    }
    mkdirSync(dirname(join(destination, entry.destination)), { recursive: true })
    copyFileSync(source, join(destination, entry.destination))
  }
  return problems
}

// ---- what a file loads --------------------------------------------------------------------------------------------------

type Token = { readonly kind: 'word' | 'punct' | 'string'; readonly text: string }

const BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'yield', 'await'])
const IDENTIFIER = /[\p{ID_Continue}$]/u

/** Where the text of a template literal ends: after its closing backtick (`closed`), or at a `${` that opens an expression. */
function templateText(code: string, from: number): { readonly end: number; readonly closed: boolean } {
  let at = from
  while (at < code.length) {
    const char = code[at]
    if (char === '\\') {
      at += 2
    } else if (char === '`') {
      return { end: at + 1, closed: true }
    } else if (char === '$' && code[at + 1] === '{') {
      return { end: at + 2, closed: false }
    } else {
      at += 1
    }
  }
  return { end: at, closed: true }
}

/** The tokens of TypeScript source with comments and the insides of strings, templates and regular expressions dropped. */
function tokenize(code: string): Token[] {
  const tokens: Token[] = []
  // The brace depth inside each open `${ … }`, innermost last.
  const expressions: number[] = []
  let at = 0
  while (at < code.length) {
    const char = code.charAt(at)
    const next = code.charAt(at + 1)
    const last = tokens[tokens.length - 1]
    if (/\s/.test(char)) {
      at += 1
    } else if (char === '/' && next === '/') {
      const end = code.indexOf('\n', at)
      at = end === -1 ? code.length : end
    } else if (char === '/' && next === '*') {
      const end = code.indexOf('*/', at + 2)
      at = end === -1 ? code.length : end + 2
    } else if (char === '"' || char === "'") {
      let end = at + 1
      while (end < code.length && code[end] !== char && code[end] !== '\n') {
        end += code[end] === '\\' ? 2 : 1
      }
      tokens.push({ kind: 'string', text: code.slice(at + 1, end) })
      at = end + 1
    } else if (char === '`' || (char === '}' && expressions[expressions.length - 1] === 0)) {
      if (char === '}') {
        expressions.pop()
      }
      const text = templateText(code, at + 1)
      if (!text.closed) {
        expressions.push(0)
      }
      tokens.push({ kind: 'string', text: '' })
      at = text.end
    } else if (char === '/' && (last === undefined || (last.kind === 'punct' && ![')', ']', '}'].includes(last.text)) || (last.kind === 'word' && BEFORE_REGEX.has(last.text)))) {
      // A regular expression literal: to the next `/` outside a character class.
      let end = at + 1
      let inClass = false
      while (end < code.length && code[end] !== '\n' && (inClass || code[end] !== '/')) {
        if (code[end] === '\\') {
          end += 1
        } else if (code[end] === '[') {
          inClass = true
        } else if (code[end] === ']') {
          inClass = false
        }
        end += 1
      }
      tokens.push({ kind: 'string', text: '' })
      at = end + 1
    } else if (IDENTIFIER.test(char)) {
      let end = at + 1
      while (end < code.length && IDENTIFIER.test(code.charAt(end))) {
        end += 1
      }
      tokens.push({ kind: 'word', text: code.slice(at, end) })
      at = end
    } else {
      const top = expressions.length - 1
      if (char === '{' && top >= 0) {
        expressions[top] = (expressions[top] ?? 0) + 1
      } else if (char === '}' && top >= 0) {
        expressions[top] = (expressions[top] ?? 1) - 1
      }
      tokens.push({ kind: 'punct', text: char })
      at += 1
    }
  }
  return tokens
}

const isWord = (token: Token | undefined, text: string): boolean => token?.kind === 'word' && token.text === text
const isPunct = (token: Token | undefined, text: string): boolean => token?.kind === 'punct' && token.text === text

/** The index after the `}` that closes the `{` at `open`. */
function afterBraces(tokens: readonly Token[], open: number): number {
  let depth = 0
  for (let at = open; at < tokens.length; at += 1) {
    if (isPunct(tokens[at], '{')) {
      depth += 1
    } else if (isPunct(tokens[at], '}')) {
      depth -= 1
      if (depth === 0) {
        return at + 1
      }
    }
  }
  return tokens.length
}

/** The module named by the `from 'spec'` that ends the clause starting at `from`, or null when the statement ends first. */
function fromClause(tokens: readonly Token[], start: number): string | null {
  let at = start
  while (at < tokens.length) {
    const token = tokens[at]
    const following = tokens[at + 1]
    if (isWord(token, 'from') && following?.kind === 'string') {
      return following.text
    }
    if (isPunct(token, '{')) {
      at = afterBraces(tokens, at)
    } else if ((token?.kind === 'word' && token.text !== 'import' && token.text !== 'export') || isPunct(token, '*') || isPunct(token, ',')) {
      at += 1
    } else {
      return null
    }
  }
  return null
}

type Loads = { readonly specs: string[]; readonly dynamic: number }

/** What a type-stripped file still loads: each top-level `import` and `export … from` statement is read on its own. */
function loads(source: string): Loads {
  const tokens = tokenize(source)
  const specs: string[] = []
  let dynamic = 0
  let depth = 0
  tokens.forEach((token, at) => {
    const [after, second, third] = [tokens[at + 1], tokens[at + 2], tokens[at + 3]]
    if (isPunct(token, '{')) {
      depth += 1
    } else if (isPunct(token, '}')) {
      depth -= 1
    } else if (isWord(token, 'import') && !isPunct(tokens[at - 1], '.')) {
      if (isPunct(after, '(')) {
        dynamic += 1
      } else if (depth === 0 && after?.kind === 'string') {
        specs.push(after.text)
      } else if (depth === 0 && !isPunct(after, '.')) {
        // `import type {…} from`, `import type * as x from` and `import type X from` are erased whole; `import { type A }`
        // still loads the module. `import type from 'm'` and `import type, {…} from` import a default named `type`.
        const erased = isWord(after, 'type') && !(isWord(second, 'from') && third?.kind === 'string') && !isPunct(second, ',')
        const spec = erased ? null : fromClause(tokens, at + 1)
        if (spec !== null) {
          specs.push(spec)
        }
      }
    } else if (isWord(token, 'export') && depth === 0 && !isPunct(tokens[at - 1], '.')) {
      // Only the forms with a list or a star can name a module: `export type X = {…}` and `export const …` never do, so
      // nothing after them is read as the end of a clause.
      const erased = isWord(after, 'type') && (isPunct(second, '{') || isPunct(second, '*'))
      const reexport = isPunct(after, '{') || isPunct(after, '*')
      // After a list the next token must be `from`: an `export { a }` of local names ends there.
      const afterList = isPunct(after, '{') ? afterBraces(tokens, at + 1) : at + 1
      const spec = reexport && (isPunct(after, '*') || isWord(tokens[afterList], 'from')) ? fromClause(tokens, afterList) : null
      if (!erased && spec !== null) {
        specs.push(spec)
      }
    }
  })
  return { specs, dynamic }
}

/** Cases that went wrong once or could: the check fails first if the reading of imports does not give these answers. */
const READINGS: readonly { readonly name: string; readonly source: string; readonly specs: readonly string[]; readonly dynamic: number }[] = [
  {
    name: 'a quote-free `export type X = {…}` does not swallow the import after it',
    source: "export type X = {\n  a: string\n}\nimport { v } from './b'\n",
    specs: ['./b'],
    dynamic: 0,
  },
  { name: 'the same with `export type` of a union and an interface', source: "export type U = 'a' | 'b'\nexport interface I {\n  x: number\n}\nimport { w } from './c'\n", specs: ['./c'], dynamic: 0 },
  { name: 'import type is erased whole', source: "import type { T } from './a'\nimport type * as ns from './a2'\nimport type D from './a3'\n", specs: [], dynamic: 0 },
  { name: 'export type {…} from is erased whole', source: "export type { T } from './a'\nexport type * from './a2'\n", specs: [], dynamic: 0 },
  { name: 'an import with only type specifiers still loads', source: "import { type A } from './d'\nimport { type B, c } from './e'\n", specs: ['./d', './e'], dynamic: 0 },
  { name: 'a default import named type still loads', source: "import type from './f'\nimport type, { g } from './f2'\n", specs: ['./f', './f2'], dynamic: 0 },
  { name: 'side-effect imports and re-exports load', source: "import './s'\nexport * from './t'\nexport * as n from './t2'\nexport { a, type B } from './u'\n", specs: ['./s', './t', './t2', './u'], dynamic: 0 },
  { name: 'a local export list loads nothing', source: "const a = 1\nexport { a }\nimport { z } from './v'\n", specs: ['./v'], dynamic: 0 },
  { name: 'import( is flagged, with a literal or not', source: "const m = await import('./w')\nconst n = import(name)\n", specs: [], dynamic: 2 },
  { name: 'import.meta is not an import', source: 'const here = import.meta.url\n', specs: [], dynamic: 0 },
  {
    name: 'comments, strings, templates and regular expressions hide nothing and show nothing',
    source: "// import x from './no'\n/* import y from './no2' */\nconst s = \"import z from './no3'\"\nconst t = `${1} import q from './no4' ${`import(`}`\nconst r = /'/\nimport { k } from './x'\n",
    specs: ['./x'],
    dynamic: 0,
  },
]

function selfCheck(): string[] {
  return READINGS.flatMap(reading => {
    const got = loads(reading.source)
    return JSON.stringify(got.specs) === JSON.stringify(reading.specs) && got.dynamic === reading.dynamic
      ? []
      : [`the import reader is wrong: ${reading.name} (read ${JSON.stringify(got)}, want ${JSON.stringify({ specs: reading.specs, dynamic: reading.dynamic })})`]
  })
}

// ---- the closure --------------------------------------------------------------------------------------------------------

const inside = (tree: string, file: string): boolean => {
  const path = relative(tree, file)
  return path !== '' && !path.startsWith('..') && !isAbsolute(path)
}

const isFile = (file: string): boolean => existsSync(file) && statSync(file).isFile()

function resolveImport(tree: string, importer: string, spec: string): string | null {
  const base = resolve(dirname(importer), spec)
  const candidates = [...(SUFFIXES.some(suffix => base.endsWith(suffix)) ? [base] : []), ...SUFFIXES.map(suffix => `${base}${suffix}`), ...SUFFIXES.map(suffix => join(base, `index${suffix}`))]
  return candidates.find(candidate => isFile(candidate) && inside(tree, candidate)) ?? null
}

function closure(tree: string): { readonly loaded: Set<string>; readonly problems: string[] } {
  const problems: string[] = []
  const hooks = join(tree, 'hooks', 'hooks.json')
  if (!isFile(hooks)) {
    return { loaded: new Set(), problems: ['hooks/hooks.json is not in the tree'] }
  }
  const parsed = parseJson(readFileSync(hooks, 'utf8'))
  const modules = isRecord(parsed) && Array.isArray(parsed['modules']) ? parsed['modules'].filter((each): each is string => typeof each === 'string') : []
  const pending = modules.map(module => ({ importer: hooks, module: resolve(dirname(hooks), module) }))
  const loaded = new Set<string>()
  for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
    const { importer, module } = item
    if (!isFile(module) || !inside(tree, module)) {
      problems.push(`${relative(tree, importer)} loads ${module}, which the tree does not hold`)
      continue
    }
    if (loaded.has(module)) {
      continue
    }
    loaded.add(module)
    const read = loads(readFileSync(module, 'utf8'))
    if (read.dynamic > 0) {
      problems.push(`${relative(tree, module)} calls import(): the engine refuses dynamic import`)
    }
    for (const spec of read.specs) {
      if (spec === ENGINE || spec.startsWith('node:')) {
        continue
      }
      if (!spec.startsWith('.')) {
        problems.push(`${relative(tree, module)} imports '${spec}': the mod cannot load packages`)
        continue
      }
      const target = resolveImport(tree, module, spec)
      if (target === null) {
        problems.push(`${relative(tree, module)} imports '${spec}', which the tree does not hold: add it to release/files`)
      } else {
        pending.push({ importer: module, module: target })
      }
    }
  }
  return { loaded, problems }
}

function verify(tree: string): string[] {
  const { loaded, problems } = closure(tree)
  const hooks = join(tree, 'hooks')
  const shipped = existsSync(hooks) ? readdirSync(hooks).sort() : []
  for (const name of shipped) {
    if ((name.endsWith('.ts') || name.endsWith('.tsx')) && !loaded.has(join(hooks, name))) {
      problems.push(`hooks/${name} ships but nothing loads it: take it out of release/files`)
    }
  }
  const readme = join(tree, 'README.md')
  if (isFile(readme)) {
    for (const found of readFileSync(readme, 'utf8').matchAll(LINK)) {
      const target = found.groups?.['md'] ?? found.groups?.['html'] ?? ''
      if (!target.startsWith('https://') && !target.startsWith('#')) {
        problems.push(`README.md links to ${target}: make it an absolute https:// link, the tree does not hold that path`)
      }
    }
  }
  const plugin = join(tree, '.claude-plugin', 'plugin.json')
  if (!isFile(plugin)) {
    problems.push('.claude-plugin/plugin.json is not in the tree')
  } else {
    const parsed = parseJson(readFileSync(plugin, 'utf8'))
    const types = isRecord(parsed) ? parsed['types'] : undefined
    if (typeof types === 'string' && types !== '' && !isFile(resolve(tree, types))) {
      problems.push(`plugin.json names types ${types}, which the tree does not hold`)
    }
  }
  return problems
}

function filesUnder(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap(each => (each.isDirectory() ? filesUnder(join(folder, each.name)) : [join(folder, each.name)]))
}

function report(tree: string, problems: readonly string[]): number {
  if (problems.length > 0) {
    console.error('The release tree is not self-contained:')
    problems.forEach(problem => console.error(`  ${problem}`))
    return 1
  }
  const files = filesUnder(tree)
  const size = files.reduce((total, file) => total + statSync(file).size, 0)
  console.log(`${files.length} files, ${size} bytes; every module that loads resolves inside the tree`)
  return 0
}

function main(args: readonly string[]): number {
  const [command, folder] = args
  if (command === 'build' && folder !== undefined && args.length === 2) {
    const tree = resolve(folder)
    return report(tree, [...selfCheck(), ...build(tree), ...verify(tree)])
  }
  if (command === 'check' && args.length === 1) {
    const scratch = mkdtempSync(join(tmpdir(), 'release-tree-'))
    try {
      const tree = join(scratch, 'tree')
      return report(tree, [...selfCheck(), ...build(tree), ...verify(tree)])
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  }
  console.error('usage: node tools/release_tree.ts build DIR | check')
  return 2
}

process.exitCode = main(process.argv.slice(2))
