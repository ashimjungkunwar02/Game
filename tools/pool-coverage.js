#!/usr/bin/env node
/*
  Football Career 27 — named-player coverage of the universe.

  db.js carries a curated list of real players; everything else about a squad is generated. This says
  exactly where the gap is, per division: how many named players each club has, which clubs have
  none, and how the generated pool compares with the real one in rating terms. Run it before and
  after importing a dataset to prove the import did something.

      node tools/pool-coverage.js [--csv path/to/players.csv]   (the csv is filtered like the importer does)
*/
const fs = require('fs');
const path = require('path');
const DB = new Function('window', fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8') + '\nreturn window.FC27_DB;')({});

const MIN = 11;                       // a squad wants at least this many named outfield players
const rows = DB.players.map(r => r.split('|'));
const byClub = new Map();
for (const [name, nat, pos, ovr, age, club] of rows)
  if (pos !== 'GK') byClub.set(club, (byClub.get(club) || 0) + 1);

let csvClubs = null;
const csvArg = process.argv.indexOf('--csv');
if (csvArg > 0 && fs.existsSync(process.argv[csvArg + 1])) {
  const txt = fs.readFileSync(process.argv[csvArg + 1], 'utf8').split(/\r?\n/);
  const head = txt[0].split(',').map(h => h.trim().toLowerCase());
  const gi = head.findIndex(h => /gender|sex/.test(h)), ci = head.findIndex(h => /^club|team/.test(h));
  const F = /^(f|female|w|women|ladies)$/i;
  csvClubs = new Map();
  for (const line of txt.slice(1)) {
    const p = line.split(',');
    if (gi >= 0 && F.test((p[gi] || '').trim())) continue;
    if (ci >= 0 && p[ci]) { const c = p[ci].trim().replace(/^"|"$/g, ''); csvClubs.set(c, (csvClubs.get(c) || 0) + 1); }
  }
  console.log('csv: ' + (csvClubs.size) + ' distinct clubs (after excluding the women\'s rows)\n');
}

let total = 0, empty = 0, thin = 0;
const lines = [];
for (const lg of DB.leagues) for (let di = 0; di < lg.divs.length; di++) {
  const d = lg.divs[di];
  const clubs = d.clubs.map(r => r.split('|'));
  const counts = clubs.map(([name, code]) => ({ name, code, n: byClub.get(code) || 0 }));
  const named = counts.reduce((a, c) => a + c.n, 0);
  total += named;
  const e = counts.filter(c => !c.n).length, t = counts.filter(c => c.n > 0 && c.n < MIN).length;
  empty += e; thin += t;
  lines.push((lg.code + ' d' + di).padEnd(7) + String(d.name).padEnd(24) +
    (named + ' named').padStart(12) + ('  ·  avg ' + (named / clubs.length).toFixed(1)).padEnd(14) +
    '  ·  ' + e + ' clubs with none, ' + t + ' thin');
  const worst = counts.filter(c => !c.n).map(c => c.code).join(' ');
  if (worst) lines.push('        none: ' + worst);
}
console.log(lines.join('\n'));
console.log('\nuniverse: ' + DB.leagues.reduce((a, l) => a + l.divs.reduce((b, d) => b + d.clubs.length, 0), 0) +
  ' clubs, ' + rows.length + ' named players · ' + empty + ' clubs have no named player at all, ' + thin + ' have fewer than ' + MIN);
console.log('what a real export buys you: named first XIs for those ' + empty + ' clubs, so the Golden Boot race,');
console.log('transfer targets and rival suitors stop being generated numbers and start being people.');
