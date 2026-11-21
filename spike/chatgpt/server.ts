// gitlab-pane's read of "my open MRs" as an MCP server for ChatGPT: one tool, opened beside a conversation through a
// thread entrypoint, and the panel that draws it. Runs over stdio, so it runs on the user's machine, inside the network
// that reaches their GitLab, with the token they already have.
//
//   node server.ts            serve over stdio, building the panel on start
//   node dist/server.mjs      the packaged server `node build.ts` writes, which mcp.json launches
//   GITLAB_PANE_HOST=host     read that host instead of gitlab.com
import { existsSync, readFileSync } from 'node:fs'

import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { OpenAIUiToolMetadata } from '@openai/mcp-extensions'

import { z } from 'zod'

import { foreign } from '../../hooks/model-text.ts'
import type { RowModel } from '../../hooks/pane-model.ts'
import type { MrCard, Pressed } from '../../types/index.d.ts'
import { liveHeld, pressMove } from './move.ts'
import { panelUri } from './panel-uri.ts'
import { connect, openMrs, panelOf } from './read.ts'
import type { GitLab, Panel } from './read.ts'

const HOST = process.env.GITLAB_PANE_HOST ?? 'gitlab.com'
/** Beside the packaged server, the panel `build.ts` already bundled; from the sources, it is built on start. */
const BUILT_PANEL = new URL('./panel.bundled.html', import.meta.url)
/** Kept out of a literal so esbuild leaves the build tool out of the packaged server. */
const PANEL_BUILDER = './panel-build.ts'

const loadPanel = async (): Promise<string> => (existsSync(BUILT_PANEL) ? readFileSync(BUILT_PANEL, 'utf8') : (await import(PANEL_BUILDER)).panelHtml())

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
const rowsIn = (panel: Panel) => panel.sections.flatMap(section => section.rows)

const failed = (error: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] })

export async function createServer(connectTo: (host: string) => GitLab = connect): Promise<McpServer> {
  const html = await loadPanel()
  const PANEL_URI = panelUri(html)
  const server = new McpServer(
    { name: 'gitlab-pane', version: '0.0.0' },
    { instructions: "list_my_mrs reads the user's open GitLab merge requests. Rows carry no titles or comments; open the URL for those." }
  )
  // What the server holds between calls, as the mod's atoms hold it: the last read, and each MR's press.
  let gitlab: GitLab | null = null
  let cards: MrCard[] = []
  const held = new Map<string, Pressed>()
  const read = async () => {
    gitlab ??= connectTo(HOST)
    cards = await openMrs(gitlab)
    return panelOf(cards, liveHeld(held))
  }
  const listed = (panel: Panel) => ({
    structuredContent: { host: HOST, mrs: rowsIn(panel).map(forModel) },
    content: [{ type: 'text' as const, text: `${rowsIn(panel).length} open merge requests on ${HOST}.` }],
    _meta: { gitlabPane: panel },
  })
  registerAppResource(server, 'GitLab MRs panel', PANEL_URI, {}, async () => ({
    contents: [{ uri: PANEL_URI, mimeType: RESOURCE_MIME_TYPE, text: html }],
  }))
  registerAppTool(
    server,
    'list_my_mrs',
    {
      title: 'My merge requests',
      description: 'Use this when the user asks about their own open GitLab merge requests: what is failing, blocked or ready to merge.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
      _meta: {
        ui: { resourceUri: PANEL_URI },
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
      _meta: { ui: { resourceUri: PANEL_URI, visibility: ['app'] } },
    },
    async ({ key, kind, does }) => {
      try {
        gitlab ??= connectTo(HOST)
        const card = cards.find(each => each.key === key)
        if (card === undefined) {
          return failed(new Error('that MR is no longer in the list: read again'))
        }
        const outcome = await pressMove(gitlab, card, { kind, does }, held)
        const panel = await read()
        return { ...listed(panel), structuredContent: { host: HOST, outcome, mrs: rowsIn(panel).map(forModel) } }
      } catch (error) {
        return failed(error)
      }
    }
  )
  return server
}

if (import.meta.main) {
  await (await createServer()).connect(new StdioServerTransport())
}
