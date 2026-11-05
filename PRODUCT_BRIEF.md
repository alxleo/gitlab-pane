# Product brief

Authoritative intent and handoff, 5 November 2026. Read this before design or implementation work. This describes desired behaviour, not capabilities already implemented. The latest user instructions take precedence.

## Purpose

Reduce the attention required to keep work moving across 8–10 MRs and several Claude sessions. The developer's main activity is elsewhere. The pane lets them notice meaningful changes, make small decisions or delegate work, and return to their main task.

Success is how much the developer can stop attending to while their work progresses. The ambition is to handle the common 80% of actions exceptionally well and leave the deeper 20% to GitLab; this is a product boundary, not a measured coverage claim.

The pane should answer:

- What changed that matters to me?
- Is there a decision or action I need to take?
- Can I hand this off and continue working?

## Acceptance gate before presenting a screen

Check every screen against these requirements. Fix or discard failures yourself before showing the user.

- Every visible fact changes the developer's decision. The pane exists to reduce attention; Claude does the fixing.
- Technical repair details travel with the task to Claude. Show them to the developer only when Claude needs a specific human decision, and only enough to answer it.
- Each MR has at most one obvious next move, or none. Contextual alternatives in an opened human comment must not become equally prominent actions throughout the MR list.
- Healthy, waiting and Claude-handled work stay quiet.
- No fact is repeated in two places.
- Human feedback always surfaces, even after approval. Bot feedback stays quiet unless it blocks.
- Delegated work follows blocked → one-click delegate → quiet while running → a one-line result: fixed or needs you. Intermediate work demands no attention.

Surfacing human feedback does not automatically make it an obligation: the developer judges whether it needs a change, a reply or no further action. Reading must not silently resolve it.

## What the developer should be able to forget

Which MR belongs to which session and worktree; assembling routine repair instructions; tracking delegated work; remembering when reviews were requested; repeatedly checking whether operations succeeded.

Do not require repeated inspection, copying errors into chats, reconstructing context, selecting an already-known destination, or supervising routine progress.

## Attention follows remaining responsibility

An MR may still have a failed pipeline while no longer needing the developer because Claude is fixing it. Object status and demand for human attention are different.

| Situation | Developer's responsibility | Quiet handling |
| --- | --- | --- |
| New human feedback | Understand it; delegate, reply briefly, or open GitLab | Preserve actual words and relevant context |
| Pipeline failure | Usually one action to let Claude address it | Collect evidence, route work, track repair and checks |
| Conflicts | Let Claude resolve them | Supply MR, branches, worktree and instructions; monitor outcome |
| Straightforward rebase | Trigger it directly | Use GitLab and track completion |
| Review needed | Choose from useful reviewer suggestions | Prepare request and remember timing |
| Recent review request | Usually nothing | Quiet waiting |
| Older unanswered request | Consider a GitLab or Slack nudge | Prepare follow-up; retain request and response history |
| Ready to merge | Decide and merge directly | Respect GitLab rules; confirm actual result |
| Claude queued or working | Usually nothing | Track progress and retain a route to the correct session |
| Claude needs judgement | Answer a specific question | Supply only the context necessary to decide |
| Work finishes | Understand outcome and next action | Verify relevant GitLab state; retire stale warnings |

This table is not an inventory of controls to display. Most capabilities stay unobtrusive until relevant. Review requested 1–2 hours ago should normally remain quiet; an unanswered request from yesterday may warrant a suggested nudge, with timing configurable. Do not claim a reviewer has not looked without evidence. Social follow-ups are deliberate actions, not automatic messages.

## Human feedback and bot feedback

Every new human comment produces persistent unread activity grouped by MR, without a popup or focus interruption. This is explicitly agreed. Approval never suppresses comments: approved-with-nits still surfaces.

Provide enough context to delegate, reply briefly, or open the precise GitLab destination. Sometimes the comment alone is enough; sometimes a small code excerpt helps. Do not recreate the full diff viewer or normal MR review flow.

Read, replied, delegated, resolved and completed are distinct. Reading does not resolve a thread; replying does not complete code work; delegation does not imply success. New human feedback still surfaces while Claude works.

Bot feedback stays quiet unless it blocks. Routine successes, repeated summaries and nonblocking findings must not compete with human feedback.

## Almost transparent delegation

One deliberate action is the normal handoff. Automatically supply the short instruction, MR/comment/job location, branches and worktree. Know or establish once the correct linked Claude session; do not send work to whichever session happens to be active.

Default to a scoped subagent so the main session remains focused. A busy session queues the work after its current task; interrupt is explicit. Optional instruction editing must not become a mandatory form.

Provide compact reassurance about the destination and a direct route back to the correct session. Visiting the session should not be necessary merely to verify dispatch. Missing or ambiguous linkage is an exception, not a picker on every task. Avoid duplicate repair tasks.

## Results close the loop

Surface a one-line result: fixed or needs you. Agent completion, pushed code and verified GitLab state are distinct. Track those distinctions internally; checks still running are quiet progress, not another attention-demanding outcome. A needs-you result states the specific decision required.

The exact merge conflict, raw logs, branch topology and worktree instructions normally belong in Claude's task payload. They only become relevant to the developer when they help answer a decision Claude cannot make. The developer is not the default repair operator.

Once work is being handled, the original problem loses its demand for attention. Once verified fixed, stale failure indicators disappear. Do not repeat a fact in multiple places. Surface the result without making the developer supervise each intermediate step. A successful repair does not itself mean the MR can merge.

## Whole experience

- **Mine:** keep the developer's own MRs moving. Make remaining responsibilities and useful next actions apparent; keep waiting and delegated work findable.
- **Inbox:** incoming activity and review requests. Incoming reviews live here only, with no To review section in Mine. Remember the user's last Inbox view.
- **Settings:** recurring preferences, review follow-up timing and delegation defaults. Daily use benefits from these choices without repeatedly presenting configuration.

Use consistent meanings for unread activity, people, automated work and outcomes across views. Preserve context and avoid duplicate obligations.

## GitLab boundary

Handle common coordination and completion well: delegate, request review, briefly reply, nudge, rebase and merge. Leave substantive reviews, extensive diff exploration, broad investigation and discussions requiring substantial context to GitLab. Open the relevant thread, job, diff or MR directly.

The boundary is how much context the human needs to decide, not how much data fits in the pane.

## Visual brief

Dense, legible and visually navigable for daily use by many developers. Compact interactive elements need distinct, consistent meanings. Healthy states, waiting and delegated work recede. New human feedback and genuine decisions remain noticeable.

Avoid Markdown-like layouts, large boxes of text, generic forms, equal-weight action catalogues and repetitive status displays. Earlier references to VS Code structure and Linear activity cues were useful; prominent pipeline visualisations were not.

The user's "no buttons" challenge is not satisfied by replacing labelled rectangles with underlined commands, standalone icons, or diagrams around the same action catalogue. Graphics must reduce reading or coordination. Do not visualise technical work Claude handles merely to make the pane more graphical.

Judge the whole workload: can the developer glance, recognise where needed, move something along with minimal effort, and confidently leave it alone?

## Failed directions — do not resume them

The design drifted into a full review workspace, exposed implementation details, and made the developer inspect the repair process. Subsequent attempts substituted links for buttons, then introduced connected-work graphs, diagnostic gutters and branch diagrams. The user rejected these as off target: the exact conflict is irrelevant when the LLM handles it.

The approved-nit screen—Maya's comment with Delegate / Reply / Open in GitLab—is the best result so far and the starting point for continuation. This does not approve every part of page 09 or the whole experience. Do not restart the visual direction.

Do not treat Penpot pages 10 or 11, their research rules, or the graphical A/B/C studies as approved designs. Do not ask the user to choose among these rejected alternatives again.

The failure was gating, not missing context: the right premise had been stated but was not used to reject designs. Corrections were applied as styling changes while the wrong premise remained. Apply the acceptance gate to the actual screen, not merely to the explanation accompanying it.

Taste Classics was explicitly rejected. Impeccable and Vercel guidance were consulted, but no skill or reference overrides this product purpose. Research should challenge assumptions about user work, not justify component choices after the fact.

## Current handoff and next authorised step

Penpot editing and product implementation are stopped. The user requested this rebuilt brief so future sessions can continue without re-explanation. No production redesign code was changed in the design session.

Before further drawing, establish the whole experience against this attention brief. When the user authorises design continuation: work in small Penpot workflow slices from the approved-nit baseline, delegate the clicking, retain product/visual judgement, enforce the acceptance gate before presenting, and show the integrated experience before implementation. Do not mistake successful prototype navigation for product fit or real integration.

Bring one recommendation that has passed the gate, plus what was rejected and why. Do not restart with A/B/C option sets. Start research only when a specific unanswered question blocks a decision. Treat corrections as statements of principle: identify the principle they imply before redrawing, and apply it throughout the experience.

The pending workflow request was pipeline failure and conflict handling through Claude work to surfaced results. Its visual exploration was rejected; the complete lifecycle is not delivered. Resume only under the corrected brief and the next user's instruction.

Open decisions: how new feedback joins already-running work; whether recording approval after reviewing elsewhere belongs in the pane. Do not silently treat earlier assistant proposals as agreed requirements.

## References and prototype limits

- [Workflow discussion Page](https://chatgpt.com/space/page_5c457d4f45648191a5a32db1a261f7df)
- [Visual constraints research Page](https://chatgpt.com/space/page_5708912d6bf08191afe16fd42821f958) — exploratory; its graphical direction was rejected. This repository brief supersedes it where they differ.
- [Penpot file, page 09](https://penpot.lab.codexforge.net/#/workspace?team-id=dc467cd2-3aac-807e-8008-bc6582007f75&file-id=86e0d0b7-c5a0-81c2-8008-e533f30f7f23&page-id=8fa1ada2-ab88-804b-8008-e6197d1769b4&wasm=false)

Page 09 uses mock data and a fixed reply. Its Maya flow demonstrated read/unread, one-click queued delegation, a simulated Checkout session return, and reply preservation. It did not perform real dispatch, replies or GitLab operations.

Existing code retains approval and notes separately. It currently submits wake text to the current session; cross-session routing, subagent queues and result tracking are not established by that path. GitLab writes and inline replies were not existing pane actions during inspection. The Inbox parser retained only three activity items and no bot identity on its activity type. Reverify implementation capabilities when implementation is actually authorised.
