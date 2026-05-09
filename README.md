# OSRS Wiki — Leagues Task Filters

A Tampermonkey/Violentmonkey userscript that adds proper filtering, search, and stats to the Old School RuneScape Wiki's Leagues task pages. Works on Demonic Pacts (Leagues VI), Raging Echoes (V), Trailblazer Reloaded (IV), and any future `*_League/Tasks` page.

Forked with permission of the MIT license from [Loaf's original "OSRS Wiki - Leagues Task Filters" on Greasy Fork](https://greasyfork.org/scripts/518872) (Trailblazer Reloaded / Raging Echoes only). This fork adds Demonic Pacts support and the changes listed in the [changelog](./CHANGELOG.md).

The wiki's built-in area picker and hide-completed toggle stay where they are — this script reads their state from `localStorage` and respects it. The new panel sits above the task table, styled to match the OSRS browntown theme so it looks native rather than bolted on.

## Install

Install [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey/Greasemonkey), then click this link:

[Install osrs-leagues-task-filters.user.js](https://raw.githubusercontent.com/cameronsjo/osrs-leagues-task-filters/main/osrs-leagues-task-filters.user.js)

Tampermonkey will prompt for confirmation. After install, visit any Leagues tasks page and the filter panel will render above the task table.

Updates are automatic. The script's `@updateURL` points back at this repo's `main` branch, so when a new commit lands here, Tampermonkey picks it up on its next polling pass (usually within a day, or whenever you click the Tampermonkey toolbar icon).

## What you get

A search box at the top filters tasks by name or description as you type — `/` focuses it, `Esc` clears it. Below that, six filter groups: **Difficulty** (Easy / Medium / Hard / Elite / Master), **Task type** (Pact tasks vs Regular tasks for Demonic Pacts), **Skill** (every real OSRS skill plus a synthetic **Clue** entry that matches `clue scroll` / `treasure trail` / `clue` references in the task text — the wiki doesn't tag those, so this surfaces the 49 clue-related tasks that would otherwise be unfilterable by skill), **Status** (Completed / Incomplete via WikiSync), **Points range**, and **Completion %** range.

Filters use OR semantics within a group and AND across groups. So *Karamja + Hard + Magic* means tasks in Karamja AND of Hard difficulty AND requiring Magic. Each group has a small × button to clear just that group; a global "Clear all filters" sits in the panel header.

A live stats bar shows total points available, points completed (when WikiSync is active), and a row counter ("Showing N / 1592 tasks — X pts visible") that updates as you type.

State is persisted to `localStorage` keyed by league name, so your filters and search query survive reloads and don't bleed between leagues.

## What's deliberately not in the panel

The wiki already has a per-area visibility picker (the row of `data-league-area` cells under the task table) and a "hide completed tasks" toggle that WikiSync provides. Reimplementing them would mean two competing UIs writing to the same state. Instead, this script reads the wiki's `wikisync-league-filter-show-<area>` `localStorage` keys on every filter pass and applies them as a hidden mask. If you toggle an area in the wiki's UI, the script picks it up within a second via a poll (cross-tab changes fire a real `storage` event and re-apply immediately). A small note in the panel lists which areas are currently hidden by your wiki preferences, so the cause of any "missing" tasks is never mysterious.

## Compatibility

`@include` patterns match the three known leagues plus a wildcard `*_League/Tasks*` for forward compatibility. The script keys off the table's `[data-taskid]` rows and `data-sort-value` attributes — both have been stable across leagues since at least Trailblazer Reloaded. Difficulty detection works against either the Trailblazer image set or the Demonic Pacts pact-tasks image set; both naming conventions are handled.

No `@require` and no external dependencies. The script reads `window.jQuery` directly from the wiki, which ships its own jQuery 3.7.1. If the wiki's jQuery ever disappears, the script logs a warning and exits cleanly via its `if (!window.jQuery) return` guard. Earlier versions pulled jQuery from jsDelivr defensively, but that surfaced as silent injection failures under Tampermonkey on Edge (MV3) — see the changelog for `2026-05-09.2`.

## Development

Files in this repo:

`osrs-leagues-task-filters.user.js` — the userscript. Single file, no build step.

`osrs-leagues-task-filters.min.js` — minified single-line bundle (~15 KB) for pasting into DevTools console as a one-shot, in case you can't or don't want to install via Tampermonkey. Drop it in the console on a Leagues tasks page and the panel renders.

`CHANGELOG.md` — what changed when. Keep this in sync when bumping `@version`.

There are no dependencies and no build pipeline. Edits to the `.user.js` are live the next time Tampermonkey polls. To regenerate the minified bundle after editing:

```sh
npx terser osrs-leagues-task-filters.user.js \
  --compress passes=2 --mangle --format ascii_only=true \
  -o osrs-leagues-task-filters.min.js
```

(Strip the `// ==UserScript== ... ==/UserScript==` block first if you want a pure body for the minifier — terser tolerates the comment block but won't strip it.)

## Credits

Original "[OSRS Wiki - Leagues 