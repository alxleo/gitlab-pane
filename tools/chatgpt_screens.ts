// The ChatGPT plugin's panel as docs/screens shows it: `chatgpt-panel.png` and `chatgpt-panel-dark.png`, taken by
// tools/pane_screens.ts beside the pane's scenes, so `npm run screens -- render`, `--verify` and `--check` cover both.
//
// The panel is drawn as ChatGPT draws it: the server in this process answers from the made-up GitLab, the panel is read
// by the URI the tool names and opened behind ext-apps' AppBridge (chatgpt/host.ts). The clock is held at the fixtures'
// NOW in the server and the page, and the host hands the panel the bundled fonts (tools/screens/fonts, as pane.css names
// them) the way ChatGPT hands it its own: as `hostContext.styles`.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import { fakeGitLab } from '../chatgpt/fake.ts'
import { serveHost } from '../chatgpt/host.ts'
import type { HostStyles } from '../chatgpt/host.ts'
import { panelHtml } from '../chatgpt/panel-build.ts'
import { createServer } from '../chatgpt/server.ts'
import { NOW } from '../tests/fixtures.ts'
import { checkLetters, pictureName, ScreensError, THEMES, withThemes } from './photograph.ts'

/** The panel's name among the scenes: `--scene chatgpt-panel` takes it alone. */
export const CHATGPT_PANEL = 'chatgpt-panel'

const SCREENS = join(import.meta.dirname, 'screens')

/** pane.css's font faces, each font inlined: the panel's page is served over HTTP and cannot read the files. */
function bundledFonts(): HostStyles {
  const faces = readFileSync(join(SCREENS, 'pane.css'), 'utf8')
    .split('\n')
    .filter(line => line.startsWith('@font-face'))
    .map(line =>
      line.replace(/url\("fonts\/(?<file>[^"]+)"\)/u, (_whole, file: string) => `url("data:font/woff2;base64,${readFileSync(join(SCREENS, 'fonts', file)).toString('base64')}")`)
    )
  const stack = /--font:\s*(?<stack>[^;]+);/u.exec(readFileSync(join(SCREENS, 'pane.css'), 'utf8'))?.groups?.stack
  if (faces.length === 0 || stack === undefined) {
    throw new ScreensError('tools/screens/pane.css names no font faces or no --font for the panel to take')
  }
  return { variables: { '--font-sans': stack }, css: { fonts: faces.join('\n') } }
}

/** Photographs the panel in each theme into `out`; returns the pictures' names. */
export async function photographPanel(out: string, scale: number): Promise<string[]> {
  const client = new Client({ name: 'screens', version: '0' })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await createServer({ html: await panelHtml(), connectTo: () => fakeGitLab(), now: () => NOW }).connect(serverSide)
  await client.connect(clientSide)
  const host = await serveHost(client, { styles: bundledFonts(), isBare: true })
  try {
    return await withThemes(scale, async contexts => {
      const names: string[] = []
      for (const theme of THEMES) {
        const context = contexts.get(theme)
        if (context === undefined) {
          throw new ScreensError(`no browser for the ${theme} theme`)
        }
        const name = pictureName(CHATGPT_PANEL, theme)
        const page = await context.newPage()
        await page.clock.setFixedTime(NOW)
        await page.goto(host.url)
        const panel = page.frameLocator('iframe')
        await panel
          .locator('#status')
          .filter({ hasText: /^read \d/u })
          .waitFor({ timeout: 30_000 })
          .catch(async () => {
            throw new ScreensError(`the panel did not draw its rows: ${(await panel.locator('#status').textContent()) ?? 'no status'}`)
          })
        // The iframe as tall as what the panel drew, so the picture holds every row.
        await page.evaluate(`(async () => {
          const frame = document.querySelector('iframe')
          await frame.contentDocument.fonts.ready
          frame.style.height = '1px'
          frame.style.height = frame.contentDocument.documentElement.scrollHeight + 'px'
        })()`)
        await checkLetters(name, context, page, { root: 'body', frame: 'iframe' })
        await page.locator('iframe').screenshot({ path: join(out, `${name}.png`), animations: 'disabled', omitBackground: false })
        await page.close()
        names.push(name)
      }
      return names
    })
  } finally {
    await host.close()
    await client.close()
  }
}
