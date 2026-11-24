// gitlab-pane's read of "my open MRs" as an MCP server for ChatGPT: one tool, opened beside a conversation through a
// thread entrypoint, and the panel that draws it. Runs over stdio, so it runs on the user's machine, inside the network
// that reaches their GitLab, with the token they already have.
//
//   node chatgpt/dist/server.mjs   the packaged server `node --import ./tools/resolve_ts.ts chatgpt/build.ts` writes, beside the panel it bundled,
//                                  which mcp.json launches
//   GITLAB_PANE_HOST=host          read that host instead of gitlab.com
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { OpenAIUiToolMetadata } from '@openai/mcp-extensions'
import { z } from 'zod'

import { foreign } from '../hooks/model-text.ts'
import type { RowModel } from '../hooks/pane-model.ts'
import type { MrCard, Pressed } from '../types/index.d.ts'
import { Failure } from '../hooks/failure.ts'
import { liveHeld, pressMove } from './move.ts'
import type { Outcome } from './move.ts'
import { panelUri } from './panel-uri.ts'
import { connect, openMrs, panelOf } from './read.ts'
import type { GitLab, Panel } from './read.ts'
import { rowsOf } from './result.ts'

const HOST = process.env.GITLAB_PANE_HOST ?? 'gitlab.com'
/** Beside the packaged server, the panel `build.ts` bundled. */
const BUILT_PANEL = new URL('./panel.bundled.html', import.meta.url)

/**
 * What the model reads of a row: where it is and what stands in its way, in the pane's own words. Titles, faces and
 * quoted comments go to the panel alone (`_meta`). Verdict and blocker words can carry GitLab's text (job names), so they
 * pass through `foreign` like any text from GitLab.
 */
const forModel = (row: RowModel) => ({
  key: row.key,
  url: row.mr.href,
  verdict: row.verdict !== null ? foreign(row.verdict.words) : null,
  blocker: row.blocker !== null ? foreign(row.blocker.text) : null,
  move: row.verdict?.move?.label ?? null,
})

const failed = (error: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] })

/**
 * The server around a panel: `html` is the panel it serves (named by its hash, `panelUri`), `connectTo` reaches a GitLab
 * (the user's, or a made-up one), and `now` is the clock rows are aged by and presses are timed by.
 */
export type ServerParts = { html: string; connectTo?: (host: string) => GitLab; now?: () => number }

export function createServer({ html, connectTo = connect, now = Date.now }: ServerParts): McpServer {
  const uri = panelUri(html)
  const server = new McpServer(
    { name: 'gitlab-pane', version: '0.0.0' },
    { instructions: "list_my_mrs reads the user's open GitLab merge requests. Rows carry no titles or comments; open the URL for those." }
  )
  // What the server holds between calls, as the mod's atoms hold it: the last read, and each MR's press.
  let gitlab: GitLab | null = null
  let cards: MrCard[] = []
  const held = new Map<string, Pressed>()
  // A refused token is forgotten, so the next call asks for it again (a glab token that rotated, one signed in since), as
  // the mod forgets it.
  const guarded = async <Done>(work: (to: GitLab) => Promise<Done>): Promise<Done> => {
    gitlab ??= connectTo(HOST)
    try {
      return await work(gitlab)
    } catch (error) {
      if (error instanceof Failure && (error.kind === 'unauthorized' || error.kind === 'no-token')) {
        gitlab = null
      }
      throw error
    }
  }
  const read = () =>
    guarded(async to => {
      cards = await openMrs(to)
      return panelOf(cards, liveHeld(held, now()), now())
    })
  const listed = (panel: Panel) => ({
    structuredContent: { host: HOST, mrs: rowsOf(panel).map(forModel) },
    content: [{ type: 'text' as const, text: `${rowsOf(panel).length} open merge requests on ${HOST}.` }],
    _meta: { gitlabPane: panel },
  })
  registerAppResource(server, 'GitLab MRs panel', uri, {}, async () => ({ contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: html }] }))
  registerAppTool(
    server,
    'list_my_mrs',
    {
      title: 'My merge requests',
      description: 'Use this when the user asks about their own open GitLab merge requests: what is failing, blocked or ready to merge.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
      _meta: {
        ui: { resourceUri: uri },
        'openai/ui': { entrypoints: [{ type: 'thread' }] } satisfies OpenAIUiToolMetadata,
      },
    },
    async () => {
      try {
        return listed(await read())
      } catch (error) {
        return failed(error)
      }
    }
  )
  // The panel's press on a row's move. Only the panel can call it (`visibility: ["app"]`): a person presses, the model
  // never merges. A merge takes two presses within ARMED_MS, as in the pane.
  registerAppTool(
    server,
    'press_move',
    {
      title: 'Press a merge request move',
      description: 'The panel calls this when the person presses a row move: merge, rebase, or rebase and merge.',
      inputSchema: { key: z.string(), kind: z.enum(['merge', 'rebase', 'rebase-merge']), does: z.enum(['arm', 'make']) },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: uri, visibility: ['app'] } },
    },
    async ({ key, kind, does }) => {
      const card = cards.find(each => each.key === key)
      if (card === undefined) {
        return failed(new Error('that MR is no longer in the list: read again'))
      }
      let outcome: Outcome
      try {
        outcome = await guarded(to => pressMove(to, card, { kind, does }, held, now()))
      } catch (error) {
        return failed(error)
      }
      // How the press ended is said whatever the read after it does: a merge that landed is not hidden by a read that failed.
      const panel = await read().catch(() => null)
      if (panel === null) {
        return { structuredContent: { host: HOST, outcome, mrs: [] }, content: [{ type: 'text' as const, text: 'GitLab did not answer the read after the press.' }] }
      }
      return { ...listed(panel), structuredContent: { host: HOST, outcome, mrs: rowsOf(panel).map(forModel) } }
    }
  )
  return server
}

// Run as the program, not imported: `import.meta.main` is newer than the Node 22 the package names, so the path is compared.
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  if (!existsSync(BUILT_PANEL)) {
    throw new Error('no panel beside the server: run `node --import ./tools/resolve_ts.ts chatgpt/build.ts` and start chatgpt/dist/server.mjs')
  }
  await createServer({ html: readFileSync(BUILT_PANEL, 'utf8') }).connect(new StdioServerTransport())
}
