# Capture-phase events vs row-level stopPropagation — Field Report

**Date:** 2026-05-14
**Type:** investigation
**Project:** osrs-leagues-task-filters

## Goal

Add a per-row Todo checkbox to the OSRS Wiki leagues task table. The control would live in a column appended by our userscript; clicks should toggle a task's membership in a `todoSet`, persist, and re-apply filters. Straightforward — until clicks on the control went nowhere.

## What Happened

The first cut bound the handler via standard jQuery event delegation on the table:

```js
$(`#${TABLE_ID}`).on('click', 'button.lf-plan', handler);
```

Buttons rendered. CSS hover states worked. Clicking did literally nothing — no state change, no console error, no visible reaction. The Playwright probe showed 1592 buttons present, the handler registered (one click listener with the right selector), and the state object untouched after a `.click()`.

## Root Cause

We instrumented both phases at the table level with raw `addEventListener`:

```js
const table = document.getElementById('leagues-table');
table.addEventListener('click', e => captured.push({phase: 'capture', target: e.target.tagName}), true);
table.addEventListener('click', e => captured.push({phase: 'bubble', target: e.target.tagName}), false);

document.querySelector('button.lf-plan').click();
```

The capture-phase listener fired. The bubble-phase listener did not. The click reached the button — capture phase confirmed it — but something between the button and the table killed propagation on the way back up.

Walking the ancestor chain with jQuery's private `$._data()` to inspect event handlers per element revealed the culprit:

```js
let el = button;
while (el && el.id !== 'leagues-table') {
  const events = $._data(el, 'events');
  console.log(el.tagName, events?.click?.length ?? 0, 'click handlers');
  el = el.parentElement;
}
```

| Element | Click handlers |
|---|---|
| `<button.lf-plan>` | 0 |
| `<td.lf-plan-col>` | 0 |
| **`<tr#3.highlight-on data-taskid="3">`** | **2 (both direct, no selector)** |
| `<tbody>` | 0 |

The wiki binds two direct click handlers on every task row — WikiSync's "click the row to toggle completion" feature and a paired row-highlight handler. At least one of them calls `event.stopPropagation()` during the bubble phase. Since the TR is between the button (event target) and our delegated handler on the table, the event never bubbles past the TR. Our handler exists, but the wiki gets to the event first and swallows it.

This is not a userscript-specific problem. Any time you bind a delegated handler at the table level on a page that *also* attaches handlers to rows, you're betting on the row's authors not calling `stopPropagation`. That bet loses on the OSRS Wiki.

## The Fix

`addEventListener` accepts a third argument: `useCapture`. Set to `true`, the listener fires during the capture phase — `window → ... → table → tbody → tr → td → button` — *before* the target is hit and well before bubble. The TR's `stopPropagation()` during bubble can't retroactively block what's already fired.

```js
const tableEl = document.getElementById(TABLE_ID);
tableEl.addEventListener('click', (e) => {
  const btn = e.target?.closest?.('button.lf-plan');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation(); // also kills the TR's row-toggle handler — we want this
  // ... cycle state
}, true);
```

Commit `f60de29` shipped this. Clicks worked immediately. The 50-row Playwright synthesis test passed: visible row count dropped 1480 → 1430 after marking 50 tasks and toggling "Hide blocked," the in-app counter reflected the change, and localStorage persisted correctly.

## The Second Encounter

Two iterations later, the user wanted the button restyled as a real checkbox — "more of a styled checkbox instead of appearing like buttons that change." We swapped the `<button>` for `<input type="checkbox">` with `appearance: none` and a CSS-painted check glyph.

This re-opened the same problem in a different shape. A native checkbox's `click` event behaves like any other click — it still bubbles through the TR, still gets stopPropagation'd. But form controls dispatch a separate `change` event when their value flips, and `change` events on form controls bubble *independently* of `click`. Crucially: nothing on the row binds a `change` handler.

Two clean routes:

1. **Capture-phase `change`** — same trick, different event:
   ```js
   tableEl.addEventListener('change', (e) => {
     if (!e.target?.matches?.('input.lf-plan')) return;
     // ... no preventDefault — let the native toggle happen
   }, true);
   ```
2. **Belt-and-suspenders capture-phase `click` stopPropagation** — kills the TR's row-toggle handler from firing on what's really a checkbox click:
   ```js
   tableEl.addEventListener('click', (e) => {
     if (e.target?.matches?.('input.lf-plan')) e.stopPropagation();
   }, true);
   ```

Both shipped in commit `eeb3162`. Capture-phase `change` carries the actual state update; capture-phase `click` is defensive — it prevents the wiki's row click-toggle from interpreting a checkbox click as "the user wants to mark this row complete."

## Gotchas

- **jQuery delegation is always bubble-phase.** `.on('click', selector, handler)` registers on the bind point and dispatches on bubble. There's no capture mode. To use capture phase, you drop to native `addEventListener` with the third argument `true`.
- **`$._data(el, 'events')` is unsupported but invaluable.** It exposes jQuery's internal event store — counts, selectors, namespaces. Indispensable for diagnosing "is the handler even bound? is someone else's handler also bound?" Don't use it in production code; do use it in DevTools and Playwright probes.
- **Pure `addEventListener` listeners are invisible to `$._data()`.** If the wiki used vanilla `addEventListener` instead of jQuery's `.on()`, the walk-up-the-chain trick wouldn't have revealed the TR handlers. You'd need `getEventListeners(el)` in DevTools (Chrome-only, console-only, non-programmatic). For Playwright debugging that route is a dead end; instrumenting the phases directly is the portable fallback.
- **stopPropagation does not retroactively block capture-phase listeners that already fired.** Once the event is in flight, anything you registered with `useCapture=true` upstream of the target gets called. The only thing that *can* block your capture handler is another capture handler that fires earlier and calls `stopImmediatePropagation()`. In practice this is rare.
- **`change` events have a capture phase too.** All DOM events do. Sometimes you don't need capture phase for `change` (no one stops it during bubble), but it's safe to use anyway and keeps the pattern consistent.

## Key Takeaways

- **When integrating into a host page with existing event chains, default to capture-phase listeners.** It's the only phase whose firing order you control from the outside. Bubble-phase delegation only works if nothing between you and the target calls `stopPropagation` — a bet you should not be making.
- **Form controls bring `change` events for free, and `change` is almost always unmolested.** If you can express the user action as a state flip on a form control, do — the native event gives you a clean handler attach point even when click is poisoned.
- **`stopPropagation()` in your own handler is etiquette, not just propagation control.** Calling it tells everything else "this event was for me." On the OSRS Wiki this means the row's completion-toggle doesn't fire on top of the user's checkbox click. Cost: one line. Benefit: the user doesn't accidentally toggle row completion every time they manage their todo list.
- **Phase instrumentation is the right first debug step for "handler doesn't fire."** Don't guess at causes. Bind capture + bubble listeners at the same depth, fire a synthetic event, observe which phases run. The asymmetry tells you exactly which segment of the propagation chain is interfering.

## Commits

- `f60de29` — initial discovery and capture-phase click handler
- `eeb3162` — restyle as native checkbox; capture-phase `change` + defensive capture-phase `click.stopPropagation()`
