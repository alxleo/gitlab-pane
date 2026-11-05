import type { Register } from 'claude-code'

import { readHosts, readPoll, startData } from './data'
import { field, isFilled } from './decode'
import { forgetProblems, problems, quietly, reported } from './failures'
import { drawn, forgetFound, forgetProbed } from './in-flight'
import { rememberLogs } from './job-failures'
import { hostsLine, parseHosts } from './hosts'
import { briefCommand, inboxTick, syncInbox } from './inbox'
import type { ModelLine } from './model-text'
import { mrUrls } from './mr-url'
import { drawPane } from './pane'
import { forgetScrolling, openPane, readScrolling } from './panes'
import { pin, refresh, tick } from './poll'
import { rememberSettings } from './tokens'

// The engine reads a hook's matcher from literals and this file's consts only, so the pane's id lives here too.
export const PANE = 'gitlab-ci'
const TOOL = 'mcp__gitlab-ci__watch_mr'
const TICK_MS = 30_000
/** mr-inbox shares one sync across sessions, so asking every minute costs GitLab at most one pass a minute. */
const INBOX_TICK_MS = 60_000
/** The inbox starts a moment after the pane's own read, so the two do not race for the first answers. */
const INBOX_FIRST_MS = 2_000

/** A tool's answer: only lines from model-text.ts, so text from GitLab cannot reach the model raw. */
const answer = (result: ModelLine) => ({ result })

export const register: Register = (on, options) => {
  // What the pane last did, so /gitlab can say why it is blank. It lives here, in what this load of the mod owns, because the
  // render hook that keeps it may not write an atom (the engine denies a write while drawing); a reload starts it over.
  const health = { loadedAt: '', draws: 0, last: 'never asked to draw' }
  on('session.start', async ($, e, next) => {
    forgetProbed()
    const hosts = parseHosts(options.gitlabHosts)
    await Promise.all([startData($, options.jiraUrl, hosts), rememberSettings(options.gitlabTokens, hosts), rememberLogs($, options.failureLogs), forgetProblems($), forgetScrolling($)])
    health.loadedAt = new Date(await $.clock.now()).toISOString().slice(11, 19)
    await $.command.register({
      name: 'gitlab',
      description: 'Open the GitLab pane: your open merge requests, their pipelines and reviewers',
    })
    await $.tool.register({
      name: 'watch_mr',
      description:
        'Pin a GitLab merge request to this session: answers its pipeline and merge blockers now and puts it at the top of the GitLab pane. It does not wake the session; an MR this session creates does, when its pipeline fails or it can merge.',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'https://<host>/<project>/-/merge_requests/<iid>, on one of the GitLab hosts the settings name' } },
        required: ['url'],
      },
      isDeferred: false,
    })
    await $.command.register({
      name: 'mrs',
      description: 'Brief several GitLab MRs into this conversation, threads and all: /mrs <repo!iid …> or /mrs --rule <name>',
    })
    $.clock.every(TICK_MS, () => quietly($, tick($), 'gitlab'))
    $.clock.every(INBOX_TICK_MS, () => quietly($, inboxTick($), 'inbox'))
    // A start or a reload reads at once, so rows kept from an older version are replaced before they are drawn for long.
    quietly($, refresh($), 'gitlab')
    // Retires the separate reading pane an earlier version opened; the app keeps a pane across reloads.
    quietly($, $.ui.close({ id: 'gitlab-ci-mr' }))
    // Opened unasked only where something draws it, or the engine logs the miss.
    if ((await $.session.surfaces()).length > 0) {
      quietly($, openPane($))
      $.clock.after(INBOX_FIRST_MS, () => quietly($, syncInbox($), 'inbox'))
    }
    return next(e)
  })

  on('command.run', { command: 'mrs' }, async ($, e) => briefCommand($, e.args))

  // One line: the MRs belong in the pane. It still says enough to explain a pane that is blank or missing.
  on('command.run', { command: 'gitlab' }, async $ => {
    const opened = await openPane($)
    // Asked by hand, so a host that had no token is looked at again: glab may have signed in since.
    forgetFound()
    quietly($, refresh($), 'gitlab')
    const scrolling = await readScrolling($)
    const isGoingBackStuck = scrolling.goingBack !== '' && scrolling.goingBack !== 'done'
    const failures = await problems($)
    const hostLine = hostsLine((await readPoll($)).hosts)
    if (opened.isPlaced && !health.last.startsWith('threw') && scrolling.refused === '' && !isGoingBackStuck && failures.length === 0) {
      return { text: 'GitLab pane open' }
    }
    return {
      text: [
        opened.isPlaced ? 'GitLab pane open' : `GitLab pane not placed: ${opened.reason}`,
        `${health.last} (${health.draws} draws since ${health.loadedAt} UTC)`,
        ...(scrolling.refused !== '' ? [`last scroll refused: ${scrolling.refused}`] : []),
        ...(isGoingBackStuck ? [`going back: ${scrolling.goingBack}`] : []),
        ...(hostLine !== '' ? [hostLine] : []),
        ...failures,
      ].join(' · '),
    }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const url = field(e, 'url')
    try {
      const result = await pin($, String(url ?? ''), 'watched')
      quietly($, openPane($))
      return answer(result)
    } catch (error) {
      return { deny: error instanceof Error ? error.message : String(error) }
    }
  })

  // An MR opened from this session is pinned as raised here, as the app picks up a GitHub PR; only those wake it.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const command = String(field(e, 'command') ?? '')
    if (!/\bmr create\b|merge_request\.create/.test(command) || !isFilled(ran.text)) {
      return ran
    }
    const urls = new Set(ran.text.match(mrUrls(await readHosts($))) ?? [])
    for (const url of urls) {
      await pin($, url, 'raised').catch(reported($, 'gitlab'))
    }
    if (urls.size > 0) {
      quietly($, openPane($))
    }
    return ran
  }).catch(($, e, next) => next(e))

  // A drawing that throws says why in the pane, where the engine would only report it in the debug log.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    health.draws += 1
    try {
      const tree = await drawPane($, e)
      drawn(e.props.scroll.offset)
      health.last = `drew ${JSON.stringify(tree).length} characters on ${e.surface}`
      return tree
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      health.last = `threw on ${e.surface}: ${message}`
      const { Text } = $.ui.resolve(e)
      return <Text color="error">{`The GitLab pane failed to draw: ${message}`}</Text>
    }
  })
}
