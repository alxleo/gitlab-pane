import { expect, test } from 'vitest'

import { bareHost, namedHosts, parseHosts, parseTokens, projectLabel, redact } from '../../hooks/hosts.ts'
import { mrUrls, parseMrUrl, pinKey } from '../../hooks/mr-url.ts'

test('hosts are bare names, home first; an address is an MR only on a host the settings name; a token never survives into words', async () => {
  expect(parseHosts(undefined)).toEqual(['gitlab.com'])
  expect(parseHosts(['https://Git.Corp.com/', 'gitlab.com'])).toEqual(['git.corp.com', 'gitlab.com'])
  expect(parseHosts('git.corp.com:8443, git.corp.com:8443, not a host')).toEqual(['git.corp.com:8443'])
  expect(bareHost('git.corp.com/sub')).toBe('')
  const hosts = ['git.corp.com', 'gitlab.com']
  expect(parseMrUrl('https://git.corp.com/a/b/c/-/merge_requests/9#note_1', hosts)).toEqual({
    url: 'https://git.corp.com/a/b/c/-/merge_requests/9',
    host: 'git.corp.com',
    path: 'a/b/c',
    iid: 9,
  })
  expect(pinKey({ url: '', host: 'git.corp.com', path: 'a/b', iid: 9 })).toBe('git.corp.com/a/b!9')
  expect(parseMrUrl('https://other.example/a/-/merge_requests/9', hosts)).toBeNull()
  expect(parseMrUrl('https://gitlab.com/a/-/merge_requests/9', ['git.corp.com'])).toBeNull()
  expect(
    'Opened https://git.corp.com/g/p/-/merge_requests/4 and https://gitlab.com/x/-/merge_requests/5 not https://evil.example/g/-/merge_requests/6'.match(mrUrls(hosts))
  ).toEqual(['https://git.corp.com/g/p/-/merge_requests/4', 'https://gitlab.com/x/-/merge_requests/5'])
  expect([projectLabel('gitlab.com', 'g/p'), projectLabel('git.corp.com', 'g/p')]).toEqual(['g/p', 'git.corp.com/g/p'])
  expect(parseTokens(['git.corp.com=glpat-abc', 'gitlab.com=glpat-def', 'x.example=nope'], hosts, hosts[0])).toEqual({ 'git.corp.com': 'glpat-abc', 'gitlab.com': 'glpat-def' })
  expect(parseTokens(['glpat-first'], hosts, hosts[0])).toEqual({ 'git.corp.com': 'glpat-first' })
  // A hosts setting the pane cannot read (a path after the host) names no host: gitlab.com stands in, but the bare token
  // meant for the unread host is not sent to it.
  const unread = 'https://corp.example.com/gitlab'
  expect([parseHosts([unread]), namedHosts([unread])]).toEqual([['gitlab.com'], []])
  expect(parseTokens(['glpat-CORP'], parseHosts([unread]), namedHosts([unread])[0])).toEqual({})
  expect(redact('failed with Bearer abc123 and glpat-xyz_1 and s3cret', ['s3cret'])).toBe('failed with Bearer [token] and [token] and [token]')
})
