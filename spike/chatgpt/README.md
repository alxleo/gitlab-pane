# Spike: gitlab-pane as a ChatGPT conversation panel

Not for merging. It answers whether gitlab-pane's core can drive a ChatGPT plugin. The verdict and evidence are in [alxleo/gitlab-pane#115](https://github.com/alxleo/gitlab-pane/issues/115).

The picture shows the panel in the local harness, with made-up MRs. The merge is armed and waits for its second press. On the left is what the panel sent ChatGPT for the MR with conflicts.

![The panel in the local harness, with made-up MRs](harness.png)

The panel draws the pane's own row model, built by the core's `buildPane`, laid out the way `card.tsx` lays it out. It offers each MR's one move as the core's `nextMove` names it. A press goes to `press_move`, a tool that only the panel can call (`_meta.ui.visibility: ["app"]`). The tool runs the core's merge course (`decidePress`, `firstStep`, `nextStep`, `afterSend`), which the mod drives from `moves.ts`. So a merge takes two presses, is made only on the head it was read on, and is followed until GitLab says how it ended.

| File | What it is |
|---|---|
| `read.ts` | The new GitLab code: the token from `GITLAB_TOKEN` or glab, and Node's `fetch` in place of the session's. Everything after an answer arrives is the core, imported unchanged from `hooks/`. |
| `move.ts` | `moves.ts` without the engine: it sends what the core's steps decide, and keeps each MR's press in memory. |
| `server.ts` | An MCP server over stdio. `list_my_mrs` opens beside a conversation through a thread entrypoint. `press_move` is for the panel alone. |
| `panel.ts`, `panel.html` | The panel, an MCP App. The server bundles it into one HTML resource. |
| `plugin.json`, `mcp.json` | The desktop-only plugin shape: ChatGPT's desktop app launches the server on your machine. |
| `build.ts`, `panel-build.ts` | Bundle the server, the core and the panel into `dist/`, which is what a package holds. |
| `install.ts` | Copies the package to `~/.codex/plugins/gitlab-pane` and lists it in the personal marketplace, `~/.agents/plugins/marketplace.json`. |
| `fake.ts`, `move-check.ts` | A made-up GitLab, and a check that a merge pressed in the panel arms, merges, and is followed to "merged". |
| `probe.ts` | Talks to the server the way the desktop app would, and prints a verdict, never the MRs. |
| `harness.ts` | Plays ChatGPT's side of the panel in a browser, against the made-up GitLab, or the real one with `--live`. |

## Run it

The spike needs Node 26 (`mise install` at the root) and its own packages:

```bash
cd spike/chatgpt && npm install
```

```bash
node move-check.ts
```

```bash
node probe.ts
```

```bash
node harness.ts
```

The probe reads your GitLab, so it needs a token: `GITLAB_TOKEN`, or `glab auth login`. `GITLAB_PANE_HOST` picks a host other than gitlab.com. The check and the harness run against the made-up GitLab. `--live` points the harness at the real one, where a merge press merges.

## In ChatGPT

An installed plugin is copied out of the repository, so it gets the bundle and none of the sources.

```bash
node build.ts
```

```bash
node install.ts
```

Then restart the ChatGPT desktop app, open the Plugins Directory, choose the "Personal" marketplace, and install "GitLab MRs". In a conversation that runs locally, open the "My merge requests" panel. Workspace policies on custom MCP servers apply, so a company workspace may refuse the install. Public submission of a local MCP server is limited to partners OpenAI has allowlisted.
