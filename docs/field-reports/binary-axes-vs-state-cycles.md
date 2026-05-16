# Binary axes vs state cycles for curation UI — Field Report

**Date:** 2026-05-16
**Type:** architecture
**Project:** osrs-leagues-task-filters

> Companion to [`lane-reframe-design-pivot.md`](./lane-reframe-design-pivot.md). That report tells the session story. This one extracts the reusable design pattern.

## Goal

Document, in a form future curation-UI work can grep for, why **N independent binary controls** beat **a single N-state cycle** when modeling user-curated state on a list of items. The OSRS leagues script reached this conclusion the hard way — shipped a tri-state cycling button, deleted it, then realized the same expressive power emerges from two independent checkboxes plus one free combo state.

## The Pattern

**N independent binary axes give you 2ⁿ states for free.** Each axis represents one orthogonal user concern. The states are the cross product.

For curation UI on a list of items:

| Axes | States | Example |
|---|---|---|
| 1 | 2 | `[ ✓ todo ]` — todo / untouched |
| 2 | 4 | `[ ✓ plan ] [ ✗ skip ]` — default, plan-only, skip-only, both |
| 3 | 8 | `[ ⭐ ] [ ✓ ] [ ✗ ]` — eight combinations |

The 2-axis case is the sweet spot for most curation UI: enough expressiveness to capture "yes / no / both / neither" without crowding the row.

## When It Applies

Use independent binary axes when:

- **The user has orthogonal concerns** about an item (e.g., "do I plan to do this?" and "do I want this in my pool?" are independent questions; either can be true regardless of the other)
- **A combination has natural meaning** (e.g., plan ✓ AND skip ✗ = "later" — I'll come back to it)
- **You want filter composability** — each axis becomes its own filter toggle, and toggles compose. A single N-state cycle can only ever filter to one slice at a time

In the OSRS context: the four states from two binary axes map cleanly onto distinct user intents — Default ("haven't decided"), Plan-strict ("doing this"), Excluded-strict ("not doing this, remove from pool"), Later ("doing this eventually, not now"). Each maps to a real planning workflow moment. None feels invented.

## When It Doesn't

Use a single state field (cycle, radio, select) when:

- **States are mutually exclusive by definition** — "draft / published / archived" cannot coexist
- **The combination has no meaning** — if `[ A ] [ B ]` checked together is meaningless or a bug, don't model A and B as independent axes
- **Visual real estate is severely constrained** — N checkboxes per row may not fit; a single cycling control can squeeze into a single cell

If you're tempted to model "draft vs published" as two booleans because the combo `draft=true, published=true` *might* be useful — stop. That's a state machine, not orthogonal axes.

## Affordance Benefits

The big payoff is filter composition.

**Single N-state cycle** filters look like:
- "Show state = X" (radio)

You can only express one slice at a time.

**N binary axes** filters look like:
- "Show only Plan" (axis 1 = on, axis 2 = off)
- "Show only Skip" (axis 1 = off, axis 2 = on)
- "Show Later" (axis 1 = on AND axis 2 = on)
- Or compose: "Show only Plan, but include Later" = strict-plan view PLUS the combo state

Three composable toggles cover four states with overlapping useful slices. A single radio across four states can only ever isolate one.

In the OSRS plan, three toggles surface the four states:
- `Show only my plan` — strict plan (axis 1 = on, axis 2 = off)
- `Show "later" tasks` — include the Plan+Skip combo
- `Show excluded tasks` — peek at strict-excluded (axis 1 = off, axis 2 = on)

These compose. The user can have all three on, or none, or any mix. A single tri-state radio would force the user to pick *one* slice and lose the others.

## Visual Treatment

Each combo can get a distinct CSS treatment cheaply, *if* the design tokens are already in place.

OSRS plan example, sharing the same `--lf-plan-go` (teal) token across treatments:

| State | Selector | Treatment |
|---|---|---|
| Default | `tr` (no attrs) | No tint |
| Plan-strict | `tr[data-lf-plan="1"]:not([data-lf-skip="1"])` | Solid teal at 14% alpha |
| Later | `tr[data-lf-plan="1"][data-lf-skip="1"]` | Diagonal teal stripes (repeating-linear-gradient) |
| Excluded-strict | `tr[data-lf-skip="1"]:not([data-lf-plan="1"])` | Faded cell content (opacity: 0.45) when peeked |

Notice all four treatments share *one* color token. The visual differentiation is **pattern** (solid / stripes / no-fill / opacity), not new colors. This is what makes the cardinality affordable — you're not designing four palettes, you're applying one palette four ways.

Two-attribute selectors (`tr[a][b]`, `tr[a]:not([b])`) give you precise per-combo control without adding classes or runtime logic. CSS does the work.

## The Gotcha

The combo state is "free" as data — `Plan=✓ AND Skip=✓` records itself naturally when the user clicks both checkboxes — but **you still have to design what the combo MEANS to the user.** Otherwise it's confusing chrome.

In the OSRS case, the combo emerged with a clear meaning ("later"). The user surfaced the meaning themselves — *"Combo = 'i'll do it, but maybe later'"* — and we wrote that into the visual treatment and the filter toggles. The combo state earned its place.

If we'd shipped two checkboxes without thinking about what the combo meant, users would have hit it accidentally, the row would have looked weird (both colors? one wins? what?), and we'd have a bug.

**Rule:** for an N-axis design, you need a one-line answer to "what does each of the 2ⁿ states mean to the user?" If you can't fill in all 2ⁿ cells of that table, you don't have N orthogonal axes — you have a state machine in denial.

## Reference

- **Plan doc:** [`docs/plans/2026-05-16-plan-skip-two-axis-curation.md`](../plans/2026-05-16-plan-skip-two-axis-curation.md) — full implementation details for the OSRS leagues version (state model, storage keys, CSS, event wiring, verification)
- **Companion report:** [`lane-reframe-design-pivot.md`](./lane-reframe-design-pivot.md) — the multi-session arc that produced this pattern
- **Prior context:** [`tri-state-to-binary-collapse.md`](./tri-state-to-binary-collapse.md) — why we deleted the cycling tri-state in the first place

## Key Takeaways

- **N independent binary axes = 2ⁿ states for free.** Use this when the user's concerns are orthogonal and combinations have natural meaning. Cap at N=2 for table rows; N=3 starts crowding visually.
- **Composable filters are the big win.** Each axis gets its own toggle; toggles compose. A single N-state cycle can only filter to one slice; N axes can filter to any union of slices.
- **One design token, multiple treatments.** Pattern (solid / stripes / fade) differentiates combo states without requiring N new colors. This is what makes the cardinality affordable.
- **Combo states are free as data, not free as design.** You have to define what each of the 2ⁿ combinations means to the user. If you can't fill in the table, you don't have orthogonal axes — you have a state machine.
- **Two-attribute CSS selectors are cleaner than class juggling.** `tr[data-axis-a="1"][data-axis-b="1"]` expresses the combo directly. No classes, no runtime logic, no out-of-sync DOM.
