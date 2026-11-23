// One report for a source sweep or a Reprise comparison against a Git ref.
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const root = join(import.meta.dirname, '..')
const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const escaped = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

function scan(name: string, args: string[]) {
  const ran = spawnSync(name, args, { cwd: root, encoding: 'utf8', timeout: 90_000, maxBuffer: 1024 * 1024 })
  const failed = ran.status !== 0
  const status = failed ? (ran.error?.message ?? (ran.signal === null ? `exit ${ran.status}` : `signal ${ran.signal}`)) : 'completed'
  const output = [ran.stdout, ran.stderr].filter(Boolean).join('\n').replaceAll(`${root}/`, '').trim()
  const excerpt = output.length > 40_000 ? `${output.slice(0, 40_000)}\n… report truncated after 40,000 characters.` : output
  const body = excerpt === '' ? (failed ? 'Scanner returned no output.' : 'No findings reported.') : excerpt
  return {
    failed,
    section: `<details>\n<summary>${name} · ${escaped(status)}</summary>\n\n<pre>${escaped(body)}</pre>\n\n</details>`,
  }
}

function main(): number {
  const { values } = parseArgs({ options: { base: { type: 'string' } } })
  // Hand Reprise the resolved merge-base SHA, including when the input names another branch.
  const requested = values.base === undefined ? undefined : git('rev-parse', '--verify', '--end-of-options', `${values.base}^{commit}`)
  const base = requested === undefined ? undefined : git('merge-base', 'HEAD', requested)
  const scratch = mkdtempSync(join(tmpdir(), 'gitlab-pane-duplicates-'))
  try {
    const files = join(scratch, 'typescript.txt')
    const paths = git('ls-files', '-z', '--cached', '--others', '--exclude-standard', '--deduplicate', '--', '*.ts')
      .split('\0')
      .filter(path => path !== '' && !path.endsWith('.generated.ts'))
    writeFileSync(files, `${paths.join('\n')}\n`)
    const scans = [
      scan('pmd', ['cpd', '--language', 'typescript', '--file-list', files, '--minimum-tokens', '70', '--skip-duplicate-files', '--no-fail-on-violation', '--format', 'csv']),
      scan('jscpd', [
        '.',
        '--format',
        'typescript,tsx',
        '--ignore',
        '**/*.generated.ts',
        '--min-tokens',
        '50',
        '--min-lines',
        '5',
        '--similarity',
        '--reporters',
        'console',
        '--no-colors',
        '--fail-on-empty',
      ]),
      scan('reprise', base === undefined ? ['scan', '.'] : ['check', '.', '--base', base, '--fail-on', 'none']),
    ]
    const report =
      [
        '## Duplicate code · advisory',
        `Checkout: \`${git('rev-parse', 'HEAD')}\`.${base === undefined ? '' : ` Reprise merge base: \`${base}\`.`}`,
        'Review shared behaviour before changing a match. PMD scans TypeScript and the other two also scan TSX.',
        'PMD CSV gives lines, tokens and occurrence count, followed by the starting line and path for each occurrence.',
        ...scans.map(result => result.section),
      ].join('\n\n') + '\n'
    const summary = process.env['GITHUB_STEP_SUMMARY']
    if (summary === undefined) {
      process.stdout.write(report)
    } else {
      appendFileSync(summary, report)
    }
    return scans.some(result => result.failed) ? 1 : 0
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

process.exitCode = main()
