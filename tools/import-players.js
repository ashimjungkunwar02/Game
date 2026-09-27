#!/usr/bin/env node
/*
  Football Career 27 — player CSV importer.

  Turns any big players export (FIFA-style dumps, FBref pulls, a league's own list) into rows that
  fit db.js, optionally grouping the clubs the universe does not know yet into new women's (or men's)
  leagues. Nothing is written unless you pass --apply.

      node tools/import-players.js path/to/players.csv                  report only
      node tools/import-players.js path/to/players.csv                  men's rows only (default)
      node tools/import-players.js path/to/players.csv --apply           rewrite the players block in db.js
      node tools/import-players.js path/to/players.csv --emit db.women.js --new-leagues
                                                                         also write league blocks for unknown clubs

  Columns are found by alias, so the file does not have to be shaped for us. Recognised headers:
      name:         name, player, player_name, longname, fullname, short name
      gender:       gender, sex, role (values f/female/w/women vs m/male)
      age:          age
      overall:      overall, ovr, rating, best_overall, potential→ignored
      position:     position, positions, pos, role_position, preferred positions, common position
      nationality:  nationality, nation, country, cid
      club:         club, team, current_team, team_name
      league:       league, competition, league_name, division
      value/wage:   value_euro, wage_euro (used only for sanity warnings)
*/
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
let file = argv.find(a => !a.startsWith('--'));
const flags = new Set(argv.filter(a => a.startsWith('--')));
const opt = (k, d) => { const a = argv.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=').slice(1).join('=') : d; };
if (!file) { console.log('usage: node tools/import-players.js <players.csv> [--gender=female|male|all] [--emit=out.js] [--apply] [--new-leagues]'); process.exit(1); }
const want = opt('gender', 'male');
if (file === '-') {                                        // read a pasted CSV from stdin
  const tmp = path.join(require('os').tmpdir(), 'fc27-pasted-' + process.pid + '.csv');
  fs.writeFileSync(tmp, fs.readFileSync(0, 'utf8'));
  file = tmp;
  console.log('(reading ' + fs.statSync(tmp).size + ' bytes from stdin → ' + tmp + ')');
}
if (!fs.existsSync(file)) {
  console.log('no such file: ' + file);
  console.log('the CSV has not reached the sandbox — re-attach it, paste it (node tools/import-players.js -),');
  console.log('or commit it into the repo as players.csv and point me at that');
  process.exit(2);
}

/* ---------- csv parse (quoted fields, embedded commas, CRLF) ---------- */
function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; continue; }
    if (c === '"') { q = true; continue; }
    if (c === ',') { row.push(cur); cur = ''; continue; }
    if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; continue; }
    if (c === '\r') continue;
    cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r[0] || '').trim() !== '');
}
const ALIAS = {
  name: ['name', 'player', 'player_name', 'longname', 'full_name', 'fullname', 'short name', 'shortname'],
  gender: ['gender', 'sex', 'gender_code'],
  age: ['age'],
  ovr: ['overall', 'ovr', 'rating', 'best_overall', 'global'],
  pos: ['position', 'positions', 'pos', 'preferred positions', 'preferred_positions', 'common position', 'common_position', 'role_position'],
  nat: ['nationality', 'nation', 'country', 'cid', 'nationality_name'],
  club: ['club', 'team', 'current_team', 'team_name', 'club_name'],
  league: ['league', 'league_name', 'competition', 'division', 'comp'],
  value: ['value_euro', 'value'], wage: ['wage_euro', 'wage']
};
const rows = parseCSV(fs.readFileSync(file, 'utf8'));
const head = rows[0].map(h => h.trim().toLowerCase().replace(/^\ufeff/, ''));
const col = k => { for (const a of ALIAS[k]) { const i = head.indexOf(a); if (i >= 0) return i; }
  const loose = head.findIndex(h => ALIAS[k].some(a => h.includes(a))); return loose >= 0 ? loose : -1; };
const idx = {}; for (const k of Object.keys(ALIAS)) idx[k] = col(k);
if (idx.name < 0 || idx.ovr < 0) { console.log('cannot find a name and an overall column. header was: ' + head.join(', ')); process.exit(2); }
const missing = ['age', 'pos', 'nat', 'club'].filter(k => idx[k] < 0);
if (missing.length) console.log('note: no column for ' + missing.join(', ') + ' — those fields will be derived or defaulted');

/* ---------- filters ---------- */
const FEMALE = /^(f|female|w|women|womens|ladies|1|girl)$/i, MALE = /^(m|male|man|men|0|boy)$/i;
function genderOf(r) { return idx.gender >= 0 ? String(r[idx.gender] || '').trim() : ''; }
/* This game covers the men's divisions only, full stop: 'male' means "everything the file does
   not mark as women's", so a dump with a blank or missing gender column still lands in full. */
function keep(r) {
  if (idx.gender < 0 || want === 'all') return true;
  const g = genderOf(r);
  return want === 'female' ? FEMALE.test(g) : !FEMALE.test(g);
}
let dropped = 0;
if (idx.gender >= 0 && want !== 'all')
  dropped = rows.slice(1).filter(r => want === 'male' ? FEMALE.test(genderOf(r)) : MALE.test(genderOf(r))).length;
if (idx.gender >= 0) {
  const hist = new Map();
  for (const r of rows.slice(1)) { const g = String(r[idx.gender] || '').trim() || '(blank)'; hist.set(g, (hist.get(g) || 0) + 1); }
  console.log('gender column values: ' + [...hist.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, v]) => '"' + k + '"×' + v).join('  ') +
(want === 'all' ? '   → keeping everything' : '   → excluding the women\'s rows'));
}
const body = rows.slice(1).filter(keep);

/* ---------- normalisers ---------- */
const strip = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
function posOf(p) {
  const raw = strip(p).toUpperCase().replace(/[^A-Z,\/\- ]/g, '');
  const parts = raw.split(/[,\/]| - | OR /).map(x => x.trim()).filter(Boolean);
  const map = { ST: 'ST', FW: 'ST', CF: 'ST', LS: 'ST', RS: 'ST', LW: 'LW', RW: 'RW', LF: 'LW', RF: 'RW',
    LM: 'LW', RM: 'RW', CAM: 'CAM', AM: 'CAM', CM: 'CM', CDM: 'CDM', DM: 'CDM', MDM: 'CDM', MC: 'CM',
    LCB: 'CB', RCB: 'CB', CB: 'CB', D: 'CB', DF: 'CB', LB: 'LB', RB: 'RB', LWBL: 'LB', LWB: 'LB', RWB: 'RB',
    GK: 'GK', SK: 'GK', goalkeeper: 'GK' };
  for (const x of parts) if (map[x]) return map[x];
  for (const x of parts) { if (/^L/.test(x)) return 'LB'; if (/^R/.test(x)) return 'RB'; if (/^M/.test(x)) return 'CM'; if (/^D/.test(x)) return 'CB'; if (/^A/.test(x)) return 'CAM'; if (/^S|^F|^C$/.test(x)) return 'ST'; }
  return 'CM';
}
const COUNTRY = { 'england':'ENG','scotland':'SCO','wales':'WAL','ireland':'IRL','northern ireland':'NIR','france':'FRA','germany':'GER','spain':'ESP','italy':'ITA','portugal':'POR','netherlands':'NED','belgium':'BEL','switzerland':'SUI','austria':'AUT','sweden':'SWE','norway':'NOR','denmark':'DEN','finland':'FIN','iceland':'ISL','poland':'POL','czechia':'CZE','czech republic':'CZE','ukraine':'UKR','romania':'ROU','serbia':'SRB','croatia':'CRO','bosnia and herzegovina':'BIH','bosnia':'BIH','hungary':'HUN','greece':'GRE','russia':'RUS','turkey':'TUR','slovenia':'SLO','slovakia':'SVK','albania':'ALB','georgia':'GEO','united states':'USA','usa':'USA','canada':'CAN','mexico':'MEX','costa rica':'CRC','jamaica':'JAM','panama':'PAN','haiti':'HAI','brazil':'BRA','argentina':'ARG','uruguay':'URU','chile':'CHI','colombia':'COL','venezuela':'VEN','ecuador':'ECU','peru':'PER','paraguay':'PAR','bolivia':'BOL','japan':'JPN','china':'CHN','north korea':'PRK','south korea':'KOR','australia':'AUS','new zealand':'NZL','ghana':'GHA','nigeria':'NGA','cameroon':'CMR','senegal':'SEN','morocco':'MAR','south africa':'RSA','zambia':'ZAM','ivory coast':'CIV','mali':'MLI','algeria':'ALG','tunisia':'TUN','egypt':'EGY','kenya':'KEN','ethiopia':'ETH','nigeria':'NGA','india':'IND','thailand':'THA','vietnam':'VIE','philippines':'PHI','indonesia':'IDN','malaysia':'MAS','singapore':'SGP','china tpe':'TPE' };
function natOf(n) {
  const s = strip(n).toLowerCase().trim().replace(/\.$/, '');
  if (/^[a-z]{3}$/.test(s)) return s.toUpperCase();
  if (COUNTRY[s]) return COUNTRY[s];
  const key = Object.keys(COUNTRY).find(k => s === k || s.includes(k) || k.includes(s));
  return key ? COUNTRY[key] : null;
}
function num(v, d) { const n = parseInt(String(v).replace(/[^\d]/g, ''), 10); return isFinite(n) ? n : d; }
/* names arrive in every style a dump can offer — "MBAPPE", "kylian mbappe", "Putellas i Tujon" */
const LOWER = /^(de|del|la|le|van|von|di|da|dos|das|der|den|ter|ten|bin|ibn|al|el|the|of|and)$/i;
function prettyName(raw) {
  let n = String(raw || '').replace(/\s+/g, ' ').replace(/[,"]+$/, '').trim();   // accents stay: they are part of the name
  if (!n) return n;
  if (/^[^,]{2,}\s*,\s*[^,]+$/.test(n)) {                       // FBref convention: "Putellas, Alexia"
    const [last, first] = n.split(',').map(x => x.trim());
    n = (first + ' ' + last).replace(/\s+$/, '');
  }
  const shouty = n === n.toUpperCase() && /[A-Z]/.test(n);
  const quiet = n === n.toLowerCase() && /[a-z]/.test(n);
  const caps = w => w.length > 2 && w === w.toUpperCase() && /[A-Z]/.test(w);          // "Kylian MBAPPE"
  if (caps(n.split(' ').slice(1).join(' ')) || shouty || quiet) n = n.toLowerCase().split(' ').map((w, i) => {
    if (!w) return w;
    if (i && LOWER.test(w)) return w.toLowerCase();
    if (/^[mcok]?[aeiou]?\.$/.test(w)) return w;
    if (/^(ii|iii|iv|jr|sr|o\'?[a-z]+)$/.test(w)) return i ? w : w[0].toUpperCase() + w.slice(1);
    return w[0].toUpperCase() + w.slice(1);
  }).join(' ');
  n = n.replace(/([a-zÀ-ÿ])('’)[A-Z]/g, (m, a, b, c) => a + b + c);   // O'Neil, D'Argento keep their cap
  return n.replace(/\s{2,}/g, ' ');
}

/* ---------- known clubs ---------- */
const dbPath = path.join(__dirname, '..', 'db.js');
const DB = new Function('window', fs.readFileSync(dbPath, 'utf8') + '\nreturn window.FC27_DB;')({});
const norm = s => strip(s).toLowerCase().replace(/\b(fc|cf|afc|ac|sc|1\.|club|cd|ud|sd|sk|fk|bk|if|aif|kffl|ff|srfk|w)\b/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const KNOWN = [];
DB.leagues.forEach(lg => lg.divs.forEach((d, di) => d.clubs.forEach(r => {
  const [name, code] = r.split('|');
  KNOWN.push({ name, code, lg: lg.code, div: di, key: norm(name) });
})));
function matchClub(name) {
  if (!name) return null;
  const k = norm(name);
  const exact = KNOWN.filter(c => c.key === k); if (exact.length) return exact[0];
  const part = KNOWN.filter(c => c.key.includes(k) || k.includes(c.key));
  return part.length === 1 ? part[0] : null;
}

/* ---------- build ---------- */
const seen = new Set(), out = [], byClub = new Map();
for (const r of body) {
  const name = strip(r[idx.name]).replace(/\s+/g, ' ').trim();
  if (!name || name.length < 2) continue;
  const ovr = num(r[idx.ovr], 0); if (!ovr) continue;
  const pos = posOf(idx.pos >= 0 ? r[idx.pos] : 'CM');
  const age = num(idx.age >= 0 ? r[idx.age] : 0, pos === 'GK' ? 29 : 24);
  const nat = natOf(idx.nat >= 0 ? r[idx.nat] : '');
  const clubRaw = idx.club >= 0 ? strip(r[idx.club]).trim() : '';
  const league = idx.league >= 0 ? strip(r[idx.league]).trim() : '';
  const key = (name + '|' + clubRaw).toLowerCase();
  if (seen.has(key)) continue; seen.add(key);
  const id = prettyName(name);
  out.push({ name: id, nat: nat || '???', pos, ovr: Math.max(40, Math.min(99, ovr)), age: Math.max(15, Math.min(41, age)),
    clubRaw, league, club: matchClub(clubRaw) });
}
const unknown = out.filter(p => !p.club), known = out.filter(p => p.club);
const groups = new Map();
for (const p of unknown) { const g = p.league || '(no league column)'; if (!groups.has(g)) groups.set(g, new Map());
  const cs = groups.get(g); const c = p.clubRaw || '(no club)';
  const cur = cs.get(c) || { club: c, n: 0, best: 0, sum: 0, nats: new Set() };
  cur.n++; cur.sum += p.ovr; cur.best = Math.max(cur.best, p.ovr); cur.nats.add(p.nat); cs.set(c, cur); }
const dupes = out.length - new Set(out.map(p => (p.name + '|' + p.clubRaw).toLowerCase())).size;
const noNat = out.filter(p => p.nat === '???').reduce((a, p) => a.set(p.clubRaw || '?', (a.get(p.clubRaw || '?') || 0) + 1), new Map());

console.log('file      ' + path.basename(file) + '  ·  ' + (rows.length - 1) + (rows.length - 1 === 1 ? ' row' : ' rows') + '  ·  ' +
  (idx.gender < 0 ? 'no gender column — every row is eligible' : (dropped === 1 ? 'one women\'s row excluded' : dropped + ' women\'s rows excluded')) +
  '  ·  this game covers the men\'s divisions only');
console.log('players   ' + out.length + ' kept (' + known.length + ' map onto existing clubs, ' + unknown.length + ' unknown)' + (dupes ? '  ·  ' + dupes + ' duplicate names folded' : ''));
const posTally = out.reduce((a, p) => a.set(p.pos, (a.get(p.pos) || 0) + 1), new Map());
console.log('positions ' + [...posTally.entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => k + ' ' + v).join('  '));
const byDiv = out.reduce((a, p) => a.set(p.ovr >= 85 ? '85+' : p.ovr >= 78 ? '78-84' : p.ovr >= 70 ? '70-77' : '<70', (a.get(p.ovr >= 85 ? '85+' : p.ovr >= 78 ? '78-84' : p.ovr >= 70 ? '70-77' : '<70') || 0) + 1), new Map());
console.log('ratings   ' + [...byDiv.entries()].map(([k, v]) => k + ':' + v).join('  '));
console.log('unmapped nation codes ' + (noNat.size ? [...noNat.entries()].slice(0, 6).map(([k, v]) => k + '×' + v).join(', ') : 'none'));
console.log('\nclubs already in the universe that this file can feed:');
for (const c of [...new Set(known.map(p => p.club.code))].slice(0, 40)) {
  const list = known.filter(p => p.club.code === c).sort((a, b) => b.ovr - a.ovr);
  console.log('  ' + c.padEnd(5) + String(list[0].club.name).padEnd(22) + list.length + ' players · best ' + list[0].name + ' ' + list[0].ovr);
}
if (unknown.length) {
  console.log('\nunknown clubs, grouped by the league column:');
  for (const [lg, cs] of groups) console.log('  ' + lg.padEnd(26) + cs.size + ' clubs · ' + [...cs.values()].sort((a, b) => b.n - a.n).slice(0, 4).map(c => c.club + ' (' + c.n + ', best ' + c.best + ')').join(', ') + (cs.size > 4 ? '…' : ''));
}
if (flags.has('--new-leagues')) {
  const blocks = [];
  for (const [lgName, cs] of groups) {
    const clubs = [...cs.values()].sort((a, b) => b.best - a.best).slice(0, 24);
    if (clubs.length < 6) { console.log('\nskipping "' + lgName + '": only ' + clubs.length + ' clubs'); continue; }
    const code = lgName.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'WLD';
    const rowsOut = clubs.map(c => {
      const short = (c.club.match(/\b[A-Z]{2,4}\b/) || [])[0] || c.club.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
      const str = Math.max(50, Math.min(92, Math.round(c.best * .78 + (c.sum / c.n) * .22)));
      return "            '" + c.club.replace(/'/g, '') + "|" + short + "|" + str + "|" + (18000 + (c.n % 9) * 2400) + "|" + (0.2 + str / 200).toFixed(1) + "M'";
    });
    blocks.push("    { code:'" + code + "', name:'" + lgName.replace(/'/g, '') + "', confed:'UEFA', tv:.42,\n" +
      "      divs: [\n        { code:'" + code + "1', name:'" + lgName.replace(/'/g, '') + "', rep:.45, size:" + clubs.length + ", cup:'Domestic Cup',\n          clubs: [\n" + rowsOut.join(',\n') + "\n          ] },\n" +
      "        { code:'" + code + "2', name:'" + lgName.replace(/'/g, '') + " II', rep:.32, size:" + clubs.length + ", cup:'Second Cup', clubs: [] }\n      ],\n" +
      "      promotion: { auto: 0, playoff: null },\n      relegation: { auto: 0, playoff: null } }");
  }
  const emit = opt('emit', 'db.new-leagues.js');
  fs.writeFileSync(path.isAbsolute(emit) ? emit : path.join(__dirname, '..', emit),
    '/* generated by tools/import-players.js — paste these objects into the leagues array in db.js\n   (a division with clubs: [] is filled by the engine from its own defaults; delete it if you\n   do not want a second tier, and set promotion/relegation to the real rules) */\n[\n' + blocks.join(',\n') + '\n]\n');
  console.log('\nwrote ' + blocks.length + ' candidate league blocks → ' + emit);
}
if (flags.has('--apply')) {
  const lines = out.filter(p => p.club && p.nat !== '???').sort((a, b) => b.ovr - a.ovr)
    .map(p => "    '" + p.name + "|" + p.nat + "|" + p.pos + "|" + p.ovr + "|" + p.age + "|" + p.club.code + "'");
  const tag = want === 'all' ? 'imported' : want;
  const body2 = "  players: [ /* " + lines.length + " rows from " + path.basename(file) + " (" + tag + "), " + new Date().toISOString().slice(0, 10) + " */\n" +
    lines.map((l, i) => l + (i < lines.length - 1 ? ',' : '')).join('\n') + "\n  ],";
  let src = fs.readFileSync(dbPath, 'utf8');
  const i = src.search(/\n {2}players: \[/); const j = src.indexOf("\n  ],", i);
  if (i < 0 || j < 0) { console.log('\n--apply aborted: could not find the players array in db.js'); process.exit(2); }
  src = src.slice(0, i + 1) + body2 + src.slice(j + 5);
  fs.writeFileSync(dbPath, src);
  console.log('\napplied ' + lines.length + ' player rows to db.js  (old rows replaced — run node tools/validate-db.js)');
} else console.log('\nnothing written. add --apply to rewrite db.js, or --new-leagues --emit=… for the unknown clubs.');
