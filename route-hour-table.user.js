// ==UserScript==
// @name         Route Hour Table Auto CSV
// @namespace    route-hour-table
// @version      5.10
// @description  Click the red dot to collect all route codes from every page and download a CSV. No storage.
// @match        *://eu.dispatch.planning.last-mile.a2z.com/route-sheets/*
// @downloadURL  https://raw.githubusercontent.com/akshayparakh036-ctrl/routeHourCollectionCSV/refs/heads/main/route-hour-table.user.js?v=5.10
// @updateURL    https://raw.githubusercontent.com/akshayparakh036-ctrl/routeHourCollectionCSV/refs/heads/main/route-hour-table.user.js?v=5.10
// @author       Akshay(akparaks) 
// ==/UserScript==


(function () {
  'use strict';

  const HOUR_CLASS = 'css-72tofv';
  const CODE_CLASS = 'css-1s62r5';
  const PAGINATION_CLASS = 'css-1pa2mtb';
  const NURSERY_SUFFIX = 'Nursery Route X';

  const BLOCK_COLS = 2;
  const COL_GAP = 2;
  const BLOCKS_PER_ROW = 3;
  const MIN_BLOCK_ROWS = 13;
  const ROW_GAP = 2;

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  const data = {};
  let stopRequested = false;

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

  function hoursSorted(d) {
    return Object.keys(d).sort((a, b) => parseFloat(a) - parseFloat(b) || a.localeCompare(b));
  }

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
      grid[r0][c0] = h;
      codes[i].forEach((code, j) => {
        const r = r0 + 1 + j;
        grid[r][c0] = code;
        if (data[h][code]) grid[r][c0 + 1] = NURSERY_SUFFIX;
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
      if (stopRequested) return false;
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

  function labelOf(e) {
    const own = clean(e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent);
    if (own) return own;
    const inner = e.querySelector('[aria-label], [title]');
    return inner ? clean(inner.getAttribute('aria-label') || inner.getAttribute('title')) : '';
  }

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

    let sig = signature();
    if (clickPageNumber(1)) await waitChange(sig, 1500);

    sig = signature();
    visited.add(sig);
    scan(); pages = 1;

    while (pages < 300 && !stopRequested) {
      if (!getBars().length) break;
      let advanced = false;

      for (const el of nextCandidates()) {
        if (stopRequested) break;
        const prev = signature();
        el.click();
        if (await waitChange(prev, 2500)) { advanced = true; break; }
      }

      if (!advanced && !stopRequested) {
        for (const n of numberedPages().filter((n) => n !== 1)) {
          if (stopRequested) break;
          const prev = signature();
          if (!clickPageNumber(n)) continue;
          if (await waitChange(prev, 2500)) { advanced = true; break; }
        }
      }

      if (stopRequested || !advanced) break;
      const now = signature();
      if (visited.has(now)) break;
      visited.add(now);
      scan(); pages++;
    }
    return pages;
  }

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      .wrap{display:flex;flex-direction:column;align-items:flex-end;gap:6px}
      .dot{width:22px;height:22px;border-radius:50%;background:#e8472b;border:2px solid #fff;
           box-shadow:0 0 0 1px #555,0 2px 6px rgba(0,0,0,.4);cursor:pointer}
      .dot.busy{background:#888;cursor:wait}
      .toast{background:#111;color:#fff;padding:8px 10px;border-radius:6px;
             font:13px system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.4);white-space:nowrap}
      .hide{display:none}
    </style>
    <div class="wrap">
      <div class="toast hide" id="toast"></div>
      <div class="dot" id="dot" title="Collect all pages and download CSV"></div>
    </div>`;
  document.documentElement.appendChild(host);
  const dot = root.getElementById('dot');
  const toast = root.getElementById('toast');
  let toastTimer = null;
  function showToast(msg, ms) {
    toast.textContent = msg;
    toast.classList.remove('hide');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('hide'), ms || 3000);
  }

  let running = false;
  dot.onclick = async () => {
    if (running) {
      stopRequested = true;
      dot.title = 'Stopping...';
      console.log('[Route Hour Table] Stop requested — finishing current page...');
      return;
    }
    running = true;
    stopRequested = false;
    dot.classList.add('busy');
    dot.title = 'Collecting... (click dot to stop)';
    const hint = 'to stop, click on dot again-->';
    console.log('[Route Hour Table] ' + hint);
    showToast(hint, 3000);
    Object.keys(data).forEach((h) => delete data[h]);
    try {
      scan();
      const pages = await collectAll();
      scan();
      const routes = Object.keys(data).reduce((n, h) => n + Object.keys(data[h]).length, 0);
      const downloaded = downloadCSV();
      const msg = '[Route Hour Table] ' + (stopRequested ? 'Stopped after ' : '') +
        pages + ' page(s), ' + routes + ' route(s).' +
        (downloaded ? ' CSV downloaded.' : ' No data found.');
      console.log(msg);
      dot.title = msg;
    } finally {
      running = false;
      stopRequested = false;
      dot.classList.remove('busy');
    }
  };
})();
