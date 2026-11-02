# Contributing

## Set up a clone

Add the clone as a local marketplace, so every session reads the mod from your folder and an edit needs only `/reload-plugins`:

```bash
claude plugin marketplace add path/to/gitlab-pane
```

```bash
claude plugin install gitlab-ci@gitlab-pane
```

Then turn on the checks that run before each commit, on its message, and before each push. [pre-commit](https://pre-commit.com) runs them; install it once with `uv tool install pre-commit` or `brew install pre-commit`, then, in the clone:

```bash
pre-commit install
```

The first commit afterwards takes a minute or two while pre-commit builds its tools; later ones take seconds.

## The checks

`.pre-commit-config.yaml` lists them, and CI runs the same list, so a commit that passes here passes there:

- **Secrets:** gitleaks reads each staged change before it is committed, and every commit in the history in CI.
- **Workflows:** actionlint catches mistakes in `.github/workflows/`, and zizmor catches unsafe ones: script injection, tokens with more access than a job needs, actions not pinned to a commit.
- **Files:** JSON and YAML parse, no private keys, no merge-conflict markers, no large files, files end in a newline.
- **The plugin:** `claude plugin validate --strict .` on each commit that touches it, and `claude plugin test .` before each push.
- **Commit messages:** each one says what it is, such as `feat: …`, `fix(jira): …` or `docs: …`, because releases are worked out from them. In a pull request the title follows the same rule, since a squash merge turns it into the commit on main.

To run them all by hand, as CI does:

```bash
pre-commit run --all-files --hook-stage manual
```

The type-check needs the types Claude Code writes into `.claude-plugin/types/` once it has loaded the mod from your clone in a signed-in session, so it runs only locally:

```bash
npx --package typescript tsc -p .
```

## CI

`.github/workflows/check.yml` runs the checks above and the tests in one job, for pull requests and for main. GitHub bills every job as at least a whole minute, so the checks stay in one job and other branches run nothing until they have a pull request. On main, a green check is followed by the release job below. The Claude Code version CI uses is pinned there, in `screens.yml`, and in `tools/pane_screens.py`; change all three together.

Merge pull requests with a squash, so the checked title becomes the commit on main.

Dependabot proposes newer versions of the pinned actions and hooks once a month, two weeks after each is released.

## Screenshots

The README's pictures come from `uv run tools/pane_screens.py render`, which runs the mod's drawing under the pinned Claude Code and photographs it in Chromium (`setup --with-deps` installs Chromium first). `.github/workflows/screens.yml` runs it on every push to main that touches the drawing and commits the new PNGs, so pull before pushing again. The look the renderer gives the desktop app's elements lives in `tools/screens/pane.css`; what each colour and mark means is in [DESIGN.md](DESIGN.md).

## Releasing

After each green check on main, the release job in `.github/workflows/check.yml` keeps a release pull request open from the commit messages: the next version and its changelog. Merging that pull request is the release. It raises `version` in `.claude-plugin/plugin.json`, which is what makes Claude Code offer the update, and the release job tags it and publishes it on GitHub. A `feat:` raises the minor number and a `fix:` the patch; other kinds wait for one of those. No checks run on the release pull request itself, as GitHub starts no workflow for one its own token opened; they run once it is merged.
