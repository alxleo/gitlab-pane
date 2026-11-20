import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { expect, test } from 'vitest'
import { parse } from 'yaml'

import { isRecord } from '../hooks/decode.ts'
import { DOCUMENTS } from '../hooks/gitlab-operations.ts'
import { ROOT } from './core.ts'
import { documentFiles, scored, unwatched } from './gitlab_schema.ts'

/** The paths filter of the canary's pull_request trigger, which starts the schema check on a pull request. */
function canaryPaths(): string[] {
  const workflow: unknown = parse(readFileSync(join(ROOT, '.github', 'workflows', 'canary.yml'), 'utf8'))
  const on = isRecord(workflow) ? workflow['on'] : undefined
  const pullRequest = isRecord(on) ? on['pull_request'] : undefined
  const paths = isRecord(pullRequest) ? pullRequest['paths'] : undefined
  return Array.isArray(paths) ? paths.filter(path => typeof path === 'string') : []
}

test('a pull request that changes any file holding a document starts the canary’s schema check', () => {
  const files = documentFiles().map(file => relative(ROOT, file).split(sep).join('/'))
  expect(files).toContain('hooks/mr-fragments.ts')
  expect(unwatched(files, canaryPaths())).toEqual([])
})

test('a document file that no canary path names, or that a later ! path leaves out, is found unwatched', () => {
  const paths = ['hooks/ask-*.ts', '!hooks/ask-old.ts']
  expect(unwatched(['hooks/ask-merge.ts', 'hooks/questions.ts', 'hooks/ask-old.ts', 'hooks/sub/ask-deep.ts'], paths)).toEqual([
    'hooks/questions.ts',
    'hooks/ask-old.ts',
    'hooks/sub/ask-deep.ts',
  ])
  expect(unwatched(['hooks/ask-old.ts'], [...paths, 'hooks/ask-old.ts'])).toEqual([])
})

test('a path in glob syntax GitHub reads otherwise than Node is refused, not misread', () => {
  for (const path of ['hooks/{ask,mr}-*.ts', 'hooks/@(ask|mr)-*.ts', 'hooks/ask-?.ts', 'hooks/ask-[ab].ts', 'hooks/ask+.ts', 'hooks/ask-!x.ts']) {
    expect(() => unwatched(['hooks/ask-x.ts'], ['hooks/*.ts', path])).toThrow(`glob syntax GitHub reads otherwise than Node: ${path}`)
  }
})

test('scoring a read adds GitLab’s own score of it and sample values for its variables', () => {
  const { query, variables } = scored(DOCUMENTS.MoveState)
  expect(query).toContain('queryComplexity')
  expect(Object.keys(variables).toSorted()).toEqual(['iid', 'path'])
})

test('a write is never made ready to be scored, as scoring sends it to gitlab.com, where it would run', () => {
  expect(() => scored(DOCUMENTS.Merge)).toThrow('Merge is a mutation, which is never sent to be scored')
})
