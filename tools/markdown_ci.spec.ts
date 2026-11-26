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

test.each(['check', 'scan'])('%s reads the Markdown classifier after checkout and only on pull requests', job => {
  const steps = stepsFor(check, job)
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
  expect(field(field(steps[0], 'with'), 'fetch-depth')).toBe(0)
})

test('the required workflow check runs the shared action on hosted Linux with read-only access', () => {
  const job = field(field(workflowCheck, 'jobs'), 'workflow-check')
  const steps = stepsFor(workflowCheck, 'workflow-check')
  expect(field(workflowCheck, 'permissions')).toEqual({ contents: 'read' })
  expect(field(job, 'runs-on')).toBe('ubuntu-latest')
  expect(field(job, 'if')).toBeUndefined()
  expect(steps).toHaveLength(1)
  expect(value(steps[0], 'uses')).toMatch(/^alxleo\/\.github\/actions\/workflow-check@(?:[a-f0-9]{40}|v1)$/u)
  expect(field(steps[0], 'if')).toBeUndefined()
  expect(field(steps[0], 'continue-on-error')).toBeUndefined()
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

test('the scan job skips its workflow linters on a Markdown PR and still checks secrets', () => {
  const scan = stepsFor(check, 'scan')
  for (const action of ['docker://rhysd/actionlint', 'zizmorcore/zizmor-action']) {
    expect(scan.find(step => value(step, 'uses').startsWith(action))).toMatchObject({ if: codeOnly })
  }
  const gitleaks = scan.find(step => value(step, 'uses').startsWith('gitleaks/gitleaks-action@'))
  expect(gitleaks).toBeDefined()
  expect(field(gitleaks, 'if')).toBeUndefined()
})
