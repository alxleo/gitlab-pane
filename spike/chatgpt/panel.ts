// The conversation panel: an MCP App that ChatGPT opens beside a thread. It runs no core code; the server sends rows the
// core already ranked and worded. esbuild bundles this file into the HTML resource at start-up (`server.ts`).
import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps'
import { OpenAIExtensions } from '@openai/mcp-extensions/app'

import type { Row } from './read.ts'

/** How often the panel reads again while it is open: the stand-in for the mod's poll, which runs only while mounted here. */
const REFRESH_MS = 60_000

const app = new App({ name: 'gitlab-pane-panel', version: '0.0.0' })
// ext-apps' own sendMessage drops `_meta`, so the draft-only flag (`send: false`) goes through OpenAI's extension, which
// a host without `openai/message` leaves undefined.
const openai = new OpenAIExtensions(app)
const list = document.querySelector<HTMLElement>('#rows')
const count = document.querySelector<HTMLElement>('#count')
const status = document.querySelector<HTMLElement>('#status')
const refresh = document.querySelector<HTMLButtonElement>('#refresh')

const rowsOf = (meta: unknown): Row[] | null => {
  if (typeof meta !== 'object' || meta === null || !('gitlabPane' in meta)) {
    return null
  }
  const pane = meta.gitlabPane
  return typeof pane === 'object' && pane !== null && 'rows' in pane && Array.isArray(pane.rows) ? pane.rows : null
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  node.className = className
  node.textContent = text
  return node
}

/** `group/project!iid` with the host dropped and the project cut to its last two parts, as a narrow panel has room for. */
const shortKey = (key: string): string => {
  const [project = '', iid = ''] = key.split('!')
  const parts = project.split('/').slice(1)
  return `${parts.slice(-2).join('/')}!${iid}`
}

function draw(rows: readonly Row[]): void {
  if (list === null || count === null) {
    return
  }
  count.textContent = String(rows.length)
  list.replaceChildren(
    ...rows.map(row => {
      const card = el('li', `card${row.draft ? ' draft' : ''}`)
      const head = el('div', 'head')
      const mark = el('button', `mark tone-${row.pipeline.tone}`, row.pipeline.glyph)
      mark.title = 'Open the pipeline'
      mark.disabled = row.pipeline.url === null
      mark.addEventListener('click', () => row.pipeline.url !== null && void app.openLink({ url: row.pipeline.url }))
      const title = el('button', 'title', row.title)
      title.addEventListener('click', () => void app.openLink({ url: row.url }))
      head.append(mark, title)
      const line = el('div', 'line')
      line.append(el('span', 'key', shortKey(row.key)))
      for (const badge of row.badges) {
        line.append(el('span', `badge tone-${badge.tone}`, `${badge.glyph} ${badge.words}`))
      }
      if (row.verdict !== null) {
        line.append(el('span', `badge tone-${row.verdict.tone}`, row.verdict.words))
      }
      card.append(head, line)
      if (row.badges.some(badge => badge.glyph === '⇄') && openai.message !== undefined) {
        const message = openai.message
        const hand = el('button', 'move', '⇄ hand conflicts to ChatGPT')
        // Only who, what and where: the MR's address, never its title or anyone's words. A draft, not sent: the person sends it.
        hand.addEventListener(
          'click',
          () =>
            void message.send({
              role: 'user',
              content: [{ type: 'text', text: `Resolve the merge conflicts on ${row.url} (${row.key}).` }],
              _meta: { 'openai/message': { send: false } },
            })
        )
        card.append(hand)
      }
      return card
    })
  )
}

async function read(): Promise<void> {
  if (status !== null) {
    status.textContent = 'reading…'
  }
  try {
    const result = await app.callServerTool({ name: 'list_my_mrs', arguments: {} })
    const rows = rowsOf(result._meta)
    if (rows !== null) {
      draw(rows)
    }
    if (status !== null) {
      status.textContent = result.isError === true ? 'GitLab did not answer' : `read ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    }
  } catch (error) {
    if (status !== null) {
      status.textContent = error instanceof Error ? error.message : 'GitLab did not answer'
    }
  }
}

app.ontoolresult = result => {
  const rows = rowsOf(result._meta)
  if (rows !== null) {
    draw(rows)
  }
  if (status !== null) {
    status.textContent = `read ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  }
}
app.addEventListener('hostcontextchanged', context => {
  if (context.theme !== undefined) {
    applyDocumentTheme(context.theme)
  }
  if (context.styles?.variables !== undefined) {
    applyHostStyleVariables(context.styles.variables)
  }
})
refresh?.addEventListener('click', () => void read())

await app.connect()
const context = app.getHostContext()
if (context?.theme !== undefined) {
  applyDocumentTheme(context.theme)
}
if (context?.styles?.variables !== undefined) {
  applyHostStyleVariables(context.styles.variables)
}
setInterval(() => void read(), REFRESH_MS)
