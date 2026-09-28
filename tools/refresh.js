/* tools/refresh.js — build a Football Career 27 data pack from a live Wikipedia season article.
   Run it where there is internet (Node 18+, no npm install needed):

     node tools/refresh.js --search="2026 Campeonato Brasileiro Serie A" --out=packs/live-brasil.js
     node tools/refresh.js --title="2025 Campeonato Brasileiro Série A" --print-pack
     node tools/refresh.js --fixture=tools/fixtures/wp-brasileirao.txt --print-pack     (offline)
     node tools/refresh.js --search="..." --dump=/tmp/d                                  (show its work)

   Why these choices, all of them learned by probing the live API:
   - Titles move and get renamed, so --search resolves through list=search and prints what it picked
     rather than trusting a hardcoded page name.
   - action=parse&prop=sections is deprecated, so the tool never asks for a section index: it reads
     the whole wikitext once with prop=revisions and cuts sections out itself.
   - Wikipedia has clubs, cities, stadiums, capacities, kit makers, managers and the league table.
     It has no player ratings. So the pack ships that scaffolding, derives each club's `str` from the
     points in the table (a mapping of points, not a scouting opinion), and leaves players empty for
     the engine to generate — the same path a club with no rows already takes.
   - --dump writes the wikitext, the sections it saw, the clubs it parsed and the pack it built, so a
     bad parse is four files you can read instead of a silently short pack. Read 02-clubs.json first.

   Licence: Wikipedia text is CC BY-SA 4.0. The attribution and history links are written into the
   pack's own note, so they travel with the file. FBref/Sofascore/Transfermarkt forbid scraping; this
   tool does not use them and neither should you. */
'use strict';
const fs = require('fs');
const path = require('path');
const UA = 'FC27-refresh/1.0 (local tool that rebuilds an offline game data pack from Wikipedia)';
const API = 'https://en.wikipedia.org/w/api.php';
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const has = (k) => process.argv.includes('--' + k);
const log = (...x) => console.log(...x);

/* ---------- MediaWiki markup → plain text ----------
   A template is not always noise: {{lang|pt|Grêmio}} IS the club's name and {{sort|78231|78,231}} is
   the capacity, so unwrap the value-carrying ones and only then delete the rest. Innermost first. */
function matchEnd(t, i) {                        /* index just past the {{ or [[ opened at i */
  const open = t.slice(i, i + 2), close = open === '{{' ? '}}' : ']]';
  let d = 0;
  for (let j = i; j < t.length; j++) {
    if (t.startsWith(open, j)) { d++; j++; }                      /* skip both chars of the pair */
    else if (t.startsWith(close, j)) { d--; if (!d) return j + 2; j++; }
  }
  return t.length;                                                /* unbalanced: take the rest, as a browser does */
}
function splitArgs(inner) {                       /* depth-0 pipes only: nested {{flag|X}} stays whole */
  const out = []; let d = 0, cur = '';
  for (let i = 0; i < inner.length; i++) {
    const two = inner.slice(i, i + 2);
    if (two === '{{' || two === '[[') { d++; cur += two; i++; continue; }
    if (d > 0 && (two === '}}' || two === ']]')) { d--; cur += two; i++; continue; }
    if (d === 0 && inner[i] === '|') { out.push(cur); cur = ''; continue; }
    cur += inner[i];
  }
  out.push(cur);
  return out.map((x) => x.trim());
}
const KEEP = { sort: 2, lang: 2, abbr: 2, abbrelation: 2, selflink: 1, nowrap: 1, small: 1, big: 1, tiny: 1,
  center: 1, left: 1, right: 1, efn: 1, notetag: 1, note: 1, val: 1, nts: 1, main: 2, link: 1, cvt: 1,
  convert: 1, harvnb: 1, harv: 1, bdfutinfo: 1 };
function unwrapOne(inner) {
  const args0 = splitArgs(inner);
  /* `{{#if:yes|a|b}}` and `{{lang|pt|X}}` differ: the colon form carries the first argument inside the
     name slot, so split it back out before the name is compared — otherwise every #if branch is lost. */
  const colon = args0[0] ? args0[0].indexOf(':') : -1;
  const args = colon > 0 ? [args0[0].slice(0, colon), args0[0].slice(colon + 1), ...args0.slice(1)] : args0;
  const name = (args[0] || '').toLowerCase().replace(/_/g, ' ').trim();
  const pos = args.slice(1).filter((a) => a && !/^[^=|]+\s*=/.test(a));    /* named params are not branches */
  if (name === '#if' || name === '#ifexist') return String(pos[0] || '').trim() ? (pos[1] || '') : (pos[2] || '');
  if (/^flag(icon|country|-plus|link)?$/.test(name)) return '';
  if (name in KEEP) { const k = KEEP[name]; return pos[k - 1] != null ? pos[k - 1] : ''; }
  return '';
}
function unwrap(t) {
  for (let guard = 0; guard < 400; guard++) {
    const i = t.indexOf('{{');
    if (i < 0) return t;
    const end = matchEnd(t, i);
    const inner = t.slice(i + 2, Math.max(i + 2, end - 2));
    const j = inner.indexOf('{{');
    if (j >= 0) { const si = i + 2 + j, se = matchEnd(t, si); t = t.slice(0, si) + unwrapOne(t.slice(si + 2, se - 2)) + t.slice(se); continue; }
    t = t.slice(0, i) + unwrapOne(inner) + t.slice(end);
  }
  return t;
}
const plain = (x) => String(x == null ? '' : x).replace(/'''?/g, '').replace(/\s+/g, ' ').trim();
function clean(s) {
  if (s == null) return '';
  let t = String(s);
  t = t.replace(/<!--[\s\S]*?-->/g, '');
  t = t.replace(/<ref\b[^>]*\/>/g, '').replace(/<ref\b[\s\S]*?<\/ref>/g, '');
  t = t.replace(/\[\[\s*(?:Image|File|Media):[^\]]*\]\]/gi, '');
  t = t.replace(/\[\[\s*(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1');               /* [[link|text]] → text, before pipes matter */
  t = unwrap(t);
  t = t.replace(/<br\s*\/?>/gi, ' ').replace(/<\/?(?:small|span|nowrap|nobr|sup|sub|b|i|s|u)[^>]*>/gi, '');
  t = t.replace(/\[\d+\]/g, '').replace(/\{\{?\s*#tag:[^}]*\}?\}?/gi, '');
  t = t.replace(/&nbsp;|&#160;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;|&#39/g, "'").replace(/&amp;/g, '&');
  return plain(t);
}
const num = (s) => { const m = clean(s).replace(/[^\d]/g, ''); return m ? +m : 0; };

/* ---------- wikitables → rows ----------
   Cells are separated by ` || ` (and `!!` in a header row), often several to a line. A template inside
   a cell uses single pipes, so splitting on the two-character separator needs no masking, and the
   one place a bare `|` opens a line is the cell-params slot (`|colspan=2 Foo`) which is dropped first. */
const dropParams = (t) => (/^[^|=]*=/.test(t) ? t.replace(/^[^|]*\|\s*/, '') : t);
const splitCells = (line, sep) => line.split(sep).map((x) => x.trim());
function tables(text) {
  const out = [];
  const re = /^\{\|[^\n]*\n([\s\S]*?)^\|\}/gm;          /* `{| class=...` , body , `|}` */
  let m;
  while ((m = re.exec(text))) {
    if (/\bclass\s*=\s*["']?(?:navbox|infobox|sidebar|toc|messagebox)/i.test(m[0])) continue;
    const rows = [];
    for (const raw of m[1].split(/^\s*\|-[^\n]*$/m).slice(1)) {   /* each `|-`, attrs and all, opens a row */
      const cells = []; let head = false;
      for (const line of raw.split('\n')) {
        const l = line.replace(/^\s+/, '');
        if (l.startsWith('!')) { head = true; cells.push(...splitCells(dropParams(l.slice(1)), '!!')); continue; }
        if (l.startsWith('|')) { cells.push(...splitCells(dropParams(l.slice(1)), '||')); continue; }
        if (cells.length && l && !/^[|{}=<>]/.test(l)) cells[cells.length - 1] += ' ' + l;   /* a cell wrapped over lines */
      }
      const o = { header: head, cells: cells.map(clean) };
      if (o.cells.some((c) => c)) rows.push(o);
    }
    if (rows.length > 1) out.push(rows);
  }
  return out;
}
function toObjects(rows) {
  const hdr = rows.find((r) => r.header);
  const body = rows.filter((r) => r !== hdr && r.cells.length > 1);
  if (!hdr) return body.map((r) => ({ _: r.cells.join('  ') }));
  const keys = hdr.cells.map((c) => c.toLowerCase());
  return body.map((r) => { const o = {}; keys.forEach((k, i) => { o[k] = r.cells[i] != null ? r.cells[i] : ''; }); return o; });
}
const pick = (row, ...needles) => { const k = Object.keys(row).find((k) => needles.some((n) => k.includes(n))); return k ? row[k] : ''; };

/* ---------- sections, cut locally because prop=sections is deprecated ---------- */
function sections(wikitext) {
  const re = /^[ \t]*(={2,})[ \t]*(.*?)[ \t]*\1[ \t]*$/gm;
  const marks = []; let m;
  while ((m = re.exec(wikitext))) marks.push({ at: m.index, end: re.lastIndex, name: plain(m[2]), level: m[1].length });
  const out = [{ name: '', body: marks.length ? wikitext.slice(0, marks[0].at) : wikitext }];
  marks.forEach((mk, i) => {
    const next = marks.slice(i + 1).find((n) => n.level <= mk.level);
    out.push({ name: mk.name, body: wikitext.slice(mk.end, next ? next.at : wikitext.length) });
  });
  return out;
}
const findSection = (secs, re) => secs.filter((s) => re.test(s.name));

/* ---------- transport, plus the offline hatch this sandbox needs ---------- */
async function api(params) {
  const u = API + '?' + new URLSearchParams(Object.assign({ format: 'json', formatversion: 2 }, params));
  const res = await fetch(u, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + u.slice(0, 110));
  const j = await res.json();
  if (j.error) throw new Error('API ' + (j.error.code || 'error') + ': ' + plain(j.error.info).slice(0, 150));
  return j;
}
async function resolve() {
  if (arg('title', '')) return arg('title');
  const q = arg('search', '') || arg('league', '');
  if (!q) throw new Error('pass --search="..." or --title="..." (or --fixture=FILE to parse offline)');
  const j = await api({ action: 'query', list: 'search', srsearch: q, srlimit: 5 });
  const hits = (j.query && j.query.search) || [];
  if (!hits.length) throw new Error('Wikipedia found nothing for ' + JSON.stringify(q));
  const pickHit = hits.find((h) => h.title.toLowerCase() === q.toLowerCase()) || hits[0];
  if (hits.length > 1) log('candidates: ' + hits.map((h) => h.title).join(' | '));
  log('reading "' + pickHit.title + '"  (' + pickHit.size + ' bytes, edited ' + String(pickHit.timestamp || '').slice(0, 10) + ')');
  return pickHit.title;
}
async function wikitextFor(title) {
  if (arg('fixture', '')) { log('offline: parsing ' + arg('fixture')); return fs.readFileSync(arg('fixture'), 'utf8'); }
  const j = await api({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: title });
  const p = ((j.query || {}).pages || [])[0] || {};
  const rev = (p.revisions || [])[0] || {};
  const txt = (rev.slots && rev.slots.main && rev.slots.main.content) || rev.content;
  if (!txt) throw new Error('no wikitext for ' + title + ' (page moved or deleted?)');
  return txt;
}

/* ---------- the two extractions ---------- */
function clubsAndStadiums(secs) {
  const heads = [...findSection(secs, /stadium|venues/i), ...findSection(secs, /clubs|teams|personnel/i)];
  for (const s of heads) {
    for (const t of tables(s.body)) {
      const rows = toObjects(t).map((r) => {
        const name = pick(r, 'club', 'team', 'name');
        if (!name || name.length < 2 || /relegat|promot|{{/i.test(name)) return null;
        return { name, city: pick(r, 'location', 'city'), stadium: pick(r, 'stadium', 'ground', 'venue'),
          capacity: num(pick(r, 'capacity', 'seats')), manager: clean(pick(r, 'manager', 'head coach', 'coach')),
          kit: pick(r, 'kit', 'manufacturer') };
      }).filter(Boolean);
      if (rows.length >= 4) return rows;
    }
  }
  return [];
}
function standings(secs) {
  for (const s of findSection(secs, /league table|standings|final table|results|season/i)) {
    for (const t of tables(s.body)) {
      const rows = toObjects(t).map((r) => {
        const club = pick(r, 'team', 'club'), pts = num(pick(r, 'pts', 'points'));
        return club && pts ? { club, pts } : null;
      }).filter(Boolean);
      if (rows.length >= 4) return rows;
    }
    const rows = sportsTable(s.body);                       /* the usual case: {{#invoke:Sports table}} */
    if (rows.length >= 4) return rows;
  }
  return [];
}
function sportsTable(body) {
  const start = body.search(/\{\{\s*#invoke:\s*sports table/i);
  if (start < 0) return [];
  const src = body.slice(start, matchEnd(body, start));
  const keys = [...new Set([...src.matchAll(/\|\s*team_([A-Za-z0-9]+)\s*=/g)].map((m) => m[1]))];
  const get = (k, key) => { const m = src.match(new RegExp('\\|\\s*' + k + '_' + key + '\\s*=\\s*([^|\\n}]*)', 'i')); return m ? m[1].trim() : ''; };
  return keys.map((key) => {
    const club = clean(get('team', key));
    if (!club) return null;
    let pts = num(get('pts', key) || get('points', key));
    if (!pts) { const w = num(get('win', key)), d = num(get('draw', key) || get('nonp', key)), l = num(get('loss', key) || get('fail', key)); if (w || d || l) pts = 3 * w + d; }
    return { club, pts };
  }).filter((r) => r && r.pts).sort((a, b) => b.pts - a.pts);
}
const strengthFrom = (pts, all) => {
  const lo = Math.min(...all), hi = Math.max(...all), span = Math.max(1, hi - lo);
  return Math.round(Math.max(56, Math.min(88, 60 + ((pts - lo) / span) * 22)));
};

/* ---------- pack ---------- */
const short = (name, taken) => {
  const base = (name.replace(/[^A-Za-z]/g, '').slice(0, 3) || 'CLB').toUpperCase();
  let s = base, i = 1;
  while (taken.has(s)) s = base.slice(0, 2) + ++i;
  taken.add(s);
  return s;
};
/* Keep packs/manifest.js in step with a generated pack: the game only offers what
   window.FC27_PACK_INDEX lists, so a refreshed file nobody can install is a wasted run. The list is
   JSON inside a JS assignment, so it is parsed rather than regexed, and a manifest that will not parse
   is refused rather than rewritten — a hand-edited file is the user's, not ours to flatten. */
function upsertManifest(manifestPath, pack, outFile) {
  const rel = path.relative(path.join(__dirname, '..'), path.resolve(outFile)).split(path.sep).join('/');
  const clubs = pack.leagues.reduce((a, l) => a + l.divs.reduce((x, d) => x + d.clubs.length, 0), 0);
  const entry = { file: rel, id: pack.id, name: pack.name, version: pack.version,
    summary: pack.leagues.length + ' league(s) · ' + clubs + ' clubs · ' + pack.players.length + ' players' };
  const head = '/* Football Career 27 — the data packs sitting beside this file. The game reads this list and\n   offers each entry for install from HUB \u2192 Universe; nothing is loaded unless you ask for it. */\nwindow.FC27_PACK_INDEX = [\n';
  let txt = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, 'utf8') : head + '];\n';
  const a = txt.indexOf('['), b = txt.lastIndexOf(']');
  if (a < 0 || b < a) throw new Error('no FC27_PACK_INDEX array in ' + manifestPath);
  let arr;
  try { arr = JSON.parse(txt.slice(a, b + 1)); } catch (e) { throw new Error('existing manifest does not parse — refusing to rewrite it'); }
  if (!Array.isArray(arr)) throw new Error('manifest is not an array');
  const at = arr.findIndex((x) => x && x.file === rel);
  if (at >= 0) arr[at] = entry; else arr.push(entry);
  fs.writeFileSync(manifestPath, head + arr.map((x) => ' ' + JSON.stringify(x)).join(',\n') + '\n];\n');
  return arr.length;
}
function buildPack(title, clubs, table) {
  const byKey = new Map(), byRoot = new Map();
  const root = (x) => String(x).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '').replace(/(fc|ec|sc|ac|cr|se|sa|esporte|club|clube)$/, '');
  table.forEach((r) => { byKey.set(r.club.toLowerCase(), r.pts); const k = root(r.club); if (k && !byRoot.has(k)) byRoot.set(k, r.pts); });
  const all = table.map((r) => r.pts), taken = new Set();
  const rows = clubs.map((c) => {
    const pts = byKey.get(c.name.toLowerCase()) != null ? byKey.get(c.name.toLowerCase()) : byRoot.get(root(c.name));
    const str = pts != null ? strengthFrom(pts, all) : 70;
    return { line: [c.name, short(c.name, taken), str, c.capacity || 15000, c.kit ? clean(c.kit) : ''].join('|'),
      str, cap: c.capacity || 0, pts: pts == null ? null : pts, manager: c.manager, stadium: c.stadium, city: c.city, matched: pts != null };
  });
  const name = title.replace(/^\d{4}\s+/, '');
  const code = (title.match(/\bS[ée]rie\s+([A-E])\b/i) || [])[1] || 'A';
  const pack = {
    id: 'live-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42),
    name: title,
    version: 'live ' + new Date().toISOString().slice(0, 10),
    source: 'tools/refresh.js',
    note: 'Built by tools/refresh.js from "' + title + '": club names, cities, stadiums, capacities, kit makers and managers are copied from that '
      + 'article. Each club\'s strength is derived from its points in that season\'s table (' + rows.filter((r) => r.matched).length + ' of ' + rows.length
      + ' matched; unmatched clubs sit at 70) — a mapping of points, not a squad rating. No player data comes from this article, so the game generates '
      + 'every squad. Text derived from Wikipedia under CC BY-SA 4.0: https://en.wikipedia.org/wiki/' + title.replace(/ /g, '_') + ' (contributors: '
      + 'https://en.wikipedia.org/w/index.php?title=' + title.replace(/ /g, '_') + '&action=history)',
    leagues: [{ code: 'LIVE', name, country: 'LIV', confed: '—', tv: 0.70,
      divs: [{ code: 'S' + (code === 'A' ? 'AA' : code), name, rep: 0.80, size: rows.length, cup: null, clubs: rows.map((r) => r.line) }],
      promotion: { auto: 0, playoff: null, legs: 2, cross: false, gapRule: '', final: false, finalName: '' },
      relegation: { auto: 0, playoff: null, legs: 2, cross: false, gapRule: '', final: false, finalName: '' } }],
    nations: [],
    coaches: rows.filter((r) => r.manager && r.manager.length < 40).map((r) => r.manager + '|LIV|bal|52|' + r.line.split('|')[1]),
    players: [],
  };
  return { pack, rows };
}

/* `node tools/refresh.js --selftest` — the parser is the fragile half of this tool, so it is pinned
   to tools/fixtures/wp-brasileirao.txt, which is written in Wikipedia's real markup shapes (one cell
   per line AND several per line, {{flag}}/{{flagicon}}, {{sort}} capacities, {{#if:}} branches, a
   <ref> holding a cite web with pipes, and a {{#invoke:Sports table}} league table instead of a
   wikitable). It is hand-built, not captured: this repo's sandbox has no network, so no page could be
   saved from here. When Wikipedia changes a table, this test is what tells you before the game does. */
function selftest() {
  const fx = path.join(__dirname, 'fixtures', 'wp-brasileirao.txt');
  const secs = sections(fs.readFileSync(fx, 'utf8'));
  const clubs = clubsAndStadiums(secs);
  const table = standings(secs);
  const { pack, rows } = buildPack('2026 Campeonato Brasileiro Série A', clubs, table);
  const checks = [];
  const ok = (name, cond) => checks.push([!!cond, name]);
  ok('sections found (Teams + League table)', secs.filter((s) => s.name).length >= 2);
  ok('all 5 clubs parsed, multi-line rows included', clubs.length === 5);
  ok('{{lang|pt|Grêmio}} keeps the name', rows.some((r) => r.line.startsWith('Grêmio|')));
  ok('no markup left in any name', !rows.some((r) => /[{}[\]<]|flag|sort|nowrap/.test(r.line.split('|')[0])));
  ok('{{sort|78231|…}} capacity parsed', rows.some((r) => r.line.startsWith('Flamengo|') && r.cap === 78231));
  ok('navbox table ignored (no duplicate Palmeiras)', clubs.filter((c) => /Palmeiras/.test(c.name)).length === 1);
  ok('{{#if:yes|[[Allianz Parque]]|…}} stadium resolved', clubs.some((c) => /Palmeiras/.test(c.name) && /Allianz Parque/.test(c.stadium)));
  ok('<ref> cite web stripped from manager', clubs.some((c) => c.manager === 'Jorge Sampaoli'));
  ok('league table parsed from {{#invoke:Sports table}}', table.length === 5 && table[0].club === 'Flamengo' && table[0].pts === 86);
  ok('strength descends with points', rows.map((r) => r.str).join(',') === '82,79,70,66,60');
  ok('every club matched a table row', rows.every((r) => r.matched));
  ok('players empty (not in this source)', pack.players.length === 0);
  ok('managers became coach rows', pack.coaches.length === 5 && /^Jorge Sampaoli\|LIV\|bal\|52\|FLA$/.test(pack.coaches[0]));
  ok('CC BY-SA attribution in the note', /CC BY-SA 4\.0/.test(pack.note) && /action=history/.test(pack.note));
  ok('div size matches club count', pack.leagues[0].divs[0].size === 5);
  ok('pack grammar: 5 fields per club row', pack.leagues[0].divs[0].clubs.every((c) => c.split('|').length === 5));
  const bad = checks.filter((c) => !c[0]);
  checks.forEach(([pass, n]) => log((pass ? '  ok  ' : '  FAIL  ') + n));
  log(bad.length ? 'REFRESH SELFTEST ' + bad.length + '/' + checks.length + ' FAILED' : 'REFRESH SELFTEST OK · ' + checks.length + ' checks');
  process.exitCode = bad.length ? 1 : 0;
}
if (has('selftest')) { selftest(); return; }

(async () => {
  const dump = arg('dump', '');
  if (dump) fs.mkdirSync(dump, { recursive: true });
  let title = arg('title', '');
  let wiki;
  if (arg('fixture', '')) { title = title || path.basename(arg('fixture')).replace(/\.\w+$/, ''); wiki = await wikitextFor(title); }
  else { title = await resolve(); wiki = await wikitextFor(title); }
  if (dump) fs.writeFileSync(path.join(dump, '00-wikitext.txt'), wiki);
  const secs = sections(wiki);
  if (dump) fs.writeFileSync(path.join(dump, '01-sections.txt'), secs.map((s) => '== ' + s.name + ' ==  [' + s.body.length + 'b]').join('\n'));
  const clubs = clubsAndStadiums(secs);
  /* A floor, not a preference: a top flight is 16-20 clubs, so a short parse means Wikipedia changed a
     table, not that the league got smaller. CI commits what this writes, so refuse instead of shipping 4. */
  const minClubs = +arg('min-clubs', 12);
  if (clubs.length < minClubs) {
    log((clubs.length ? 'only ' + clubs.length + ' clubs parsed, under the floor of ' + minClubs : 'no clubs/stadium table parsed')
      + '. Sections found: ' + secs.map((s) => s.name).filter(Boolean).join(' | '));
    log('the article changed shape — read ' + (dump ? dump + "/00-wikitext.txt" : "run it with --dump=DIR and open 00-wikitext.txt") + '. No pack written.');
    process.exitCode = 1;
    return;
  }
  const table = standings(secs);
  if (dump) fs.writeFileSync(path.join(dump, '02-clubs.json'), JSON.stringify(clubs, null, 1) + '\n');
  if (dump) fs.writeFileSync(path.join(dump, '03-table.json'), JSON.stringify(table, null, 1) + '\n');
  const { pack, rows } = buildPack(title, clubs, table);
  if (dump) fs.writeFileSync(path.join(dump, '04-pack.json'), JSON.stringify(pack, null, 1) + '\n');
  log('clubs ' + rows.length + ' · stadium capacity ' + rows.filter((r) => r.cap).length + ' · named manager ' + pack.coaches.length
    + ' · strength from the table ' + rows.filter((r) => r.matched).length);
  const miss = rows.filter((r) => !r.matched).map((r) => r.line.split('|')[0]);
  if (miss.length) log('no table row matched, kept at 70: ' + miss.slice(0, 12).join(', ') + (miss.length > 12 ? ' …' : ''));
  if (!table.length) log('no league table parsed at all — every club sits at 70, so standings will look flat. Expected for an in-progress season.');
  const out = arg('out', '');
  if (out) {
    fs.mkdirSync(path.dirname(out) || '.', { recursive: true });
    fs.writeFileSync(out, '/* generated by tools/refresh.js from ' + JSON.stringify(title) + '\n   ' + pack.note.replace(/\s+/g, ' ') + ' */\nwindow.FC27_PACK = ' + JSON.stringify(pack) + ';\n');
    log('wrote ' + out + ' · ' + Math.round(fs.statSync(out).size / 1024) + 'kb — then: node tools/packs.js  (and add it to packs/manifest.js to offer it in-game)');
    const man = arg('manifest', has('manifest') ? path.join('packs', 'manifest.js') : '');
    if (man) {
      try { const n = upsertManifest(man, pack, out); log('manifest ' + man + ' updated · ' + n + ' pack(s) listed — the game will offer ' + JSON.stringify(pack.id) + ' in HUB \u2192 Universe'); }
      catch (e) { log('manifest NOT updated: ' + e.message + ' — the pack file itself is fine, install it with Import'); process.exitCode = 1; }
    }
  } else if (has('print-pack')) process.stdout.write(JSON.stringify(pack, null, 1).slice(0, 3500) + '\n');
  else log('nothing written: pass --out=packs/live-xx.js');
})().catch((e) => { console.error('refresh.js: ' + e.message); if (e.cause && e.cause.message) console.error('  cause: ' + e.cause.message); process.exitCode = 2; });
