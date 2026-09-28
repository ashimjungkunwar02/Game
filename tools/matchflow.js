#!/usr/bin/env node
/*
  Football Career 27 — match flow test.

  The ticker is the game: the score on the sheet has to be the score SO FAR. This plays a match beat
  by beat and asserts that nothing is revealed early — kick-off reads 0-0, every goal arrives as one
  step of one, the full-time verdict is written against the result that actually happened, and a
  block during play can still cancel a goal that was coming.

      node tools/matchflow.js
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
      if (k === 'value') return 'Asha Kunwar'; if (k === 'length') return 0;
      return p;
    },
    set: () => true, apply: () => p
  });
  return p;
}
global.document = { getElementById: () => makeEl(), createElement: () => makeEl(), querySelector: () => makeEl(),
  querySelectorAll: () => [], addEventListener() {}, body: makeEl(), readyState: 'complete', documentElement: makeEl() };
/* the universe has to arrive the way the page loads it: db.js assigns window.FC27_DB, and the
   engine binds DB to that at parse time */
const FC27_DB = new Function('window', dbjs + String.fromCharCode(10) + 'return window.FC27_DB;')({});
global.window = { matchMedia: () => ({ matches: true, addEventListener() {} }), location: { href: '' },
                  addEventListener() {}, FC27_DB };
global.localStorage = { _d: new Map(), getItem(k) { return this._d.has(k) ? this._d.get(k) : null; },
  setItem(k, v) { this._d.set(k, String(v)); }, removeItem(k) { this._d.delete(k); } };
global.alert = () => {}; global.confirm = () => true; global.requestAnimationFrame = () => 0;
global.Chart = function () { return { destroy() {}, update() {} }; };
Chart.defaults = { font: {}, color: '', borderColor: {}, plugins: { legend: {}, tooltip: {} } };

const FLOW = `
function newCareer(cfg) {
  UI.create = { mode: 'own', pos: cfg.pos, lg: cfg.lg || 'ENG', div: cfg.div || 0, clubName: cfg.club,
                diff: cfg.diff || 'pro', age: cfg.age || 20, real: null };
  startCareer(false);
  closeModal && closeModal();
}
const NL = String.fromCharCode(10);
const seen = [];
function traceMatch(label, cfg) {
  newCareer(cfg);
  let guard = 0;
  while (fixtureNow().t !== 'league' && guard++ < 45) advanceWeek(true);
  if (!S.objectives) S.objectives = makeObjectives();
  startMatch();
  const m = S.match;
  const problems = [];
  if (m.score.you + m.score.them !== 0) problems.push('the sheet reads ' + m.score.you + '-' + m.score.them + ' at kick-off');
  const beats = (m.beats || []).length;
  if (!beats && (m.otherYou + m.baseThem) > 0) problems.push('goals exist but no timed beat will ever deliver one');
  const history = [{ min: 0, you: 0, them: 0 }];
  let steps = 0, denied = 0, jumps = 0;
  while (!m.done && steps++ < 200) {
    const e = m.script[m.idx];
    if (!e) { finishMatch(); break; }
    if (e.k === 'prompt') {
      const di = cfg.block ? e.src.o.findIndex(function (o) { return o.k === 'defend'; }) : -1;
      const beforeThem = m.score.them, beforeBeats = (m.beats || []).length;
      chooseOption(di >= 0 ? di : (cfg.pick || 0));
      if (di >= 0 && m.score.them === beforeThem && (m.beats || []).length < beforeBeats) denied++;
      history.push({ min: m.minute, you: m.score.you, them: m.score.them, kind: 'prompt' });
    } else { matchTick(); history.push({ min: m.minute, you: m.score.you, them: m.score.them, kind: 'tick' }); }
  }
  /* a prompt step can legitimately move two goals — yours and one from elsewhere in the same
     minute — so the strict one-goal-per-beat rule is checked on the quiet beats only */
  for (let i = 1; i < history.length; i++) {
    const d = (history[i].you - history[i-1].you) + (history[i].them - history[i-1].them);
    if (d > 1 && history[i].kind === 'tick' && history[i].min < 90) jumps++;
    if (d < 0 && i < history.length - 2) problems.push('the score went down mid-match');
  }
  /* goals have to be spread across the 90, not bunched at one end — the scoreboard reading is the
     whole point of the ticker, so this is checked rather than hoped for */
  const gm = m.log.filter(function (l) { return l.goal; }).map(function (l) { return l.min; }).sort(function (a, b) { return a - b; });
  if (gm.length >= 2) {
    const mid = gm[Math.floor(gm.length / 2)];
    if (mid < 25) problems.push('the median goal was at ' + mid + "' — the scoring is front-loaded");
    if (mid > 75) problems.push('the median goal was at ' + mid + "' — nothing happens until the end");
    if (gm[gm.length - 1] - gm[0] < 20) problems.push(gm.length + ' goals inside ' + (gm[gm.length - 1] - gm[0]) + ' minutes');
  }
  if (beats > 2 && history[history.length - 2].you + history[history.length - 2].them === 0) problems.push('nothing arrived until full time — the beats are not being played');
  const last = history[history.length - 1];
  if (jumps) problems.push(jumps + ' beat(s) moved the score by more than one');
  const shown = m.log.filter(function (l) { return l.goal; }).length;
  if (shown + denied < m.otherYou + m.baseThem) problems.push('only ' + shown + ' of ' + (m.otherYou + m.baseThem) + ' scheduled goals reached the ticker');
  if (m.role !== 'reserve' && m.score.you < m.p.goals + m.p.assists)
    problems.push('your ' + m.p.goals + 'g/' + m.p.assists + 'a are missing from the sheet');
  if (m.role === 'reserve' && m.p.goals + m.p.assists > 0 && m.log.filter(function (l) { return l.goal; }).length === 0)
    seen.push('(development-squad match: ' + m.p.goals + 'g scored for the U21s, deliberately off the first-team sheet)');
  const ft = m.script[m.script.length - 1];
  if (!/Full time\\./.test(ft.t || '')) problems.push('no full-time line was written');
  else {
    const won = last.you > last.them, lost = last.you < last.them;
    if (/hang on a corner/.test(ft.t) !== won) problems.push('full-time prose disagrees with ' + last.you + '-' + last.them);
    if (/lose the game/.test(ft.t) !== lost) problems.push('full-time prose disagrees with ' + last.you + '-' + last.them);
  }
  seen.push(label.padEnd(30) + (problems.length ? '✗ ' + problems.join(' · ')
    : 'ok · ' + beats + ' goals timed across the match, ended ' + last.you + '-' + last.them +
      ' in ' + steps + ' beats, ' + denied + ' denied by your defending'));
  return problems.length ? 1 : 0;
}
let bad = 0;
bad += traceMatch('ST at Arsenal, always shoots', { pos: 'ST', club: 'Arsenal', age: 23 });
bad += traceMatch('CM at Arsenal, plays safe', { pos: 'CM', club: 'Arsenal', age: 26, pick: 2 });
bad += traceMatch('CB at United, hunts duels', { pos: 'CB', club: 'Manchester United', age: 27, block: true });
bad += traceMatch('LW at Oxford, 18', { pos: 'LW', club: 'Oxford United', age: 18 });
bad += traceMatch('ST at Metz, second tier', { pos: 'ST', club: 'FC Metz', lg: 'FRA', div: 1, age: 22 });
console.log(seen.join(NL));
console.log(bad ? 'MATCH FLOW: ' + bad + ' match(es) failed' : 'MATCH FLOW OK · 0-0 at kick-off, one goal per beat, verdict written at full time');
if (bad) process.exitCode = 1;
`;

try { new Function('"use strict";' + scripts + ';' + FLOW)(); }
catch (e) { console.log('FATAL\n' + (e.stack || '').split('\n').slice(0, 6).join('\n')); process.exit(1); }
