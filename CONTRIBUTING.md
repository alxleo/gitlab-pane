# Contributing

## Set up a clone

Add the clone as a local marketplace, so every session reads the mod from your folder and an edit needs only `/reload-plugins`:

```bash
claude plugin marketplace add path/to/gitlab-pane
```

```bash
claude plugin install gitlab-ci@gitlab-pane
```

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
- **Commit messages:** each one says what it is, such as `feat: …`, `fix(jira): …` or `docs: …`, because releases are worked out from them. A pull request's title follows the same rule; merge with a squash, so the title becomes the commit on main.

To run the checks by hand:

```bash
pre-commit run --all-files --hook-stage manual
```

That leaves out `claude plugin test .`, which CI runs as its own step, so run it too.

The type-check runs only locally, because it needs the types Claude Code writes into `.claude-plugin/types/` when a signed-in session has loaded the mod from your clone:

```bash
npx --package typescript tsc -p .
```

## CI

`.github/workflows/check.yml` runs the checks above and the tests as one job, for pull requests and for main. The Claude Code version CI uses is pinned there, in `screens.yml` and in `tools/pane_screens.py`; change all three together. Dependabot proposes newer pinned actions and hooks monthly.

`.github/workflows/canary.yml` runs every Monday, for what breaks the pane while this repository stands still. It validates the plugin and runs its tests on the newest Claude Code, installs the plugin from GitHub into an empty setup, and checks every query the pane sends against gitlab.com's live schema. A failure opens an issue, and the next green run closes it. When the newest Claude Code passes, it is safe to raise the pinned version. A pull request that changes the queries in `hooks/gitlab.ts` gets the schema check too; to run it yourself, with Node 24 or newer:

```bash
uv run tools/gitlab_schema.py check
```

## Screenshots

The README's pictures come from `uv run tools/pane_screens.py render`, which runs the mod's drawing under the pinned Claude Code and photographs it in Chromium. Run `uv run tools/pane_screens.py setup` first to fetch Chromium; on Linux, `setup --with-deps` also installs the libraries it needs. `.github/workflows/screens.yml` redraws them on every push to main that touches the drawing and commits any change, so pull before pushing again. The look the renderer gives the desktop app's elements lives in `tools/screens/pane.css`; what each colour and mark means is in [DESIGN.md](DESIGN.md).

## Releasing

After each green check on main, the release job in `check.yml` keeps a release pull request open from the commit messages: the next version and its changelog. Merging it is the release. It raises `version` in `.claude-plugin/plugin.json`, which is what makes Claude Code offer the update, and the release job tags it and publishes it on GitHub. A `feat:` raises the minor number and a `fix:` the patch; other kinds wait for one of those. Checks run on the release pull request only once it is merged, as GitHub starts no workflow for a pull request its own token opened.
