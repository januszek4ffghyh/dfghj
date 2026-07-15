'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EQ_FILES = [
    path.join(ROOT, 'EQ7.txt'),
    path.join(ROOT, 'dane torb i jego eq.txt'),
];

function decodeHtml(raw) {
    return String(raw || '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, '&');
}

function stripHtml(raw) {
    return decodeHtml(raw)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseEqSnapshot(raw, source = 'EQ') {
    const text = decodeHtml(raw || '');
    const items = [];
    const matches = [];
    String(raw || '').replace(/tip="([^"]*item-head[^"]*)"/g, (_, tip) => {
        matches.push(decodeHtml(tip));
        return _;
    });
    const visibleTips = text.match(/<div class="tipInnerContainer content">[\s\S]*?<\/div><\/div>\s*$/g) || [];
    visibleTips.forEach(tip => matches.push(tip));

    matches.slice(0, 120).forEach((tip, idx) => {
        const plain = stripHtml(tip);
        const name = (tip.match(/item-name[^>]*>\s*([^<]+)/) || [])[1];
        const type = (plain.match(/Typ:\s*(.+?)(?:\s+(?:Pospolity|Unikatowy|Heroiczny|Legendarny|Obrażenia|Atak|Pancerz|Wymagana|Wartość)|$)/i) || [])[1];
        const profession = (plain.match(/Wymagana profesja:\s*([^<]+?)(?: Wymagany| Wartość|$)/i) || [])[1];
        const level = (plain.match(/Wymagany poziom:\s*(\d+)/i) || [])[1];
        const damage = (plain.match(/(?:Obrażenia|Atak)[^0-9]*(\d+\s*-\s*\d+|\d+)/i) || [])[1];
        const stats = [];
        [
            'Cios krytyczny', 'Moc ciosu krytycznego', 'Przebicie pancerza',
            'Szybkość ataku', 'Zręczność', 'Siła', 'Intelekt', 'Unik',
            'Życie', 'Mana', 'Energia', 'Odporność',
            'Obrażenia od ognia', 'Obrażenia od zimna', 'Obrażenia od błyskawic', 'Obrażenia od trucizny',
        ].forEach(label => {
            const re = new RegExp(label + '[^+\\-~0-9]*(?:\\+|~)?([\\-0-9.,\\s]+%?)', 'i');
            const m = plain.match(re);
            if (m) stats.push(`${label}: ${m[1].trim()}`);
        });
        if (name || type || damage || stats.length) {
            items.push({
                idx,
                name: name ? name.trim() : `Item ${idx + 1}`,
                type: type ? type.trim() : null,
                profession: profession ? profession.trim() : null,
                level: level ? Number(level) : null,
                damage: damage ? damage.replace(/\s+/g, ' ') : null,
                stats,
                summary: plain.slice(0, 700),
            });
        }
    });

    return {
        source,
        items,
        weapons: items.filter(i => /dystansowe|jednoręczne|dwuręczne|pomocnicze|różdżki|laski|strzały|tarcza|miecz/i.test((i.type || '') + (i.summary || ''))),
    };
}

function getEqSnapshot() {
    for (const file of EQ_FILES) {
        try {
            if (fs.existsSync(file)) {
                return parseEqSnapshot(fs.readFileSync(file, 'utf8'), path.basename(file));
            }
        } catch (e) {
            /* next file */
        }
    }
    return { source: 'none', items: [], weapons: [], error: 'Brak pliku EQ' };
}

module.exports = { parseEqSnapshot, getEqSnapshot, stripHtml, decodeHtml };
