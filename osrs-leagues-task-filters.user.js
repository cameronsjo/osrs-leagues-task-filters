// ==UserScript==
// @name         OSRS Wiki - Leagues Task Filters
// @namespace    http://tampermonkey.net/
// @version      2026-05-14.6
// @description  Filtering, search, and stats for Leagues task pages on the OSRS Wiki. Themed to match the wiki. Supports Demonic Pacts (VI), Raging Echoes (V), Trailblazer Reloaded (IV), and any future league with a /Tasks page. Honors the wiki's native area picker and hide-completed toggle.
// @author       Cameron Sjo (cameronsjo). Original by https://oldschool.runescape.wiki/w/User:Loaf
// @icon         https://www.google.com/s2/favicons?sz=64&domain=runescape.wiki
// @homepageURL  https://github.com/cameronsjo/osrs-leagues-task-filters
// @supportURL   https://github.com/cameronsjo/osrs-leagues-task-filters/issues
// @downloadURL  https://raw.githubusercontent.com/cameronsjo/osrs-leagues-task-filters/main/osrs-leagues-task-filters.user.js
// @updateURL    https://raw.githubusercontent.com/cameronsjo/osrs-leagues-task-filters/main/osrs-leagues-task-filters.user.js
// @require      https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js
// @grant        GM_addStyle
// @license      MIT
// @run-at       document-end
// @match        https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Tasks*
// @match        https://oldschool.runescape.wiki/w/Raging_Echoes_League/Tasks*
// @match        https://oldschool.runescape.wiki/w/Trailblazer_Reloaded_League/Tasks*
// ==/UserScript==

/* eslint-disable no-multi-spaces */
(function () {
  'use strict';

  const $ = window.jQuery;

  // ============================================================
  // LEAGUE DETECTION & CONFIG
  // ============================================================
  const LEAGUE_KEY = (() => {
    const m = window.location.pathname.match(/\/w\/([^/]+_League)\/Tasks/);
    return m ? m[1] : 'Unknown_League';
  })();

  const STORAGE_PREFIX = `lf:${LEAGUE_KEY}:`;
  const LS = {
    filters:  `${STORAGE_PREFIX}filters`,
    search:   `${STORAGE_PREFIX}search`,
    minPts:   `${STORAGE_PREFIX}minPts`,
    maxPts:   `${STORAGE_PREFIX}maxPts`,
    minComp:  `${STORAGE_PREFIX}minComp`,
    maxComp:  `${STORAGE_PREFIX}maxComp`,
    todo:        `${STORAGE_PREFIX}todo`,
    todoOnly:    `${STORAGE_PREFIX}todoOnly`,
    hideBlocked: `${STORAGE_PREFIX}hideBlocked`,
  };

  // Difficulty images use either the DPL "pact tasks" set OR the legacy
  // Trailblazer Reloaded set. We treat the image filename as the source of truth.
  const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Elite', 'Master'];
  const DIFFICULTY_REGEX = new RegExp(`(${DIFFICULTIES.join('|')})\\.png`, 'i');
  const PACT_TASK_IMG_REGEX = /Demonic_Pacts_League_pact_tasks/i;

  // Synthetic pseudo-skills — these activities aren't real OSRS skills and
  // have no data-skill attribute on the wiki, so we detect them by regex
  // against the task name and description and add them to the row's skill
  // set. Each entry: [displayName, regex].
  const SYNTHETIC_SKILLS = [
    ['Clue', /\bclue scroll\b|\btreasure trail\b|\bclue\b/i],
    ['Combat Achievement', /\bcombat achievement(?:s|\s+diary)?\b/i],
    ['Collection Log', /\bcollection log\b/i],
    ['25M XP', /\b25[\s,]*(?:million|m|,000,000)\s*(?:xp|experience)\b/i],
    ['35M XP', /\b35[\s,]*(?:million|m|,000,000)\s*(?:xp|experience)\b/i],
    ['50M XP', /\b50[\s,]*(?:million|m|,000,000)\s*(?:xp|experience)\b/i],
  ];

  // The wiki's native area picker writes to these localStorage keys.
  // Value "false" = the user hid that area; missing/"true" = visible.
  const WIKI_AREA_KEY_PREFIX = 'wikisync-league-filter-show-';

  // ============================================================
  // CONSTANTS
  // ============================================================
  const TABLE_ID = 'leagues-table';
  const FILTERS_ID = 'lf-filter-panel';
  const STATUS_ID = 'lf-row-status';
  const STATS_ID  = 'lf-stats';
  const SEARCH_ID = 'lf-search';
  const FILTERED_ATTR = 'data-lf-filtered';
  const WIKI_AREA_NOTE_ID = 'lf-wiki-area-note';

  // Hidden because of: f=filter, s=search, p=points, c=completion, w=wiki area mask, t=shortlist, b=blocked
  const HIDE_REASONS = { FILTER: 'f', SEARCH: 's', POINTS: 'p', COMP: 'c', WIKI_AREA: 'w', SHORTLIST: 't', BLOCKED: 'b' };

  // WikiSync injects `.qc-not-started` markers on sub-requirements (quests, skill levels,
  // item drops) the player hasn't started. A row containing one means the task cannot be
  // completed in the player's current account state.
  const BLOCKED_MARKER_SELECTOR = '.qc-not-started';

  // ============================================================
  // STATE
  // ============================================================
  let activeFilters   = new Set();
  let searchQuery     = '';
  let pointsMin       = 0;
  let pointsMax       = Infinity;
  let compMin         = 0;
  let compMax         = 100;
  /** Task ids the user has shortlisted as a personal todo. Per-league via STORAGE_PREFIX. */
  let todoSet         = new Set();
  /** When true, only rows in todoSet are visible. */
  let todoOnly        = false;
  /** When true, rows containing a WikiSync `.qc-not-started` marker are hidden. */
  let hideBlocked     = false;

  /** @type {Map<string, TaskMeta>} */
  const tasks = new Map();
  /**
   * @typedef TaskMeta
   * @property {HTMLElement} row
   * @property {string} id
   * @property {string} name
   * @property {string} description
   * @property {string} area
   * @property {string} difficulty
   * @property {boolean} isPact
   * @property {Set<string>} skills
   * @property {number} points
   * @property {number} completionPct
   */

  const dims = {
    skills: new Set(),
    difficulties: new Set(),
    hasPactTasks: false,
    hasRegularTasks: false,
    pointsObserved: { min: Infinity, max: -Infinity },
    /** discovered while parsing — used only by the wiki area mask, not as a filter UI */
    areas: new Set(),
  };

  /** Areas the wiki's native picker says to hide. Read on every applyFilters(). */
  let wikiHiddenAreas = new Set();

  // ============================================================
  // STORAGE
  // ============================================================
  const safeJSON = (raw, fallback) => {
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  };
  const loadState = () => {
    activeFilters = new Set(safeJSON(localStorage.getItem(LS.filters), []));
    searchQuery   = localStorage.getItem(LS.search) || '';
    pointsMin     = Number(localStorage.getItem(LS.minPts)) || 0;
    pointsMax     = Number(localStorage.getItem(LS.maxPts)) || Infinity;
    compMin       = Number(localStorage.getItem(LS.minComp)) || 0;
    compMax       = Number(localStorage.getItem(LS.maxComp)) || 100;
    todoSet       = new Set(safeJSON(localStorage.getItem(LS.todo), []));
    todoOnly      = localStorage.getItem(LS.todoOnly) === '1';
    hideBlocked   = localStorage.getItem(LS.hideBlocked) === '1';
  };
  const saveFilters  = () => localStorage.setItem(LS.filters, JSON.stringify([...activeFilters]));
  const saveSearch   = () => localStorage.setItem(LS.search, searchQuery);
  const savePoints   = () => {
    localStorage.setItem(LS.minPts, String(pointsMin));
    localStorage.setItem(LS.maxPts, isFinite(pointsMax) ? String(pointsMax) : '');
  };
  const saveComp     = () => {
    localStorage.setItem(LS.minComp, String(compMin));
    localStorage.setItem(LS.maxComp, String(compMax));
  };
  const saveTodo        = () => localStorage.setItem(LS.todo, JSON.stringify([...todoSet]));
  const saveTodoOnly    = () => localStorage.setItem(LS.todoOnly, todoOnly ? '1' : '0');
  const saveHideBlocked = () => localStorage.setItem(LS.hideBlocked, hideBlocked ? '1' : '0');

  // ============================================================
  // TABLE PARSING
  // ============================================================
  const markLeaguesTable = () => {
    const probe = $('[data-taskid]').first();
    if (!probe.length) return null;
    const $table = probe.closest('table');
    $table.attr('id', TABLE_ID);
    return $table;
  };

  const planCheckboxHTML = (id) => {
    const checked = todoSet.has(id) ? ' checked' : '';
    return `<input type="checkbox" class="lf-plan" data-lf-plan-id="${id}"${checked} aria-label="Add to my todo list"/>`;
  };

  /**
   * Appends the "Todo" column as the LAST column on the table. Front-positioning
   * made the column render wide on the wiki because of how the wiki sizes its
   * first column. Appending lets natural column flow take over so it sits flush
   * at the end. Positional cell access in parseTasks (cells.eq(0..5)) is
   * unaffected either way because injectPlanColumn runs after parseTasks.
   */
  const injectPlanColumn = ($table) => {
    const $headerRow = $table.find('thead tr').first();
    if ($headerRow.length) {
      $headerRow.append('<th class="lf-plan-col" scope="col" title="Personal todo">Todo</th>');
    }
    $table.find('tbody > tr[data-taskid]').each((_, el) => {
      const $row = $(el);
      const id = $row.attr('data-taskid');
      const onList = todoSet.has(id);
      $row.append(`<td class="lf-plan-col" data-sort-value="${onList ? 1 : 0}">${planCheckboxHTML(id)}</td>`);
      if (onList) $row.attr('data-lf-todo', '1');
    });
  };

  /**
   * Sync row-level visuals (data-lf-todo attr, sort-value, checkbox state) to
   * the current todoSet membership for a single task. Used after programmatic
   * mutations like Clear list; user-initiated checkbox changes already mutate
   * the checkbox state directly, but calling this is idempotent.
   */
  const applyPlanRowAttr = (id, onList) => {
    const $row = $(`#${TABLE_ID} tbody > tr[data-taskid="${id}"]`);
    if (onList) $row.attr('data-lf-todo', '1');
    else $row.removeAttr('data-lf-todo');
    const $cell = $row.children('td.lf-plan-col').first();
    $cell.attr('data-sort-value', onList ? '1' : '0');
    $cell.find('input.lf-plan').prop('checked', !!onList);
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const parseDifficulty = ($row) => {
    const $img = $row.find('img').filter((_, el) => DIFFICULTY_REGEX.test(el.src)).first();
    if (!$img.length) return { difficulty: '', isPact: false };
    const m = $img.attr('src').match(DIFFICULTY_REGEX);
    const difficulty = m ? m[1] : '';
    const isPact = PACT_TASK_IMG_REGEX.test($img.attr('src'));
    return { difficulty, isPact };
  };

  const parseTasks = ($table) => {
    $table.find('tbody > tr[data-taskid]').each((_, el) => {
      const $row = $(el);
      const id = $row.attr('data-taskid');
      const cells = $row.children();
      const area = (cells.eq(0).attr('data-sort-value') || cells.eq(0).text().trim() || 'General').trim();
      const name = cells.eq(1).text().trim();
      const description = cells.eq(2).text().trim();
      const { difficulty, isPact } = parseDifficulty($row);
      const skills = new Set();
      $row.find('[data-skill]').each((_, s) => {
        const sk = $(s).attr('data-skill');
        if (sk) skills.add(sk);
      });
      // Synthetic pseudo-skills (Clue, Combat Achievement, Collection Log)
      const haystack = `${name} ${description}`;
      for (const [label, regex] of SYNTHETIC_SKILLS) {
        if (regex.test(haystack)) skills.add(label);
      }

      const ptsText = cells.eq(4).text().trim();
      const points = parseInt(ptsText, 10) || 0;
      const compText = cells.eq(5).text().trim();
      const compMatch = compText.match(/([\d.]+)\s*%/);
      const completionPct = compMatch ? parseFloat(compMatch[1]) : NaN;

      tasks.set(id, { row: el, id, name, description, area, difficulty, isPact, skills, points, completionPct });

      if (area) dims.areas.add(area);
      skills.forEach((s) => dims.skills.add(s));
      if (difficulty) dims.difficulties.add(difficulty);
      if (isPact) dims.hasPactTasks = true; else dims.hasRegularTasks = true;
      if (points > 0) {
        dims.pointsObserved.min = Math.min(dims.pointsObserved.min, points);
        dims.pointsObserved.max = Math.max(dims.pointsObserved.max, points);
      }
    });
    if (!isFinite(dims.pointsObserved.min)) dims.pointsObserved.min = 0;
    if (dims.pointsObserved.max === -Infinity) dims.pointsObserved.max = 0;
  };

  // ============================================================
  // FILTERING
  // ============================================================
  const refreshWikiHiddenAreas = () => {
    const next = new Set();
    for (const area of dims.areas) {
      const raw = localStorage.getItem(`${WIKI_AREA_KEY_PREFIX}${area.toLowerCase()}`);
      if (raw === 'false') next.add(area);
    }
    wikiHiddenAreas = next;
  };

  const matchesActive = (task) => {
    // Within a kind: OR. Across kinds: AND. Empty kind = no constraint.
    const groups = { skill: [], diff: [], type: [], misc: [] };
    for (const f of activeFilters) {
      const [kind, val] = f.split(':');
      if (groups[kind]) groups[kind].push(val);
    }
    if (groups.skill.length && ![...task.skills].some((s) => groups.skill.includes(s))) return false;
    if (groups.diff.length  && !groups.diff.includes(task.difficulty)) return false;
    if (groups.type.length) {
      const taskType = task.isPact ? 'pact' : 'regular';
      if (!groups.type.includes(taskType)) return false;
    }
    if (groups.misc.length) {
      const $row = $(task.row);
      const isCompleted = $row.hasClass('wikisync-completed') || $row.find('.wikisync-completed').length > 0;
      for (const m of groups.misc) {
        if (m === 'complete' && !isCompleted) return false;
        if (m === 'incomplete' && isCompleted) return false;
      }
    }
    return true;
  };

  const matchesSearch = (task) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return task.name.toLowerCase().includes(q) || task.description.toLowerCase().includes(q);
  };

  const matchesPoints = (task) => task.points >= pointsMin && task.points <= pointsMax;
  const matchesComp = (task) => {
    if (isNaN(task.completionPct)) return true;
    const pct = Math.min(task.completionPct, 100);
    return pct >= compMin && pct <= compMax;
  };
  const matchesTodo = (task) => !todoOnly || todoSet.has(task.id);
  /**
   * Live-queries the row each call because WikiSync injects `.qc-not-started`
   * asynchronously after the page renders; caching at parse time would go stale.
   */
  const matchesBlocked = (task) => !hideBlocked || $(task.row).find(BLOCKED_MARKER_SELECTOR).length === 0;

  const applyFilters = () => {
    refreshWikiHiddenAreas();
    let visible = 0, visiblePts = 0, totalPts = 0, completedPts = 0, blockedCount = 0;
    tasks.forEach((task) => {
      totalPts += task.points;
      const $row = $(task.row);
      const isCompleted = $row.hasClass('wikisync-completed') || $row.find('.wikisync-completed').length > 0;
      if (isCompleted) completedPts += task.points;
      if ($row.find(BLOCKED_MARKER_SELECTOR).length > 0) blockedCount += 1;
      const reasons = [];
      if (wikiHiddenAreas.has(task.area)) reasons.push(HIDE_REASONS.WIKI_AREA);
      if (!matchesActive(task)) reasons.push(HIDE_REASONS.FILTER);
      if (!matchesSearch(task)) reasons.push(HIDE_REASONS.SEARCH);
      if (!matchesPoints(task)) reasons.push(HIDE_REASONS.POINTS);
      if (!matchesComp(task))   reasons.push(HIDE_REASONS.COMP);
      if (!matchesTodo(task))    reasons.push(HIDE_REASONS.SHORTLIST);
      if (!matchesBlocked(task)) reasons.push(HIDE_REASONS.BLOCKED);
      if (reasons.length === 0) {
        $row.removeAttr(FILTERED_ATTR).css('display', '');
        visible += 1;
        visiblePts += task.points;
      } else {
        $row.attr(FILTERED_ATTR, reasons.join(',')).css('display', 'none');
      }
    });
    updateStatus(visible, visiblePts, totalPts, completedPts);
    updateWikiAreaNote();
    updateTodoCount();
    updateBlockedCount(blockedCount);
  };

  // ============================================================
  // UI
  // ============================================================
  const cssVar = (name, fallback) => `var(${name}, ${fallback})`;

  const styles = `
    /* Panel scoping + design tokens. Tokens are scoped to the panel so they
       never leak into the wiki's stylesheet. */
    #${FILTERS_ID}, #${TABLE_ID} {
      /* Single Todo accent — Okabe-Ito teal, distinguishable to all forms of
         color vision deficiency. Defined on both the panel and the table so
         the row tint and checkbox both reference it. */
      --lf-plan-go: #007a5e;
      --lf-plan-go-bg: rgba(0, 122, 94, 0.14);
      --lf-plan-go-bg-hover: rgba(0, 122, 94, 0.22);
    }
    #${FILTERS_ID} {
      --lf-border: ${cssVar('--wikitable-border', '#94866d')};
      --lf-body-mid: ${cssVar('--body-mid', '#d0bd97')};
      --lf-body-light: ${cssVar('--body-light', '#d8ccb4')};
      --lf-header-bg: ${cssVar('--wikitable-header-bg', '#b8a282')};
      --lf-text: ${cssVar('--text-color', '#000')};
      --lf-link: ${cssVar('--link-color', '#936039')};
      --lf-fine-line: rgba(255, 255, 255, 0.35);
      --lf-shadow-hairline: 0 1px 0 rgba(0, 0, 0, 0.06);
      --lf-transition: 120ms ease;
      border: 1px solid var(--lf-border);
      background: var(--lf-body-mid);
      color: var(--lf-text);
      margin: 12px 0;
      font-family: inherit;
      font-size: 0.92em;
      font-variant-numeric: tabular-nums;
      box-shadow: inset 0 1px 0 var(--lf-fine-line), var(--lf-shadow-hairline);
    }
    /* Header bar — league + search + clear-all. */
    #${FILTERS_ID} .lf-header {
      background: var(--lf-header-bg);
      border-bottom: 1px solid var(--lf-border);
      padding: 9px 12px;
      display: flex;
      flex-wrap: wrap;
      gap: 10px 16px;
      align-items: center;
      box-shadow: inset 0 1px 0 var(--lf-fine-line);
    }
    #${FILTERS_ID} .lf-header strong {
      font-size: 1.08em;
      letter-spacing: -0.005em;
      line-height: 1.2;
    }
    /* "Filters" eyebrow — quieter than the league name itself. */
    #${FILTERS_ID} .lf-eyebrow {
      font-size: 0.75em;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      opacity: 0.65;
    }
    #${FILTERS_ID} .lf-body { padding: 12px 12px 10px; }
    #${FILTERS_ID} .lf-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: flex-start;
      margin-bottom: 8px;
    }
    #${FILTERS_ID} .lf-row:last-child { margin-bottom: 0; }
    /* Group cards — the wiki's parchment look, with a hairline highlight. */
    #${FILTERS_ID} .lf-group {
      background: var(--lf-body-light);
      border: 1px solid var(--lf-border);
      padding: 0 10px 7px;
      min-width: 160px;
      box-shadow: inset 0 1px 0 var(--lf-fine-line);
      transition: border-color var(--lf-transition);
    }
    /* Group headers — small uppercase eyebrows; editorial feel. */
    #${FILTERS_ID} .lf-group h4 {
      margin: 0 -10px 4px;
      padding: 5px 10px;
      background: var(--lf-header-bg);
      border-bottom: 1px solid var(--lf-border);
      font-size: 0.78em;
      font-weight: 700;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
      box-shadow: inset 0 1px 0 var(--lf-fine-line);
    }
    #${FILTERS_ID} .lf-group h4 button {
      font-size: 1em;
      line-height: 1;
      padding: 2px 7px;
      cursor: pointer;
      background: transparent;
      border: 1px solid transparent;
      color: inherit;
      font-family: inherit;
      letter-spacing: 0;
      text-transform: none;
      transition: background var(--lf-transition), border-color var(--lf-transition), color var(--lf-transition);
    }
    #${FILTERS_ID} .lf-group h4 button:hover {
      background: var(--lf-body-light);
      border-color: var(--lf-border);
      color: var(--lf-link);
    }
    #${FILTERS_ID} .lf-group-actions { display: flex; gap: 4px; }
    /* Option lists with a tasteful palette-matched scrollbar. */
    #${FILTERS_ID} .lf-options {
      display: flex;
      flex-direction: column;
      gap: 2px;
      max-height: 220px;
      overflow-y: auto;
      padding: 5px 0 1px;
      scrollbar-width: thin;
      scrollbar-color: var(--lf-border) transparent;
    }
    #${FILTERS_ID} .lf-options::-webkit-scrollbar { width: 6px; }
    #${FILTERS_ID} .lf-options::-webkit-scrollbar-thumb { background: var(--lf-border); }
    #${FILTERS_ID} .lf-options::-webkit-scrollbar-track { background: transparent; }
    #${FILTERS_ID} label {
      display: flex;
      align-items: center;
      gap: 5px;
      cursor: pointer;
      user-select: none;
      font-weight: normal;
      white-space: nowrap;
      transition: color var(--lf-transition);
    }
    #${FILTERS_ID} label:hover { color: var(--lf-link); }
    #${FILTERS_ID} input[type="search"],
    #${FILTERS_ID} input[type="number"] {
      padding: 5px 7px;
      border: 1px solid var(--lf-border);
      background: var(--lf-body-light);
      color: var(--lf-text);
      font-family: inherit;
      transition: border-color var(--lf-transition), background var(--lf-transition), box-shadow var(--lf-transition);
    }
    #${FILTERS_ID} input[type="search"] { width: 280px; max-width: 100%; }
    #${FILTERS_ID} input[type="number"] { width: 70px; }
    #${FILTERS_ID} input[type="search"]:focus,
    #${FILTERS_ID} input[type="number"]:focus {
      outline: none;
      border-color: var(--lf-link);
      background: #fff;
      box-shadow: inset 0 0 0 1px var(--lf-link);
    }
    #${FILTERS_ID} .lf-range {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    #${FILTERS_ID} .lf-range > span {
      opacity: 0.7;
      font-size: 0.9em;
    }
    #${FILTERS_ID} .lf-actions { display: flex; gap: 6px; flex-wrap: wrap; }
    #${FILTERS_ID} .lf-actions button {
      padding: 5px 12px;
      cursor: pointer;
      background: var(--lf-body-light);
      border: 1px solid var(--lf-border);
      color: var(--lf-text);
      font-family: inherit;
      font-weight: 500;
      transition: background var(--lf-transition), border-color var(--lf-transition), color var(--lf-transition);
    }
    #${FILTERS_ID} .lf-actions button:hover {
      background: var(--lf-header-bg);
      color: var(--lf-link);
    }
    #${FILTERS_ID} .lf-actions button:active {
      background: var(--lf-border);
      color: #fff;
    }
    #${FILTERS_ID} .lf-actions button:disabled { opacity: 0.6; cursor: not-allowed; }
    /* Universal focus-visible — accessibility win for keyboard users. */
    #${FILTERS_ID} button:focus-visible,
    #${FILTERS_ID} input:focus-visible {
      outline: 2px solid var(--lf-link);
      outline-offset: 1px;
    }
    /* Status row + stats pills */
    #${STATUS_ID} {
      font-weight: 600;
      padding: 7px 10px;
      border: 1px solid var(--lf-border);
      background: var(--lf-body-light);
      margin-top: 8px;
      box-shadow: inset 0 1px 0 var(--lf-fine-line);
      letter-spacing: 0.005em;
    }
    #${STATS_ID} { font-size: 0.9em; padding: 4px 0 8px; }
    #${STATS_ID} .lf-stat-pill {
      display: inline-block;
      padding: 3px 9px;
      margin-right: 6px;
      background: var(--lf-body-light);
      border: 1px solid var(--lf-border);
      box-shadow: inset 0 1px 0 var(--lf-fine-line);
    }
    /* Wiki-area note — flagged left border so it reads as dynamic info. */
    #${WIKI_AREA_NOTE_ID} {
      background: var(--lf-body-light);
      border: 1px solid var(--lf-border);
      border-left: 3px solid var(--lf-link);
      padding: 6px 10px;
      margin: 0 0 8px;
    }
    .lf-tag {
      display: inline-block;
      padding: 2px 7px;
      font-size: 0.78em;
      font-weight: 600;
      letter-spacing: 0.02em;
      background: var(--lf-body-light);
      border: 1px solid var(--lf-border);
    }
    /* ─── Plan column on the leagues table ─────────────────────────── */
    #${TABLE_ID} th.lf-plan-col,
    #${TABLE_ID} td.lf-plan-col {
      width: 44px;
      min-width: 44px;
      text-align: center;
      padding: 4px 2px;
    }
    #${TABLE_ID} th.lf-plan-col {
      font-size: 0.75em;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    /* Plan column checkbox — a real <input type="checkbox"> styled to read as
       a parchment-themed checkbox. appearance:none lets us paint the box and
       the check ourselves so it looks consistent across browsers. */
    input.lf-plan {
      appearance: none;
      -webkit-appearance: none;
      margin: 0;
      width: 18px;
      height: 18px;
      padding: 0;
      border: 1px solid ${cssVar('--wikitable-border', '#94866d')};
      background: ${cssVar('--body-light', '#d8ccb4')};
      display: inline-block;
      vertical-align: middle;
      position: relative;
      cursor: pointer;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);
      transition: background var(--lf-transition, 120ms ease), border-color var(--lf-transition, 120ms ease);
    }
    input.lf-plan:hover { border-color: var(--lf-plan-go); }
    input.lf-plan:focus-visible {
      outline: 2px solid var(--lf-plan-go);
      outline-offset: 2px;
    }
    input.lf-plan:checked {
      background: var(--lf-plan-go);
      border-color: var(--lf-plan-go);
    }
    input.lf-plan:checked::after {
      content: '\u2713';
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
    /* Row tint for marked rows — matches WikiSync's completed treatment.
       The :not(.wikisync-completed) guard lets the wiki's own completion
       styling win when a task is both completed and marked. */
    tr[data-lf-todo="1"]:not(.wikisync-completed) {
      background-color: var(--lf-plan-go-bg);
    }
    tr[data-lf-todo="1"]:not(.wikisync-completed):hover {
      background-color: var(--lf-plan-go-bg-hover);
    }
    /* Group min-widths so the row breaks nicely on narrow viewports. */
    #${FILTERS_ID} [data-lf-group="todo"] { min-width: 220px; }
    #${FILTERS_ID} [data-lf-group="doable"] { min-width: 200px; }
    #${FILTERS_ID} #lf-todo-count,
    #${FILTERS_ID} #lf-blocked-count {
      font-size: 0.8em;
      opacity: 0.7;
      padding-top: 3px;
      letter-spacing: 0.02em;
    }
    /* Export toast — sits inside the todo group, in-flow, no overlay chrome. */
    #${FILTERS_ID} .lf-toast { padding-top: 4px; }
    #${FILTERS_ID} .lf-toast-msg {
      font-size: 0.82em;
      padding: 3px 7px;
      border: 1px solid var(--lf-border);
      background: var(--lf-header-bg);
      display: inline-block;
      letter-spacing: 0.01em;
    }
    #${FILTERS_ID} .lf-toast-msg[data-kind="manual"] {
      background: var(--lf-body-mid);
      border-color: var(--lf-link);
    }
    #${FILTERS_ID} .lf-toast-fallback {
      display: block;
      width: 100%;
      min-height: 80px;
      margin-top: 4px;
      padding: 5px 7px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.78em;
      background: #fff;
      border: 1px solid var(--lf-border);
      color: var(--lf-text);
      resize: vertical;
    }
  `;

  const injectStyles = () => {
    const tag = document.createElement('style');
    tag.textContent = styles;
    document.head.appendChild(tag);
  };

  const groupOptions = (titleHtml, items, kind, formatLabel = (s) => s) => {
    const sorted = [...items].sort((a, b) => String(a).localeCompare(String(b)));
    const opts = sorted.map((val) => {
      const id = `lf-${kind}-${String(val).replace(/[^a-z0-9]/gi, '_')}`;
      const checked = activeFilters.has(`${kind}:${val}`) ? 'checked' : '';
      return `
        <label for="${id}">
          <input type="checkbox" id="${id}" data-lf-kind="${kind}" data-lf-val="${val}" ${checked}/>
          ${formatLabel(val)}
        </label>`;
    }).join('');
    return `
      <div class="lf-group" data-lf-group="${kind}">
        <h4>${titleHtml}<span class="lf-group-actions"><button type="button" data-lf-select-group="${kind}" title="Select all (use as exclusion)">✓</button><button type="button" data-lf-clear-group="${kind}" title="Clear">×</button></span></h4>
        <div class="lf-options">${opts || '<em style="opacity:0.6">none</em>'}</div>
      </div>`;
  };

  const buildPanel = ($table) => {
    const leagueLabel = LEAGUE_KEY.replace(/_/g, ' ');
    const ptsMaxObs = dims.pointsObserved.max || 100;
    const minPtsVal = isFinite(pointsMin) ? pointsMin : 0;
    const maxPtsVal = isFinite(pointsMax) ? pointsMax : ptsMaxObs;

    const typeOpts = [];
    if (dims.hasPactTasks) typeOpts.push('pact');
    if (dims.hasRegularTasks) typeOpts.push('regular');

    const miscOpts = ['complete', 'incomplete'];

    const html = `
      <div id="${FILTERS_ID}">
        <div class="lf-header">
          <strong>${leagueLabel}</strong>
          <span class="lf-eyebrow">Filters</span>
          <span class="lf-tag">${tasks.size} tasks</span>
          <input id="${SEARCH_ID}" type="search" placeholder="Search task name or description (press / to focus, Esc to clear)" value="${searchQuery.replace(/"/g, '&quot;')}" style="flex:1; min-width:200px;"/>
          <div class="lf-actions">
            <button type="button" id="lf-clear-all">Clear all filters</button>
          </div>
        </div>
        <div class="lf-body">
          <div id="${STATS_ID}"></div>
          <div id="${WIKI_AREA_NOTE_ID}" style="display:none; font-size:0.85em;"></div>
          <div class="lf-row">
            ${groupOptions('Difficulty',   dims.difficulties, 'diff', (d) => d)}
            ${typeOpts.length > 1 ? groupOptions('Task type', new Set(typeOpts), 'type', (t) => t === 'pact' ? 'Pact tasks' : 'Regular tasks') : ''}
            ${groupOptions('Skill',        dims.skills,       'skill')}
            ${groupOptions('Status',       new Set(miscOpts), 'misc', (m) => ({ complete: 'Completed', incomplete: 'Incomplete' }[m] || m))}
            <div class="lf-group" data-lf-group="todo">
              <h4>Todo list <span class="lf-group-actions"><button type="button" data-lf-export-md title="Copy your todo list as markdown">Export</button><button type="button" data-lf-clear-todo title="Empty your todo list">Clear</button></span></h4>
              <div class="lf-options">
                <label for="lf-todo-only"><input type="checkbox" id="lf-todo-only" ${todoOnly ? 'checked' : ''}/> Show only my todo list</label>
                <div id="lf-todo-count"></div>
                <div id="lf-export-toast" class="lf-toast" aria-live="polite"></div>
              </div>
            </div>
            <div class="lf-group" data-lf-group="doable">
              <h4>Doable</h4>
              <div class="lf-options">
                <label for="lf-hide-blocked" title="Hide tasks whose requirements (quests, skill levels, etc.) the player hasn't started yet — uses WikiSync's qc-not-started markers."><input type="checkbox" id="lf-hide-blocked" ${hideBlocked ? 'checked' : ''}/> Hide blocked tasks</label>
                <div id="lf-blocked-count"></div>
              </div>
            </div>
            <div class="lf-group">
              <h4>Points <button type="button" data-lf-reset="points">×</button></h4>
              <div class="lf-range">
                <input type="number" id="lf-pts-min" min="0" max="${ptsMaxObs}" value="${minPtsVal}"/>
                <span>–</span>
                <input type="number" id="lf-pts-max" min="0" max="${ptsMaxObs}" value="${maxPtsVal}"/>
              </div>
              <div style="font-size:0.8em;opacity:0.7;padding-top:2px">range: ${dims.pointsObserved.min}–${dims.pointsObserved.max}</div>
            </div>
            <div class="lf-group">
              <h4>Completion % <button type="button" data-lf-reset="comp">×</button></h4>
              <div class="lf-range">
                <input type="number" id="lf-comp-min" min="0" max="100" value="${compMin}"/>
                <span>–</span>
                <input type="number" id="lf-comp-max" min="0" max="100" value="${compMax}"/>
              </div>
              <div style="font-size:0.8em;opacity:0.7;padding-top:2px">global completion %</div>
            </div>
          </div>
          <div id="${STATUS_ID}"></div>
        </div>
      </div>`;

    $table.before(html);
  };

  /**
   * Builds a markdown checklist of the user's todo list, grouped by area, sorted
   * by difficulty within each area. Returns "" when the list is empty.
   */
  const buildTodoMarkdown = () => {
    if (todoSet.size === 0) return '';
    const DIFF_ORDER = { Easy: 0, Medium: 1, Hard: 2, Elite: 3, Master: 4, '': 5 };
    const byArea = new Map();
    let totalPts = 0;
    todoSet.forEach((id) => {
      const t = tasks.get(id);
      if (!t) return;
      const list = byArea.get(t.area) || [];
      list.push(t);
      byArea.set(t.area, list);
      totalPts += t.points;
    });
    const today = new Date().toISOString().slice(0, 10);
    const leagueLabel = LEAGUE_KEY.replace(/_/g, ' ');
    const lines = [
      `# ${leagueLabel} — Todo`,
      `*Generated ${today} · ${todoSet.size} task${todoSet.size === 1 ? '' : 's'} · ${totalPts} pts*`,
      '',
    ];
    [...byArea.keys()].sort((a, b) => a.localeCompare(b)).forEach((area) => {
      lines.push(`## ${area}`);
      byArea.get(area)
        .sort((a, b) => (DIFF_ORDER[a.difficulty] ?? 5) - (DIFF_ORDER[b.difficulty] ?? 5) || a.name.localeCompare(b.name))
        .forEach((t) => {
          const diff = t.difficulty ? `**${t.difficulty}** · ` : '';
          const pts = t.points ? `${t.points} pts · ` : '';
          lines.push(`- [ ] ${diff}${pts}${t.name}`);
        });
      lines.push('');
    });
    return lines.join('\n').trimEnd() + '\n';
  };

  const fallbackCopy = (text) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  };

  let exportToastTimer = null;
  const showExportToast = (msg, kind = 'ok', failureBody = null) => {
    const $toast = $('#lf-export-toast');
    if (!$toast.length) return;
    clearTimeout(exportToastTimer);
    if (failureBody) {
      const safe = failureBody.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      $toast.html(`<div class="lf-toast-msg" data-kind="${kind}">${msg}</div><textarea readonly class="lf-toast-fallback">${safe}</textarea>`);
      // Pre-select for easy Ctrl+C.
      const ta = $toast.find('textarea')[0];
      if (ta) { ta.focus(); ta.select(); }
    } else {
      $toast.html(`<div class="lf-toast-msg" data-kind="${kind}">${msg}</div>`);
      exportToastTimer = setTimeout(() => $toast.empty(), 2400);
    }
  };

  const updateTodoCount = () => {
    const $el = $('#lf-todo-count');
    if (!$el.length) return;
    const n = todoSet.size;
    $el.text(n === 0 ? 'nothing marked' : `${n} task${n === 1 ? '' : 's'} marked`);
  };

  const updateBlockedCount = (count) => {
    const $el = $('#lf-blocked-count');
    if (!$el.length) return;
    // 0 = either no WikiSync data yet OR genuinely nothing blocked. Surface the distinction
    // gently — most users will see the WikiSync case until they sync.
    $el.text(count > 0 ? `${count} blocked` : 'none detected (needs WikiSync)');
  };

  const updateWikiAreaNote = () => {
    const $note = $(`#${WIKI_AREA_NOTE_ID}`);
    if (!$note.length) return;
    if (wikiHiddenAreas.size === 0) {
      $note.html('').hide();
      return;
    }
    const list = [...wikiHiddenAreas].sort().join(', ');
    $note
      .html(`<span style="opacity:0.85">Honoring wiki area picker — hiding <strong>${wikiHiddenAreas.size}</strong> area${wikiHiddenAreas.size === 1 ? '' : 's'}: ${list}</span>`)
      .show();
  };

  const updateStatus = (visible, visiblePts, totalPts, completedPts) => {
    const total = tasks.size;
    const pct = total ? Math.trunc((visible / total) * 1000) / 10 : 0;
    $(`#${STATUS_ID}`).text(`Showing ${visible} / ${total} tasks (${pct}%) — ${visiblePts.toLocaleString()} pts visible`);
    const $stats = $(`#${STATS_ID}`);
    $stats.html(`
      <span class="lf-stat-pill"><strong>Total:</strong> ${totalPts.toLocaleString()} pts</span>
      <span class="lf-stat-pill"><strong>Completed:</strong> ${completedPts.toLocaleString()} pts ${totalPts ? `(${Math.trunc(completedPts/totalPts*1000)/10}%)` : ''}</span>
    `);
  };

  // ============================================================
  // EVENT WIRING
  // ============================================================
  const wireUp = () => {
    $(`#${FILTERS_ID}`).on('change', 'input[type="checkbox"][data-lf-kind]', function () {
      const kind = $(this).attr('data-lf-kind');
      const val = $(this).attr('data-lf-val');
      const key = `${kind}:${val}`;
      if (this.checked) activeFilters.add(key); else activeFilters.delete(key);
      saveFilters();
      applyFilters();
    });

    $(`#${FILTERS_ID}`).on('click', '[data-lf-clear-group]', function () {
      const kind = $(this).attr('data-lf-clear-group');
      [...activeFilters].forEach((f) => { if (f.startsWith(`${kind}:`)) activeFilters.delete(f); });
      $(`#${FILTERS_ID} input[data-lf-kind="${kind}"]`).prop('checked', false);
      saveFilters();
      applyFilters();
    });

    $(`#${FILTERS_ID}`).on('click', '[data-lf-select-group]', function () {
      const kind = $(this).attr('data-lf-select-group');
      $(`#${FILTERS_ID} input[data-lf-kind="${kind}"]`).each(function () {
        activeFilters.add(`${kind}:${$(this).attr('data-lf-val')}`);
        this.checked = true;
      });
      saveFilters();
      applyFilters();
    });

    $(`#${FILTERS_ID}`).on('click', '[data-lf-reset]', function () {
      const which = $(this).attr('data-lf-reset');
      if (which === 'points') {
        pointsMin = 0; pointsMax = Infinity;
        $('#lf-pts-min').val(0);
        $('#lf-pts-max').val(dims.pointsObserved.max);
        savePoints();
      } else if (which === 'comp') {
        compMin = 0; compMax = 100;
        $('#lf-comp-min').val(0);
        $('#lf-comp-max').val(100);
        saveComp();
      }
      applyFilters();
    });

    $('#lf-clear-all').on('click', () => {
      activeFilters.clear();
      searchQuery = '';
      pointsMin = 0; pointsMax = Infinity;
      compMin = 0; compMax = 100;
      // Intentionally do NOT clear todoSet — the shortlist is curated work,
      // not transient filter state. We only turn off the visibility toggles.
      todoOnly = false;
      hideBlocked = false;
      saveFilters(); saveSearch(); savePoints(); saveComp();
      saveTodoOnly(); saveHideBlocked();
      $(`#${FILTERS_ID} input[data-lf-kind]`).prop('checked', false);
      $(`#${SEARCH_ID}`).val('');
      $('#lf-pts-min').val(0); $('#lf-pts-max').val(dims.pointsObserved.max);
      $('#lf-comp-min').val(0); $('#lf-comp-max').val(100);
      $('#lf-todo-only').prop('checked', false);
      $('#lf-hide-blocked').prop('checked', false);
      applyFilters();
    });

    // Per-row Todo checkbox. The wiki binds direct click handlers on each <tr>
    // (WikiSync's row-toggle feature) that call event.stopPropagation() during
    // bubble — so a delegated handler on the table never sees a click. We
    // listen for `change` in capture phase, which is independent of the row's
    // click stopPropagation, and lets the native checkbox toggle happen first.
    const tableEl = document.getElementById(TABLE_ID);
    if (tableEl) {
      tableEl.addEventListener('change', (e) => {
        const cb = e.target;
        if (!cb || !cb.matches || !cb.matches('input.lf-plan')) return;
        const id = cb.getAttribute('data-lf-plan-id');
        if (cb.checked) todoSet.add(id);
        else todoSet.delete(id);
        saveTodo();
        applyPlanRowAttr(id, cb.checked);
        applyFilters();
      }, true);
      // Belt-and-suspenders: stop click bubbling on the plan cell so the
      // wiki's row handlers (if any) don't react to a checkbox click.
      tableEl.addEventListener('click', (e) => {
        if (e.target && e.target.matches && e.target.matches('input.lf-plan')) {
          e.stopPropagation();
        }
      }, true);
    }

    $('#lf-todo-only').on('change', function () {
      todoOnly = this.checked;
      saveTodoOnly();
      applyFilters();
    });

    $('#lf-hide-blocked').on('change', function () {
      hideBlocked = this.checked;
      saveHideBlocked();
      applyFilters();
    });

    $(`#${FILTERS_ID}`).on('click', '[data-lf-clear-todo]', () => {
      const n = todoSet.size;
      if (n === 0) return;
      if (!window.confirm(`Empty your todo list (${n} task${n === 1 ? '' : 's'})?`)) return;
      todoSet.clear();
      saveTodo();
      $(`#${TABLE_ID} tr[data-lf-todo]`).each(function () {
        const id = $(this).attr('data-taskid');
        applyPlanRowAttr(id, false);
      });
      applyFilters();
    });

    $(`#${FILTERS_ID}`).on('click', '[data-lf-export-md]', async () => {
      const md = buildTodoMarkdown();
      if (!md) {
        showExportToast('Nothing on your todo list yet');
        return;
      }
      let ok = false;
      try {
        await navigator.clipboard.writeText(md);
        ok = true;
      } catch (err) {
        // Clipboard write can fail under odd permission/CSP shapes — fall back to a
        // selectable textarea so the user can ctrl-c manually.
        ok = fallbackCopy(md);
      }
      const n = (md.match(/^- \[ \]/gm) || []).length;
      showExportToast(ok ? `Copied ${n} task${n === 1 ? '' : 's'} as markdown` : `Couldn\u2019t auto-copy \u2014 select the text below`, ok ? 'ok' : 'manual', ok ? null : md);
    });

    let searchDebounce;
    $(`#${SEARCH_ID}`).on('input', function () {
      const v = this.value;
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        searchQuery = v.trim();
        saveSearch();
        applyFilters();
      }, 120);
    });

    $('#lf-pts-min').on('input', function () { pointsMin = Number(this.value) || 0; savePoints(); applyFilters(); });
    $('#lf-pts-max').on('input', function () {
      const v = Number(this.value);
      pointsMax = v > 0 ? v : Infinity;
      savePoints(); applyFilters();
    });
    $('#lf-comp-min').on('input', function () { compMin = Number(this.value) || 0; saveComp(); applyFilters(); });
    $('#lf-comp-max').on('input', function () { compMax = Number(this.value) || 100; saveComp(); applyFilters(); });

    $(document).on('keydown', (e) => {
      if (e.target && /input|textarea/i.test(e.target.tagName)) return;
      if (e.key === '/') {
        e.preventDefault();
        $(`#${SEARCH_ID}`).trigger('focus').select();
      }
    });
    $(`#${SEARCH_ID}`).on('keydown', function (e) {
      if (e.key === 'Escape') {
        this.value = '';
        searchQuery = '';
        saveSearch();
        applyFilters();
        this.blur();
      }
    });

    // Re-apply when WikiSync syncs.
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function () {
      this.addEventListener('readystatechange', async (e) => {
        if (this.readyState === 4 && /sync\.runescape\.wiki\/runelite\/player/.test(e.currentTarget.responseURL || '')) {
          await sleep(400);
          applyFilters();
        }
      }, false);
      return origOpen.apply(this, arguments);
    };

    // Cross-tab sync for the wiki picker.
    window.addEventListener('storage', (e) => {
      if (!e.key) return;
      if (e.key.startsWith(WIKI_AREA_KEY_PREFIX) || e.key === 'wikisync-hide-completed') {
        applyFilters();
      }
    });

    // Same-tab sync via slow poll (storage events don't fire in writer tab).
    setInterval(() => {
      const before = [...wikiHiddenAreas].sort().join('|');
      refreshWikiHiddenAreas();
      const after = [...wikiHiddenAreas].sort().join('|');
      if (before !== after) applyFilters();
    }, 1000);
  };

  // ============================================================
  // BOOT
  // ============================================================
  const log = (...args) => console.log('[Leagues Filters]', ...args);
  const warn = (...args) => console.warn('[Leagues Filters]', ...args);

  const waitForMW = async () => {
    let tries = 0;
    while (!(window.mw && window.mw.util && window.mw.util.wikiScript) && tries < 20) {
      await sleep(250); tries++;
    }
  };

  // Wait up to ~10s for task rows to appear in case the wiki injects them late.
  const waitForTasks = async () => {
    let tries = 0;
    while ($('[data-taskid]').length === 0 && tries < 40) {
      await sleep(250); tries++;
    }
    return $('[data-taskid]').length;
  };

  const main = async () => {
    log('boot — url:', window.location.href);
    if (!window.jQuery) {
      warn('window.jQuery missing — cannot run');
      return;
    }
    const taskCount = await waitForTasks();
    if (taskCount === 0) {
      warn('no [data-taskid] rows found after 10s wait — not a leagues task page?');
      return;
    }
    log('found ' + taskCount + ' task rows');
    await waitForMW();

    const $table = markLeaguesTable();
    if (!$table || !$table.length) {
      warn('could not find task table');
      return;
    }

    try {
      loadState();
      parseTasks($table);
      injectPlanColumn($table);
      injectStyles();
      // Hide the noisy default row counter (we render our own status), but keep the
      // wiki's native "hide completed" toggle and area picker — our filters honor them.
      $('#tbz-wikisync-number-of-shown-tasks').hide();
      buildPanel($table);
      wireUp();
      applyFilters();
      log(`ready — ${LEAGUE_KEY} · ${tasks.size} tasks · ${dims.skills.size} skills · wiki-hiding ${wikiHiddenAreas.size}`);
    } catch (err) {
      warn('boot failed:', err);
      const $err = $(`<div style="border:1px solid #936039;background:#d8ccb4;padding:8px;margin:12px 0;color:#000"><strong>Leagues Filters error:</strong> ${String(err && err.message || err)}</div>`);
      $table.before($err);
    }
  };

  // Expose a debug handle so the user can re-run or inspect from DevTools.
  window.LeaguesFilters = {
    run: main,
    state: () => ({
      league: LEAGUE_KEY,
      tasks: tasks.size,
      skills: [...dims.skills],
      difficulties: [...dims.difficulties],
      wikiHiddenAreas: [...wikiHiddenAreas],
      activeFilters: [...activeFilters],
      todo: todoSet.size,
      todoOnly,
      hideBlocked,
      panelInDom: !!document.getElementById(FILTERS_ID),
    }),
  };

  log('script loaded');
  $(document).ready(main);
})();
