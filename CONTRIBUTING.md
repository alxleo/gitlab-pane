# Contributing

Node 26 or newer runs everything, TypeScript tools included (types stripped). No Python, no shell script, no other toolchain.

## Set up

Two things come first: [mise](https://mise.jdx.dev), which installs what `mise.toml` pins, and `claude` (Claude Code) on the PATH, at the `CLAUDE_CODE_VERSION` that `check.yml` pins, since `npm run setup` and `npm run check` use it.

```bash
mise install                 # Node and the scanners `npm run scan` runs, at the versions mise.toml pins
npm ci
npm run setup                # git hooks, and the engine's declarations into .claude-plugin/types/
claude --plugin-dir .        # run the mod from this clone
npm run check && npm test    # everything a commit and a push must pass
```

## Scripts

| Script | Checks |
| --- | --- |
| `npm run setup` | Writes the git hooks (`simple-git-hooks`) and unpacks the engine's declarations from the `claude` on your PATH (`tools/engine_types.ts`: no sign-in, no network, git-ignored). |
| `npm run files` | JSON and YAML parse; no conflict markers, private keys or files over 500 kB; no `oxlint-` or `eslint-` directive comment in any script (checked here because oxlint obeys a blanket disable even over the rule refusing it); one final newline, no trailing whitespace. |
| `npm run format` | Writes the formatting: [Biome](https://biomejs.dev) as formatter only (`biome.jsonc`), oxlint stays the linter. The tools that generate `hooks/gitlab.generated.ts`, the schema snapshot and `tests/docs.generated.ts` format their output through it. |
| `npm run format:check` | Every TS, TSX, JS, CJS and JSON file is formatted as `npm run format` writes it (`package-lock.json` apart: npm writes it). |
| `npm run knip` | No unused file, export, type or dependency; each entry point in `knip.jsonc` has its reason. |
| `npm run lint` | [oxlint](https://oxc.rs) over `hooks/`, `tests/`, `tools/` (`oxlint.config.ts`): no `x as T`, `any`, `!` or module state; `hooks/` files within 400 lines; the core imports core files only, by `.ts` path; type-aware rules through `oxlint-tsgolint`, which is TypeScript 7 inside. The local rules are `tools/lint_rules.ts`, tested in `tools/lint_rules.spec.ts`. |
| `npm run types` | TypeScript 7 over `tsconfig.core.json`, `tsconfig.json`, `tools/store-probe/tsconfig.json` and `tools/tsconfig.json`. |
| `npm run schema -- types --check` | `hooks/gitlab.generated.ts` is what graphql-codegen makes of the snapshot and the documents. |
| `npm run release-tree -- check` | The tree built from `release/files` loads only what it holds. |
| `npm run docs -- check` | README's settings table is `userConfig`; README's and DESIGN's tables are `tests/docs.generated.ts` (`docs -- write` remakes it, `tests/docs.test.ts` holds it to the code); the scripts table here is `package.json`'s scripts. |
| `npm run validate` | `claude plugin validate --strict` on the plugin and the store probe. |
| `npm run scan` | gitleaks, actionlint, zizmor: each only if installed, and a skipped one is named. |
| `npm run check:fast` | `files`, `format:check`, `knip`, `lint`, `types`, `schema -- types --check`, `release-tree -- check`, `docs -- check`, `validate`. |
| `npm run check` | `check:fast`, then `scan`. |
| `npm test` | Vitest on the core and the dev tools' own specs (plain Node), `claude plugin test .` (the engine), then the scenes. |
| `npm run schema -- <check\|snapshot\|types>` | `check`: every query against gitlab.com's live schema, and what each costs; `snapshot`: refresh the snapshot; `types`: regenerate the types. |
| `npm run screens -- <render\|setup\|scenes>` | `render` photographs the pane in Chromium for `docs/screens`; `setup` fetches Chromium; `scenes` runs the scenes. |
| `npm run rig -- flow` | Drives the pane through a headless engine. |
| `npm run shot -- <capture\|press\|tour\|windows>` | Photographs and presses the pane in the running desktop app; Mac only ([when](#checking-the-pane-in-the-desktop-app)). |
| `npm run commit-msg` | commitlint on a message file (the commit-msg hook). |
| `npm run pr-title` | commitlint on stdin (CI, for a pull request's title). |

## Where each check runs

| Check | On edit | Commit | Push | CI | Weekly canary |
| --- | :-: | :-: | :-: | :-: | :-: |
| Core `tsc`, oxlint and `biome format` on the file edited (`tools/check_core.ts`) | x | | | | |
| `check:fast` | | x | | x | |
| `scan` (gitleaks on the staged change only) | | x | | x | |
| Commit message and pull request title (commitlint) | | x | | x | |
| Author and committer are noreply addresses | | | | x | |
| `npm test` | | | x | x | x, `claude plugin test .` on the newest Claude Code |
| Release tree builds and validates | | | | x | x, and installs |
| `screens -- render --verify --check` | | | | x, when the drawing changes | |
| `schema -- check` against gitlab.com | | | | x, when queries change | x |
| Plugin installs from GitHub; release branch holds the latest tag | | | | | x |
| gitleaks over the whole history | | | | | x |

Workflows: `check.yml` (checks, scanners, release), `screens.yml`, `canary.yml`. One Claude Code version is pinned in `check.yml` (twice), `screens.yml` and `tools/pane_screens.ts`; Renovate raises all four in one pull request (`renovate.json`), which fails `screens.yml` until `npm run screens -- render` is committed if the new version draws the pane differently. Renovate also keeps the actions and the tooling current, once a month and only with releases out for 14 days. The canary failing on the newest Claude Code or on a changed schema opens an issue; the next green run closes it.

## GitLab's types

Edit the `/* GraphQL */` documents in `hooks/gitlab-documents.ts`, run `npm run schema -- types`, commit `hooks/gitlab.generated.ts`: a field the schema lets be null is `| null` there, and the code must handle it.
`tools/gitlab_schema.snapshot.json` is the slice of gitlab.com's schema the documents use; `npm run schema -- snapshot` then `types` takes the schema as it is now.
A document's cost is stated in `COMPLEXITY`, which `schema -- check` verifies. A host that answers `undefinedField` is sent the variant without that field.

## Commits

- Conventional messages (`feat:`, `fix(jira):`, `docs:` ...), because releases are worked out from them. Merge a pull request with a squash: its title becomes the commit on main.
- Author and committer must be GitHub noreply addresses (from https://github.com/settings/emails; turn on "Keep my email addresses private"), or `noreply@anthropic.com` as committer for a commit Claude signed.

## Releasing

```mermaid
flowchart LR
  main["green check on main"] --> pr["release-please keeps a release PR open:<br/>next version, changelog"]
  pr -->|merge = release| tag["version raised in plugin.json,<br/>tag vX.Y.Z, GitHub release"]
  tag --> publish["publish job builds the tree<br/>from the tag"]
  publish --> branch["release branch + tag plugin-vX.Y.Z<br/>(one commit a version, never forced)"]
```

- While the version is 0.x, `feat:` and `fix:` both raise the patch number (0.4.0 to 0.4.1); `!` or a `BREAKING CHANGE:` footer raises the minor (`bump-patch-for-minor-pre-major` and `bump-minor-pre-major` in `release-please-config.json`). Other kinds wait for one of those.
- No check starts on the release PR by itself, as GitHub starts no workflow for a PR its own token opened, yet main requires `check` before any merge. To release, close the PR and reopen it as yourself: that starts its checks, and it merges once they pass. A run started by hand (`gh workflow run check.yml --ref <its branch>`) passes on the same commit but does not count, because GitHub ties it to no pull request.
- Users get the files in `release/files` and nothing else (`plugin.json`, `hooks/` without the generated types, `types/index.d.ts`, `LICENSE`, `README.md`). A file the plugin loads at run time goes in that list; `release-tree -- check` fails otherwise.
- A team pins `"ref": "plugin-vX.Y.Z"` in its marketplace source (the tree has its own `release/marketplace.json`).
- The default install reads `.claude-plugin/marketplace.json` on main (`"source": "./"`). Once the first `plugin-v*` tag exists, switch it to `{ "source": "github", "repo": "alxleo/gitlab-pane", "ref": "release" }` in its own commit, and change the README's "That follows main" to "That follows releases".

## Screenshots

`docs/screens` comes from `npm run screens -- render` (the mod's own drawing under the pinned Claude Code, photographed in Chromium; run `screens -- setup` first, `setup --with-deps` on Linux). Run it after changing the drawing and commit the pictures; `screens.yml` fails on a stale one.

A pull request's pictures come from `npm run screens -- render --out <dir> --delta-against origin/main`. For each scene it writes three pictures:
- `<scene>.png`, as the branch draws it;
- `<scene>-before.png`, as main draws it;
- `<scene>-delta.png`, the branch's picture with what changed at full strength and outlined, and everything else faded.

It compares elements, not pixels, so a row that only moved down stays faded. The look of the desktop's elements is `tools/screens/pane.css`; what each colour and mark means is [DESIGN.md](DESIGN.md).

## Checking the pane in the desktop app

The rig and the shot answer different questions. `npm run rig -- flow` stands in for the desktop: it asks a headless engine for drawings, presses and scrolls as the desktop would, and prints what came back. It runs anywhere, CI included, so reach for it first, for anything about what the mod draws or how it answers.

`npm run shot` looks at the real desktop app on a Mac. Reach for it when the question is what the app itself does with the drawing: whether a click lands, where a hover card pushes the rows, how a narrow window wraps a card, or a bug the rig cannot reproduce. It reads the pane off the screen with macOS text recognition, clicks and scrolls through Hammerspoon, and writes the pane alone as a PNG. The pictures show real MR titles and names, so write them outside the checkout:

```bash
npm run shot -- capture -o "$TMPDIR/pane.png"
```

```bash
npm run shot -- press "read whole" -o "$TMPDIR/after.png"
```

`--help` lists the rest (`windows`, `tour`, `capture --to bottom`). It needs Hammerspoon with its `hs` command (`require("hs.ipc")` in its config, then `hs.ipc.cliInstall()`), Accessibility for Hammerspoon, and Screen Recording for the terminal that runs it.

The app takes a click or a scroll only while its window is in front, so the shot refuses to click, scroll or move the pointer otherwise, and never takes focus on its own; a capture of a window behind others says it was read without the pointer parked, so a hover card may show in it. Run it when the person at the Mac says the pane is showing, never on a timer or in CI. `--raise` brings the window forward only when nobody has typed or moved the pointer for a few seconds, and gives focus back after. Every session's pane sits in the same place, so pass `--session` with the name in the window's header when it matters which session's pane you photograph.
