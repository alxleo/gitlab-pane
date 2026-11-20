import fc from 'fast-check'
import { expect, test } from 'vitest'

import { badges, rank, rowBadges } from '../../hooks/attention.ts'
import { describe } from '../../hooks/wake.ts'
import { discMarks, discSource } from '../../hooks/avatar.ts'
import { ciStatusOf } from '../../hooks/gitlab-status.ts'
import { listedMrs, needsJobs } from '../../hooks/ask-authored.ts'
import { pinnedMr } from '../../hooks/ask-pinned.ts'
import { cleanBody, toCard } from '../../hooks/mr-card.ts'
import { passedMrArb, rawMrArb } from './arbitrary.ts'
import { slimCard } from '../../hooks/slim.ts'
import { decodeGraphql, parseJson } from '../../hooks/decode.ts'
import type { PinnedQuery } from '../../hooks/gitlab.generated.ts'
import { excerpt } from '../../hooks/format.ts'
import { flatOf } from '../../hooks/markdown.ts'
import { cardFacts } from '../../hooks/row-facts.ts'
import { HOST, NOW, SELF_MANAGED, commented, job, listed, note, pipe, project, rawMr, reviewer, stage, thread, user } from '../fixtures.ts'

/** The cards of a list read from `host`, as the leader makes them. */
const listedCards = (host: string, response: Parameters<typeof listedMrs>[0]) => listedMrs(response).map(raw => toCard(host, raw))

test('each person who reviewed or commented gets one icon; the author gets none, and a bot none unless it holds the merge', async () => {
  const card = toCard(
    HOST,
    rawMr(1, {
      reviewers: { nodes: [reviewer('tim.dunmore', 'REQUESTED_CHANGES'), reviewer('GitLabDuo', 'APPROVED', true)] },
      approvedBy: { nodes: [user('mel.northcote')] },
      discussions: {
        nodes: [
          thread('Rename this', 'tim.dunmore'),
          {
            resolvable: true,
            resolved: true,
            notes: {
              nodes: [
                note('Why this?', 'mel.northcote', { createdAt: '2026-10-23T13:00:00Z' }),
                note('Because', 'alex', { createdAt: '2026-10-23T13:10:00Z' }),
                note('Fair', 'mel.northcote', { createdAt: '2026-10-23T13:20:00Z' }),
              ],
            },
          },
          thread('Summary', 'GitLabDuo', false, false, true),
          thread('Nice work', 'tim.dunmore', false, false),
        ],
      },
    })
  )
  expect(card.people.map(person => [person.initials, person.state, person.openThreads, person.notes.length, person.isBot])).toEqual([
    ['TD', 'requested_changes', 1, 2, false],
    ['MN', 'approved', 0, 2, false],
  ])
  // Unresolved threads first, then newest first: a reply counts as theirs.
  expect(card.people[0]?.notes.map(one => [one.body, one.isOpen])).toEqual([
    ['Rename this', true],
    ['Nice work', false],
  ])
  expect(card.people[1]?.notes.map(one => one.body)).toEqual(['Fair', 'Why this?'])
  expect(rowBadges(card).map(badge => badge.kind)).toEqual(['approvals'])
})

test('comments sent in the order written go back into their threads, and make the card the threads make', () => {
  const at = (minute: number) => `2026-10-23T13:${String(minute).padStart(2, '0')}:00Z`
  const mr = rawMr(1, {
    discussions: {
      nodes: [
        { resolvable: true, resolved: false, notes: { nodes: [note('Rename this', 'tim', { createdAt: at(0) }), note('Still?', 'tim', { createdAt: at(20) })] } },
        { resolvable: true, resolved: true, notes: { nodes: [note('Why this?', 'mel', { createdAt: at(10) }), note('Because', 'alex', { createdAt: at(30) })] } },
        { resolvable: false, resolved: false, notes: { nodes: [note('Nice work', 'mel', { createdAt: at(40) })] } },
      ],
    },
  })
  const comments = commented(mr)
  expect(comments.notes.nodes?.map(one => one?.body)).toEqual(['Rename this', 'Why this?', 'Still?', 'Because', 'Nice work'])
  const card = toCard(HOST, comments)
  expect(card).toEqual(toCard(HOST, mr))
  expect(card.openThreads.map(open => [open.body, (open.replies ?? []).map(reply => reply.body)])).toEqual([['Rename this', ['Still?']]])
  expect(card.people.map(person => [person.username, person.notes.map(one => [one.body, one.isOpen])])).toEqual([
    [
      'tim',
      [
        ['Rename this', true],
        ['Still?', true],
      ],
    ],
    [
      'mel',
      [
        ['Nice work', false],
        ['Why this?', false],
      ],
    ],
  ])
})

test('any MR read as comments is the card read as threads', () => {
  fc.assert(
    fc.property(rawMrArb, raw => {
      expect(toCard(HOST, commented(raw))).toEqual(toCard(HOST, raw))
    })
  )
})

test('a list read of an MR whose pipeline passed with no warning shares the card a read with its jobs shares', () => {
  fc.assert(
    fc.property(passedMrArb, raw => {
      expect(needsJobs(listed(raw).headPipeline)).toBe(false)
      expect(slimCard(toCard(HOST, listed(raw)))).toEqual(slimCard(toCard(HOST, raw)))
    })
  )
})

test('two people with the same initials are told apart', async () => {
  const card = toCard(
    HOST,
    rawMr(1, {
      reviewers: { nodes: [reviewer('mel.northcote', 'UNREVIEWED'), reviewer('mia.nash', 'REVIEW_STARTED'), reviewer('cher', 'UNREVIEWED')] },
    })
  )
  expect(card.people.map(person => [person.initials, person.state])).toEqual([
    ['MNa', 'reviewing'],
    ['CH', 'unreviewed'],
    ['MNo', 'unreviewed'],
  ])
  // A disc draws letters only, so a hostile name adds no markup.
  expect(discMarks('x', 16, `<b/>A'"`)).toContain('>bA</text>')
  // Three UTF-16 units at most, a letter outside the basic plane (two units) whole or not at all: cutting at three left half.
  expect(discMarks('x', 16, 'A𠮷')).toContain('>A𠮷</text>')
  expect(discMarks('x', 16, 'AB𠮷')).toContain('>AB</text>')
  expect(discMarks('x', 16, 'ABC𠮷')).toContain('>ABC</text>')
  expect(discSource('tessa').startsWith("<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><circle")).toBe(true)
})

test("an author's own open thread stays a 💬 marker, since no icon holds it", async () => {
  const card = toCard(HOST, rawMr(1, { discussions: { nodes: [thread('Note to self', 'alex')] } }))
  expect(card.people).toEqual([])
  expect(rowBadges(card).map(badge => `${badge.glyph}${badge.count}`)).toEqual(['💬1', '👤0/1'])
})

test("a bot's request for changes and its open threads are its icon's; only what a model reads still says it in words", async () => {
  const identicon = 'https://secure.gravatar.com/avatar/ab12?s=80&d=identicon'
  const card = toCard(
    HOST,
    rawMr(1, {
      reviewers: { nodes: [reviewer('GitLabDuo', 'REQUESTED_CHANGES', true)] },
      discussions: {
        nodes: [
          {
            resolvable: true,
            resolved: false,
            notes: { nodes: [note('### Timeout undercuts wait', 'project_1_bot_ab12', { author: { ...user('project_1_bot_ab12', true), name: 'cursor', avatarUrl: identicon } })] },
          },
          thread('Summary of changes', 'GitLabDuo', false, false, true),
          thread('Looks good', 'tim', false, false),
        ],
      },
    })
  )
  // A bot's thread is not one a person waits on you to answer, and its request for changes is not a reviewer's.
  expect(card.openThreads).toEqual([])
  expect(card.changesRequestedBy).toEqual([])
  expect(card.people.map(person => [person.name, person.isBot, person.state, person.openThreads])).toEqual([
    ['Tim', false, 'commented', 0],
    ['GitLabDuo', true, 'requested_changes', 0],
    ['cursor', true, 'commented', 1],
  ])
  // GitLab's own picture for a bot is kept; a generated identicon is not one, so the pane draws a robot instead.
  expect(card.people.map(person => person.avatarUrl)).toEqual([
    'https://gitlab.com/uploads/-/system/user/avatar/1/tim.png?v=1',
    'https://gitlab.com/uploads/-/system/user/avatar/1/GitLabDuo.png?v=1',
    null,
  ])
  expect(card.people[2]?.notes.map(one => one.body)).toEqual(['### Timeout undercuts wait'])
  expect(rowBadges(card).map(badge => badge.kind)).toEqual(['approvals'])
  expect(badges(card).map(badge => `${badge.glyph}${badge.count}`)).toEqual(['🤖2', '👤0/1'])
  expect(rank(card)).toBe(2)
  expect(describe(card, NOW)).toContain('bots hold the merge: 1 open thread, GitLabDuo requested changes')
})

test('a review bot body draws as Markdown and reads as one line in a hover', async () => {
  const body = [
    '### Locate test timeout undercuts ready wait',
    '',
    '<!-- DESCRIPTION START -->',
    'The locate spec waits up to `ORDER_PAGE_READY_TIMEOUT`.',
    '<!-- DESCRIPTION END -->',
    '<!-- LOCATIONS START',
    'apps/x.spec.ts#L8-L28',
    'LOCATIONS END -->',
    '<div><a href="https://cursor.com/open"><picture><img alt="Fix in Cursor"></picture></a>&nbsp;</div>',
    'See ![shot](/uploads/abc/shot.png)',
  ].join('\n')
  const clean = cleanBody(body, HOST, 'g/p')
  expect(clean).toContain('See ![shot](https://gitlab.com/g/p/uploads/abc/shot.png)')
  expect(cleanBody('![shot](/uploads/abc/shot.png) [home](/g/p)', SELF_MANAGED, 'g/p')).toBe(
    '![shot](https://git.corp.com/g/p/uploads/abc/shot.png) [home](https://git.corp.com/g/p)'
  )
  expect(flatOf(clean)).toBe('### Locate test timeout undercuts ready wait\n\nThe locate spec waits up to `ORDER_PAGE_READY_TIMEOUT`.\n\nSee')
  expect(excerpt(clean)).toBe('Locate test timeout undercuts ready wait')
  expect(excerpt(cleanBody('## Summary\n\nDoes a thing that is long', HOST, 'g/p'), 12)).toBe('Summary')
  // Room 160 is 159 UTF-16 units and the ellipsis: a flag is four, so one that would pass 159 goes whole, not halved.
  expect(excerpt(cleanBody(`${'x'.repeat(156)}🇺🇸tail`, HOST, 'g/p'))).toBe(`${'x'.repeat(156)}…`)
})

test('a bot is called by its name, cut between characters when it is long', () => {
  const author = { ...user('ci-bot', true), name: `${'B'.repeat(10)}🇺🇸tail` }
  const discussion = { resolvable: true, resolved: false, notes: { nodes: [note('Reporting.', 'ci-bot', { author })] } }
  const card = toCard(HOST, rawMr(1, { discussions: { nodes: [discussion] } }))
  // Room 14 is 13 UTF-16 units and the ellipsis: 10 letters and a flag (four units) make 14, so the flag goes whole.
  expect(cardFacts(card, {}).people.map(person => person.call)).toEqual([`${'B'.repeat(10)}…`])
})

test('a status GitLab adds later reads as unknown, drawn as such, and a known one keeps its name', async () => {
  expect(ciStatusOf('WAITING_FOR_RESOURCE')).toBe('waiting_for_resource')
  expect(ciStatusOf('A_STATUS_GITLAB_ADDS_LATER')).toBe('unknown')
  // The status arrives as text from GitLab, so the test sends one the types do not name through the same decoder.
  const unseen = 'A_STATUS_GITLAB_ADDS_LATER'
  const unseenStage = (name: string) => ({ ...stage(name, 'RUNNING', []), status: unseen, jobs: { nodes: [{ ...job(name, 'RUNNING'), status: unseen }] } })
  const wire = {
    data: { project: { mergeRequest: { ...rawMr(1), headPipeline: { ...pipe('RUNNING'), status: unseen, stages: { nodes: [unseenStage('build'), unseenStage('test')] } } } } },
  }
  const raw = pinnedMr(decodeGraphql<PinnedQuery>(parseJson(JSON.stringify(wire))))
  if (raw === null) {
    throw new Error('the pinned MR was not read')
  }
  const card = toCard(HOST, raw)
  expect(card.pipeline?.status).toBe('unknown')
  expect(card.pipeline?.stages.map(each => [each.status, each.jobs.map(one => one.status)])).toEqual([
    ['unknown', ['unknown']],
    ['unknown', ['unknown']],
  ])
  expect(card.pipeline?.failed).toEqual([])
})

test("a bot's approval does not count", async () => {
  const card = toCard(HOST, rawMr(1, { approvedBy: { nodes: [user('GitLabDuo', true), user('tim')] } }))
  expect(card.approvers).toEqual(['tim'])
})

test('a description written to break reading leaves every card in the read, the others as they were', () => {
  const hostile = `${'<details>'.repeat(6_000)}${'</details>'.repeat(6_000)}`
  const cards = listedCards(HOST, { data: { currentUser: { authoredMergeRequests: { nodes: [rawMr(1, { description: hostile }), rawMr(2)] } } } })
  expect(cards.map(card => card.iid)).toEqual([1, 2])
  // Read, not skipped: the folds past sixteen deep are words, so the description leads with its outer fold, closed.
  expect(cards[0]?.lead).toBe('▸ Details')
  expect(cards[1]?.lead).toBe('Does thing 2.')
})

test('a partial GraphQL answer keeps what came back, and what the schema lets be null reads as absent; no data at all throws', async () => {
  const cards = listedCards(HOST, { data: { currentUser: { authoredMergeRequests: { nodes: [rawMr(1), null] } } }, errors: [{ message: 'no access' }] })
  expect(cards.map(card => card.iid)).toEqual([1])
  expect(pinnedMr({ data: { project: null }, errors: [{ message: 'no access' }] })).toBeNull()
  expect(() => listedCards(HOST, { errors: [{ message: 'bad token' }] })).toThrow('bad token')

  // What the schema lets be null reads as absent, or as the MR's own address: nodes, an address, a name, a status.
  const nameless = { ...job('x', 'FAILED'), name: null, status: null, webPath: null }
  const card = toCard(
    SELF_MANAGED,
    rawMr(7, {
      webUrl: null,
      project: { ...project(), webUrl: null },
      approvedBy: { nodes: null },
      reviewers: { nodes: [null] },
      headPipeline: pipe('FAILED', {
        path: null,
        stages: { nodes: [null, { name: null, status: null, jobs: { nodes: [null, nameless] } }] },
      }),
      discussions: { nodes: [null, { resolvable: true, resolved: false, notes: { nodes: [null, note('rename this', 'reviewer', { url: null })] } }] },
    })
  )
  const mr = 'https://git.corp.com/g/p/-/merge_requests/7'
  expect(card.url).toBe(mr)
  expect(card.repo.url).toBe('https://git.corp.com/g/p')
  // The same project number on two hosts is two cards: the key and the project carry the host.
  expect([card.key, card.project, card.host, card.path]).toEqual(['git.corp.com/g/p!7', 'git.corp.com/g/p', 'git.corp.com', 'g/p'])
  expect(toCard(HOST, rawMr(7)).key).toBe('gitlab.com/g/p!7')
  expect(card.approvers).toEqual([])
  expect(card.reviewers).toEqual([])
  expect(card.pipeline?.url).toBe(mr)
  expect(card.pipeline?.stages).toEqual([
    {
      name: '(unnamed)',
      status: 'unknown',
      jobs: [{ name: '(unnamed)', status: 'unknown', allowFailure: false, url: mr, startedAt: '2026-10-23T14:50:00Z', finishedAt: '2026-10-23T15:00:00Z' }],
      ran: { done: [[Date.parse('2026-10-23T14:50:00Z'), Date.parse('2026-10-23T15:00:00Z')]], running: [] },
    },
  ])
  expect(card.openThreads.map(open => open.url)).toEqual([mr])
})

test('a reviewer with no review state yet to be read is not yet reviewed, and the MR still reads', () => {
  const [card] = listedCards(SELF_MANAGED, { data: { currentUser: { authoredMergeRequests: { nodes: [{ ...rawMr(1), reviewers: { nodes: [user('tim')] } }] } } } })
  expect(card?.reviewers).toEqual([{ username: 'tim', isBot: false, state: 'unreviewed' }])
})
