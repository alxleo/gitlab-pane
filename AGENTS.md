# Working on gitlab-pane

Before proposing or changing UX, visuals, workflows, notifications, or Claude delegation, read [PRODUCT_BRIEF.md](PRODUCT_BRIEF.md). It is the authoritative product intent and redesign handoff. Do not infer the desired experience from the current implementation or old Penpot explorations.

[DESIGN.md](DESIGN.md) describes the existing implementation, not the target redesign. When it conflicts with the product brief, the brief governs design direction.

Before showing any screen, check it against the acceptance gate in PRODUCT_BRIEF.md. Fix or discard failures yourself. Bring one recommendation that passes, together with rejected approaches and reasons; do not restart with A/B/C choices. Research only when a specific unanswered question blocks a decision. Before redrawing after a correction, identify the principle it changes and apply it throughout the experience.

Continue from the approved-nit screen: Maya's comment with Delegate / Reply / Open in GitLab. It is the best result so far, not approval of every part of Penpot page 09. Do not restart the visual direction.

The redesign is currently paused at the brief. Do not resume Penpot edits or implement the redesign merely because this file exists. Follow the user's current task; the agreed process is incremental Penpot work, reviewed as a whole experience before product implementation. Delegate Penpot interaction when continuing that authorised work; retain responsibility for product and visual judgement.

## Pull requests

Before one opens:
- **Shared capabilities first.** Ask what the change builds that another feature needs or already has: a write sent once and tracked, a reader with a lease, a decoder. That part becomes one module with its own tests, and each feature declares only its own part. A large diff is the warning sign; a module copied privately into a feature is the failure.
- **Every guard has a test that fails without it.** Break each new guard or rule, check a test goes red, then restore it. Reviews kept finding guards no test held.
- **An independent adversarial review** by a separate agent ([below](#review)), its findings fixed.
- **A drawing change is seen in the desktop app** (below) before the merge. The pictures cannot show what only the desktop draws differently.

A pull request's description is written for someone who has not seen the work, in the order they need it ([#89](https://github.com/alxleo/gitlab-pane/pull/89) is the model):

1. **What changes for the person**, in a sentence or two, then `Closes #N`.
2. **A `Was | Is` table**, one row per change someone using the pane would notice, in their words, not the code's. Include what the change fixes in passing and what behaves differently that someone may have relied on.
3. **The recommendation and what was rejected**, each rejection with its evidence (a picture, a measurement, a failing case), not a list of options.
4. **Pictures, when the drawing changes:** a `Before | After | Delta` table, one row per scene, from `npm run screens -- render --out <dir> --delta-against origin/main` ([CONTRIBUTING.md](CONTRIBUTING.md#screenshots)), drawn with the pinned Claude Code. The delta picture is what a reviewer reads first: the change outlined, the rest faded. When the README scenes do not show the case the issue names (eight repos, a narrow pane), add it to the scene for this comparison only, render it too, and say so under the table.
   - Put the pictures on the `pr-screens` branch in a folder named for the change, and link them by that branch's commit SHA. A link to `main` shows the new picture once this merges, and one to the pull request's branch breaks when the branch is deleted.
5. **Review:** a `Heading | The reviewer's answer | What was done` table, one row per heading of the [review](#review). The reviewer's answer is in its own words, shortened only by cutting. A row where it found nothing stays one line. A finding left unfixed says why, with its evidence. A change that skips the review says `Review: none, documentation only`.

No names of people, no mention of who or what wrote the change, no branch names in links. The title is the squash commit on main: conventional, at most 100 characters.

## Review

A separate agent reviews every pull request before it opens, however it opens (`gh pr create`, the GitHub connector, `gh api`). Nobody asks for it: whoever opens the pull request has it run. A description without its Review part is not ready.

Only a change whose every file is Markdown skips it. Changes to AGENTS.md, `.claude/CLAUDE.md`, PRODUCT_BRIEF.md and DESIGN.md never skip it, because agents act on them. A test, tool, workflow or configuration counts as code.

1. Commit the finished change, with `npm run check` and `npm test` passing, so the reviewer reads what will ship.
2. Start a separate agent for the review. Reading your own change again does not count. An implementer that may not start agents hands the branch back to whoever asked, who runs the review before the pull request opens.
3. Brief it with these, and nothing on why you think the change is safe:
   - the person's or the issue's words as written, not your summary;
   - `git diff origin/main...HEAD`, after `git fetch`. It needs three dots: with two, commits that reached main after the branch was cut show as if this change undid them;
   - the `Was | Is` table;
   - this section, [PRODUCT_BRIEF.md](PRODUCT_BRIEF.md) and [DESIGN.md](DESIGN.md).
4. It reads, and runs only `npm run check`, `npm test` and `npm run rig`. To see a guard's test go red, it breaks the guard in a copy of the checkout. It never runs `npm run preview` or `npm run shot`: both reach the real GitLab or the person's desktop app.
5. It answers every heading below, either with a finding (the file and line, and the input or step that goes wrong) or with "nothing" and the command it ran or the line it traced. If a heading is left out, or "nothing" has no evidence, the review is not done.
6. Fix each real finding. A finding about behaviour gets a test that fails without the fix. Reject a finding only with evidence.
7. Any fix that changes behaviour is reviewed the same way, covering the fix and the code it touches, and the Review part is updated. That holds before the pull request opens and after it, whether the fix came from CI, from a request, or from a rebase that resolved conflicts.

| Heading | What the reviewer asks |
| --- | --- |
| The person using the pane | What would they notice that the `Was \| Is` table does not say? Does the screen pass the brief's acceptance gate? Are colours and symbols used as [DESIGN.md](DESIGN.md) says, in the light and the dark theme, and does a symbol sit where convention puts it? Does it still work on a phone, which may have no text field? Does it touch something the preview cannot show ([CONTRIBUTING.md](CONTRIBUTING.md#checking-the-pane-in-the-desktop-app): a Button's children, a drawing past 100,000 characters, typing across redraws, hover)? Name the line. |
| Correctness | Which input gives a wrong answer: an older GitLab (the plain variants), a card an older version kept, a write pressed twice or never confirmed, a read that fails half way, two sessions at once, an empty list, a deleted MR? |
| Lists and limits | Which lists must change along with this, and did they? `tsconfig.core.json`'s core list, `release/files`, `knip.jsonc`, the canary's paths, the Claude Code pin in three files, `tests/docs.generated.ts` (`npm run docs -- check`). How often does it ask GitLab, at what cost, and on whose critical path? What do huge text, hostile text or a control character do to it? |
| Complexity | What can a contributor now forget, and what must they now remember that they did not before? Does each new module, type, setting or option earn what it costs to keep? Is the diff larger than the behaviour it changes? |
| Coherence | Does the pane already do this somewhere else, in another way? Look for: machinery copied rather than shared; a word or name that means something else elsewhere; a rule broken here but kept everywhere else; a choice that only makes sense inside this diff; and the same thing shown in Mine, the Inbox and an MR's page with a different word, symbol or colour than [DESIGN.md](DESIGN.md) gives it. |
| Tests | Does each new guard have a test that fails without it? Does each test check what its name says? Was any assertion weakened, or a test changed to fit the code? |
| What Claude reads | Does text from GitLab reach the model other than through `foreign`? Does a wake or a `watch_mr` answer carry someone else's words? |

## Checking the pane in the desktop app

`npm run shot` (CONTRIBUTING says when to use it instead of the rig) is expected to behave like this, and anything else is a bug to report:
- It runs only when the person says the pane is showing. A run that clicks, scrolls or moves the pointer needs the Claude window in front, so ask before one. Without the window in front, it refuses and names the app that is.
- `capture` writes the pane alone, its header at the top. When the window was behind another, the JSON says the pointer was not parked.
- `press` lands on the button whose words it was given. The pane's title then names the new view ("GitLab · Inbox").
- The pointer ends where it started, and focus stays where the person left it.
- The session's name in the window's header can read with a trailing "V" or "v". That still counts as the same session; a name with a different letter or digit does not.
- Pictures go where `-o` says, outside the checkout, because they show real MR titles and people. Show them to the person before deleting them. The tool deletes its own whole-window frames when it exits.
