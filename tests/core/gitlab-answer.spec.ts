import { expect, test } from 'vitest'
import fc from 'fast-check'

import { Failure } from '../../hooks/failure.ts'
import { environmentToken, isWorthAnotherTry, readAnswer, refusalOf } from '../../hooks/gitlab-answer.ts'
import type { Answer } from '../../hooks/gitlab-answer.ts'

const HOST = 'gitlab.example.com'
const notCut = () => null

/** What reading `answer` as a GraphQL read throws, or null when it reads. */
const failureOf = (answer: Answer, isCut: (text: string) => string | null = notCut): Failure | null => {
  try {
    readAnswer(HOST, 'glab', answer, 'read_api', isCut)
    return null
  } catch (error) {
    return error instanceof Failure ? error : null
  }
}

test("a gateway's error page, which is not JSON, is the server failing, said with its status", () => {
  const failure = failureOf({ status: 502, text: '<html>Bad gateway</html>' })
  expect(failure?.kind).toBe('server')
  expect(failure?.message).toBe(`${HOST} answered HTTP 502`)
})

test('a body that is not JSON under a success asks whether the host is a GitLab', () => {
  expect(failureOf({ status: 200, text: '' })?.kind).toBe('bad-answer')
  expect(failureOf({ status: 200, text: '' })?.message).toContain('is not JSON: is https://gitlab.example.com/api/graphql a GitLab?')
})

test('a body cut short says so instead of calling it not JSON', () => {
  expect(failureOf({ status: 200, text: '{"data":' }, () => 'more than the reader reads')?.message).toBe(`${HOST} answered more than the reader reads`)
})

test('a partial answer is kept: the data beside the errors', () => {
  const read = readAnswer<{ a: number }>(HOST, 'glab', { status: 200, text: '{"data":{"a":1},"errors":[{"message":"Timeout"}]}' }, 'read_api', notCut)
  expect(read.data).toEqual({ a: 1 })
  expect(read.errors?.[0]?.message).toBe('Timeout')
})

test('a rejected token says which one was rejected and never the token, and a refused one names the scope it lacks', () => {
  expect(failureOf({ status: 401, text: '{}' })?.message).toBe(`${HOST} rejected the token from glab (HTTP 401)`)
  expect(refusalOf(HOST, 'the environment', 403, 'the api scope')?.message).toBe(`${HOST} refused the token from the environment (HTTP 403): it needs the api scope`)
  expect(refusalOf(HOST, 'glab', 202, 'the api scope')).toBeNull()
})

test('an error page in JSON with neither data nor errors is a failure that quotes its message', () => {
  expect(failureOf({ status: 404, text: '{"message":"404 Not Found"}' })?.message).toBe(`${HOST} answered HTTP 404: 404 Not Found`)
})

test('only an answer of 500 or more is worth sending a read again for', () => {
  fc.assert(
    fc.property(fc.integer({ min: 100, max: 599 }), status => {
      expect(isWorthAnotherTry({ status, text: '' })).toBe(status >= 500)
    })
  )
})

test('a token in the environment goes only to the host glab would talk to, never to another', () => {
  expect(environmentToken({ GITLAB_ACCESS_TOKEN: 'for-one' }, 'gitlab.com', 'gitlab.com')).toBe('for-one')
  expect(environmentToken({ GITLAB_ACCESS_TOKEN: 'for-one' }, HOST, 'gitlab.com')).toBeNull()
  expect(environmentToken({ OAUTH_TOKEN: 'for-one', GITLAB_HOST: 'gitlab.com' }, HOST, HOST)).toBeNull()
  expect(environmentToken({ GITLAB_TOKEN: 'for-two', GL_HOST: `https://${HOST}` }, HOST, 'gitlab.com')).toBe('for-two')
})

test("the environment's first token with something in it is taken, its spaces trimmed", () => {
  expect(environmentToken({ GITLAB_TOKEN: '  ', GITLAB_ACCESS_TOKEN: ' second \n', OAUTH_TOKEN: 'third' }, HOST, HOST)).toBe('second')
  expect(environmentToken({}, HOST, HOST)).toBeNull()
})
