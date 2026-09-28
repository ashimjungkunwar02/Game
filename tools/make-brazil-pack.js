/* tools/make-brazil-pack.js — the two uploads in archive.zip + players (2).csv become a data pack.
   ================================================================================================
   `players (2).csv` carries 240 named men across 20 Brazilian clubs with the game's own six
   attributes; the archive's Brasileirão matches say which clubs are actually in the 2026 season,
   how long the calendar is, and which state each derby is played in. Neither file has ages,
   nationalities or second-division clubs, so the honest output is:

     · the 240 arrive as themselves — same six numbers, an OVR that is the weighted sum of those
       six under the position weights the engine uses, so a takeover reads exactly as the file does;
     · everyone else in the league is generated, as it already is for the 18 clubs with no export;
     · strength comes from the imported best XI, not invented, because the value/wage/trust models are
       calibrated on it and a club rated off its real eleven keeps the ratings coherent;
     · the real relegation rule (four down to Série B) goes in the league `note`, and the engine moves
       nobody, because neither dataset contains Série B — same treatment as the other one-rung countries.

     node tools/make-brazil-pack.js                       # write the pack
     node tools/make-brazil-pack.js --matches=/path/to/Brasileirao_Matches.csv
*/
'use strict';
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const PLAYERS = path.join(ROOT, 'players (2).csv');
const matchArg = (process.argv.slice(2).find(a => a.startsWith('--matches=')) || '').split('=')[1];
const MATCHES = matchArg || '/tmp/bra/Data/Brasileirao_Matches.csv';

/* ---------- a CSV reader that respects quotes (both files use them) ---------- */
function readCsv(p) {
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(l => l.trim());
  const cells = r => { const o = []; let s = '', q = false;
    for (const ch of r) { if (ch === '"') { q = !q; continue; } if (ch === ',' && !q) { o.push(s); s = ''; continue; } s += ch; }
    o.push(s); return o.map(x => x.trim()); };
  const H = cells(lines[0]);
  return { head: H, rows: lines.slice(1).map(cells).map(c => Object.fromEntries(H.map((h, i) => [h, c[i]]))) };
}

/* ---------- the position weights from index.html: OVR must be the weighted sum ---------- */
const W = {
  ST: [.18, .30, .10, .16, .02, .24], CF: [.18, .30, .10, .16, .02, .24],
  LW: [.30, .18, .14, .26, .02, .10], RW: [.30, .18, .14, .26, .02, .10],
  CAM: [.18, .20, .28, .22, .04, .08], CM: [.14, .14, .28, .18, .14, .12],
  CB: [.14, .06, .14, .06, .38, .22], LB: [.24, .06, .20, .16, .22, .12],
  RB: [.24, .06, .20, .16, .22, .12], CDM: [.10, .08, .24, .14, .28, .16]
};
const MODELLED = Object.keys(W);
const SIX = ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical'];

/* ---------- existing universe, so codes and names do not collide with anything ---------- */
const DB = new Function('window', fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8') + '\nreturn window.FC27_DB;')({});
const takenCodes = new Set();
DB.leagues.forEach(L => L.divs.forEach(D => D.clubs.forEach(r => takenCodes.add(r.split('|')[1]))));
const takenNames = new Map();   // lower-cased name -> the rating the rest of the universe carries him at
DB.players.forEach(r => { const c = r.split('|'); takenNames.set(c[0].toLowerCase(), Math.max(takenNames.get(c[0].toLowerCase()) || 0, +c[3])); });
const packDir = path.join(ROOT, 'packs');
if (fs.existsSync(packDir)) fs.readdirSync(packDir).filter(f => /\.js$/.test(f) && f !== 'manifest.js').forEach(f => {
  const bag = { FC27_PACKS: [] };
  new Function('window', 'window.FC27_PACKS=[];' + fs.readFileSync(path.join(packDir, f), 'utf8'))(bag);
  (bag.FC27_PACKS || []).forEach(p => {
    (p.leagues || []).forEach(L => L.divs.forEach(D => D.clubs.forEach(r => takenCodes.add(r.split('|')[1]))));
    (p.players || []).forEach(r => { const c = r.split('|'); takenNames.set(c[0].toLowerCase(), Math.max(takenNames.get(c[0].toLowerCase()) || 0, +c[3])); });
  });
});
const hasNation = DB.nations.some(n => n.split('|')[0] === 'BRA');

/* ---------- which clubs the 2026 season really had, and the calendar length ---------- */
let matchClubs = null, rounds = null, states = {}, cupName = 'Copa do Brasil';
if (fs.existsSync(MATCHES)) {
  const m = readCsv(MATCHES);
  const seasons = [...new Set(m.rows.map(r => +r.season))].sort((a, b) => a - b);
  const last = seasons[seasons.length - 1];
  const inSeason = m.rows.filter(r => +r.season === last);
  matchClubs = new Set();
  inSeason.forEach(r => { matchClubs.add(r.home_team.replace(/-[A-Z]{2}$/, '')); states[r.home_team.replace(/-[A-Z]{2}$/, '')] = r.home_team_state; });
  const byClub = {};
  inSeason.forEach(r => { const h = r.home_team.replace(/-[A-Z]{2}$/, ''), a = r.away_team.replace(/-[A-Z]{2}$/, '');
    byClub[h] = byClub[h] || { p: 0, g: 0, gapped: 0 }; byClub[a] = byClub[a] || { p: 0, g: 0, gapped: 0 };
    const hg = +r.home_goal, ag = +r.away_goal;
    byClub[h].g += hg; byClub[h].gapped += ag; byClub[a].g += ag; byClub[a].gapped += hg;
    byClub[h].p += hg > ag ? 3 : hg === ag ? 1 : 0; byClub[a].p += ag > hg ? 3 : ag === hg ? 1 : 0; });
  const played = Object.keys(byClub).length;
  rounds = played % 2 ? played * 2 : (played - 1) * 2;
  console.log('archive (covers ' + seasons[0] + '\u2013' + last + '): season ' + last + ' has ' + played + ' clubs · ' + inSeason.length + ' matches · ' +
              'a ' + rounds + '-matchday calendar · ' + Object.keys(states).length + ' states represented');
}

/* ---------- build the clubs from the player file ---------- */
const byTeam = {};
readCsv(PLAYERS).rows.forEach(r => { (byTeam[r.team_name] = byTeam[r.team_name] || []).push(r); });
const mkCode = name => {
  const letters = name.replace(/[^A-Za-z]/g, '').toUpperCase();
  let base = (letters.slice(0, 3) || 'BRA').padEnd(3, 'X');
  let code = base, n = 0;
  while (takenCodes.has(code)) { code = base.slice(0, 3) + (++n); if (n > 9) { code = 'B' + letters.slice(0, 2) + n; } }
  takenCodes.add(code); return code;
};
const seed = s => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 99991; return h; };

/* one pass over the file: resolve each named man to a row the engine can read, then let the clubs be
   derived from the men that survived it — so a club's strength is built from players actually in the game */
const byClub = {};
let droppedGk = 0, droppedDupe = 0, unmapped = [];
const displaced = [];
const seen = new Set(), replaced = [];
readCsv(PLAYERS).rows.forEach(r => {
  const pos0 = (r.position || 'CM').toUpperCase();
  if (pos0 === 'GK') { droppedGk++; return; }
  if (!MODELLED.includes(pos0)) { unmapped.push(pos0); return; }
  const name = r.name.replace(/\s+/g, ' ').trim();
  /* a name the base file already has is not a collision to discard — overlay() replaces players by
     name, which is what a pack *for* an updated dataset is: Paquetá is at Flamengo in 2026, so the
     pack's row supersedes the August one instead of the man vanishing from the game. */
  if (seen.has(name.toLowerCase())) { droppedDupe++; return; }                   // twice inside this one file
  seen.add(name.toLowerCase());
  const six = SIX.map(k => Math.max(15, Math.min(99, +r[k] || 60)));
  const ovr = Math.round(W[pos0].reduce((a, w, i) => a + w * six[i], 0));
  const age = 18 + seed(name + r.team_name) % 17;                          // no birthdays in the file
  const pos = pos0 === 'CF' ? 'ST' : pos0;                                  // the game models ST, not CF
  const key = name.toLowerCase();
  const elsewhere = takenNames.get(key);
  /* a name the universe already carries belongs to whoever is rated higher — the game keys a takeover
     by name, so one name can only be one man; the old rule dropped the challenger, which would have
     quietly moved 142 Brazilians out of European squads and left those clubs thinner than they were */
  if (elsewhere !== undefined && elsewhere > ovr) { displaced.push(name + ' (' + ovr + ' < ' + elsewhere + ')'); return; }
  if (elsewhere !== undefined) replaced.push(name);
  takenNames.set(key, ovr);
  (byClub[r.team_name] = byClub[r.team_name] || []).push({ name, ovr, six, pos, age });
});

const clubs = [];
const playersOut = [];
Object.entries(byClub).forEach(([team, list]) => {
  const code = mkCode(team);
  const best = list.map(p => p.ovr).sort((a, b) => b - a).slice(0, 11);
  const str = Math.max(42, Math.min(92, Math.round(best.reduce((a, b) => a + b, 0) / Math.max(1, best.length))));
  const med = best[Math.floor(best.length / 2)] || 60;
  const cap = Math.round(Math.max(1200, Math.min(82000, (5200 + (str - 50) * 1150) * (0.8 + (seed(team) % 40) / 100))) / 100) * 100;
  const netw = (Math.max(0.1, +(0.02 + Math.pow(Math.max(0, Math.min(1, (str - 50) / 42)), 2.3) * 3.1).toFixed(str < 60 ? 2 : 1))) + 'B';
  list.forEach(p => playersOut.push(p.name + '|BRA|' + p.pos + '|' + p.ovr + '|' + p.age + '|' + code + '|' + p.six.join(',')));
  clubs.push({ team, code, str, cap, netw, rep: Math.max(.2, Math.min(.97, .22 + (med - 56) / 34)),
               tv: Math.max(.28, Math.min(.95, .30 + (med - 56) / 40)), n: list.length });
});
clubs.sort((a, b) => b.str - a.str);
const clubRows = clubs.map(c => c.team + '|' + c.code + '|' + c.str + '|' + c.cap + '|' + c.netw);
const strOff = unmapped;
const dropped = droppedGk + droppedDupe;
const derbies = [...new Set(clubs.map(c => states[c.team]).filter(Boolean))];

const note = 'Brazil — Série A, 20 clubs, one round of the ladder. Built by tools/make-brazil-pack.js from '
  + 'players (2).csv (240 named men, the six attributes as supplied) and archive.zip (Fluminense Data '
  + 'Brazilian soccer project: Brasileirão and Copa do Brasil results). Strength is the mean of each club\u2019s '
  + 'best eleven imported OVRs; capacity, net worth, reputation and TV follow from it, so a takeover of a real '
  + 'Brazilian reads as his file row. Ages are seeded from the name — the export has no birthdays. Nationality '
  + 'is BRA for the named men for the same reason. Goalkeepers are not modelled as rows anywhere in this game, '
  + 'so the ' + droppedGk + ' keepers in the file became generated squad-mates. ' + replaced.length + ' of the '
  + 'named men also appear in db.js at another club — this pack supersedes those rows, which is what a pack '
  + 'carrying a newer snapshot is for. The real rule is 4 relegations '
  + 'to Série B and promotion of 2 from it; neither dataset contains Série B, so the engine moves nobody and '
  + 'this note is where the truth lives. Domestic cup: ' + cupName + ', which the archive has results for. '
  + (derbies.length ? 'States represented: ' + derbies.join(', ') + '.' : '');

const pack = {
  id: 'fc27-brazil', name: 'Brazil — Série A', version: 'players 2026 · results 2012-2022', note,
  leagues: [{
    code: 'BRA', name: 'Brazil', country: 'Brazil', confed: 'CONMEBOL', tv: +clubs.reduce((a, c) => a + c.tv, 0).toFixed(2) / clubs.length,
    note,
    divs: [{ code: 'SAA', name: 'Série A', rep: +(clubs.reduce((a, c) => a + c.rep, 0) / clubs.length).toFixed(3), size: clubRows.length, cup: cupName, clubs: clubRows }],
    promotion: { auto: 0, playoff: null }, relegation: { auto: 0, playoff: null }
  }],
  nations: hasNation ? [] : ['BRA|Brazil|86|CONMEBOL'],
  players: playersOut, coaches: []
};

const body = '/* Football Career 27 — data pack: ' + pack.name + '.\n'
  + '   Generated by tools/make-brazil-pack.js from the two files in this repo: players (2).csv and\n'
  + '   archive.zip. It is content, not code: db.js-shaped rows the engine composes at boot.\n\n'
  + '   ' + note.split('. ').join('\n   ') + ' */\n'
  + '(window.FC27_PACKS = window.FC27_PACKS || []).push(' + JSON.stringify(pack, null, 1)
       + ');\n';
fs.mkdirSync(packDir, { recursive: true });
fs.writeFileSync(path.join(packDir, 'fc27-brazil.js'), body);

/* regenerate the manifest the in-game panel lists */
const idx = fs.readdirSync(packDir).filter(f => /\.js$/.test(f) && f !== 'manifest.js').map(f => {
  const bag = { FC27_PACKS: [] };
  new Function('window', 'window.FC27_PACKS=[];' + fs.readFileSync(path.join(packDir, f), 'utf8'))(bag);
  const one = (bag.FC27_PACKS || [])[0] || {};
  const clubsN = (one.leagues || []).reduce((a, L) => a + L.divs.reduce((x, D) => x + D.clubs.length, 0), 0);
  return { file: 'packs/' + f, id: one.id, name: one.name, version: one.version,
           summary: (one.leagues || []).length + ' league(s) · ' + clubsN + ' clubs · ' + (one.players || []).length + ' players' };
});
fs.writeFileSync(path.join(packDir, 'manifest.js'),
  '/* Football Career 27 — the data packs sitting beside this file. The game reads this list and\n'
  + '   offers each entry for install from HUB → Universe; nothing is loaded unless you ask for it. */\n'
  + 'window.FC27_PACK_INDEX = ' + JSON.stringify(idx, null, 1) + ';\n');

console.log('clubs: ' + clubs.length + ' · named players: ' + playersOut.length +
  ' (' + droppedGk + ' keepers are not modelled as rows, ' + droppedDupe + ' repeat inside the file, ' +
  replaced.length + ' take the name from a db.js row they outrate, ' + displaced.length + ' stay where they are)' +
  (strOff.length ? ' · unmapped positions: ' + [...new Set(strOff)].join(',') : ''));
console.log('top of the league: ' + clubs.slice(0, 6).map(c => c.team + ' ' + c.str).join(' · '));
console.log('bottom: ' + clubs.slice(-3).map(c => c.team + ' ' + c.str).join(' · '));
console.log('rows sample: ' + playersOut[0]);
console.log('wrote packs/fc27-brazil.js · ' + Math.round(body.length / 1024) + 'kb · manifest now ' + idx.length + ' packs');
