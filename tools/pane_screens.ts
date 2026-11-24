// pane-screens: the README's screenshots of the GitLab pane, drawn by the mod's own code and photographed headless.
//
//   node --import ./tools/resolve_ts.ts tools/pane_screens.ts render                      write docs/screens/<scene>.png (light) and <scene>-dark.png for every scene
//   node --import ./tools/resolve_ts.ts tools/pane_screens.ts render --scene inbox        one scene
//   node --import ./tools/resolve_ts.ts tools/pane_screens.ts render --out /tmp/shots     somewhere else, to compare two runs
//   node --import ./tools/resolve_ts.ts tools/pane_screens.ts render --verify             draw twice, fail unless both are byte-identical
//   node --import ./tools/resolve_ts.ts tools/pane_screens.ts render --check              draw, and fail unless docs/screens already holds exactly these PNGs; writes nothing
//   node --import ./tools/resolve_ts.ts tools/pane_screens.ts render --out /tmp/pr --delta-against origin/main
//                                                          a pull request's pictures: each scene, `<scene>-before.png` as main
//                                                          draws it, and `<scene>-delta.png`, the change at full strength and
//                                                          outlined, all else faded (tools/screen_delta.ts says what changed)
//   node --import ./tools/resolve_ts.ts tools/pane_screens.ts setup [--with-deps]         fetch the Chromium it photographs with (once per Playwright version)
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
import { parseJson } from '../hooks/decode.ts'
import { CHATGPT_PANEL as chatgptPanel, photographPanel } from './chatgpt_screens.ts'
import { decodeScene, pageHtml, strings, type Scene } from './pane_html.ts'
import { checkLetters, pictureName, ScreensError, THEMES, withThemes, type Theme } from './photograph.ts'
import { CLAUDE_PACKAGE, pinned, pinnedClaude } from './pins.ts'
import { deltaMarks } from './screen_delta.ts'

const ROOT = join(import.meta.dirname, '..')
const SCREENS = join(import.meta.dirname, 'screens')
const SHOTS = join(ROOT, 'docs', 'screens')
const MARKER = 'PANE-SCENE '
const LISTED = 'PANE-SCENES '

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

/** A page to photograph: the file, and the app theme it is seen in (pane.css and the faces' own styles follow it). */
type Sitting = { readonly path: string; readonly theme: Theme }

async function photograph(pages: ReadonlyMap<string, Sitting>, out: string, scale: number): Promise<void> {
  mkdirSync(out, { recursive: true })
  await withThemes(scale, async contexts => {
    for (const [name, { path, theme }] of pages) {
      const context = contexts.get(theme)
      if (context === undefined) {
        throw new ScreensError(`no browser for the ${theme} theme`)
      }
      const page = await context.newPage()
      await page.goto(pathToFileURL(path).href)
      await page.evaluate('document.fonts.ready.then(() => true)')
      await checkLetters(name, context, page, { root: FRAME, frame: null })
      await page.locator(FRAME).screenshot({ path: join(out, `${name}.png`), animations: 'disabled', omitBackground: false })
      await page.close()
    }
  })
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

/** The pictures a scene is in docs/screens: one per theme. */
const scenePictures = (scene: Scene): string[] => THEMES.map(theme => pictureName(scene.name, theme))

type Picture = ReturnType<typeof pageHtml> & { readonly theme: Theme }

/**
 * The pages to photograph for `scenes`, by picture name: each scene in each theme, and with `base` (the same scenes drawn
 * at another version) the scene as it was there and the delta between them, for a scene `base` also draws.
 */
function picturesOf(scenes: readonly Scene[], base: readonly Scene[] | null, width: number | null): Map<string, Picture> {
  const pictures = new Map<string, Picture>()
  for (const theme of THEMES) {
    for (const each of scenes) {
      const name = pictureName(each.name, theme)
      pictures.set(name, { ...pageHtml(each, width), theme })
      const before = base?.find(scene => scene.name === each.name)
      if (before !== undefined) {
        pictures.set(`${name}-before`, { ...pageHtml(before, width), theme })
        pictures.set(`${name}-delta`, { ...pageHtml(each, width, deltaMarks(each.tree, before.tree)), theme })
      }
    }
  }
  return pictures
}

/**
 * Draws the scenes with the engine and photographs each, and the ChatGPT plugin's panel (`chatgpt_screens.ts`) unless
 * the scenes asked for leave it out; only when every check has passed do the PNGs reach `out`. Returns the pictures, by
 * name, that stand in docs/screens: the before and delta pictures of a pull request are not among them.
 */
async function produce(options: Options, out: string): Promise<string[]> {
  // The panel is no scene of the engine's; a pull request's before and delta pictures are of the pane alone.
  const isPanelToo = options.deltaAgainst === null && (options.scenes.length === 0 || options.scenes.includes(chatgptPanel))
  const asked = options.scenes.filter(name => name !== chatgptPanel)
  const isPaneToo = options.scenes.length === 0 || asked.length > 0
  // The pictures are the pinned Claude Code's: another version may draw the pane differently.
  const expected = pinned(ROOT, CLAUDE_PACKAGE)
  const version = isPaneToo ? claudeVersion(options.claude) : expected
  if (version !== expected) {
    throw new ScreensError(
      `${options.claude} is Claude Code ${version}; the pane is drawn by ${expected ?? '(nothing)'}, the version package.json pins, and another version may draw it differently. Run npm ci, which installs it, or point --claude at it.`
    )
  }
  const work = mkdtempSync(join(tmpdir(), 'pane-screens-'))
  try {
    const drawn = isPaneToo ? drawScenes(options.claude, work) : []
    const missing = asked.filter(name => !drawn.some(scene => scene.name === name))
    if (missing.length > 0) {
      throw new ScreensError(`no such scene: ${missing.join(', ')}; there are ${[...drawn.map(scene => scene.name), chatgptPanel].join(', ')}`)
    }
    const scenes = options.scenes.length > 0 ? drawn.filter(scene => asked.includes(scene.name)) : drawn
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
    const pages = new Map<string, Sitting>()
    const unknownIn = new Map<string, Set<string>>()
    for (const [name, page] of picturesOf(scenes, base, options.width)) {
      // The same tree draws the same elements in either theme, so the light picture alone says what is unknown.
      if (page.unknown.size > 0 && page.theme === 'light') {
        unknownIn.set(name, page.unknown)
      }
      const path = join(site, `${name}.html`)
      writeFileSync(path, page.document, 'utf8')
      pages.set(name, { path, theme: page.theme })
    }
    const shots = join(work, 'shots')
    await photograph(pages, shots, options.scale)
    const panel = isPanelToo ? await photographPanel(shots, options.scale) : []
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
    for (const name of [...pages.keys(), ...panel]) {
      copyFileSync(join(shots, `${name}.png`), join(out, `${name}.png`))
    }
    const unmatched = base === null ? [] : scenes.filter(scene => !pages.has(`${scene.name}-delta`)).map(scene => scene.name)
    if (unmatched.length > 0) {
      console.error(`note: ${unmatched.join(', ')} is no scene at ${options.deltaAgainst ?? ''}, so it has no before or delta picture`)
    }
    return [...scenes.flatMap(scenePictures), ...panel]
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
    const pictures = (await produce(options, target)).map(name => `${name}.png`)
    const others = existsSync(out) ? readdirSync(out).filter(name => name.endsWith('.png') && !pictures.includes(name)) : []
    if (others.length > 0 && options.scenes.length === 0 && options.deltaAgainst === null) {
      console.error(`note: ${others.join(', ')} in ${out} is no scene (any more); delete it if it is stale`)
    }
    if (values.verify) {
      const again = join(scratch, 'again')
      await produce({ ...options, keep: null }, again)
      const differing = pictures.filter(name => !same(join(target, name), join(again, name)))
      if (differing.length > 0) {
        throw new ScreensError(`two draws of the same commit gave different PNGs: ${differing.join(', ')}`)
      }
      console.error(`verified: two draws, ${pictures.length} identical PNGs`)
    }
    if (values.check) {
      const stale = pictures.filter(name => !same(join(target, name), join(out, name)))
      if (stale.length > 0) {
        // The fresh render is kept where asked, so the difference can be looked at.
        if (values.fresh !== null) {
          cpSync(target, values.fresh, { recursive: true })
        }
        throw new ScreensError(`${stale.join(', ')} is stale: run npm run screens -- render and commit docs/screens`)
      }
      console.error(`checked: ${pictures.length} PNGs in ${out} are what the pane draws`)
    }
    pictures.forEach(name => console.log(join(out, name)))
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

const USAGE = `usage: node --import ./tools/resolve_ts.ts tools/pane_screens.ts render [--out DIR] [--scene NAME]... [--width PX] [--scale N] [--claude BIN] [--keep DIR] [--verify] [--check [--fresh DIR]] [--allow-unknown]
       node --import ./tools/resolve_ts.ts tools/pane_screens.ts render --out DIR --delta-against REF [--scene NAME]...
       node --import ./tools/resolve_ts.ts tools/pane_screens.ts scenes [--claude BIN]
       node --import ./tools/resolve_ts.ts tools/pane_screens.ts setup [--with-deps]`

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
      claude: values.claude ?? pinnedClaude(ROOT),
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
    return scenesOnly(values.claude ?? pinnedClaude(ROOT))
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
