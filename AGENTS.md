# Working on gitlab-pane

Before proposing or changing UX, visuals, workflows, notifications, or Claude delegation, read [PRODUCT_BRIEF.md](PRODUCT_BRIEF.md). It is the authoritative product intent and redesign handoff. Do not infer the desired experience from the current implementation or old Penpot explorations.

[DESIGN.md](DESIGN.md) describes the existing implementation, not the target redesign. When it conflicts with the product brief, the brief governs design direction.

Before showing any screen, check it against the acceptance gate in PRODUCT_BRIEF.md. Fix or discard failures yourself. Bring one recommendation that passes, together with rejected approaches and reasons; do not restart with A/B/C choices. Research only when a specific unanswered question blocks a decision. Before redrawing after a correction, identify the principle it changes and apply it throughout the experience.

Continue from the approved-nit screen: Maya's comment with Delegate / Reply / Open in GitLab. It is the best result so far, not approval of every part of Penpot page 09. Do not restart the visual direction.

The redesign is currently paused at the brief. Do not resume Penpot edits or implement the redesign merely because this file exists. Follow the user's current task; the agreed process is incremental Penpot work, reviewed as a whole experience before product implementation. Delegate Penpot interaction when continuing that authorised work; retain responsibility for product and visual judgement.

## Checking the pane in the desktop app

`npm run shot` (CONTRIBUTING says when to use it instead of the rig) is expected to behave like this, and anything else is a bug to report:
- It runs only when the person says the pane is showing. A run that clicks, scrolls or moves the pointer needs the Claude window in front, so ask before one. Without the window in front, it refuses and names the app that is.
- `capture` writes the pane alone, its header at the top. When the window was behind another, the JSON says the pointer was not parked.
- `press` lands on the button whose words it was given. The pane's title then names the new view ("GitLab · Inbox").
- The pointer ends where it started, and focus stays where the person left it.
- The session's name in the window's header can read with a trailing "V" or "v". That still counts as the same session; a name with a different letter or digit does not.
- Pictures go where `-o` says, outside the checkout, because they show real MR titles and people. Show them to the person before deleting them. The tool deletes its own whole-window frames when it exits.
