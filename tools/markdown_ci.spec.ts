import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from 'vitest'
import { parse } from 'yaml'

import { isRecord } from '../hooks/decode.ts'
import { ROOT } from './core.ts'

const readWorkflow = (file: string): unknown => parse(readFileSync(join(ROOT, '.github', 'workflows', file), 'utf8'))
const field = (record: unknown, key: string): unknown => (isRecord(record) ? record[key] : undefined)
const value = (record: unknown, key: string): string => {
  const entry = field(record, key)
  return typeof entry === 'string' ? entry : ''
}

const check = readWorkflow('check.yml')
const workflowCheck = readWorkflow('workflow-check.yml')
const codeOnly = "steps.markdown-scope.outputs.markdown_only != '1'"
const docsOnly = "steps.markdown-scope.outputs.markdown_only == '1'"

const stepsFor = (workflow: unknown, job: string): unknown[] => {
  const steps = field(field(field(workflow, 'jobs'), job), 'steps')
  return Array.isArray(steps) ? steps : []
}

test('required CI jobs are reported on pull requests even when every changed path is Markdown', () => {
  for (const [workflow, job] of [
    [check, 'check'],
    [workflowCheck, 'workflow-check'],
  ] as const) {
    expect(field(field(workflow, 'on'), 'pull_request')).toBeDefined()
    expect(field(field(field(workflow, 'on'), 'pull_request'), 'paths')).toBeUndefined()
    expect(field(field(field(workflow, 'on'), 'pull_request'), 'paths-ignore')).toBeUndefined()
    expect(stepsFor(workflow, job).length).toBeGreaterThan(0)
  }
})

test.each([
  [check, 'check'],
  [check, 'scan'],
  [workflowCheck, 'workflow-check'],
] as const)('%# reads the Markdown classifier after checkout and only on pull requests', (workflow, job) => {
  const steps = stepsFor(workflow, job)
  expect(value(steps[0], 'uses')).toMatch(/^actions\/checkout@/u)
  expect(steps[1]).toMatchObject({
    id: 'markdown-scope',
    if: "github.event_name == 'pull_request'",
    shell: 'bash',
  })
  const command = value(steps[1], 'run')
  expect(command).toContain("HEAD^1 HEAD -- . ':(exclude,icase,glob)**/*.md'")
  expect(command).toContain('--no-renames')
  expect(command).toContain('print "markdown_only=" (NR == 0)')
  expect(command).toContain('>> "$GITHUB_OUTPUT"')
  expect(field(field(steps[0], 'with'), 'fetch-depth')).toBe(job === 'workflow-check' ? "${{ github.event_name == 'pull_request' && 2 || 1 }}" : 0)
})

test('a Markdown PR skips application lint, builds and tests but still checks docs, emails and the PR title', () => {
  const steps = stepsFor(check, 'check')
  for (const run of [
    'npm install --global',
    'npm run check:fast',
    'npm test',
    'node --import ./tools/resolve_ts.ts tools/release_tree.ts build',
    'npm install --prefix "$RUNNER_TEMP/codex"',
    'node --import ./tools/resolve_ts.ts chatgpt/probe.ts',
    'npm install --prefix "$RUNNER_TEMP/stable"',
    'stable=',
  ]) {
    expect(steps.find(step => value(step, 'run').startsWith(run))).toMatchObject({ if: codeOnly })
  }
  expect(steps.find(step => value(step, 'run') === 'npm run docs -- check')).toMatchObject({ if: docsOnly })
  expect(
    field(
      steps.find(step => value(step, 'name') === 'Commits carry noreply addresses only'),
      'if'
    )
  ).toBeUndefined()
  expect(steps.find(step => value(step, 'name') === 'The pull request title says what the change is')).toMatchObject({
    if: "github.event_name == 'pull_request'",
  })
})

test('both workflow scans skip their linters on a Markdown PR and the secret scan stays active', () => {
  const scan = stepsFor(check, 'scan')
  for (const [steps, actions] of [
    [scan, ['docker://rhysd/actionlint', 'zizmorcore/zizmor-action']],
    [stepsFor(workflowCheck, 'workflow-check'), ['docker://rhysd/actionlint', 'docker://ghcr.io/zizmorcore/zizmor']],
  ] as const) {
    for (const action of actions) {
      expect(steps.find(step => value(step, 'uses').startsWith(action))).toMatchObject({ if: codeOnly })
    }
  }
  const gitleaks = scan.find(step => value(step, 'uses').startsWith('gitleaks/gitleaks-action@'))
  expect(gitleaks).toBeDefined()
  expect(field(gitleaks, 'if')).toBeUndefined()
})
