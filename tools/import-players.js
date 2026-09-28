#!/usr/bin/env node
/*
  Football Career 27 — player CSV importer.

  Turns a big players export (EA/FIFA-style dumps, FBref pulls, a league's own list) into rows that
  fit db.js: real six-attribute values, real ages, positions folded onto the game's ten, club names
  mapped onto the clubs in the universe (--expand can add more of them). Nothing is written unless you pass --apply.

      node tools/import-players.js players.csv                     report only (men's rows only)
      node tools/import-players.js players.csv --csv -             read a pasted file from stdin
      node tools/import-players.js players.csv --report=map.txt    write the club pairing table
      node tools/import-players.js players.csv --apply             rewrite the players array in db.js
      node tools/import-players.js players.csv --apply --squad=20  squad size per club (default 18)
      node tools/import-players.js players.csv --apply --squad=0    every outfielder in the file
      node tools/import-players.js players.csv --apply --expand     turn the file's other leagues
                                                                    into playable countries too

  The game covers the men's divisions only, so rows the file marks as women's are dropped. The
  column is matched loosely on purpose: "Women's Football", "F", "female", "W" all count, and a
  blank gender is kept (most men's exports carry no gender column at all).

  Row shape written into db.js:  Name|NAT|POS|OVR|AGE|clubSHORT|P,SH,PA,DR,DE,PH
  The attribute tail is optional; the engine derives attributes from OVR when a row has none.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');

const argv = process.argv.slice(2);
let file = argv.find(a => !a.startsWith('--'));
const flags = new Set(argv.filter(a => a.startsWith('--')));
const opt = (k, d) => { const a = argv.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=').slice(1).join('=') : d; };
if (!file) { console.log('usage: node tools/import-players.js <players.csv|-> [--gender=male|female|all] [--squad=18] [--apply] [--report=file]'); process.exit(1); }
const want = opt('gender', 'male');
const SQUAD = +opt('squad', 18);            // 0 means everyone the file lists
if (file === '-') {
  const tmp = path.join(os.tmpdir(), 'fc27-pasted-' + process.pid + '.csv');
  fs.writeFileSync(tmp, fs.readFileSync(0, 'utf8')); file = tmp;
}
if (!fs.existsSync(file)) {
  console.log('no such file: ' + file);
  console.log('the CSV has not reached the sandbox — re-attach it, paste it (node tools/import-players.js -),');
  console.log('or commit it into the repo as players.csv and point me at that');
  process.exit(2);
}

/* ---------------------------------------------------------------- csv */
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
  return rows.filter(r => r.some(x => String(x).trim() !== ''));
}
const ALIAS = {
  name: ['common_name', 'name', 'player', 'player_name', 'longname', 'full_name', 'short name', 'shortname'],
  first: ['first_name'], last: ['last_name'],
  gender: ['gender', 'sex', 'gender_code'],
  age: ['age'], birth: ['birthdate', 'birth_date', 'dob'],
  ovr: ['overall_rating', 'overall', 'ovr', 'rating', 'best_overall'],
  pos: ['position', 'positions', 'pos', 'preferred positions', 'preferred_positions', 'common position', 'role_position'],
  alt: ['alternate_positions', 'alt_positions', 'other positions'],
  nat: ['nationality', 'nation', 'country', 'cid'],
  club: ['club', 'team', 'current_team', 'team_name', 'club_name'],
  league: ['league', 'league_name', 'competition', 'division', 'comp'],
  pace: ['pace'], shooting: ['shooting'], passing: ['passing'], dribbling: ['dribbling'],
  defending: ['defending', 'defense'], physical: ['physicality', 'physical']
};
const rows = parseCSV(fs.readFileSync(file, 'utf8'));
const head = rows[0].map(h => h.trim().toLowerCase().replace(/^\ufeff/, ''));
const col = k => { for (const a of ALIAS[k]) { const i = head.indexOf(a); if (i >= 0) return i; }
  const loose = head.findIndex(h => ALIAS[k].some(a => h.includes(a))); return loose >= 0 ? loose : -1; };
const idx = {}; for (const k of Object.keys(ALIAS)) idx[k] = col(k);
if (idx.name < 0 || idx.ovr < 0) { console.log('cannot find a name and an overall/rating column. header was: ' + head.join(', ')); process.exit(2); }
const WOMS = /wom(en|men'?s|ans)|female|\bladies\b|\bgirls?\b|^f$|^w$/i;
const genderOf = r => idx.gender >= 0 ? String(r[idx.gender] || '').trim() : '';
function keep(r) {
  if (idx.gender < 0 || want === 'all') return true;
  const g = genderOf(r);
  const female = WOMS.test(g);
  return want === 'female' ? female : !female;
}
const body = rows.slice(1).filter(keep);
const excluded = idx.gender >= 0 && want !== 'all' ? rows.length - 1 - body.length : 0;

/* ---------------------------------------------------------------- values */
const deaccent = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function posOf(primary, alt) {
  const map = { ST: 'ST', FW: 'ST', CF: 'ST', LS: 'ST', RS: 'ST', LW: 'LW', RW: 'RW', LF: 'LW', RF: 'RW', LM: 'LW', RM: 'RW',
    CAM: 'CAM', AM: 'CAM', CM: 'CM', CDM: 'CDM', DM: 'CDM', LB: 'LB', RB: 'RB', LW: 'LW', RW: 'RW',
    CB: 'CB', DC: 'CB', D: 'CB', GK: 'GK', SK: 'GK' };
  const tokens = String(primary || '').concat(' ', String(alt || '')).toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  for (const t of tokens) if (map[t]) return map[t];
  for (const t of tokens) { if (/^GK?$/.test(t)) return 'GK'; if (/^L/.test(t)) return 'LB'; if (/^R/.test(t)) return 'RB';
    if (/^C/.test(t)) return 'CB'; if (/^M/.test(t)) return 'CM'; if (/^A/.test(t)) return 'CAM'; if (/^[SF]/.test(t)) return 'ST'; }
  return 'CM';
}
/* continent of a nation name, used only to place a nation we did not already know in the
   right confederation for the international calendar */
const CONFED_OF = {
  UEFA: ['england','france','spain','germany','italy','portugal','netherlands','belgium','croatia','austria','switzerland','poland','denmark','sweden','norway','finland','denmark','iceland','ireland','wales','scotland','ukraine','russia','serbia','greece','romania','hungary','czech','slovakia','slovenia','albania','bosnia','kosovo','montenegro','macedonia','georgia','armenia','azerbaijan','kazakhstan','estonia','latvia','lithuania','belarus','moldova','luxembourg','liechtenstein','andorra','malta','san marino','turkey','israel','cyprus','faroe','gibraltar'],
  CONMEBOL: ['brazil','argentina','uruguay','chile','colombia','ecuador','peru','paraguay','venezuela','bolivia'],
  CAF: ['senegal','morocco','algeria','tunisia','egypt','nigeria','ghana','cameroon','cote d ivoire','ivory coast','mali','burkina','guinea','congo','gabon','benin','cape verde','verde','zambia','south africa','kenya','angola','mozambique','niger','togo','sierra','liberia','gambia','uganda','zimbabwe','tanzania','ethiopia','democratic republic','mauritania','djibouti','eritrea','somalia','sudan','rwanda','burundi','lesotho','eswatini','botswana','namibia','malawi','comoros','chad','equatorial','saotome','principe','reunion','zanzibar'],
  AFC: ['japan','south korea','korea','china','australia','iran','saudi','qatar','iraq','uzbekistan','jordan','syria','lebanon','palestine','bahrain','oman','yemen','kuwait','india','thailand','vietnam','indonesia','malaysia','singapore','philippines','myanmar','cambodia','laos','nepal','bhutan','sri lanka','bangladesh','turkmenistan','tajikistan','kyrgyzstan','afghanistan','palestine'],
  CONCACAF: ['mexico','united states','usa','canada','costa rica','honduras','panama','jamaica','haiti','trinidad','curacao','cura\u00e7ao','el salvador','guatemala','belize','nicaragua','cuba','bermuda','barbados','grenada','antigua','saint kitts','saint lucia','saint vincent','dominica','dominican','aruba','bahamas','turks','cayman','puerto rico','virgin'],
  OFC: ['new zealand','fiji','papua','solomon','vanuatu','samoa','tonga','caledonia','guam']
};
function confedOf(name) {
  const n = deaccent(name).toLowerCase();
  for (const k in CONFED_OF) if (CONFED_OF[k].some(x => n.includes(x))) return k;
  return 'UEFA';
}
const COUNTRY = { england:'ENG', scotland:'SCO', wales:'WAL', ireland:'IRL', 'northern ireland':'NIR', france:'FRA', germany:'GER',
  spain:'ESP', italy:'ITA', portugal:'POR', netherlands:'NED', belgium:'BEL', switzerland:'SUI', austria:'AUT', sweden:'SWE',
  norway:'NOR', denmark:'DEN', finland:'FIN', iceland:'ISL', poland:'POL', czechia:'CZE', 'czech republic':'CZE', ukraine:'UKR',
  romania:'ROU', serbia:'SRB', croatia:'CRO', 'bosnia and herzegovina':'BIH', bosnia:'BIH', hungary:'HUN', greece:'GRE', russia:'RUS',
  turkey:'TUR', holland:'NED', 'republic of ireland':'IRL', 'korea republic':'KOR', 'iran':'IRN', slovenia:'SLO', slovakia:'SVK', albania:'ALB', georgia:'GEO', 'united states':'USA', usa:'USA', canada:'CAN', mexico:'MEX',
  'costa rica':'CRC', jamaica:'JAM', panama:'PAN', haiti:'HAI', brazil:'BRA', argentina:'ARG', uruguay:'URU', chile:'CHI', colombia:'COL',
  venezuela:'VEN', ecuador:'ECU', peru:'PER', paraguay:'PAR', bolivia:'BOL', japan:'JPN', china:'CHN', 'south korea':'KOR', 'north korea':'PRK',
  australia:'AUS', 'new zealand':'NZL', ghana:'GHA', nigeria:'NGA', cameroon:'CMR', senegal:'SEN', morocco:'MAR', 'south africa':'RSA',
  zambia:'ZAM', 'ivory coast':'CIV', mali:'MLI', algeria:'ALG', tunisia:'TUN', egypt:'EGY', kenya:'KEN', ethiopia:'ETH', india:'IND',
  thailand:'THA', vietnam:'VIE', philippines:'PHI', indonesia:'IDN', nigeria:'NGA', 'republic of ireland':'IRL', serbia:'SRB' };
function natOf(n) {
  const s = deaccent(n).toLowerCase().trim().replace(/\.$/, '');
  if (/^[a-z]{3}$/.test(s)) return s.toUpperCase();
  if (COUNTRY[s]) return COUNTRY[s];
  const key = Object.keys(COUNTRY).find(k => s === k || s.includes(k) || k.includes(s));
  return key ? COUNTRY[key] : null;
}
const num = (v, d) => { const n = parseInt(String(v == null ? '' : v).replace(/[^\d-]/g, ''), 10); return isFinite(n) ? n : d; };
const LOWER = /^(de|del|la|le|van|von|di|da|dos|das|der|den|ter|ten|bin|ibn|al|el|the|of)$/i;
/* the export fills common_name for only a third of its rows, and when it does it is often a
   single word ("Gabriel"), so: two-word common name wins, otherwise first + last. */
function displayName(r) {
  const cn = String(idx.name >= 0 ? r[idx.name] || '' : '').replace(/\s+/g, ' ').trim();
  const fn = String(idx.first >= 0 ? r[idx.first] || '' : '').trim();
  /* the whole surname, not its first word: "van Dijk" and "dos S. Magalhães" are surnames, and
     cutting them at the particle is how the database ended up signing for "Virgil van" */
  const ln = String(idx.last >= 0 ? r[idx.last] || '' : '').replace(/\s+/g, ' ').trim();
  if (cn && /\s/.test(cn)) return prettyName(cn);
  if (cn && fn && ln) return prettyName(cn.length > fn.length ? cn : fn + ' ' + ln);
  if (fn && ln) return prettyName(fn + ' ' + ln);
  return prettyName(cn || fn || ln);
}
function prettyName(raw) {
  let n = String(raw || '').replace(/\s+/g, ' ').replace(/[,"]+$/, '').trim();
  if (!n) return n;
  if (/^[^,]{2,}\s*,\s*[^,]+$/.test(n)) { const [last, first] = n.split(',').map(x => x.trim()); n = first + ' ' + last; }
  const words = n.split(' ');
  const shouty = n === n.toUpperCase() && /[A-Z]/.test(n);
  const quiet = n === n.toLowerCase() && /[a-z]/.test(n);
  const caps = w => w.length > 2 && w === w.toUpperCase() && /[A-Z]/.test(w) && !/^[A-Z]{2,4}$/.test(w);
  if (shouty || quiet || words.some(caps)) n = words.map((w, i) => {
    if (!w) return w;
    if (i && LOWER.test(w.toLowerCase())) return w.toLowerCase();
    if (/^[A-Z]{2,5}$/.test(w) && !/[aeiou]/i.test(w)) return w;                     // AFC, FC, SC …
    return (w[0] || '').toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');
  return n.replace(/\s{2,}/g, ' ');
}
/* a country outside the 70 in db.js still deserves a row: transliterate a code and move on */
const guessCode = n => { const s2 = deaccent(n || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3); return s2.length === 3 ? s2 : null; };
const SNAPSHOT = new Date('2026-07-01T00:00:00Z');            // db.js meta.snapshot: age is measured here
function ageOf(r) {
  if (idx.age >= 0) { const a = num(r[idx.age], 0); if (a >= 14 && a <= 45) return a; }
  if (idx.birth >= 0) { const d = new Date(String(r[idx.birth] || '').trim());
    if (!isNaN(d)) return Math.floor((SNAPSHOT - d) / (365.25 * 864e5)); }
  return 0;
}

/* ---------------------------------------------------------------- the universe we map into */
const dbPath = path.join(__dirname, '..', 'db.js');
const DB = new Function('window', fs.readFileSync(dbPath, 'utf8') + '\nreturn window.FC27_DB;')({});
const DROP = /\b(fc|cf|cfc|afc|acc|ac|ca|cd|ud|sd|sc|sk|fk|bk|if|rcd|rc|cp|ssd|ssc|as|ap|ufc|afc|1\.|club|real? ?club)\b/g;
const SYN  = { united:'utd', utd:'utd', 'nott\u2019m':'nottingham', 'nott\u0027m':'nottingham', nottm:'nottingham', atletico:'atletico', 'athletic club':'athletic' };
function toks(s2) {
  return deaccent(s2).toLowerCase().replace(DROP, ' ').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter(Boolean).map(w => SYN[w] || w);
}
const norm = s2 => toks(s2).join(' ');
const B_TEAM = /(^| )(b|b\b|ii|iii|aficionado|fortuna|castilla|primevera|reserves|u19|u21|u23| youth|women|wfc)$/i;
/* the file's league names (sponsor-named) for each division the universe holds */
const LEAGUE_OF = {
  'ENG0': ['premier league'], 'ENG1': ['efl championship'],
  'ESP0': ['laliga ea sports', 'la liga', 'primera division'], 'ESP1': ['laliga hypermotion', 'laliga 2'],
  'GER0': ['bundesliga'], 'GER1': ['bundesliga 2', '2. bundesliga'],
  'ITA0': ['serie a enilive', 'serie a'], 'ITA1': ['serie bkt', 'serie b'],
  'FRA0': ["ligue 1 mcdonald's", 'ligue 1'], 'FRA1': ['ligue 2 bkt', 'ligue 2']
};
/* the country each file-league belongs to, so a club that moved division between the file's
   season and ours is still found — but never in another country */
const COUNTRY_LEAGUES = {
  ENG: ['premier league', 'efl championship', 'efl league one', 'efl league two', 'english carabao cup'],
  ESP: ['laliga ea sports', 'laliga hypermotion', 'primera rfef'],
  GER: ['bundesliga', 'bundesliga 2', '3. liga'],
  ITA: ['serie a enilive', 'serie bkt', 'serie c'],
  FRA: ["ligue 1 mcdonald's", 'ligue 2 bkt', 'national']
};
/* clubs the export renames or shortens: our code -> the name in the file */
const CLUB_ALIAS = {
  TOT: 'spurs', MUN: 'man utd', NFO: "nott'm forest", WOL: 'wolves', BHA: 'brighton', NEW: 'newcastle utd',
  WHU: 'west ham', WBA: 'west brom', QPR: 'qpr', CHA: 'charlton ath', ATM: 'atlético de madrid',
  CEL: 'celta', ESP: 'rcd espanyol', MAL: 'rcd mallorca', ALA: 'd. alavés', OVI: 'r. oviedo',
  RAC: 'r. racing club', SPG: 'r. sporting', DEP: 'rc deportivo', ZAR: 'real zaragoza', ALB: 'albacete bp',
  VLL: 'r. Valladolid cf', B04: 'leverkusen', SGE: 'frankfurt', BMG: "m'gladbach", FCH: 'heidenheim',
  FCK: 'kaiserslautern', SCP: 'sc paderborn 07', SGF: 'fürth', EBS: 'braunschweig', F95: 'düsseldorf',
  NAP: 'ssc napoli', VER: 'hellas verona', INT: 'lombardia fc', MIL: 'milano fc', ATA: 'bergamo calcio',
  LAZ: 'latium', PSG: 'paris sg', OL: 'ol', OM: 'om', LIL: 'losc lille', RCL: 'rc lens', STR: 'strasbourg',
  MHS: 'montpellier', NAN: 'fc nantes', SRFC: 'stade rennais fc', HAC: 'havre ac', TRO: 'estac troyes',
  MHSC: 'montpellier', ASC: 'amiens', SCB: 'bastia', SMC: 'caen', LAV: 'laval', TER: 'ternana',
  COS: 'cosenza', REG: 'reggiana', SPE: 'spezia', BRE2: 'brescia', BAR2: 'bari', CAD: 'cádiz cf',
  MIR: 'mirandés', PON: 'ponferradina', CAR: 'cartagena', HUE: 'huesca', FER: 'ferrol', ULM: 'ulm',
  BAR: 'fc barcelona', RMA: 'real madrid cf',
  SHU: 'sheffield utd', NOR: 'norwich', PRE: 'preston', COV: 'coventry', HUL: 'hull', STO: 'stoke city',
  WLY: 'wolverhampton', MUN2: 'man utd'
};
const MY_CLUBS = [];
DB.leagues.forEach(lg => lg.divs.forEach((d, di) => d.clubs.forEach(r => {
  const [name, code, str] = r.split('|');
  MY_CLUBS.push({ name, code, str: +str, key: norm(name), lg: lg.code, div: di, lk: lg.code + di,
    leagues: (LEAGUE_OF[lg.code + di] || []).concat(COUNTRY_LEAGUES[lg.code] || []) });
})));
const MY_BY_KEY = new Map();
for (const c of MY_CLUBS) { if (!c.key) continue; if (!MY_BY_KEY.has(c.key)) MY_BY_KEY.set(c.key, []); MY_BY_KEY.get(c.key).push(c); }

/* the file's clubs, bucketed by league */
const FILE = new Map();   // "league||club" -> { league, club, key, n, sum, best }
for (const r of body) {
  const club = deaccent(r[idx.club] || '').trim(); if (!club) continue;
  const league = deaccent(r[idx.league] || '').trim().toLowerCase();
  const k = (league || '?') + '||' + club;
  let c = FILE.get(k); if (!c) { c = { league, club, key: norm(club), n: 0, sum: 0, best: 0 }; FILE.set(k, c); }
  c.n++; c.sum += num(r[idx.ovr], 60); c.best = Math.max(c.best, num(r[idx.ovr], 0));
}
const BY_LEAGUE = new Map(), BY_KEY = new Map();
for (const c of FILE.values()) {
  if (!BY_LEAGUE.has(c.league)) BY_LEAGUE.set(c.league, []);
  BY_LEAGUE.get(c.league).push(c);
  if (!c.key) continue;
  if (!BY_KEY.has(c.key)) BY_KEY.set(c.key, []);
  BY_KEY.get(c.key).push(c);
}
/* a file club means mine when the shorter token list sits inside the longer one ("norwich city" ⊃
   "norwich"), which is how a spreadsheet abbreviates; B teams and women's sides never qualify */
function fits(mineKey, fileKey) {
  if (!fileKey || fileKey === mineKey) return fileKey === mineKey;
  const a = mineKey.split(' '), b = fileKey.split(' ');
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (!short.length) return false;
  if (short.length === 1 && short[0].length < 5) return false;
  return short.every(t => long.includes(t));
}
/* pick the file club that means this one of mine: alias > same-division league > country leagues */
function pickClub(mine) {
  const pool = () => { const set = new Set();
    for (const L of mine.leagues) for (const c of (BY_LEAGUE.get(L) || [])) set.add(c);
    for (const c of (BY_KEY.get(mine.key) || [])) set.add(c);
    return [...set].filter(c => !B_TEAM.test(c.club)); };
  const cand = pool();
  const al = CLUB_ALIAS[mine.code];
  if (al) { const n = norm(al), low = deaccent(al).toLowerCase();
    const hit = cand.filter(c => (n && c.key === n) || c.club.toLowerCase() === low);
    const any = hit.length ? hit : [...FILE.values()].filter(c => (n && c.key === n) || c.club.toLowerCase() === low).filter(c => !B_TEAM.test(c.club));
    if (any.length) return any.sort((a, b) => (mine.leagues.includes(b.league) ? 1 : 0) - (mine.leagues.includes(a.league) ? 1 : 0) || b.best - a.best)[0]; }
  /* a name match outside this country's leagues is how Barcelona once landed on Barcelona SC
     (Guayaquil), so every candidate after the alias has to come from a league of ours */
  const here = c => mine.leagues.includes(c.league);
  const exact = cand.filter(c => c.key === mine.key && here(c));
  if (exact.length) return exact.sort((a, b) => (mine.leagues.indexOf(a.league)) - (mine.leagues.indexOf(b.league)) || b.n - a.n)[0];
  const sub = cand.filter(c => here(c) && fits(mine.key, c.key));
  if (sub.length) { sub.sort((a, b) => a.key.length - b.key.length || b.best - a.best); return sub[0]; }
  return null;
}
const PAIR = new Map();   // file "league||club" -> my club
const report = [];
for (const mine of MY_CLUBS) {
  const f = pickClub(mine);
  if (f) { const k = (f.league || '?') + '||' + f.club; if (!PAIR.has(k)) PAIR.set(k, mine);
    const avg = Math.round(f.sum / f.n), sus = Math.abs(avg - mine.str) > 12 ? '  ?? ' + mine.str : '';
    report.push((sus ? '~' : ' ') + mine.lg + ' d' + mine.div + ' ' + mine.code.padEnd(5) + mine.name.padEnd(24) +
      '→ ' + f.club.padEnd(24) + ' [' + f.league + '] ' + f.n + 'p avg' + avg + sus); }
  else report.push('! ' + mine.lg + ' d' + mine.div + ' ' + mine.code.padEnd(5) + mine.name.padEnd(26) + '→ NOTHING IN THE FILE');
}

/* ---------------------------------------------------------------- --expand
   The file carries whole leagues db.js never heard of. --expand turns each of them into a country:
   clubs come from the file verbatim (its name, its membership, its size), a club's strength is the
   mean of the best eleven outfielders the file gives it, and capacity and net worth are derived from
   that strength because the file carries neither.

   One rung or two: the engine's world model is "your division and the one next to it". A country
   whose second tier is not in the file therefore gets one rung and no promotion or relegation —
   there is nothing to move between. The real rule goes into a comment on the league so whoever adds
   the second tier later knows what to wire. Where the file has both rungs (League One and League
   Two) the ladder is live, with the real EFL numbers: four down, two plus the play-off winner up.

   Nothing here is invented football: the club lists are the file's, the ratings are the file's, and
   the only judgement calls are which leagues to add and what the derived numbers stand for. */
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
const hashOf = str => { let x = 2166136261; for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; } return x; };
const Q = String.fromCharCode(39);

const EXPAND = [
  { code:'EFL', name:'English Football League', confed:'UEFA',
    note:'Tiers three and four of England. Both are in the file, so promotion and relegation between them run for real: four drop out of League One, two plus the play-off winner come up from League Two, and the final is at Wembley. The fourth club into League Two comes from the National League in real life, which is not in this build, so the engine rebalances the size drift here.',
    divs:[ { csv:'EFL League One', code:'FL1', name:'EFL League One', cup:'FA Cup' },
           { csv:'EFL League Two', code:'FL2', name:'EFL League Two', cup:'FA Cup' } ],
    promotion:{ auto:2, playoff:[3,4,5,6], legs:1, final:'single', finalName:'Play-off Final at Wembley' },
    relegation:{ auto:4, playoff:null } },
  { code:'DE3', name:'Germany — 3. Liga', confed:'UEFA',
    note:'Three clubs go up to the 2. Bundesliga (two automatic, the third through a tie against its 16th) and four drop to the Regionalliga, which is regional and not one league. Neither rung is in this build, so 3. Liga plays for the DFB-Pokal and for pride.',
    divs:[ { csv:'3. Liga', code:'BL3', name:'3. Liga', cup:'DFB-Pokal' } ],
    promotion:{ auto:0, playoff:null }, relegation:{ auto:0, playoff:null } },
  { code:'ARG', name:'Argentina', confed:'CONMEBOL',
    note:'Liga Profesional: 30 clubs, and promotion/relegation is decided on an annual average table rather than the season you just played — two down to Primera Nacional, two up. No second rung here.',
    divs:[ { csv:'LPF', code:'LPF', name:'Liga Profesional', cup:'Copa Argentina' } ],
    promotion:{ auto:0, playoff:null }, relegation:{ auto:0, playoff:null } },
  { code:'USA', name:'United States', confed:'CONCACAF',
    note:'MLS is closed: no promotion, no relegation, and the champion is decided by a post-season knockout. This build crowns the top of the regular table, which is the Supporters Shield.',
    divs:[ { csv:'MLS', code:'MLS', name:'Major League Soccer', cup:'U.S. Open Cup' } ],
    promotion:{ auto:0, playoff:null }, relegation:{ auto:0, playoff:null } },
  { code:'MEX', name:'Mexico', confed:'CONCACAF',
    note:'Liga MX has been closed since 2020 and splits the season into Apertura and Clausura. Both are merged into one table here; the Campeón de Campeones is the winner-against-winner tie.',
    divs:[ { csv:'Liga BBVA MX', code:'LIX', name:'Liga MX', cup:'Campeón de Campeones' } ],
    promotion:{ auto:0, playoff:null }, relegation:{ auto:0, playoff:null } },
  { code:'KSA', name:'Saudi Arabia', confed:'AFC',
    note:'Eighteen clubs, three relegated to the Yelo League, two up. No second rung in this build, so the table decides the continental places and the King Cup decides the silverware.',
    divs:[ { csv:'ROSHN Saudi League', code:'SPL', name:'Saudi Pro League', cup:'King Cup' } ],
    promotion:{ auto:0, playoff:null }, relegation:{ auto:0, playoff:null } },
  { code:'NED', name:'Netherlands', confed:'UEFA',
    note:'Eredivisie: 18 clubs, last place down, 17th a tie against an Eerste Divisie side, two up. The Keuken Kampioen Divisie is not in this build.',
    divs:[ { csv:'Eredivisie', code:'EDV', name:'Eredivisie', cup:'KNVB Beker' } ],
    promotion:{ auto:0, playoff:null }, relegation:{ auto:0, playoff:null } },
  { code:'POR', name:'Portugal', confed:'UEFA',
    note:'Liga Portugal: 18 clubs, bottom two down, the top two of Liga Portugal 2 up.',
    divs:[ { csv:'Liga Portugal', code:'LIP', name:'Liga Portugal', cup:'Taça de Portugal' } ],
    promotion:{ auto:0, playoff:null }, relegation:{ auto:0, playoff:null } },
  { code:'TUR', name:'Türkiye', confed:'UEFA',
    note:'Süper Lig: 18 clubs, and the number relegated has moved between three and four in recent seasons. Bottom three here.',
    divs:[ { csv:'Trendyol Süper Lig', code:'SLI', name:'Süper Lig', cup:'Turkish Cup' } ],
    promotion:{ auto:0, playoff:null }, relegation:{ auto:0, playoff:null } },
  { code:'POL', name:'Poland', confed:'UEFA',
    note:'Ekstraklasa: 18 clubs, bottom three down, the top two of I liga up.',
    divs:[ { csv:'Ekstraklasa', code:'EKS', name:'Ekstraklasa', cup:'Polish Cup' } ],
    promotion:{ auto:0, playoff:null }, relegation:{ auto:0, playoff:null } },
  { code:'BEL', name:'Belgium', confed:'UEFA',
    note:'Eighteen clubs in the file. The Pro League has run championship and relegation play-off groups in recent seasons and the format keeps moving; the Challenger Pro League half of the swap is not in this build.',
    divs:[ { csv:'1A Pro League', code:'JUP', name:'Belgian Pro League', cup:'Belgian Cup' } ],
    promotion:{ auto:0, playoff:null }, relegation:{ auto:0, playoff:null } },
  { code:'DEN', name:'Denmark', confed:'UEFA',
    note:'Superliga: 12 clubs. The file labels the competition by its broadcast division; recent seasons relegate the bottom two with a tie for the 10th/11th place clubs.',
    divs:[ { csv:'Metropolitan Division', code:'SUP', name:'Danish Superliga', cup:'DBU Pokalen' } ],
    promotion:{ auto:0, playoff:null }, relegation:{ auto:0, playoff:null } },
  { code:'ROU', name:'Romania', confed:'UEFA',
    note:'Liga I: 16 clubs, then a split into a championship round and a relegation round, which this engine plays as one table.',
    divs:[ { csv:'SUPERLIGA', code:'L1R', name:'Liga I', cup:'Cupa României' } ],
    promotion:{ auto:0, playoff:null }, relegation:{ auto:0, playoff:null } },
  { code:'SCO', name:'Scotland', confed:'UEFA',
    note:'Premiership: 12 clubs, 33 games then a split; the bottom club goes down and the 11th plays the Championship winner.',
    divs:[ { csv:'Scottish Premiership', code:'SPR', name:'Scottish Premiership', cup:'Scottish Cup' } ],
    promotion:{ auto:0, playoff:null }, relegation:{ auto:0, playoff:null } },
  { code:'SUI', name:'Switzerland', confed:'UEFA',
    note:'Super League: 12 clubs from 2025-26, last place in a relegation tie against the Challenge League runner-up.',
    divs:[ { csv:'Brack Super League', code:'SSL', name:'Swiss Super League', cup:'Swiss Cup' } ],
    promotion:{ auto:0, playoff:null }, relegation:{ auto:0, playoff:null } },
  { code:'AUT', name:'Austria', confed:'UEFA',
    note:'Bundesliga: 12 clubs, last down, the 2. Liga champion up.',
    divs:[ { csv:'Ö. Bundesliga', code:'OBS', name:'Austrian Bundesliga', cup:'OFB Cup' } ],
    promotion:{ auto:0, playoff:null }, relegation:{ auto:0, playoff:null } },
  { code:'NOR', name:'Norway', confed:'UEFA',
    note:'Eliteserien: 16 clubs, 15th and 16th down, 14th a tie against a 1. divisjon side.',
    divs:[ { csv:'Eliteserien', code:'ELI', name:'Eliteserien', cup:'Norwegian Cup' } ],
    promotion:{ auto:0, playoff:null }, relegation:{ auto:0, playoff:null } },
  { code:'SWE', name:'Sweden', confed:'UEFA',
    note:'Allsvenskan: 16 clubs, 15th and 16th down, 14th a tie; two come up from Superettan.',
    divs:[ { csv:'Allsvenskan', code:'ALL', name:'Allsvenskan', cup:'Svenska Cupen' } ],
    promotion:{ auto:0, playoff:null }, relegation:{ auto:0, playoff:null } },
  { code:'KOR', name:'South Korea', confed:'AFC',
    note:'K League 1: 12 clubs, last down, 11th a tie against K League 2, and the season splits into groups after round 33.',
    divs:[ { csv:'K League 1', code:'K1L', name:'K League 1', cup:'Korean FA Cup' } ],
    promotion:{ auto:0, playoff:null }, relegation:{ auto:0, playoff:null } },
  { code:'CHN', name:'China PR', confed:'AFC',
    note:'Chinese Super League: 16 clubs, two down and two up from China League One.',
    divs:[ { csv:'CSL', code:'CSL', name:'Chinese Super League', cup:'Chinese FA Cup' } ],
    promotion:{ auto:0, playoff:null }, relegation:{ auto:0, playoff:null } },
  { code:'IND', name:'India', confed:'AFC',
    note:'The ISL has been closed since 2023-24, with the promotion route to the I-League suspended, so nothing moves here either.',
    divs:[ { csv:'ISL', code:'ISL', name:'Indian Super League', cup:'Indian Super Cup' } ],
    promotion:{ auto:0, playoff:null }, relegation:{ auto:0, playoff:null } },
  { code:'AUS', name:'Australia', confed:'AFC',
    note:'A-League Men is a closed franchise league: no promotion, no relegation, and the champion comes out of the finals series.',
    divs:[ { csv:'Isuzu UTE A League', code:'ALM', name:'A-League Men', cup:'Australia Cup' } ],
    promotion:{ auto:0, playoff:null }, relegation:{ auto:0, playoff:null } },
  { code:'IRL', name:'Ireland', confed:'UEFA',
    note:'Premier Division: 10 clubs, bottom club down, 9th a tie against the First Division winner.',
    divs:[ { csv:'SSE Airtricity Men' + Q + 's Premier Division', code:'PRI', name:'League of Ireland Premier Division', cup:'FAI Cup' } ],
    promotion:{ auto:0, playoff:null }, relegation:{ auto:0, playoff:null } }
];

const NEW_LEAGUES = [];
function buildExpansion() {
  const usedCodes = new Set(MY_CLUBS.map(c => c.code));
  const ovrs = new Map();                       // file league + club -> the overalls it lists
  for (const r of body) {
    const club = deaccent(r[idx.club] || '').trim(); if (!club) continue;
    const league = deaccent(r[idx.league] || '').trim().toLowerCase();
    if (posOf(r[idx.pos], idx.alt >= 0 ? r[idx.alt] : '') === 'GK') continue;
    const k = league + '||' + club;
    if (!ovrs.has(k)) ovrs.set(k, []);
    ovrs.get(k).push(num(r[idx.ovr], 60));
  }
  const rawNames = new Map();                   // the file prints the name; keep its accents
  for (const r of body) { const c = String(r[idx.club] || '').trim(); if (!c) continue;
    const k = deaccent(c).trim(); if (!rawNames.has(k)) rawNames.set(k, c); }

  const made = [], SKIP = [];
  for (const E of EXPAND) {
    const out = { code:E.code, name:E.name, confed:E.confed, note:E.note, divs:[], promotion:E.promotion, relegation:E.relegation, tv:0.5 };
    E.divs.forEach((D, di) => {
      const lkey = deaccent(D.csv).toLowerCase();
      const list = (BY_LEAGUE.get(lkey) || []).slice().sort((a, b) => b.best - a.best);
      const clubs = [], added = [], PENDING = [];
      /* the file lists some Argentine clubs twice under two spellings and assigns each player to one
         of them. Whichever spelling carries the bigger squad is the club; the other one's men move
         across to it, so the league has 30 sides and not 32 with two halves of Gimnasia in it. */
      const MERGED = { ARG: [['gimnasia', 'atletico gimnasia y esgrima'],
                             ['asociacion atletica estudiantes', 'estudiantes']] };
      const canon = new Map();
      const has = (small, big) => small.split(' ').every(t => big.split(' ').includes(t));
      const find = key => list.find(c => c.key === key) || list.find(c => has(key, c.key) || has(c.key, key));
      for (const [x, y] of (MERGED[E.code] || [])) {
        const a1 = find(x), b1 = find(y);
        if (a1 && b1 && a1 !== b1) canon.set((a1.n >= b1.n ? y : x), (a1.n >= b1.n ? x : y));
      }
      const into = new Map();
      for (const fc of list) { const to = canon.get(fc.key); if (to) into.set(fc.key, to); }
      for (const fc of list) {
        const fkey = (fc.league || '?') + '||' + fc.club;
        const keepKey = into.get(fc.key);
        if (keepKey) { PENDING.push([fkey, keepKey, fc.club]); continue; }   /* wired up once the real club exists */
        if (PAIR.has(fkey)) { SKIP.push([E.code, fc.club, 'already claimed as ' + PAIR.get(fkey).lg + '/' + PAIR.get(fkey).code]); continue; }
        const base = norm(fc.club).replace(/\s*(b|ii|iii|aficionado|fortuna|castilla|primevera|reserves|u19|u21|u23|youth)$/i, '');
        if (B_TEAM.test(fc.club) && list.some(x => norm(x.club) === base && x.club !== fc.club)) {
          SKIP.push([E.code, fc.club, 'the reserve side of ' + base]); continue; }
        /* Only two kinds of duplicate are real here: the same club twice inside one country's list
           (the file splits LPF's Gimnasia across two spellings), and a club db.js already carries in
           a division of the same country. Anything looser is a false positive that costs a real
           team — Rangers is not Queens Park Rangers, Sporting CP is not Sporting Gijón, and Inter
           Miami is not Inter, which is exactly the swap this file punished us for once before. */
        const twin = added.find(a => a.key === fc.key);
        if (twin) { SKIP.push([E.code, fc.club, 'the same club as ' + twin.name + ', listed twice']); continue; }
        const listed = MY_CLUBS.find(m => m.key === fc.key && m.lg === E.code);
        if (listed) { SKIP.push([E.code, fc.club, 'db.js already lists it as ' + listed.code]); continue; }
        const name = rawNames.get(fc.club) || fc.club;
        let code = guessCode(name) || deaccent(name).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
        if (!code || code.length < 3) code = ((code || 'XXX') + 'XXX').slice(0, 3);
        for (let guard = 0; usedCodes.has(code); guard++) {
          code = deaccent(name).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) +
                 String.fromCharCode(65 + ((hashOf(name) + guard) % 26)) + (guard % 10);
          if (guard > 400) { code = 'X' + usedCodes.size; break; }        /* never hand out a twin */
        }
        usedCodes.add(code);
        const o = (ovrs.get(fkey) || []).sort((a, b) => b - a);
        const top = o.slice(0, 11);
        const str = Math.round(clampN(top.reduce((a, b) => a + b, 0) / Math.max(1, top.length), 42, 92));
        const cap = Math.round(clampN((6800 + (str - 50) * 1320) * (0.78 + (hashOf(name) % 46) / 100), 1200, 82000));
        const netwV = clampN(0.02 + Math.pow(clampN((str - 50) / 42, 0, 1), 2.3) * 3.1, 0.1, 6.2);
        const netw = (netwV < 1 ? netwV.toFixed(2) : netwV.toFixed(1)) + 'B';   /* never round a small club down to nothing */
        const mine = { name, code, str, key: norm(name), lg: E.code, div: di,
                       leagues: [lkey], derived: true };
        MY_CLUBS.push(mine);
        MY_BY_KEY.set(norm(name), (MY_BY_KEY.get(norm(name)) || []).concat([mine]));
        PAIR.set(fkey, mine);
        added.push({ key: fc.key, name });
        made.push({ lg: E.code, div: di, code, name, str, n: o.length, key: fc.key, mine });
        clubs.push(name + '|' + code + '|' + str + '|' + cap + '|' + netw);
      }
      for (const [fkey, keepKey, label] of PENDING) {
        const keep = list.find(c => c.key === keepKey);
        const target = keep && PAIR.get((keep.league || '?') + '||' + keep.club);
        if (target) { PAIR.set(fkey, target); SKIP.push([E.code, label, 'merged into ' + keep.club + ' (the file splits the club in two)']); }
      }
      if (!clubs.length) return;
      const strs = clubs.map(c => +c.split('|')[2]).sort((a, b) => a - b);
      const med = strs[strs.length >> 1];
      out.tv = Math.round(clampN(0.30 + (med - 56) / 40, 0.28, 0.95) * 100) / 100;
      out.divs.push({ code: D.code, name: D.name, cup: D.cup, size: clubs.length,
                      rep: Math.round(clampN(0.22 + (med - 56) / 34, 0.2, 0.97) * 100) / 100, clubs });
    });
    if (out.divs.length) NEW_LEAGUES.push(out);
    else console.log('expand    skipped ' + E.name + ': nothing in the file matched ' + E.divs.map(d => d.csv).join('/'));
  }
  if (SKIP.length) { console.log('expand    ' + SKIP.length + ' file clubs left out on purpose:');
    SKIP.forEach(x => console.log('          ' + x[0].padEnd(4) + x[1].padEnd(26) + '— ' + x[2])); }
  return made;
}
const MADE_CLUBS = flags.has('--expand') ? buildExpansion() : [];
if (MADE_CLUBS.length) {
  const byLg = {};
  MADE_CLUBS.forEach(c => { (byLg[c.lg] = byLg[c.lg] || []).push(c); });
  console.log('expand    ' + NEW_LEAGUES.length + ' new countries, ' + MADE_CLUBS.length + ' clubs read straight from the file');
  Object.keys(byLg).forEach(k => console.log('          ' + k.padEnd(4) + byLg[k].length + ' clubs  ·  str ' +
    Math.min.apply(null, byLg[k].map(c => c.str)) + '–' + Math.max.apply(null, byLg[k].map(c => c.str))));
}

/* ---------------------------------------------------------------- build player rows */
const WEIGHTS = {
  ST: { pace:.18, shooting:.30, passing:.10, dribbling:.16, defending:.02, physical:.24 },
  LW: { pace:.30, shooting:.18, passing:.14, dribbling:.26, defending:.02, physical:.10 },
  RW: { pace:.30, shooting:.18, passing:.14, dribbling:.26, defending:.02, physical:.10 },
  CAM:{ pace:.18, shooting:.20, passing:.28, dribbling:.22, defending:.04, physical:.08 },
  CM: { pace:.14, shooting:.14, passing:.28, dribbling:.18, defending:.14, physical:.12 },
  CDM:{ pace:.10, shooting:.08, passing:.24, dribbling:.14, defending:.28, physical:.16 },
  LB: { pace:.24, shooting:.06, passing:.20, dribbling:.16, defending:.22, physical:.12 },
  RB: { pace:.24, shooting:.06, passing:.20, dribbling:.16, defending:.22, physical:.12 },
  CB: { pace:.14, shooting:.06, passing:.14, dribbling:.06, defending:.38, physical:.22 },
  GK: { pace:.05, shooting:.02, passing:.13, dribbling:.05, defending:.60, physical:.15 }
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function myOvr(attrs, pos) {
  const w = WEIGHTS[pos] || WEIGHTS.CM; let t = 0;
  for (const k in w) t += (attrs[k] || 60) * w[k];
  return Math.round(clamp(t, 30, 99));
}

let offCount = 0, shiftSum = 0, shiftN = 0;
const NAT_BEST = new Map();   // every nation in the file, with the best player it fields
for (const r of body) {
  const raw = (r[idx.nat] || '').trim(); if (!raw) continue;
  const code = natOf(raw) || guessCode(raw); if (!code) continue;
  const o = num(r[idx.ovr], 0); if (!o) continue;
  const cur = NAT_BEST.get(code);
  if (!cur || o > cur.best) NAT_BEST.set(code, { best: o, name: raw });
}
const LADDER = [[88, 86], [85, 80], [82, 75], [79, 70], [76, 65], [73, 60], [70, 55], [0, 50]];
function natStrength(best) { for (const [t, v] of LADDER) if (best >= t) return v; return 50; }
const byMine = new Map();
for (const r of body) {
  const league = deaccent(r[idx.league] || '').trim().toLowerCase();
  const fk = (league || '?') + '||' + deaccent(r[idx.club] || '').trim();
  const mine = PAIR.get(fk); if (!mine) continue;
  const ovr = num(r[idx.ovr], 0); if (!ovr) continue;
  const pos = posOf(r[idx.pos], idx.alt >= 0 ? r[idx.alt] : '');
  if (pos === 'GK') continue;                                  // no goalkeepers to play as yet
  const nat = natOf(idx.nat >= 0 ? r[idx.nat] : '') || guessCode(r[idx.nat]);
  const attrs = { pace: num(r[idx.pace], 0), shooting: num(r[idx.shooting], 0), passing: num(r[idx.passing], 0),
                  dribbling: num(r[idx.dribbling], 0), defending: num(r[idx.defending], 0), physical: num(r[idx.physical], 0) };
  const have = attrs.pace && attrs.shooting && attrs.passing && attrs.dribbling && attrs.defending && attrs.physical;
  let A = null;
  if (have) {
    /* keep the file's *profile* — the gaps between pace and defending are the player — but move the
       whole set onto the level our OVR formula reads as the same overall, so a takeover never jumps */
    const raw = { pace: clamp(attrs.pace, 20, 99), shooting: clamp(attrs.shooting, 20, 99), passing: clamp(attrs.passing, 20, 99),
                  dribbling: clamp(attrs.dribbling, 20, 99), defending: clamp(attrs.defending, 20, 99), physical: clamp(attrs.physical, 20, 99) };
    const shift = clamp(ovr, 40, 97) - myOvr(raw, pos);
    shiftSum += shift; shiftN++;
    A = {}; for (const k in raw) A[k] = clamp(raw[k] + shift, 20, 99);
    if (Math.abs(myOvr(A, pos) - ovr) > 1) offCount++;
  }
  /* the number on the row is what his six add up to — which is the file's overall on every row except
     the ones already pinned at 99, where the shift had nowhere to go. Better one player 2 points
     short than a career whose OVR and attributes disagree the moment the game recalculates */
  const o = clamp(A ? myOvr(A, pos) : ovr, 40, 99);

  const age = ageOf(r) || (o >= 85 ? 27 : 24);
  const nm = displayName(r);
  const rec = { name: nm, nat: nat || '???', pos, ovr: o, fileOvr: ovr, age: clamp(age || 24, 16, 40), attrs: A, mine };
  if (!byMine.has(mine.code)) byMine.set(mine.code, []);
  byMine.get(mine.code).push(rec);
}
const kept = [];
for (const list of byMine.values()) {
  list.sort((a, b) => b.ovr - a.ovr);
  const seen = new Set();
  for (const p of list) { const k = p.name.toLowerCase(); if (seen.has(k)) continue; seen.add(k); kept.push(p);
    if (SQUAD > 0 && seen.size >= SQUAD) break; }
}
kept.sort((a, b) => b.ovr - a.ovr);
/* one name has to mean one player: the roster view, the search box and a takeover all key off it,
   so a second Sergio Arribas at another club is dropped rather than made unique by a suffix */
{ const seen = new Set(); const out = []; let dup = 0;
  for (const p of kept) { const k = p.name.toLowerCase(); if (seen.has(k)) { dup++; continue; } seen.add(k); out.push(p); }
  kept.length = 0; kept.push(...out); if (dup) console.log('dropped ' + dup + ' rows whose name another, better-paid player already owns'); }
function esc(x) {
  return String(x).split('\\').join('\\\\').split("'").join("\\'");   // names like O\'Reilly must not be able to close the generated string
}
const rowText = p => [esc(p.name), p.nat, p.pos, p.ovr, p.age, p.mine.code,
  p.attrs ? [p.attrs.pace, p.attrs.shooting, p.attrs.passing, p.attrs.dribbling, p.attrs.defending, p.attrs.physical].join(',') : ''].join('|');
const rowsOut = kept.map(p => "    '" + rowText(p) + "'");

/* ---------------------------------------------------------------- report */
const matched = report.filter(l => l[0] !== '!').length;
console.log('file      ' + path.basename(file) + '  ·  ' + (rows.length - 1) + (rows.length - 1 === 1 ? ' row' : ' rows') + '  ·  ' +
  (excluded ? (excluded === 1 ? 'one women\u2019s row excluded' : excluded + ' women\u2019s rows excluded') : 'no gender split applied') +
  '  ·  this game covers the men\u2019s divisions only');
console.log('clubs     ' + (matched + MADE_CLUBS.length) + '/' + MY_CLUBS.length + ' of the universe carry players (' + matched + ' matched to db.js clubs, ' + MADE_CLUBS.length + ' new from --expand)');
console.log('players   ' + kept.length + ' rows (' + byMine.size + ' squads, ' + (SQUAD > 0 ? 'cap ' + SQUAD + ' outfielders each' : 'every outfielder the file lists') + ')' +
  '  ·  ' + kept.filter(p => p.attrs).length + ' with real attribute values');
if (shiftN) console.log('ovr       mean-locked onto the file\u2019s overall \u2014 our own position weights alone would have read ' +
  (-shiftSum / shiftN).toFixed(1) + ' points off, so a takeover never jumps when the game recomputes');
const knownNat = new Set((DB.nations || []).map(r => String(r).split('|')[0]));
const NEW_NATS = [...NAT_BEST.entries()].filter(([c]) => !knownNat.has(c))
  .map(([code, v]) => ({ code, name: prettyName(v.name), str: natStrength(v.best), confed: confedOf(v.name) }))
  .sort((a, b) => b.str - a.str || a.code.localeCompare(b.code));
if (NEW_NATS.length) console.log('nations   ' + NEW_NATS.length + ' not in db.js yet, added from the file: ' +
  NEW_NATS.slice(0, 14).map(n => n.code + ' ' + n.str).join(', ') + (NEW_NATS.length > 14 ? ' …' : ''));
const nats = kept.filter(p => p.nat === '???');
if (nats.length) console.log('note      ' + nats.length + ' rows had an unrecognised nationality — they are skipped by --apply');
const squadSizes = [...byMine.values()].map(l => l.length).sort((a, b) => a - b);
console.log('squads    min ' + squadSizes[0] + ' · median ' + squadSizes[Math.floor(squadSizes.length / 2)] + ' · max ' + squadSizes[squadSizes.length - 1]);
console.log('attrs     ' + (offCount ? offCount + ' row(s) had an attribute pinned at 99 and keep the rating their six actually add up to' : 'every row sits within 1 point of its own overall after mean-locking'));
if (flags.has('--strengths')) {
  console.log('\nclub strength: my db value vs the average of the imported best eleven');
  const rowsS = [];
  for (const mine of MY_CLUBS) {
    const l = (byMine.get(mine.code) || []).slice(0, 11);
    if (l.length < 7) continue;
    const avg = Math.round(l.reduce((a, p) => a + (p.fileOvr || p.ovr), 0) / l.length);
    rowsS.push([mine.str - avg, mine.code, mine.name, mine.str, avg]);
  }
  rowsS.sort((a, b) => Math.abs(b[0]) - Math.abs(a[0]));
  console.log('  biggest gaps: ' + rowsS.slice(0, 12).map(r => r[1] + ' ' + r[3] + '→' + r[4]).join(', '));
  const big = rowsS.filter(r => Math.abs(r[0]) > 5).length;
  console.log('  ' + big + ' of ' + rowsS.length + ' clubs sit more than 5 out. db.js keeps its own strengths unless you change them deliberately.');
}
if (opt('report', '')) { fs.writeFileSync(opt('report'), report.join('\n') + '\n'); console.log('\npairing table → ' + opt('report')); }
if (flags.has('--apply')) {
  const good = kept.filter(p => p.nat !== '???');
  const goodRows = good.map(p => "    '" + rowText(p) + "'");
  const body2 = "  players: [ /* " + goodRows.length + " rows imported from " + path.basename(file) +
    " on " + new Date().toISOString().slice(0, 10) + " — men's rows only, " + matched + " of 192 clubs covered */\n" +
    goodRows.map((l, i) => l + (i < goodRows.length - 1 ? ',' : '')).join('\n') + "\n  ],";
  let src = fs.readFileSync(dbPath, 'utf8');
  const i = src.search(/\n {2}players: \[/), j = src.indexOf("\n  ],", i);
  if (i < 0 || j < 0) { console.log('\n--apply aborted: could not find the players array in db.js'); process.exit(2); }
  src = src.slice(0, i + 1) + body2 + src.slice(j + 5);
  if (NEW_NATS.length) {
    const ni = src.search(/\n {2}nations: \[/), nj = src.indexOf('\n  ],', ni);
    if (ni < 0 || nj < 0) { console.log('\n--apply aborted: could not find the nations array in db.js'); process.exit(2); }
    const body3 = src.slice(ni + 1, nj).replace(/,\s*$/, '');
    const add = NEW_NATS.map(n => "    '" + n.code + "|" + esc(n.name) + "|" + n.str + "|" + n.confed + "'");
    src = src.slice(0, ni + 1) + body3 + ',\n' + add.join(',\n') + src.slice(nj);
  }
  if (NEW_LEAGUES.length) {
    const li = src.search(/\n {2}leagues: \[/), lj = src.indexOf('\n  ],', li);
    if (li < 0 || lj < 0) { console.log('\n--apply aborted: could not find the leagues array in db.js'); process.exit(2); }
    const sq = x => String(x).split('\\').join('\\\\').split(Q).join('\\' + Q);
    const ser = o => '{' + Object.keys(o).map(k => {
      const v = o[k];
      if (v === null || v === undefined) return k + ':null';
      if (Array.isArray(v)) return k + ':[' + v.join(',') + ']';
      if (typeof v === 'number') return k + ':' + v;
      return k + ':' + Q + sq(v) + Q;
    }).join(', ') + '}';
    const txt = NEW_LEAGUES.map(L => {
      const divs = L.divs.map(D => '        { code:' + Q + sq(D.code) + Q + ', name:' + Q + sq(D.name) + Q +
        ', rep:' + D.rep.toFixed(2) + ', size:' + D.size + ', cup:' + Q + sq(D.cup) + Q + ',\n          clubs: [\n            ' +
        D.clubs.map(c => Q + sq(c) + Q).join(', ') + ' ] }').join(',\n');
      return '    { code:' + Q + sq(L.code) + Q + ', name:' + Q + sq(L.name) + Q + ', confed:' + Q + sq(L.confed) + Q +
        ', tv:' + L.tv.toFixed(2) + ',\n      /* added by tools/import-players.js --expand from ' + path.basename(file) +
        '. Strength, capacity and net worth are derived from the squad list. ' + sq(L.note) + ' */\n' +
        '      divs: [\n' + divs + '\n      ],\n' +
        '      promotion: ' + ser(L.promotion) + ',\n' +
        '      relegation: ' + ser(L.relegation) + ' }';
    }).join(',\n');
    src = src.slice(0, lj).replace(/,\s*$/, '') + ',\n' + txt + src.slice(lj);
  }
  fs.writeFileSync(dbPath, src);   // players, nations, leagues — one write, after every edit
  console.log('\napplied ' + goodRows.length + ' player rows' + (NEW_NATS.length ? ' and ' + NEW_NATS.length + ' nations' : '') + ' to db.js (' + Math.round(src.length / 1024) + ' KB) — run node tools/validate-db.js');
} else console.log('\nnothing written. --apply rewrites the players array in db.js; --report=map.txt shows every club pairing.');
