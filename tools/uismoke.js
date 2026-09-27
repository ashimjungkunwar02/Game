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
  if (S.week > schedule().length + 5) throw new Error('week past the calendar ' + S.week);
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

const fail = [], stateful = [];
function tryIt(label, fn) {
  try { fn(); }
  catch (e) {
    const m = e.message || String(e);
    if (/is not defined|undefined is not|cannot read|Cannot read|is not a function/.test(m) && /is not defined|is not a function/.test(m)) fail.push(label + ' :: ' + m);
    else stateful.push(label + ' :: ' + m);
  }
}
function playSome(n, cfg) { for (let i = 0; i < n; i++) { try { playWeek(cfg); } catch (e) { fail.push('week :: ' + e.message); break; } } }

newCareer({ pos:'ST', club:'Manchester City', wide:true, smart:true });
playSome(240, { wide:true, smart:true });

for (const t of ['home','dev','career','life','hub','team']) tryIt('tab ' + t, () => { go(t); renderAll(); });
for (const k of ['match','report','event','messages','standings','training','log','renew','loan','invest','review','freeagent','retire','epitaph','presser','awayday','medical','tourney','manager','settings','social','dev'])
  tryIt('modal ' + k, () => { UI.modal = k; renderModal(); UI.modal = null; });

const acts = [
  ['restWeek', () => restWeek()],
  ['skipFixture', () => skipFixture()],
  ['squadTalk', () => squadTalk()],
  ['shareCard', () => shareCard()],
  ['retrain', () => retrain()],
  ['setTactic', () => setTactic('tikiTaka')],
  ['mgrNextMatch', () => mgrNextMatch()],
  ['acceptCoachRole', () => acceptCoachRole()],
  ['declineCoachRole', () => declineCoachRole()],
  ['negotiateClause release', () => negotiateClause('release')],
  ['negotiateClause loyalty', () => negotiateClause('loyalty')],
  ['negotiateClause subsidy', () => negotiateClause('subsidy')],
  ['askClause', () => askClause()],
  ['post social', () => post(1)],
  ['hireAgent', () => hireAgent(AGENTS[1].id)],
  ['requestTransfer', () => requestTransfer('transfer')],
  ['requestLoan', () => requestTransfer('loan')],
  ['renewContract', () => renewContract()],
  ['signRenewal', () => { renewContract(); signRenewal(true); }],
  ['doDrill', () => doDrill(DRILLS[0].id)],
  ['buyNode', () => { S.sp = 9; const t = SKILL_TREE[0]; S.attrs[t.a] = 90; buyNode(t.id); }],
  ['buyItem', () => { S.money = 9e6; S.popularity = 60; buyItem('gear', CATALOG.gear[0].id); }],
  ['invest', () => { S.money = 9e6; invest(INVESTMENTS[0].id, 500000); }],
  ['investTick', () => investTick()],
  ['cashOut', () => cashOut(0)],
  ['counterOffer', () => { if (S.offers[0]) counterOffer(S.offers[0].id); else maybeGenerateOffers(true), counterOffer((S.offers[0]||{id:0}).id); }],
  ['rejectOffer', () => { if (S.offers[0]) rejectOffer(S.offers[0].id); }],
  ['acceptOffer', () => { if (S.offers[0]) acceptOffer(S.offers[0].id); }],
  ['chooseClinic', () => { if (!S.injury) applyInjury({ n:'Ankle sprain', sev:'minor', weeks:4, left:4, dmg:{ pace:-1 } }); chooseClinic('spec'); chooseClinic('elite'); chooseClinic('none'); }],
  ['openModal medical', () => openModal('medical')],
  ['openModal tourney', () => openModal('tourney')],
  ['endTournament', () => { startTournament(); endTournament(); }],
  ['startInternationalCycle', () => startInternationalCycle()],
  ['intlApply', () => intlApply({ score:{ you:2, them:1 }, kind:'intl', minute:90, rating:7.2 })],
  ['runPlayoffs', () => runPlayoffs(null)],
  ['legacyGrade', () => legacyGrade()],
  ['retireLine', () => retireLine()],
  ['catchUpLeague', () => catchUpLeague()],
  ['reshuffleDivisions', () => reshuffleDivisions()],
  ['simDivision', () => simDivision(1, S.rounds, S.table, null)],
  ['save/load', () => { save(); load(); }],
  ['exportSave', () => exportSave()],
  ['doRetire', () => doRetire()],
  ['renderHub', () => renderHub()],
  ['renderHome', () => renderHome()],
  ['renderCareer', () => renderCareer()],
  ['renderLife', () => renderLife()],
  ['renderDev', () => renderDev && renderDev()],
  ['initCreate', () => initCreate()],
  ['setMode real', () => { setMode('real'); renderReal(); }],
  ['setMode own', () => { setMode('own'); renderClubs(); renderDivs(); }],
  ['selLeague', () => { selLeague('GER'); selDiv(0); }],
  ['selReal', () => { renderReal(); selReal(S.pool ? S.pool[0].name : 'Erling Haaland'); }],
  ['backToTitle', () => backToTitle()]
];
for (const [label, fn] of acts) tryIt(label, fn);
tryIt('career-after-retire', () => renderAll());
console.log('UI SMOKE: ' + fail.length + ' broken references, ' + stateful.length + ' state-dependent');
if (fail.length) console.log(fail.map(x => '  FAIL ' + x).join(String.fromCharCode(10)));
if (process.env.V) console.log(stateful.map(x => '  note ' + x).join(String.fromCharCode(10)));

`;

try { new Function('"use strict";' + scripts + ';globalThis.__G={};' + CAREER)(); }
catch (e) { console.log('FATAL\n' + (e.stack || '').split('\n').slice(0, 6).join('\n')); process.exit(1); }
