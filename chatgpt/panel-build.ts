// Builds the panel into one HTML document: the iframe's CSP blocks outside scripts, so the bundle goes inline.
import { readFileSync } from 'node:fs'

import { build } from 'esbuild'

export async function panelHtml(): Promise<string> {
  const bundled = await build({
    entryPoints: [new URL('./panel.ts', import.meta.url).pathname],
    bundle: true,
    format: 'esm',
    target: 'es2023',
    minify: true,
    write: false,
    tsconfigRaw: {},
  })
  const code = bundled.outputFiles[0]?.text ?? ''
  return readFileSync(new URL('./panel.html', import.meta.url), 'utf8').replace('/*BUNDLE*/', () => code.replaceAll('</script', '<\\/script'))
}
