// pane-screens: the README's screenshots of the GitLab pane, drawn by the mod's own code and photographed headless.
//
//   node tools/pane_screens.ts render                      write docs/screens/<scene>.png for every scene
//   node tools/pane_screens.ts render --scene inbox        one scene
//   node tools/pane_screens.ts render --out /tmp/shots     somewhere else, to compare two runs
//   node tools/pane_screens.ts render --verify             draw twice, fail unless both are byte-identical
//   node tools/pane_screens.ts render --check              draw, and fail unless docs/screens already holds exactly these PNGs; writes nothing
//   node tools/pane_screens.ts render --out /tmp/pr --delta-against origin/main
//                                                          a pull request's pictures: each scene, `<scene>-before.png` as main
//                                                          draws it, and `<scene>-delta.png`, the change at full strength and
//                                                          outlined, all else faded (tools/screen_delta.ts says what changed)
//   node tools/pane_screens.ts setup [--with-deps]         fetch the Chromium it photographs with (once per Playwright version)
//
// (`npm run screens -- <command>` is the same.) How it works, so nobody has to remember it:
//
//   1. tools/screens/scenes.ts runs under `claude plugin test`, in a scratch copy of the mod, with GitLab
//      answered by made-up data (acme-corp, alice, bob) and the clock held still. For each scene it prints the element
//      tree the pane draws on the desktop surface, exactly as the engine validated it.
//   2. tools/pane_html.ts turns that tree into a web page (tools/screens/pane.css) and Chromium photographs it, with the
//      fonts in tools/screens/fonts, so a Mac and a CI runner draw the same letters.
//
// `render` talks to no one: not GitLab, not Anthropic, nothing on the network, and it reads none of your Claude config.
//
// Same commit, same machine kind: the same bytes. A Mac and a Linux runner agree on what is drawn, not on every pixel.
import { spawnSync } from 'node:child_process'
import { closeSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium, type BrowserContext, type Page } from 'playwright'

import { parseJson } from '../hooks/decode.ts'
import { decodeScene, pageHtml, strings, type Scene } from './pane_html.ts'
import { deltaMarks } from './screen_delta.ts'

const ROOT = join(import.meta.dirname, '..')
const SCREENS = join(import.meta.dirname, 'screens')
const SHOTS = join(ROOT, 'docs', 'screens')
// The Claude Code that CI pins (CLAUDE_CODE_VERSION in check.yml and screens.yml): another version may draw the pane differently.
const EXPECTED_CLAUDE = '2.1.318'
const MARKER = 'PANE-SCENE '
const LISTED = 'PANE-SCENES '

class ScreensError extends Error {}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// ---- the scenes, from the engine ----------------------------------------------------------------------------------------

/**
 * A scratch copy of the mod at `root` (this checkout, or another version written out by `writeVersion`) with its scenes
 * as its only test, so `claude plugin test` never sees the real ones.
 */
function stageMod(into: string, root: string): string {
  const mod = join(into, 'mod')
  mkdirSync(join(mod, '.claude-plugin'), { recursive: true })
  copyFileSync(join(root, '.claude-plugin', 'plugin.json'), join(mod, '.claude-plugin', 'plugin.json'))
  cpSync(join(root, 'hooks'), join(mod, 'hooks'), { recursive: true })
  cpSync(join(root, 'types'), join(mod, 'types'), { recursive: true })
  mkdirSync(join(mod, 'tests'))
  // The helpers the scenes import (fixtures, the fake GitLab); none of the mod's own tests.
  for (const helper of readdirSync(join(root, 'tests'), { withFileTypes: true })
    .filter(entry => entry.isFile() && !entry.name.endsWith('.test.ts'))
    .map(entry => entry.name)) {
    copyFileSync(join(root, 'tests', helper), join(mod, 'tests', helper))
  }
  mkdirSync(join(mod, 'tools', 'screens'), { recursive: true })
  copyFileSync(join(root, 'tools', 'screens', 'scenes.ts'), join(mod, 'tools', 'screens', 'scenes.test.ts'))
  return mod
}

/** The files `stageMod` takes, as git names them. */
const VERSION_PATHS = ['.claude-plugin/plugin.json', 'hooks', 'types', 'tests', 'tools/screens/scenes.ts']

/** Writes the files `stageMod` takes from the git ref `ref` (a commit, branch or tag of this repository) into `into`. */
function writeVersion(ref: string, into: string): void {
  const git = (args: string[]) => spawnSync('git', ['-C', ROOT, ...args], { maxBuffer: 256 * 1024 * 1024 })
  const listed = git(['ls-tree', '-r', '-z', '--name-only', ref, '--', ...VERSION_PATHS])
  if (listed.status !== 0) {
    throw new ScreensError(`cannot read ${ref} from git: ${listed.stderr.toString().trim()}`)
  }
  for (const path of listed.stdout
    .toString()
    .split('\0')
    .filter(each => each !== '')) {
    const shown = git(['show', `${ref}:${path}`])
    if (shown.status !== 0) {
      throw new ScreensError(`cannot read ${path} at ${ref}: ${shown.stderr.toString().trim()}`)
    }
    mkdirSync(join(into, dirname(path)), { recursive: true })
    writeFileSync(join(into, path), shown.stdout)
  }
}

/** Only what `claude plugin test` needs: no token, base URL or session of the caller's reaches it. */
const cleanEnv = (home: string): Record<string, string> => ({
  PATH: process.env['PATH'] ?? '/usr/bin:/bin',
  HOME: home,
  CLAUDE_CONFIG_DIR: join(home, 'config'),
  NO_COLOR: '1',
  TZ: 'UTC',
  LANG: 'C.UTF-8',
})

/** What `claude plugin test` said, less the trees: they are nearly all of its output and never say why a test failed. */
function saidWithoutTrees(output: string): string {
  const lines = output.split('\n').filter(line => !line.startsWith(MARKER) && !line.startsWith(LISTED))
  const failed = lines.filter(line => line.startsWith('(fail)')).map(line => line.slice('(fail) '.length))
  return `${failed.length > 0 ? `failed: ${failed.join('; ')}\n` : ''}${lines.join('\n').slice(-4000)}`
}

/** Runs the scenes under the engine and reads the trees back, or says exactly which scene failed and why. */
function drawScenes(claude: string, work: string, root = ROOT): Scene[] {
  const mod = stageMod(work, root)
  const home = join(work, 'home')
  mkdirSync(join(home, 'config'), { recursive: true })
  // One stream, so lines come back in the order they were written.
  const log = join(work, 'test.log')
  const fd = openSync(log, 'w')
  const ran = spawnSync(claude, ['plugin', 'test', mod], { stdio: ['ignore', fd, fd], env: cleanEnv(home) })
  closeSync(fd)
  const output = readFileSync(log, 'utf8')
  if (ran.status !== 0) {
    throw new ScreensError(`\`claude plugin test\` failed (${ran.status ?? ran.error?.message ?? 'no exit status'}):\n${saidWithoutTrees(output)}`)
  }
  const lines = output.split('\n')
  let listed: unknown[]
  let scenes: Scene[]
  try {
    listed = lines.filter(line => line.startsWith(LISTED)).map(line => parseJson(line.slice(LISTED.length)))
    scenes = lines.filter(line => line.startsWith(MARKER)).map(line => decodeScene(parseJson(line.slice(MARKER.length))))
  } catch (error) {
    throw new ScreensError(`a scene did not read as this script expects (the engine's drawing changed?):\n${messageOf(error)}`)
  }
  const names = listed.length === 1 ? strings(listed[0], 'the list of scenes') : []
  if (listed.length !== 1) {
    throw new ScreensError(`scenes.ts did not say which scenes to expect, once:\n${saidWithoutTrees(output)}`)
  }
  const drawn = new Set(scenes.map(scene => scene.name))
  const lost = names.filter(name => !drawn.has(name))
  const stray = [...drawn].filter(name => !names.includes(name)).toSorted()
  if (lost.length > 0 || stray.length > 0 || drawn.size !== scenes.length) {
    throw new ScreensError(
      `the scenes drawn are not the scenes listed (listed ${JSON.stringify(names)}; lost ${lost.length > 0 ? lost.join(', ') : 'none'}; unlisted ${stray.length > 0 ? stray.join(', ') : 'none'}); the engine said:\n${saidWithoutTrees(output)}`
    )
  }
  return scenes
}

function claudeVersion(claude: string): string {
  const ran = spawnSync(claude, ['--version'], { encoding: 'utf8' })
  const version = ran.stdout.split(/\s+/u)[0]
  if (ran.status !== 0 || version === undefined || version === '') {
    throw new ScreensError(`cannot run \`${claude} --version\`: ${ran.error?.message ?? ran.stderr}`)
  }
  return version
}

// ---- the photograph -----------------------------------------------------------------------------------------------------

/** What a picture holds: the pane, or the band with its prompt box; a page has one of the two. */
const FRAME = '#pane, #band'

/** Fonts Chromium took from the machine for any text on the page: every glyph should come from tools/screens/fonts. */
async function fontsBorrowed(context: BrowserContext, page: Page): Promise<Set<string>> {
  const session = await context.newCDPSession(page)
  await session.send('DOM.enable')
  await session.send('CSS.enable')
  const document = await session.send('DOM.getDocument', { depth: 0 })
  const found = await session.send('DOM.querySelectorAll', { nodeId: document.root.nodeId, selector: '#pane *, #band *' })
  const borrowed = new Set<string>()
  for (const nodeId of found.nodeIds) {
    const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId })
    fonts.filter(font => font.isCustomFont !== true && font.glyphCount > 0).forEach(font => borrowed.add(font.familyName))
  }
  await session.detach()
  return borrowed
}

/**
 * Run in the page: each character the frame draws, and each letter in it, painted alone in its element's own font and
 * compared with what that font paints for U+10FFFD, which no font has. Where no font has a glyph, Chromium paints the first font's empty box and
 * credits that font, so `fontsBorrowed` cannot see it; a character that paints the same as U+10FFFD has no glyph.
 */
const NO_GLYPH_SCRIPT = `(() => {
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
  const walk = document.createTreeWalker(document.querySelector('${FRAME}'), NodeFilter.SHOW_TEXT)
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

/** Characters the page draws with no glyph from any font: an empty box, here and on every other machine without one. */
async function glyphsMissing(page: Page): Promise<string[]> {
  const found: unknown = await page.evaluate(NO_GLYPH_SCRIPT)
  return Array.isArray(found) ? found.filter((one): one is string => typeof one === 'string') : []
}

async function photograph(pages: ReadonlyMap<string, string>, out: string, scale: number): Promise<void> {
  mkdirSync(out, { recursive: true })
  const browser = await chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb'] }).catch((error: unknown) => {
    throw new ScreensError(`Chromium would not start (${messageOf(error)}); install it with: npm run screens -- setup`)
  })
  try {
    const context = await browser.newContext({
      viewport: { width: 700, height: 900 },
      deviceScaleFactor: scale,
      colorScheme: 'light',
      locale: 'en-GB',
      timezoneId: 'UTC',
      reducedMotion: 'reduce',
    })
    for (const [name, path] of pages) {
      const page = await context.newPage()
      await page.goto(pathToFileURL(path).href)
      await page.evaluate('document.fonts.ready.then(() => true)')
      const borrowed = await fontsBorrowed(context, page)
      if (borrowed.size > 0) {
        throw new ScreensError(
          `scene ${name} drew with fonts of this machine, not the bundled ones: ${[...borrowed].toSorted().join(', ')}. Add the missing glyph to tools/screens/fonts (see SOURCES.md), or the shot changes from machine to machine.`
        )
      }
      const missing = await glyphsMissing(page)
      if (missing.length > 0) {
        throw new ScreensError(
          `scene ${name} draws ${missing.map(one => JSON.stringify(one)).join(', ')} as an empty box: no bundled font has a glyph for it. Add it to a subset in tools/screens/fonts (see SOURCES.md).`
        )
      }
      await page.locator(FRAME).screenshot({ path: join(out, `${name}.png`), animations: 'disabled', omitBackground: false })
      await page.close()
    }
  } finally {
    await browser.close()
  }
}

// ---- render -------------------------------------------------------------------------------------------------------------

type Options = {
  readonly scenes: readonly string[]
  readonly width: number | null
  readonly scale: number
  readonly claude: string
  readonly keep: string | null
  readonly allowUnknown: boolean
  /** A git ref to draw the scenes at too: each scene it also has gets `<scene>-before.png` and `<scene>-delta.png`. */
  readonly deltaAgainst: string | null
}

/**
 * The pages to photograph for `scenes`, by picture name: each scene, and with `base` (the same scenes drawn at another
 * version) the scene as it was there and the delta between them, for a scene `base` also draws.
 */
function picturesOf(scenes: readonly Scene[], base: readonly Scene[] | null, width: number | null): Map<string, ReturnType<typeof pageHtml>> {
  const pictures = new Map<string, ReturnType<typeof pageHtml>>()
  for (const each of scenes) {
    pictures.set(each.name, pageHtml(each, width))
    const before = base?.find(scene => scene.name === each.name)
    if (before !== undefined) {
      pictures.set(`${each.name}-before`, pageHtml(before, width))
      pictures.set(`${each.name}-delta`, pageHtml(each, width, deltaMarks(each.tree, before.tree)))
    }
  }
  return pictures
}

/** Draws the scenes with the engine and photographs each; only when every check has passed do the PNGs reach `out`. */
async function produce(options: Options, out: string): Promise<Scene[]> {
  const version = claudeVersion(options.claude)
  if (version !== EXPECTED_CLAUDE) {
    throw new ScreensError(
      `${options.claude} is Claude Code ${version}; the pane is drawn by ${EXPECTED_CLAUDE}, the version CI pins, and another version may draw it differently. Install it (npm install --global @anthropic-ai/claude-code@${EXPECTED_CLAUDE}) or point --claude at it.`
    )
  }
  const work = mkdtempSync(join(tmpdir(), 'pane-screens-'))
  try {
    const drawn = drawScenes(options.claude, work)
    const missing = options.scenes.filter(name => !drawn.some(scene => scene.name === name))
    if (missing.length > 0) {
      throw new ScreensError(`no such scene: ${missing.join(', ')}; there are ${drawn.map(scene => scene.name).join(', ')}`)
    }
    const scenes = options.scenes.length > 0 ? drawn.filter(scene => options.scenes.includes(scene.name)) : drawn
    // The other version's scenes are drawn by its own mod and scenes, and photographed by this renderer, so the two look alike.
    let base: Scene[] | null = null
    if (options.deltaAgainst !== null) {
      const baseRoot = join(work, 'base-version')
      writeVersion(options.deltaAgainst, baseRoot)
      const baseWork = join(work, 'base-work')
      mkdirSync(baseWork)
      base = drawScenes(options.claude, baseWork, baseRoot)
    }
    const site = join(work, 'site')
    cpSync(join(SCREENS, 'fonts'), join(site, 'fonts'), { recursive: true })
    copyFileSync(join(SCREENS, 'pane.css'), join(site, 'pane.css'))
    const pages = new Map<string, string>()
    const unknownIn = new Map<string, Set<string>>()
    for (const [name, page] of picturesOf(scenes, base, options.width)) {
      if (page.unknown.size > 0) {
        unknownIn.set(name, page.unknown)
      }
      const path = join(site, `${name}.html`)
      writeFileSync(path, page.document, 'utf8')
      pages.set(name, path)
    }
    const shots = join(work, 'shots')
    await photograph(pages, shots, options.scale)
    if (options.keep !== null) {
      mkdirSync(options.keep, { recursive: true })
      // Each scene's tree, the other version's too, and every page photographed, so a picture can be read back.
      for (const each of scenes) {
        writeFileSync(join(options.keep, `${each.name}.json`), JSON.stringify(each, null, 1), 'utf8')
      }
      for (const each of base ?? []) {
        writeFileSync(join(options.keep, `${each.name}-before.json`), JSON.stringify(each, null, 1), 'utf8')
      }
      for (const name of pages.keys()) {
        copyFileSync(join(site, `${name}.html`), join(options.keep, `${name}.html`))
      }
    }
    if (unknownIn.size > 0 && !options.allowUnknown) {
      const said = [...unknownIn].map(([name, names]) => `${name}: ${[...names].toSorted().join(', ')}`).join('; ')
      throw new ScreensError(
        `the pane draws what this renderer was not taught (${said}); an unknown element shows as a red dashed box and an unknown prop is dropped. Teach tools/pane_html.ts (DRAWN and KEPT list the props), or pass --allow-unknown. Nothing was written.`
      )
    }
    mkdirSync(out, { recursive: true })
    for (const name of pages.keys()) {
      copyFileSync(join(shots, `${name}.png`), join(out, `${name}.png`))
    }
    const unmatched = base === null ? [] : scenes.filter(scene => !pages.has(`${scene.name}-delta`)).map(scene => scene.name)
    if (unmatched.length > 0) {
      console.error(`note: ${unmatched.join(', ')} is no scene at ${options.deltaAgainst ?? ''}, so it has no before or delta picture`)
    }
    return scenes
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

const same = (a: string, b: string): boolean => existsSync(a) && existsSync(b) && readFileSync(a).equals(readFileSync(b))

async function render(values: {
  readonly out: string
  readonly options: Options
  readonly verify: boolean
  readonly check: boolean
  readonly fresh: string | null
}): Promise<number> {
  const { out, options } = values
  const scratch = mkdtempSync(join(tmpdir(), 'pane-screens-out-'))
  try {
    // --check draws into a scratch folder and compares with `out`; it writes nothing there.
    const target = values.check ? join(scratch, 'now') : out
    const scenes = await produce(options, target)
    const others = existsSync(out) ? readdirSync(out).filter(name => name.endsWith('.png') && !scenes.some(scene => `${scene.name}.png` === name)) : []
    if (others.length > 0 && options.scenes.length === 0 && options.deltaAgainst === null) {
      console.error(`note: ${others.join(', ')} in ${out} is no scene (any more); delete it if it is stale`)
    }
    if (values.verify) {
      const again = join(scratch, 'again')
      await produce({ ...options, keep: null }, again)
      const differing = scenes.filter(scene => !same(join(target, `${scene.name}.png`), join(again, `${scene.name}.png`)))
      if (differing.length > 0) {
        throw new ScreensError(`two draws of the same commit gave different PNGs: ${differing.map(scene => scene.name).join(', ')}`)
      }
      console.error(`verified: two draws, ${scenes.length} identical PNGs`)
    }
    if (values.check) {
      const stale = scenes.filter(scene => !same(join(target, `${scene.name}.png`), join(out, `${scene.name}.png`)))
      if (stale.length > 0) {
        // The fresh render is kept where asked, so the difference can be looked at.
        if (values.fresh !== null) {
          cpSync(target, values.fresh, { recursive: true })
        }
        throw new ScreensError(`${stale.map(scene => `${scene.name}.png`).join(', ')} is stale: run npm run screens -- render and commit docs/screens`)
      }
      console.error(`checked: ${scenes.length} PNGs in ${out} are what the pane draws`)
    }
    scenes.forEach(scene => console.log(join(out, `${scene.name}.png`)))
    return 0
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

function setup(withDeps: boolean): number {
  const cli = join(ROOT, 'node_modules', 'playwright', 'cli.js')
  return spawnSync(process.execPath, [cli, 'install', ...(withDeps ? ['--with-deps'] : []), 'chromium'], { stdio: 'inherit' }).status ?? 1
}

// ---- the command line ---------------------------------------------------------------------------------------------------

const USAGE = `usage: node tools/pane_screens.ts render [--out DIR] [--scene NAME]... [--width PX] [--scale N] [--claude BIN] [--keep DIR] [--verify] [--check [--fresh DIR]] [--allow-unknown]
       node tools/pane_screens.ts render --out DIR --delta-against REF [--scene NAME]...
       node tools/pane_screens.ts scenes [--claude BIN]
       node tools/pane_screens.ts setup [--with-deps]`

/** Every scene drawn under the engine, no browser: what \`npm test\` runs, so a change that breaks a scene fails there. */
function scenesOnly(claude: string): number {
  const work = mkdtempSync(join(tmpdir(), 'pane-scenes-'))
  try {
    const drawn = drawScenes(claude, work)
    console.log(`scenes: ${drawn.length} drawn, as listed`)
    return 0
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/** A whole number in a range, or a ScreensError naming the option. */
function integer(given: string | undefined, name: string, least: number, most: number, fallback: number | null): number | null {
  if (given === undefined) {
    return fallback
  }
  const number = Number(given)
  if (!Number.isInteger(number) || number < least || number > most) {
    throw new ScreensError(`bad option: --${name} must be a whole number from ${least} to ${most}`)
  }
  return number
}

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      scene: { type: 'string', multiple: true },
      width: { type: 'string' },
      scale: { type: 'string' },
      claude: { type: 'string' },
      keep: { type: 'string' },
      verify: { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
      'allow-unknown': { type: 'boolean', default: false },
      fresh: { type: 'string' },
      'delta-against': { type: 'string' },
      'with-deps': { type: 'boolean', default: false },
    },
  })
  const [command] = positionals
  if (command === 'render') {
    const options: Options = {
      scenes: values.scene ?? [],
      width: integer(values.width, 'width', 201, 10_000, null),
      scale: integer(values.scale, 'scale', 1, 4, 2) ?? 2,
      claude: values.claude ?? 'claude',
      keep: values.keep === undefined ? null : resolve(values.keep),
      allowUnknown: values['allow-unknown'],
      deltaAgainst: values['delta-against'] ?? null,
    }
    // Before and delta pictures are for a pull request, never docs/screens, and are no README picture to check or verify.
    if (options.deltaAgainst !== null && (values.out === undefined || values.check || values.verify)) {
      throw new ScreensError('--delta-against writes a pull request’s pictures: give it --out DIR, and neither --check nor --verify')
    }
    return render({ out: resolve(values.out ?? SHOTS), options, verify: values.verify, check: values.check, fresh: values.fresh === undefined ? null : resolve(values.fresh) })
  }
  if (command === 'scenes') {
    return scenesOnly(values.claude ?? 'claude')
  }
  if (command === 'setup') {
    return setup(values['with-deps'])
  }
  console.error(`${USAGE}\n(${basename(import.meta.filename)})`)
  return 2
}

try {
  process.exitCode = await main()
} catch (error) {
  console.error(`pane-screens: ${messageOf(error)}`)
  process.exitCode = 1
}
