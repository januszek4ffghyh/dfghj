#!/usr/bin/env node
/**
 * Parsuje IDMAP .txt (MargoWorld scrape) → hosted/maps.json
 * Użycie: node scripts/parse-idmap.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INPUT = path.join(ROOT, 'IDMAP .txt');
const OUTPUT = path.join(ROOT, 'hosted', 'maps.json');

const PATTERN = /\/world\/view\/(\d+)\/([^"]+)">([^<]+)<\/a>/g;

function parseIdmap(text) {
    const maps = {};
    let match;
    while ((match = PATTERN.exec(text)) !== null) {
        const id = parseInt(match[1], 10);
        const slug = match[2];
        const name = match[3].trim();
        maps[String(id)] = { id, name, slug };
    }
    return maps;
}

function main() {
    if (!fs.existsSync(INPUT)) {
        console.error('Brak pliku:', INPUT);
        process.exit(1);
    }

    const text = fs.readFileSync(INPUT, 'utf8');
    const maps = parseIdmap(text);
    const count = Object.keys(maps).length;

    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, JSON.stringify(maps, null, 2) + '\n', 'utf8');

    console.log(`Zapisano ${count} map do ${OUTPUT}`);
}

main();
