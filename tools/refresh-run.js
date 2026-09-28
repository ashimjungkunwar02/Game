/* tools/refresh-run.js — run tools/refresh.js over every entry in tools/refresh-targets.json.
   This exists so the CI job has one line, and so a local run does the same thing as the robot:

     node tools/refresh-run.js                 # every target, real network
     node tools/refresh-run.js --dry           # what it WOULD run, no network (works offline)
     node tools/refresh-run.js brasil scotland # only these ids
     node tools/refresh-run.js --fixture=tools/fixtures/wp-brasileirao.txt --out=/tmp/x.js

   The parser is shared with refresh.js, so `--selftest` there is the check that this file's jobs are
   worth running at all. A target that fails is a non-zero exit, which fails the CI job, which is the
   point: a silently missing pack is worse than a red tick.
*/
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const FILE = path.join(__dirname, 'refresh-targets.json');
const conf = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const want = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const targets = conf.targets.filter((t) => !want.length || want.includes(t.id));
const passthrough = process.argv.slice(2).filter((a) => a.startsWith('--') && !a.startsWith('--out') && !a.startsWith('--fixture') && !a.startsWith('--search') && !a.startsWith('--min-clubs'));

if (!targets.length) { console.error('no target matches ' + want.join(', ') + ' — known: ' + conf.targets.map((t) => t.id).join(', ')); process.exit(1); }
if (passthrough.includes('--dry')) {
  for (const t of targets) console.log('would run: node tools/refresh.js --search=' + JSON.stringify(t.search) + ' --out=' + t.out + ' --min-clubs=' + (t.minClubs == null ? 12 : t.minClubs));
  console.log('targets: ' + targets.length + ' · ' + FILE);
  process.exitCode = 0;
} else {
  const bad = [];
  for (const t of targets) {
    const cmd = [path.join(__dirname, 'refresh.js'), '--search=' + t.search, '--out=' + t.out];
    if (t.minClubs != null) cmd.push('--min-clubs=' + t.minClubs);
    for (const p of passthrough) cmd.push(p);
    console.log('\n=== ' + t.id + (t.label ? '  (' + t.label + ')' : '') + ' ===');
    const r = spawnSync(process.execPath, cmd, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    if (r.status !== 0) bad.push(t.id + ' exited ' + r.status);
  }
  if (bad.length) { console.error('\nrefresh-run: ' + bad.length + ' target(s) failed — ' + bad.join(', ')); process.exitCode = 1; }
  else console.log('\nrefresh-run: ' + targets.length + ' target(s) rebuilt · ' + targets.map((t) => t.out).join(' '));
}
