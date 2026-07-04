/**
 * Lokalny serwer deweloperski dla Margonem bota.
 * Serwuje hosted/, dashboard i API stanu bota.
 *
 * Uruchom: npm run dev   lub   node scripts/dev-server.js
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.MAW_DEV_PORT) || 3847;
const ROOT = path.resolve(__dirname, '..');
const HOSTED_DIR = path.join(ROOT, 'hosted');
const DASHBOARD_DIR = path.join(ROOT, 'dashboard');
const ENV_FILE = path.join(ROOT, '.env');
const EQ_FILE = path.join(ROOT, 'EQ7.txt');
const AI_MEMORY_FILE = path.join(ROOT, 'ai-memory.json');

const MAP_CONNECTIONS_FILE = path.join(HOSTED_DIR, 'map-connections.json');
let botState = null;
let stateUpdatedAt = 0;
let aiMemory = loadJsonSafe(AI_MEMORY_FILE, { decisions: [] });
let mapConnections = loadJsonSafe(MAP_CONNECTIONS_FILE, {});
let pendingConfigPatch = {};

loadDotEnv();

// Auto-sync modułów tampermonkey/modules/ → hosted/modules/
(function syncModules() {
    const src = path.join(ROOT, 'tampermonkey', 'modules');
    const dst = path.join(ROOT, 'hosted', 'modules');
    if (!fs.existsSync(src)) return;
    if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
    fs.readdirSync(src).filter(f => f.endsWith('.js')).forEach(f => {
        const s = path.join(src, f), d = path.join(dst, f);
        const sm = fs.statSync(s).mtimeMs, dm = fs.existsSync(d) ? fs.statSync(d).mtimeMs : 0;
        if (sm > dm) { fs.copyFileSync(s, d); console.log('[sync] modules/' + f); }
    });
})();

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
};

function corsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, status, data) {
    corsHeaders(res);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

function loadDotEnv() {
    if (!fs.existsSync(ENV_FILE)) return;
    const raw = fs.readFileSync(ENV_FILE, 'utf8');
    raw.split(/\r?\n/).forEach(line => {
        const clean = line.trim();
        if (!clean || clean.startsWith('#')) return;
        const idx = clean.indexOf('=');
        if (idx === -1) return;
        const key = clean.slice(0, idx).trim();
        const value = clean.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        if (key && process.env[key] == null) process.env[key] = value;
    });
}

function loadJsonSafe(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        return fallback;
    }
}

function writeJsonSafe(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (e) {
        return false;
    }
}

function serveFile(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
        corsHeaders(res);
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 Not Found');
            return;
        }
        res.writeHead(200, { 'Content-Type': mime });
        res.end(data);
    });
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            if (!raw) return resolve(null);
            try {
                resolve(JSON.parse(raw));
            } catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}

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

function parseEqSnapshot(raw) {
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
            'Obrażenia od ognia', 'Obrażenia od zimna', 'Obrażenia od błyskawic', 'Obrażenia od trucizny'
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
        source: 'EQ7.txt',
        items,
        weapons: items.filter(i => /dystansowe|jednoręczne|dwuręczne|pomocnicze|różdżki|laski|strzały/i.test(i.type || i.summary)),
    };
}

function getEqSnapshot() {
    try {
        return parseEqSnapshot(fs.readFileSync(EQ_FILE, 'utf8'));
    } catch (e) {
        return { source: 'EQ7.txt', items: [], weapons: [], error: e.message };
    }
}

function buildLocalSkillPlan(payload, eqSnapshot) {
    const hero = payload.hero || {};
    const skills = (payload.skills || []).filter(s => s && s.name);
    const free = Math.max(0, Number((payload.points || {}).free || payload.freePoints || 0));
    const eqText = JSON.stringify(eqSnapshot.weapons || []).toLowerCase();
    const profession = String(hero.profession || hero.prof || '').toLowerCase();
    const ranged = /łowca|tropiciel|dystansowe|strzały|luk|łuk|kusza|miotacz/.test(profession + ' ' + eqText);
    const cold = /zimn|cold|lód|lod|frost/.test(eqText);

    const scored = skills.map(skill => {
        const text = `${skill.name} ${skill.tip || ''}`.toLowerCase();
        let score = 10;
        const reasons = [];
        if (skill.curLvl >= skill.maxLvl) score -= 999;
        if (/aktywn|cios|strzał|strzal|atak|obraż|obrazen|obrażeń|dmg/.test(text)) {
            score += 35;
            reasons.push('skill daje realny dmg albo aktywny atak');
        }
        if (ranged && /dystans|strzał|strzal|łuk|luk|kusz|celn|przebic|przebicie/.test(text)) {
            score += 30;
            reasons.push('ekwipunek wygląda na dystansowy');
        }
        if (cold && /zimn|lod|lód|frost/.test(text)) {
            score += 24;
            reasons.push('EQ ma trop zimna, skill pasuje pod żywioł');
        }
        if (/kryt|przebic|przebicie|szybkość|szybkosc|sa|unik/.test(text)) {
            score += 18;
            reasons.push('wspiera kryta/przebicie/szybkość/unik');
        }
        if (/leczen|leczenie|życie|zycie|obron|pancerz|odporno/.test(text)) {
            score += 10;
            reasons.push('dodaje przeżywalność');
        }
        if (!reasons.length) reasons.push('najlepszy lokalny wybór z dostępnych danych');
        return { skill, score, reasons };
    }).sort((a, b) => b.score - a.score);

    const allocations = [];
    let left = free;
    for (const row of scored) {
        if (left <= 0) break;
        const canAdd = Math.max(0, Number(row.skill.maxLvl || 0) - Number(row.skill.curLvl || 0));
        if (canAdd <= 0 || row.score < 0) continue;
        const points = Math.min(canAdd, left, row.score >= 40 ? 2 : 1);
        allocations.push({
            name: row.skill.name,
            points,
            targetLvl: Number(row.skill.curLvl || 0) + points,
            reason: row.reasons.join('; '),
        });
        left -= points;
    }

    return {
        mode: 'local-dry-run',
        summary: ranged
            ? 'Plan lokalny: priorytet dystans/kryt/przebicie/szybkość, bo EQ wygląda na broń dystansową.'
            : 'Plan lokalny: priorytet dmg, aktywne ataki i przeżywalność.',
        allocations,
        warnings: [
            'To jest plan bez AI albo w trybie dry-run. Sprawdź go przed klikaniem w grze.',
            left > 0 ? `Zostało ${left} pkt bez mocnego dopasowania.` : null,
        ].filter(Boolean),
    };
}

async function callAiSkillPlanner(payload, eqSnapshot) {
    const apiKey = process.env.MAW_AI_API_KEY || '';
    const baseUrl = (process.env.MAW_AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const model = process.env.MAW_AI_MODEL || 'gpt-4o-mini';
    const dryRun = String(process.env.MAW_AI_DRY_RUN || 'true').toLowerCase() !== 'false';

    if (!apiKey || dryRun) {
        return buildLocalSkillPlan(payload, eqSnapshot);
    }

    const prompt = {
        task: 'Rozłóż punkty umiejętności w Margonem rozsądnie pod profesję, opis umek i EQ.',
        rules: [
            'Zwróć wyłącznie obiekt JSON.',
            'Suma punktów w "allocations" (pole "points") nie może przekroczyć liczby wolnych punktów (free) w danych wejściowych.',
            'Każda alokacja musi dotyczyć istniejącej umiejętności z listy, a targetLvl = curLvl + points i nie może przekroczyć maxLvl.',
            'Przeanalizuj uważnie pole "weapons" w eqSnapshot oraz typ postaci. Zidentyfikuj główny żywioł broni (np. zimno, ogień, błyskawice, trucizna) oraz typ (dystansowa/wręcz) i wybierz umiejętności, które posiadają z tym synergię.',
            'Jeśli broń zadaje np. obrażenia od zimna, daj wysoki priorytet umiejętnościom powiązanym z zimnem/zamarzaniem.',
            'Uzasadnij krótko każdy wybór w polu "reason" po polsku.'
        ],
        expectedSchema: {
            summary: 'string',
            allocations: [{ name: 'skill name', points: 1, targetLvl: 1, reason: 'string' }],
            warnings: ['string']
        },
        gameData: payload,
        eqSnapshot: {
            weapons: eqSnapshot.weapons,
            items: eqSnapshot.items.slice(0, 40),
        },
        previousDecisions: aiMemory.decisions.slice(-12),
    };

    const systemPrompt = `Jesteś zaawansowanym plannerem buildów i rozdawania punktów umiejętności w grze MMORPG Margonem.
Twój cel to zanalizowanie profesji postaci, jej poziomu, aktualnie założonej broni oraz opisu umiejętności (szczególnie ich synergii z typem broni i żywiołem), a następnie optymalne rozdzielenie dostępnych wolnych punktów umiejętności (free points).

Wytyczne dla profesji i synergii:
1. Wojownik (w): Skupia się na sile, ciosie krytycznym, fizycznym dmg, ogłuszeniach i przeżywalności.
2. Paladyn (p): Walczy mieczem jednoręcznym i tarczą. Może zadawać obrażenia od ognia/błyskawic/fizyczne, a także blokować ciosy. Bardzo ważna jest synergia z obrażeniami magicznymi (ogień/błyskawice) z broni.
3. Łowca (h): Typowo dystansowy (łuk/kusza), fizyczny dmg, cios krytyczny, przebicie pancerza i trucizny.
4. Tropiciel (t): Dystansowy (łuk/kusza), ale mocno hybrydowy - zadaje duże obrażenia od zimna, błyskawic lub ognia. Kluczowe jest dopasowanie umiejęności żywiołowych pod typ obrażeń z broni w EQ! Jeśli broń ma np. obrażenia od zimna, pakuj punkty w umiejętności zamrażające / wzmacniające zimno.
5. Mag (m): Dystansowy czarownik. Używa różdżek/lasek. Zadaje obrażenia od ognia, zimna lub błyskawic. Dobieraj umiejętności pasujące do żywiołu posiadanej broni.
6. Tancerz ostrzy (b): Melee, dwie bronie jednoręczne, wysoka szybkość ataku (SA), cios krytyczny i uniki.

Zwróć wyłącznie poprawny format JSON dopasowany do schematu, bez żadnego dodatkowego tekstu ani formatowania markdown (np. bez bloków \`\`\`json).`;

    const body = JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify(prompt) },
        ],
    });

    const result = await new Promise((resolve, reject) => {
        const url = new URL(baseUrl + '/chat/completions');
        const lib = url.protocol === 'https:' ? require('https') : require('http');
        const req = lib.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'Content-Length': Buffer.byteLength(body),
            },
        }, r => {
            const chunks = [];
            r.on('data', c => chunks.push(c));
            r.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                if (r.statusCode < 200 || r.statusCode >= 300) {
                    reject(new Error(`AI HTTP ${r.statusCode}: ${raw.slice(0, 300)}`));
                    return;
                }
                resolve(raw);
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });

    const parsed = JSON.parse(result);
    const content = parsed.choices && parsed.choices[0] && parsed.choices[0].message
        ? parsed.choices[0].message.content
        : '{}';
    return { mode: 'ai', ...JSON.parse(content) };
}

function rememberAiDecision(payload, plan) {
    aiMemory.decisions.push({
        ts: Date.now(),
        hero: payload.hero || null,
        points: payload.points || null,
        plan,
    });
    aiMemory.decisions = aiMemory.decisions.slice(-80);
    writeJsonSafe(AI_MEMORY_FILE, aiMemory);
}

function resolveStatic(urlPath) {
    const clean = urlPath.split('?')[0];

    if (clean === '/' || clean === '/dashboard' || clean === '/dashboard/') {
        return path.join(DASHBOARD_DIR, 'index.html');
    }

    if (clean.startsWith('/dashboard/')) {
        const rel = clean.slice('/dashboard/'.length);
        const safe = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');
        return path.join(DASHBOARD_DIR, safe);
    }

    if (clean.startsWith('/hosted/')) {
        const rel = clean.slice('/hosted/'.length);
        const safe = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');
        return path.join(HOSTED_DIR, safe);
    }

    return null;
}

const server = http.createServer(async (req, res) => {
    const urlPath = req.url || '/';

    if (req.method === 'OPTIONS') {
        corsHeaders(res);
        res.writeHead(204);
        res.end();
        return;
    }

    if (urlPath.startsWith('/api/state')) {
        if (req.method === 'GET') {
            sendJson(res, 200, {
                ok: true,
                updatedAt: stateUpdatedAt,
                stale: stateUpdatedAt === 0 || Date.now() - stateUpdatedAt > 10000,
                state: botState,
            });
            return;
        }

        if (req.method === 'POST') {
            try {
                const body = await readBody(req);
                botState = body;
                stateUpdatedAt = Date.now();
                const hero = body && body.hero ? body.hero.name || '?' : '?';
                process.stdout.write(`\r  📡 POST /api/state  ${hero}  ${new Date().toLocaleTimeString('pl-PL')}   `);
                
                const patchToSend = pendingConfigPatch;
                pendingConfigPatch = {};
                
                sendJson(res, 200, { 
                    ok: true, 
                    updatedAt: stateUpdatedAt,
                    configPatch: Object.keys(patchToSend).length ? patchToSend : null
                });
            } catch (e) {
                sendJson(res, 400, { ok: false, error: 'Invalid JSON' });
            }
            return;
        }

        sendJson(res, 405, { ok: false, error: 'Method not allowed' });
        return;
    }

    if (urlPath.startsWith('/api/config')) {
        if (req.method === 'POST') {
            try {
                const body = await readBody(req);
                if (body && typeof body === 'object') {
                    pendingConfigPatch = { ...pendingConfigPatch, ...body };
                    sendJson(res, 200, { ok: true });
                } else {
                    sendJson(res, 400, { ok: false, error: 'Invalid config payload' });
                }
            } catch (e) {
                sendJson(res, 400, { ok: false, error: 'Invalid JSON' });
            }
            return;
        }
        sendJson(res, 405, { ok: false, error: 'Method not allowed' });
        return;
    }

    if (urlPath.startsWith('/api/ai/skills')) {
        if (req.method === 'GET') {
            sendJson(res, 200, {
                ok: true,
                configured: !!process.env.MAW_AI_API_KEY,
                dryRun: String(process.env.MAW_AI_DRY_RUN || 'true').toLowerCase() !== 'false',
                model: process.env.MAW_AI_MODEL || 'gpt-4o-mini',
                memoryCount: aiMemory.decisions.length,
            });
            return;
        }

        if (req.method === 'POST') {
            try {
                const body = await readBody(req);
                const eqSnapshot = getEqSnapshot();
                const plan = await callAiSkillPlanner(body || {}, eqSnapshot);
                rememberAiDecision(body || {}, plan);
                sendJson(res, 200, {
                    ok: true,
                    configured: !!process.env.MAW_AI_API_KEY,
                    dryRun: String(process.env.MAW_AI_DRY_RUN || 'true').toLowerCase() !== 'false',
                    eq: {
                        source: eqSnapshot.source,
                        itemCount: eqSnapshot.items.length,
                        weaponCount: eqSnapshot.weapons.length,
                        weapons: eqSnapshot.weapons.slice(0, 8),
                        error: eqSnapshot.error || null,
                    },
                    plan,
                });
            } catch (e) {
                sendJson(res, 500, { ok: false, error: e.message });
            }
            return;
        }

        sendJson(res, 405, { ok: false, error: 'Method not allowed' });
        return;
    }

    if (urlPath.startsWith('/api/map/connections')) {
        if (req.method === 'GET') {
            sendJson(res, 200, { ok: true, connections: mapConnections });
            return;
        }

        if (req.method === 'POST') {
            try {
                const body = await readBody(req);
                if (body && body.fromMapId && Array.isArray(body.connections)) {
                    const fromId = String(body.fromMapId);
                    if (!mapConnections[fromId]) {
                        mapConnections[fromId] = [];
                    }

                    let added = 0;
                    body.connections.forEach(conn => {
                        const targetId = Number(conn.toMapId);
                        if (isNaN(targetId)) return;

                        // Check if connection to targetId already exists
                        const existing = mapConnections[fromId].find(c => Number(c.toMapId) === targetId);
                        if (existing) {
                            existing.gatewayId = conn.gatewayId || existing.gatewayId;
                            existing.tx = conn.tx !== undefined ? conn.tx : existing.tx;
                            existing.ty = conn.ty !== undefined ? conn.ty : existing.ty;
                            existing.name = conn.name || existing.name;
                        } else {
                            mapConnections[fromId].push({
                                toMapId: targetId,
                                gatewayId: conn.gatewayId,
                                tx: conn.tx,
                                ty: conn.ty,
                                name: conn.name
                            });
                            added++;
                        }
                    });

                    if (added > 0) {
                        writeJsonSafe(MAP_CONNECTIONS_FILE, mapConnections);
                    }

                    sendJson(res, 200, { ok: true, added, total: mapConnections[fromId].length });
                } else {
                    sendJson(res, 400, { ok: false, error: 'Invalid map connection payload' });
                }
            } catch (e) {
                sendJson(res, 400, { ok: false, error: e.message });
            }
            return;
        }

        sendJson(res, 405, { ok: false, error: 'Method not allowed' });
        return;
    }

    const filePath = resolveStatic(urlPath);
    if (!filePath || !filePath.startsWith(ROOT)) {
        corsHeaders(res);
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
        return;
    }

    serveFile(res, filePath);
});

server.listen(PORT, '127.0.0.1', () => {
    console.log('');
    console.log('  Margonem Bot — serwer DEV');
    console.log('  ─────────────────────────');
    console.log(`  Dashboard:  http://127.0.0.1:${PORT}/`);
    console.log(`  API stanu:  http://127.0.0.1:${PORT}/api/state`);
    console.log(`  API AI:     http://127.0.0.1:${PORT}/api/ai/skills`);
    console.log(`  Hosted:     http://127.0.0.1:${PORT}/hosted/`);
    console.log(`  maps.json:  http://127.0.0.1:${PORT}/hosted/maps.json`);
    console.log('');
    console.log('  Ustaw DEV=true w loader.user.js i otwórz Margonem.');
    console.log('');
});
