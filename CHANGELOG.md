# Changelog

All notable changes to this script. Versions follow `YYYY-MM-DD.N` where `N` increments for multiple releases on the same day.

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