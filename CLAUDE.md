# CLAUDE.md

Userscript that adds filtering, search, and stats to the OSRS Wiki's Leagues task pages. Forked from Loaf's original; this fork adds Demonic Pacts support and substantial UI.

## Repo shape

Two source files, no build pipeline.

- `osrs-leagues-task-filters.user.js` — the userscript. Edit this. Single IIFE, ~700 lines.
- `osrs-leagues-task-filters.min.js` — minified single-line bundle. Regenerate after editing the source. Used as a one-shot console-paste alternative for users who can't install via Tampermonkey.
- `CHANGELOG.md` — every release. Keep in sync with `@version` bumps.
- `PUBLISH.md` — release flow (it's just `git push`; Tampermonkey watches `main`).
- `README.md` — user-facing install + features.

## Release flow

Edit source → bump `@version` (format `YYYY-MM-DD.N`) → update CHANGELOG → regenerate min → commit → push to `main`. Tampermonkey's `@updateURL` points at `raw.githubusercontent.com/.../main/osrs-leagues-task-filters.user.js` so existing installs auto-update on its next polling pass.

```sh
npx --yes terser osrs-leagues-task-filters.user.js \
  --compress passes=2 --mangle --format ascii_only=true \
  -o osrs-leagues-task-filters.min.js
```

If only the metadata block changed (no script-body changes), `min.js` will be byte-identical — terser strips the `==UserScript==` block. Don't be surprised if the diff is empty after regenerating.

## Userscript-manager gotchas

These are not derivable from the code; they're environmental.

- **Edge requires "Developer mode"** in `edge://extensions/` for any userscript manager to inject. If Tampermonkey says "This script hasn't run yet" with the script matched and no console error, this is almost always why.
- **`@grant` controls injection mode.** `@grant none` = page-context (script shares `window` with the page directly). Any non-`none` grant = sandbox/isolated-world. We use `@grant GM_addStyle` (declared but unused) to force sandbox mode, which is required on Edge MV3 + Violentmonkey.
- **`window.jQuery` from the sandbox is a `Proxy`.** It's readable but not always *callable* across contexts — hence we `@require` jQuery to load it directly into the sandbox so `$()` is a real callable function in the same context as the script. The existing `if (!window.jQuery) return` guard logs a warning and bails cleanly if the require ever fails.
- **`@match` over `@include`.** Stricter, better-supported. `@match` does not allow `*` mid-path, so new leagues need a metadata bump (no `*_League/Tasks*` wildcard).

## Per-row event handlers

The wiki binds direct click handlers on every `<tr data-taskid>` (WikiSync's row-toggle feature) that call `event.stopPropagation()` during bubble. **jQuery's `.on('click', selector, handler)` delegation at the table level fails silently** — the click reaches the target but never bubbles back up. Two ways out:

- **Native `addEventListener('click', handler, true)`** on the table — capture phase fires on the way *down*, before the TR can intercept. Pair with `e.stopPropagation()` inside the handler to keep the row's own click handler from firing too.
- **`change` event on form controls** — `change` events from `<input type="checkbox">` bubble independently of `click`, so they're unaffected by the row's click `stopPropagation`. Capture phase still recommended for consistency.

See `docs/field-reports/capture-phase-vs-row-stoppropagation.md` for the full debugging arc.

## Verification

There's no test suite. Verification is via Playwright against the live wiki:

```js
// In a Playwright session:
await page.goto('https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Tasks');
await page.addScriptTag({ path: '/path/to/osrs-leagues-task-filters.min.js' });
await page.waitForTimeout(2500);
await page.evaluate(() => window.LeaguesFilters.state());
```

`window.LeaguesFilters.state()` exposes `{ league, tasks, skills, difficulties, wikiHiddenAreas, activeFilters, panelInDom }` — useful for asserting parse correctness without scraping the DOM.

The script logs `[Leagues Filters] script loaded` → `boot — url: ...` → `found N task rows` → `ready — <League> · N tasks · K skills · wiki-hiding M` on a clean run. Absence of any of these in the console signals where it broke.

## Conventions

- **Single IIFE, top-down**. Constants → state → helpers → builders → event handlers → boot. No modules, no transpilation, no jQuery alternative.
- **Synthetic skills** (Clue, Combat Achievement, Collection Log, 25M/35M/50M XP) live in the `SYNTHETIC_SKILLS` table — `[label, regex]` pairs. Add new ones there; `parseTasks` picks them up automatically.
- **Filter semantics**: OR within a group, AND across groups. Each checkbox group gets a ✓ (select all — useful for treating as exclusion) and × (clear) button.
- **Persistence**: `localStorage` keys are prefixed `lf:<League_Key>:` so DPL state doesn't bleed into Trailblazer state. Filters, search, and ranges all persist; clearing requires the per-group × or the global "Clear all filters" button.
- **Wiki integration**: don't reimplement the wiki's area picker or hide-completed toggle. Read their `localStorage` keys (`wikisync-league-filter-show-<area>`, `wikisync-hide-completed`) and apply as a hidden mask. Cross-tab `storage` events + 1 s same-tab poll keep the mask in sync.
- **Theming**: use the wiki's CSS custom properties (`--wikitable-border`, `--body-mid`, `--text-color`, etc.) with hex fallbacks. Dark mode follows automatically.

## Adding a new synthetic pseudo-skill

1. Add a `[label, regex]` entry to `SYNTHETIC_SKILLS` near the top of the file.
2. The regex runs against ``${name} ${description}`` of every task row, case-insensitive.
3. No other code changes needed — the filter UI and stats wire up automatically.

## Adding support for a new league

1. Add a `@match https://oldschool.runescape.wiki/w/<New_League>_League/Tasks*` line to the metadata block.
2. Bump `@version`, update CHANGELOG, regenerate min.
3. The script auto-detects the league from the URL pathname, so no other code changes — assuming the new league reuses the standard `[data-taskid]` table structure (check by visiting the page and confirming rows have `data-taskid`).

## Field reports

Longer narrative writeups of past sessions live in `docs/field-reports/`. Check these first if your work overlaps:

- `capture-phase-vs-row-stoppropagation.md` — why event handlers on rows silently disappear, and the capture-phase fix.
- `tri-state-to-binary-collapse.md` — design conversation about why the Plan column went from tri-state (todo/won't-do/untouched) to binary (todo/untouched). Useful before adding curation states.
