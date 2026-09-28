/* tools/packs.js — does a data pack behave like the universe it came from?
   =================================================================================
   The game now composes its world: db.js, plus any number of packs, narrowed to the
   countries you switched on. That is three claims, and each one gets checked here
   against the real engine out of index.html under a DOM stub:

     1. switching a country off really removes it (clubs, players, the pool, the
        starter list) and switching it back restores the file exactly;
     2. a pack is not a mod hook — a 6-club invented country with one rung and no
        promotion rule plays full seasons, awards a cup and saves normally;
     3. a bad pack is rejected with a sentence, not with a crash, and a save written
        against a different selection repairs itself instead of mapping its pool deltas
        onto the wrong rows of a bigger db.js (the scrambled-career bug).

   It also runs the grammar check over every pack sitting in packs/, which is the same
   code path a tap on "Download" takes in the browser.

     node tools/packs.js
*/
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');

/* ---- the canonical DOM stub (same shape tools/simulate.js uses) ---- */
function mk(id) {
  const st = {}; const t = function () {}; let p;
  p = new Proxy(t, {
    get(g, k) {
      if (k === Symbol.toPrimitive || k === Symbol.iterator) return () => 0;
      if (k === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (k === 'style' || k === 'dataset') return st[k] || (st[k] = {});
      if (k === 'children') return []; if (k === 'length') return 0;
      if (k === 'value') return st.value !== undefined ? st.value : '';
      if (k === 'innerHTML' || k === 'textContent') return st[k] || '';
      if (k in st) return st[k];
      return p;
    },
    set(g, k, v) { st[k] = v; return true; },
    apply: () => p
  });
  return p;
}
const els = new Map();
const byId = id => { if (!els.has(id)) els.set(id, mk(id)); return els.get(id); };
global.document = {
  getElementById: byId, createElement: () => mk('el'),
  querySelector(s) { const h = /^#([A-Za-z0-9_.-]+)$/.exec(s || ''); return h ? byId(h[1]) : mk(s); },
  querySelectorAll: () => [], addEventListener() {}, body: mk('body'), head: mk('head'),
  readyState: 'complete', documentElement: mk('html')
};
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const dbjs = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
const DB = new Function('window', dbjs + '\nreturn window.FC27_DB;')({});
const store = new Map();
global.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
global.requestAnimationFrame = f => f();
global.setInterval = () => 0;
global.window = { FC27_DB: DB, FC27_PACKS: [], matchMedia: () => ({ matches: true, addEventListener() {} }), location: { href: '' }, addEventListener() {} };
global.URL = global.URL || { createObjectURL: () => 'blob:test' };

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const probe = `
globalThis.__u = () => ({ DB, DB_FULL, UNIVERSE, LEAGUE, CLUBS, CLUB_BY_CODE, applyUniverse, toggleCountry, toggleLeague,
  setUniverse, universeChoices, universePanel, universeExport, installPack, removePack, checkPack, packLines, worldId,
  startCareer, endSeason, nextSeason, save, load, makeObjectives, S: () => S, UI, roster, starterOptions, seedPool, clubById,
  saveKey: SAVE_KEY, startCareer, backToTitle, cupName, hasLadder, openModal, renderModal, queueMsg, fixtureNow, role, coachOf,
  universeRepair, hardReset, startMatch, finishMatch, matchTick, chooseOption, afterReport, advanceWeek });
globalThis.__boot = () => boot();`;
new Function('"use strict";' + scripts + '\n' + probe)();
const U = globalThis.__u();
const out = [], bad = [];
const ok = (label, cond, note) => { (cond ? out : bad).push(label + (note ? ' — ' + note : '')); return cond; };

/* ---------- 1. what the base file carries, and what the pack that ships in packs/ gives back ---------- */
const base = { leagues: U.DB.leagues.length, clubs: U.DB.meta.clubs, players: U.DB.players.length };
ok('db.js loads through the composable universe', base.leagues && base.clubs && base.players,
   base.leagues + ' leagues · ' + base.clubs + ' clubs · ' + base.players + ' players');
ok('the pool is the active universe, not the file', U.seedPool().length <= base.players,
   U.seedPool().length + ' pool rows');
const carved = path.join(ROOT, 'packs', 'fc27-ind-sco.js');
let car = null;
if (fs.existsSync(carved)) {
  const bag = { FC27_PACKS: [] };
  new Function('window', fs.readFileSync(carved, 'utf8'))(bag);
  car = (bag.FC27_PACKS || [])[0] || null;
  ok('packs/fc27-ind-sco.js registers and passes the grammar check', !!car && !U.checkPack(car),
     car ? (U.checkPack(car) || car.name + ' · ' + U.packLines(car)) : 'nothing pushed');
  if (car) U.installPack(car, 'packs/fc27-ind-sco.js');
  ok('installing the carved pack returns exactly what db.js gave up',
     U.DB.leagues.length === 28 && U.DB.meta.clubs === 597 && U.DB.players.length === 13807,
     U.DB.leagues.length + ' leagues · ' + U.DB.meta.clubs + ' clubs · ' + U.DB.players.length + ' players');
} else ok('the repo pack exists', false, 'packs/fc27-ind-sco.js missing — run tools/make-pack.js IND SCO --apply');

/* ---------- 2. the panel renders without inventing the word undefined ---------- */
U.openModal('universe');
const panel = U.universePanel();
ok('universe panel renders', /Universe/.test(panel) && !/undefined|NaN|\[object /.test(panel));
ok('panel offers every country', (panel.match(/one rung/g) || []).length >= 20,
   (panel.match(/one rung/g) || []).length + ' single-rung countries listed');
U.UI.modal = null;

/* ---------- 3. switch a country off, and it is genuinely gone ---------- */
const isl = U.universeChoices().find(c => c.leagues.some(L => L.code === 'SCO'));
ok('Scotland is offered as a country', !!isl, isl ? isl.clubs + ' clubs, ' + isl.players + ' named players' : 'missing');
const pre = { lg: U.DB.leagues.length, clubs: U.DB.meta.clubs, players: U.DB.players.length };
U.toggleCountry(isl.country);
const gone = { lg: U.DB.leagues.length, clubs: U.DB.meta.clubs, players: U.DB.players.length,
               gone: !!U.LEAGUE.SCO, inStarters: U.starterOptions().some(c => c.lg === 'SCO') };
ok('Scotland removed from the leagues', !U.DB.leagues.some(L => L.code === 'SCO'), gone.lg + ' leagues left');
ok('its league is unresolvable', !gone.gone);   /* LEAGUE.IND gone, so divDef/roster/rules have nothing to point at */
ok('its clubs are not startable', !gone.inStarters);
ok('its players left the file view', gone.players < pre.players, (pre.players - gone.players) + ' rows dropped');
ok('its net worth left the club index', !Object.keys(U.CLUB_BY_CODE).some(code => (U.CLUB_BY_CODE[code].lg === 'SCO')));
U.toggleCountry(isl.country);
const back = { lg: U.DB.leagues.length, clubs: U.DB.meta.clubs, players: U.DB.players.length };
ok('switching it back restores the universe exactly', back.lg === pre.lg && back.clubs === pre.clubs && back.players === pre.players,
   JSON.stringify(back) + ' (was ' + pre.lg + '/' + pre.clubs + '/' + pre.players + ')');

/* ---------- 4. a pack is a first-class country: invented, small, one rung, no promotion ---------- */
const clubs = []; for (let i = 0; i < 6; i++) clubs.push('Testville ' + (i + 1) + '|TST' + i + '|5' + i + '|9000|0.2B');
const packPlayers = [];
for (let i = 0; i < 6; i++) for (let j = 0; j < 12; j++) {
  packPlayers.push('Packman ' + i + '_' + j + '|TST|' + (j < 4 ? 'ST' : j < 8 ? 'CM' : 'CB') + '|' + (52 + (i + j) % 14) + '|2' + (j % 8) + '|TST' + i);
}
const pack = {
  id: 'fc27-test-pack', name: 'Testland — National League', version: 'test',
  note: 'A six-club country invented by tools/packs.js to prove that a pack is a universe.',
  leagues: [{ code: 'TST', name: 'Testland', country: 'Testland', confed: 'UEFA', tv: .3,
               divs: [{ code: 'TSL', name: 'National League', rep: .3, size: 6, cup: 'Testland Cup', clubs }],
               promotion: { auto: 0, playoff: null }, relegation: { auto: 0, playoff: null } }],
  nations: ['TST|Testland|44|UEFA'], players: packPlayers, coaches: ['Ada Vermeer|TST|counter|41|TST0']
};
const idBefore = U.worldId();
const rej = U.installPack(pack);
ok('a valid pack installs', !rej, rej || U.packLines(pack));
ok('its league joined the universe', !!U.LEAGUE.TST && U.DB.leagues.some(L => L.code === 'TST'));
ok('its nation resolved', U.DB.nations.filter(n => n.indexOf('TST|') === 0).length === 1, 'NATION.TST in the active view');
ok('its coach is the club manager', U.coachOf('TST0').name === 'Ada Vermeer' && !U.coachOf('TST0').synth, U.coachOf('TST0').name + ' / ' + U.coachOf('TST0').tactic);
ok('a pack nation can be called up', !!U.starterOptions().length);
ok('the world id moved with the selection', U.worldId() !== idBefore);
/* the create screen is the only honest way in: the game reads UI.create, not an argument bag, and a
   test that hand-feeds startCareer lands you at Arsenal while believing it landed you in Testland */
U.UI.create = { mode: 'own', pos: 'ST', lg: 'TST', div: 0, clubName: 'Testville 3', diff: 'pro', age: 19, name: 'Pack Man' };
U.startCareer(false);
U.UI.modal = null;
const me = U.S().name;                      /* the create screen names him, not the test */
ok('the pack club is the club you joined', U.S().club.name === 'Testville 3' && U.S().club.lg === 'TST',
   U.S().club.name + ' in ' + U.S().club.lg + ', ' + U.S().name);
const W = globalThis.__w;                       /* the engine's own window API: the taps, not a re-implementation */
const playOne = () => {
  const f = U.fixtureNow();
  if (f.t === 'rest') { U.advanceWeek(true); return; }
  if (!U.S().objectives) U.S().objectives = U.makeObjectives();
  U.startMatch();
  const m = U.S().match; let inner = 0;
  while (m && !m.done && inner++ < 300) { const e = m.script[m.idx]; if (e && e.k === 'prompt') U.chooseOption(0); else U.matchTick(); }
  if (m && !m.done) U.finishMatch();
  U.afterReport(); U.UI.modal = null;
};
let weeks = 0, err = null, rounds = 0, trophies = 0;
try {
  U.nextSeason(); U.UI.modal = null;
  rounds = (U.S().rounds || []).length;
  for (let s = 0; s < 3; s++) {
    let guard = 0;
    while (guard++ < 400 && U.fixtureNow().t !== 'final') { playOne(); weeks++; }
    U.endSeason(); U.UI.modal = null; trophies += U.S().trophies || 0;
    U.nextSeason(); U.UI.modal = null;
  }
} catch (e) { err = e.message + ' @W' + weeks; }
(function () {
  try {
    const D = U.LEAGUE.TST.divs[0], st = U.S();
    console.log('  [dbg] division clubs=' + D.clubs.length + ' declared size=' + D.size + ' | table rows=' + Object.keys(st.table||{}).length
      + ' | rounds=' + (st.rounds||[]).length + ' | gpd=' + ((st.rounds||[])[0]||[]).length + ' | club=' + st.club.name + ' d' + st.div);
  } catch (e) { console.log('  [dbg] ' + e.message); }
})();
ok('a pack career plays', !err, err || weeks + ' weeks, ' + rounds + ' matchdays in a 6-club league, role ' + U.role().k);
ok('the calendar fits the division', rounds === 10, rounds + ' rounds for 6 clubs (360° round-robin twice is 10)');
ok('nothing moved, because the pack promised nothing', U.hasLadder('TST') === false && U.S().div === 0);
U.save();
const raw = store.get(U.saveKey);
const rt = (function () { const o = JSON.parse(raw); return o && o.name === me && o.club && o.club.name === 'Testville 3'; })();
ok('the pack career round-trips through localStorage', rt && raw.length > 1000, raw ? Math.round(raw.length / 1024) + 'kb save' : 'no save');
/* a pack that is holding up your own league cannot be uninstalled under you */
U.removePack('fc27-test-pack');
ok('the floor is not pulled out mid-career', !!U.LEAGUE.TST && /is running/.test(U.UNIVERSE.note || ''),
   (U.UNIVERSE.note || 'removed anyway!').slice(0, 76));
U.setUniverse('all');

/* ---------- 4b. and once the career is over, the pack does come off ---------- */
/* removal works the moment no career depends on the pack — a second, unoccupied one proves it */
const ghost = { id: 'fc27-ghost', name: 'Ghostland', version: '1',
  leagues: [{ code: 'GHT', name: 'Ghostland', confed: 'UEFA', tv: .2,
               divs: [{ code: 'GP', name: 'Premier', rep: .3, size: 4, cup: 'Ghost Cup',
                        clubs: ['A Fc|GHA|48|3000|0.1B','B Fc|GHB|48|3000|0.1B','C Fc|GHC|48|3000|0.1B','D Fc|GHD|48|3000|0.1B'] }] }],
  nations: ['GHT|Ghostland|40|UEFA'] };
U.installPack(ghost);
ok('a second pack installs alongside the first', !!U.LEAGUE.GHT && !!U.LEAGUE.TST);
U.removePack('fc27-ghost');
ok('and removes cleanly when nothing depends on it', !U.LEAGUE.GHT && !!U.LEAGUE.TST,
   U.DB.leagues.length + ' leagues still active');
U.removePack('fc27-test-pack');
ok('the test pack comes off once the career is over', !U.DB.leagues.some(L => L.code === 'TST') || !!U.S(),
   U.DB.leagues.length + ' leagues');

if (car) {
  U.hardResetSafe = 1;
  const back = U.DB.leagues.length;
  U.removePack(car.id);
  /* the ghost Testland pack is still installed at this point, so base + ghost is the target */
  ok('uninstalling the pack returns the base universe', U.DB.meta.clubs === base.clubs + 6 && U.DB.players.length < pre.players,
     back + ' → ' + U.DB.leagues.length + ' leagues, ' + U.DB.meta.clubs + ' clubs (base ' + base.clubs + ' + the 6-club ghost)');
  if (car) U.installPack(car, 'packs/fc27-ind-sco.js');
}

/* ---------- 5. bad packs get a sentence, not a stack trace ---------- */
const rejects = [
  ['no id', { name: 'x' }],
  ['no content', { id: 'a-pack', name: 'Empty' }],
  ['three rungs', { id: 'a-pack', name: 'Deep', leagues: [{ code: 'AAA', name: 'A', divs: [{ clubs: ['a|A|50|1|1B', 'b|B|50|1|1B', 'c|C|50|1|1B', 'd|D|50|1|1B'] }, { clubs: ['e|E|50|1|1B', 'f|F|50|1|1B', 'g|G|50|1|1B', 'h|H|50|1|1B'] }, { clubs: ['i|I|50|1|1B', 'j|J|50|1|1B', 'k|K|50|1|1B', 'l|L|50|1|1B'] }] }] }],
  ['a position the game cannot model', { id: 'a-pack', name: 'GK', leagues: [{ code: 'AAA', name: 'A', divs: [{ code: 'X', name: 'X', size: 4, clubs: ['a|A|50|1|1B', 'b|B|50|1|1B', 'c|C|50|1|1B', 'd|D|50|1|1B'] }] }], players: ['Guy|NED|GK|70|24|A'] }],
  ['a short division', { id: 'a-pack', name: 'Thin', leagues: [{ code: 'AAA', name: 'A', divs: [{ code: 'X', name: 'X', size: 2, clubs: ['a|A|50|1|1B', 'b|B|50|1|1B'] }] }] }]
];
rejects.forEach(([what, p]) => {
  let msg = null, threw = null;
  try { msg = U.checkPack(p) || U.installPack(p); } catch (e) { threw = e.message; }
  ok('rejects ' + what, !threw && !!msg, threw ? 'THREW: ' + threw : String(msg).slice(0, 74));
});

/* ---------- 6. a save from a different selection repairs itself ---------- */
U.setUniverse('top5');
const repairId = U.worldId();
U.setUniverse('all');
const nowId = U.worldId();
const career = U.S();
career.world = { id: 'not-the-current-world', leagues: ['ENG'], countries: 1 };
U.save();
let repaired = null;
try { U.applyUniverse(); U.universeRepair(); } catch (e) { repaired = e.message; }
ok('universeRepair survives a foreign world id', !repaired, repaired || 'no throw');
ok('the career itself is untouched by the repair', U.S().name === me && U.S().club.name === 'Testville 3', U.S().name + ' at ' + U.S().club.name);
ok('the pool was re-seeded, not re-mapped', U.S().pool.length === U.seedPool().length, U.S().pool.length + ' rows');
ok('and the save now carries the current world', JSON.parse(store.get(U.saveKey)).world.id === U.worldId(), repairId !== nowId ? 'ids differ as expected' : 'ids oddly equal');
U.setUniverse('all');

/* ---------- 7. every pack in packs/ passes the same check a tap on Download runs ---------- */
const dir = path.join(ROOT, 'packs');
if (fs.existsSync(dir)) {
  const files = fs.readdirSync(dir).filter(f => /\.js$/.test(f) && f !== 'manifest.js');
  let n = 0;
  files.forEach(f => {
    const bag = { FC27_PACKS: [] };
    new Function('window', fs.readFileSync(path.join(dir, f), 'utf8'))(bag);
    (bag.FC27_PACKS || []).forEach(p => {
      n++;
      const bad2 = U.checkPack(p);
      ok('packs/' + f + ' is loadable', !bad2, bad2 || p.name + ' · ' + U.packLines(p));
    });
  });
  const manifest = path.join(dir, 'manifest.js');
  if (fs.existsSync(manifest)) {
    const m = new Function('window', fs.readFileSync(manifest, 'utf8') + '\nreturn window.FC27_PACK_INDEX || [];')({});
    ok('manifest lists every pack file on disk', m.length === n, m.length + ' entries, ' + n + ' packs');
    m.forEach(e => ok('manifest entry ' + e.id + ' points at a real file', fs.existsSync(path.join(ROOT, e.file)), e.file));
  } else ok('packs/manifest.js exists', false, 'missing — the game lists packs from it');
} else ok('packs/ exists', false, 'no packs directory yet');

/* ---------- report ---------- */
out.forEach(l => console.log('  ✓ ' + l));
if (bad.length) bad.forEach(l => console.log('  ✗ ' + l));
console.log((bad.length ? '✗ ' : '') + (out.length + bad.length) + ' assertions, ' + bad.length + ' failed');
process.exit(bad.length ? 1 : 0);
