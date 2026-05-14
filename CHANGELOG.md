# Changelog

All notable changes to this script. Versions follow `YYYY-MM-DD.N` where `N` increments for multiple releases on the same day.

## [2026-05-14.2] — hide blocked tasks (WikiSync qc-not-started)

Added a **Doable** filter group with a single **Hide blocked tasks** checkbox. When enabled, any task row containing a WikiSync `.qc-not-started` marker — i.e., a sub-requirement (quest, skill level, item drop) the player hasn't started — is hidden. The group also shows a live count of blocked tasks so it's clear whether WikiSync has populated the markers yet; when zero, the count reads "none detected (needs WikiSync)" to distinguish "genuinely nothing blocked" from "WikiSync hasn't synced yet."

Integrates the spirit of [zuccc's "Hide 10 point or uncompletable tasks" userscript](https://greasyfork.org/) without bundling its `<=10 pts` removal (our existing points-range filter already covers that). Unlike the source script we don't need a MutationObserver — the existing WikiSync XHR hook (`/runelite/player`) already re-runs `applyFilters` once per sync, by which time `qc-not-started` markers are in the DOM.

Implemented as a new `HIDE_REASONS.BLOCKED` reason. The matcher live-queries the DOM each pass (caching at parse time would go stale because WikiSync injects asynchronously). The toggle is treated as a transient filter — "Clear all filters" turns it off.

`window.LeaguesFilters.state()` now exposes `hideBlocked`.

## [2026-05-14.1] — personal todo list

Added a per-row **todo** checkbox and a matching **Todo list** filter group. Tick the checkbox prefixed inside any task's name cell to add the task to a personal shortlist; flip "Show only marked" in the Todo group to hide everything else. Marked rows get a subtle left-border accent in the wiki link color so they're easy to scan at a glance. The list is stored under `lf:<League_Key>:todo` so each league has its own — your Demonic Pacts shortlist and Trailblazer shortlist don't share state.

Implemented as a dedicated `HIDE_REASONS.SHORTLIST` reason rather than overloading the existing Status group: the in-group OR semantics would have wrongly surfaced unmarked completed/incomplete rows when both were selected. A `Clear list` button inside the Todo group wipes the set after a confirm. "Clear all filters" turns off the "Show only marked" toggle but **leaves the list intact** — the shortlist is curated work, not a transient filter, and shouldn't get nuked alongside a search reset.

`window.LeaguesFilters.state()` now exposes `todo` (count) and `todoOnly` (bool) for debugging.

## [2026-05-09.4] — more synthetic pseudo-skills + per-group "select all"

Added five new synthetic pseudo-skills to the **Skill** filter group, on top of the existing **Clue**: **Combat Achievement**, **Collection Log**, **25M XP**, **35M XP**, **50M XP**. Like Clue, these activities have no `data-skill` attribute on the wiki, so they're detected by regex against task name and description. Counts on the Demonic Pacts page (verified live): Clue 49, Combat Achievement 51, Collection Log 23, 25M XP 19, 35M XP 19, 50M XP 24. The detection table is now a single `SYNTHETIC_SKILLS` const, so adding more later is one line.

Added a **✓ "Select all"** button to each checkbox-based filter group's header (Difficulty, Task type, Skill, Status), next to the existing × clear button. Use it to flip a group from "include these" to "exclude these": click ✓ to check everything, then uncheck the ones to exclude. Common case: "show me everything except Master tier" → click ✓ on Difficulty, uncheck Master.

## [2026-05-09.3] — re-add `@require` jQuery (post-Edge-dev-mode fix)

Edge's "Developer mode" toggle in `edge://extensions/` was the actual gate for Tampermonkey/Violentmonkey to inject scripts at all — none of the metadata changes in `2026-05-09.1` or `.2` were strictly necessary, though they did harden the script. With developer mode on, injection works.

But running under Violentmonkey-style isolated-world sandbox (which `@grant GM_addStyle` triggers), the script body crashed with `TypeError: $ is not a function` at `$(document).ready(...)`. In the sandbox, `window.jQuery` is a `Proxy` that exposes the page's jQuery — readable, but cross-context function objects aren't always callable from the isolated world. Re-introducing `@require` loads jQuery directly into the sandbox so `$` is a real, callable function in the same context as the script.

Net effect: keep the sandbox grant + `document-end` + `@match` from `.1`, restore the `@require` from `.2`. The earlier removal was a wrong inference — we'd ruled out @require as the cause of the injection failure based on incomplete diagnostic data; the actual failure mode was Edge developer mode, not the @require fetch.

## [2026-05-09.2] — drop `@require` jQuery (later reverted in .3)

Removed `@require https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js`. The `2026-05-09.1` metadata changes weren't enough to fix Tampermonkey-on-Edge injection. A Playwright Chromium run injecting the bundle directly into the page confirmed the script body works end-to-end — 1592 tasks indexed, panel rendered, all logs clean — proving the bug was in Tampermonkey's extension-side handling of this script, not in the script itself.

The most likely remaining cause was Tampermonkey's separate extension-context fetch of the `@require` URL failing silently under Edge's MV3 model. Removing the `@require` eliminates that failure mode entirely. The OSRS wiki ships its own jQuery 3.7.1 (verified via Playwright on the live page) and the script's existing `if (!window.jQuery) return` guard logs and bails gracefully if it ever disappears, so this is a pure simplification — fewer external dependencies, faster load, no cross-CDN extension-network surface.

## [2026-05-09.1] — Edge injection fix

Fixed the script silently failing to run under Tampermonkey on Microsoft Edge ("This script hasn't run yet" with no error). The script was matched and jQuery loaded fine; the issue was Edge's MV3 extension model interacting poorly with the metadata block.

Three metadata changes:

`@grant none` → `@grant GM_addStyle`. Forces Tampermonkey into sandboxed extension-context injection instead of inline page-context injection. The sandbox still has access to `window.jQuery` from the wiki, so the script body is unchanged. Declaring any non-`none` grant flips the injection mode; `GM_addStyle` is declared but unused.

`@run-at document-idle` → `@run-at document-end`. Fires earlier and avoids racing the wiki's deferred analytics/ad scripts. The script's existing init already waits for `[data-taskid]` rows, so moving up `@run-at` is safe.

`@include` → `@match`. Stricter, better-supported across browsers. Dropped the `*_League/Tasks*` wildcard since `@match` doesn't allow `*` mid-path. Future leagues will need a metadata bump rather than auto-matching — a fair trade for portability.

## [2026-04-25.7] — initial public release

Forked from Loaf's original Trailblazer Reloaded / Raging Echoes script and substantially extended.

Added Demonic Pacts (Leagues VI) support and a generic `*_League/Tasks*` `@include` so future leagues work without code changes. The filter UI is now built dynamically from the table contents instead of relying on the wiki-side `Template:Sandbox/User:Loaf/AllCustomFilters` template, so it doesn't break when the template lags behind a new league.

Added a synthetic **Clue** pseudo-skill in the Skill filter, detected via regex on task name and description (`clue scroll` / `treasure trail` / `clue`). Catches the 49 clue-related tasks that have no `data-skill` attribute.

Added the **Task type** filter (Pact tasks vs Regular tasks) for Demonic Pacts, distinguished by which difficulty image set the row uses.

Replaced the original to-do column with the wiki's native completed/incomplete state via WikiSync.

Added free-text search over name + description with `/` to focus, `Esc` to clear, debounced 120 ms.

Added points-range and completion-percent-range numeric filters with × reset buttons. Completion clamps values >100% (the wiki sometimes shows 100.2% due to rounding).

Added a stats bar showing total points, completed points, and visible-rows percentage.

Per-league `localStorage` persistence (filters, search, ranges) keyed by league name, so DPL state doesn't clobber Trailblazer state.

Honors the wiki's native area picker via the `wikisync-league-filter-show-<area>` keys instead of duplicating it. Cross-tab `storage` events and a 1 s same-tab poll keep the mask in sync. A small note in the panel surfaces which areas the wiki is hiding.

Stops hiding the wiki's native "hide completed" toggle. Inline `display` is only set on hidden rows (`display: none`); visible rows have it cleared so wiki-driven CSS still applies.

Themed to match the OSRS browntown wiki aesthetic — uses live `--wikitable-border`, `--wikitable-header-bg`, `--body-light`, `--body-mid`, `--text-color`, and `--link-color` CSS variables, with palette fallbacks. Inherits `IBM Plex Sans` from the wiki body. Dark mode follows automatically.

Added boot diagnostics: every phase logs to console, top-level try/catch surfaces errors as a parchment-themed error block above the table, and `window.LeaguesFilters.state()` exposes runtime state for debugging.

Switched `@require` to jsDelivr's pinned jQuery 3.7.1.

## Original (Loaf, 2024-11-27.3)

Initial Tampermonkey userscript "[OSRS Wiki - Leagues Task Filters](https://greasyfork.org/scripts/518872)" by [Loaf](https://oldschool.runescape.wiki/w/User:Loaf), published on Greasy Fork in November 2024 — to-do list column, region/difficulty/skill filteri