// Draws the pane on the desktop surface for each README scene, from GitLab and mr-inbox answers made up here, and prints
// every drawn tree as one `PANE-SCENE <json>` line on the test's output. tools/pane_screens.py copies this file into a
// scratch copy of the mod as `scenes.test.ts` and reads those lines back; it is not named *.test.ts here so that
// `claude plugin test .` never runs it as one of the mod's own tests.
//
// Everyone and everything below is fictional. The clock is mocked, so every "5m ago" is the same on every run.
import { mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Mounted } from 'claude-code/testing'

import { NOW, job, note, pipe, project, rawMr, reviewer, stage, thread } from '../../tests/fixtures'

import type { RawMr } from '../../hooks/gitlab'

const PANE = {
  plugin: 'gitlab-ci',
  component: 'Pane',
  requestId: 'gitlab-ci',
  props: { title: 'GitLab', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const FIRST_SYNC_MS = 2_000

const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

const ran = (stdout: string, exitCode = 0, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

/** A reviewer with no picture, so the pane draws their initials as it does for anyone GitLab has no picture of. */
const who = (username: string, state: string) => ({ ...reviewer(username, state), avatarUrl: null })
const approver = (username: string) => {
  const { mergeRequestInteraction: _ignored, ...user } = who(username, 'APPROVED')
  return user
}

const ALICE = 'alice.archer'
const BOB = 'bob.baker'
const CAROL = 'carol.clarke'
const DAVE = 'dave.dunn'
const ERIN = 'erin.ellis'

const STOREFRONT = project('acme-corp/storefront')
const BILLING = project('acme-corp/billing-api')
const INFRA = project('acme-corp/infra')

const url = (repo: string, iid: number) => `https://gitlab.com/${repo}/-/merge_requests/${iid}`

/** A job of one of the storefront's pipelines, linking where GitLab would (the fixtures' own jobs link to a placeholder repo). */
const storefrontJob = (name: string, status: string, over: Parameters<typeof job>[2] = {}) =>
  job(name, status, { webPath: `/acme-corp/storefront/-/jobs/${name}`, ...over })

const withThread = (body: string, author: string, repo: string, iid: number, file: string, line: number) => {
  const base = thread(body, author)
  return {
    ...base,
    notes: {
      nodes: [
        note(body, author, {
          url: `${url(repo, iid)}#note_${iid}${line}`,
          createdAt: minutesAgo(35),
          author: { username: author, name: author.split('.').map(w => w[0]?.toUpperCase() + w.slice(1)).join(' '), bot: false, avatarUrl: null },
          position: { filePath: file, newLine: line, oldLine: null },
        }),
      ],
    },
  }
}

/** The merge requests Dana has open, with every state the pane has a word or a colour for. */
const mine = (): RawMr[] => [
  rawMr(482, {
    title: 'feat: [SHOP-214] Save cards at checkout',
    webUrl: url('acme-corp/storefront', 482),
    project: STOREFRONT,
    sourceBranch: 'feat/saved-cards',
    description: '## Why\n\nShoppers retype their card on every order. This saves it with the payment provider and offers it at checkout.\n\n## What\n\n- Tokenise the card in the provider vault\n- A saved-cards list on the checkout page',
    updatedAt: minutesAgo(6),
    approvalsLeft: 1,
    approvalsRequired: 2,
    detailedMergeStatus: 'NOT_APPROVED',
    diffStatsSummary: { additions: 412, deletions: 38, fileCount: 14 },
    approvedBy: { nodes: [approver(ALICE)] },
    reviewers: { nodes: [who(ALICE, 'APPROVED'), who(BOB, 'REQUESTED_CHANGES'), who(CAROL, 'UNREVIEWED')] },
    headPipeline: pipe('RUNNING', {
      id: 'gid://gitlab/Ci::Pipeline/9482',
      path: '/acme-corp/storefront/-/pipelines/9482',
      startedAt: minutesAgo(7),
      stages: {
        nodes: [
          stage('build', 'SUCCESS', [storefrontJob('compile', 'SUCCESS', { startedAt: minutesAgo(7), finishedAt: minutesAgo(5) })]),
          stage('test', 'RUNNING', [
            storefrontJob('unit', 'SUCCESS', { startedAt: minutesAgo(5), finishedAt: minutesAgo(3) }),
            storefrontJob('e2e', 'RUNNING', { startedAt: minutesAgo(5) }),
          ]),
          stage('deploy', 'CREATED', [storefrontJob('preview', 'CREATED', { startedAt: null })]),
        ],
      },
    }),
    discussions: { nodes: [withThread('This stores the card number in the cart cookie. Can the token come from the payment provider instead?', BOB, 'acme-corp/storefront', 482, 'src/checkout/cards.ts', 42)] },
  }),
  rawMr(479, {
    title: 'fix: [SHOP-209] Cart total rounds half-cents down',
    webUrl: url('acme-corp/storefront', 479),
    project: STOREFRONT,
    sourceBranch: 'fix/cart-rounding',
    description:
      '## Why\n\nA cart of three 0.335 items totalled one cent short, because each line was rounded before the sum.\n\n## What\n\n- Sum in integer cents and round once, at the end\n- A regression test with the three-item cart\n\n<details>\n<summary>Before and after</summary>\n\nBefore: 1.00. After: 1.01.\n</details>',
    updatedAt: minutesAgo(23),
    approvalsLeft: 1,
    approvalsRequired: 1,
    detailedMergeStatus: 'NOT_APPROVED',
    diffStatsSummary: { additions: 31, deletions: 9, fileCount: 3 },
    reviewers: { nodes: [who(ALICE, 'REVIEWED')] },
    headPipeline: pipe('FAILED', {
      id: 'gid://gitlab/Ci::Pipeline/9479',
      path: '/acme-corp/storefront/-/pipelines/9479',
      startedAt: minutesAgo(27),
      finishedAt: minutesAgo(23),
      duration: 238,
      stages: {
        nodes: [
          stage('build', 'SUCCESS', [storefrontJob('compile', 'SUCCESS', { startedAt: minutesAgo(27), finishedAt: minutesAgo(25) })]),
          stage('test', 'FAILED', [
            storefrontJob('unit', 'FAILED', { startedAt: minutesAgo(25), finishedAt: minutesAgo(23) }),
            storefrontJob('lint', 'SUCCESS', { startedAt: minutesAgo(25), finishedAt: minutesAgo(24) }),
          ]),
        ],
      },
    }),
    discussions: { nodes: [withThread('Half-cents should round to even here, per the finance spec. Is `Math.round` what we want?', ALICE, 'acme-corp/storefront', 479, 'src/cart/total.ts', 88)] },
  }),
  rawMr(133, {
    title: 'refactor: [BILL-88] Extract the invoice renderer',
    webUrl: url('acme-corp/billing-api', 133),
    project: BILLING,
    sourceBranch: 'refactor/invoice-renderer',
    description: '## What\n\nThe invoice PDF and the invoice email each built their own table. Both now call one renderer.',
    updatedAt: minutesAgo(52),
    approvalsLeft: 0,
    approvalsRequired: 2,
    detailedMergeStatus: 'MERGEABLE',
    diffStatsSummary: { additions: 240, deletions: 301, fileCount: 9 },
    approvedBy: { nodes: [approver(BOB), approver(ERIN)] },
    reviewers: { nodes: [who(BOB, 'APPROVED'), who(ERIN, 'APPROVED')] },
    headPipeline: pipe('SUCCESS', {
      id: 'gid://gitlab/Ci::Pipeline/9133',
      path: '/acme-corp/billing-api/-/pipelines/9133',
      startedAt: minutesAgo(70),
      finishedAt: minutesAgo(61),
      duration: 512,
    }),
  }),
  rawMr(131, {
    title: 'feat: [BILL-91] Tax rules for VAT-exempt customers',
    webUrl: url('acme-corp/billing-api', 131),
    project: BILLING,
    sourceBranch: 'feat/vat-exempt',
    description: '## What\n\nCustomers with a valid VAT number are invoiced without VAT. The number is checked once a day.',
    updatedAt: minutesAgo(190),
    approvalsLeft: 1,
    approvalsRequired: 1,
    detailedMergeStatus: 'NOT_APPROVED',
    diffStatsSummary: { additions: 96, deletions: 12, fileCount: 5 },
    reviewers: { nodes: [who(CAROL, 'REVIEW_STARTED'), who(DAVE, 'UNREVIEWED')] },
    headPipeline: pipe('SUCCESS', {
      id: 'gid://gitlab/Ci::Pipeline/9131',
      path: '/acme-corp/billing-api/-/pipelines/9131',
      startedAt: minutesAgo(200),
      finishedAt: minutesAgo(191),
      duration: 540,
    }),
  }),
  rawMr(57, {
    title: 'ci: [OPS-12] Cache the Terraform plan between jobs',
    webUrl: url('acme-corp/infra', 57),
    project: INFRA,
    sourceBranch: 'ci/cache-plan',
    description: '## What\n\nThe plan job reruns `terraform plan` for the apply job. Cache the plan file between them.',
    updatedAt: minutesAgo(1500),
    conflicts: true,
    approvalsLeft: 1,
    approvalsRequired: 1,
    detailedMergeStatus: 'CONFLICT',
    diffStatsSummary: { additions: 22, deletions: 4, fileCount: 2 },
    reviewers: { nodes: [who(ERIN, 'UNREVIEWED')] },
    headPipeline: pipe('SUCCESS', {
      id: 'gid://gitlab/Ci::Pipeline/957',
      path: '/acme-corp/infra/-/pipelines/957',
      startedAt: minutesAgo(1520),
      finishedAt: minutesAgo(1514),
      duration: 331,
    }),
  }),
]

const item = (repo: string, iid: number, title: string, author: string, unseen: number, counts: Record<string, number>, activity: unknown[]) => ({
  key: `${repo}!${iid}`,
  ref: `${repo.split('/')[1]}!${iid}`,
  project: repo,
  iid,
  title,
  url: url(repo, iid),
  author: { username: author, name: author, is_me: false },
  state: 'opened',
  draft: false,
  unseen,
  counts,
  activity,
})

const event = (kind: string, actor: string, minutes: number, excerpt = '', note = 0) => ({
  kind,
  actor,
  at: minutesAgo(minutes),
  url: kind === 'comment' ? `https://gitlab.com/acme-corp/billing-api/-/merge_requests/140#note_${note}` : null,
  excerpt,
})

const inboxSections = () => [
  {
    rule: 'people',
    title: 'Reviews: people I follow',
    note: null,
    items: [
      item('acme-corp/billing-api', 140, 'feat: [BILL-95] Retry failed invoice emails', ALICE, 2, { comment: 1, approved: 1 }, [
        event('comment', BOB, 11, 'Should the retries back off, or is a fixed delay fine here?', 71),
        event('approved', ERIN, 64),
        event('pushed', ALICE, 140),
      ]),
      item('acme-corp/storefront', 488, 'fix: [SHOP-220] Guard the empty cart at checkout', CAROL, 1, { review: 1 }, [
        event('review', DAVE, 38),
        event('pushed', CAROL, 95),
      ]),
    ],
  },
  {
    rule: 'to-review',
    title: 'To review',
    note: null,
    items: [
      item('acme-corp/infra', 61, 'chore: [OPS-14] Pin the runner image by digest', ERIN, 1, { review_requested: 1 }, [
        event('review_requested', ERIN, 27),
      ]),
    ],
  },
]

/** GitLab and mr-inbox as the scenes set them; every command not listed here fails, so nothing real is ever asked. */
function engine(on: On, mrs: RawMr[]) {
  mock.store(on, {})
  const titles: string[] = []
  on('process.run', (_, e) => {
    const at = e.argv.indexOf('mr-inbox')
    if (at >= 0) {
      const sub = e.argv[at + 1]
      if (sub === 'inbox') {
        return ran(JSON.stringify({ sync: { ok: true, finished_at: minutesAgo(1) }, sections: inboxSections() }))
      }
      return ran('{"ok": true}')
    }
    const query = e.argv.find(arg => arg.startsWith('query=')) ?? ''
    if (e.argv.includes('glab') && query) {
      if (query.includes('pipelines(source:')) {
        const aliases = [...query.matchAll(/(h\d+): project/g)].map(match => match[1] ?? '')
        const nodes = [420, 480, 540, 600, 660, 720].map(duration => ({ duration }))
        return ran(JSON.stringify({ data: Object.fromEntries(aliases.map(alias => [alias, { pipelines: { nodes } }])) }))
      }
      if (query.includes('detailedMergeStatus') && !query.includes('headPipeline')) {
        const nodes = mrs.map(mr => ({ iid: mr.iid, project: { fullPath: mr.project.fullPath }, detailedMergeStatus: mr.detailedMergeStatus }))
        return ran(JSON.stringify({ data: { currentUser: { authoredMergeRequests: { nodes } } } }))
      }
      if (query.includes('authoredMergeRequests')) {
        return ran(JSON.stringify({ data: { currentUser: { authoredMergeRequests: { nodes: mrs } } } }))
      }
    }
    return ran('', 1, `nothing in the scenes answers ${e.argv.join(' ')}`)
  })
  on('command.register', () => ({ value: { command: 'gitlab' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__gitlab-ci__watch_mr' } }))
  on('ui.open', (_, e) => {
    titles.push(e.title ?? '')
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('session.repo', () => ({ value: { root: '/r', remote: 'git@gitlab.com:acme-corp/storefront.git', internal: false, name: null } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return { titles }
}

type Ui = Mounted<'desktop', 'Pane'>

// A test has no console in the engine's types, but a test's output reaches `claude plugin test`'s: that is how trees leave.
declare const console: { log: (text: string) => void }

/** A button by the start of its key, as the pane makes keys from an MR's number or a hash. */
const press = async (ui: Ui, prefix: string) => {
  const buttons = await ui.findAll({ type: 'Button' })
  const found = buttons.find(button => button.key === prefix) ?? buttons.find(button => button.key?.startsWith(prefix))
  if (!found?.key) {
    throw new Error(`no button keyed ${prefix}`)
  }
  await ui.press({ key: found.key })
}

type Node = { type: string; props?: Record<string, unknown>; hover?: { scope?: string }; children?: (Node | string)[] }

const hasButton = (node: Node | string, keyPrefix: string): boolean =>
  typeof node !== 'string' && ((node.type === 'Button' && String(node.props?.key).startsWith(keyPrefix)) || (node.children ?? []).some(child => hasButton(child, keyPrefix)))

/** The hover group of the innermost Box around the Button keyed `keyPrefix…`: what the pointer lights when it rests on it. */
const scopeAround = (node: Node | string, keyPrefix: string): string | undefined => {
  if (typeof node === 'string') {
    return undefined
  }
  for (const child of node.children ?? []) {
    const found = scopeAround(child, keyPrefix)
    if (found) {
      return found
    }
  }
  return node.type === 'Box' && node.hover?.scope && hasButton(node, keyPrefix) ? node.hover.scope : undefined
}

/** `hover` names a Button by the start of its key: the scene is drawn as if the pointer rested on it. */
type Scene = { name: string; steps: (ui: Ui) => Promise<void>; hover?: string }

const SCENES: Scene[] = [
  { name: 'mine', steps: async () => {} },
  { name: 'mine-hover', steps: async () => {}, hover: 'person-bob.baker-482-' },
  {
    name: 'mine-open',
    steps: async ui => {
      await press(ui, 'open-482-')
    },
  },
  {
    name: 'reading',
    steps: async ui => {
      await press(ui, 'open-479-')
      await press(ui, 'read-479-')
    },
  },
  {
    name: 'inbox',
    steps: async ui => {
      await press(ui, 'tab-inbox')
      await press(ui, 'inbox-rule-people')
      await press(ui, 'inbox-open-')
    },
  },
]

for (const scene of SCENES) {
  test(`scene ${scene.name}`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const { titles } = engine(on, mine())
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await clock.settle()
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await clock.advance(FIRST_SYNC_MS)
    await scene.steps(ui)
    const tree = await ui.drawn()
    const scope = scene.hover ? scopeAround(tree as unknown as Node, scene.hover) : undefined
    if (scene.hover && !scope) {
      throw new Error(`scene ${scene.name}: nothing drawn is keyed ${scene.hover}`)
    }
    console.log(`PANE-SCENE ${JSON.stringify({ name: scene.name, title: titles.at(-1) ?? 'GitLab', hover: scope ? [scope] : [], tree })}`)
    await ui.unmount()
  })
}
