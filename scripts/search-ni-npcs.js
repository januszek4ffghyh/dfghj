const fs = require('fs');
const s = fs.readFileSync('ni całe xd.txt', 'utf8');

// Find all matches for Engine.npcs
const matches = [];
const re = /Engine\.npcs\.\w+/g;
let m;
while ((m = re.exec(s)) !== null) {
    matches.push(m[0]);
}

console.log('Engine.npcs matches:', Array.from(new Set(matches)).join(', '));

// Let's also look for npcs in general
const re2 = /npcs\s*=\s*/g;
let m2;
while ((m2 = re2.exec(s)) !== null) {
    console.log('npcs assignment around:', s.substring(m2.index - 50, m2.index + 150).replace(/\s+/g, ' '));
}
