# gitlab-pane

A Claude Code mod (`gitlab-ci`) that draws a GitLab pane beside your sessions: your open merge requests with each pipeline's stages and run time against how long that repo's pipelines usually take, what blocks the merge, and one icon per reviewer or commenter whose comments open on a click. MRs pinned to a session (by `watch_mr`, or opened from it with `glab mr create`) sit on top and wake the session when their pipeline fails or finishes. Below them, an inbox of reviews and comments from `mr-inbox`.

Bots' comments are never shown; what they hold the merge on is one 🤖 marker.

People show as their GitLab avatar, fetched once with `curl` and kept across sessions, wherever the pane has room after the hover cards. [DESIGN.md](DESIGN.md) is the pane's design language: what each colour, border, mark and link icon means.

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
