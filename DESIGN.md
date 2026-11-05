# Design language

This file describes the current implementation. For the intended experience and redesign decisions, read [PRODUCT_BRIEF.md](PRODUCT_BRIEF.md) first. Its attention model supersedes conflicting design assumptions below; this document does not imply that the redesign has been implemented.

What each colour, border and mark in the pane means. Each rule names the code that holds it, so a change there is a change here.

## Principles

- **What needs you comes first.** Rows sort by what you can act on now: something failing or blocked, then running, then waiting on others, then ready (`rank` in `hooks/attention.ts`).
- **Colour means the same thing everywhere.** One small palette serves pipeline stages, card borders and reviewer rings.
- **Words beat icons for what blocks a merge.** The worst blocker is said in words on the card's second line; other markers only trail it.
- **Small enough to draw.** The desktop app draws nothing for a tree past 100,000 characters. So rows you opened come first, then the other rows, then hover cards, then avatars (`DRAWING_BUDGET` in `hooks/drawing.ts`). Rows that do not fit are counted, not silently dropped.
- **Bots show only when they hold the merge,** by an open thread or a request for changes. Then a bot gets a face like anyone's; otherwise its summary comments stay out of the way.

## Colour

The palette is `STAGE_COLOURS` in `hooks/status.ts`, the same in light and dark.

| Tone | Colour | Means |
|---|---|---|
| success | `#2da44e` green | passed, approved |
| error | `#cf222e` red | failed, changes requested, conflicts |
| warning | `#bf8700` amber | waiting on a manual job, open threads, new inbox activity, a withdrawn approval |
| suggestion | `#0969da` blue | running, reviewed |
| subtle | `#8c959f` grey | skipped, canceled, not started, waiting on a review |

Hovering a card that opens turns its border the theme's `claude` colour.

## MR cards

- **Border colour is the review** (`reviewTone`): red while someone asked for changes or the MR cannot merge as it is (conflicts, a failed pipeline), green once approved, grey while it waits.
- **Border weight is whether it needs you**: bold at rank 0, round otherwise.
- **Line 1** is the title, `▸` while closed and `▾` while open, and the time since the last update. An open card ends with `▴ less` and `read whole ›`, which gives the MR a page of its own.
- **Line 2** is the card's links, the pipeline's stage strip and run time against how long that repo's pipelines usually take, GitLab's merge verdict in words with any other blockers trailing it dimly, then the people. Passed stages fold into one run, counted in its tooltip.

## Merge checks

The words of a row's blockers are GitLab's own `mergeabilityChecks` (`hooks/attention.ts`), named by their identifier (`CI_MUST_PASS` reads `CI must pass`), so a check GitLab adds needs no change here.

| Where | Says |
|---|---|
| Verdict | the first check that fails, in GitLab's order (the one `detailedMergeStatus` reports), in the check's tone |
| Verdict | the first check still being made, with `(checking)`, grey, when none fails |
| Verdict | `✓ mergeable`, green, when none fails or is being made |
| Trailing, dim | each other failing check in its tone, then each warning in amber |
| Nothing | a check that passed or the project turned off |

A failing check's tone is what it asks of you (`CHECK_TONE` in `hooks/attention.ts`, typed over GitLab's identifiers, so a new check cannot be added without one): red to fix (`CONFLICT`, `REQUESTED_CHANGES`, `CI_MUST_PASS`, `COMMITS_STATUS`, the lock and security checks), amber for a smaller fix (`NEED_REBASE`, `DISCUSSIONS_NOT_RESOLVED`, `TITLE_REGEX`, `JIRA_ASSOCIATION_MISSING`), grey for waiting on others or on time (`NOT_APPROVED`, `DRAFT_STATUS`, `MERGE_TIME`, `MERGE_REQUEST_BLOCKED`, `STATUS_CHECKS_MUST_PASS`). `NOT_APPROVED` says `needs 2 approvals` where the pane knows the count.

The pane keeps its own marker only for what the checks do not say: failed, amber and manual jobs (with the stage strip and the run time), who asked for changes, threads, approvals and bots (the people). A marker that gives the detail of a check (the failed jobs for `CI_MUST_PASS`, the approvals count for `NOT_APPROVED`) stands in its place. A GitLab without `mergeabilityChecks` gets the pane's own `⇄ conflicts` and `↻ needs rebase` instead, and no verdict.

## Pipeline marks

`statusMark` in `hooks/status.ts`:

| Mark | Status |
|---|---|
| ✓ | passed |
| ✗ | failed |
| ● | running, queued, scheduled |
| ⏸ | waiting on a manual job |
| ⊘ | skipped, canceled |
| ○ | no pipeline |
| ? | a status GitLab sent that the pane has no name for |

A failed job is ✗ and a job allowed to fail is ⚠, each with its run time.

## People

A person is their GitLab avatar or, without one, their initials on a disc coloured by name; a bot is its own picture or a robot. The ring takes the palette's tones: red for changes requested, amber for open threads, green for approved, grey otherwise. It is heavy once they have a say and thin while they have none. A ✓ or ✕ badge in the corner marks an approval or a request for changes (`REVIEW_MARK` in `hooks/faces.tsx`). Where the surface draws no images, as in the terminal, the person is a coloured `●`, or the badge's own glyph.

## Links

Every link says what it opens before its words (`LINK` in `hooks/drawing.ts`).

| Mark | Opens |
|---|---|
| 🔀 | the MR |
| 🎫 | the Jira ticket |
| 📁 | the repo |
| 🚦 | the pipeline |
| 💬 | the comment |

## Inbox

Each card counts what happened since you last marked it seen, in the order it matters to the merge (`VERB` in `hooks/inbox-pane.tsx`): ✗ requested changes, ↺ withdrew approval, ✓ approved, ● reviewed, 💬 commented, ? asked for a review, ↑ pushed, + opened, ◆ merged. A card with news has an amber border and says `N new`; one without is grey.

## Text

Secondary facts (branches, diff size, who, when, the footer) are dim. Problems in the footer are amber, never red: red is kept for what blocks a merge.
