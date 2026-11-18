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

import { foreign } from '../../hooks/model-text.ts'
import { openMrs } from './read.ts'
import type { Row } from './read.ts'

const PANEL_URI = 'ui://gitlab-pane/panel.html'
const HOST = process.env.GITLAB_PANE_HOST ?? 'gitlab.com'
/** Beside the packaged server, the panel `build.ts` already bundled; from the sources, it is built on start. */
const BUILT_PANEL = new URL('./panel.bundled.html', import.meta.url)
/** Kept out of a literal so esbuild leaves the build tool out of the packaged server. */
const PANEL_BUILDER = './panel-build.ts'

const loadPanel = async (): Promise<string> => (existsSync(BUILT_PANEL) ? readFileSync(BUILT_PANEL, 'utf8') : (await import(PANEL_BUILDER)).panelHtml())

/** What the model reads of a row: who, what and where, in the pane's own words. Titles go to the panel alone (`_meta`). */
const forModel = (row: Row) => ({
  key: row.key,
  url: row.url,
  draft: row.draft,
  pipeline: row.pipeline.glyph,
  verdict: row.verdict?.words ?? null,
  // Badge words can carry GitLab's text (job names), so they pass through `foreign` like any text from GitLab.
  blockers: row.badges.map(badge => foreign(badge.words)),
})

export function createServer(read: (host: string) => Promise<{ rows: Row[] }> = openMrs): McpServer {
  const server = new McpServer(
    { name: 'gitlab-pane', version: '0.0.0' },
    { instructions: "list_my_mrs reads the user's open GitLab merge requests. Rows carry no titles or comments; open the URL for those." }
  )
  const html = loadPanel()
  registerAppResource(server, 'GitLab MRs panel', PANEL_URI, {}, async () => ({
    contents: [{ uri: PANEL_URI, mimeType: RESOURCE_MIME_TYPE, text: await html }],
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
        const { rows } = await read(HOST)
        const model = rows.map(forModel)
        return {
          structuredContent: { host: HOST, mrs: model },
          content: [{ type: 'text', text: `${rows.length} open merge requests on ${HOST}.` }],
          _meta: { gitlabPane: { rows } },
        }
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] }
      }
    }
  )
  return server
}

if (import.meta.main) {
  await createServer().connect(new StdioServerTransport())
}
