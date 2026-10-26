import type { Register } from 'claude-code'

import { MR_URLS, byAttention, describe } from './ci'
import { briefCommand, inboxTick, syncInbox } from './inbox'
import { useJiraSite } from './jira'
import { drawPane } from './pane'
import { closeReading, openRows, pin, quietly, refresh, tick } from './read'
import { drawReading } from './reading'

// The engine reads a hook's matcher from literals and this file's consts only, so the panes' ids live here.
const PANE = 'gitlab-ci'
const TITLE = 'GitLab'
/** The reading pane; read.ts opens it under the same id (READING_PANE). */
const READING = 'gitlab-ci-mr'
const TOOL = 'mcp__gitlab-ci__watch_mr'
const TICK_MS = 30_000
/** mr-inbox shares one sync across sessions, so asking every minute costs GitLab at most one pass a minute. */
const INBOX_TICK_MS = 60_000
/** The inbox starts a moment after the pane's own read, so the two do not race for the first answers. */
const INBOX_FIRST_MS = 2_000

/** What the pane last did, so /gitlab can say why it is blank; a reload starts it over. */
const health = { loadedAt: '', draws: 0, last: 'never asked to draw', open: 'not opened since load' }

export const register: Register = (on, options) => {
  useJiraSite(options.jiraUrl)
  on('session.start', async ($, e, next) => {
    health.loadedAt = new Date(await $.clock.now()).toISOString().slice(11, 19)
    await $.command.register({
      name: 'gitlab',
      description: 'Open the GitLab pane: your open merge requests, their pipelines and reviewers',
    })
    await $.tool.register({
      name: 'watch_mr',
      description:
        'Pin a GitLab merge request to this session: answers its pipeline and merge blockers now, puts it at the top of the GitLab pane, and wakes the session when its pipeline fails or finishes.',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'https://gitlab.com/<project>/-/merge_requests/<iid>' } },
        required: ['url'],
      },
      isDeferred: false,
    })
    await $.command.register({
      name: 'mrs',
      description: 'Brief several GitLab MRs into this conversation, threads and all: /mrs <repo!iid …> or /mrs --rule <name>',
    })
    $.clock.every(TICK_MS, () => quietly(tick($)))
    $.clock.every(INBOX_TICK_MS, () => quietly(inboxTick($)))
    // A start or a reload reads at once, so rows kept from an older version are replaced before they are drawn for long.
    quietly(refresh($))
    // Opened unasked only where something draws it, or the engine logs the miss.
    if ((await $.session.surfaces()).length > 0) {
      quietly($.ui.open({ id: PANE, title: TITLE }))
      $.clock.after(INBOX_FIRST_MS, () => quietly(syncInbox($)))
    }
    return next(e)
  })

  on('command.run', { command: 'mrs' }, async ($, e) => briefCommand($, e.args))

  on('command.run', { command: 'gitlab' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    health.open = opened.isPlaced ? 'a surface draws it' : 'no surface draws it'
    quietly(refresh($))
    const [rows, now] = await Promise.all([openRows($), $.clock.now()])
    const pane = `pane: ${health.open}; drawn ${health.draws} times, last ${health.last}; mod loaded ${health.loadedAt} UTC`
    return {
      text: [pane, ...(rows.length > 0 ? [...rows].sort(byAttention).map(row => describe(row, now)) : ['No open merge request yet; reading GitLab.'])].join('\n'),
    }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const { url } = e as { url?: unknown }
    try {
      const result = await pin($, String(url ?? ''))
      quietly($.ui.open({ id: PANE, title: TITLE }))
      return { result }
    } catch (error) {
      return { deny: error instanceof Error ? error.message : String(error) }
    }
  })

  // An MR opened from this session is pinned, as the app picks up a GitHub PR.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const command = String((e as { command?: unknown }).command ?? '')
    if (!/\bmr create\b|merge_request\.create/.test(command) || !ran.text) {
      return ran
    }
    const urls = new Set(ran.text.match(MR_URLS) ?? [])
    for (const url of urls) {
      await pin($, url).catch(() => undefined)
    }
    if (urls.size > 0) {
      quietly($.ui.open({ id: PANE, title: TITLE }))
    }
    return ran
  }).catch(($, e, next) => next(e))

  // A drawing that throws says why in the pane, where the engine would only report it in the debug log.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    health.draws += 1
    try {
      const tree = await drawPane($, e)
      health.last = `drew ${JSON.stringify(tree).length} characters on ${e.surface}`
      return tree
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      health.last = `threw on ${e.surface}: ${message}`
      const { Text } = $.ui.resolve(e)
      return <Text color="error">{`The GitLab pane failed to draw: ${message}`}</Text>
    }
  })

  on('ui.render', { component: 'Pane', requestId: READING }, async ($, e) => {
    try {
      return await drawReading($, e)
    } catch (error) {
      const { Text } = $.ui.resolve(e)
      return <Text color="error">{`The reading pane failed to draw: ${error instanceof Error ? error.message : String(error)}`}</Text>
    }
  })

  // Closing the reading pane closes the cards it showed, so the list and the pane never disagree.
  on('ui.close', { id: READING }, async ($, e, next) => {
    if (e.origin.kind === 'person') {
      quietly(closeReading($))
    }
    return next(e)
  })
}
