// Packages the plugin: the server, the core it imports from ../../hooks and its MCP packages as one plain-JavaScript file,
// and the panel beside it. An installed plugin is copied out of this repository, so nothing may be imported from outside
// dist/, and the node that ChatGPT's desktop app finds needs no TypeScript.
//
//   node build.ts      writes dist/server.mjs and dist/panel.bundled.html
import { mkdirSync, writeFileSync } from 'node:fs'

import { build } from 'esbuild'

import { panelHtml } from './panel-build.ts'

const dist = new URL('./dist/', import.meta.url)
mkdirSync(dist, { recursive: true })
await build({
  entryPoints: [new URL('./server.ts', import.meta.url).pathname],
  outfile: new URL('server.mjs', dist).pathname,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfigRaw: {},
  logLevel: 'error',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
})
writeFileSync(new URL('panel.bundled.html', dist), await panelHtml())
console.log('wrote dist/server.mjs and dist/panel.bundled.html')
