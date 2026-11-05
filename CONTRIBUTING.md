# Contributing

## Set up a clone

Start Claude Code with the clone as the plugin, so every session reads the mod from your folder and an edit needs only `/reload-plugins`:

```bash
claude --plugin-dir path/to/gitlab-pane
```

(The clone's `.claude-plugin/marketplace.json` is the public one and installs the released tree from GitHub, so adding the clone as a marketplace would not run your edits.) Uninstall `gitlab-ci` first if you installed it, so the two do not both draw a pane.

Then turn on the checks that run before each commit, on its message, and before each push. [pre-commit](https://pre-commit.com) runs them. Install it once with `uv tool install pre-commit` or `brew install pre-commit`, then, in the clone:

```bash
pre-commit install
```

## The checks

`.pre-commit-config.yaml` lists them, and CI runs the same list:

- **Secrets:** gitleaks reads each staged change before it is committed, and every commit in the history in CI.
- **Workflows:** actionlint catches mistakes in `.github/workflows/`, and zizmor catches unsafe patterns such as script injection and actions not pinned to a commit.
- **Files:** JSON and YAML parse; no private keys, conflict markers or large files.
- **Addresses:** CI fails any commit whose author or committer is not a GitHub noreply address, so nobody's own email is published here. Set yours from https://github.com/settings/emails, and turn on "Keep my email addresses private" there so merges you make on GitHub use it too.
- **The plugin:** `claude plugin validate --strict .` on each commit that touches it, and `claude plugin test .` before each push.
- **Types, the core:** `tsc -p tsconfig.core.json`, with TypeScript pinned in `.pre-commit-config.yaml`, strictly checks the files that run on plain data: `avatar.ts`, `ci.ts`, `decode.ts`, `gitlab.generated.ts`, `gitlab.ts`, `identity.ts`, `inbox-json.ts`, `jira.ts`, `markdown.ts`, `problems.ts` and `reconcile.ts` in `hooks/`, over the types in `types/index.d.ts`, and `tests/fixtures.ts` and `tests/gitlab_fake.ts`, so the made-up GitLab answers must fit the generated types. That config has no engine types, so a file there that imports `claude-code` does not compile: code that talks to the engine stays out of the core, and new pure code goes in it.
- **Types, GitLab's answers:** `hooks/gitlab.generated.ts` holds the TypeScript type of every document the pane sends, made by [graphql-codegen](https://the-guild.dev/graphql/codegen) (versions locked in `tools/codegen/`, a dev-time install; the mod has no npm packages) from `tools/gitlab_schema.snapshot.json` and the `/* GraphQL */` documents in `hooks/gitlab.ts`. The snapshot is the part of gitlab.com's schema those documents use, nullability included, so a commit needs no network. The pre-commit hook `uv run tools/gitlab_schema.py types --check` regenerates the file and fails if it differs. After changing a document, run `uv run tools/gitlab_schema.py types` and commit the file; a field the schema lets be null is `| null` in it, and the code has to handle that to compile. To take the schema as it is now, run `uv run tools/gitlab_schema.py snapshot`, then `types`.
- **Commit messages:** each one says what it is, such as `feat: …`, `fix(jira): …` or `docs: …`, because releases are worked out from them. A pull request's title follows the same rule; merge with a squash, so the title becomes the commit on main.

To run the checks by hand:

```bash
pre-commit run --all-files --hook-stage manual
```

That leaves out `claude plugin test .`, which CI runs as its own step, so run it too.

Everything else (the panes, `read.ts`, the tests) imports `claude-code`, so it is type-checked only against the engine's types, which are not generated here but committed in `types/engine/`, a snapshot of what Claude Code writes into `.claude-plugin/types/` when a signed-in session has loaded the mod from your clone:

```bash
npx --package typescript tsc -p .
```

CI does not run that yet. To take or refresh the snapshot, from a clone a signed-in session has loaded, and commit `types/engine/`:

```bash
tools/snapshot_types.sh
```

It records the `claude --version` it came from in `types/engine/VERSION`. Refresh the snapshot whenever `CLAUDE_CODE_VERSION` in `check.yml` is raised, in the same change.

## CI

`.github/workflows/check.yml` runs the checks above and the tests as one job, for pull requests and for main. The Claude Code version CI uses is pinned there, in `screens.yml` and in `tools/pane_screens.py`; change all three together, and refresh the types snapshot with them. Dependabot proposes newer pinned actions and hooks monthly.

`.github/workflows/canary.yml` runs every Monday, for what breaks the pane while this repository stands still. It validates the plugin and runs its tests on the newest Claude Code, installs the plugin from GitHub into an empty setup, and checks every query the pane sends against gitlab.com's live schema, and that the snapshot and the generated types still match it: when GitLab makes a field nullable or adds an enum value, the canary fails until `snapshot` and `types` are run and the code handles it. A failure opens an issue, and the next green run closes it. When the newest Claude Code passes, it is safe to raise the pinned version. A pull request that changes the queries in `hooks/gitlab.ts`, the snapshot or the generated types gets the schema check too; to run it yourself, with Node 24 or newer:

```bash
uv run tools/gitlab_schema.py check
```

## Screenshots

The README's pictures come from `uv run tools/pane_screens.py render`, which runs the mod's drawing under the pinned Claude Code and photographs it in Chromium. Run `uv run tools/pane_screens.py setup` first to fetch Chromium; on Linux, `setup --with-deps` also installs the libraries it needs. `.github/workflows/screens.yml` redraws them on every push to main that touches the drawing and commits any change, so pull before pushing again. The look the renderer gives the desktop app's elements lives in `tools/screens/pane.css`; what each colour and mark means is in [DESIGN.md](DESIGN.md).

## Releasing

After each green check on main, the release job in `check.yml` keeps a release pull request open from the commit messages: the next version and its changelog. Merging it is the release. It raises `version` in `.claude-plugin/plugin.json`, which is what makes Claude Code offer the update, and the release job tags it (`v0.3.0`) and publishes it on GitHub. A `feat:` raises the minor number and a `fix:` the patch; other kinds wait for one of those. Checks run on the release pull request only once it is merged, as GitHub starts no workflow for a pull request its own token opened.

What users install is not this repository but the plugin's files alone. `release/files` lists exactly what ships: `.claude-plugin/plugin.json`, `hooks/` (the modules `hooks/hooks.json` loads, not the generated types, which only type-checking reads), `types/index.d.ts`, `LICENSE` and `README.md`. `tools/release_tree.py` copies those into a tree and fails if a module the plugin loads imports a path outside it, a listed file is not loaded, or the README links to a relative path. When you add a file the plugin loads at run time, add it to `release/files`; `uv run tools/release_tree.py check` and CI say so if you forget.

- **In a pull request,** `check.yml` builds the tree, runs `claude plugin validate --strict` on it and on both marketplace files, and runs that closure check, so a broken tree fails before a release.
- **At a release,** the `publish` job (the only one that can write to the repository, besides release-please's own tag) builds the tree from the release's tag and commits it to the `release` branch with a tag `plugin-v0.3.0`. Each version is one commit on top of the last and the branch is never force-pushed, so every released tree stays reachable. Re-running a failed `publish` job publishes the same release again.
- **Installing** reads `.claude-plugin/marketplace.json` on main, which points the plugin at the `release` branch, so users get the newest release. The tree also holds a marketplace file of its own (`release/marketplace.json`), so a team can pin a version by using the repository with `"ref": "plugin-v0.3.0"` as its marketplace source (see the README); `claude plugin update` sees a new `version` there as usual.
