import { expect, test } from 'vitest'

import { authoredQuery } from '../../hooks/ask-authored.ts'
import { mergeStatusQuery } from '../../hooks/ask-merge-status.ts'
import { pinnedQuery } from '../../hooks/ask-pinned.ts'
import { threadsQuery } from '../../hooks/ask-threads.ts'
import { decodeGraphql, parseJson } from '../../hooks/decode.ts'
import { missingFeatures } from '../../hooks/gitlab-features.ts'
import { featuresOf, forgetProbed, learnLack } from '../../hooks/in-flight.ts'
import { argumentNotAccepted, undefinedField } from '../gitlab_fake.ts'
import { SELF_MANAGED } from '../fixtures.ts'

test("a host that answers a field as undefined is remembered to lack it, read from the error's extensions, and gets the documents without it", async () => {
  const said = (typeName: string, fieldName: string) => missingFeatures(decodeGraphql(parseJson(JSON.stringify(undefinedField(typeName, fieldName)))))
  expect(said('UserMergeRequestInteraction', 'reviewState')).toEqual(['hasReviewStates'])
  expect(said('MergeRequest', 'mergeabilityChecks')).toEqual(['hasMergeVerdict'])
  expect(said('Todo', 'targetEntity')).toEqual(['hasTodoEntity'])
  expect(said('Discussion', 'truncatedDiffLines')).toEqual(['hasDiffLines'])
  // A GitLab older than 16.5 refuses the comment filter as an argument, not a field.
  const refused = (name: string, argumentName: string) => missingFeatures(decodeGraphql(parseJson(JSON.stringify(argumentNotAccepted(name, argumentName)))))
  expect(refused('notes', 'filter')).toEqual(['hasCommentFilter'])
  expect(refused('discussions', 'filter')).toEqual([])
  expect(refused('notes', 'first')).toEqual([])
  // Another type's field of the same name, another field, and the words of the message alone are not it.
  expect(said('Project', 'reviewState')).toEqual([])
  expect(said('Query', '__type')).toEqual([])
  expect(missingFeatures(decodeGraphql(parseJson('{"errors":[{"message":"Field reviewState doesn\'t exist on type UserMergeRequestInteraction"}]}')))).toEqual([])
  expect(
    missingFeatures(decodeGraphql(parseJson('{"errors":[{"message":"x","extensions":{"code":"INTERNAL","typeName":"MergeRequest","fieldName":"mergeabilityChecks"}}]}')))
  ).toEqual([])
  forgetProbed()
  const current = featuresOf('git.corp.com')
  expect(current).toEqual({ hasMergeVerdict: true, hasReviewStates: true, hasTodoEntity: true, hasDiffLines: true, hasCommentFilter: true })
  // A host with review states but no comment filter gets the plain documents, which ask for every thread whole.
  const unfiltered = { ...current, hasCommentFilter: false }
  expect([authoredQuery(unfiltered, { kind: 'open' }).operation, pinnedQuery({ url: '', host: SELF_MANAGED, path: 'g/p', iid: 3 }, unfiltered).operation]).toEqual([
    'AuthoredPlain',
    'PinnedPlain',
  ])
  expect(authoredQuery(unfiltered, { kind: 'open' }).query).not.toContain('ONLY_COMMENTS')
  expect(authoredQuery(current, { kind: 'open' }).query).toContain('ONLY_COMMENTS')
  learnLack('git.corp.com', 'hasReviewStates')
  learnLack('git.corp.com', 'hasDiffLines')
  expect(learnLack('git.corp.com', 'hasMergeVerdict')).toEqual({ hasMergeVerdict: false, hasReviewStates: false, hasTodoEntity: true, hasDiffLines: false, hasCommentFilter: true })
  const older = featuresOf('git.corp.com')
  expect(featuresOf('gitlab.com')).toEqual(current)
  forgetProbed()
  expect(featuresOf('git.corp.com')).toEqual(current)
  expect(authoredQuery(current, { kind: 'open' }).operation).toBe('Authored')
  expect(authoredQuery(current, { kind: 'open' }).query).toContain('reviewState')
  expect(authoredQuery(older, { kind: 'open' }).operation).toBe('AuthoredPlain')
  expect(authoredQuery(older, { kind: 'open' }).query).not.toContain('reviewState')
  // A whole read asks for the open MRs; a delta for MRs of any state changed after a moment.
  expect(authoredQuery(current, { kind: 'open' }).variables).toEqual({ state: 'opened' })
  expect(authoredQuery(current, { kind: 'since', after: '2026-10-23T15:00:00.000Z' }).variables).toEqual({ after: '2026-10-23T15:00:00.000Z' })
  expect(authoredQuery(current, { kind: 'since', after: 'x' }).query).toContain('updatedAfter: $after')
  expect(mergeStatusQuery(current)?.operation).toBe('MergeStatus')
  expect(mergeStatusQuery(older)).toBeNull()
  const pin = { url: 'https://git.corp.com/g/p/-/merge_requests/3', host: SELF_MANAGED, path: 'g/p', iid: 3 }
  expect([pinnedQuery(pin, current).operation, pinnedQuery(pin, older).operation]).toEqual(['Pinned', 'PinnedPlain'])
  expect(pinnedQuery(pin, older).variables).toEqual({ path: 'g/p', iid: '3' })
  // A page's threads are asked without their diff lines of a host that has none.
  expect([threadsQuery('g/p', 3, current).operation, threadsQuery('g/p', 3, older).operation]).toEqual(['Threads', 'ThreadsPlain'])
  expect(threadsQuery('g/p', 3, older).query).not.toContain('truncatedDiffLines')
})
