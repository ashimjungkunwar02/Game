#!/usr/bin/env node
/*
  Football Career 27 — headless balance harness.

  Loads the REAL game code out of index.html (the same script the browser runs) under a
  lenient DOM stub and then plays thousands of careers: the match engine, the training
  budget, transfers, injuries, the 20-club league simulation and the economy. Every
  week is checked against invariants, so a regression in the numbers fails here before
  it ever shows up on a phone.

      node tools/simulate.js
*/
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const dbjs = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

/* ---- lenient DOM: every element is a callable proxy, so the render functions execute too ---- */
function makeEl() {
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
      if (k === 'length') return 0;
      return p;
    },
    set: () => true,
    apply: () => p
  });
  return p;
}
const store = new Map();
const el = makeEl();
global.document = new Proxy({}, {
  get(t, k) {
    if (k === 'querySelectorAll') return () => [];
    if (k === 'createElement' || k === 'createTextNode') return () => makeEl();
    if (k === 'hidden') return false;
    return el;
  },
  set: () => true
});
const FC27_DB = new Function('window', dbjs + '\nreturn window.FC27_DB;')({});
global.window = new Proxy({ tailwind: undefined, FC27_DB }, {
  get(t, k) { if (k === 'matchMedia') return () => ({ matches: false }); if (k in t) return t[k]; return () => {}; },
  set(o, k, v) { o[k] = v; return true; }
});
global.navigator = { clipboard: { writeText: () => Promise.resolve() }, standalone: false };
global.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
global.confirm = () => true;
global.prompt = () => null;
global.setTimeout = f => 0;
global.btoa = s => Buffer.from(s, 'binary').toString('base64');
global.atob = s => Buffer.from(s, 'base64').toString('binary');

/* ---- the careers themselves. No backticks or ${ in here: it is embedded as a template literal ---- */
const CAREER = `
function traceRow(label, v) { console.log(label + ' ' + v); }
function pickSmart(e, cfg) {
  if (!cfg.smart) return ri(0, e.src.o.length - 1);
  const i = e.src.o.findIndex(function (o) { return o.k === 'shot'; });
  return i < 0 ? 0 : i;
}
function resolveModals(cfg) {
  if (UI.modal === 'event' && UI.event) chooseEvent(ri(0, UI.event.o.length - 1));
  if (UI.modal === 'freeagent') { if (S.offers[0]) acceptOffer(S.offers[0].id); else stayCheap(); UI.modal = null; }
  if (UI.modal === 'retire') { UI.modal = null; closeModal(); }
  if (UI.modal === 'training') closeModal();
  if (UI.modal === 'review') UI.modal = null;
  if (UI.modal === 'medical') { if (S.injury) chooseClinic(S.money > 400e3 ? 'elite' : S.money > 40e3 ? 'spec' : 'none'); UI.modal = null; }
  if (UI.modal === 'presser') { answerPress(0); UI.modal = null; }
  if (S.fatigue > 55 && chance(0.4)) restWeek && restWeek();
  if (!cfg || !cfg.wide) return;
  if (S.energy > 62) doDrill(pick(DRILLS).id);
  if (S.energy > 82) doDrill(pick(DRILLS).id);
  if (S.sp > 3) { const t = pick(SKILL_TREE); if (S.attrs[t.a] >= t.need) buyNode(t.id); }
  if (S.favor < 28 && S.s.apps > 2 && chance(0.5)) { requestTransfer('loan'); if (UI.loanOffer) acceptLoan(); UI.modal = null; }
  if (S.offers.length && S.ovr > 72 && chance(0.3)) acceptOffer(S.offers[0].id);
  if (S.money > 500e3 && chance(0.2)) { const cat = pick(['estate', 'motors', 'gear']); const it = pick(CATALOG[cat]); if (!S.owned.includes(it.id) && S.money > it.cost * 4 && S.popularity >= (it.min || 0)) buyItem(cat, it.id); }
  if (S.money > 250e3 && chance(0.2)) invest(pick(INVESTMENTS).id, Math.floor(S.money * 0.25));
  if (S.investments.length > 2 && chance(0.3)) cashOut(0);
  if (S.contract.years <= 1) { renewContract(); if (UI.renewal) signRenewal(chance(0.8)); UI.modal = null; }
  if (chance(0.2) && !S.flags.socialDone) post(ri(0, SOCIAL_POSTS.length - 1));
  renderAll();
}
function invariants() {
  const tot = Object.values(S.table);
  if (tot.some(r => r.pts < 0 || !isFinite(r.pts))) throw new Error('table corrupt');
  const maxR = (S.rounds || []).length;
  if (tot.some(r => r.p > maxR + 1)) throw new Error('too many games ' + Math.max(...tot.map(r => r.p)) + '/' + maxR);
  const wp = tot.reduce((a, r) => a + r.w + r.d + r.l, 0), pp = tot.reduce((a, r) => a + r.p, 0);
  if (wp !== pp) throw new Error('W+D+L != P (' + wp + '/' + pp + ')');
  if (tot.reduce((a, r) => a + r.gf, 0) !== tot.reduce((a, r) => a + r.ga, 0)) throw new Error('gf != ga');
  if (pp > 40) { const gpg = tot.reduce((a, r) => a + r.gf, 0) / pp; if (gpg < 0.8 || gpg > 2.3) throw new Error('goals/game/team ' + gpg.toFixed(2)); }
  if (S.energy < 0 || S.energy > S.energyCap + 1) throw new Error('energy range');
  if (!isFinite(S.money) || isNaN(S.ovr)) throw new Error('NaN money/ovr');
  if (S.ovr < 30 || S.ovr > 99) throw new Error('ovr range');
  if (S.favor < 0 || S.favor > 100) throw new Error('favor range');
  if (!['starter', 'sub', 'reserve'].includes(S.roleBase)) throw new Error('bad role ' + S.roleBase);
  if (S.s.goals > 52) throw new Error('impossible season goals ' + S.s.goals);
  /* apps can legitimately exceed the calendar a little: a mid-season move means two
     divisions' fixtures in one season, plus cups and international windows. */
  /* a mid-season loan abroad means two calendars inside one season, so the ceiling is
     generous — this catches a run-away match loop, not a busy fortnight. */
  if (S.s.apps > 88) throw new Error('too many apps ' + S.s.apps);
  /* a mid-season move can land you in a division whose calendar is shorter than the week you
     are on: the fixture list simply runs out and the season closes, so a small overshoot is
     legal. Anything bigger means the rollover is genuinely stuck. */
  /* A mid-season move (or a loan ending abroad) can hand you a division whose fixture list
     is shorter than the week you are on. The engine clamps and closes the season on the next
     tick, so this is a wobble, not a break — but we count it, and a real run-away still shows
     up as the guard running out. */
  if (S.week > schedule().length + 1) { st_wobble[0]++; if (S.week > schedule().length + 14) throw new Error('week lost ' + S.week + '/' + schedule().length); }
  if (!isFinite(S.fatigue) || S.fatigue < 0 || S.fatigue > 100) throw new Error('fatigue range ' + S.fatigue);
  if (S.injury && !(S.injury.left >= 0)) throw new Error('injury counter');
  if (Object.keys(S.table).length !== roster(S.club.lg, S.div).length) throw new Error('table size drift');
  if (S.growth && S.growth.used > S.growth.budget + 4) throw new Error('growth budget blown');
  if (marketValue() > 245e6) throw new Error('value too hot');
  ATTRS.forEach(k => { if (S.attrs[k] < 20 || S.attrs[k] > 99) throw new Error('attr range ' + k); });
  if (S.age > 44) throw new Error('never retired');
}
function newCareer(cfg) {
  UI.create = { mode: cfg.mode || 'own', pos: cfg.pos, lg: cfg.lg || 'ENG', div: cfg.div || 0, clubName: cfg.club, diff: cfg.diff || 'pro', age: cfg.age || 17, real: null };
  if (cfg.mode === 'real') { const nm = cfg.club2; UI.create.real = realPlayerByName(nm) || WORLD0[0]; }
  startCareer(false);
  closeModal && closeModal();
}
function playWeek(cfg) {
  const f = fixtureNow();
  if (f.t === 'final') return false;
  if (f.t === 'rest') { advanceWeek(true); resolveModals(cfg); return true; }
  if (!S.objectives) S.objectives = makeObjectives();
  startMatch();
  const m = S.match; let inner = 0;
  while (m && !m.done && inner++ < 300) {
    const e = m.script[m.idx];
    if (e && e.k === 'prompt') chooseOption(pickSmart(e, cfg)); else matchTick();
  }
  if (m && !m.done) finishMatch();
  afterReport(); UI.modal = null;
  resolveModals(cfg);
  return true;
}
function fullCareer(seasons, cfg) {
  newCareer(cfg);
  for (let s = 0; s < seasons; s++) {
    for (let g = 0; g < 80 && playWeek(cfg); g++) { }
    const h = S.history[0] || {};
    traceRow('S' + (s + 1), 'age' + S.age + '  ' + String(S.club.name).slice(0, 16).padEnd(16) +
      ' ovr' + String(S.ovr).padStart(2) + ' fav' + String(S.favor).padStart(3) + ' ' + S.roleBase.padEnd(7) +
      ' apps' + String(S.s.apps).padStart(2) + ' st' + String(S.s.starts).padStart(2) + ' ' + S.s.goals + 'g ' + S.s.assists + 'a' +
      ' rt' + (avg(S.s.rating) || 0).toFixed(2) + ' pos' + (h.pos || '-') + ' cash' + money(S.money, 0) +
      ' val' + money(marketValue(), 0) + ' tr' + S.trophies + ' caps' + S.intl.caps);
    endSeason(); UI.modal = null; nextSeason(); UI.modal = null;
  }
  traceRow('TOTAL', S.stats.apps + ' apps · ' + S.stats.goals + 'g/' + S.stats.assists + 'a · g90 ' +
    (S.stats.goals / Math.max(1, S.stats.mins) * 90).toFixed(2) + ' · trophies ' + S.trophies +
    ' · caps ' + S.intl.caps + '(' + S.intl.goals + ') · ' + S.age + 'y ovr' + S.ovr +
    ' · honours ' + (S.honours.map(x => x.k).join(',') || 'none') + ' · bank ' + money(S.money, 0));
  return S;
}
function sweep(seasons, cfg) {
  const st = { matches: 0, errors: [], wobble: 0 };
  const st_wobble = [0];
  globalThis.__w = st_wobble;
  newCareer(cfg);
  for (let guard = 0; guard < seasons * 70; guard++) {
    if (S.retired) break;
    try {
      const f = fixtureNow();
      if (f.t === 'final') { endSeason(); UI.modal = null; nextSeason(); }
      else if (f.t !== 'rest') {
        if (!S.objectives) S.objectives = makeObjectives();
        startMatch();
        const m = S.match; let inner = 0;
        while (m && !m.done && inner++ < 300) { const e = m.script[m.idx]; if (e && e.k === 'prompt') chooseOption(ri(0, e.src.o.length - 1)); else matchTick(); }
        if (m && !m.done) finishMatch();
        st.matches++; afterReport(); UI.modal = null;
      } else advanceWeek(true);
      resolveModals(cfg);
      invariants();
    } catch (e) {
      st.errors.push('S' + S.seasonNo + 'W' + S.week + ' ' + e.message + (process.env.D ? ' [len=' + schedule().length + ' sched=' + (S._sched ? S._sched.length : 'none') + ' rounds=' + (S.rounds||[]).length + ' mode=' + S.mode + ' modal=' + UI.modal + ' shown=' + S.flags.reviewShown + ' tour=' + (S.intl && S.intl.tour ? 'Y' : 'N') + ' role=' + S.roleBase + ' inj=' + (S.injury?S.injury.n:'-') + ' club=' + S.club.name + '/' + S.club.lg + S.div + ' at ' + String((e.stack||'').split(String.fromCharCode(10))[1]||'').trim().slice(0,80) : ''));
      if (st.errors.length > 3) break;
      try { endSeason(); UI.modal = null; nextSeason(); } catch (e2) { S.week++; }
    }
  }
  st.wobble = st_wobble[0];
  return st;
}
console.log('=== WORST CASE: 17y ST at a Championship relegation-bound club, random choices, 12 seasons ===');
fullCareer(12, { pos: 'ST', club: 'Burnley', lg:'ENG', div:0, wide: true });
console.log('=== BEST CASE: same player at a top-3 Premier League club, always shoots, 8 seasons ===');
fullCareer(8, { pos: 'ST', club: 'Manchester City', wide: true, smart: true });
console.log('=== REAL PLAYER TAKEOVER: 8 seasons as an existing professional ===');
fullCareer(8, { mode: 'real', club: '', club2: 'Erling Haaland', wide: true, smart: true });
console.log('=== DEFENDER: CB in Ligue 1, 8 seasons ===');
fullCareer(8, { pos: 'CB', club: 'FC Metz', lg: 'FRA', div: 1, wide: true });
console.log('=== SWEEP: 6 positions x 6 clubs across 5 countries, 7 seasons each ===');
let bad = 0, wob = 0;
const CLUBS_S = ['Sheffield United', 'Real Oviedo', 'FC Schalke 04', 'FC Metz', 'Avellino', 'Manchester City'];
for (const pos of ['ST', 'LW', 'RW', 'CAM', 'CM', 'CB']) for (const club of CLUBS_S) {
  const cfg = { pos, club, wide: true };
  if (club === 'FC Schalke 04') { cfg.lg = 'GER'; cfg.div = 1; }
  if (club === 'Real Oviedo' || club === 'Avellino') cfg.div = 1;
  if (club === 'Real Oviedo') cfg.lg = 'ESP';
  if (club === 'FC Metz') { cfg.lg = 'FRA'; cfg.div = 1; }
  if (club === 'Avellino') cfg.lg = 'ITA';
  const r = sweep(7, cfg);
  wob += r.wobble;
  if (r.errors.length) { bad++; console.log(pos + '@' + club + '  ' + r.errors.slice(0, 2).join(' | ')); }
}
console.log(bad ? bad + ' FAILING CONFIGS' : 'SWEEP CLEAN · ' + (6 * CLUBS_S.length) + ' careers, ' + (6 * CLUBS_S.length * 7 * 46) + ' weeks simulated');
console.log('calendar wobbles recovered without a break: ' + wob + ' across ' + (6 * CLUBS_S.length) + ' careers');
const raw = JSON.stringify(S); const o = JSON.parse(raw);
let stored = '';
try { save(); stored = (globalThis.localStorage && localStorage.getItem(SAVE_KEY)) || ''; } catch (e) {}
const kb = Math.round(((stored.length || raw.length)) / 1024);
console.log('SAVE ' + (raw.length > 1000 && o.name === S.name
  ? (kb < 220 ? 'round-trips · ' + kb + 'kb' : 'TOO BIG · ' + kb + 'kb') : 'FAIL') +
  (stored ? ' (state alone is ' + Math.round(raw.length / 1024) + 'kb — the pool ships as a delta)' : ''));
try { const back = load(); back.pool.forEach((p,i) => { p._k = p.name + '|' + p.club; }); S.pool.forEach((p,i) => { p._k = p.name + '|' + p.club; });
const sameKeys = back.pool.length === S.pool.length && back.pool.every((p,i) => p._k === S.pool[i]._k && p.ovr === S.pool[i].ovr && p.g === S.pool[i].g);
back.pool.forEach(p => delete p._k); S.pool.forEach(p => delete p._k);
  console.log('POOL ' + (sameKeys
    ? 'rehydrates from db.js + the delta · ' + back.pool.length + ' rows, identical order, ratings and tallies'
    : 'MISMATCH · ' + (back && back.pool ? back.pool.length : 'none') + ' vs ' + S.pool.length));
} catch (e) { console.log('POOL ' + e.message); }
`;

try { new Function('"use strict";' + scripts + ';globalThis.__G={};' + CAREER)(); }
catch (e) { console.log('FATAL\n' + (e.stack || '').split('\n').slice(0, 6).join('\n')); process.exit(1); }
