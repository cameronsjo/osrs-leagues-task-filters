// ==UserScript==
// @name         OSRS Wiki - Leagues Task Filters
// @namespace    http://tampermonkey.net/
// @version      2026-05-09.3
// @description  Filtering, search, and stats for Leagues task pages on the OSRS Wiki. Themed to match the wiki. Supports Demonic Pacts (VI), Raging Echoes (V), Trailblazer Reloaded (IV), and any future league with a /Tasks page. Honors the wiki's native area picker and hide-completed toggle.
// @author       Cameron Johnson (cameronsjo). Original by https://oldschool.runescape.wiki/w/User:Loaf
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
    filters: `${STORAGE_PREFIX}filters`,
    search:  `${STORAGE_PREFIX}search`,
    minPts:  `${STORAGE_PREFIX}minPts`,
    maxPts:  `${STORAGE_PREFIX}maxPts`,
    minComp: `${STORAGE_PREFIX}minComp`,
    maxComp: `${STORAGE_PREFIX}maxComp`,
  };

  // Difficulty images use either the DPL "pact tasks" set OR the legacy
  // Trailblazer Reloaded set. We treat the image filename as the source of truth.
  const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Elite', 'Master'];
  const DIFFICULTY_REGEX = new RegExp(`(${DIFFICULTIES.join('|')})\\.png`, 'i');
  const PACT_TASK_IMG_REGEX = /Demonic_Pacts_League_pact_tasks/i;

  // Synthetic "Clue" pseudo-skill — clue scrolls aren't a real OSRS skill, so
  // there's no data-skill attribute. We detect them by name + description.
  const CLUE_SKILL = 'Clue';
  const CLUE_REGEX = /\bclue scroll\b|\btreasure trail\b|\bclue\b/i;

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

  // Hidden because of: f=filter, s=search, p=points, c=completion, w=wiki area mask
  const HIDE_REASONS = { FILTER: 'f', SEARCH: 's', POINTS: 'p', COMP: 'c', WIKI_AREA: 'w' };

  // ============================================================
  // STATE
  // ============================================================
  let activeFilters   = new Set();
  let searchQuery     = '';
  let pointsMin       = 0;
  let pointsMax       = Infinity;
  let compMin         = 0;
  let compMax         = 100;

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
  };
  const saveFilters = () => localStorage.setItem(LS.filters, JSON.stringify([...activeFilters]));
  const saveSearch  = () => localStorage.setItem(LS.search, searchQuery);
  const savePoints  = () => {
    localStorage.setItem(LS.minPts, String(pointsMin));
    localStorage.setItem(LS.maxPts, isFinite(pointsMax) ? String(pointsMax) : '');
  };
  const saveComp    = () => {
    localStorage.setItem(LS.minComp, String(compMin));
    localStorage.setItem(LS.maxComp, String(compMax));
  };

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
      // Synthetic Clue pseudo-skill
      if (CLUE_REGEX.test(`${name} ${description}`)) skills.add(CLUE_SKILL);

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

  const applyFilters = () => {
    refreshWikiHiddenAreas();
    let visible = 0, visiblePts = 0, totalPts = 0, completedPts = 0;
    tasks.forEach((task) => {
      totalPts += task.points;
      const $row = $(task.row);
      const isCompleted = $row.hasClass('wikisync-completed') || $row.find('.wikisync-completed').length > 0;
      if (isCompleted) completedPts += task.points;
      const reasons = [];
      if (wikiHiddenAreas.has(task.area)) reasons.push(HIDE_REASONS.WIKI_AREA);
      if (!matchesActive(task)) reasons.push(HIDE_REASONS.FILTER);
      if (!matchesSearch(task)) reasons.push(HIDE_REASONS.SEARCH);
      if (!matchesPoints(task)) reasons.push(HIDE_REASONS.POINTS);
      if (!matchesComp(task))   reasons.push(HIDE_REASONS.COMP);
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
  };

  // ============================================================
  // UI
  // ============================================================
  const cssVar = (name, fallback) => `var(${name}, ${fallback})`;

  const styles = `
    #${FILTERS_ID} {
      border: 1px solid ${cssVar('--wikitable-border', '#94866d')};
      background: ${cssVar('--body-mid', '#d0bd97')};
      color: ${cssVar('--text-color', '#000')};
      margin: 12px 0;
      font-family: inherit;
      font-size: 0.92em;
    }
    #${FILTERS_ID} .lf-header {
      background: ${cssVar('--wikitable-header-bg', '#b8a282')};
      border-bottom: 1px solid ${cssVar('--wikitable-border', '#94866d')};
      padding: 8px 12px;
      display: flex;
      flex-wrap: wrap;
      gap: 10px 16px;
      align-items: center;
    }
    #${FILTERS_ID} .lf-header strong { font-size: 1.05em; }
    #${FILTERS_ID} .lf-body { padding: 10px 12px; }
    #${FILTERS_ID} .lf-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: flex-start;
      margin-bottom: 8px;
    }
    #${FILTERS_ID} .lf-row:last-child { margin-bottom: 0; }
    #${FILTERS_ID} .lf-group {
      background: ${cssVar('--body-light', '#d8ccb4')};
      border: 1px solid ${cssVar('--wikitable-border', '#94866d')};
      padding: 0 10px 6px;
      min-width: 160px;
    }
    #${FILTERS_ID} .lf-group h4 {
      margin: 0 -10px 4px;
      padding: 4px 10px;
      background: ${cssVar('--wikitable-header-bg', '#b8a282')};
      border-bottom: 1px solid ${cssVar('--wikitable-border', '#94866d')};
      font-size: 0.95em;
      font-weight: bold;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
    }
    #${FILTERS_ID} .lf-group h4 button {
      font-size: 0.9em;
      line-height: 1;
      padding: 1px 6px;
      cursor: pointer;
      background: transparent;
      border: 1px solid transparent;
      color: inherit;
      font-family: inherit;
    }
    #${FILTERS_ID} .lf-group h4 button:hover {
      background: ${cssVar('--body-light', '#d8ccb4')};
      border-color: ${cssVar('--wikitable-border', '#94866d')};
    }
    #${FILTERS_ID} .lf-options {
      display: flex;
      flex-direction: column;
      gap: 2px;
      max-height: 220px;
      overflow-y: auto;
      padding-top: 4px;
    }
    #${FILTERS_ID} label {
      display: flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      user-select: none;
      font-weight: normal;
      white-space: nowrap;
    }
    #${FILTERS_ID} label:hover { color: ${cssVar('--link-color', '#936039')}; }
    #${FILTERS_ID} input[type="search"],
    #${FILTERS_ID} input[type="number"] {
      padding: 4px 6px;
      border: 1px solid ${cssVar('--wikitable-border', '#94866d')};
      background: ${cssVar('--body-light', '#d8ccb4')};
      color: ${cssVar('--text-color', '#000')};
      font-family: inherit;
    }
    #${FILTERS_ID} input[type="search"] { width: 280px; max-width: 100%; }
    #${FILTERS_ID} input[type="number"] { width: 70px; }
    #${FILTERS_ID} .lf-range { display: flex; align-items: center; gap: 4px; }
    #${FILTERS_ID} .lf-actions { display: flex; gap: 6px; flex-wrap: wrap; }
    #${FILTERS_ID} .lf-actions button {
      padding: 4px 10px;
      cursor: pointer;
      background: ${cssVar('--body-light', '#d8ccb4')};
      border: 1px solid ${cssVar('--wikitable-border', '#94866d')};
      color: ${cssVar('--text-color', '#000')};
      font-family: inherit;
    }
    #${FILTERS_ID} .lf-actions button:hover {
      background: ${cssVar('--wikitable-header-bg', '#b8a282')};
    }
    #${FILTERS_ID} .lf-actions button:disabled { opacity: 0.6; cursor: not-allowed; }
    #${STATUS_ID} {
      font-weight: bold;
      padding: 6px 10px;
      border: 1px solid ${cssVar('--wikitable-border', '#94866d')};
      background: ${cssVar('--body-light', '#d8ccb4')};
      margin-top: 8px;
    }
    #${STATS_ID} { font-size: 0.9em; padding: 4px 0 6px; }
    #${STATS_ID} .lf-stat-pill {
      display: inline-block;
      padding: 2px 8px;
      margin-right: 6px;
      background: ${cssVar('--body-light', '#d8ccb4')};
      border: 1px solid ${cssVar('--wikitable-border', '#94866d')};
    }
    #${WIKI_AREA_NOTE_ID} {
      background: ${cssVar('--body-light', '#d8ccb4')};
      border: 1px solid ${cssVar('--wikitable-border', '#94866d')};
      padding: 4px 8px;
      margin: 0 0 8px;
    }
    .lf-tag {
      display: inline-block;
      padding: 1px 6px;
      font-size: 0.78em;
      background: ${cssVar('--body-light', '#d8ccb4')};
      border: 1px solid ${cssVar('--wikitable-border', '#94866d')};
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
        <h4>${titleHtml}<button type="button" data-lf-clear-group="${kind}" title="Clear">×</button></h4>
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
          <strong>${leagueLabel} — Filters</strong>
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
      saveFilters(); saveSearch(); savePoints(); saveComp();
      $(`#${FILTERS_ID} input[data-lf-kind]`).prop('checked', false);
      $(`#${SEARCH_ID}`).val('');
      $('#lf-pts-min').val(0); $('#lf-pts-max').val(dims.pointsObserved.max);
      $('#lf-comp-min').val(0); $('#lf-comp-max').val(100);
      applyFilters();
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
      panelInDom: !!document.getElementById(FILTERS_ID),
    }),
  };

  log('script loaded');
  $(document).ready(main);
})();
