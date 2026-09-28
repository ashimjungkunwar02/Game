#!/usr/bin/env node
/*
  Football Career 27 — page-order check.

  Every other tool reads index.html and db.js side by side, which means a page that forgets to
  load db.js in the browser passes all of them and shows a blank tab. This one walks the
  <script> tags exactly as an HTML parser would — external src first, inline in place — so it
  fails if the universe file is not wired into the page before the engine reads window.FC27_DB.

      node tools/pageorder.js
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

/* ---- lenient DOM: elements are callable proxies so the render code executes for real ---- */
function makeEl(name) {
  const target = function () {};
  let p;
  p = new Proxy(target, {
    get(t, k) {
      if (k === Symbol.toPrimitive || k === Symbol.iterator) return () => 0;
      if (k === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (k === 'style') return {};
      if (k === 'dataset') return {};
      if (k === 'children') return [];
      if (k === 'value') return 'Asha Kunwar';
      if (k === 'innerHTML') return t.__html || '';
      if (k === 'id') return name || '';
      if (k === 'length') return 0;
      return p;
    },
    set(t, k, v) { if (k === 'innerHTML') t.__html = String(v); return true; },
    apply: () => p
  });
  return p;
}
const body = makeEl('body');
const els = new Map();
const sandbox = {
  console, setTimeout, clearTimeout, Math, JSON, Object, Array, String, Number, Boolean,
  Set, Map, Date, RegExp, parseInt, parseFloat, isFinite, isNaN, Promise, Error, encodeURI, encodeURIComponent, Intl,
  document: {
    readyState: 'complete',
    getElementById(id) { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); },
    createElement: () => makeEl(), querySelectorAll: () => [], querySelector: () => makeEl(),
    addEventListener() {}, body
  },
  window: { matchMedia: () => ({ matches: true, addEventListener() {} }), location: { href: '' }, addEventListener() {},
            ScrollTrigger: undefined, devicePixelRatio: 2, innerWidth: 390, innerHeight: 844 },
  localStorage: { _d: new Map(), getItem(k) { return this._d.has(k) ? this._d.get(k) : null; },
                  setItem(k, v) { this._d.set(k, String(v)); }, removeItem(k) { this._d.delete(k); } },
  location: { href: '' }, alert() {}, confirm: () => true, requestAnimationFrame: () => 0,
  IntersectionObserver: function () { return { observe() {}, unobserve() {} }; },
  Chart: function () { return { destroy() {}, update() {} }; }
};
sandbox.globalThis = sandbox;
sandbox.window.document = sandbox.document;
sandbox.window.localStorage = sandbox.localStorage;
sandbox.window.window = sandbox.window;
sandbox.Chart.defaults = { font: {}, color: '', borderColor: {}, plugins: { legend: {}, tooltip: {} } };
const ctx = vm.createContext(sandbox);

const problems = [];
let ran = 0;
const seen = [];
for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
  const attrs = m[1] || '';
  if (/\basync\b|\bdefer\b/.test(attrs)) problems.push('a script tag uses async/defer, so ordering against the engine is not guaranteed');
  const sm = attrs.match(/src=["']([^"']+)["']/);
  if (sm) {
    const src = sm[1];
    seen.push(src);
    if (/^(https?:)?\/\//.test(src)) continue;                      // CDN, not our concern here
    const file = path.join(root, src.replace(/^.\//, ''));
    if (!fs.existsSync(file)) { problems.push('the page loads "' + src + '" and that file is not next to index.html'); continue; }
    seen[seen.length - 1] = src + ' ✓ on disk';
    try { vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: src }); ran++; }
    catch (e) { problems.push(src + ' threw while loading: ' + e.message); }
    continue;
  }
  if (/tailwind\.config/.test(m[2])) continue;
  try { vm.runInContext(m[2], ctx, { filename: 'index.html' }); ran++; }
  catch (e) { problems.push('the engine script threw at parse/run time: ' + e.message); }
}

/* top-level `const` in a vm lives in the context's lexical scope, not on the context object, so
   every look at the engine's own bindings has to be an evaluation inside it */
const peek = expr => { try { return vm.runInContext('(function(){ try { return (' + expr + '); } catch (e) { return null; } })()', ctx); } catch (e) { return null; } };
const DB = ctx.window.FC27_DB;
if (!DB) problems.push('window.FC27_DB was never set — the universe file is not loaded by the page');
if (/db\.js is missing/.test(String(body.innerHTML))) problems.push('the page fell through to its "db.js is missing" banner');
const ENGINE_DB = peek('DB');
if (DB && (!ENGINE_DB || !ENGINE_DB.leagues || !ENGINE_DB.leagues.length)) problems.push('the engine bound DB to something with no leagues — the tag order is wrong');
if (peek('DB_MISSING')) problems.push('DB_MISSING is true even though the data loaded');
/* boot() runs at the bottom of the engine; if it got that far the shell exists and clubs resolved */
const CLUB_N = peek('Object.keys(CLUBS).length') || 0;
if (!problems.length && ENGINE_DB && ENGINE_DB.leagues.length && !CLUB_N) problems.push('the club registry came up empty');

console.log('page scripts: ' + seen.length + ' referenced, ' + ran + ' executed — ' + (seen.join(', ') || 'none'));
if (DB) console.log('universe: ' + DB.leagues.length + ' leagues · ' +
  DB.leagues.reduce((a, L) => a + L.divs.reduce((x, D) => x + D.clubs.length, 0), 0) + ' clubs · ' +
  DB.players.length + ' players · ' + DB.coaches.length + ' coaches · engine resolved ' + CLUB_N + ' clubs');
if (problems.length) { console.log('\nPAGE ORDER: ' + problems.length + ' problem(s)'); problems.forEach(p => console.log('  ✗ ' + p)); process.exit(1); }
console.log('PAGE ORDER OK · the page loads its own data, in the right order, and boots without the banner');
