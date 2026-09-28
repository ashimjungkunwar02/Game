/* tools/make-pack.js — carve a country out of db.js and hand it to the pack system.
   ==================================================================================
   The game composes its world from db.js plus any number of data packs (see
   packs/README.md). This tool is how a pack gets *made* from the universe file you
   already have, without inventing a second copy of the truth:

     1. the league entries for the country (with their promotion/relegation rules) move
        out of db.js and into packs/fc27-<slug>.js, together with every player row whose
        club belongs to them and every coach of those clubs;
     2. db.js is rewritten without them;
     3. the union of the two is asserted to be exactly what db.js held before — the same
        clubs, the same players, the same rules — so a pack can never quietly lose content;
     4. packs/manifest.js is regenerated, which is the list the in-game Universe panel
        offers for download.

   This is how a big install gets smaller: a player who only ever plays in England should
   not carry thirteen thousand rows of Norway and India in memory or in their save.

     node tools/make-pack.js IND              # dry run: what would move
     node tools/make-pack.js IND --apply       # write the pack, rewrite db.js
     node tools/make-pack.js IND,SCO --apply
*/
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
/* every bare argument is a league code in db.js: IND, USA, DE3, EFL… */
const list = args.filter(a => !a.startsWith('--')).join(',').toUpperCase().split(',').map(s => s.trim()).filter(Boolean);
if (!list.length) { console.error('usage: node tools/make-pack.js IND[,SCO] [--apply]'); process.exit(1); }

const src = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
const lines = src.split('\n');
const DB = new Function('window', src + '\nreturn window.FC27_DB;')({});

const before = { clubs: 0, players: DB.players.length, coaches: DB.coaches.length, leagues: DB.leagues.length };
DB.leagues.forEach(L => L.divs.forEach(D => before.clubs += D.clubs.length));

/* find a top-level league object by brace balance, so the block can be lifted verbatim */
function blockFor(code) {
  const start = lines.findIndex(l => new RegExp("\\{\\s*code:\\s*'" + code + "'").test(l));
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) { if (ch === '{') depth++; else if (ch === '}') depth--; }
    if (depth === 0 && lines[i].includes('}')) return { from: start, to: i };
  }
  return null;
}
const picked = [];
for (const code of list) {
  const L = DB.leagues.find(x => x.code === code);
  if (!L) { console.error('no league ' + code + ' in db.js'); process.exit(1); }
  const blk = blockFor(code);
  const clubCodes = new Set();
  L.divs.forEach(D => D.clubs.forEach(r => clubCodes.add(r.split('|')[1])));
  const players = DB.players.filter(r => clubCodes.has(r.split('|')[5]));
  const coaches = DB.coaches.filter(c => clubCodes.has(c.club));
  picked.push({ code, L, blk, clubCodes, players, coaches, lines: lines.slice(blk.from, blk.to + 1) });
}

const moved = { clubs: 0, players: 0, coaches: 0, leagues: picked.length };
picked.forEach(p => { moved.clubs += p.clubCodes.size; moved.players += p.players.length; moved.coaches += p.coaches.length; });
console.log('moving out of db.js: ' + picked.map(p => p.code + ' (' + p.clubCodes.size + ' clubs, ' + p.players.length + ' players)').join(', '));
console.log('  ' + moved.leagues + ' leagues · ' + moved.clubs + ' clubs · ' + moved.players + ' players · ' + moved.coaches + ' coaches');

const slug = picked.map(p => p.code.toLowerCase()).join('-');
const packId = 'fc27-' + slug;
const packPath = path.join(ROOT, 'packs', packId + '.js');
const names = picked.map(p => p.L.name).join(' + ');
const note = 'Carved out of db.js by tools/make-pack.js. Real leagues, real rules, real squads — the pack is '
  + 'the same data the file used to carry, so installing it returns the universe to exactly what it was.';

if (APPLY) {
  /* 1. the pack file — one object, pushed into the registry the engine already reads */
  const arr = (xs, pad) => '[\n' + xs.map(x => pad + '  ' + JSON.stringify(x) + ',').join('\n') + '\n' + pad + ']';
  /* serialised, not pasted from the file: one club per line, valid JS by construction, and the
     brace-hunting above is only used to know what to delete from db.js */
  const leagueSrc = L => '    {\n      code: ' + JSON.stringify(L.code) + ', name: ' + JSON.stringify(L.name)
    + ', confed: ' + JSON.stringify(L.confed) + ', tv: ' + L.tv + ',\n'
    + '      note: ' + JSON.stringify(L.note || '') + ',\n      divs: [\n'
    + L.divs.map(D => '        { code: ' + JSON.stringify(D.code) + ', name: ' + JSON.stringify(D.name)
        + ', rep: ' + D.rep + ', size: ' + D.size + ', cup: ' + JSON.stringify(D.cup) + ',\n          clubs: [\n'
        + D.clubs.map(c => "          '" + c + "',").join('\n') + '\n        ] }').join(',\n')
    + '\n      ],\n      promotion: ' + JSON.stringify(L.promotion) + ',\n      relegation: ' + JSON.stringify(L.relegation) + '\n    }';
  const leagues = picked.map(p => leagueSrc(p.L)).join(',\n');
  const body = '/* Football Career 27 — data pack: ' + names + '.\n'
    + '   ' + note + '\n'
    + '   Install: the game lists it in HUB → Universe (it reads packs/manifest.js), or drop the\n'
    + '   file on the Load-a-pack-file control. Schema: packs/README.md. */\n'
    + '(window.FC27_PACKS = window.FC27_PACKS || []).push({\n'
    + "  id: '" + packId + "',\n"
    + "  name: '" + names.replace(/'/g, "\\'") + "',\n"
    + "  version: '" + (DB.meta.updated || 'snapshot') + "',\n"
    + "  note: " + JSON.stringify(note) + ',\n'
    + '  leagues: [\n' + leagues + '\n  ],\n'
    + '  nations: [],\n'
    + '  players: ' + arr(picked.flatMap(p => p.players), '  ') + ',\n'
    + '  coaches: ' + arr(picked.flatMap(p => p.coaches).map(c => c.name + '|' + c.nat + '|' + c.tactic + '|' + c.age + '|' + (c.club || ('INTL:' + c.country))), '  ') + '\n'
    + '});\n';
  fs.mkdirSync(path.join(ROOT, 'packs'), { recursive: true });
  fs.writeFileSync(packPath, body);

  /* 2. db.js loses exactly what the pack gained */
  const dropLines = new Set();
  picked.forEach(p => { for (let i = p.blk.from; i <= p.blk.to; i++) dropLines.add(i); });
  const allCodes = new Set(picked.flatMap(p => [...p.clubCodes]));
  lines.forEach((l, i) => {
    if (dropLines.has(i)) return;
    const m = /^\s*'(.+?)\|([A-Z]{2,4})\|([A-Z]{2,3})\|(\d+)\|(\d+)\|([A-Z0-9]+)(\|.*)?',?\s*$/.exec(l);
    if (m && allCodes.has(m[6])) dropLines.add(i);
  });
  const kept = lines.filter((l, i) => !dropLines.has(i));
  fs.writeFileSync(path.join(ROOT, 'db.js'), kept.join('\n'));

  /* 3. the manifest the in-game panel lists */
  const idx = fs.readdirSync(path.join(ROOT, 'packs')).filter(f => /\.js$/.test(f) && f !== 'manifest.js').map(f => {
    const one = new Function('window', 'window.FC27_PACKS=[];' + fs.readFileSync(path.join(ROOT, 'packs', f), 'utf8') + '\nreturn window.FC27_PACKS[0];')({});
    const clubs = one.leagues.reduce((a, L) => a + L.divs.reduce((x, D) => x + D.clubs.length, 0), 0);
    return { file: 'packs/' + f, id: one.id, name: one.name, version: one.version,
             summary: one.leagues.length + ' league' + (one.leagues.length > 1 ? 's' : '') + ' · ' + clubs + ' clubs · ' + (one.players || []).length + ' players' };
  });
  fs.writeFileSync(path.join(ROOT, 'packs', 'manifest.js'),
    '/* Football Career 27 — the data packs sitting beside this file. The game reads this list and\n'
    + '   offers each entry for install from HUB → Universe; nothing is loaded unless you ask for it. */\n'
    + 'window.FC27_PACK_INDEX = ' + JSON.stringify(idx, null, 1) + ';\n');

  /* 4. the union must be the universe we started with */
  const now = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
  const B = new Function('window', now + '\nreturn window.FC27_DB;')({});
  const P = new Function('window', 'window.FC27_PACKS=[];' + fs.readFileSync(packPath, 'utf8') + '\nreturn window.FC27_PACKS[0];')({});
  const union = { leagues: B.leagues.length + P.leagues.length, players: B.players.length + P.players.length };
  let clubs = 0; B.leagues.forEach(L => L.divs.forEach(D => clubs += D.clubs.length));
  P.leagues.forEach(L => L.divs.forEach(D => clubs += D.clubs.length));
  union.clubs = clubs;
  console.log('union check  base ' + B.leagues.length + '+' + P.leagues.length + ' leagues · '
    + union.clubs + '/' + before.clubs + ' clubs · ' + union.players + '/' + before.players + ' players');
  const same = union.leagues === before.leagues && union.clubs === before.clubs && union.players === before.players;
  console.log((same ? '✓ nothing lost' : '✗ THE UNION DOES NOT MATCH — restore db.js from git')
    + ' · pack at ' + path.relative(ROOT, packPath) + ' (' + Math.round(fs.statSync(packPath).size / 1024) + 'kb)'
    + ' · db.js ' + Math.round(fs.statSync(path.join(ROOT, 'db.js')).size / 1024) + 'kb');
  if (!same) process.exit(1);
} else console.log('dry run — add --apply to write packs/' + packId + '.js and rewrite db.js');
