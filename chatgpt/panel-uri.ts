// The panel's resource URI. ChatGPT caches a panel by its URI, apart from the server, and draws the cached one with
// whatever rows the new server sends. So the URI names a hash of the panel itself: a changed panel gets a new URI, which
// ChatGPT has not cached, and an unchanged one keeps its URI and its cache. Nobody has to remember to bump it.
import { createHash } from 'node:crypto'

export const panelUri = (html: string): string => `ui://gitlab-pane/panel-${createHash('sha256').update(html).digest('hex').slice(0, 12)}.html`
