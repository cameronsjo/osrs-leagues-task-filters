# Lane reframe and design pivot — Field Report

**Date:** 2026-05-16
**Type:** architecture
**Project:** osrs-leagues-task-filters

> This is the third in a series. See also:
> - [`capture-phase-vs-row-stoppropagation.md`](./capture-phase-vs-row-stoppropagation.md) — debugging the wiki's row-level `stopPropagation` to make per-row clicks work
> - [`tri-state-to-binary-collapse.md`](./tri-state-to-binary-collapse.md) — collapsing the tri-state plan column to binary after the "won't do" semantics didn't hold up
> - **(this report)** — the user reframes the problem and the binary collapse turns out to have been only half the story

## Goal

The session opened with what looked like a follow-on tweak: two sessions ago I shipped a tri-state Plan column (todo / won't-do / untouched); one session ago we deleted the won't-do state because it implied a commitment the user never makes, and shipped a clean binary checkbox. This session opened with "we don't have a won't-do toggle now" — and my first read was "oh, they miss the third state; let me find a better affordance for the same model." I was going to add a per-row × button that hid tasks from view. Pure affordance work on top of an unchanged model.

Five turns in, the user threw out four words that retroactively reframed every prior session: **View. Filter. Plan. Exclude.** Four lanes, not states. And the lesson is what to do when that happens.

## What Actually Happened

Three rounds in, the user said:

> So here's the deal. We're accomplishing multiple lanes here.
> - View all tasks — obvious
> - Filter tasks — obvious
> - Plan tasks — "I need (X) points, or (X) tasks to get next area/relic" or "This seems like a good task to complete"
> - Exclude tasks — "Ain't no way I'm doing this task" or "Not within my current realm to complete"
>
> But the main thing here is that I'm trying to aggregate/view/plan tasks to get Relics and Areas unlocked.

That last sentence is the load-bearing one. **The script's actual job is goal-driven knapsack planning** — pick a set of tasks that hits a point threshold to unlock the next Relic, Area, or Pact in Leagues VI. Filtering is the substrate. Planning is the workflow.

Suddenly the prior six versions of UI made sense as a series of partial answers to the wrong question:

| What we built | What we thought it was | What it actually was |
|---|---|---|
| Per-row todo checkbox (v1) | "Personal shortlist" | A planning input — first try at marking which tasks count toward a goal |
| Tri-state with won't-do (v2) | "Three discrete user intents on one axis" | One axis (plan) + a confused second concept (commitment that nobody makes) |
| Collapse to binary (v3) | "We were modeling something users don't do" | Partial fix — removed the bad axis, didn't add the right one |
| (Was about to build) per-row × hide | "UX dismissal of cruft" | Still wrong — would have repeated the won't-do mistake under a new label |

The whole arc was the user holding the right mental model and us iterating on partial reads of it.

## The Reframe — Same Affordance, Different Mental Model

Here's the part that's worth coming back to. The hide button I was about to build and the won't-do state we'd already deleted are **the same DOM artifact**: a per-row negative action that removes a task from view. Two sessions ago the framing was *commitment*, and it failed because users don't make permanent commitments in a six-week event. This session, before we got the reframe, I was about to ship the same control as *dismissal* — and it would have failed for a different reason: pure dismissal doesn't carry the math the user actually wants.

The framing that worked: **excluding tasks updates the available-points pool**. "I'm not doing raid tasks" isn't a commitment or a dismissal — it's a *pool reducer*. The user has a target unlock cost in their head, and they need the visible points total to reflect what's actually available to them. Once raids are excluded, the math is honest. The same × control, the same data flow — but now it serves a planning calculation rather than expressing a feeling.

This is the thing to remember: when an affordance has failed twice, the answer might not be a better affordance. It might be a question about what the user is *doing* when they reach for it.

## The Architecture — Two Axes, Four States

Once the user named "Plan" and "Exclude" as separate lanes, they snapped into place as **two independent binary axes**:

| Plan column | Skip column | Bucket | Math role |
|---|---|---|---|
| ☐ | ☐ | Default | In the available pool; not committed |
| ✓ | ☐ | **Plan-strict** | Counts toward the planning total |
| ☐ | ✗ | **Excluded-strict** | Removed from the available pool |
| ✓ | ✗ | **Later** | Was on the plan; parked for a future pass |

The "later" state is the gift. It's a fourth user-meaningful state we didn't have to design — it falls out for free from two boolean columns. The user surfaced it themselves: *"Combo = 'i'll do it, but maybe later'"*. That insight only happened because we'd structured the underlying model as two checkboxes rather than one cycle.

Visual treatment for each state (in the plan):
- Default: no row tint
- Plan-strict: teal solid (existing `--lf-plan-go-bg`, ~14% alpha)
- Later: diagonal teal stripes at slightly higher alpha — scans as "marked but parked"
- Excluded-strict: faded content (when peeked via `Show excluded tasks`)

Three filter toggles in the Todo group address the four states:
- `Show only my plan` — strict plan only (interpretation: laser-focus on current pass)
- `Show "later" tasks` — include the combo state alongside strict plan
- `Show excluded tasks` — peek at what's been removed from the pool

And three new stat pills carry the planning math:
- `Plan: X pts` — sum of strict-plan task points
- `Pool: Y pts` — Total minus Excluded (Later still counts as "available consideration")
- `Excluded: Z pts` — sum of strict-excluded points

No hardcoded unlock ladder. The user holds their goal in their head and reads the three numbers; mental math finishes the job. The "Light" option from the planning-math triage — and the right one to ship first, because it costs almost nothing and the heavier options (goal target inputs, hardcoded relic costs) only make sense once we've felt how the pills perform in real use.

## Decisions Made

| Decision | Rationale |
|---|---|
| Model as **two binary axes** rather than tri-state-with-better-labels | Two checkboxes give four states for free including "later." Tri-state can't express "later" without a fourth glyph. Two columns is also more discoverable than a cycle. |
| **"Plan" and "Skip" as column headers** | Match the user's lane vocabulary. Internal storage keys keep saying `todo` for non-breaking persistence — UI label and data name can differ. |
| **Three filter toggles** (not a single tri-state radio) | Plan + Later + Excluded are visibility decisions for three different buckets. Independent toggles compose; a single radio would force the user to choose between mutually-useful views. |
| **Light math (three pills), not goal-target input** | The user explicitly chose light. Pills cost nothing to add; goal-target input is a feature that wants real usage data to justify. Ship the pills, learn from how they're used. |
| **No hardcoded relic/area/pact thresholds** | Wiki-data-keeping problem. Would break across leagues. The user does the subtraction. |
| **Defer implementation to a future session** | The user surfaced "this session is too big" — the right call after six prior turns of design iteration. Plan was written up and saved to `docs/plans/` instead of partially shipped. |

## Gotchas

- **Iteration count is a signal, not a verdict.** Three rounds of "no, not quite" doesn't necessarily mean the design is wrong. It can mean we're solving from inside the wrong frame and the user is patient. Listen for the moment when they zoom out — that's the data the iteration was generating.
- **Same affordance, different mental model, totally different design.** The won't-do button and the exclude button are pixel-identical. One failed; the other will (probably) ship. The difference is the *math role* the action plays in the user's workflow, not anything in the UI. When you find yourself building the same control for the third time, audit which job-to-be-done it's hired for this time around.
- **Combo states are free expressiveness if you structure independently.** Two boolean axes (Plan, Skip) give you four discrete states with zero extra UI. The "later" state was never explicitly designed — it emerged because Plan + Skip were modeled as independent. This is generally true: prefer N independent binary controls over a single N-state cycle when the controls represent orthogonal concerns. You get combinatorial expressiveness and you get filter toggles that compose.
- **Heavy planning math is the wrong place to start.** It's tempting to build the goal-target input ("I want to hit 1500 pts") because it sounds useful. But you don't know yet which subset of users (or which sessions of one user's planning loop) actually need the explicit goal target vs. just glancing at the running plan total. Pills first, validate, only then consider richer goal-tracking.
- **A documented plan that doesn't ship is still session output.** The user calling it mid-design felt anti-climactic after seven turns of work, but the plan is now a checked-in artifact at `docs/plans/2026-05-16-plan-skip-two-axis-curation.md` and a discoverable starting point for the next session. That's better than a partial implementation that would need rework once we'd thought it through.

## Key Takeaways

- **When an affordance has failed twice, the answer might not be a better affordance.** Ask what the user is *doing* when they reach for it. The third "version" of the won't-do/skip/exclude button worked because we finally understood it was planning math, not a UX dismissal.
- **Independent binary axes beat single-axis cycles for expressing N states.** Two checkboxes give four states; three checkboxes give eight. You don't need to design each state — you design the axes and the combinations emerge. Visual treatments per combination are cheap if you have a CSS token system already in place (we did; reusing `--lf-plan-go-bg` for both Plan-strict and Later, just with different patterns).
- **"Light" planning math is the right place to start.** Three stat pills carry the math without the implementation cost or maintenance burden of goal targets / unlock ladders. Ship the pills, learn how they're actually read, *then* decide if heavier tooling is warranted.
- **The user's vocabulary is a design tool.** When the user named "View / Filter / Plan / Exclude" as lanes, that wasn't a tangent — it was the mental model that made the entire prior week of UI iterations make sense. Listen for the moment when the user starts naming categories rather than asking for features. That naming is the design.
- **Writing up an unshipped plan is a valid session outcome.** Especially after multiple rounds of partial fixes, sometimes the right move is to stop, write down what you now understand, and resume with that as the starting point. The plan doc at `docs/plans/2026-05-16-plan-skip-two-axis-curation.md` is a better artifact than a half-built feature would have been.

## Commits

- `eee47a3` — `docs: save Plan+Skip two-axis curation plan`. The plan doc that this report is wrapped around. No code in this session — that's the point.

## What's Next

The implementation work is described in full in `docs/plans/2026-05-16-plan-skip-two-axis-curation.md`. Future-Cameron resumes there. The verification section in that plan is concrete enough to drive a Playwright probe; the storage and state additions are precise enough to apply as a series of edits to `osrs-leagues-task-filters.user.js`. Nothing prevents that work from starting cold from the plan doc alone.
