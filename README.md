# gitlab-pane

A Claude Code mod (`gitlab-ci`) that draws a GitLab pane beside your sessions: your open merge requests with each pipeline's stages and run time against how long that repo's pipelines usually take, what blocks the merge, and one icon per reviewer or commenter whose comments open on a click. MRs pinned to a session (by `watch_mr`, or opened from it with `glab mr create`) sit on top and wake the session when their pipeline fails or finishes. Below them, an inbox of reviews and comments from `mr-inbox`.

Bots' comments are never shown; what they hold the merge on is one 🤖 marker.

People show as their GitLab avatar, fetched once with `curl` and kept across sessions, wherever the pane has room after the hover cards. [DESIGN.md](DESIGN.md) is the pane's design language: what each colour, border, mark and link icon means.

<p>
  <img src="docs/screens/mine.png" alt="The Mine tab: five MR cards, bordered by their review, with stage strips, run times and reviewers' faces" width="420">
  <img src="docs/screens/inbox.png" alt="The Inbox tab: MR cards counting new reviews and comments since last seen" width="420">
</p>

An opened card shows the description and comments, and `read whole ›` gives the MR a page of its own:

<p>
  <img src="docs/screens/mine-open.png" alt="An opened MR card with its description and a review comment" width="420">
  <img src="docs/screens/reading.png" alt="One MR read as a page of its own" width="420">
</p>

The screenshots are drawn from the mod's own desktop drawing with made-up data, and CI draws them again whenever the drawing changes.

Needs `glab` signed in to gitlab.com. Optional: `mr-inbox` on the PATH for the inbox, and Atlassian's [`acli`](https://developer.atlassian.com/cloud/acli/guides/install-acli/), signed in with `acli jira auth login`, for ticket details once a Jira site is set.

## Install

From GitHub, in a shell (the repository is private, so your machine needs a git credential for github.com):

```bash
claude plugin install gitlab-ci --marketplace alxleo/gitlab-pane
```

From a clone, so every session reads the mod from that folder and an edit there needs only `/reload-plugins`:

```bash
claude plugin marketplace add path/to/gitlab-pane
```

```bash
claude plugin install gitlab-ci@gitlab-pane
```

`/gitlab` opens the pane; `/mrs` shows the inbox in a session.

## Updating

A new release reaches you when you ask for it:

```bash
claude plugin update gitlab-ci@gitlab-pane
```

Claude Code installs a new copy only when the plugin's version has changed. To get releases without asking, open `/plugin`, go to **Marketplaces**, select `gitlab-pane` and choose **Enable auto-update**; it is off by default. A running session keeps the copy it loaded until `/reload-plugins` or the next launch. A clone added as a local marketplace reads its files at every session start, whatever the version.

## Settings

| Setting | What it does |
|---|---|
| `jiraUrl` | Your Jira address, such as `https://example.atlassian.net`. Ticket keys in MR titles link there, and their details are read with `acli`. Empty leaves Jira out: keys show as plain text. |

Set it with `/plugin configure gitlab-ci` in a terminal session, or:

```bash
echo '{"jiraUrl":"https://example.atlassian.net"}' | claude plugin configure gitlab-ci@gitlab-pane --values-stdin
```

## Develop

```bash
claude plugin test .
```

```bash
claude plugin validate .
```

CI runs both on every push, at the Claude Code version pinned in `.github/workflows/check.yml`. The type-check needs the types the engine writes once it has loaded the mod in a signed-in session (`.claude-plugin/types/`), so it runs locally: `npx --package typescript tsc -p .`.

The screenshots come from `uv run tools/pane_screens.py render`, which runs the mod's drawing under the pinned Claude Code and photographs it in Chromium (`setup --with-deps` installs Chromium first). `.github/workflows/screens.yml` runs it on every push to main that touches the drawing and commits the new PNGs, so pull before pushing again. The look the renderer gives the desktop app's elements lives in `tools/screens/pane.css`.

## Releasing

Commit messages say what each change is (`feat:`, `fix:`, `docs:` and so on), and `.github/workflows/release.yml` keeps a release pull request open from them: the next version and its changelog. Merging that pull request is the release. It raises `version` in `.claude-plugin/plugin.json`, which is what makes Claude Code offer the update, and the workflow tags it and publishes it on GitHub. A `feat:` raises the minor number and a `fix:` the patch; other kinds wait for one of those. No checks run on the release pull request itself, as GitHub starts no workflow for one its own token opened; they run once it is merged.
