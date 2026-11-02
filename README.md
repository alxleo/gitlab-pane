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

From GitHub, in a shell:

```bash
claude plugin install gitlab-ci --marketplace alxleo/gitlab-pane
```

The repository is private, so git on your machine needs a credential for github.com that works without a prompt; Claude Code checks for updates in the background, where it cannot ask. If you use the GitHub CLI, this sets git up to use its sign-in:

```bash
gh auth setup-git
```

For a whole team, add the marketplace to a project's `.claude/settings.json`; anyone who opens that project and trusts the folder gets the pane, with nothing to run:

```json
{
  "extraKnownMarketplaces": {
    "gitlab-pane": { "source": { "source": "github", "repo": "alxleo/gitlab-pane" } }
  },
  "enabledPlugins": { "gitlab-ci@gitlab-pane": true }
}
```

That follows main: each update installs whatever main holds, and the plugin runs with your own GitLab and Jira sign-ins, so trust whoever can push to this repository as you would trust them with those. To take released versions only, add `"ref": "v0.2.0"` beside `"repo"` and raise it when you choose to update.

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

## What it runs on your machine

The pane changes nothing on GitLab or Jira, and needs no token of its own: `glab`, `acli` and `mr-inbox` use the sign-ins you already have. `glab`, `acli` and `mr-inbox` run through a zsh login shell (`zsh -lc`), so they are found wherever your own shell finds them, and your shell's start-up files run each time; it needs macOS, or another system with zsh at `/bin/zsh`.

| Runs | How often | For | Writes |
|---|---|---|---|
| `glab api graphql` | every minute while a watched pipeline runs, every 3 min otherwise, slower after errors | your MRs, pipelines, reviewers and comments, as you, on gitlab.com | nothing: queries only |
| `curl`, through `/bin/sh` | once per new face | avatars, at the addresses GitLab gives (gitlab.com or Gravatar), https only | nothing; the pictures are kept in the plugin's own store |
| `acli jira workitem search` | every 15 min, when a Jira site is set | ticket type, status and summary | nothing |
| `mr-inbox` | every minute, when installed | the inbox | its own cache, and what you mark seen |

What reaches Claude, and so the model provider, from GitLab:

- **Wakes.** When an MR opened from a session fails its pipeline or can merge, the pane sends that session a message saying so, with the names of the failed jobs. Job names come from the repo's CI configuration, so treat them as text from that repo, not instructions. The pane's `wake Claude` switch turns this off.
- **`/mrs`** puts the MRs' descriptions and other people's comments into the conversation, and **`watch_mr`** answers with an MR's pipeline and what blocks it.
- **Bash commands.** The pane reads each Bash command a session runs, and the output of `glab mr create`, to pin the MR it opens. Nothing is sent anywhere for this.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) covers setting up a clone, the checks every commit passes, and how releases are made.
