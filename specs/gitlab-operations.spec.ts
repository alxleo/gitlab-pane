import { expect, test } from 'vitest'
import { Kind, parse, visit } from 'graphql'

import { mergeWrite } from '../hooks/ask-merge'
import { moveStateQuery } from '../hooks/ask-move-state'
import { COMPLEXITY, DOCUMENTS, isWrite } from '../hooks/gitlab-operations'
import type { Operations } from '../hooks/gitlab-operations'
import { INBOX_FRAGMENTS } from '../hooks/inbox-fragments'
import { MR_FRAGMENTS } from '../hooks/mr-fragments'

const isOperation = (name: string): name is keyof Operations => Object.hasOwn(DOCUMENTS, name)

/** The kind of the one operation a document holds: query or mutation. */
const kindOf = (text: string): string => {
  const operation = parse(text).definitions.find(definition => definition.kind === Kind.OPERATION_DEFINITION)
  return operation?.kind === Kind.OPERATION_DEFINITION ? operation.operation : 'none'
}

test('a document that changes GitLab is a mutation and is sent once; every other is a query, which may be tried again', () => {
  for (const [name, text] of Object.entries(DOCUMENTS)) {
    expect(isOperation(name)).toBe(true)
    const operation = isOperation(name) ? name : 'Authored'
    expect([name, kindOf(text)]).toEqual([name, isWrite({ operation }) ? 'mutation' : 'query'])
  }
  expect(isWrite(mergeWrite('g/p', 1, 'abc', null, false))).toBe(true)
  expect(isWrite(moveStateQuery('g/p', 1))).toBe(false)
})

test('no write is scored: scoring a document sends it to gitlab.com', () => {
  expect(Object.keys(COMPLEXITY).filter(name => isOperation(name) && isWrite({ operation: name }))).toEqual([])
})

/** The names of the fragments a document defines. */
const definedIn = (text: string): string[] => parse(text).definitions.flatMap(definition => (definition.kind === Kind.FRAGMENT_DEFINITION ? [definition.name.value] : []))

/** The names of the fragments a document spreads, as GraphQL reads them rather than as `documentOf` finds them. */
const spreadIn = (text: string): Set<string> => {
  const names = new Set<string>()
  visit(parse(text), {
    FragmentSpread: spread => {
      names.add(spread.name.value)
    },
  })
  return names
}

test('every document holds its operation and exactly the fragments it uses, each once, as GitLab requires', () => {
  for (const [name, text] of Object.entries(DOCUMENTS)) {
    const operations = parse(text).definitions.filter(definition => definition.kind === Kind.OPERATION_DEFINITION)
    expect([name, operations.length]).toEqual([name, 1])
    expect([name, definedIn(text).toSorted()]).toEqual([name, [...spreadIn(text)].toSorted()])
  }
})

test('every fragment of a family is sent in some document, so none sits there unused', () => {
  const sent = new Set(Object.values(DOCUMENTS).flatMap(definedIn))
  const listed = [...MR_FRAGMENTS, ...INBOX_FRAGMENTS].flatMap(definedIn)
  expect(listed.filter(name => !sent.has(name))).toEqual([])
})
