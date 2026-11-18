import { realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const root = dirname(fileURLToPath(import.meta.url))

// Each project's tests run in a Node that refuses what a test here has no business doing: writing anywhere, reading outside
// the repository, starting a process or a thread, or opening a connection (Node 26, which package.json, mise.toml and CI
// pin). A test that tries gets ERR_ACCESS_DENIED, however it reached the call. tools/vitest_config.spec.ts keeps it so.
// The packages are read where they really are, which is outside the repository when node_modules is a link to another
// checkout's.
const refuseAllBut = (...allowed: string[]): string[] => ['--permission', `--allow-fs-read=${root}`, `--allow-fs-read=${realpathSync(join(root, 'node_modules'))}`, ...allowed]

/** The two kinds of spec Vitest runs, each with what its Node allows. */
export const PROJECTS = [
  { extends: true, test: { name: 'core', include: ['tests/core/**/*.spec.ts'], execArgv: refuseAllBut() } },
  {
    extends: true,
    test: {
      name: 'tools',
      include: ['tools/*.spec.ts'],
      // The tools parse with oxc and oxlint, which are native addons. Node checks only what JavaScript calls, not what
      // native code does, so here the refusals hold for the tests' own code and not inside those two parsers; Node warns of
      // that on every start, which says nothing new, so the warning is turned off.
      execArgv: refuseAllBut('--allow-addons', '--disable-warning=PERM0001'),
    },
  },
]

// The core under plain Node: no transforms, no plugins, no aliases. The core files import each other by their .ts path,
// which Vite resolves as it finds it. Only tests/core/*.spec.ts and the dev tools' own tools/*.spec.ts run here; the
// engine's runner takes *.test.ts and *.test.tsx (`claude plugin test`), so neither picks up the other's files. The tools'
// specs sit beside the tools because tools/tsconfig.json, with Node's types, is the project that checks both.
// The one setting beyond the tests' location: Vite reads a tsconfig to strip types, and the core's is the one that does not
// extend the engine's declarations, which are git-ignored and absent on a fresh clone.
export default defineConfig({
  tsconfig: 'tsconfig.core.json',
  // No test here takes half a second; one that takes two has started doing something these tests are not for.
  test: { environment: 'node', setupFiles: ['tests/core/setup.ts'], testTimeout: 2_000, projects: PROJECTS },
})
