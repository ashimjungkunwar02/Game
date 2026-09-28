#!/usr/bin/env node
/*
  Football Career 27 — universe validator.

  The game reads nothing about real football except db.js, so that file is the contract. This checks
  the contract: schema, uniqueness, ranges, and the promotion/relegation rules the engine enforces
  at the end of the season. Run it after every dataset swap.

      node tools/validate-db.js [path/to/db.js]

  Exits non-zero on any error; warnings are informational.
*/
const fs = require('fs');
const path = require('path');

const file = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'db.js');
const src = fs.readFileSync(file, 'utf8');
const DB = new Function('window', src + '\nreturn window.FC27_DB;')({});
/* --with-packs: the engine plays in the *composed* universe — db.js plus every pack in packs/ — so the
   same checks have to run against the union. A pack that duplicates a league must replace it, not add a
   second England; a pack that brings players for a club nobody owns is a save that will not rehydrate. */
if (process.argv.includes('--with-packs')) {
  const dir = path.join(__dirname, '..', 'packs');
  if (fs.existsSync(dir)) fs.readdirSync(dir).filter(f => /\.js$/.test(f) && f !== 'manifest.js').forEach(f => {
    const one = new Function('window', 'window.FC27_PACKS=[];' + fs.readFileSync(path.join(dir, f), 'utf8') + '\nreturn window.FC27_PACKS[0];')({});
    if (!one) return;
    const at = l => DB.leagues.findIndex(x => x.code === l.code);
    (one.leagues || []).forEach(L => { const i = at(L); if (i >= 0) DB.leagues[i] = L; else DB.leagues.push(L); });
    (one.nations || []).forEach(n => { const i = DB.nations.findIndex(x => x.split('|')[0] === n.split('|')[0]); if (i >= 0) DB.nations[i] = n; else DB.nations.push(n); });
    (one.players || []).forEach(r => { const i = DB.players.findIndex(x => x.split('|')[0] === r.split('|')[0]); if (i >= 0) DB.players[i] = r; else DB.players.push(r); });
    (one.coaches || []).forEach(c => { const cc = typeof c === 'string' ? c.split('|')[4] : c.club;
      const i = DB.coaches.findIndex(x => (typeof x === 'string' ? x.split('|')[4] : x.club) === cc);
      if (cc && cc.slice(0,4) !== 'INTL' && i >= 0) DB.coaches[i] = c; else DB.coaches.push(c); });
    console.log('pack   ' + f + ' · ' + (one.name || '') + ' (' + ((one.leagues || []).length) + ' leagues, ' + ((one.players || []).length) + ' players)');
  });
}

const errors = [], warns = [];
const err = (where, msg) => errors.push(where + ': ' + msg);
const warn = (where, msg) => warns.push(where + ': ' + msg);

if (!DB) { console.log('FAIL — db.js did not assign window.FC27_DB'); process.exit(1); }
for (const k of ['meta', 'leagues', 'nations', 'players', 'coaches', 'tactics', 'forms', 'intlCalendar'])
  if (!DB[k]) err('top level', 'missing "' + k + '"');

/* net worth is stored compactly: 4.9B / 350M / 12K, or a plain number */
function wealth(v) {
  if (typeof v === 'number') return v;
  const m = /^(\d+(?:\.\d+)?)\s*([BMK]?)$/i.exec(String(v).trim());
  if (!m) return NaN;
  return +m[1] * ({ B: 1e9, M: 1e6, K: 1e3, '': 1 }[m[2].toUpperCase()]);
}
/* a promotion/relegation object: seeds, legs, cross-division ties, the gap test */
function ruleCheck(r, size, w, side) {
  if (!r) return warn(w, 'no ' + side + ' rules — the season end holds this division static');
  if (!(r.auto >= 0 && r.auto <= size)) err(w, side + '.auto out of range: ' + r.auto);
  if (r.playoff != null && !Array.isArray(r.playoff)) err(w, side + '.playoff must be an array of seeds or null');
  if (r.playoff && r.playoff.length) {
    if (r.playoff.some(x => !(x >= 1 && x <= size))) err(w, side + '.playoff seed outside the division: ' + r.playoff.join(','));
    if (r.playoff.length === 4 && size < 12) warn(w, 'four-seed play-off in a ' + size + '-club division');
    if (r.cross && r.playoff.length > 2) warn(w, side + ' is cross-division but has ' + r.playoff.length + ' seeds — the engine expects 1 or 2');
    if (r.gapRule !== undefined && !isFinite(+r.gapRule)) err(w, side + '.gapRule must be a points number');
    if (r.legs !== undefined && ![1, 2].includes(+r.legs)) err(w, side + '.legs must be 1 or 2, got ' + r.legs);
    if (r.final !== undefined && r.final !== null && !/single|two/i.test(String(r.final))) err(w, side + '.final must be "single", "two-legged" or null');
  }
}

/* ---- nations ---- */
const natCodes = new Set();
(DB.nations || []).forEach((row, i) => {
  const p = typeof row === 'string' ? row.split('|') : [row.code, row.name, row.strength, row.confed];
  if (p.length !== 4) return err('nations[' + i + ']', 'want "CODE|Name|Strength|Confed", got ' + p.length + ' fields');
  if (natCodes.has(p[0])) err('nations[' + i + ']', 'duplicate code ' + p[0]);
  natCodes.add(p[0]);
  if (!(+p[2] >= 35 && +p[2] <= 96)) err('nations[' + i + ']', 'strength out of range: ' + p[2]);
  if (DB.confeds && !(p[3] in DB.confeds)) err('nations[' + i + ']', 'unknown confederation ' + p[3]);
});

/* ---- leagues, divisions, clubs ---- */
const clubCodeSet = new Set();
let clubCount = 0;
(DB.leagues || []).forEach(lg => {
  const where = 'league ' + lg.code;
  if (!lg.divs || !lg.divs.length) return err(where, 'a league needs at least one division');
  if (lg.divs.length > 2) err(where, 'the engine swaps between two rungs at most, and this league has ' + lg.divs.length);
  /* one rung is a legitimate country: a top flight whose second tier is not in the file. Nothing
     can move up or down, so the rules must say so — a league that promises promotion it cannot
     deliver is a season that ends with a message about a division nobody can reach. */
  if (lg.divs.length === 1) {
    const promises = ['promotion', 'relegation'].filter(k => { const c = lg[k] || {}; return (c.auto || 0) > 0 || c.playoff; });
    if (promises.length) err(where, 'one division only, so ' + promises.join(' and ') + ' cannot happen: use {auto:0, playoff:null} and describe the real rule in the comment above it');
  }
  if (!isFinite(+lg.tv) || +lg.tv <= 0) err(where, 'tv multiplier must be a positive number');
  lg.divs.forEach((div, di) => {
    const w = where + ' div ' + di;
    if (!div || !Array.isArray(div.clubs) || !div.clubs.length) return err(w, 'no clubs');
    if (div.size !== div.clubs.length) err(w, 'size ' + div.size + ' != clubs.length ' + div.clubs.length);
    if (div.size < 12) warn(w, 'only ' + div.size + ' clubs — the calendar gets short and play-off seeds get odd');
    if (!div.name) err(w, 'a division needs a name (it is printed in the hub and in results)');
    if (!div.cup) warn(w, 'no domestic cup name — the cup weeks will still run, unnamed');
    if (!(+div.rep >= 0 && +div.rep <= 1.5)) warn(w, 'rep coefficient looks wrong (' + div.rep + '); it scales wages and value');
    div.clubs.forEach(row => {
      const p = typeof row === 'string' ? row.split('|') : [row.name, row.code, row.str, row.cap, row.netw];
      if (p.length !== 5) return err(w, 'club row wants "Name|SHORT|Strength|capacity|networth": ' + JSON.stringify(row));
      const [name, code, str, cap, netw] = p;
      if (!name || !code) return err(w, 'empty name or code');
      if (clubCodeSet.has(code)) err(w, 'duplicate club code ' + code + ' (' + name + ')');
      clubCodeSet.add(code); clubCount++;
      if (!(+str > 30 && +str <= 99)) err(w, name + ': strength out of range (' + str + ')');
      if (!isFinite(+cap) || +cap < 0) err(w, name + ': capacity must be a number');
      if (!isFinite(wealth(netw)) || wealth(netw) <= 0) err(w, name + ': net worth must be 4.9B / 350M style or a number, got ' + netw);
    });
  });
  /* promotion / relegation are league-level: movement between the two divisions. A one-rung country
     has no second division to check, and nothing can move, which the block above already polices. */
  ruleCheck(lg.relegation, lg.divs[0].size, where + ' top division', 'relegation');
  if (lg.divs[1]) ruleCheck(lg.promotion, lg.divs[1].size, where + ' second division', 'promotion');
  const up = (lg.promotion && lg.promotion.auto || 0) + (lg.promotion && lg.promotion.playoff && lg.promotion.playoff.length ? (lg.promotion.cross ? 1 : 1) : 0);
  const down = (lg.relegation && lg.relegation.auto || 0) + (lg.relegation && lg.relegation.playoff && lg.relegation.playoff.length ? 1 : 0);
  if (lg.divs[1] && lg.promotion && lg.relegation && up !== down)
    warn(where, up + ' come up and ' + down + ' go down — the engine rebalances the size drift, real leagues keep these equal');
  lg.divs.forEach((div, di) => { if (div && (div.promotion || div.relegation)) warn(where + ' div ' + di, 'carries its own promotion/relegation object; the engine reads the league-level one'); });
});

/* ---- players ---- */
const POS = Object.keys(DB.forms || {});
const seenNames = new Set();
let playable = 0;
(DB.players || []).forEach((row, i) => {
  const p = typeof row === 'string' ? row.split('|') : [row.name, row.nat, row.pos, row.ovr, row.age, row.club];
  if (p.length !== 6 && p.length !== 7) return err('players[' + i + ']', 'want "Name|NAT|POS|OVR|AGE|clubSHORT[|pace,shooting,passing,dribbling,defending,physical]": ' + JSON.stringify(row));
  if (p.length === 7) {
    const a = String(p[6]).split(',');
    if (a.length !== 6 || a.some(x => !(+x >= 15 && +x <= 99))) err('players[' + i + ']', 'attribute tail must be six numbers 15-99, got "' + p[6] + '"');
  }
  const [name, nat, pos, ovr, age, club] = p;
  if (!natCodes.has(nat)) err('players[' + i + ']', 'unknown nation code ' + nat);
  if (!POS.includes(pos)) err('players[' + i + ']', 'position ' + pos + ' has no template in forms');
  if (!(+ovr >= 40 && +ovr <= 99)) err('players[' + i + ']', name + ': OVR out of range ' + ovr);
  if (!(+age >= 15 && +age <= 41)) err('players[' + i + ']', name + ': AGE out of range ' + age);
  if (!clubCodeSet.has(club)) err('players[' + i + ']', name + ': club code ' + club + ' is not in any division');
  if (seenNames.has(name)) err('players[' + i + ']', 'duplicate player ' + name);
  seenNames.add(name);
  if (pos !== 'GK') playable++;
});

/* ---- coaches (db.js hands these back as objects; raw rows are also accepted) ---- */
let intlCoaches = 0;
const coached = new Set();
(DB.coaches || []).forEach((row, i) => {
  const c = typeof row === 'string'
    ? (() => { const p = row.split('|'); return { name: p[0], nat: p[1], tactic: p[2], age: p[3], tag: p[4] }; })()
    : { name: row.name, nat: row.nat, tactic: row.tactic, age: row.age,
        tag: row.tag !== undefined ? row.tag : (row.club ? row.club : (row.country ? 'INTL:' + row.country : '')) };
  if (!c.name) return err('coaches[' + i + ']', 'coach row has no name: ' + JSON.stringify(row));
  if (!natCodes.has(c.nat)) err('coaches[' + i + ']', 'unknown nation code ' + c.nat);
  if (!DB.tactics[c.tactic]) err('coaches[' + i + ']', c.name + ': tactic "' + c.tactic + '" is not in tactics');
  if (!(+c.age >= 25 && +c.age <= 80)) err('coaches[' + i + ']', c.name + ': age out of range ' + c.age);
  if (String(c.tag).indexOf('INTL:') === 0) {
    intlCoaches++;
    if (!natCodes.has(String(c.tag).slice(5))) err('coaches[' + i + ']', c.name + ': INTL code ' + String(c.tag).slice(5) + ' unknown');
  } else {
    if (!clubCodeSet.has(c.tag)) err('coaches[' + i + ']', c.name + ': club code "' + c.tag + '" is not in any division');
    if (coached.has(c.tag)) warn('coaches[' + i + ']', c.tag + ' has two managers listed; the first one wins');
    coached.add(c.tag);
  }
});
const unmanaged = [];
(DB.leagues || []).forEach(lg => lg.divs.forEach(div => div.clubs.forEach(row => {
  const code = typeof row === 'string' ? row.split('|')[1] : row.code;
  if (!coached.has(code)) unmanaged.push(code);
})));
if (unmanaged.length) warn('coaches', unmanaged.length + ' clubs have no real coach row (' + unmanaged.slice(0, 8).join(', ') + (unmanaged.length > 8 ? '…' : '') + ') — the engine synthesises a name and a tactic for them');

/* ---- tactics, forms, calendar ---- */
for (const [k, t] of Object.entries(DB.tactics || {}))
  for (const f of ['n', 'd', 'chance', 'pass', 'shot', 'clean'])
    if (t[f] === undefined) err('tactics.' + k, 'missing field ' + f);
for (const [pos, f] of Object.entries(DB.forms || {})) {
  const keys = Object.keys(f);
  if (keys.length < 6) err('forms.' + pos, 'want six attribute offsets, got ' + keys.join(','));
}
const ic = DB.intlCalendar || {};
for (const k of ['worldCup', 'euro', 'nationsLeague', 'windows']) if (!ic[k]) err('intlCalendar', 'missing ' + k);
if (ic.worldCup && !Array.isArray(ic.worldCup.years)) err('intlCalendar.worldCup', 'years must be an array');
else if (ic.worldCup) {
  const ys = ic.worldCup.years;
  if (ys.some(y => !isFinite(+y))) err('intlCalendar.worldCup', 'years must be numbers');
  else if (ys.length > 1 && ys.some((y, i) => i && +y - +ys[i - 1] !== 4)) warn('intlCalendar.worldCup', 'years are not four apart: ' + ys.join(','));
  if (ic.lastWorldCup !== undefined && +ic.lastWorldCup % 4 !== +ys[0] % 4) warn('intlCalendar', 'lastWorldCup is not on the same cycle as worldCup.years');
}
if (Array.isArray(ic.windows)) ic.windows.forEach((w, i) => {
  if (!isFinite(+w.after)) err('intlCalendar.windows[' + i + ']', 'after must be a round number');
  if (!w.kind) err('intlCalendar.windows[' + i + ']', 'kind is required (NL / QUAL / FRIENDLY)');
});
if (DB.regens) for (const k of ['first', 'last']) {
  if (DB.regens[k] && !Array.isArray(DB.regens[k])) err('regens', k + ' must be an array of name parts');
  else if (DB.regens[k] && DB.regens[k].length < 6) warn('regens.' + k, 'only ' + DB.regens[k].length + ' name parts — regens start repeating quickly');
}

/* ---- report ---- */
const lines = [];
lines.push('db.js        ' + path.basename(file) + '  ·  snapshot "' + (DB.meta && DB.meta.snapshot || '?') + '"');
lines.push('leagues      ' + (DB.leagues || []).length + '  ·  divisions ' + (DB.leagues || []).reduce((a, l) => a + l.divs.length, 0) + '  ·  clubs ' + clubCount);
lines.push('players      ' + (DB.players || []).length + ' named (' + playable + ' outfield, pickable)  ·  nations ' + natCodes.size);
lines.push('coaches      ' + (DB.coaches || []).length + ' (' + intlCoaches + ' national jobs)  ·  tactics ' + Object.keys(DB.tactics || {}).length + '  ·  position templates ' + POS.length);
(DB.leagues || []).forEach(lg => lines.push('  ' + lg.code.padEnd(4) + lg.name.padEnd(22) + lg.divs.map(d =>
  (d.name + ' ' + d.clubs.length + ((lg.promotion && lg.promotion.playoff && lg.promotion.playoff.length) ? ' +PO' : '')).padEnd(28)).join('|')));
console.log(lines.join('\n'));
warns.forEach(w => console.log('warn  ' + w));
errors.forEach(e => console.log('ERROR ' + e));
console.log(errors.length ? '\nDB INVALID · ' + errors.length + ' errors, ' + warns.length + ' warnings'
                          : '\nDB VALID · ' + clubCount + ' clubs, ' + (DB.players || []).length + ' players, 0 errors' + (warns.length ? ' (' + warns.length + ' warnings)' : ''));
process.exit(errors.length ? 1 : 0);
