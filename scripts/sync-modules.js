#!/usr/bin/env node
/**
 * sync-modules.js — kopiuje tampermonkey/modules/* do hosted/modules/
 * Uruchom: node scripts/sync-modules.js
 * Lub przy dev: automatycznie w watchu
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'tampermonkey', 'modules');
const DST = path.join(ROOT, 'hosted', 'modules');

if (!fs.existsSync(DST)) fs.mkdirSync(DST, { recursive: true });

const files = fs.readdirSync(SRC).filter(f => f.endsWith('.js'));
let copied = 0;
files.forEach(f => {
    const src = path.join(SRC, f);
    const dst = path.join(DST, f);
    const srcMt = fs.statSync(src).mtimeMs;
    const dstMt = fs.existsSync(dst) ? fs.statSync(dst).mtimeMs : 0;
    if (srcMt > dstMt) {
        fs.copyFileSync(src, dst);
        console.log('  [sync] ' + f);
        copied++;
    }
});
if (copied === 0) console.log('  [sync] Wszystko aktualne (' + files.length + ' modułów)');
else console.log('  [sync] Skopiowano ' + copied + '/' + files.length + ' modułów → hosted/modules/');
