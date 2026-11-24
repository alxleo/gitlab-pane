# Design language

This file describes the current implementation. For the intended experience and redesign decisions, read [PRODUCT_BRIEF.md](PRODUCT_BRIEF.md) first. Its attention model supersedes conflicting design assumptions below; this document does not imply that the redesign has been implemented.

What each colour, border and mark in the pane means, and the code that holds it. `npm run docs -- check` and `tests/docs.test.ts` fail when a table here and the code disagree.

## Principles

| Rule | Means | Code |
|---|---|---|
| What you can finish comes first | what GitLab says can merge, then failing or blocked, then running, then waiting on others, then passed | `byAttention`, `hooks/attention.ts` |
| Never colour alone | a colour always rides with a glyph or words that say the same; one meaning keeps one colour in either theme, and cards draw no border | `TONE_COLOURS`, `hooks/status.ts` |
| Words beat icons for what blocks a merge | the worst blocker is said in words on line 2; other markers trail it | `verdictOf`, `hooks/attention.ts` |
| Small enough to draw | the desktop draws nothing past 100,000 characters, so rows come first, most pressing first, then avatars; rows that do not fit are counted, not dropped | `DRAWING_BUDGET`, `hooks/drawing.ts` |
| A symbol says what it means once the pointer rests | resting the pointer on any symbol shows a short description in the blank line under its card after 0.6 s, never as the pointer passes; it is out of the flow, so nothing moves under the pointer and no other part of a card shows or hides; the symbol stands alone, and the rest of an MR is on its page, a press away | `hinted`, `hooks/hint.tsx`; `waitStep`, `HINT_DELAY_MS` |
| Bots show only when they hold the merge | by an open thread or a request for changes; then a bot gets a face like anyone's; otherwise its summary comments stay out of the way | `toCard`, `hooks/mr-card.ts` |

## Colour

Each tone is a key of the app's theme, so it follows the desktop app's light or dark setting as it switches; the faces and the stage strip follow it too, as shots of the app set opposite to macOS showed. Text names the key and the app paints it. The description a symbol shows under the pointer is text too, the theme's text colour behind its inverse. A picture (a face's badge, the stage strip) cannot name a key, so it carries both shades below (`tonePaint`, `themePaint`) and the app's theme picks one; a custom theme recolours the text, never these. A border cannot carry two shades (the app draws one so given in black), which is one reason cards draw none.

Fading is not a tone: a face drawn faded is someone suggested as a reviewer, and nothing else in the pane fades a face (People, below). Its dark veil borrows the dim grey's shade without meaning what `subtle` means.

The dark shades are the app's own dark keys, sampled from shots of it. The light ones are vivid fill shades: the app paints its light keys in dark text shades (`#016d11`, `#a42628`, `#895903`, `#1757ac`, `#666666`), which turn muddy on a small mark beside an avatar. The screen renderer's `pane.css` paints text in the app's keys and its pane in `PAGE` (`tools/pane_screens.spec.ts`).

| Tone | Light | Dark | Means |
|---|---|---|---|
| `success` | `#1f883d` green | `#53c656` green | passed, approved |
| `error` | `#cf222e` red | `#fa8181` red | failed, changes requested, conflicts |
| `warning` | `#bf8700` amber | `#e59c08` amber | waiting on a manual job, open threads, new inbox activity, a withdrawn approval |
| `suggestion` | `#0969da` blue | `#6aacf1` blue | running, reviewed |
| `subtle` | `#6e7781` grey | `#9c9c9c` grey | skipped, canceled, not started, waiting on a review, looked without a verdict |

## MR cards

| Part | Shows | Code |
|---|---|---|
| Line 1 | the title, which opens the MR as a page of its own (its ticket, what stands before a merge, description, failed jobs and threads), the time since the last update, and a star at the right: `☆` dim pins the MR here, `★` unpins it (none on an MR this session raised, so its wakes stay) | `card.tsx` |
| Line 2 | the move first (below), so it is in one place on every card, and on an MR GitLab says can merge, `📍` and the commit a merge takes; then links, the stage strip (passed stages fold into one run, counted in its description), run time against the repo's usual, GitLab's merge verdict (unless the move says it) with other blockers trailing dimly, then the people, each face badged for where they stand; a name opens what that person says under the card (below); last, faded, whom GitLab suggests as a reviewer (People, below) | `row-facts.ts` |
| Under the card | one thing a card, opened by a press and closed by the same press or `✕`; a press on another name or the ticket of the same card puts that in its place. Other cards keep theirs open, as the Inbox's cards do, so up to five open a press closes nothing and the list stays where it is. Each is a whole MR or ticket read and kept, so a sixth closes the first opened, which moves the cards below it up. A name: where they stand, their newest comment cut to a glance once the MR is read whole (the shared card keeps one note a person, not always their newest, so none is quoted before), and `all N comments ›` (`read it whole ›` for one) to the MR's page on them. A ticket: its type, status and summary at once, then its assignee and the start of its description, read from Jira when it is opened and again once a quarter hour old, or at once after a read of it that failed; a ticket Jira answers without says so, and one whose read failed says so in its own panel alone, and `🎫 open in Jira` leaves for Jira | `personUnder`, `ticketUnder` |
| Quiet row | one line, the title, GitLab's verdict and the age, for an MR whose pipeline passed, that waits on nothing but approvals, whose verdict is grey and that quotes no one; its links and faces are on its page. One GitLab says can merge is a decision, and one with a reviewer to suggest is the author's to act on, so neither is quiet | `isQuiet` |
| Line 3 | `💬` and the latest open thread a person wrote, never a bot, approved or not; it opens what they say under the card. No line when there is none | `saidOf` |

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
| Search | on Mine, first, `🔍` and a box: Enter looks for an MR's number (`!512` that number alone, `512` it first), its address or reference pasted (`group/repo!512`, the repo whole or its last parts), a ticket however spelled (`ABC-123`, `abc123`) or words of a title, repo, author or an open MR's branch, any part of them, case, accents and punctuation aside. Every word must match. It looks through every MR the pane holds, past the repo picked and every fold, and lists `Found · N`, all it found counted, in place of the list: open MRs as their cards, best first, then `Merged`, the five that match best of the merged MRs the pane holds (each host's newest five of the last three days), as the merged section's rows, then `Inbox`, others' MRs as a link each, five at most. Matches past the five are counted on a line of their own. The list follows the typing once it pauses a quarter second, and Enter at once; `✕` ends the search and draws a new box, empty. The box is drawn holding what Enter or `✕` left, never what is being typed, as the desktop keeps what is typed through a redraw only while the box is drawn holding the same text; leaving for a page or the inbox, or closing the pane, draws it again holding what the list is searched for. A search is kept without control characters, which a drawing refuses. GitLab is not asked. A phone, which may have no text field, has no box | `queryOf`, `matchesOf` |
| Filtered | `⧩ filtered`, dim, beside the search box while a search narrows the list (text that names nothing to look for, `!` or spaces alone, does not), and beside the repo picker while a repo is picked, so a list that is not whole says so where it was narrowed. Nothing is written into the box while it may be typed in, so a pane closed mid-search opens again with the box holding what the list is searched for; another surface of the same session keeps its box as drawn, and its list says `⧩ filtered` | `FILTERED` |
| Repo filter | on Mine, `📁` (the repo, as on a card's link) and one picker of `All` and each repo with how many MRs it holds, a single row however many repos there are; a phone, which may not draw a picker, has a button for each instead. None while every MR is in one repo. A pick whose repo has no MRs left, or that leaves one repo, shows them all and is forgotten at the next read, so the repo coming back does not narrow the list by itself. A session whose pane closes reads only the MRs it raised, so like its folds and open page, the pick goes then too | `keptRepo` |
| This session | the MRs this session raised, watched or you pinned, in the order they came | `buildPane` |
| `▸ N others` | while This session holds any, every other MR folds behind one line saying how many GitLab says can merge and how many have news in the inbox; a picked repo shows its MRs unfolded | `buildPane` |
| Ready | the open MRs, those GitLab says can merge first, then the most pressing, ten until `▸ more` | `MINE_SHOWN` |
| Parked | a ready MR untouched for a week, its pipeline included, with no news in the inbox; a comment, a push, a pipeline run or news brings it back | `PARKED_AFTER_MS` |
| Drafts | GitLab's drafts, folded | `buildPane` |
| Merged | last, folded, as `▸ N merged`: your own MRs merged in the last three days, five at most, as the inbox's read left them (not cards, so nothing that counts or orders the list sees them). A row is the MR's link, how long ago it merged, and the build GitLab ran on the commit that landed on its target branch (never a pipeline a schedule started). Only a failed build is said on the folded line (`▸ 3 merged · 1 build ✗`); open, the rows say it. No wake, no toast | `mergedModel`, `LANDED_WITHIN_MS`, `LANDED_SHOWN` |

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
- Merges, rebases, replies and reviewers added keep one record of what was confirmed, sent and how it ended (`hooks/writes.ts`; `hooks/write-model.ts` says what each entry means), so each says the same when an answer is lost, and none is sent twice. One sent by a session closed or reloaded mid-way is offered again with `no answer came back` in amber, since it may have gone through.
- What was pressed holds until the MR's head moves, so a push offers the move afresh, and a hand-off to Claude ends when its push lands.
- A press that did not take says why beside the move, amber, until it is pressed again; a toast says how each move ended.
- Merging, rebasing and adding a reviewer write to GitLab, so they need a token with the `api` scope; the pane reads with `read_api`.

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

- **Badge** in the corner (`REVIEW_MARK` in `hooks/face-model.ts`), below: where they stand, said by its glyph, never by a colour alone, so there is no ring. It is cut out of the avatar by an edge in the pane's background (`PAGE`), and its glyph is drawn in that background too, white on the light shades and near black on the dark ones, which keeps 4.5:1 in either theme.
- **Without images** (the terminal): the badge's glyph, in its tone.
- **Under the pointer**, the face or the name says the badge's words, below; a suggested face says `suggested reviewer`.
- **Faded** means suggested, and nothing else in the pane: someone not on the MR yet, whom a press adds as a reviewer. Their face is washed out by a veil laid over it (`VEIL`): white at 55% in the light theme; in the dark theme the dim grey at 45%, since a fade toward the dark pane turned the face muddy and drowned its initials. It wears no badge, as they have no stand to show; ◌ is a reviewer who has not looked, which is a stand. Without images, `+` before the name says it.

| Badge | Means |
|---|---|
| ✓ | approved |
| ✕ | requested changes |
| ? | reviewing |
| ? | commented |
| ◌ | not reviewed yet |
| 💬 | holds an open thread |

Someone holding an open thread wears 💬 (`THREAD_MARK`, `markOf`), an amber speech bubble, in place of ✓, ? or ◌: the MR waits on their discussion, which its verdict says of the MR as a whole and the bubble says of the person. ✕ outranks it. The count beside their name says how many threads.

### Suggested reviewers

An open MR of yours that is not a draft and is short of reviewers (the approvals it still needs, less the reviews asked for that have no verdict yet; a comment asks no one) suggests whom GitLab suggests to approve it: the eligible approvers of its approval rules, its CODEOWNERS rules among them, less those who approved (`suggestedApprovers`, a paid tier's field; a Community Edition host suggests no one). Never the author, a bot or anyone on the MR, in GitLab's order, two at most (`suggestionRoom`, `suggestedOf`). Only the session that reads GitLab asks, once per MR each time it changes, and again at the next read after an ask failed; asking for reviews is the author's, so an MR of someone else's pinned here suggests no one (`suggestionsFor`).

| Beside the faded face | Means | Press |
|---|---|---|
| `+ Ines` | GitLab suggests Ines | arms adding her |
| `+ add Ines as a reviewer? press again` | armed, as the primary button, for 10 seconds | adds her; GitLab tells her |
| `+ adding Ines…` | sent | none |
| `Ines added` | GitLab added her; the next read shows her badged ◌ | none |
| amber words after `+ Ines` | why GitLab did not add her | arms again |

The add keeps the MR's other reviewers (`APPEND`), and a toast says how it ended.

## Links

Every link says what it opens before its words (`LINK` in `hooks/drawing.ts`), and in words under the pointer (`opens the MR`, `LINK_OPENS`). On a merged MR's row, 🚦 opens the build on its target branch. On a card, 🎫 opens the ticket under the card, and ⌘, ctrl or alt with the click opens it in Jira; on a page, and as `🎫 open in Jira` under a card, it opens Jira.

| Mark | Opens |
|---|---|
| 🔀 | the MR |
| 🎫 | the Jira ticket |
| 📁 | the repo |
| 🚦 | the pipeline |
| 💬 | the comment |
| 📍 | the commit a merge takes |

## Under the pointer

Resting the pointer on a symbol tints it a faint grey and shows what it means in a chip of the theme's text colour, from the start of the blank line under the card or row it is on (`hinted`, `hintLine`). That line is the one every card and row already leaves under it, so nothing moves and nothing the card holds is covered; a description of several lines (a strip's stages, the ticket's two) runs on down over the top of what follows. The symbol and its description are one hover group, and the app reveals a group's description only through a member whose own look changes under the pointer: hence the tint, which also shows which symbol the line speaks for.

The engine shows a hidden box the moment the pointer touches its symbol and has no delay of its own. So the box holds a small region of the pane's own (a `Client`, `hooks/hint-wait.tsx`) that is laid out as the box shows and hides, and shows the words only once the pointer has stayed `HINT_DELAY_MS`, 0.6 s, every time (`waitStep` in `hooks/hint-chip.ts`, on plain data): a pointer only passing by is gone before they show. The region holds no symbol, so a press lands on the symbol as before. Seen in the desktop app, each rest waited, the second as the first, and the chip showed by 0.7 s.

Tried and dropped: a chip drawn over the line above its symbol covered that line, a title's link included, while it showed; a chip as a picture that fades in waited only the first time, as the desktop keeps one clock per picture; a region laid over the symbol waited every time but swallowed its presses; the app's own tooltip (a framed picture's title) waited longer, fired only over a 16-pixel picture and could not cover links or buttons; a hover group whose symbol changed nothing of its own, or only a border colour on a box with no border, revealed nothing. 1.5 s read as slow.

The words are the tables' own:

| Symbol | Says |
|---|---|
| A link's mark | `opens` and what it opens, above |
| A face, or its name | its badge's words, above, with the threads they hold (`approved, 2 open threads`) |
| A pipeline mark | its status (`passed`, `waiting on a manual job`; `STATUS_WORD`); `○` says `no pipeline`, in place of those words on a card |
| An inbox count | its event's words, above: a card counts `✓2 💬1` in place of `2 approved · 1 commented`; what blocks a merge (changes requested, a failed pipeline, can't merge) keeps its words |
| The stage strip | its stages, a line each: how many passed, then every other stage's name, state and time |
| The failed jobs on an MR's page | one description for the list: what `✗` and `⚠` mean, and that each opens its log |
| An inbox avatar | who it is |

The controls drawn as a symbol alone say what a press does, or what is on (`CONTROL`):

| Control | Says |
|---|---|
| ↻ | read GitLab again |
| 🔔 | raised MRs wake Claude |
| 🔕 | raised MRs don't wake Claude |
| ☆ | pin to this session |
| ★ | unpin from this session |
| ✕ | end the search |
| ✕ | close what is open under the card |
| ✓ | mark seen |

- Only the desktop app was seen drawing a description, so it alone draws them. The terminal, VS Code and a phone keep the words a symbol replaces. Neither VS Code nor a phone shows a picture's title either, so there the stage strip's own text (`alt`) names its stages, for whatever reads it out; on the screen the strip says its stages nowhere but the desktop, as before.
- Text from GitLab in a description (a name, a stage) loses what draws nothing: marks that only steer text, such as a right-to-left override, and letters drawn blank. Words left with nothing to say draw no description (`hintChip` answers `null`).
- A list of links that each do the same (an MR page's failed jobs) has one description for the whole list, in the line under it: a description per link took 500 characters each and crowded a long page's threads off it.
- A description from the tables above fits `HINT_ROOM`, 36 cells, so it stays inside a narrow pane; any line past it (a stage's long name, text from GitLab) is cut with `…`, and a list past `HINT_LINES` ends with how many more. Wide letters count two cells. One costs about 600 characters of the drawing with its symbol's box and the stamps the engine adds to a hover group (`measure` counts them), counted with its row; the top row's are in `CHROME_SIZE`. With every symbol described, the heaviest list the tests make (fifty MRs of 180 failed jobs each) draws 9 cards where it drew 15, and counts the rest.
- Every symbol is drawn through `hinted`, the one component, with its words from these tables, and every block that holds one ends with its `hintLine`. The tests hold it: `unhinted` (`tests/fixtures.ts`) walks a desktop drawing of Mine, an MR's page, a person's page, the inbox and a search, and fails on any picture, link, or label of symbols alone whose hover group does not reveal exactly one description.

A ticket the pane moves in Jira (`jiraInReview`, `jiraOnMerge`; the rules are `hooks/jira-moves.ts`) gets no mark on its card: moving it is the pane's chore, not the person's. The move is a toast once, in the session that made it (the one that reads GitLab for the others), whose 🎫 line on the MR's page shows the new status at once; other sessions show it at their next read of Jira.

## Inbox

Each card counts what happened since you last marked it seen, in the order it matters to the merge (`VERB` in `hooks/inbox-pane.tsx`), as each event's mark and count (`✓2`), whose words show once the pointer rests on it; what blocks a merge is counted in words. The last two name no one.

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

- A card with news says `N new`.
- An MR can show under several tabs; the Inbox tab's count counts it once.
- The band above the prompt says the Inbox tab's words in amber, `Inbox · N new`, only while there is news and the tabs are out of sight: the pane closed or undrawn, or an MR's page in their place. It never repeats the tab beside it, gives way to a survey, and opens the Inbox tab when pressed (`inboxBand`, `hooks/pane-model.ts`).
- `N+ new` is a lower bound: GitLab sent only the latest 30 notes, and the mark is older than the oldest.
- ✓ marks seen on this machine only; GitLab is not told. `● here` narrows every tab to the session's project.
- In the terminal, while the inbox is taller than the pane, ↑ and ↓ move the focus ring a card at a time, onto its title (its ✓ when it has nothing to open), and Enter opens it; past the first or last card drawn they scroll again, and from the footer ↑ comes back to the last card drawn (`hooks/inbox-ring.ts`). ✓ on the card holding the ring hands the ring to the next. `s` presses `✓ mark all seen (s)`. The engine draws the ring, so moving it draws nothing again; while the inbox fits, the engine's arrows walk every button instead.
- An empty tab says why when it can: no token for a host, no repo for `here`, nobody followed.

## Text

Secondary facts (branches, diff size, who, when, the footer) are dim. Problems in the footer are amber, never red: red is kept for what blocks a merge.
