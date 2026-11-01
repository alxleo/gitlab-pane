# Design language

How the pane looks, and why. The code is the source of truth: each rule names where it lives, so a change there is a change here.

## Principles

- **What needs you comes first, and looks heavier.** Rows sort by what you can act on now: something failing or blocked, then running, then waiting on others, then ready (`rank` in `hooks/ci.ts`). An MR that needs you has a bold border; everything else a round one.
- **Colour means the same thing everywhere.** One small palette, used for pipeline stages, card borders and reviewer badges alike.
- **Words beat icons for what blocks a merge.** The worst blocker is said in words on the card's second line; markers only trail it.
- **Small enough to draw.** The desktop app draws nothing for a tree past 100,000 characters, so rows come first, then open detail, then hover cards, then avatars (`DRAWING_BUDGET` in `hooks/ci.ts`). What does not fit is counted, never silently dropped.
- **Bots are people, quietly.** A bot gets a face like anyone else's, but its comments are never shown; what it holds the merge on is one 🤖 marker.

## Colour

The palette is `STAGE_COLOURS` in `hooks/ci.ts`. It is brighter than the theme's own tones, so it reads in both light and dark.

| Tone | Colour | Means |
|---|---|---|
| success | `#2da44e` green | passed, approved |
| error | `#cf222e` red | failed, changes requested, conflicts |
| warning | `#bf8700` amber | waiting on a manual job, new inbox activity, a withdrawn approval |
| suggestion | `#0969da` blue | running, reviewed |
| subtle | `#8c959f` grey | skipped, canceled, not started, waiting on a review |

Hovering anything that opens turns its border the theme's `claude` colour.

## MR cards

- **Border colour is the review** (`reviewTone`): red while someone asked for changes or the MR cannot merge as it is (conflicts, a failed pipeline), green once approved, grey while it waits.
- **Border weight is whether it needs you**: bold for rank 0, round otherwise.
- **Line 1** is the title, opened with `▸` and closed with `▾`, and `read whole ›`, which opens the MR as a page of its own.
- **Line 2** is the card's links, the pipeline's stage strip and run time against how long that repo's pipelines usually take, then GitLab's merge verdict in words, with any other blockers trailing it dimly. Passed stages fold into one run, counted in its title.
- Your own MRs leave your name out.

## Pipeline marks

`statusMark` in `hooks/ci.ts`:

| Mark | Status |
|---|---|
| ✓ | passed |
| ✗ | failed |
| ● | running, queued, scheduled |
| ⏸ | waiting on a manual job |
| ⊘ | skipped, canceled |
| ○ | no pipeline |

A failed job is ✗ and a job allowed to fail is ⚠, each with its run time.

## People

A person is their GitLab avatar or, if they have none, their initials on a disc coloured by name; a bot is its own picture or a robot. The ring is the review: heavy once they have a say, thin while they have none. A ✓ or ✕ badge in the corner marks an approval or a request for changes (`REVIEW_MARK` in `hooks/pane.tsx`). Where the surface draws no images, as in the terminal, the person is a coloured `●`, or the badge's own glyph.

## Links

Every link says what it opens before its words (`LINK` in `hooks/ci.ts`). An emoji costs two characters of the drawing; a logo would cost hundreds.

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
