// The conversation panel: an MCP App that ChatGPT opens beside a thread. It decides nothing: it draws the pane's own row
// model (`buildPane`, as `card.tsx` lays it out), and sends each press to the server. esbuild bundles it into one HTML.
import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps'
import { OpenAIExtensions } from '@openai/mcp-extensions/app'

import { ARMED_MS } from '../hooks/write-model.ts'
import type { RowModel } from '../hooks/pane-model.ts'
import type { Panel } from './read.ts'
import { panelIn } from './result.ts'

/** How often the panel reads again while it is open: the stand-in for the mod's poll, which runs only while mounted here. */
const REFRESH_MS = 60_000

const app = new App({ name: 'gitlab-pane-panel', version: '0.0.0' })
// The draft-only flag (`send: false`) goes through OpenAI's extension: it checks the flag's shape, and a host without
// `openai/message` leaves it undefined, so the hand-off shows only where the flag is understood. (The harness's AppBridge
// drops `_meta` when it parses `ui/message`; the panel puts it on the wire, which is what ChatGPT reads.)
const openai = new OpenAIExtensions(app)
const list = document.querySelector<HTMLElement>('#rows')
const count = document.querySelector<HTMLElement>('#count')
const status = document.querySelector<HTMLElement>('#status')
const refresh = document.querySelector<HTMLButtonElement>('#refresh')

/** The panel last drawn, the MRs with a press out, and how each MR's last press ended, by card key. */
let drawn: Panel = { sections: [], handOff: {} }
const pressing = new Set<string>()
const said = new Map<string, string>()

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  node.className = className
  node.textContent = text
  return node
}

const link = (to: { href: string; text: string }): HTMLButtonElement => {
  const node = el('button', 'link', to.text)
  node.addEventListener('click', () => void app.openLink({ url: to.href }))
  return node
}

/** SVG the core drew (a stage strip, a face), from its own `svg()`, which escapes whatever text it holds. */
const picture = (source: string, alt: string): HTMLSpanElement => {
  const node = el('span', 'picture')
  node.innerHTML = source
  node.setAttribute('role', 'img')
  node.setAttribute('aria-label', alt)
  return node
}

/** The verdict and the MR's one move, as `card.tsx` draws them: the move stands in place of the verdict it answers. */
function verdictParts(row: RowModel): HTMLElement[] {
  const { verdict } = row
  if (verdict === null) {
    return []
  }
  const words = el('span', `tone-${verdict.tone}${verdict.bold ? ' bold' : ''}`, verdict.words)
  const { move } = verdict
  if (move === null) {
    return [words]
  }
  const parts: HTMLElement[] = move.isVerdict ? [] : [words]
  const { press } = move
  if (press !== null) {
    const button = el('button', `move${move.isArmed ? ' armed' : ''}`, move.label)
    button.disabled = pressing.has(row.key)
    button.addEventListener('click', () => void pressOn(row.key, press))
    parts.push(button)
  } else {
    parts.push(el('span', 'soft', move.label))
  }
  const ended = said.get(row.key) ?? move.failed
  if (ended !== null) {
    parts.push(el('span', 'tone-warning', ended))
  }
  return parts
}

function rowOf(row: RowModel): HTMLLIElement {
  const card = el('li', 'card')
  // The left edge repeats in colour what the row's verdict, else its blocker, says in words: the core's row model no
  // longer carries a colour for the card, since the mod's cards draw no border.
  card.classList.add(`edge-${row.verdict?.tone ?? row.blocker?.tone ?? 'subtle'}`)
  const line1 = el('div', 'line1')
  const title = el('button', 'title', row.title)
  title.addEventListener('click', () => void app.openLink({ url: row.mr.href }))
  line1.append(title)
  line1.append(el('span', 'soft small', row.ago))
  card.append(line1)
  const line2 = el('div', 'line2')
  line2.append(link(row.mr))
  if (row.ticket !== null) {
    line2.append(row.ticket.href !== null ? link({ href: row.ticket.href, text: row.ticket.text }) : el('span', 'soft', row.ticket.text))
  }
  if (row.repo !== null) {
    line2.append(link(row.repo))
  }
  if (row.strip !== null) {
    line2.append(picture(row.strip.source, row.strip.alt))
  }
  line2.append(row.pipeline !== null ? link(row.pipeline) : el('span', 'soft', 'no pipeline'))
  if (row.verdict !== null) {
    const verdict = el('span', 'group')
    verdict.append(...verdictParts(row))
    if (row.verdict.trailing !== null) {
      verdict.append(el('span', 'soft', row.verdict.trailing))
    }
    line2.append(verdict)
  } else if (row.blocker !== null) {
    line2.append(el('span', `tone-${row.blocker.tone}`, row.blocker.text))
  }
  for (const person of row.people) {
    const who = el('span', 'group')
    who.append(picture(person.picture ?? person.plain, person.alt), el('span', '', person.label))
    line2.append(who)
  }
  card.append(line2)
  if (row.said !== null) {
    card.append(el('div', 'said', row.said.label))
  }
  const task = drawn.handOff[row.key]
  const message = openai.message
  if (task !== undefined && message !== undefined) {
    // The task the pane hands Claude (`conflictsTask`): where the MR is and what to do, no one's words. A draft, not
    // sent: the person sends it.
    const hand = el('button', 'move', '⇄ hand conflicts to ChatGPT')
    hand.addEventListener('click', () => void message.send({ role: 'user', content: [{ type: 'text', text: task }], _meta: { 'openai/message': { send: false } } }))
    card.append(hand)
  }
  return card
}

function draw(panel: Panel): void {
  if (list === null || count === null) {
    return
  }
  drawn = panel
  count.textContent = String(panel.sections.reduce((sum, section) => sum + section.rows.length, 0))
  list.replaceChildren(...panel.sections.flatMap(section => [...(section.label !== null ? [el('li', 'section', section.label)] : []), ...section.rows.map(rowOf)]))
}

const readAt = () => `read ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`

/**
 * A press on a row's move goes to `press_move`, which only this panel can call. A first press on a merge arms it and the
 * row asks for a second within ARMED_MS; the server then merges and follows GitLab until it is done.
 */
async function pressOn(key: string, press: { kind: string; does: 'arm' | 'make' }): Promise<void> {
  pressing.add(key)
  said.delete(key)
  draw(drawn)
  try {
    const result = await app.callServerTool({ name: 'press_move', arguments: { key, kind: press.kind, does: press.does } })
    const outcome = result.structuredContent?.outcome
    if (typeof outcome === 'object' && outcome !== null && 'say' in outcome && typeof outcome.say === 'string') {
      said.set(key, outcome.say)
    } else if (result.isError === true) {
      const first = result.content[0]
      said.set(key, first !== undefined && first.type === 'text' ? first.text : 'GitLab did not answer')
    }
    if (typeof outcome === 'object' && outcome !== null && 'state' in outcome && outcome.state === 'armed') {
      // The arm runs out on the server; reading again then offers the move afresh.
      setTimeout(() => void read(), ARMED_MS + 500)
    }
    pressing.delete(key)
    const panel = panelIn(result._meta) ?? drawn
    draw(panel)
    // A merged MR leaves the list, and its row with it, so how it ended goes in the header, as the pane's toast does.
    const ended = said.get(key)
    if (ended !== undefined && status !== null && !panel.sections.some(section => section.rows.some(row => row.key === key))) {
      status.textContent = `!${key.split('!')[1] ?? ''} ${ended}`
    }
  } catch (error) {
    pressing.delete(key)
    said.set(key, error instanceof Error ? error.message : 'GitLab did not answer')
    draw(drawn)
  }
}

async function read(): Promise<void> {
  if (status !== null) {
    status.textContent = 'reading…'
  }
  try {
    const result = await app.callServerTool({ name: 'list_my_mrs', arguments: {} })
    const panel = panelIn(result._meta)
    if (panel !== null) {
      draw(panel)
    }
    if (status !== null) {
      status.textContent = result.isError === true ? 'GitLab did not answer' : readAt()
    }
  } catch (error) {
    if (status !== null) {
      status.textContent = error instanceof Error ? error.message : 'GitLab did not answer'
    }
  }
}

const applyHost = (context: ReturnType<App['getHostContext']>) => {
  if (context?.theme !== undefined) {
    applyDocumentTheme(context.theme)
  }
  if (context?.styles?.variables !== undefined) {
    applyHostStyleVariables(context.styles.variables)
  }
  // The faces the host's font variables name: ChatGPT's own, or the bundled ones the pictures are taken with.
  if (context?.styles?.css?.fonts !== undefined) {
    applyHostFonts(context.styles.css.fonts)
  }
}

app.addEventListener('toolresult', result => {
  const panel = panelIn(result._meta)
  if (panel !== null) {
    draw(panel)
  }
  if (status !== null) {
    status.textContent = result.isError === true ? 'GitLab did not answer' : readAt()
  }
})
app.addEventListener('hostcontextchanged', applyHost)
refresh?.addEventListener('click', () => void read())

await app.connect()
applyHost(app.getHostContext())
setInterval(() => void read(), REFRESH_MS)
