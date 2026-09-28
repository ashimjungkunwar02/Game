#!/usr/bin/env node
/* Syntax-check the inline script inside index.html without a browser, and prove the page is
   actually wired to its data. Prints the line count so a truncated file is obvious.
   Run after every edit. */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const h = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const problems = [];
const fail = m => problems.push(m);

const s = [...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
try { new Function(s); }
catch (e) { fail('SYNTAX ERR: ' + e.message); }

/* The harnesses read index.html and db.js themselves, so a page that forgets to load db.js in the
   browser passes every tool and shows a blank tab on a phone. Assert the wiring, not just syntax. */
const tag = h.match(/<script[^>]*\ssrc=["']([^"']*db\.js)["'][^>]*>\s*<\/script>/);
if (!tag) fail('index.html has no <script src="db.js"> tag — the universe would never load in a browser');
else {
  const src = tag[1].replace(/^.\//, '');
  const at = h.indexOf(tag[0]), engine = h.indexOf('const DB = window.FC27_DB');
  if (engine >= 0 && at > engine) fail('db.js is loaded after the engine reads window.FC27_DB — it must come first');
  if (/\basync\b|\bdefer\b/.test(tag[0])) fail('db.js must load synchronously before the engine (no async/defer)');
  if (!fs.existsSync(path.join(root, src))) fail('the page loads ' + src + ' but that file is not next to index.html');
  else if (!fs.readFileSync(path.join(root, src), 'utf8').includes('window.FC27_DB'))
    fail(src + ' never assigns window.FC27_DB, which is the name the engine reads');
}

if (problems.length) { problems.forEach(p => console.log('✗ ' + p)); process.exit(1); }
console.log('JS SYNTAX OK · db.js wired before the engine  (' + h.split('\n').length + ' lines)');
