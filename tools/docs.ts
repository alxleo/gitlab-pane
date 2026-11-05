// docs: holds README.md, DESIGN.md and CONTRIBUTING.md to the code, so a table there cannot drift from what the plugin does.
//
//   node tools/docs.ts write     read the docs' tables into tests/docs.generated.ts
//   node tools/docs.ts check     fail if the settings table is not plugin.json's userConfig, CONTRIBUTING's scripts table not package.json's
//                                scripts, or that file is not what the docs say
//
// (`npm run docs -- <command>` is the same; `check` is part of `npm run check`.) The check is in two halves, because the tests
// run where no file can be read and Node cannot load the engine-facing modules that hold some of the facts:
//
//   * here, under Node: the README's settings table against plugin.json (every userConfig key, in order, with its default),
//     CONTRIBUTING's scripts table against package.json (every script, and no other), and every table below read into
//     tests/docs.generated.ts, which must be what the docs say now
//   * in tests/docs.test.ts, under `claude plugin test`: that file against the code (the palette, the mark tables, the
//     polling intervals, the commands and the tool register.tsx registers)
//
// A table is found by its header row, so a heading can move or change; a table whose header changes is not found, and fails.
import { readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { isRecord, parseJson } from '../hooks/decode.ts'

const ROOT = join(import.meta.dirname, '..')
const README = join(ROOT, 'README.md')
const DESIGN = join(ROOT, 'DESIGN.md')
const CONTRIBUTING = join(ROOT, 'CONTRIBUTING.md')
const PACKAGE = join(ROOT, 'package.json')
const PLUGIN = join(ROOT, '.claude-plugin', 'plugin.json')
const GENERATED = join(ROOT, 'tests', 'docs.generated.ts')

const UNITS: Record<string, number> = { s: 1_000, min: 60_000, h: 3_600_000 }
const DURATION = /(\d+)\s*(s|min|h)\b/g

type Table = { readonly header: readonly string[]; readonly rows: readonly (readonly string[])[] }

/** A table row's cells; a `|` inside backticks is the cell's text, not a border. */
function cellsOf(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let isCode = false
  for (const char of line.trim().slice(1, -1)) {
    if (char === '`') {
      isCode = !isCode
    }
    if (char === '|' && !isCode) {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += char
    }
  }
  return [...cells, cell.trim()]
}

/** Every table of a Markdown file, outside fenced code. */
function tablesOf(markdown: string): Table[] {
  const lines = markdown.split('\n')
  const found: Table[] = []
  let isFenced = false
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at] ?? ''
    if (line.startsWith('```')) {
      isFenced = !isFenced
    }
    if (isFenced || !line.startsWith('|') || !/^\|(?:\s*:?-+:?\s*\|)+$/.test(lines[at + 1] ?? '')) {
      continue
    }
    const rows: string[][] = []
    let next = at + 2
    while ((lines[next] ?? '').startsWith('|')) {
      rows.push(cellsOf(lines[next] ?? ''))
      next += 1
    }
    found.push({ header: cellsOf(line), rows })
    at = next - 1
  }
  return found
}

/** What went wrong reading the docs; the tool reports every one and fails. */
const problems: string[] = []

/** The table of a file with this header, or none (and a problem). */
function tableOf(file: string, header: readonly string[]): Table {
  const found = tablesOf(readFileSync(file, 'utf8')).find(table => table.header.join('|') === header.join('|'))
  if (found === undefined) {
    problems.push(`${relative(ROOT, file)} has no table headed | ${header.join(' | ')} |`)
    return { header, rows: [] }
  }
  return found
}

/** The text in backticks in a cell. */
const ticked = (cell: string | undefined): string[] => [...(cell ?? '').matchAll(/`([^`]+)`/g)].flatMap(found => (found[1] !== undefined ? [found[1]] : []))

/** The one value in backticks a cell must start with. */
function firstTicked(where: string, cell: string | undefined): string {
  const [first] = ticked(cell)
  if (first === undefined) {
    problems.push(`${where}: no \`value\` in "${cell ?? ''}"`)
    return ''
  }
  return first
}

/** Every duration a cell names (`1 min`, `30 s`, `2 h`), in milliseconds, in order. */
const durationsOf = (cell: string | undefined): number[] =>
  [...(cell ?? '').matchAll(DURATION)].map(found => Number(found[1]) * (UNITS[found[2] ?? ''] ?? Number.NaN))

/** What the docs' tables say that the tests hold to the code. */
function readDocs() {
  const commands = tableOf(README, ['Command', 'Does'])
  const named = commands.rows.flatMap(row => ticked(row[0]))
  const runs = tableOf(README, ['Runs', 'How often', 'For', 'Writes (plugin store)'])
  const colours = tableOf(DESIGN, ['Tone', 'Colour', 'Means'])
  const checks = tableOf(DESIGN, ['Tone', 'Asks', 'Checks'])
  const marks = tableOf(DESIGN, ['Mark', 'Tone', 'Status'])
  return {
    readme: {
      /** Slash commands, by name without the slash. */
      commands: [...new Set(named.flatMap(name => /^\/([\w-]+)/.exec(name)?.[1] ?? []))],
      /** Tools, by the name the model calls them by. */
      tools: [...new Set(named.filter(name => !name.startsWith('/')).flatMap(name => /^([\w-]+)/.exec(name)?.[1] ?? []))],
      /** Each row of "What it runs": the intervals its "How often" names, in milliseconds. */
      runs: runs.rows.map(row => durationsOf(row[1])),
    },
    design: {
      colours: colours.rows.map((row, at) => [firstTicked(`Colour row ${at + 1}`, row[0]), firstTicked(`Colour row ${at + 1}`, row[1])]),
      checkTones: checks.rows.map((row, at) => [firstTicked(`Merge check row ${at + 1}`, row[0]), ticked(row[2])]),
      pipelineMarks: marks.rows.map((row, at) => [row[0] ?? '', firstTicked(`Pipeline mark row ${at + 1}`, row[1]), ticked(row[2])]),
      badges: tableOf(DESIGN, ['Badge', 'Means']).rows.map(row => [row[0] ?? '', row[1] ?? '']),
      links: tableOf(DESIGN, ['Mark', 'Opens']).rows.map(row => row[0] ?? ''),
      inboxEvents: tableOf(DESIGN, ['Mark', 'Event']).rows.map(row => [row[0] ?? '', row[1] ?? '']),
      inboxTabs: tableOf(DESIGN, ['Tab', 'Name', 'Lists']).rows.map((row, at) => [row[0] ?? '', firstTicked(`Inbox tab row ${at + 1}`, row[1])]),
    },
  }
}

/** A default as the settings table writes it: values in backticks, `none` for nothing, `on` and `off`. */
function defaultCell(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length === 0 ? 'none' : value.map(each => `\`${String(each)}\``).join(', ')
  }
  if (typeof value === 'boolean') {
    return value ? 'on' : 'off'
  }
  if (typeof value === 'string') {
    return value === '' ? 'none' : `\`${value}\``
  }
  return JSON.stringify(value)
}

/** The README's settings table is plugin.json's userConfig: the same keys in the same order, each with its default. */
function checkSettings(): void {
  const manifest = parseJson(readFileSync(PLUGIN, 'utf8'))
  const config = isRecord(manifest) && isRecord(manifest['userConfig']) ? manifest['userConfig'] : {}
  const want = Object.entries(config).map(([key, spec]) => [key, defaultCell(isRecord(spec) ? spec['default'] : undefined)])
  const have = tableOf(README, ['Setting', 'What it does', 'Default']).rows.map((row, at) => [firstTicked(`Settings row ${at + 1}`, row[0]), row[2] ?? ''])
  const keys = (pairs: readonly (readonly string[])[]) => pairs.map(pair => pair[0]).join(', ')
  if (keys(want) !== keys(have)) {
    problems.push(`README.md's settings are ${keys(have)}; plugin.json's userConfig is ${keys(want)}`)
  }
  for (const [key, cell] of want) {
    const row = have.find(pair => pair[0] === key)
    if (row !== undefined && row[1] !== cell) {
      problems.push(`README.md says ${key} defaults to "${row[1] ?? ''}"; plugin.json's default is written "${cell ?? ''}"`)
    }
  }
}

/** CONTRIBUTING's scripts table names every script of package.json, and no script that is not there (`npm run name …`, or `npm test`). */
function checkScripts(): void {
  const manifest = parseJson(readFileSync(PACKAGE, 'utf8'))
  const scripts = isRecord(manifest) && isRecord(manifest['scripts']) ? Object.keys(manifest['scripts']) : []
  const named = tableOf(CONTRIBUTING, ['Script', 'Checks']).rows.flatMap(row => ticked(row[0]).flatMap(command => /^npm (?:run )?([\w:-]+)/.exec(command)?.[1] ?? []))
  const missing = scripts.filter(script => !named.includes(script))
  const unknown = [...new Set(named.filter(name => !scripts.includes(name)))]
  if (missing.length > 0) {
    problems.push(`CONTRIBUTING.md's scripts table lacks package.json's ${missing.join(', ')}`)
  }
  if (unknown.length > 0) {
    problems.push(`CONTRIBUTING.md's scripts table names ${unknown.join(', ')}, which package.json does not have`)
  }
}

/** A group of tables as a constant, one row a line. */
const constant = (name: string, tables: Record<string, readonly unknown[]>): string =>
  [
    `export const ${name} = {`,
    ...Object.entries(tables).flatMap(([key, rows]) => [`  ${key}: [`, ...rows.map(row => `    ${JSON.stringify(row)},`), '  ],']),
    '} as const',
  ].join('\n')

function generated(): string {
  const docs = readDocs()
  return [
    '// What README.md and DESIGN.md say in their tables, read by tools/docs.ts. Never edit it: `npm run docs -- write` makes it.',
    '// `npm run docs -- check` fails while it differs from the docs, and tests/docs.test.ts while it differs from the code.',
    '',
    constant('README', docs.readme),
    '',
    constant('DESIGN', docs.design),
    '',
  ].join('\n')
}

function report(): number {
  if (problems.length > 0) {
    console.error('The docs and the code disagree:')
    problems.forEach(problem => console.error(`  ${problem}`))
    return 1
  }
  return 0
}

function main(args: readonly string[]): number {
  const [command] = args
  if (command === 'write' && args.length === 1) {
    const text = generated()
    if (problems.length === 0) {
      writeFileSync(GENERATED, text)
      console.log(`wrote ${relative(ROOT, GENERATED)}`)
    }
    return report()
  }
  if (command === 'check' && args.length === 1) {
    checkSettings()
    checkScripts()
    let current = ''
    try {
      current = readFileSync(GENERATED, 'utf8')
    } catch {
      current = ''
    }
    if (generated() !== current) {
      problems.push(`${relative(ROOT, GENERATED)} is not what the docs say: run \`npm run docs -- write\`, then \`npm test\``)
    }
    const failed = report()
    if (failed === 0) {
      console.log('the docs\' settings are plugin.json\'s, the scripts table is package.json\'s, and their tables are in tests/docs.generated.ts')
    }
    return failed
  }
  console.error('usage: node tools/docs.ts write | check')
  return 2
}

process.exitCode = main(process.argv.slice(2))
