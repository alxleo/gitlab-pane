# gitlab-pane

A Claude Code mod (`gitlab-ci`) that draws a GitLab pane beside your sessions. It shows your open merge requests: each pipeline's stages and run time against the repo's usual, what blocks the merge, and a face for each reviewer or commenter that opens their comments on a click. A second tab, Inbox, lists reviews and comments from `mr-inbox`.

MRs pinned to a session sit on top: the ones Claude pins with `watch_mr` and the ones opened from the session with `glab mr create`. An MR opened from the session also wakes it when its pipeline fails or it can merge.

[DESIGN.md](https://github.com/alxleo/gitlab-pane/blob/main/DESIGN.md) says what each colour, border, mark and link icon means.

<p>
  <img src="https://raw.githubusercontent.com/alxleo/gitlab-pane/main/docs/screens/mine.png" alt="The Mine tab: five MR cards, bordered by their review, with stage strips, run times and reviewers' faces" width="420">
  <img src="https://raw.githubusercontent.com/alxleo/gitlab-pane/main/docs/screens/inbox.png" alt="The Inbox tab: MR cards counting new reviews and comments since last seen" width="420">
</p>

An opened card shows the description, failed jobs and open threads, and `read whole ›` gives the MR a page of its own:

<p>
  <img src="https://raw.githubusercontent.com/alxleo/gitlab-pane/main/docs/screens/mine-open.png" alt="An opened MR card with its description and a review comment" width="420">
  <img src="https://raw.githubusercontent.com/alxleo/gitlab-pane/main/docs/screens/reading.png" alt="One MR read as a page of its own" width="420">
</p>

The screenshots use made-up data.

Needs a GitLab token for each host (see Settings), which can be the one `glab` holds. Works on gitlab.com, self-managed and Dedicated GitLab, several at once, and where `glab` is not installed. Optional: `mr-inbox` on the PATH for the inbox, and Atlassian's [`acli`](https://developer.atlassian.com/cloud/acli/guides/install-acli/), signed in with `acli jira auth login`, for ticket details once a Jira site is set.

## Install

From GitHub, in a shell:

```bash
claude plugin install gitlab-ci --marketplace alxleo/gitlab-pane
```

For a whole team, add the marketplace to a project's `.claude/settings.json`. Anyone who opens that project and trusts the folder gets the pane, with nothing to run:

```json
{
  "extraKnownMarketplaces": {
    "gitlab-pane": { "source": { "source": "github", "repo": "alxleo/gitlab-pane" } }
  },
  "enabledPlugins": { "gitlab-ci@gitlab-pane": true }
}
```

That follows main: each update installs whatever main holds, and the plugin runs with your own GitLab and Jira sign-ins, so trust whoever can push to this repository as you would trust them with those. To stay on one released version until you choose to move, add `"ref": "v0.2.1"` beside `"repo"` (a release's tag; the releases are listed [here](https://github.com/alxleo/gitlab-pane/releases)) and raise it when you update. That installs the whole repository at that tag. From the first plugin release, `"ref": "plugin-v<version>"` pins the same way and installs only the plugin's files, not this repository's tools and tests.

To run from a clone instead, see [CONTRIBUTING.md](https://github.com/alxleo/gitlab-pane/blob/main/CONTRIBUTING.md#set-up-a-clone).

`/gitlab` opens the pane. `/mrs repo!123 …` or `/mrs --rule <name>` puts those MRs, threads and all, into the conversation.

## Updating

A new release reaches you when you ask for it:

```bash
claude plugin update gitlab-ci@gitlab-pane
```

Claude Code installs a new copy only when the plugin's version has changed. To get releases without asking, open `/plugin`, go to **Marketplaces**, select `gitlab-pane` and choose **Enable auto-update**; it is off by default. A running session keeps the copy it loaded until `/reload-plugins` or the next launch.

## Settings

| Setting | What it does |
|---|---|
| `gitlabHosts` | The GitLab hosts to read, default `gitlab.com`; add self-managed ones such as `git.example.com`. The first is home: its projects show without the host. Merge request addresses on any of them can be pinned. |
| `gitlabTokens` | Sensitive; the last place a token is looked for, as `host=token` entries (a bare token is for the first host). It needs the `read_api` scope. |
| `jiraUrl` | Your Jira address, such as `https://example.atlassian.net`. Ticket keys in MR titles link there, and their details are read with `acli`. Empty leaves Jira out: keys show as plain text. |

Set it with `/plugin configure gitlab-ci` in a terminal session, or:

```bash
echo '{"jiraUrl":"https://example.atlassian.net"}' | claude plugin configure gitlab-ci@gitlab-pane --values-stdin
```

## What it runs on your machine

The pane changes nothing on GitLab or Jira. A host's token is the first of: `GITLAB_TOKEN` (or `GITLAB_ACCESS_TOKEN`, `OAUTH_TOKEN`; for `GITLAB_HOST` if set, else the first host), the one `glab` holds for that host (asked once per host per session, kept in memory only), the `gitlabTokens` setting. With none, the pane says which host has no token. A token is never logged or shown. `acli` and `mr-inbox` use the sign-ins you already have; they run through a login shell, so they are found wherever your own shell finds them and your shell's start-up files run each time: your `$SHELL` when it is bash, zsh or fish and exists, else `/bin/zsh` where there is one, else `/bin/sh`.

| Runs | How often | For | Writes |
|---|---|---|---|
| HTTPS POST to `https://<host>/api/graphql` for each configured host, **from one session only**: the one that leads (below) | every 30 s while a pinned pipeline runs, every minute otherwise, slower after errors; each poll asks only for MRs changed since the last (a small query, and one for the merge checks), an MR whose pipeline runs is read on its own, and the whole list is read every 5 min; a session that draws no pane but opened an MR reads that MR alone every 5 min | your MRs and the ones you pin: pipelines, reviewers, comments, how long each repo's pipelines usually take, and why a failed job of an MR opened from a session failed; as you; a host that lacks a newer field answers an error once and is asked without it from then on; an MR you open in the pane is read once more for its description and threads | the plugin's own store: what the leader read (a small copy of each MR), each session's pins, and which session leads |
| HTTPS GET of `https://<host>/api/v4/projects/<project>/jobs/<job>/trace` | once per failed job of an MR opened from a session, when its pipeline fails and the `failureLogs` setting is on; by the leading session only, which shares the result | the end of that job's log, for the wake | nothing |
| `glab config get token --host <host>` | once per host per session, when no environment token applies | the token `glab` holds | nothing |
| `curl`, through `/bin/sh` | once per new face | avatars, at the addresses GitLab gives (a configured host or Gravatar), https only, no token sent; the engine's HTTP returns text, not bytes | nothing; the pictures are kept in the plugin's own store |
| `acli jira workitem search` | every 15 min, when a Jira site is set | ticket type, status and summary | nothing |
| `mr-inbox` | every minute, when installed | the inbox | its own cache, and what you mark seen |

**Several sessions.** Every session that draws the pane takes part in an election through the plugin's store (a file all your Claude sessions share): the one that wins reads GitLab for all of them and writes a snapshot, and the others draw the snapshot and ask GitLab for nothing but the MR you open. When the leader closes its pane another takes over within a few seconds. Each session still decides its own wakes, from the snapshot and the MRs it opened itself.

What reaches Claude, and so the model provider, from GitLab:

- **Wakes.** When an MR opened from a session fails its pipeline or can merge, the pane sends that session a message saying so, with the names of the failed jobs and GitLab's one-line reason for each (`script failure`). Job names come from the repo's CI configuration, so treat them as text from that repo, not instructions. They are cut to one line of 80 characters with control and bidi characters removed before they reach the model. The pane's `wake Claude` switch turns this off.
- **Failed job logs.** With the `failureLogs` setting on (it is, by default), that wake also quotes the last lines of up to three failed jobs' logs: at most 20 lines and 2,000 characters each, with terminal escapes removed, every line one line of 200 characters at most, behind a `│ ` marker under a heading that says it is the job's output and not instructions. A log is whatever the repo's scripts print, so it is text from that repo like a job name. Turn the setting off to send neither the log nor the request for it.
- **`/mrs`** puts the MRs' descriptions and other people's comments into the conversation, and **`watch_mr`** answers with an MR's pipeline and what blocks it.
- **Bash commands.** The pane reads each Bash command a session runs, and the output of `glab mr create`, to pin the MR it opens. Nothing is sent anywhere for this.

## Contributing

[CONTRIBUTING.md](https://github.com/alxleo/gitlab-pane/blob/main/CONTRIBUTING.md) covers setting up a clone, the checks every commit passes, and how releases are made.
