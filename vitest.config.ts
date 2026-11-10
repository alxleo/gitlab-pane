import { defineConfig } from 'vitest/config'

// The core under plain Node: no transforms, no plugins, no aliases. The core files import each other by their .ts path,
// which Vite resolves as it finds it. Only tests/core/*.spec.ts and the dev tools' own tools/*.spec.ts run here; the
// engine's runner takes *.test.ts and *.test.tsx (`claude plugin test`), so neither picks up the other's files. The tools'
// specs sit beside the tools because tools/tsconfig.json, with Node's types, is the project that checks both.
// The one setting beyond the tests' location: Vite reads a tsconfig to strip types, and the core's is the one that does not
// extend the engine's declarations, which are git-ignored and absent on a fresh clone.
export default defineConfig({
  tsconfig: 'tsconfig.core.json',
  test: {
    include: ['tests/core/**/*.spec.ts', 'tools/*.spec.ts'],
    environment: 'node',
    setupFiles: ['tests/core/setup.ts'],
  },
})
