// ==UserScript==
// @name         Route Hour Table Auto CSV
// @namespace    route-hour-table
// @version      5.1
// @description  Click the red dot to collect all route codes from every page and download a CSV. No storage.
// @match        *://REPLACE-SITE-HOST/*
// @downloadURL  https://raw.githubusercontent.com/USERNAME/REPO/main/route-hour-table.userV4.js
// @updateURL    https://raw.githubusercontent.com/USERNAME/REPO/main/route-hour-table.userV4.js
// @author       Akshay(akparaks) 
// ==/UserScript==

(function () {
  'use strict';

  // AUTO-UPDATE: replace USERNAME/REPO in @downloadURL/@updateURL above, upload
  // this file to that GitHub repo, and bump @version each time you publish a
  // change. Tampermonkey checks the raw URL and installs the newer version.

  // ---- CONFIG: website ----
  const HOUR_CLASS = 'css-72tofv';        // route hour, e.g. "3.5 hr"
  const CODE_CLASS = 'css-1s62r5';        // route code, e.g. "SB_A1" or "SB_A1 X"
  const PAGINATION_CLASS = 'css-1pa2mtb'; // wrapper holding the route data and pager
  const NURSERY_SUFFIX = 'Nursery Route X'; // marker placed beside a nursery route code

  // ---- CONFIG: sheet layout (hour header + routes below) ----
  const BLOCK_COLS = 2;        // columns per block: route code | nursery marker
  const COL_GAP = 2;           // empty columns between blocks
  const BLOCKS_PER_ROW = 3;    // hour blocks side by side
  const MIN_BLOCK_ROWS = 13;   // minimum block height; first row = route hour title
  const ROW_GAP = 2;           // empty rows between block rows

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  // In-memory only — nothing is written to GM/local storage.
  // Shape: { "3.5 hr": { "SB_A1": true /*nursery*/, "SB_A12": false }, ... }
  const data = {};

  // ---------- scraping ----------
  function scan() {
    let currentHour = null;
    document.querySelectorAll('.' + HOUR_CLASS + ', .' + CODE_CLASS).forEach((el) => {
      const t = clean(el.textContent);
      if (!t) return;
      if (el.classList.contains(HOUR_CLASS)) {
        if (/\d/.test(t)) currentHour = t;
      } else if (currentHour) {
        const parts = t.split(' ');
        const code = parts[0];
        if (!code) return;
        const nursery = parts.slice(1).some((p) => p.toUpperCase() === 'X');
        const map = data[currentHour] || (data[currentHour] = {});
        map[code] = nursery;
      }
    });
  }

  // ---------- grid + CSV ----------
  function hoursSorted(d) {
    return Object.keys(d).sort((a, b) => parseFloat(a) - parseFloat(b) || a.localeCompare(b));
  }

  // One block per route hour: hour header on top, then one route per row:
  // column 1 = real route code, column 2 = "Nursery Route X" when flagged.
  function buildGrid() {
    const hours = hoursSorted(data);
    if (!hours.length) return [];

    const codes = hours.map((h) =>
      Object.keys(data[h]).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
    const maxCodes = Math.max(...codes.map((c) => c.length));
    const blockRows = Math.max(MIN_BLOCK_ROWS, 1 + maxCodes);
    const blockRowCount = Math.ceil(hours.length / BLOCKS_PER_ROW);
    const totalRows = blockRowCount * blockRows + (blockRowCount - 1) * ROW_GAP;
    const totalCols = BLOCKS_PER_ROW * BLOCK_COLS + (BLOCKS_PER_ROW - 1) * COL_GAP;

    const grid = Array.from({ length: totalRows }, () => Array(totalCols).fill(''));

    hours.forEach((h, i) => {
      const r0 = Math.floor(i / BLOCKS_PER_ROW) * (blockRows + ROW_GAP);
      const c0 = (i % BLOCKS_PER_ROW) * (BLOCK_COLS + COL_GAP);
      grid[r0][c0] = h;                                      // hour header
      codes[i].forEach((code, j) => {
        const r = r0 + 1 + j;                                // one row per route
        grid[r][c0] = code;                                  // real route code
        if (data[h][code]) grid[r][c0 + 1] = NURSERY_SUFFIX; // nursery marker
      });
    });
    return grid;
  }

  const csvCell = (v) => (/[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  const toCSV = (g) => g.map((r) => r.map(csvCell).join(',')).join('\r\n');

  function downloadCSV() {
    const grid = buildGrid();
    if (!grid.length) return false;
    const blob = new Blob(['\ufeff' + toCSV(grid)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'route_hours.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }

  // ---------- pagination (same logic as the working V3) ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const getBars = () => Array.from(document.querySelectorAll('.' + PAGINATION_CLASS));
  const dataSig = () =>
    Array.from(document.querySelectorAll('.' + HOUR_CLASS + ', .' + CODE_CLASS))
      .map((e) => clean(e.textContent)).join('|');
  const pageSig = () => getBars().map((b) =>
    clean(b.textContent) + '|' +
    Array.from(b.querySelectorAll('[aria-label]')).map((e) => e.getAttribute('aria-label')).join(',')
  ).join('\u0002');
  const signature = () => location.href + '\u0001' + dataSig() + '\u0001' + pageSig();

  async function waitChange(prev, timeout) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (signature() !== prev) { await sleep(400); return true; }
      await sleep(200);
    }
    return false;
  }

  function clickables(root) {
    return Array.from(root.querySelectorAll('button, a, li, [role="button"], [role="link"]'))
      .filter((e) => !e.classList.contains(HOUR_CLASS) && !e.classList.contains(CODE_CLASS) &&
                     !e.querySelector('.' + HOUR_CLASS + ', .' + CODE_CLASS));
  }

  // The next button's label lives on nested <span aria-label> elements.
  function labelOf(e) {
    const own = clean(e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent);
    if (own) return own;
    const inner = e.querySelector('[aria-label], [title]');
    return inner ? clean(inner.getAttribute('aria-label') || inner.getAttribute('title')) : '';
  }

  // "2", "Go to page 2", "Current page, page 2" -> 2; ignore next/prev labels
  function pageNumberFrom(label) {
    if (/next|previous|prev/i.test(label)) return 0;
    if (/^\d+$/.test(label)) return Number(label);
    const m = label.match(/\bpage\s+(\d+)\b/i);
    return m ? Number(m[1]) : 0;
  }

  function isDisabled(el) {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      if (e.disabled || e.getAttribute('aria-disabled') === 'true' || /disabled/i.test(String(e.className))) return true;
    }
    return false;
  }

  function pagerRoot(bar) {
    const named = bar.querySelector('nav, [role="navigation"], [aria-label*="pagination" i], [aria-label*="pager" i], [class*="pagination" i], [class*="pager" i]');
    if (named && clickables(named).length) return named;
    const groups = Array.from(bar.querySelectorAll('div, ul, ol, nav, section'))
      .map((el) => ({ el, count: clickables(el).length, size: el.querySelectorAll('*').length }))
      .filter((x) => x.count >= 2)
      .sort((a, b) => a.size - b.size);
    return groups.length ? groups[0].el : bar;
  }

  function pagerRoots() {
    const roots = [];
    getBars().forEach((b) => roots.push(pagerRoot(b), b));
    document.querySelectorAll('nav, [role="navigation"], [aria-label*="pagination" i], [aria-label*="pager" i], [class*="pagination" i], [class*="pager" i]')
      .forEach((n) => roots.push(n));
    return roots.filter((r, i) => r && roots.indexOf(r) === i);
  }

  function pagerClickables() {
    const seen = new Set();
    const all = [];
    const pagNav = document.querySelector('nav[aria-label*="pagination" i], nav[aria-label*="pager" i]');
    const roots = (pagNav && clickables(pagNav).length) ? [pagNav] : pagerRoots();
    roots.forEach((root) => clickables(root).forEach((e) => {
      if (!seen.has(e)) { seen.add(e); all.push(e); }
    }));
    return all;
  }

  function nextCandidates() {
    return pagerClickables()
      .filter((e) => /next/i.test(labelOf(e)) || /^(›|>|»|→)$/.test(labelOf(e)))
      .sort((a, b) =>
        (isDisabled(a) ? 1 : 0) - (isDisabled(b) ? 1 : 0) ||
        (/^(BUTTON|A)$/.test(a.tagName) ? 0 : 1) - (/^(BUTTON|A)$/.test(b.tagName) ? 0 : 1))
      .slice(0, 5);
  }

  function numberedPages() {
    const seen = {};
    pagerClickables().forEach((e) => {
      const n = pageNumberFrom(labelOf(e));
      if (n > 0 && (!seen[n] || /^(BUTTON|A)$/.test(e.tagName))) seen[n] = e;
    });
    return Object.keys(seen).map(Number).sort((a, b) => a - b);
  }

  function clickPageNumber(n) {
    const m = pagerClickables().filter((e) => pageNumberFrom(labelOf(e)) === n);
    const pick = m.find((e) => /^(BUTTON|A)$/.test(e.tagName)) || m[0];
    if (pick) pick.click();
    return !!pick;
  }

  async function collectAll() {
    if (!getBars().length) return 0;
    let pages = 0;
    const visited = new Set();

    // go to page 1 first
    let sig = signature();
    if (clickPageNumber(1)) await waitChange(sig, 1500);

    sig = signature();
    visited.add(sig);
    scan(); pages = 1;

    while (pages < 300) {
      if (!getBars().length) break;
      let advanced = false;

      // 1) try "next" — verify a real page change
      for (const el of nextCandidates()) {
        const prev = signature();
        el.click();
        if (await waitChange(prev, 2500)) { advanced = true; break; }
      }

      // 2) fall back to numbered page links
      if (!advanced) {
        for (const n of numberedPages().filter((n) => n !== 1)) {
          const prev = signature();
          if (!clickPageNumber(n)) continue;
          if (await waitChange(prev, 2500)) { advanced = true; break; }
        }
      }

      if (!advanced) break;
      const now = signature();
      if (visited.has(now)) break;
      visited.add(now);
      scan(); pages++;
    }
    return pages;
  }

  // ---------- UI: red dot -> manual trigger ----------
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      .dot{width:22px;height:22px;border-radius:50%;background:#e8472b;border:2px solid #fff;
           box-shadow:0 0 0 1px #555,0 2px 6px rgba(0,0,0,.4);cursor:pointer}
      .dot.busy{background:#888;cursor:wait}
    </style>
    <div class="dot" id="dot" title="Collect all pages and download CSV"></div>`;
  document.documentElement.appendChild(host);
  const dot = root.getElementById('dot');

  let running = false;
  dot.onclick = async () => {
    if (running) return;
    running = true;
    dot.classList.add('busy');
    dot.title = 'Collecting...';
    // fresh in-memory data on every run (nothing is stored)
    Object.keys(data).forEach((h) => delete data[h]);
    try {
      scan();
      const pages = await collectAll();
      scan();
      const routes = Object.keys(data).reduce((n, h) => n + Object.keys(data[h]).length, 0);
      const downloaded = downloadCSV();
      const msg = '[Route Hour Table] ' + pages + ' page(s), ' + routes + ' route(s).' +
        (downloaded ? ' CSV downloaded.' : ' No data found.');
      console.log(msg);
      dot.title = msg;
    } finally {
      running = false;
      dot.classList.remove('busy');
    }
  };
})();
