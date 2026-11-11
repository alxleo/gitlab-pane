// What README.md and DESIGN.md say in their tables, read by tools/docs.ts. Never edit it: `npm run docs -- write` makes it.
// `npm run docs -- check` fails while it differs from the docs, and tests/docs.test.ts while it differs from the code.

export const README = {
  commands: ['gitlab', 'mrs'],
  tools: ['watch_mr'],
  runs: [[30000, 60000, 120000, 600000, 300000], [], [], [300000], [1800000], [60000], [], [900000], [], [], [2000, 15000, 45000], [3000, 120000]],
} as const

export const DESIGN = {
  colours: [
    ['success', '#2da44e'],
    ['error', '#cf222e'],
    ['warning', '#bf8700'],
    ['suggestion', '#0969da'],
    ['subtle', '#8c959f'],
  ],
  checkTones: [
    [
      'error',
      ['CI_MUST_PASS', 'COMMITS_STATUS', 'CONFLICT', 'LOCKED_LFS_FILES', 'LOCKED_PATHS', 'REQUESTED_CHANGES', 'SECURITY_POLICY_PIPELINE_CHECK', 'SECURITY_POLICY_VIOLATIONS'],
    ],
    ['warning', ['DISCUSSIONS_NOT_RESOLVED', 'JIRA_ASSOCIATION_MISSING', 'NEED_REBASE', 'TITLE_REGEX']],
    ['subtle', ['DRAFT_STATUS', 'MERGE_REQUEST_BLOCKED', 'MERGE_TIME', 'NOT_APPROVED', 'NOT_OPEN', 'STATUS_CHECKS_MUST_PASS']],
  ],
  pipelineMarks: [
    ['✓', 'success', ['success']],
    ['✗', 'error', ['failed']],
    ['●', 'suggestion', ['created', 'waiting_for_resource', 'preparing', 'waiting_for_callback', 'pending', 'running', 'canceling', 'scheduled']],
    ['⏸', 'warning', ['manual']],
    ['⊘', 'subtle', ['skipped', 'canceled']],
    ['?', 'subtle', ['unknown']],
    ['○', 'subtle', []],
  ],
  badges: [
    ['✓', 'approved'],
    ['✕', 'requested changes'],
  ],
  links: ['🔀', '🎫', '📁', '🚦', '💬'],
  inboxEvents: [
    ['✗', 'requested changes'],
    ['↺', 'withdrew approval'],
    ['✓', 'approved'],
    ['●', 'reviewed'],
    ['💬', 'commented'],
    ['@', 'mentioned you'],
    ['?', 'asked for a review'],
    ['↑', 'pushed'],
    ['◆', 'merged'],
    ['✗', 'pipeline failed'],
    ['⚠', "can't merge"],
  ],
  inboxTabs: [
    ['Review requested', 'review-requested'],
    ['Mentions', 'mentions'],
    ['Build failed', 'build-failed'],
    ["Can't merge", 'cant-merge'],
    ['On my MRs', 'on-my-mrs'],
    ['Following', 'following'],
  ],
  moves: ['✓ merge', '↻ rebase', '↻ rebase and merge', '⇄ hand conflicts to Claude'],
} as const
