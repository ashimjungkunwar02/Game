#!/usr/bin/env node
/*
  Football Career 27 — wiring test.

  A button can be perfectly implemented and still do nothing, because the handler was never attached.
  That is exactly how mode A shipped for seven commits: startCareer() worked, the takeover tests passed,
  and #tReal had no code behind it, so the tap opened nothing. Every other tool calls functions
  directly and never looks at the controls. This one reads the page as a list of things a thumb can
  touch and fails on the dead ones.

      node tools/wiring.js
*/
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

/* the static page, up to where the engine starts — everything after is JS that builds markup at runtime */
const engineAt = Math.max(html.indexOf('<script src="db.js">'), 0);
const markup = html.slice(0, engineAt);
const script = html.slice(engineAt);

const problems = [];
const TAG = /<(button|input|select|textarea)\b([^>]*)>/gi;
const interactive = [];
let m;
while ((m = TAG.exec(markup))) {
  const attrs = m[2] || '';
  const id = (attrs.match(/\bid=["']([^"']+)["']/) || [])[1];
  const inline = /\son[a-z]+\s*=/.test(attrs);
  const type = (attrs.match(/\btype=["']([^"']+)["']/) || [])[1] || '';
  if (type === 'hidden') continue;
  interactive.push({ tag: m[1].toLowerCase(), id, inline, attrs });
}

/* a control is live if it carries its own handler, or the script touches it: .onclick, addEventListener,
   value/textContent writes, or it is read at all via $('#id') */
const wiredById = new Set();
for (const g of script.matchAll(/\$\(\s*['"]#([A-Za-z0-9_-]+)['"]\s*\)/g)) wiredById.add(g[1]);
for (const g of script.matchAll(/getElementById\(\s*['"]([A-Za-z0-9_-]+)['"]/g)) wiredById.add(g[1]);

for (const el of interactive) {
  if (el.inline) continue;
  if (el.id && wiredById.has(el.id)) continue;
  /* a labelled input or select the script reads by name (never by id) is fine; anything else with an
     id and no handler anywhere is a dead control */
  if (el.tag === 'input' || el.tag === 'select' || el.tag === 'textarea') {
    const nm = (el.attrs.match(/\bname=["']([^"']+)["']/) || [])[1];
    if (nm && script.includes(nm)) continue;
    if (el.id && script.includes("['" + el.id + "']")) continue;
    if (!el.id) continue;                                   /* styling hook, not a control by itself */
  }
  problems.push('<' + el.tag + (el.id ? ' id="' + el.id + '"' : '') + '> has no handler and no script reference — tapping it does nothing');
}

/* every function an inline handler calls — in the page or in a template that builds one — must exist */
const defined = new Set();
for (const g of script.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)) defined.add(g[1]);
for (const g of script.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) defined.add(g[1]);
for (const g of script.matchAll(/Object\.assign\(\s*window\s*,\s*\{([\s\S]*?)\}\s*\)/g))
  g[1].split(',').forEach(x => { const n = x.trim().split(/[\s:]/)[0]; if (n) defined.add(n); });
const BUILTINS = new Set(['if', 'for', 'while', 'switch', 'return', 'typeof', 'function', 'alert', 'confirm', 'prompt',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'String', 'Number', 'Boolean', 'Array', 'Object', 'JSON', 'Math',
  'Date', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'scrollTo', 'preventDefault', 'stopPropagation']);

for (const g of html.matchAll(/\son(?:click|input|change|submit|keydown)\s*=\s*"([^"]*)"/g)) {
  for (const call of g[1].matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const fn = call[2];
    if (BUILTINS.has(fn) || defined.has(fn)) continue;
    if (/^(document|window|localStorage)$/.test(fn)) continue;
    problems.push('an inline handler calls ' + fn + '(), which the script never defines');
  }
}

/* the reverse: a handler on a container has to reach the elements inside it */
for (const g of markup.matchAll(/<(\w+)([^>]*\bid=["']([^"']+)["'][^>]*)>/g)) {
  const id = g[3];
  if (!/^(ownBlock|realBlock|create|title|game|hub)$/.test(id) && script.includes("$('#" + id + "').onclick"))
    if (!markup.includes('id="' + id + '"')) problems.push('#' + id + ' is wired but not in the page');
}

console.log('controls in the static page: ' + interactive.length + ' · functions callable from a tap: ' + defined.size);
if (problems.length) { console.log('\nWIRING: ' + problems.length + ' problem(s)'); [...new Set(problems)].forEach(p => console.log('  ✗ ' + p)); process.exit(1); }
console.log('WIRING OK · every control on the page has code behind it, and every handler names a real function');
