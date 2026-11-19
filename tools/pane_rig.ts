// pane-rig: drive the GitLab pane through a real, headless Claude Code engine, standing in for the desktop app.
//
//   node tools/pane_rig.ts flow                                       draw the pane once GitLab has answered
//   node tools/pane_rig.ts flow --press tab-mine --press scroll:25 --press open-42 --press back-top
//
// (`npm run rig -- flow …` is the same.) The engine and the desktop's half of the protocol are tools/pane_engine.ts. Row
// numbers are the rig's own estimate; which keys are present, and the order of the asks, are what it gets right. A step
// prints what was drawn, what the window showed in turn (`showed list at 23, then list at 0, then page at 0`: a move shows
// the tree the window holds before the drawing it asks for), the scrolls the engine sent and which element each landed on,
// the pane's title, and the engine's own log lines about the mod.
//
// It checks behaviour, not looks: `npm run preview` draws the same engine's pane in a browser.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { Desktop, Engine, RigError, messageOf, openPane, spawnWire, title, viewOf } from './pane_engine.ts'

async function describe(desktop: Desktop, engine: Engine, show: number, before: { scrolls: number; shown: number }): Promise<string[]> {
  return [
    `  view ${viewOf(desktop.tree)} · title ${await title(engine)} · ${desktop.draws} drawings · offset ${desktop.offset} of ${desktop.rows} rows`,
    // From what the window showed as the step began.
    `  showed ${desktop.shown.slice(Math.max(0, before.shown - 1)).join(', then ')}`,
    ...desktop.scrolls.slice(before.scrolls).map(scroll => `  scrolled to row ${scroll.offset}: lands on ${scroll.landed}`),
    ...desktop
      .texts()
      .slice(0, show)
      .map(each => `  · ${each.slice(0, 110)}`),
    ...engine.newLogLines().map(line => `  log ${line.slice(0, 220)}`),
  ]
}

// ---- the command --------------------------------------------------------------------------------------------------------

type Options = {
  readonly presses: readonly string[]
  readonly waitSeconds: number
  readonly settleMs: number
  readonly bodyRows: number
  readonly show: number
  readonly log: string | null
}

async function flow(options: Options): Promise<number> {
  const folder = mkdtempSync(join(tmpdir(), 'pane-rig-'))
  const log = options.log ?? join(folder, 'debug.log')
  const engine = new Engine(spawnWire(folder, log), log)
  try {
    await engine.ask({ subtype: 'initialize' })
    const desktop = new Desktop(engine, options.bodyRows)
    await desktop.draw()
    const startedAt = Date.now()
    await openPane(engine, desktop)
    const seconds = () => ((Date.now() - startedAt) / 1000).toFixed(1)
    const hasCards = () => desktop.texts().some(each => /^Mine · [1-9]/u.test(each.trim()))
    let cardsAt = hasCards() ? seconds() : null
    const end = startedAt + options.waitSeconds * 1000
    // Read once the pane says how old its cards are, with no ↻ beside the age, or says the read failed.
    const isRead = () => desktop.texts().some(each => /^updated |^GitLab read failed/u.test(each.trim()))
    while (!isRead()) {
      if (Date.now() > end) {
        throw new RigError('GitLab never answered')
      }
      await desktop.settle(options.settleMs, 1)
      cardsAt ??= hasCards() ? seconds() : null
    }
    const readAt = seconds()
    await desktop.settle(options.settleMs)
    console.log(`ready: first cards at ${cardsAt ?? readAt}s, the read done at ${readAt}s`)
    console.log((await describe(desktop, engine, options.show, { scrolls: 0, shown: 0 })).join('\n'))
    for (const spec of options.presses) {
      const before = { scrolls: desktop.scrolls.length, shown: desktop.shown.length }
      const step = await desktop.press(spec)
      await desktop.settle(options.settleMs)
      console.log(step)
      console.log((await describe(desktop, engine, options.show, before)).join('\n'))
    }
    return 0
  } catch (error) {
    console.error(`stopped: ${messageOf(error)}`)
    engine
      .newLogLines()
      .slice(-15)
      .forEach(line => console.error(`  log ${line.slice(0, 220)}`))
    return 1
  } finally {
    engine.close()
    rmSync(folder, { recursive: true, force: true })
  }
}

/** A positive whole number option, or the way it should have been written. */
function count(given: string | undefined, name: string, fallback: number, least: number): number {
  const value = given === undefined ? fallback : Number(given)
  if (!Number.isFinite(value) || value < least) {
    throw new RigError(`bad option: --${name} must be a number of at least ${least}`)
  }
  return value
}

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      press: { type: 'string', short: 'p', multiple: true },
      'wait-rows': { type: 'string' },
      'settle-ms': { type: 'string' },
      'body-rows': { type: 'string' },
      show: { type: 'string' },
      log: { type: 'string' },
    },
  })
  if (positionals[0] !== 'flow') {
    console.error('usage: node tools/pane_rig.ts flow [--press KEY|scroll:ROW]... [--wait-rows S] [--settle-ms MS] [--body-rows N] [--show N] [--log FILE]')
    return 2
  }
  return flow({
    presses: values.press ?? [],
    waitSeconds: count(values['wait-rows'], 'wait-rows', 120, Number.MIN_VALUE),
    settleMs: count(values['settle-ms'], 'settle-ms', 1500, 1),
    bodyRows: count(values['body-rows'], 'body-rows', 40, 1),
    show: count(values.show, 'show', 6, 0),
    log: values.log === undefined ? null : resolve(values.log),
  })
}

try {
  process.exitCode = await main()
} catch (error) {
  console.error(`pane-rig: ${messageOf(error)}`)
  process.exitCode = 2
}
