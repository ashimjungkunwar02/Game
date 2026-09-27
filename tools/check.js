#!/usr/bin/env node
/* Syntax-check the single inline <script> inside index.html without a browser.
   Prints the line count so a truncated file is obvious. Run after every edit. */
const fs = require('fs');
const h = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const s = [...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
try { new Function(s); console.log('JS SYNTAX OK  (' + h.split('\n').length + ' lines)'); }
catch (e) { console.log('SYNTAX ERR: ' + e.message); process.exit(1); }
