// How every picture in docs/screens is taken: Chromium with the same flags, a page per app theme at a fixed locale and
// time zone, and two guards that a picture's letters come from the fonts in tools/screens/fonts, so a Mac and a CI runner
// draw the same letters. tools/pane_screens.ts photographs the pane's scenes with it, and tools/chatgpt_screens.ts the
// ChatGPT plugin's panel.
import { chromium, type BrowserContext, type Frame, type Page } from 'playwright'

export class ScreensError extends Error {}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The desktop app's two themes; every picture is taken in each, as the app draws in either. */
export const THEMES = ['light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

/** A picture's name in a theme: `mine.png` in light, `mine-dark.png` in dark. */
export const pictureName = (scene: string, theme: Theme): string => (theme === 'light' ? scene : `${scene}-${theme}`)

/** Runs `take` with a browser context per theme, at `scale` pixels per CSS pixel, and closes the browser after. */
export async function withThemes<Taken>(scale: number, take: (contexts: ReadonlyMap<Theme, BrowserContext>) => Promise<Taken>): Promise<Taken> {
  const browser = await chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb'] }).catch((error: unknown) => {
    throw new ScreensError(`Chromium would not start (${messageOf(error)}); install it with: npm run screens -- setup`)
  })
  try {
    const contexts = new Map<Theme, BrowserContext>()
    for (const theme of THEMES) {
      contexts.set(
        theme,
        await browser.newContext({
          viewport: { width: 700, height: 900 },
          deviceScaleFactor: scale,
          colorScheme: theme,
          locale: 'en-GB',
          timezoneId: 'UTC',
          reducedMotion: 'reduce',
        })
      )
    }
    return await take(contexts)
  } finally {
    await browser.close()
  }
}

/** Where a picture's letters are: the elements under `root`, in the page or in the document of the iframe `frame` names. */
export type Drawn = { readonly root: string; readonly frame: string | null }

type DomNode = { nodeId: number; nodeName: string; children?: DomNode[]; contentDocument?: DomNode }

/** The document of the first iframe in a tree DOM.getDocument returned with `pierce`. */
function frameDocument(node: DomNode): DomNode | null {
  if (node.contentDocument !== undefined) {
    return node.contentDocument
  }
  for (const child of node.children ?? []) {
    const found = frameDocument(child)
    if (found !== null) {
      return found
    }
  }
  return null
}

/**
 * Fonts Chromium took from the machine for any text under `drawn`, and how many elements it looked at: every glyph should
 * come from tools/screens/fonts, and a guard that looked at nothing has checked nothing.
 */
async function fontsBorrowed(context: BrowserContext, page: Page, drawn: Drawn): Promise<{ borrowed: Set<string>; looked: number }> {
  const session = await context.newCDPSession(page)
  await session.send('DOM.enable')
  await session.send('CSS.enable')
  const document = await session.send('DOM.getDocument', { depth: drawn.frame === null ? 0 : -1, pierce: drawn.frame !== null })
  const within = drawn.frame === null ? document.root : frameDocument(document.root)
  if (within === null) {
    await session.detach()
    return { borrowed: new Set(), looked: 0 }
  }
  const selector = drawn.root
    .split(',')
    .map(one => `${one.trim()} *`)
    .join(', ')
  const found = await session.send('DOM.querySelectorAll', { nodeId: within.nodeId, selector })
  const borrowed = new Set<string>()
  for (const nodeId of found.nodeIds) {
    const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId })
    fonts.filter(font => font.isCustomFont !== true && font.glyphCount > 0).forEach(font => borrowed.add(font.familyName))
  }
  await session.detach()
  return { borrowed, looked: found.nodeIds.length }
}

/**
 * Run in the page: each character `root` draws, and each letter in it, painted alone in its element's own font and
 * compared with what that font paints for U+10FFFD, which no font has. Where no font has a glyph, Chromium paints the first font's empty box and
 * credits that font, so `fontsBorrowed` cannot see it; a character that paints the same as U+10FFFD has no glyph.
 */
const noGlyphScript = (root: string) => `(() => {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const paint = canvas.getContext('2d', { willReadFrequently: true })
  const painted = (font, text) => {
    paint.clearRect(0, 0, 64, 64)
    paint.font = font
    paint.fillText(text, 8, 44)
    return paint.getImageData(0, 0, 64, 64).data.join()
  }
  const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' })
  const seen = new Map()
  const none = new Set()
  const walk = document.createTreeWalker(document.querySelector('${root}'), NodeFilter.SHOW_TEXT)
  for (let node = walk.nextNode(); node !== null; node = walk.nextNode()) {
    const style = getComputedStyle(node.parentElement)
    const font = style.fontStyle + ' ' + style.fontWeight + ' 32px ' + style.fontFamily
    if (!seen.has(font)) {
      seen.set(font, painted(font, '\\u{10FFFD}'))
    }
    for (const { segment } of graphemes.segment(node.data)) {
      // A cluster with no glyph paints a box for each of its letters, so its letters are painted alone too; marks,
      // joiners and selectors are left out, as alone they paint nothing or a dotted circle.
      const letters = [...segment].filter(one => !/^[\\s\\p{Cc}\\p{Cf}\\p{M}]$/u.test(one))
      if (letters.length > 0 && [segment, ...letters].some(text => painted(font, text) === seen.get(font))) {
        none.add(segment)
      }
    }
  }
  return [...none]
})()`

/** Characters `root` draws with no glyph from any font: an empty box, here and on every other machine without one. */
async function glyphsMissing(where: Page | Frame, root: string): Promise<string[]> {
  const found: unknown = await where.evaluate(noGlyphScript(root))
  return Array.isArray(found) ? found.filter((one): one is string => typeof one === 'string') : []
}

/** Throws unless every letter of picture `name` is drawn with a bundled font, and every one has a glyph in it. */
export async function checkLetters(name: string, context: BrowserContext, page: Page, drawn: Drawn): Promise<void> {
  const { borrowed, looked } = await fontsBorrowed(context, page, drawn)
  if (looked === 0) {
    throw new ScreensError(`scene ${name} has nothing under ${drawn.root}${drawn.frame !== null ? ` in ${drawn.frame}` : ''} to check the fonts of`)
  }
  if (borrowed.size > 0) {
    throw new ScreensError(
      `scene ${name} drew with fonts of this machine, not the bundled ones: ${[...borrowed].toSorted().join(', ')}. Add the missing glyph to tools/screens/fonts (see SOURCES.md), or the shot changes from machine to machine.`
    )
  }
  const frame = drawn.frame === null ? page : await (await page.locator(drawn.frame).elementHandle()).contentFrame()
  if (frame === null) {
    throw new ScreensError(`scene ${name} has no ${drawn.frame ?? 'page'} to check the glyphs of`)
  }
  const missing = await glyphsMissing(frame, drawn.root)
  if (missing.length > 0) {
    throw new ScreensError(
      `scene ${name} draws ${missing.map(one => JSON.stringify(one)).join(', ')} as an empty box: no bundled font has a glyph for it. Add it to a subset in tools/screens/fonts (see SOURCES.md).`
    )
  }
}
