// Draws the pane on the desktop surface for each README scene, from GitLab answers made up here, and prints
// every drawn tree as one `PANE-SCENE <json>` line on the test's output. tools/pane_screens.ts copies this file into a
// scratch copy of the mod as `scenes.test.ts` and reads those lines back; it is not named *.test.ts here so that
// `claude plugin test .` never runs it as one of the mod's own tests.
//
// Everyone and everything below is fictional. The clock is mocked, so every "5m ago" is the same on every run.
import { mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Mounted } from 'claude-code/testing'

import { isFilled, isRecord } from '../../hooks/decode'
import type { CiJobStatus, MergeRequestReviewState } from '../../hooks/gitlab.generated'
import { NOW, checks, job, mergeStatuses, note, pipe, project, rawMr, reviewer, stage, thread } from '../../tests/fixtures'
import type { Mr } from '../../tests/fixtures'
import { fakeGitLab, fakeSession, ran } from '../../tests/gitlab_host'
import { comment, emptyWorld, fields, inboxAnswers, system } from '../../tests/inbox_fixtures'
import type { Person, World } from '../../tests/inbox_fixtures'

const PANE = {
  plugin: 'gitlab-pane',
  component: 'Pane',
  requestId: 'gitlab-pane',
  props: { title: 'GitLab', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const FIRST_SYNC_MS = 2_000

const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

/** A reviewer with no picture, so the pane draws their initials as it does for anyone GitLab has no picture of. */
const who = (username: string, state: MergeRequestReviewState) => ({ ...reviewer(username, state), avatarUrl: null })
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
const storefrontJob = (name: string, status: CiJobStatus, over: Parameters<typeof job>[2] = {}) => job(name, status, { webPath: `/acme-corp/storefront/-/jobs/${name}`, ...over })

const withThread = (body: string, author: string, repo: string, iid: number, file: string, line: number) => {
  const base = thread(body, author)
  return {
    ...base,
    notes: {
      nodes: [
        note(body, author, {
          url: `${url(repo, iid)}#note_${iid}${line}`,
          createdAt: minutesAgo(35),
          author: {
            username: author,
            name: author
              .split('.')
              .map(w => w[0]?.toUpperCase() + w.slice(1))
              .join(' '),
            bot: false,
            avatarUrl: null,
          },
          position: { filePath: file, newLine: line, oldLine: null },
        }),
      ],
    },
  }
}

/** The merge requests Dana has open, with every state the pane has a word or a colour for. */
const mine = (): Mr[] => [
  rawMr(482, {
    title: 'feat: [SHOP-214] Save cards at checkout',
    webUrl: url('acme-corp/storefront', 482),
    project: STOREFRONT,
    sourceBranch: 'feat/saved-cards',
    description:
      '## Why\n\nShoppers retype their card on every order. This saves it with the payment provider and offers it at checkout.\n\n## What\n\n- Tokenise the card in the provider vault\n- A saved-cards list on the checkout page',
    updatedAt: minutesAgo(6),
    approvalsLeft: 1,
    approvalsRequired: 2,
    mergeabilityChecks: checks({ NOT_APPROVED: 'FAILED' }),
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
    discussions: {
      nodes: [
        withThread(
          'This stores the card number in the cart cookie. Can the token come from the payment provider instead?',
          BOB,
          'acme-corp/storefront',
          482,
          'src/checkout/cards.ts',
          42
        ),
      ],
    },
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
    mergeabilityChecks: checks({ NOT_APPROVED: 'FAILED' }),
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
    discussions: {
      nodes: [withThread('Half-cents should round to even here, per the finance spec. Is `Math.round` what we want?', ALICE, 'acme-corp/storefront', 479, 'src/cart/total.ts', 88)],
    },
  }),
  // In the repo the session works in, so its conflicts can go to Claude here.
  rawMr(485, {
    title: 'feat: [SHOP-217] Keep the coupon when the cart reloads',
    webUrl: url('acme-corp/storefront', 485),
    project: STOREFRONT,
    sourceBranch: 'feat/sticky-coupon',
    description: '## What\n\nThe coupon is kept in the cart, not the page, so a reload keeps it.',
    updatedAt: minutesAgo(95),
    conflicts: true,
    approvalsLeft: 1,
    approvalsRequired: 1,
    mergeabilityChecks: checks({ NOT_APPROVED: 'FAILED', CONFLICT: 'FAILED' }),
    diffStatsSummary: { additions: 44, deletions: 17, fileCount: 4 },
    reviewers: { nodes: [who(CAROL, 'UNREVIEWED')] },
    headPipeline: pipe('SUCCESS', {
      id: 'gid://gitlab/Ci::Pipeline/9485',
      path: '/acme-corp/storefront/-/pipelines/9485',
      startedAt: minutesAgo(110),
      finishedAt: minutesAgo(102),
      duration: 470,
    }),
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
    mergeabilityChecks: checks(),
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
    // Behind its target in a repo that merges only by fast-forward: a rebase, beside the approval it still waits on.
    mergeabilityChecks: checks({ NOT_APPROVED: 'FAILED', NEED_REBASE: 'FAILED' }),
    shouldBeRebased: true,
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
    mergeabilityChecks: checks({ CONFLICT: 'FAILED' }),
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

/** The inbox the screenshot shows: a review asked of the viewer, and what others did on the viewer's own MR. */
const inboxWorld = (): World => {
  const billing = (iid: number, title: string, author: Person) => ({
    ...fields(iid, author, { title, webUrl: url('acme-corp/billing-api', iid), createdAt: minutesAgo(3_000) }),
    project: { fullPath: 'acme-corp/billing-api' },
  })
  const named = (username: string): Person => ({
    username,
    name: username
      .split('.')
      .map(w => w[0]?.toUpperCase() + w.slice(1))
      .join(' '),
  })
  const infra = {
    ...fields(61, named(ERIN), { title: 'chore: [OPS-14] Pin the runner image by digest', webUrl: url('acme-corp/infra', 61), createdAt: minutesAgo(27) }),
    project: { fullPath: 'acme-corp/infra' },
  }
  const storefront = {
    ...fields(488, named(CAROL), { title: 'fix: [SHOP-220] Guard the empty cart at checkout', webUrl: url('acme-corp/storefront', 488), createdAt: minutesAgo(2_000) }),
    project: { fullPath: 'acme-corp/storefront' },
  }
  return {
    ...emptyWorld(),
    user: 'alex',
    queue: [
      { ...infra, notes: { pageInfo: { hasPreviousPage: false }, nodes: [] }, approvedBy: { nodes: [] } },
      { ...storefront, notes: { pageInfo: { hasPreviousPage: false }, nodes: [system(8, CAROL, 95, 'commit', 'added 1 commit')] }, approvedBy: { nodes: [] } },
    ],
    opened: [
      {
        ...billing(140, 'feat: [BILL-95] Retry failed invoice emails', { username: 'alex', name: 'Alex' }),
        notes: {
          pageInfo: { hasPreviousPage: false },
          nodes: [
            system(1, ALICE, 140, 'commit', 'added 2 commits'),
            system(2, ERIN, 64, 'approved'),
            comment(71, BOB, 11, 'Should the retries back off, or is a fixed delay fine here?'),
          ],
        },
      },
    ],
  }
}

/** GitLab as the scenes set it; every command not listed here fails, so nothing real is ever asked. */
function engine(on: On, mrs: Mr[]) {
  // The same session the tests use: an id, a store shared as the engine shares it, and the panes the pane asks after.
  const { titles } = fakeSession(on, { id: 'scene' })
  const world = inboxWorld()
  fakeGitLab(
    on,
    {
      'gitlab.com': {
        answers: {
          Usual: () => ({ data: { project: { pipelines: { nodes: [420, 480, 540, 600, 660, 720].map(duration => ({ duration })) } } } }),
          MergeStatus: () => mergeStatuses(mrs),
          Authored: () => ({ data: { currentUser: { authoredMergeRequests: { nodes: mrs } } } }),
          // An MR's page reads it whole, description and threads, as the pane does on demand.
          Pinned: ({ path, iid }) => ({
            data: { project: { mergeRequest: mrs.find(mr => mr.iid === iid && mr.project.fullPath === path) ?? null } },
          }),
          ...inboxAnswers(world),
        },
        accepts: 'scene-token',
      },
    },
    { env: { GITLAB_TOKEN: 'scene-token' } }
  )
  on('process.run', (_, e) => ran('', 1, `nothing in the scenes answers ${e.argv.join(' ')}`))
  on('command.register', () => ({ value: { command: 'gitlab' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__gitlab-pane__watch_mr' } }))
  on('ui.toast', () => ({ value: undefined }))
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
  const found = buttons.find(button => button.key === prefix) ?? buttons.find(button => button.key?.startsWith(prefix) === true)
  const key = found?.key
  if (!isFilled(key)) {
    throw new Error(`no button keyed ${prefix}`)
  }
  await ui.press({ key })
}

type Node = { type: string; props?: Record<string, unknown>; hover?: { scope?: string }; children?: (Node | string)[] }

/** Whether a drawn tree has the shape the screens read: elements with a type, perhaps props, a hover scope and children. */
const isNode = (value: unknown): value is Node =>
  isRecord(value) &&
  typeof value.type === 'string' &&
  (value.props === undefined || isRecord(value.props)) &&
  (value.hover === undefined || (isRecord(value.hover) && (value.hover.scope === undefined || typeof value.hover.scope === 'string'))) &&
  (value.children === undefined || (Array.isArray(value.children) && value.children.every(child => typeof child === 'string' || isNode(child))))

/** A scene is the pane after its steps, drawn with no pointer on it: nothing on the pane waits for one. */
type Scene = { name: string; steps: (ui: Ui) => Promise<void> }

const SCENES: Scene[] = [
  { name: 'mine', steps: async () => {} },
  {
    name: 'mine-pinned',
    steps: async ui => {
      await press(ui, 'pin-479-')
    },
  },
  {
    name: 'reading',
    steps: async ui => {
      await press(ui, 'open-479-')
    },
  },
  {
    name: 'reading-person',
    steps: async ui => {
      await press(ui, 'person-bob.baker-482-')
    },
  },
  {
    name: 'inbox',
    steps: async ui => {
      await press(ui, 'tab-inbox')
      await press(ui, 'inbox-rule-on-my-mrs')
      await press(ui, 'inbox-open-')
    },
  },
]

// Said before any scene draws, so the caller knows which trees to expect and can tell a scene that was lost from one
// that was never there.
console.log(`PANE-SCENES ${JSON.stringify(SCENES.map(scene => scene.name))}`)

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
    if (!isNode(tree)) {
      throw new Error(`scene ${scene.name}: the pane did not draw a tree of elements`)
    }
    const drawn = { name: scene.name, title: titles.at(-1) ?? 'GitLab', hover: [], hoverKeys: [], tree }
    console.log(`PANE-SCENE ${JSON.stringify(drawn)}`)
    await ui.unmount()
  })
}
