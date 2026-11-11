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
- **An independent adversarial review**, its findings fixed with tests, before the merge.
- **A drawing change is seen in the desktop app** (below) before the merge. The pictures cannot show what only the desktop draws differently.

A pull request's description is written for someone who has not seen the work, in the order they need it ([#89](https://github.com/alxleo/gitlab-pane/pull/89) is the model):

1. **What changes for the person**, in a sentence or two, then `Closes #N`.
2. **A `Was | Is` table**, one row per change someone using the pane would notice, in their words, not the code's. Include what the change fixes in passing and what behaves differently that someone may have relied on.
3. **The recommendation and what was rejected**, each rejection with its evidence (a picture, a measurement, a failing case), not a list of options.
4. **Pictures, when the drawing changes:** a `Before | After | Delta` table, one row per scene, from `npm run screens -- render --out <dir> --delta-against origin/main` ([CONTRIBUTING.md](CONTRIBUTING.md#screenshots)), drawn with the pinned Claude Code. The delta picture is what a reviewer reads first: the change outlined, the rest faded. When the README scenes do not show the case the issue names (eight repos, a narrow pane), add it to the scene for this comparison only, render it too, and say so under the table.
   - Put the pictures on the `pr-screens` branch in a folder named for the change, and link them by that branch's commit SHA. A link to `main` shows the new picture once this merges, and one to the pull request's branch breaks when the branch is deleted.

No names of people, no mention of who or what wrote the change, no branch names in links. The title is the squash commit on main: conventional, at most 100 characters.

## Checking the pane in the desktop app

`npm run shot` (CONTRIBUTING says when to use it instead of the rig) is expected to behave like this, and anything else is a bug to report:
- It runs only when the person says the pane is showing. A run that clicks, scrolls or moves the pointer needs the Claude window in front, so ask before one. Without the window in front, it refuses and names the app that is.
- `capture` writes the pane alone, its header at the top. When the window was behind another, the JSON says the pointer was not parked.
- `press` lands on the button whose words it was given. The pane's title then names the new view ("GitLab · Inbox").
- The pointer ends where it started, and focus stays where the person left it.
- The session's name in the window's header can read with a trailing "V" or "v". That still counts as the same session; a name with a different letter or digit does not.
- Pictures go where `-o` says, outside the checkout, because they show real MR titles and people. Show them to the person before deleting them. The tool deletes its own whole-window frames when it exits.
