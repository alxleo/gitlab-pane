# Design language

This file describes the current implementation. For the intended experience and redesign decisions, read [PRODUCT_BRIEF.md](PRODUCT_BRIEF.md) first. Its attention model supersedes conflicting design assumptions below; this document does not imply that the redesign has been implemented.

What each colour, border and mark in the pane means, and the code that holds it. `npm run docs -- check` and `tests/docs.test.ts` fail when a table here and the code disagree.

## Principles

| Rule | Means | Code |
|---|---|---|
| What you can finish comes first | what GitLab says can merge, then failing or blocked, then running, then waiting on others, then passed | `byAttention`, `hooks/attention.ts` |
| Colour means the same everywhere | one palette for stages, card borders and reviewer rings | `STAGE_COLOURS`, `hooks/status.ts` |
| Words beat icons for what blocks a merge | the worst blocker is said in words on line 2; other markers trail it | `verdictOf`, `hooks/attention.ts` |
| Small enough to draw | the desktop draws nothing past 100,000 characters, so rows come first, most pressing first, then avatars; rows that do not fit are counted, not dropped | `DRAWING_BUDGET`, `hooks/drawing.ts` |
| Nothing waits for the pointer | no part of a card shows or hides on a hover, so nothing moves under it; the rest of an MR is on its page, a press away | `card.tsx` |
| Bots show only when they hold the merge | by an open thread or a request for changes; then a bot gets a face like anyone's; otherwise its summary comments stay out of the way | `toCard`, `hooks/gitlab.ts` |

## Colour

The same in light and dark. Hovering a card turns its border the theme's `claude` colour.

| Tone | Colour | Means |
|---|---|---|
| `success` | `#2da44e` green | passed, approved |
| `error` | `#cf222e` red | failed, changes requested, conflicts |
| `warning` | `#bf8700` amber | waiting on a manual job, open threads, new inbox activity, a withdrawn approval |
| `suggestion` | `#0969da` blue | running, reviewed |
| `subtle` | `#8c959f` grey | skipped, canceled, not started, waiting on a review |

## MR cards

| Part | Shows | Code |
|---|---|---|
| Border colour | the review: red while someone asked for changes or it cannot merge as it is (conflicts, a failed pipeline), green once approved, grey while it waits | `reviewTone` |
| Border weight | bold when it needs you (rank 0), round otherwise | `rank` |
| Line 1 | the title, which opens the MR as a page of its own (its ticket, what stands before a merge, description, failed jobs and threads), the time since the last update, and a star at the right: `☆` dim pins the MR here, `★` unpins it (none on an MR this session raised, so its wakes stay) | `card.tsx` |
| Line 2 | the move first (below), so it is in one place on every card, and on an MR GitLab says can merge, `📍` and the commit a merge takes; then links, the stage strip (passed stages fold into one run, counted in its tooltip), run time against the repo's usual, GitLab's merge verdict (unless the move says it) with other blockers trailing dimly, then the people, an approver's face badged ✓; a name opens the page on what that person wrote | `row-facts.ts` |
| Quiet row | one line, the title, GitLab's verdict and the age, for an MR whose pipeline passed, that waits on nothing but approvals, whose verdict is grey and that quotes no one; its links and faces are on its page. One GitLab says can merge is a decision, so never quiet | `isQuiet` |
| Line 3 | `💬` and the latest open thread a person wrote, never a bot, approved or not; it opens the page on them. No line when there is none | `saidOf` |

## An MR's page

A title opens the MR on a page of its own. Its open threads are a person's feedback, so each can be answered there briefly; a review stays on GitLab.

| On the page | Shows | Code |
|---|---|---|
| A thread on the diff | the last five lines of the diff it was left on, ending at the commented line, numbered as in the file; then the comment and its replies | `hunkOf`, `hooks/reply-model.ts` |
| `↩ reply` | dim, under each open thread a person started; it opens one reply box at a time, starting from what was last typed there. None on a phone (it may have no text field): the thread's `💬` opens it on GitLab. Where GitLab did not say where replies go, an amber `↩ Replies are off here` says why, until the next read gets it | `reading.tsx` |
| Confirming | Enter shows the text with `post as you`, `edit` and `cancel`: nothing is sent before `post as you`, which posts under your name. A reply past 5,000 characters stays in the box, which says in amber to post it on GitLab | `decideArm`, `decidePost` |
| Posted | the MR is read again at once, and the reply sits in the thread like any other | `ensureDetail` |
| Not posted | the text stays, with GitLab's reason in amber and `post again`, there when you come back to the page; a refusal says a `read_api` token is refused so. A dropped connection, a 5xx or a reload while it was out may have posted it: the MR is read again and the reason says to look first | `postedOf`, `sayOf` |

## The list

| Section | Holds | Code |
|---|---|---|
| Top row | the tabs and, on Mine, how old the cards are (the inbox says its own age on the row below); at the right, `↻` reads GitLab again, dim while a read is out, and `🔔` says a raised MR wakes Claude, `🔕` once pressed off. An MR read whole has its way back and its age there instead of the tabs | `pane.tsx` |
| Repo filter | on Mine, `📁` (the repo, as on a card's link) and one picker of `All` and each repo with how many MRs it holds, a single row however many repos there are; a phone, which may not draw a picker, has a button for each instead. None while every MR is in one repo. A pick whose repo has no MRs left, or that leaves one repo, shows them all and is forgotten at the next read, so the repo coming back does not narrow the list by itself. A session whose pane closes reads only the MRs it raised, so like its folds and open page, the pick goes then too | `keptRepo` |
| This session | the MRs this session raised, watched or you pinned, in the order they came | `buildPane` |
| `▸ N others` | while This session holds any, every other MR folds behind one line saying how many GitLab says can merge and how many have news in the inbox; a picked repo shows its MRs unfolded | `buildPane` |
| Ready | the open MRs, those GitLab says can merge first, then the most pressing, ten until `▸ more` | `MINE_SHOWN` |
| Parked | a ready MR untouched for a week, its pipeline included, with no news in the inbox; a comment, a push, a pipeline run or news brings it back | `PARKED_AFTER_MS` |
| Drafts | GitLab's drafts, folded | `buildPane` |
| Merged | last, folded, as `▸ N merged`: your own MRs merged in the last three days, five at most, as the inbox's read left them (not cards, so nothing that counts or orders the list sees them). A row is the MR's link, how long ago it merged, and the build GitLab ran on the commit that landed on its target branch. Only a failed build is said on the folded line (`▸ 3 merged · 1 build ✗`); open, the rows say it. No wake, no toast | `mergedModel`, `LANDED_WITHIN_MS`, `LANDED_SHOWN` |

## Merge checks

A blocker's words are GitLab's own `mergeabilityChecks`, named by identifier (`CI_MUST_PASS` reads `CI must pass`), so a check GitLab adds needs no change here.

| Where | Says |
|---|---|
| Verdict | the first check that fails, in GitLab's order (the one `detailedMergeStatus` reports), in that check's tone |
| Verdict | else the first check still being made, with `(checking)`, grey |
| Verdict | else `✓ mergeable`, green |
| Trailing, dim | each other failing check in its tone, then each warning in amber |
| Nothing | a check that passed or the project turned off |

A failing check's tone is what it asks of you (`CHECK_TONE` in `hooks/attention.ts`, typed over GitLab's identifiers; one it does not know is red):

| Tone | Asks | Checks |
|---|---|---|
| `error` | a fix | `CI_MUST_PASS`, `COMMITS_STATUS`, `CONFLICT`, `LOCKED_LFS_FILES`, `LOCKED_PATHS`, `REQUESTED_CHANGES`, `SECURITY_POLICY_PIPELINE_CHECK`, `SECURITY_POLICY_VIOLATIONS` |
| `warning` | a smaller fix | `DISCUSSIONS_NOT_RESOLVED`, `JIRA_ASSOCIATION_MISSING`, `NEED_REBASE`, `TITLE_REGEX` |
| `subtle` | waiting on others or on time | `DRAFT_STATUS`, `MERGE_REQUEST_BLOCKED`, `MERGE_TIME`, `NOT_APPROVED`, `NOT_OPEN`, `STATUS_CHECKS_MUST_PASS` |

- `NOT_APPROVED` says `needs 2 approvals` where the pane knows the count.
- The pane's own markers cover only what the checks do not say: failed, amber and manual jobs (with the strip and run time), who asked for changes, threads, approvals and bots. A marker that details a check (failed jobs for `CI_MUST_PASS`, the count for `NOT_APPROVED`) stands in its place.
- A GitLab without `mergeabilityChecks` gets the pane's own `⇄ conflicts` and `↻ needs rebase`, and no verdict.

## Moves

The one press that moves an MR along, where GitLab's checks name it and you may make it (`nextMove` in `hooks/next-move.ts`). It leads the card's second line, the same place on every card and across reads, so it is found by habit; the verdict is not said again when the move fixes the check it names, and the move's own check trails no more. Every other MR has none: waiting on people, on a pipeline or on a fix stays as it was.

| Move | Offered when | A press |
|---|---|---|
| `✓ merge` | GitLab says it can merge, and you may merge | arms it, `✓ merge !12? press again`, for 10 s; the second press merges the head the verdict was read on, through the merge train where the project has one |
| `↻ rebase` | `NEED_REBASE` fails with other checks, none of them a draft, a failed pipeline or a request for changes (which come first), and you may push | asks GitLab to rebase it |
| `↻ rebase and merge` | `NEED_REBASE` is the only check that fails, and you may push and merge | armed as a merge is, on the head shown; rebases it, then sets GitLab's own rebase of it to merge once its checks pass, never a push that came meanwhile |
| `⇄ hand conflicts to Claude` | `CONFLICT` fails, you may push, and this session works in the MR's repo | pins the MR to this session and asks Claude to resolve them in a subagent and push; comes before a rebase, which conflicts stop |

- A move is a button; armed, it is the primary one. Under way it is dim words with nothing to press: `✓ merging…`, `↻ rebasing…`, `✓ merges when checks pass` (GitLab's auto-merge, whoever set it, while what holds the MR is others or time; a check to fix keeps its words and its move) and `⇄ conflicts · with Claude`.
- A merge or rebase is sent once. One whose answer is lost may still have reached GitLab, so the pane follows it as one that went through, and GitLab's own state says how it ended.
- Merges, rebases and replies keep one record of what was confirmed, sent and how it ended (`hooks/writes.ts`; `hooks/write-model.ts` says what each entry means), so each says the same when an answer is lost, and none is sent twice. One sent by a session closed or reloaded mid-way is offered again with `no answer came back` in amber, since it may have gone through.
- What was pressed holds until the MR's head moves, so a push offers the move afresh, and a hand-off to Claude ends when its push lands.
- A press that did not take says why beside the move, amber, until it is pressed again; a toast says how each move ended.
- Merging and rebasing write to GitLab, so they need a token with the `api` scope; the pane reads with `read_api`.

## Pipeline marks

`statusMark` in `hooks/status.ts`. A failed job is ✗; a job allowed to fail is ⚠, amber; each with its run time. A merged MR's row marks the build of the commit that landed on its target branch the same way, ○ until GitLab has started one.

| Mark | Tone | Status |
|---|---|---|
| ✓ | `success` | `success` |
| ✗ | `error` | `failed` |
| ● | `suggestion` | `created`, `waiting_for_resource`, `preparing`, `waiting_for_callback`, `pending`, `running`, `canceling`, `scheduled` |
| ⏸ | `warning` | `manual` |
| ⊘ | `subtle` | `skipped`, `canceled` |
| ? | `subtle` | `unknown`: a status the pane has no name for |
| ○ | `subtle` | no pipeline |

## People

A person is their GitLab avatar or, without one, their initials on a disc coloured by name; a bot is its own picture or a robot.

- **Ring** (`personTone`): red for changes requested, else amber for open threads, else green for approved, else grey. Heavy once they have a say, thin while they have none.
- **Badge** in the corner (`REVIEW_MARK` in `hooks/face-model.ts`), below.
- **Without images** (the terminal): a coloured `●`, `◉` for the person whose comments are open, or the badge's glyph.

| Badge | Means |
|---|---|
| ✓ | approved |
| ✕ | requested changes |

## Links

Every link says what it opens before its words (`LINK` in `hooks/drawing.ts`).

| Mark | Opens |
|---|---|
| 🔀 | the MR |
| 🎫 | the Jira ticket |
| 📁 | the repo |
| 🚦 | the pipeline; on a merged MR's row, the build on its target branch |
| 💬 | the comment |
| 📍 | the commit a merge takes |

A ticket the pane moves in Jira (`jiraInReview`, `jiraOnMerge`; the rules are `hooks/jira-moves.ts`) gets no mark on its card: moving it is the pane's chore, not the person's. The move is a toast once, in the session that made it (the one that reads GitLab for the others), whose 🎫 line on the MR's page shows the new status at once; other sessions show it at their next read of Jira.

## Inbox

Each card counts what happened since you last marked it seen, in the order it matters to the merge (`VERB` in `hooks/inbox-pane.tsx`). The last two name no one.

| Mark | Event |
|---|---|
| ✗ | requested changes |
| ↺ | withdrew approval |
| ✓ | approved |
| ● | reviewed |
| 💬 | commented |
| @ | mentioned you |
| ? | asked for a review |
| ↑ | pushed |
| ◆ | merged |
| ✗ | pipeline failed |
| ⚠ | can't merge |

The tabs are the rules of `hooks/inbox-rules.ts`; `/mrs --rule` takes a tab's name or title.

| Tab | Name | Lists |
|---|---|---|
| Review requested | `review-requested` | others' MRs you were asked to review: requests and pushes; stays, grey, until you approve |
| Mentions | `mentions` | MRs where you were mentioned |
| Build failed | `build-failed` | failed-build to-dos |
| Can't merge | `cant-merge` | can't-merge to-dos |
| On my MRs | `on-my-mrs` | changes requested, approvals and their withdrawal, reviews, comments, pushes and merges on yours |
| Following | `following` | the same on MRs of the people and projects `inboxFollow` names |

- A card with news has an amber border and says `N new`; one without is grey.
- An MR can show under several tabs; the Inbox tab's count counts it once.
- The band above the prompt says the Inbox tab's words in amber, `Inbox · N new`, only while there is news and the tabs are out of sight: the pane closed or undrawn, or an MR's page in their place. It never repeats the tab beside it, gives way to a survey, and opens the Inbox tab when pressed (`inboxBand`, `hooks/pane-model.ts`).
- `N+ new` is a lower bound: GitLab sent only the latest 30 notes, and the mark is older than the oldest.
- ✓ marks seen on this machine only; GitLab is not told. `● here` narrows every tab to the session's project.
- In the terminal, while the inbox is taller than the pane, ↑ and ↓ move the focus ring a card at a time, onto its title (its ✓ when it has nothing to open), and Enter opens it; past the first or last card drawn they scroll again, and from the footer ↑ comes back to the last card drawn (`hooks/inbox-ring.ts`). ✓ on the card holding the ring hands the ring to the next. `s` presses `✓ mark all seen (s)`. The engine draws the ring, so moving it draws nothing again; while the inbox fits, the engine's arrows walk every button instead.
- An empty tab says why when it can: no token for a host, no repo for `here`, nobody followed.

## Text

Secondary facts (branches, diff size, who, when, the footer) are dim. Problems in the footer are amber, never red: red is kept for what blocks a merge.
