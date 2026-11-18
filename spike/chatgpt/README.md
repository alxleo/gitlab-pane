# Spike: gitlab-pane as a ChatGPT conversation panel

Not for merging. It answers whether gitlab-pane's core can drive a ChatGPT plugin. The verdict and evidence are in [alxleo/gitlab-pane#115](https://github.com/alxleo/gitlab-pane/issues/115).

![The panel in the local harness, with made-up MRs](harness.png)

| File | What it is |
|---|---|
| `read.ts` | The only new read code: the token from `GITLAB_TOKEN` or glab, and Node's `fetch` in place of the session's. Everything after the answer arrives is the core, imported unchanged from `hooks/`. |
| `server.ts` | An MCP server over stdio with one tool, `list_my_mrs`. A thread entrypoint opens the tool beside a ChatGPT conversation. |
| `panel.ts`, `panel.html` | The panel, an MCP App. The server bundles it into one HTML resource. |
| `plugin.json`, `mcp.json` | The desktop-only plugin shape: ChatGPT's desktop app launches the server on your machine. |
| `build.ts`, `panel-build.ts` | Bundle the server, the core and the panel into `dist/`, which is what a package holds. |
| `probe.ts` | Talks to the server the way the desktop app would, and prints a verdict, never the MRs. |
| `harness.ts` | Plays ChatGPT's side of the panel in a browser, with made-up MRs, or `--live`. |

## Run it

The spike needs Node 26 (`mise install` at the root) and its own packages:

```bash
cd spike/chatgpt && npm install
```

```bash
node probe.ts
```

```bash
node harness.ts
```

The probe needs a token: `GITLAB_TOKEN`, or `glab auth login`. `GITLAB_PANE_HOST` picks a host other than gitlab.com. The harness needs no token unless you pass `--live`.

## Trying it in ChatGPT itself (not done here)

An installed plugin is copied out of the repository, so it gets the bundle and none of the sources. `node build.ts` writes `dist/server.mjs`, which holds the server, the core and the MCP packages in one file, and `dist/panel.bundled.html`, which `mcp.json` launches beside it. A copy that holds only `plugin.json`, `mcp.json` and `dist/`, kept outside the repository, passed `node probe.ts <copy>/dist/server.mjs` under Node 22, 24 and 26.

1. Run `node build.ts`.
2. In the ChatGPT desktop app, add a local marketplace that contains this folder, and install the plugin from the Plugins Directory. Workspace policies on custom MCP servers apply, so a company workspace may refuse this.
3. Open a conversation and choose "My merge requests" from the panel's entrypoints.

Public submission of a local MCP server is limited to partners OpenAI has allowlisted.
