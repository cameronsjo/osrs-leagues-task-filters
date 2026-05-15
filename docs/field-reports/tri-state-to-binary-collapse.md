# Tri-state to binary — when the third state doesn't match how users think — Field Report

**Date:** 2026-05-14
**Type:** architecture
**Project:** osrs-leagues-task-filters

## Goal

A per-row Plan affordance for the OSRS leagues task table. The user wanted to mark which tasks they intended to do — a personal shortlist on top of the wiki's existing complete/incomplete state. The first build expanded the brief: tri-state cycling button (untouched / todo / won't-do) with separate filter toggles for "show only my todo list" and "hide won't-do tasks," exported markdown grouped by area, the works. It shipped, looked clean, passed all the Playwright probes — and within the next reply the user wanted to delete a third of it.

## The Design Choice We Made First

Three glyphs in a cycling button: ☐ → ✓ → ✗ → ☐. Two disjoint Sets — `todoSet` and `wontDoSet`. Two filter toggles — "show only my todo list" and "hide won't-do tasks." Two row-tint colors — Okabe-Ito teal (`#007a5e`) at 14% alpha for todo, warm vermillion (`#b85e1a`) at 18% for won't-do, both colorblind-safe. The cycling button used the same hues for the glyph at full saturation.

It was reasonable on paper. The state model carried real information — "I want to do this" vs "I've explicitly decided not to" vs "I haven't thought about it yet" — and the visual treatment differentiated the two action states with distinct hues that hold up under colorblindness.

## The Conversation That Killed It

The user, mid-session, threw out a thought experiment:

> Thought experiment. Do I consider "wont do" as "ignore" or "ignore for now"? Is that a new state? maybe just a default 'hidden'?

This was the canary moment. The user had a working tri-state and the *labels* didn't sit right with them. Not the implementation — the semantics.

The response framed three directions:

1. **Just relabel** — `✗` becomes "Skip" or "Ignore," same plumbing, lighter tone
2. **Collapse to two states** — drop the third state entirely, add a "hide this" affordance elsewhere
3. **Add a fourth: "Later"** — strictly more expressive, more cognitive load

Recommendation was (1): the tri-state shape is right, just stop pretending the third state is a final judgment.

The user's reply:

> I think the two states is fine. It's kind of a gold on gold right now. it'd better if it was more of a styled checkbox instead of appearing like buttons that change

Two signals in that message:

- **Semantic.** "Two states is fine" — they don't want the third state at all, not even relabeled. The expressive power was a cost not a benefit.
- **Visual.** "Gold on gold" — the warm vermillion on the warm parchment palette was muddy. The colors weren't fighting each other so much as *blending*. And the cycling-button mechanic visually read as "this is a button I keep pressing" rather than "this is the state of this row."

## What Was Actually Wrong

In a time-boxed event like OSRS Leagues, players don't *decide* not to do tasks. They triage attention. "Won't do" implies a commitment most players never actually make — a closing of a door — when what they're actually doing is "I'm not thinking about this right now." The third state was modeling a mental motion the user wasn't performing.

The visual signal was the canary, not the problem. Vermillion on parchment is muddy because it's *trying* to communicate something the user wasn't asking it to. Once the third state went, the second color went with it, and "gold on gold" stopped happening on its own. We didn't fix the colors; we deleted what they were trying to express.

This is the architecture lesson: when your UI feels visually noisy, *sometimes* the right move is a palette tweak. Sometimes the noise is information the model is straining to encode that the user didn't ask for. The model is wrong, not the colors.

## What We Kept

- The Plan column itself, at the end of the table. The placement decision (last column, not first) was already validated by the wiki's column-sizing behavior.
- The single Okabe-Ito teal accent, now load-bearing for both the checkbox fill and the row tint.
- The `:not(.wikisync-completed)` guard on the row tint so WikiSync's existing completed treatment wins when both apply.
- The markdown export. The capture-phase event handler. The filter toggle. All orthogonal to the state model.

## What We Cut

| Cut | Lines removed |
|---|---|
| `wontDoSet` state + `LS.wontDo` storage key + `saveWontDo` | ~6 |
| `hideWontDo` flag + `LS.hideWontDo` + `saveHideWontDo` | ~4 |
| `HIDE_REASONS.WONT_DO` + `matchesWontDo` + applyFilters wiring | ~3 |
| `cyclePlanState`, `PLAN_GLYPHS`, `PLAN_LABELS` | ~10 |
| `planButtonHTML` (replaced by `planCheckboxHTML`) | reshaped |
| "Hide won't-do tasks" filter checkbox in panel HTML | ~3 |
| Vermillion palette tokens (`--lf-plan-skip*`) | ~3 |
| Won't-do row tint + hover CSS | ~6 |
| Dual count text ("N todo · M won't-do" → "N tasks marked") | simpler |

Net: -42 lines. The diff was almost entirely deletions, plus the checkbox restyle. Existing localStorage entries for `lf:<League>:wontDo` and `lf:<League>:hideWontDo` from earlier versions are orphaned but harmless — the script no longer reads them.

## The Restyle

The cycling button mechanic disappeared along with the tri-state. The replacement is a real `<input type="checkbox">` with `appearance: none`, painted as a parchment-themed checkbox: hollow square at rest, teal fill with a white check when ticked. Hover and focus-visible both ring it in `--lf-plan-go`.

The user's phrasing — "a styled checkbox instead of appearing like buttons that change" — got at something specific. A button that changes glyph reads as *action* (you press it, it changes). A checkbox reads as *state* (the box reflects whether the thing is set). The same data flip, but the affordance maps to a different mental model. For "is this task on my list?" the state framing is the right one.

## Decisions Made

| Decision | Rationale |
|---|---|
| Drop won't-do entirely (not just relabel) | The user said "two states is fine" — overshooting toward expressiveness when the user is asking for less is a regression. Relabel was MY recommendation; collapse was theirs. |
| Restyle as `<input type="checkbox">` not styled `<button>` | Form control = state, button = action. The semantic mismatch was part of why the cycling glyph felt off. Also: free keyboard support, free ARIA, free `change` event. |
| Keep the single teal row tint | "Like WikiSync completed" was an earlier user instruction. With only one state to express, single tint at 14% alpha sits comfortably on parchment. No more gold-on-gold. |
| Leave orphaned localStorage keys alone | A cleanup pass would touch every user's storage for no functional gain. The script ignoring them is the right migration story. |
| Don't move the column back to the front | The "first column" attempt had been rejected the iteration before. The fix shipped (move to last). No reason to revisit during this collapse. |

## Gotchas

- **Visual noise can be the symptom, not the problem.** When the user says "the colors aren't working," ask whether the colors are *trying* to encode something the user isn't asking for. The wrong colors are sometimes the right tell that the wrong amount of information is being shown.
- **"More expressive" is not the same as "more useful."** Tri-state vs binary is a real expressive gap — you can encode strictly more — but expressiveness costs cognition and visual real estate. For short-lived contexts (event tasks, sprint planning, day-of work), simpler maps better to how users actually think.
- **Be willing to delete features you just shipped.** The tri-state had passed all its tests, demoed cleanly, and the CHANGELOG entry was already pushed. None of that obligated us to keep it. The cost of deletion (a follow-up commit) was much lower than the cost of carrying a feature whose semantics didn't hold.
- **The user knows what mental motion they're performing.** "Won't do" sounded right when *I* described it. It didn't sound right when the *user* asked themselves what they meant. Designers can write plausible labels for states users would never want to enter.
- **Form control choice carries semantics.** Button means action, checkbox means state, radio means choice-among-options. Picking the wrong control creates friction even when the underlying mechanic is identical.

## Key Takeaways

- **When in doubt about how a feature feels, ask what mental motion the user is performing.** "Won't do" is a commitment; "skip for now" is triage; "out of my view" is filtering. These look similar in code and feel completely different in use. Match the model to the motion.
- **Treat visual muddiness as a diagnostic for model over-reach, not just a styling problem.** If you're working hard to make two colors coexist on a palette, ask whether you should be encoding two things at all.
- **For curation UI in short-lived contexts, default to binary state.** Time-boxed events, sprint backlogs, week-of-work lists — players are triaging attention, not making decisions. Decisional states (commitments, judgments) add cognitive cost the user doesn't want to pay.
- **Pick the form control that matches the motion.** `<button>` for action, `<input type="checkbox">` for state, `<select>` for choosing among options. `appearance: none` lets you paint any of them however you want; the semantic choice is independent of the visual one and is worth getting right.
- **A clean deletion is a feature.** -42 lines of code, fewer storage keys, simpler filter group, no migration headache. Ship the simpler version even if you just spent an hour on the more elaborate one.

## Commits

- `d4aa30c` — tri-state Plan column with won't-do + markdown export + panel polish (the shipped version that got deleted)
- `eeb3162` — collapse to binary, restyle Plan as real checkbox (the simpler version that replaced it, same session)
