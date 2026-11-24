# The ChatGPT plugin

gitlab-pane's list of your MRs and their moves, in a panel beside a ChatGPT conversation. The [README](../README.md#in-chatgpt) says how to install it. This folder is its code, beside the mod's: the panel draws the pane's own rows, and every decision is the core's in `hooks/`, imported unchanged. Where and why it was first tried: [alxleo/gitlab-pane#115](https://github.com/alxleo/gitlab-pane/issues/115).

| | Claude Code mod | ChatGPT plugin |
|---|---|---|
| What draws the MRs | `pane.tsx` and `card.tsx`, from `buildPane`'s rows | `panel.ts`, an MCP App in an iframe, from the same rows |
| What reaches GitLab | the session's `$` (`graphql.ts`, `tokens.ts`) | `read.ts`: Node's `fetch`, the token from `GITLAB_TOKEN` or glab |
| A move | `moves.ts` drives the core's merge course | `move.ts` drives the same course |
| Where it runs | inside Claude Code | a stdio MCP server ChatGPT's desktop app starts, on your machine |
| Shipped as | the release tree | `chatgpt/` in the same release tree, built at the same version |

The panel offers each MR's one move as the core's `nextMove` names it. A press goes to `press_move`, a tool only the panel can call (`_meta.ui.visibility: ["app"]`), never the model. So a merge takes two presses, is made only on the head it was read on, and is followed until GitLab says how it ended. The model is given each row's link, verdict and blocker, never a title or a comment (`server.ts`, `forModel`).

| File | What it is |
|---|---|
| `server.ts` | The MCP server. `list_my_mrs` opens beside a conversation through a thread entrypoint; `press_move` is for the panel alone. |
| `read.ts` | How a request reaches GitLab, and the core's read of your open MRs into the panel's rows. |
| `move.ts` | `moves.ts` without the engine: it sends what the core's steps decide, and keeps each MR's press in memory. |
| `panel.ts`, `panel.html` | The panel. `panel-build.ts` bundles it into one HTML resource. |
| `panel-uri.ts` | The panel's URI, named by its hash. ChatGPT caches a panel by its URI, apart from the server, so a changed panel needs a new one, or ChatGPT draws the old panel with the new rows. |
| `result.ts` | What a tool result carries, read from `unknown`, for the panel, the checks and the probe. |
| `plugin.json`, `mcp.json`, `.codex-plugin/plugin.json` | The manifests. ChatGPT's Codex reads `mcp.json` only when it names the Agent Plugins schema; without it the plugin installs and starts no server. `build.ts` stamps the mod's version into both manifests. |
| `build.ts` | Writes the package: the manifests, the server bundled with the core and its packages into `dist/server.mjs`, and the panel beside it. |
| `install.ts` | Builds the package into `~/.codex/plugins/gitlab-pane` and lists it in your personal marketplace, to try a change in ChatGPT before it is released. |
| `fake.ts` | A made-up GitLab: the fixtures, answered by the mod's own test GitLab (`tests/gitlab_fake.ts`). |
| `host.ts`, `harness.ts` | ChatGPT's side of the panel in a web page, through ext-apps' AppBridge; the harness shows it. |
| `move-check.ts`, `panel-test.ts`, `probe.ts`, `codex-check.ts` | The checks (below). |

## Checks

| Check | What it shows | Runs in |
|---|---|---|
| `npm run lint`, `types`, `knip`, `format:check` | The mod's rules hold here too. | `check:fast` |
| `chatgpt/move-check.ts` | A merge through the server arms on the first press, merges on the second, and is followed to "merged"; the model cannot call `press_move`. | `npm test` |
| `chatgpt/probe.ts` | The packaged server serves the panel at the URI that names its hash. `--live` also reads your GitLab. | `npm test`, and on the release tree in CI |
| `npm run panel` | The panel in Chromium behind the host bridge: every MR has a card, no error is shown or thrown, and ✓ merge pressed twice merges. `--live` runs the packaged server on your GitLab and presses nothing. | `screens.yml` |
| `npm run screens -- render --verify --check` | `docs/screens/chatgpt-panel.png` and `-dark.png` are what the panel draws. | `screens.yml` |
| `npm run release-tree -- check` | The tree holds the package at its version, with an `mcp.json` ChatGPT reads. | `check:fast` |
| `chatgpt/codex-check.ts` | Codex installs the plugin from the release tree and starts its server with both tools, as ChatGPT does. | CI, with the Codex `check.yml` pins |

## Try a change in ChatGPT

```bash
node --import ./tools/resolve_ts.ts chatgpt/install.ts
```

Then install "GitLab MRs" from the "Personal" marketplace in ChatGPT's Plugins Directory (once), quit the app with ⌘Q, and open the panel in a new local chat. Each build gets its own version, so ChatGPT takes it as new.
