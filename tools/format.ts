// Text as Biome (biome.jsonc) would write the file at a path. The tools that generate a file (tools/gitlab_schema.ts for the
// GraphQL types and the schema snapshot, tools/docs.ts for tests/docs.generated.ts) run their output through this before they
// write it or compare it with what is there, so a generated file is always one `npm run format:check` leaves alone.
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const BIOME = join(ROOT, 'node_modules', '@biomejs', 'biome', 'bin', 'biome')
const MEGABYTE = 1024 * 1024

export function formatted(text: string, file: string): string {
  const ran = spawnSync(process.execPath, [BIOME, 'format', `--stdin-file-path=${file}`], {
    cwd: ROOT,
    input: text,
    encoding: 'utf8',
    maxBuffer: 64 * MEGABYTE,
  })
  if (ran.status !== 0) {
    throw new Error(`biome could not format ${file} (${ran.error?.message ?? `exit ${ran.status}`}): ${ran.stderr.trim()}. Run: npm ci`)
  }
  return ran.stdout
}
