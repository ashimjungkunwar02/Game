#!/usr/bin/env node
/*
  Football Career 27 — real-career takeover test.

  Mode A has to land you in a season, in the right shirt, with the attributes the database carries and
  a wage that fits the club. It used to throw mid-start for the 827 imported players who are not one of
  the six positions the engine knew about — and a throw there left a half-built state on screen, which
  reads to a player as "the takeover went nowhere". Every position in the data is exercised here.

      node tools/takeover.js            # ~30 takeovers: every position + a random spread
      node tools/takeover.js all        # every club's best player (192 takeovers)
*/
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const dbjs = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

function makeEl() {
  const target = function () {}; let p;
  p = new Proxy(target, {
    get(t, k) {
      if (k === Symbol.toPrimitive || k === Symbol.iterator) return () => 0;
      if (k === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (k === 'style') return {}; if (k === 'dataset') return {}; if (k === 'children') return [];
      if (k === 'value') return globalThis.__val || '';
      if (k === 'innerHTML') return t.__html || '';
      if (k === 'length') return 0;
      return p;
    },
    set(t, k, v) { if (k === 'innerHTML') t.__html = String(v); return true; },
    apply: () => p
  });
  return p;
}
global.document = { getElementById: () => makeEl(), createElement: () => makeEl(), querySelector: () => makeEl(),
  querySelectorAll: () => [], addEventListener() {}, body: makeEl(), readyState: 'complete', documentElement: makeEl() };
const FC27_DB = new Function('window', dbjs + String.fromCharCode(10) + 'return window.FC27_DB;')({});
global.window = { matchMedia: () => ({ matches: true, addEventListener() {} }), location: { href: '' }, addEventListener() {}, FC27_DB };
global.localStorage = { _d: new Map(), getItem(k) { return this._d.has(k) ? this._d.get(k) : null; },
  setItem(k, v) { this._d.set(k, String(v)); }, removeItem(k) { this._d.delete(k); } };
global.alert = () => {}; global.confirm = () => true; global.requestAnimationFrame = () => 0;
global.navigator = { clipboard: { writeText: () => Promise.resolve() } };
global.Chart = function () { return { destroy() {}, update() {} }; };
Chart.defaults = { font: {}, color: '', borderColor: {}, plugins: { legend: {}, tooltip: {} } };

const MODE = process.argv.includes('all') ? 'all' : 'sample';

const BODY = `
const NL = String.fromCharCode(10);
const rows = DB.players.map(function (r) { return r.split('|'); });
const byPos = {};
rows.forEach(function (r) { (byPos[r[2]] = byPos[r[2]] || []).push(r); });
const targets = [];
if ('MODE' === 'all') {
  DB.leagues.forEach(function (L) { L.divs.forEach(function (D) { D.clubs.forEach(function (c) {
    const code = c.split('|')[1];
    const best = rows.filter(function (r) { return r[5] === code; }).sort(function (a, b) { return b[3] - a[3]; })[0];
    if (best) targets.push(best);
  }); }); });
} else {
  Object.keys(byPos).forEach(function (p) { byPos[p].slice(0, 2).forEach(function (r) { targets.push(r); }); });
  const shuffled = rows.slice();
  for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const x = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = x; }
  shuffled.slice(0, 14).forEach(function (r) { targets.push(r); });
}

let bad = 0, lines = [];
const seenNames = {};
targets.forEach(function (r) {
  const name = r[0];
  if (seenNames[name]) return; seenNames[name] = 1;
  const want = { name: name, nat: r[1], pos: r[2], ovr: +r[3], age: +r[4], clubCode: r[5] };
  const errs = [];
  let mm = null, played = 'no match';
  try {
    UI.create = { mode: 'own', pos: 'ST', lg: 'ENG', div: 0, clubName: 'Arsenal', diff: 'pro', age: 17, real: null };
    UI.tab = 'home'; UI.modal = null; S = null;
    setMode('real');
    globalThis.__val = ''; renderReal();
    selReal(want.name);
    if (!UI.create.real) errs.push('selecting the player did not stick');
    globalThis.__val = want.name; renderReal();       // the search field + panel with a real pick in it
    startCareer(false);
  } catch (e) { errs.push('threw during takeover: ' + e.message); }
  if (!S) { lines.push(name.padEnd(24) + '✗ never landed — no state was created' + (errs.length ? ' (' + errs[0] + ')' : '')); bad++; return; }
  const R = UI.create.real || {};
  if (errs.length === 0) {
    if (S.club.short !== want.clubCode) errs.push('signed for ' + S.club.short + ', expected ' + want.clubCode + ' (' + R.club + ')');
    if (S.pos !== want.pos) errs.push('plays ' + S.pos + ', the database says ' + want.pos);
    if (Math.abs(S.ovr - want.ovr) > 1) errs.push('ovr ' + S.ovr + ' vs the file overall ' + want.ovr);
    const six = ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical'];
    const at = (r[6] || '').split(',').map(Number);
    if (at.length === 6 && at.every(function (x) { return x >= 15 && x <= 99; })) {
      const off = six.filter(function (k, i) { return S.attrs[k] !== at[i]; });
      if (off.length) errs.push('attributes are not the imported ones (' + off.join(',') + ')');
    }
    const rounds = (S.rounds || []).length, tableN = Object.keys(S.table || {}).length;
    if (!rounds || tableN < 18) errs.push('no season around him (' + rounds + ' rounds, ' + tableN + ' table rows)');
    if (!(S.contract.wage > 0 && S.contract.wage <= 780000)) errs.push('wage ' + S.contract.wage);
    if (S.ovr < 80 && S.contract.wage > 520000) errs.push('a ' + S.ovr + ' on ' + S.contract.wage + '/wk — the ceiling is not a salary');
    if (!['starter', 'sub', 'reserve', 'injured', 'susp'].includes(role())) errs.push('role ' + role());
    if (UI.modal !== null) errs.push('a modal is still open: ' + UI.modal);
    if (!S.msgs.length || S.msgs[0].kind !== 'START') errs.push('no opening message');
    const f = fixtureNow();
    if (!f || !f.t) errs.push('no fixture to play');
    /* and then actually play the thing: a takeover that lands but throws on the first Saturday is
       the same bug wearing a different hat, and for full-backs it is exactly what happened */
    else {
      if (!S.objectives) S.objectives = makeObjectives();
      startMatch();
      mm = S.match; let guard = 0;
      while (mm && !mm.done && guard++ < 80) {
        const e = mm.script[mm.idx];
        if (!e) { finishMatch(); break; }
        if (e.k === 'prompt') { const si = e.src.o.findIndex(function (o) { return o.k === 'shot'; }); chooseOption(si < 0 ? 0 : si); }
        else matchTick();
      }
      if (mm && !mm.done) finishMatch();
      if (!mm || !isFinite(mm.rating)) errs.push('the first match never resolved');
      else if (mm.role === 'starter' && !mm.log.length) errs.push('no ticker lines');
      played = (mm && mm.p ? mm.p.goals + 'g/' + mm.p.assists + 'a' : '-');
      afterReport(); UI.modal = null;
    }
  }
  const tag = want.pos + ' ' + S.ovr + ' @' + S.club.short + ' ' + Math.round(S.contract.wage / 1000) + 'k/wk ' + role();
  if (errs.length) { bad++; lines.push(name.padEnd(24) + '✗ ' + tag + NL + ' '.repeat(26) + '· ' + errs.join(NL + ' '.repeat(26) + '· ')); }
  else lines.push(name.padEnd(24) + 'ok ' + tag + ' · played, rtg ' + (mm ? mm.rating.toFixed(2) : '?') + ' ' + (mm ? mm.score.you + '-' + mm.score.them : '?') + ' (' + played + ')' + (r[6] ? ' · real attrs' : ''));
});
console.log('takeovers checked: ' + Object.keys(seenNames).length + ' (positions in the data: ' + Object.keys(byPos).join(' ') + ')');
console.log(lines.join(NL));
console.log(bad ? 'TAKEOVER: ' + bad + ' of ' + lines.length + ' did not land' : 'TAKEOVER OK · every sampled real career lands, in its own shirt, with its own numbers');
if (bad) process.exitCode = 1;
`.replace("'MODE'", JSON.stringify(MODE));

try { new Function('"use strict";' + scripts + ';' + BODY)(); }
catch (e) { console.log('FATAL\n' + (e.stack || '').split('\n').slice(0, 5).join('\n')); process.exit(1); }
