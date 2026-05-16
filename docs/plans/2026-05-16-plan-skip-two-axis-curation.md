# Plan: Plan + Skip — two-axis curation with planning math

## Context

The script today is well-shipped as a *filter* tool, but Cameron's actual workflow is *planning* — he picks tasks to hit specific point thresholds for Relics, Areas, and Pact unlocks in Leagues VI. The existing single Plan checkbox column doesn't quite serve this: there's no point sum for the plan, no way to exclude tasks he won't do (raids, etc.) from the available pool, and no way to soft-defer tasks for later.

This change recasts the per-row curation as **two orthogonal binary axes**:

| Plan column | Skip column | Meaning | Visual |
|---|---|---|---|
| ☐ | ☐ | Default | no tint |
| ✓ | ☐ | **Plan-strict** — active focus | teal tint (existing pattern) |
| ☐ | ✗ | **Excluded-strict** — off the table | faded when peeked |
| ✓ | ✗ | **Later** — deferred but kept in mind | diagonal teal stripes |

Four states fall out of two checkboxes for free. The user gets a real "later" affordance without a third column or cycling button. Three filter toggles in the Todo group surface each state independently (`Show only my plan`, `Show "later" tasks`, `Show excluded tasks`). Three new stat pills (Plan / Pool / Excluded) give the user the point math they need to plan against goals without hardcoding the league's unlock ladder.

## Files

- **`osrs-leagues-task-filters.user.js`** — primary
- **`osrs-leagues-task-filters.min.js`** — regenerate via terser per CLAUDE.md
- **`CHANGELOG.md`** — new entry under `2026-05-16.1`
- **`@version`** metadata line — bump to `2026-05-16.1`

## Storage

Add to the existing `LS` object (`osrs-leagues-task-filters.user.js:36`):

```js
LS.excluded     = `${STORAGE_PREFIX}excluded`;     // JSON array of task IDs in Skip
LS.showLater    = `${STORAGE_PREFIX}showLater`;    // "1"/"0" — show Later rows
LS.showExcluded = `${STORAGE_PREFIX}showExcluded`; // "1"/"0" — show strict-excluded rows
```

Keep existing `todo` / `todoOnly` / `hideBlocked` keys — they continue to serve. Existing user data carries forward; no migration needed.

## State

Add alongside `todoSet`, `todoOnly`, `hideBlocked`:

```js
let excludedSet  = new Set();
let showLater    = false;
let showExcluded = false;
```

Load in `loadState()`; add `saveExcluded` / `saveShowLater` / `saveShowExcluded` helpers next to the existing `saveTodo` family.

## Per-row state derivation (helper)

A small helper near `getPlanState` to derive the four-state bucket from two sets:

```js
const STATE_DEFAULT = 0, STATE_PLAN = 1, STATE_EXCLUDED = 2, STATE_LATER = 3;
const getPlanState = (id) => {
  const p = todoSet.has(id);
  const s = excludedSet.has(id);
  if (p && s) return STATE_LATER;
  if (p)      return STATE_PLAN;
  if (s)      return STATE_EXCLUDED;
  return STATE_DEFAULT;
};
```

Drives row-attribute application and stat aggregation. No combo-flag math sprinkled through callers.

## HIDE_REASONS additions

```js
HIDE_REASONS.LATER    = 'L';   // hidden because Later state and showLater is off
HIDE_REASONS.EXCLUDED = 'x';   // hidden because Excluded state and showExcluded is off
```

Keep existing `SHORTLIST: 't'` — its meaning sharpens from "hide tasks not in todoSet" to "hide non-strict-plan tasks when todoOnly is on."

## Matcher: single `matchesPlanState` that owns all four-state visibility

Replace `matchesTodo`. The new matcher handles the three filter toggles in one place:

```js
const matchesPlanState = (task) => {
  const st = getPlanState(task.id);
  if (todoOnly) {
    // Plan-only mode: strict plan always shows; later shows iff showLater; default/excluded hidden
    if (st === STATE_PLAN)     return true;
    if (st === STATE_LATER)    return showLater;
    return false;
  }
  // Normal mode: defaults and strict-plan always; later/excluded gated by their toggles
  if (st === STATE_LATER)    return showLater;
  if (st === STATE_EXCLUDED) return showExcluded;
  return true;
};
```

In `applyFilters` (line ~258), replace the existing `matchesTodo(task)` check. Push the appropriate hide-reason code based on the failing case (LATER vs EXCLUDED vs SHORTLIST). One simple way:

```js
if (!matchesPlanState(task)) {
  const st = getPlanState(task.id);
  reasons.push(
    st === STATE_LATER    ? HIDE_REASONS.LATER    :
    st === STATE_EXCLUDED ? HIDE_REASONS.EXCLUDED :
                            HIDE_REASONS.SHORTLIST
  );
}
```

## Per-row UI: Plan + Skip columns

Update `injectPlanColumn` (line ~150) to append **two** columns at the end of the table. Both styled checkboxes, same 18px square shape, differentiated by checked-state fill:

### Headers
```html
<th class="lf-plan-col" scope="col" title="Plan this task">Plan</th>
<th class="lf-skip-col" scope="col" title="Skip this task">Skip</th>
```

### Per-row cells
```html
<td class="lf-plan-col" data-sort-value="${planSort}">
  <input type="checkbox" class="lf-plan" data-lf-plan-id="${id}"${plan ? ' checked' : ''} aria-label="Plan this task"/>
</td>
<td class="lf-skip-col" data-sort-value="${skipSort}">
  <input type="checkbox" class="lf-skip" data-lf-skip-id="${id}"${skip ? ' checked' : ''} aria-label="Skip this task"/>
</td>
```

### Row attributes (replaces `data-lf-todo`)
```html
<tr data-taskid="3" data-lf-plan="1" data-lf-skip="0">  <!-- plan-strict -->
<tr data-taskid="5" data-lf-plan="0" data-lf-skip="1">  <!-- excluded -->
<tr data-taskid="7" data-lf-plan="1" data-lf-skip="1">  <!-- later -->
```

Two booleans on the `<tr>` directly. CSS combines them with selectors:

- `tr[data-lf-plan="1"]:not([data-lf-skip="1"])` → plan-strict
- `tr[data-lf-skip="1"]:not([data-lf-plan="1"])` → excluded-strict
- `tr[data-lf-plan="1"][data-lf-skip="1"]` → later

The `applyPlanRowAttr` helper (line ~177) gets a sibling `applySkipRowAttr` (or merge into a single `applyRowState(id)` that sets both based on current sets). Cleanest is the merged version since both attrs derive from the same source of truth.

## CSS additions

Lean on the existing token system. Reuse `--lf-plan-go` and `--lf-plan-go-bg`/`--lf-plan-go-bg-hover` from `2026-05-14.5`. Add one new token for the Skip checkbox fill:

```css
#${FILTERS_ID}, #${TABLE_ID} {
  /* existing --lf-plan-go and friends... */
  --lf-plan-skip:    var(--wikitable-border, #94866d);  /* parchment-brown — neutral, lives in palette */
  --lf-plan-skip-bg: rgba(148, 134, 109, 0.18);
}
```

### Skip column dimensions (mirror Plan column)
```css
#${TABLE_ID} th.lf-skip-col,
#${TABLE_ID} td.lf-skip-col {
  width: 44px;
  min-width: 44px;
  text-align: center;
  padding: 4px 2px;
}
#${TABLE_ID} th.lf-skip-col {
  font-size: 0.75em;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
```

### Skip checkbox styling — mirror `input.lf-plan` rule shape, swap fill
```css
input.lf-skip {
  appearance: none;
  -webkit-appearance: none;
  margin: 0;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1px solid var(--lf-border);
  background: var(--lf-body-light);
  display: inline-block;
  vertical-align: middle;
  position: relative;
  cursor: pointer;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);
  transition: background var(--lf-transition), border-color var(--lf-transition);
}
input.lf-skip:hover { border-color: var(--lf-plan-skip); }
input.lf-skip:focus-visible {
  outline: 2px solid var(--lf-plan-skip);
  outline-offset: 2px;
}
input.lf-skip:checked {
  background: var(--lf-plan-skip);
  border-color: var(--lf-plan-skip);
}
input.lf-skip:checked::after {
  content: '✗';   /* ✗ */
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
}
```

### Row tints — extend the existing pattern
Replace the current `tr[data-lf-todo="1"]` rule with two-attribute selectors:

```css
/* Plan-strict — teal solid (existing pattern, new selector) */
tr[data-lf-plan="1"]:not([data-lf-skip="1"]):not(.wikisync-completed) {
  background-color: var(--lf-plan-go-bg);
}
tr[data-lf-plan="1"]:not([data-lf-skip="1"]):not(.wikisync-completed):hover {
  background-color: var(--lf-plan-go-bg-hover);
}

/* Later — diagonal teal stripes; reads as "marked but parked" */
tr[data-lf-plan="1"][data-lf-skip="1"]:not(.wikisync-completed) {
  background-image: repeating-linear-gradient(
    45deg,
    rgba(0, 122, 94, 0.13),
    rgba(0, 122, 94, 0.13) 6px,
    transparent 6px,
    transparent 12px
  );
}

/* Strict-excluded (visible when showExcluded is on) — fade non-Plan/Skip cells */
tr[data-lf-skip="1"]:not([data-lf-plan="1"]):not(.wikisync-completed) > td:not(.lf-plan-col):not(.lf-skip-col) {
  opacity: 0.45;
}
```

The `:not(.wikisync-completed)` guard stays on all of them so the wiki's own completion treatment wins when both apply.

## Filter group changes

Rename the group title from "Todo list" to "Plan" — matches the column header and the user's reframed vocabulary. Internal `data-lf-group="todo"` stays (no churn on event handlers / CSS rules).

```html
<div class="lf-group" data-lf-group="todo">
  <h4>Plan
    <span class="lf-group-actions">
      <button type="button" data-lf-export-md title="Copy your plan as markdown">Export</button>
      <button type="button" data-lf-clear-todo title="Clear plan + excluded lists">Clear</button>
    </span>
  </h4>
  <div class="lf-options">
    <label for="lf-todo-only"><input type="checkbox" id="lf-todo-only" ${todoOnly ? 'checked' : ''}/> Show only my plan</label>
    <label for="lf-show-later"><input type="checkbox" id="lf-show-later" ${showLater ? 'checked' : ''}/> Show “later” tasks</label>
    <label for="lf-show-excluded"><input type="checkbox" id="lf-show-excluded" ${showExcluded ? 'checked' : ''}/> Show excluded tasks</label>
    <div id="lf-todo-count"></div>
    <div id="lf-export-toast" class="lf-toast" aria-live="polite"></div>
  </div>
</div>
```

`updateTodoCount` now derives the four buckets:

```js
const plan     = [...todoSet].filter(id => !excludedSet.has(id)).length;
const later    = [...todoSet].filter(id =>  excludedSet.has(id)).length;
const excluded = [...excludedSet].filter(id => !todoSet.has(id)).length;
// Display, ordered, blanks suppressed
```

Text format: `"3 planned · 2 later · 5 excluded"` — with parts skipped when zero. All zero → `"nothing curated"`.

## Stats pills — three additions

Update `updateStatus` (line ~528) to compute and render three new pills after the existing Total / Completed. Compute in the same `forEach` pass in `applyFilters` (no separate iteration):

```js
let planPts = 0, excludedPts = 0;
tasks.forEach((task) => {
  // ... existing accumulators
  const st = getPlanState(task.id);
  if (st === STATE_PLAN)     planPts += task.points;
  if (st === STATE_EXCLUDED) excludedPts += task.points;
  // ...
});
// Pool = total - excluded-strict (Later still counts as "available consideration")
const poolPts = totalPts - excludedPts;
```

Pills rendered into `#${STATS_ID}`:

```html
<span class="lf-stat-pill"><strong>Total:</strong> 8,530 pts</span>
<span class="lf-stat-pill"><strong>Completed:</strong> 1,250 pts (14.6%)</span>
<span class="lf-stat-pill"><strong>Plan:</strong> 450 pts</span>
<span class="lf-stat-pill"><strong>Pool:</strong> 8,330 pts</span>
<span class="lf-stat-pill"><strong>Excluded:</strong> 200 pts</span>
```

Auto-wrap via existing `inline-block + margin-right` styling.

## Event wiring

In `wireUp()`:

1. **`input.lf-plan` change** — already exists. No change needed.
2. **`input.lf-skip` change** (new) — capture-phase, same shape as plan. The wiki's row click `stopPropagation` doesn't affect `change` events from form controls, but capture phase is the established pattern (see `docs/field-reports/capture-phase-vs-row-stoppropagation.md`).

   ```js
   tableEl.addEventListener('change', (e) => {
     const cb = e.target;
     if (!cb?.matches?.('input.lf-skip')) return;
     const id = cb.getAttribute('data-lf-skip-id');
     if (cb.checked) excludedSet.add(id);
     else excludedSet.delete(id);
     saveExcluded();
     applyRowState(id);  // updates BOTH data-lf-plan and data-lf-skip attrs from sets
     applyFilters();
   }, true);
   ```

3. **`#lf-show-later` change** — toggles `showLater`, saves, applies.
4. **`#lf-show-excluded` change** — toggles `showExcluded`, saves, applies.
5. **Defensive `click` stopPropagation** on `input.lf-skip` (mirror existing for plan).
6. **`[data-lf-clear-todo]`** — extend confirm to mention both sets, clear both, apply.

   ```js
   const planN = todoSet.size, skipN = excludedSet.size;
   if (planN + skipN === 0) return;
   if (!window.confirm(`Clear all personal markers (${planN} on plan + ${skipN} excluded)?`)) return;
   todoSet.clear(); excludedSet.clear();
   saveTodo(); saveExcluded();
   // un-attribute all rows, re-apply
   ```

## Clear-all behavior

`#lf-clear-all` already preserves `todoSet`. Extend the same restraint to `excludedSet`:

- Reset: `todoOnly`, `showLater`, `showExcluded`, `hideBlocked`, all the existing transient filter state
- Preserve: `todoSet`, `excludedSet`

## Markdown export

The `Export` button copies the user's **strict plan** (not later, not excluded) as a checklist grouped by area. Same format as before:

```markdown
# Demonic Pacts League — Plan
*Generated 2026-05-16 · 3 tasks · 80 pts*

## Asgarnia
- [ ] **Hard** · 30 pts · Catch a Black Salamander
```

Building the list filters `todoSet` to strict-only (`id => !excludedSet.has(id)`). Later tasks are private deferrals — not part of the share. Title changes from `— Todo` to `— Plan`.

## Debug handle

Extend `window.LeaguesFilters.state()`:

```js
{
  // existing fields...
  plan:     [...todoSet].filter(id => !excludedSet.has(id)).length,
  later:    [...todoSet].filter(id =>  excludedSet.has(id)).length,
  excluded: [...excludedSet].filter(id => !todoSet.has(id)).length,
  todoOnly, showLater, showExcluded, hideBlocked,
}
```

Drops `todo: todoSet.size` (replaced by the more useful breakdown).

## Critical existing code to reuse

- **`getPlanState`** scaffolding at `osrs-leagues-task-filters.user.js:160` — the slot exists; rewrite the body for 4-state derivation
- **`applyPlanRowAttr`** at `osrs-leagues-task-filters.user.js:177` — generalize to `applyRowState(id)` that updates both columns from sets
- **`HIDE_REASONS`** at `osrs-leagues-task-filters.user.js:83` — extend, don't replace
- **`applyFilters`** at `osrs-leagues-task-filters.user.js:258` — keep structure; replace one matcher call, add stat accumulators in the same forEach pass
- **`injectPlanColumn`** at `osrs-leagues-task-filters.user.js:150` — append both columns (Plan exists; Skip is new)
- **`updateStatus`** at `osrs-leagues-task-filters.user.js:528` — extend the inner pill HTML
- **`buildPanel`** group-rendering — match existing pattern for the new filter checkboxes
- **`--lf-plan-go` / `--lf-plan-go-bg` tokens** — already defined; reuse for plan-strict and later

## Verification

Live Playwright run against `https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Tasks` per CLAUDE.md verification block. Specific checks:

1. **Boot:** console logs `script loaded` → `boot` → `found 1592 task rows` → `ready —`. Panel renders. Plan AND Skip columns appended at end of table.
2. **Per-row interactions:**
   - Click `input.lf-plan` on row id=3 → `todoSet` gains "3", `data-lf-plan="1"` on `<tr>`, row gets teal tint, Plan pill in stats updates.
   - Click `input.lf-skip` on row id=5 → `excludedSet` gains "5", `data-lf-skip="1"` on `<tr>`, row hides (because showExcluded is off by default), Excluded pill updates.
   - Click `input.lf-skip` on row id=3 (which is already planned) → row gets diagonal-stripe Later treatment; Plan pill drops by 10 pts; Later count in counter increments.
3. **Filter toggles:**
   - Enable "Show only my plan" → only strict-plan rows visible; Later rows hidden; counter unchanged.
   - Enable "Show later tasks" → Later rows visible alongside strict plan; the diagonal stripes scan clearly.
   - Enable "Show excluded tasks" (with show-only-plan still on) → no effect (todoOnly takes precedence).
   - Disable "Show only my plan", enable "Show excluded" → excluded rows reappear at 0.45 opacity in their natural sort position.
4. **Stats math:**
   - Plan pill matches sum of strict-plan task points (Plan=✓ Skip=☐).
   - Excluded pill matches sum of strict-excluded task points (Plan=☐ Skip=✓).
   - Pool pill = Total - Excluded.
5. **Persistence:** Page reload, all four states present, all three filter toggles restored.
6. **Clear list:** Confirm shows both counts, clears both sets, all row attrs cleared.
7. **Clear all filters:** Turns off the three filter toggles; preserves both sets and their per-row attributes.
8. **Markdown export:** Plan-only checklist; Later tasks not present in output; title says "— Plan."

Cleanup script for the live verification session: 

```js
for (const k of Object.keys(localStorage))
  if (k.startsWith('lf:Demonic_Pacts_League:')) localStorage.removeItem(k);
```

## Release flow

Per CLAUDE.md:

1. Edit `osrs-leagues-task-filters.user.js`. Bump `@version` to `2026-05-16.1`.
2. Add CHANGELOG entry under the new version describing the lane reframe, two-axis curation, four-state derivation, three filter toggles, three stat pills, and "Plan" column rename.
3. Regenerate `osrs-leagues-task-filters.min.js`:
   ```sh
   npx --yes terser osrs-leagues-task-filters.user.js \
     --compress passes=2 --mangle --format ascii_only=true \
     -o osrs-leagues-task-filters.min.js
   ```
4. Commit + push to `main`. Tampermonkey auto-updates from `@updateURL`.

## Out of scope

- Goal-target input (entering "I'm aiming for 1500 pts" and seeing progress). Held for a future pass once we feel how the three pills perform.
- Hardcoded relic/area/pact unlock ladder. Would require keeping league-specific data in sync with the wiki.
- Filter UI for arbitrary plan+skip combos beyond Later (e.g., "show only excluded that I would have planned"). Not needed for the planning workflow.
- Renaming storage keys (`LS.todo` → `LS.plan`). Would orphan existing users' lists for no gain; internal name vs UI label can differ.
- Migrating `data-lf-todo` references that don't exist anywhere else after the CSS rewrite — verified by grep before commit.
