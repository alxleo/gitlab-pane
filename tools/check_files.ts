// File hygiene over every file git tracks or would add: json and yaml parse, no merge markers, large files or private keys,
// no linter directives, one final newline, no trailing whitespace.
//
//   node tools/check_files.ts          (npm run files)
//
// JSON and YAML parse; no merge-conflict markers, private keys or large files; no `oxlint-` or `eslint-` directive in a
// script's comments (tools/directives.ts says why that is checked here and not by the linter); text files end with one
// newline and carry no trailing whitespace. The generated fonts and CHANGELOG.md (written by release-please) are left
// alone. tsconfig files, wherever they sit, may carry `//` comments, which TypeScript allows and JSON does not, so those
// are read with them removed.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseAllDocuments } from 'yaml'

import { parseJson } from '../hooks/decode.ts'
import { directivesIn, SCRIPT } from './directives.ts'

const ROOT = join(import.meta.dirname, '..')
const EXEMPT = /^(CHANGELOG\.md|tools\/screens\/fonts\/.*)$/u
const BINARY = /\.(png|woff2?|jpg|jpeg|gif|ico)$/u
const LARGE = 500 * 1024
const MARKER = /^(<{7}|>{7})( |$)/mu
// Written in two parts so that this file does not hold a key's header itself.
const PRIVATE_KEY = new RegExp(`-----BEGIN (?:[A-Z]+ )?PRIVATE ${'KEY'}(?: BLOCK)?-----`, 'u')

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function files(): string[] {
  const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
  return [...new Set(listed.split('\0').filter(name => name !== ''))].filter(name => existsSync(join(ROOT, name)) && !EXEMPT.test(name)).toSorted()
}

function problemsIn(name: string): string[] {
  const path = join(ROOT, name)
  const size = statSync(path).size
  if (size > LARGE) {
    return [`${name}: ${Math.round(size / 1024)} kB is over the ${LARGE / 1024} kB limit for a committed file`]
  }
  if (BINARY.test(name)) {
    return []
  }
  const bytes = readFileSync(path)
  if (bytes.includes(0)) {
    return []
  }
  const text = bytes.toString('utf8')
  const found: string[] = []
  if (name.endsWith('.json')) {
    try {
      parseJson(/(?:^|\/)tsconfig[^/]*\.json$/u.test(name) ? text.replace(/^\s*\/\/.*$/gmu, '') : text)
    } catch (error) {
      found.push(`${name}: does not parse as JSON: ${messageOf(error)}`)
    }
  }
  if (name.endsWith('.yml') || name.endsWith('.yaml')) {
    for (const document of parseAllDocuments(text)) {
      found.push(...document.errors.map(error => `${name}: does not parse as YAML: ${error.message.split('\n')[0] ?? ''}`))
    }
  }
  if (MARKER.test(text)) {
    found.push(`${name}: holds a merge-conflict marker`)
  }
  if (PRIVATE_KEY.test(text)) {
    found.push(`${name}: holds a private key`)
  }
  if (SCRIPT.test(name)) {
    found.push(...directivesIn(name, text))
  }
  if (text !== '' && !text.endsWith('\n')) {
    found.push(`${name}: does not end with a newline`)
  }
  if (text.endsWith('\n\n')) {
    found.push(`${name}: ends with more than one newline`)
  }
  text.split('\n').forEach((line, index) => {
    if (/[ \t\r]$/u.test(line)) {
      found.push(`${name}:${index + 1}: trailing whitespace`)
    }
  })
  return found
}

const problems = files().flatMap(problemsIn)
if (problems.length > 0) {
  console.error(problems.join('\n'))
  console.error(`${problems.length} file problem${problems.length === 1 ? '' : 's'}.`)
  process.exitCode = 1
}
