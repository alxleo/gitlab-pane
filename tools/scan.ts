// The security scanners, run here when they are installed and said to be skipped when they are not.
//
//   node tools/scan.ts            gitleaks over every commit, actionlint and zizmor over .github/workflows   (npm run scan)
//   node tools/scan.ts --staged   gitleaks over the staged change only, which is what the commit hook runs
//
// gitleaks, actionlint and zizmor are not Node tools, so npm cannot install them. CI runs all three with their official
// actions (check.yml), over the whole history for gitleaks, and that is the gate. Here they are a convenience: install
// them (`mise install`, at the versions mise.toml pins) and a leak or a bad workflow is caught before the push; leave them
// out and each one is named below as skipped, with the way CI covers it.
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const ROOT = join(import.meta.dirname, '..')

type Scanner = { readonly name: string; readonly args: readonly string[]; readonly note: string }

const installed = (name: string): boolean => spawnSync(name, ['--version'], { stdio: 'ignore' }).error === undefined

function scanners(staged: boolean): Scanner[] {
  const token = (process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'] ?? '') !== ''
  return [
    staged
      ? { name: 'gitleaks', args: ['git', '--staged', '--redact', '--verbose'], note: 'the staged change' }
      : { name: 'gitleaks', args: ['git', '--redact', '--verbose'], note: 'every commit' },
    { name: 'actionlint', args: [], note: '.github/workflows' },
    {
      name: 'zizmor',
      args: token ? ['.github/workflows'] : ['--offline', '.github/workflows'],
      note: token ? '.github/workflows, online audits on' : '.github/workflows, offline (no GITHUB_TOKEN: the audits that call the GitHub API are left to CI)',
    },
  ]
}

function main(): number {
  const { values } = parseArgs({ options: { staged: { type: 'boolean', default: false } } })
  let failed = 0
  for (const scanner of scanners(values.staged)) {
    if (!installed(scanner.name)) {
      console.log(`scan: ${scanner.name} SKIPPED, it is not installed here (\`mise install\` installs it), so it did not scan: ${scanner.note}. CI runs it too (check.yml).`)
      continue
    }
    const ran = spawnSync(scanner.name, scanner.args, { cwd: ROOT, stdio: 'inherit' })
    if (ran.status === 0) {
      console.log(`scan: ${scanner.name} passed (${scanner.note}).`)
    } else {
      console.error(`scan: ${scanner.name} FAILED (${scanner.note}).`)
      failed += 1
    }
  }
  return failed > 0 ? 1 : 0
}

process.exitCode = main()
