'use strict';

// ═══ Dotenv — ładuj PRZED innymi importami ═══
const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, '.env');
if (fs.existsSync(ENV_FILE)) {
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

const http = require('http');
const puppeteer = require('puppeteer');
const db = require('./database');
const ai = require('./openrouter');
const redis = require('./redis');
const captchaSolver = require('./capthat');


// ═══ Konfiguracja ═══
const PORT = Number(process.env.MAW_DEV_PORT) || 3847;
const LISTEN_HOST = '0.0.0.0';          // ← DODANE — publiczny dostęp
const ROOT = __dirname;
const HOSTED_DIR = path.join(ROOT, 'hosted');
const DASHBOARD_DIR = path.join(ROOT, 'dashboard');
const HEADLESS = String(process.env.MAW_HEADLESS || 'false').toLowerCase() === 'true';
const GAME_SERVER = process.env.MAW_GAME_SERVER || 'luvia';
const GAME_URL = process.env.MAW_GAME_URL || 'https://www.margonem.pl/intro/';

let botState = null;
let stateUpdatedAt = 0;
let pendingConfigPatch = {};
let page = null; // ref do Puppeteer page
let browserInstance = null; // ref do instancji przeglądarki
let isStartingBrowser = false; // flaga zapobiegająca jednoczesnym restartom
let introWaitStarted = 0; // znacznik czasu rozpoczęcia czekania na /intro/

// ═══ Globalne referencje do funkcji z startBotBrowser ═══
let _forceRelogFn = null;       // doForceRelog(nick, world)
let _restartLoginLoopFn = null; // startAutoLoginLoop()

// ═══ Nowy stan rozszerzony ═══
let dropsPerChar = {};    // { nick: { leg: 0, hero: 0, uni: 0, kills: 0, e2kills: 0 } }
let lastSessionStats = {}; // { nick: { leg: 0, hero: 0, uni: 0, kills: 0, e2kills: 0 } }
let charsCache = [];      // lista postaci z konta
let timersCache = [];     // timery E2 ze gry
let scheduleConfig = {    // harmonogram
    enabled: false,
    slots: '06:00-12:00, 14:00-24:00'
};
let activeChar = process.env.MARGONUM_START_CHAR || process.env.MARGONEM_START_CHAR || '';

// ── Ładowanie listy postaci z bazy przy starcie ──
function loadCharsFromDB() {
    try {
        const saved = db.getSetting('charsCache');
        if (Array.isArray(saved) && saved.length > 0) {
            charsCache = saved;
            console.log(`[DB] 👥 Wczytano ${charsCache.length} postaci z bazy SQLite`);
        }
    } catch (e) {
        console.error('[DB] Błąd wczytywania charsCache:', e.message);
    }
}

// ── Ładowanie dropów z bazy przy starcie ──
function loadDropsFromDB() {
    try {
        const saved = db.getSetting('dropsPerChar');
        if (saved && typeof saved === 'object' && Object.keys(saved).length > 0) {
            dropsPerChar = saved;
            console.log(`[DB] 📊 Wczytano dropy ${Object.keys(dropsPerChar).length} postaci z bazy SQLite`);
        }
    } catch (e) {
        console.error('[DB] Błąd wczytywania dropsPerChar:', e.message);
    }
}

// ── Zapis dropów do bazy ──
function saveDropsToDB() {
    try {
        db.saveSetting('dropsPerChar', dropsPerChar);
    } catch (e) {
        console.error('[DB] Błąd zapisu dropsPerChar:', e.message);
    }
}

// ── Zapis listy postaci do bazy ──
function saveCharsToDB() {
    try {
        db.saveSetting('charsCache', charsCache);
    } catch (e) {
        console.error('[DB] Błąd zapisu charsCache:', e.message);
    }
}

// Scala nowe dane o postaciach z charsCache (upsert po ID lub nick+świat)
// Po scaleniu automatycznie zapisuje do SQLite
function mergeChars(newChars) {
    if (!newChars || !newChars.length) return;

    const byKey = new Map();
    charsCache.forEach((c, idx) => {
        const key = (c.id != null && c.id !== '')
            ? `id_${c.id}`
            : `nick_${String(c.nick).toLowerCase()}_${String(c.world || '').toLowerCase()}`;
        byKey.set(key, idx);
    });

    let changed = false;
    for (const c of newChars) {
        if (!c) continue;
        const key = (c.id != null && c.id !== '')
            ? `id_${c.id}`
            : `nick_${String(c.nick).toLowerCase()}_${String(c.world || '').toLowerCase()}`;

        if (byKey.has(key)) {
            const idx = byKey.get(key);
            const existing = charsCache[idx];
            const cleanNew = Object.fromEntries(Object.entries(c).filter(([, v]) => v !== '' && v != null));
            charsCache[idx] = { ...existing, ...cleanNew };
            changed = true;
        } else if (c.nick || (c.id != null && c.id !== '')) {
            charsCache.push(c);
            const newIdx = charsCache.length - 1;
            byKey.set(key, newIdx);
            changed = true;
        }
    }

    if (changed) saveCharsToDB();
}


// ═══ Harmonogram start/stop bota ═══
let scheduleSlots = []; 
let watchdogInterval = null;
let scheduleEnabled = true; // możesz wyłączyć jeśli chcesz

function parseSchedule(raw) {
    if (!raw) return [];
    return raw.split(',').map(slot => {
        const [start, end] = slot.trim().split('-');
        return { start, end };
    });
}

function timeToMinutes(t) {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    if (h === 24) return 24 * 60; // 24:00 = koniec dnia
    return h * 60 + m;
}

function isInSlot(nowMin, slot) {
    const s = timeToMinutes(slot.start);
    const e = timeToMinutes(slot.end);
    if (s <= e) {
        return nowMin >= s && nowMin < e;
    }
    // slot nocny: np. 22:00-03:00
    return nowMin >= s || nowMin < e;
}

async function stopBotBrowser() {
    try {
        if (browserInstance) {
            console.log('[WATCHDOG] Zamykam przeglądarkę — poza harmonogramem');
            await browserInstance.close();
        }
    } catch (e) {
        console.error('[WATCHDOG] Błąd zamykania:', e);
    } finally {
        browserInstance = null;
        page = null;
    }
}

async function watchdogStart() {
    if (watchdogInterval) return;

    watchdogInterval = setInterval(async () => {
        if (!scheduleEnabled) return;

        const settings = db.getAllSettings();
        const raw = settings.maw_schedule || '';
        scheduleSlots = parseSchedule(raw);

        if (!scheduleSlots.length) return;

        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();

        const active = scheduleSlots.some(slot => isInSlot(nowMin, slot));

        if (active) {
            if (!browserInstance && !isStartingBrowser) {
                console.log('[WATCHDOG] Aktywny slot — uruchamiam bota');
                startBotBrowser().catch(e => console.error('[WATCHDOG] Start error:', e));
            }
        } else {
            if (browserInstance) {
                await stopBotBrowser();
            }
        }
    }, 30000);

    console.log('[WATCHDOG] Harmonogram aktywny — sprawdzanie co 30s');
}

// ═══ Inicjalizacja ═══
db.init();
loadCharsFromDB();
loadDropsFromDB();
console.log(`
╔══════════════════════════════════════════════════════════╗
║   🤖  MARGONEM STANDALONE BOT  v4.0                     ║
║   Puppeteer + SQLite + OpenRouter AI + Redis             ║
╚══════════════════════════════════════════════════════════╝
`);
console.log(`[CFG] Port: ${PORT} | Headless: ${HEADLESS} | Serwer: ${GAME_SERVER}`);
console.log(`[CFG] AI Model: ${process.env.MAW_AI_MODEL || 'meta-llama/llama-3-8b-instruct:free'}`);
console.log(`[CFG] Redis: ${process.env.MAW_REDIS_ENABLED !== 'false' ? 'ON' : 'OFF (in-memory)'}`);

// ═══ MIME types ═══
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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
}

function sendJson(res, status, data) {
    corsHeaders(res);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            if (!raw) return resolve(null);
            try { resolve(JSON.parse(raw)); }
            catch (e) { reject(e); }
        });
        req.on('error', reject);
    });
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

    // Jeśli plik istnieje w folderze dashboard/ (np. /app.js, /style.css, gdy strona ładowana z root /)
    const fallbackPath = path.join(DASHBOARD_DIR, clean.slice(1));
    if (fs.existsSync(fallbackPath) && fs.statSync(fallbackPath).isFile()) {
        return fallbackPath;
    }

    return null;
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

// ════════════════════════════════════════════════════════════
//  HTTP API SERVER
// ════════════════════════════════════════════════════════════
const server = http.createServer(async (req, res) => {
    const urlPath = req.url || '/';

    if (req.method === 'OPTIONS') {
        corsHeaders(res);
        res.writeHead(204);
        res.end();
        return;
    }

    // ── Stan bota ──
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

                // Zapisz w Redis (cache 30s TTL)
                await redis.setJson('maw:state', body, 30);

                if (body && body.hero) {
                    if (body.hero.name) {
                        activeChar = body.hero.name;
                    }
                    db.logEvent('STATE_UPDATE', `Postać: ${body.hero.name}, HP: ${body.hero.hp || '?'}%`);
                }

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
    }

// ── Konfiguracja bota ──
if (urlPath.startsWith('/api/config')) {
    if (req.method === 'POST') {
        try {
            const body = await readBody(req);
            if (body && typeof body === 'object') {
                pendingConfigPatch = { ...pendingConfigPatch, ...body };

                for (const [k, v] of Object.entries(body)) {
                    db.saveSetting(k, v);
                }

                // === NOWA FUNKCJONALNOŚĆ: Auto Return to E2 ===
                if (typeof body.autoReturnToE2 !== 'undefined' && page && !page.isClosed()) {
                    await page.evaluate((enabled) => {
                        window.AUTO_RETURN_TO_E2 = !!enabled;
                        console.log(`[MAW] Auto Return to E2 → ${enabled ? 'WŁĄCZONY' : 'WYŁĄCZONY'}`);
                    }, body.autoReturnToE2);
                }

                sendJson(res, 200, { ok: true });
            } else {
                sendJson(res, 400, { ok: false, error: 'Invalid config payload' });
            }
        } catch (e) {
            sendJson(res, 400, { ok: false, error: 'Invalid JSON' });
        }
        return;
    }
    if (req.method === 'GET') {
        sendJson(res, 200, { ok: true, settings: db.getAllSettings() });
        return;
    }
}

    // ── Postacie (lista + wybor) ──
    if (urlPath.startsWith('/api/chars')) {
        if (req.method === 'GET') {
            sendJson(res, 200, { ok: true, chars: charsCache, active: activeChar });
            return;
        }
        if (urlPath === '/api/chars' && req.method === 'POST') {
            try {
                const body = await readBody(req);
                const charList = Array.isArray(body) ? body : (body && Array.isArray(body.chars) ? body.chars : null);
                if (charList && charList.length > 0) {
                    mergeChars(charList);
                    console.log(`[API] 👥 Zaktualizowano charsCache z bota (${charsCache.length} postaci)`);
                    sendJson(res, 200, { ok: true, count: charsCache.length, chars: charsCache });
                } else {
                    sendJson(res, 400, { ok: false, error: 'Brak postaci w payloadzie' });
                }
            } catch (e) {
                sendJson(res, 400, { ok: false, error: e.message });
            }
            return;
        }
        if (urlPath === '/api/chars/select' && req.method === 'POST') {
            try {
                const body = await readBody(req);
                const nick = (body && body.nick) ? String(body.nick) : '';
                if (!nick) { sendJson(res, 400, { ok: false, error: 'Brak nicku' }); return; }

                // Znajdź world z cache dla tej postaci
                const charObj = charsCache.find(c => c.nick && c.nick.toLowerCase() === nick.toLowerCase());
                const world = charObj ? charObj.world : null;

                activeChar = nick;
                pendingConfigPatch.forceRelogToChar = nick;
                console.log(`[API] Zmiana postaci na: ${nick} (${world || 'dowolny'})`);

                if (page && !page.isClosed()) {
                    // Ustaw target w localStorage
                    await page.evaluate((charName) => {
                        localStorage.setItem('e2h_target_char', charName);
                        localStorage.setItem('e2h_target_char_time', String(Date.now()));
                    }, nick);

                    console.log(`[API] Przekierowanie do strony głównej i restart pętli logowania...`);
                    
                    // Wywołaj asynchronicznie, żeby nie blokować odpowiedzi API
                    page.goto('https://www.margonem.pl/', {
                        waitUntil: 'domcontentloaded',
                        timeout: 20000
                    }).catch(err => {
                        console.log('[API] Goto Margonem.pl (silent):', err.message);
                    });

                    if (_restartLoginLoopFn) {
                        _restartLoginLoopFn();
                    }
                }

                sendJson(res, 200, { ok: true, nick, world: world || null });
            } catch (e) {
                sendJson(res, 400, { ok: false, error: e.message });
            }
            return;
        }
    }   

    // ── Dropy per postać ──
    if (urlPath.startsWith('/api/drops')) {
        if (req.method === 'GET') {
            sendJson(res, 200, { ok: true, drops: dropsPerChar });
            return;
        }
        if (req.method === 'POST') {
            try {
                const body = await readBody(req);
                // { nick, leg, hero, uni, kills, e2kills, expGained, goldGained }
                if (body && body.nick) {
                    const nick = body.nick;
                    
                    if (!dropsPerChar[nick]) {
                        dropsPerChar[nick] = { leg: 0, hero: 0, uni: 0, kills: 0, e2kills: 0, expGained: 0, goldGained: 0 };
                    }
                    if (!lastSessionStats[nick]) {
                        lastSessionStats[nick] = { leg: 0, hero: 0, uni: 0, kills: 0, e2kills: 0, expGained: 0, goldGained: 0 };
                    }

                    const current = dropsPerChar[nick];
                    const session = lastSessionStats[nick];

                    const fields = ['leg', 'hero', 'uni', 'kills', 'e2kills', 'expGained', 'goldGained'];
                    fields.forEach(field => {
                        const val = body[field] || 0;
                        if (val < (session[field] || 0)) {
                            session[field] = 0;
                        }
                        const delta = val - (session[field] || 0);
                        current[field] = (current[field] || 0) + delta;
                        session[field] = val;
                    });
                    
                    current.updatedAt = Date.now();

                    // Persystuj do SQLite
                    saveDropsToDB();
                }
                sendJson(res, 200, { ok: true });
            } catch (e) {
                sendJson(res, 400, { ok: false, error: e.message });
            }
            return;
        }
    }

    // ── Timery E2 ──
    if (urlPath.startsWith('/api/timers')) {
        if (req.method === 'GET') {
            sendJson(res, 200, { ok: true, timers: timersCache });
            return;
        }
        if (req.method === 'POST') {
            try {
                const body = await readBody(req);
                if (Array.isArray(body)) { timersCache = body; }
                sendJson(res, 200, { ok: true });
            } catch (e) {
                sendJson(res, 400, { ok: false, error: e.message });
            }
            return;
        }
    }

    // ── Harmonogram ──
    if (urlPath.startsWith('/api/schedule')) {
        if (req.method === 'GET') {
            sendJson(res, 200, { ok: true, schedule: scheduleConfig });
            return;
        }
        if (req.method === 'POST') {
            try {
                const body = await readBody(req);
                if (body && typeof body === 'object') {
                    if (typeof body.enabled !== 'undefined') scheduleConfig.enabled = !!body.enabled;
                    if (typeof body.slots !== 'undefined') scheduleConfig.slots = String(body.slots);
                }
                // Przekaż do bota przez pendingConfigPatch
                pendingConfigPatch.scheduleEnabled = scheduleConfig.enabled;
                pendingConfigPatch.scheduleSlots   = scheduleConfig.slots;
                sendJson(res, 200, { ok: true, schedule: scheduleConfig });
            } catch (e) {
                sendJson(res, 400, { ok: false, error: e.message });
            }
            return;
        }
    }

    // ── Wyloguj z gry (relog) ──
    if (urlPath === '/api/browser/logout' && req.method === 'POST') {
        if (page && !page.isClosed()) {
            try {
                await page.goto('https://www.margonem.pl/', { waitUntil: 'domcontentloaded', timeout: 15000 });
                sendJson(res, 200, { ok: true });
            } catch (e) {
                sendJson(res, 500, { ok: false, error: e.message });
            }
        } else {
            sendJson(res, 503, { ok: false, error: 'Brak przeglądarki' });
        }
        return;
    }


    // ── AI Chat (OpenRouter) ──
    if (urlPath.startsWith('/api/ai/chat')) {
        if (req.method === 'POST') {
            try {
                const body = await readBody(req);
                const { author, message, channel } = body || {};

                if (!author || !message) {
                    sendJson(res, 400, { ok: false, error: 'Brak nadawcy lub wiadomości' });
                    return;
                }

                // Zapisz w SQLite
                db.saveChatMessage(channel || 'GROUP', author, message);

                // Zapisz w Redis (lista ostatnich wiadomości)
                await redis.pushList('maw:chat:recent', JSON.stringify({
                    ts: Date.now(), channel, author, message
                }));

                // Zdecyduj czy odpowiedzieć
                const shouldReply = ai.shouldReplyToChat(message);

                if (shouldReply) {
                    const history = db.getRecentChatHistory(10);
                    const reply = await ai.generateResponse(author, message, history);

                    if (reply) {
                        db.saveChatMessage(channel || 'GROUP', process.env.MAW_BOT_NICK || 'Certyfikowany Janusz', reply, message);
                        await redis.publish('maw:chat:reply', JSON.stringify({ channel, reply }));
                        sendJson(res, 200, { ok: true, shouldReply: true, reply });
                        return;
                    }
                }

                sendJson(res, 200, { ok: true, shouldReply: false });
            } catch (err) {
                console.error('[API] Błąd w obsłudze AI chat:', err);
                sendJson(res, 500, { ok: false, error: err.message });
            }
            return;
        }
    }

    // ── Logi bota ──
    if (urlPath.startsWith('/api/logs')) {
        if (req.method === 'GET') {
            try {
                const logs = db.getRecentLogs ? db.getRecentLogs(50) : [];
                sendJson(res, 200, { ok: true, logs });
            } catch (e) {
                sendJson(res, 200, { ok: true, logs: [] });
            }
            return;
        }
    }

    // ── Puppeteer: wykonaj komendę w przeglądarce ──
    if (urlPath.startsWith('/api/browser/eval')) {
        if (req.method === 'POST' && page) {
            try {
                const body = await readBody(req);
                const result = await page.evaluate(body.code);
                sendJson(res, 200, { ok: true, result });
            } catch (err) {
                sendJson(res, 500, { ok: false, error: err.message });
            }
            return;
        }
    }

    // ── Puppeteer: screenshot ──
    if (urlPath === '/api/browser/screenshot' && req.method === 'GET') {
        if (page) {
            try {
                const buf = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 70 });
                sendJson(res, 200, { ok: true, image: buf });
            } catch (err) {
                sendJson(res, 500, { ok: false, error: err.message });
            }
        } else {
            sendJson(res, 503, { ok: false, error: 'Przeglądarka nie uruchomiona' });
        }
        return;
    }

    // ── Pliki statyczne (hosted/, dashboard/) ──
    const filePath = resolveStatic(urlPath);
    if (!filePath || !filePath.startsWith(ROOT)) {
        corsHeaders(res);
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
        return;
    }
    serveFile(res, filePath);
});

// ════════════════════════════════════════════════════════════
//  PUPPETEER — Chromium z wstrzykiwaniem bota
// ════════════════════════════════════════════════════════════
async function startBotBrowser() {
    if (isStartingBrowser) {
        console.log('[Puppeteer] Próba uruchomienia przeglądarki zignorowana — start w toku.');
        return;
    }
    isStartingBrowser = true;

    try {
        console.log('[Puppeteer] Uruchamianie Chromium...');
        const userDataDir = path.join(ROOT, 'browser_profile');

        if (browserInstance) {
            try {
                await browserInstance.close();
            } catch {}
            browserInstance = null;
        }

                // Na Linuksie (np. VPS) użyj systemowego Chromium, jeśli istnieje.
                // Na Windowsie (albo gdy ścieżka nie istnieje) Puppeteer użyje
                // własnej, wbudowanej przeglądarki pobranej przy npm install.
                const linuxChromiumPath = '/usr/bin/chromium-browser';
                const useSystemChromium =
                    process.platform === 'linux' && fs.existsSync(linuxChromiumPath);

                // Flagi typu --single-process / --no-zygote / --disable-gpu / --disable-dev-shm-usage
                // są sensowne tylko na ograniczonych VPS-ach linuksowych. Na Windowsie / desktopie
                // potrafią powodować crash Chromium chwilę po starcie (dokładnie objaw:
                // "Przeglądarka rozłączona!" + "frame detached" przy próbie nawigacji).
                const isLinuxVps = process.platform === 'linux';

                const browser = await puppeteer.launch({
            headless: HEADLESS,
            userDataDir,
            defaultViewport: HEADLESS ? { width: 1280, height: 960 } : null,
            ...(useSystemChromium ? { executablePath: linuxChromiumPath } : {}),
            // Usuwamy --enable-automation z domyślnych flag Chromium
            ignoreDefaultFlags: false,
            args: [
                ...(isLinuxVps ? [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--single-process',
                    '--disable-gpu',
                    '--no-zygote',
                ] : []),
                '--disable-accelerated-2d-canvas',
                '--disable-software-rasterizer',
                '--window-size=1280,960',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                // ═══ STEALTH: ukrywanie automatyzacji ═══
                '--disable-blink-features=AutomationControlled',  // Kluczowe! Usuwa navigator.webdriver
                '--disable-infobars',                             // Ukrywa "Chrome is being controlled..."
                '--excludeSwitches=enable-automation',             // Usuwa flagę automatyzacji
                '--disable-component-extensions-with-background-pages',
                '--disable-default-apps',
                '--disable-extensions',
                '--disable-hang-monitor',
                '--disable-popup-blocking',
                '--disable-prompt-on-repost',
                '--disable-sync',
                '--disable-translate',
                '--metrics-recording-only',
                '--no-first-run',
                '--password-store=basic',
                '--use-mock-keychain',
                '--lang=pl-PL,pl',
            ],
        });
        browserInstance = browser;

        const pages = await browser.pages();
        page = pages[0] || await browser.newPage();

        // ── AGRESYWNE OGRANICZANIE ZASOBÓW (Lekka wersja na VPS) ──
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (['image', 'font', 'media'].includes(resourceType)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        console.log('[Puppeteer] ✅ Połączenie bez proxy (bezpośrednio)');

    // ═══════════════════════════════════════════════════════════
    //  STEALTH: Ukrywanie WebDriver na 100%
    // ═══════════════════════════════════════════════════════════

    // Realistyczny Chrome User-Agent (pasujący do Chrome, nie Firefox!)
    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
    );

    // Dodatkowe nagłówki HTTP imitujące prawdziwą przeglądarkę
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
        'sec-ch-ua': '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="8"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
    });

    // ── Główny skrypt stealth (wstrzykiwany PRZED załadowaniem jakiejkolwiek strony) ──
    await page.evaluateOnNewDocument(() => {
        // ────────────────────────────────────────
        // 1. navigator.webdriver = undefined
        // ────────────────────────────────────────
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
            configurable: true,
        });
        // Usuń też z prototype
        try {
            const proto = Object.getPrototypeOf(navigator);
            if (proto && Object.getOwnPropertyDescriptor(proto, 'webdriver')) {
                delete proto.webdriver;
            }
        } catch {}

        // ────────────────────────────────────────
        // 2. window.chrome — prawdziwy obiekt Chrome
        // ────────────────────────────────────────
        if (!window.chrome) {
            window.chrome = {};
        }
        window.chrome.app = {
            isInstalled: false,
            InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
            RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
            getDetails: function() { return null; },
            getIsInstalled: function() { return false; },
            installState: function(cb) { if (cb) cb('not_installed'); },
            runningState: function() { return 'cannot_run'; },
        };
        window.chrome.runtime = {
            OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
            OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
            PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
            PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
            PlatformOs: { ANDROID: 'android', CROS: 'cros', FUCHSIA: 'fuchsia', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
            RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
            connect: function() { return { onDisconnect: { addListener: function() {} }, onMessage: { addListener: function() {} }, postMessage: function() {} }; },
            sendMessage: function() {},
            id: undefined,
        };
        window.chrome.csi = function() {
            return {
                startE: Date.now(),
                onloadT: Date.now(),
                pageT: Math.random() * 1000 + 500,
                tran: 15,
            };
        };
        window.chrome.loadTimes = function() {
            return {
                commitLoadTime: Date.now() / 1000,
                connectionInfo: 'h2',
                finishDocumentLoadTime: Date.now() / 1000 + 0.5,
                finishLoadTime: Date.now() / 1000 + 1.2,
                firstPaintAfterLoadTime: 0,
                firstPaintTime: Date.now() / 1000 + 0.3,
                navigationType: 'Other',
                npnNegotiatedProtocol: 'h2',
                requestTime: Date.now() / 1000 - 0.2,
                startLoadTime: Date.now() / 1000,
                wasAlternateProtocolAvailable: false,
                wasFetchedViaSpdy: true,
                wasNpnNegotiated: true,
            };
        };

        // ────────────────────────────────────────
        // 3. navigator.plugins — realistyczna lista
        // ────────────────────────────────────────
        function makePluginArray(pluginData) {
            const plugins = [];
            pluginData.forEach((pd, i) => {
                const plugin = Object.create(Plugin.prototype);
                Object.defineProperties(plugin, {
                    name: { value: pd.name, enumerable: true },
                    description: { value: pd.description, enumerable: true },
                    filename: { value: pd.filename, enumerable: true },
                    length: { value: pd.mimeTypes ? pd.mimeTypes.length : 0, enumerable: true },
                });
                plugins.push(plugin);
            });
            // Imitujemy PluginArray
            const pluginArray = Object.create(PluginArray.prototype);
            plugins.forEach((p, i) => {
                Object.defineProperty(pluginArray, i, { value: p, enumerable: true });
                Object.defineProperty(pluginArray, p.name, { value: p, enumerable: false });
            });
            Object.defineProperty(pluginArray, 'length', { value: plugins.length, enumerable: true });
            Object.defineProperty(pluginArray, 'item', { value: function(idx) { return this[idx] || null; } });
            Object.defineProperty(pluginArray, 'namedItem', { value: function(name) { return this[name] || null; } });
            Object.defineProperty(pluginArray, 'refresh', { value: function() {} });
            return pluginArray;
        }

        try {
            const fakePlugins = makePluginArray([
                { name: 'PDF Viewer', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
                { name: 'Chrome PDF Viewer', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
                { name: 'Chromium PDF Viewer', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
                { name: 'Microsoft Edge PDF Viewer', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
                { name: 'WebKit built-in PDF', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
            ]);
            Object.defineProperty(navigator, 'plugins', { get: () => fakePlugins, configurable: true });
        } catch {}

        // ────────────────────────────────────────
        // 4. navigator.languages
        // ────────────────────────────────────────
        Object.defineProperty(navigator, 'languages', {
            get: () => ['pl-PL', 'pl', 'en-US', 'en'],
            configurable: true,
        });

        // ────────────────────────────────────────
        // 5. navigator.permissions — ukryj "denied" na notifications
        // ────────────────────────────────────────
        const originalQuery = window.Permissions?.prototype?.query;
        if (originalQuery) {
            window.Permissions.prototype.query = function(parameters) {
                if (parameters.name === 'notifications') {
                    return Promise.resolve({ state: Notification.permission });
                }
                return originalQuery.call(this, parameters);
            };
        }

        // ────────────────────────────────────────
        // 6. navigator.hardwareConcurrency
        // ────────────────────────────────────────
        Object.defineProperty(navigator, 'hardwareConcurrency', {
            get: () => 8,
            configurable: true,
        });

        // ────────────────────────────────────────
        // 7. navigator.deviceMemory
        // ────────────────────────────────────────
        Object.defineProperty(navigator, 'deviceMemory', {
            get: () => 8,
            configurable: true,
        });

        // ────────────────────────────────────────
        // 8. navigator.platform
        // ────────────────────────────────────────
        Object.defineProperty(navigator, 'platform', {
            get: () => 'Win32',
            configurable: true,
        });

        // ────────────────────────────────────────
        // 9. navigator.vendor
        // ────────────────────────────────────────
        Object.defineProperty(navigator, 'vendor', {
            get: () => 'Google Inc.',
            configurable: true,
        });

        // ────────────────────────────────────────
        // 10. navigator.maxTouchPoints (desktop = 0)
        // ────────────────────────────────────────
        Object.defineProperty(navigator, 'maxTouchPoints', {
            get: () => 0,
            configurable: true,
        });

        // ────────────────────────────────────────
        // 11. navigator.connection
        // ────────────────────────────────────────
        if (!navigator.connection) {
            Object.defineProperty(navigator, 'connection', {
                get: () => ({
                    effectiveType: '4g',
                    rtt: 50,
                    downlink: 10,
                    saveData: false,
                }),
                configurable: true,
            });
        }

        // ────────────────────────────────────────
        // 12. WebGL — realistyczny renderer i vendor
        // ────────────────────────────────────────
        const getParameterOrig = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(parameter) {
            // UNMASKED_VENDOR_WEBGL
            if (parameter === 0x9245) return 'Google Inc. (NVIDIA)';
            // UNMASKED_RENDERER_WEBGL
            if (parameter === 0x9246) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)';
            return getParameterOrig.call(this, parameter);
        };
        // Tak samo dla WebGL2
        if (typeof WebGL2RenderingContext !== 'undefined') {
            const getParam2Orig = WebGL2RenderingContext.prototype.getParameter;
            WebGL2RenderingContext.prototype.getParameter = function(parameter) {
                if (parameter === 0x9245) return 'Google Inc. (NVIDIA)';
                if (parameter === 0x9246) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)';
                return getParam2Orig.call(this, parameter);
            };
        }

        // ────────────────────────────────────────
        // 13. Ukryj iframe.contentWindow.chrome detection
        // ────────────────────────────────────────
        try {
            const origCreateElement = document.createElement.bind(document);
            // Monkey-patch createElement żeby iframe-y też miały chrome
            // (niektóre fingerprinters tworzą iframe i sprawdzają .contentWindow.chrome)
        } catch {}

        // ────────────────────────────────────────
        // 14. Ukryj cdc_ (chromedriver) properties
        // ────────────────────────────────────────
        const cleanCdcProps = () => {
            try {
                const props = Object.getOwnPropertyNames(document);
                for (const prop of props) {
                    if (prop.match(/^cdc_|^\$cdc_|^\$wdc_/)) {
                        delete document[prop];
                    }
                }
                // Sprawdź też window
                const winProps = Object.getOwnPropertyNames(window);
                for (const prop of winProps) {
                    if (prop.match(/^cdc_|^\$cdc_|^\$wdc_|^__webdriver/)) {
                        delete window[prop];
                    }
                }
            } catch {}
        };
        cleanCdcProps();
        // Powtarzaj czyszczenie co 2s (na wypadek gdyby driver dodał je po starcie)
        setInterval(cleanCdcProps, 2000);

        // ────────────────────────────────────────
        // 15. Ukryj Function.toString() patchowanie
        // ────────────────────────────────────────
        // Zaawansowane fingerprinters robią: myFunction.toString() i szukają "[native code]"
        // Po monkey-patchu, toString() zwraca kod źródłowy zamiast "[native code]".
        // Naprawiamy to:
        const nativeToString = Function.prototype.toString;
        const patchedFunctions = new Set();

        function makeFunctionNative(fn, nativeName) {
            patchedFunctions.add(fn);
            const nativeStr = `function ${nativeName || fn.name || ''}() { [native code] }`;
            fn._nativeStr = nativeStr;
        }

        Function.prototype.toString = function() {
            if (patchedFunctions.has(this) && this._nativeStr) {
                return this._nativeStr;
            }
            return nativeToString.call(this);
        };
        makeFunctionNative(Function.prototype.toString, 'toString');

        // Napraw toString dla nadpisanych getterów
        try {
            // navigator.webdriver getter
            const webdriverDesc = Object.getOwnPropertyDescriptor(navigator, 'webdriver');
            if (webdriverDesc && webdriverDesc.get) makeFunctionNative(webdriverDesc.get, 'get webdriver');

            // navigator.plugins getter
            const pluginsDesc = Object.getOwnPropertyDescriptor(navigator, 'plugins');
            if (pluginsDesc && pluginsDesc.get) makeFunctionNative(pluginsDesc.get, 'get plugins');

            // navigator.languages getter
            const langDesc = Object.getOwnPropertyDescriptor(navigator, 'languages');
            if (langDesc && langDesc.get) makeFunctionNative(langDesc.get, 'get languages');

            // Permissions.query
            if (window.Permissions?.prototype?.query) {
                makeFunctionNative(window.Permissions.prototype.query, 'query');
            }

            // chrome.runtime.connect
            if (window.chrome?.runtime?.connect) {
                makeFunctionNative(window.chrome.runtime.connect, 'connect');
            }
        } catch {}

        // ────────────────────────────────────────
        // 16. window.Notification.permission
        // ────────────────────────────────────────
        try {
            if (typeof Notification !== 'undefined') {
                Object.defineProperty(Notification, 'permission', {
                    get: () => 'default',
                    configurable: true,
                });
            }
        } catch {}

        // ────────────────────────────────────────
        // 17. Sourcebuffer detection (headless)
        // ────────────────────────────────────────
        if (typeof window.MediaSource !== 'undefined') {
            try {
                if (!window.MediaSource.isTypeSupported) {
                    window.MediaSource.isTypeSupported = function() { return true; };
                }
            } catch {}
        }

        console.log('[Stealth] 🛡️ WebDriver stealth załadowany (17 modułów)');
    });

    // ── GM_* polyfille + MAW_NODE_API ──
    await page.evaluateOnNewDocument((port) => {
        // Ukrywanie/nadpisywanie flagi automatyzacji navigator.webdriver
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined
        });

        window.MAW_NODE_API = `http://127.0.0.1:${port}`;
        window.MAW_STANDALONE = true;

        // Polyfill dla window._g - wywoływanie akcji sieciowych bezpośrednio przez silnik gry Margonem
        window._g = function(query, callback) {
            if (window.g && typeof window.g._g === 'function') {
                return window.g._g(query, callback);
            }
            if (window.Engine && window.Engine.communication && typeof window.Engine.communication.send === 'function') {
                // Alternatywny parser dla silnika NI
                return window.Engine.communication.send(query, callback);
            }
            console.warn('[MAW] window._g wywołane, ale silnik gry nie jest gotowy:', query);
            return false;
        };

        window.GM_getValue = function(key, defaultValue) {
            try {
                const val = localStorage.getItem('GM_' + key);
                return val !== null ? JSON.parse(val) : defaultValue;
            } catch { return defaultValue; }
        };

        window.GM_setValue = function(key, value) {
            try { localStorage.setItem('GM_' + key, JSON.stringify(value)); }
            catch {}
        };

        window.GM_deleteValue = function(key) {
            try { localStorage.removeItem('GM_' + key); }
            catch {}
        };

        window.GM_listValues = function() {
            const keys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith('GM_')) keys.push(k.slice(3));
            }
            return keys;
        };

        window.GM_xmlhttpRequest = function(details) {
            const method = details.method || 'GET';
            const url = details.url;
            const headers = details.headers || {};
            const data = details.data;

            fetch(url, { method, headers, body: data })
                .then(res => res.text().then(text => ({ res, text })))
                .then(({ res, text }) => {
                    if (details.onload) {
                        details.onload({
                            status: res.status,
                            statusText: res.statusText,
                            responseText: text,
                            responseHeaders: [...res.headers.entries()]
                                .map(([k, v]) => `${k}: ${v}`).join('\r\n'),
                        });
                    }
                })
                .catch(err => {
                    if (details.onerror) details.onerror(err);
                });
        };

        window.GM_addStyle = function(css) {
            const style = document.createElement('style');
            style.textContent = css;
            (document.head || document.documentElement).appendChild(style);
        };

        window.GM_registerMenuCommand = function() {}; // noop w Puppeteer
        window.GM_getResourceText = function() { return ''; };
        window.GM_getResourceURL = function() { return ''; };
        window.GM_info = { script: { name: 'MAW Standalone', version: '4.0.0' } };

        // Globalny wrapper unsafeWindow (w Puppeteer = window)
        window.unsafeWindow = window;
    }, PORT);

const loaderPath = path.join(__dirname, 'tampermonkey', 'e2-hunter-bot.user.js');

if (!fs.existsSync(loaderPath)) {
    console.error(`[Puppeteer] BRAK pliku userscriptu: ${loaderPath}`);
    console.error('[Puppeteer] Upewnij się, że plik e2-hunter-bot.user.js jest w folderze tampermonkey');
} else {
    const loaderCode = fs.readFileSync(loaderPath, 'utf8');
   
    await page.evaluateOnNewDocument((code) => {
        function injectBot() {
            const host = window.location.hostname || '';
            if (!host.includes('margonem.pl')) return;
            console.log('[MAW] 🚀 Wstrzykiwanie E2 Hunter Bot...');
            try {
                const fn = new Function(code);
                fn();
                console.log('[MAW] ✓ Bot załadowany pomyślnie');
            } catch (e) {
                console.error('[MAW] ✗ Błąd wstrzykiwania:', e.message);
                console.error(e.stack);
            }
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', injectBot);
        } else {
            injectBot();
        }
    }, loaderCode);
}
    // ── Navigacja ──
    console.log(`[Puppeteer] Nawigacja → ${GAME_URL}`);
    
    try {
        await page.goto(GAME_URL, { 
            waitUntil: 'domcontentloaded', 
            timeout: 20000 
        });
    } catch (err) {
        if (err.message.includes('ERR_TOO_MANY_REDIRECTS') || err.message.includes('net::ERR_')) {
            console.warn('[Puppeteer] Redirect loop wykryty — czyszczę cookies i ponawiam...');
            const client = await page.createCDPSession();
            await client.send('Network.clearBrowserCookies');
            await client.detach();
            await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
        } else if (err.message.includes('frame was detached') || err.message.includes('LifecycleWatcher disposed')) {
            console.warn('[Puppeteer] Nawigacja przerwana (frame detached) — ponawiam za 3s...');
            await new Promise(r => setTimeout(r, 3000));
            try {
                await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
            } catch (retryErr) {
                console.error('[Puppeteer] ✗ Druga próba nawigacji też się nie powiodła.');
                throw new Error(`NAVIGATION_FAILED: nawigacja nie powiodła się dwukrotnie (${retryErr.message})`);
            }
        } else {
            throw err;
        }
    }

    console.log('[Puppeteer] ✓ Strona załadowana:', await page.title());

    let autoLoginInterval = null;
    let loginTimeout = null;
    let introWaitStarted = 0;

// ── BEZPIECZNE WYBIERANIE POSTACI Z POPUPA (.charc) ──
const selectCharacterFromModal = async (page, targetCharName, targetWorld = null) => {
    if (!targetCharName || !page || page.isClosed()) return false;

    let cleanNick = targetCharName.toLowerCase().trim();
    let cleanWorld = targetWorld ? targetWorld.toLowerCase().trim() : null;

    // Obsługa nicków z światem w nawiasie np. "Janusz (Luvia)"
    const match = cleanNick.match(/^([^(|]+?)\s*[\(|]([^)]+)\)?$/);
    if (match) {
        cleanNick = match[1].trim();
        cleanWorld = match[2].trim();
    }

    const charElements = await page.$$('.charc');
    if (!charElements?.length) {
        console.warn('[Puppeteer] Brak elementów .charc na stronie.');
        return false;
    }

    let exactMatch = null;
    let partialMatch = null;

    for (const el of charElements) {
        const info = await page.evaluate(node => {
            const dataNick = node.getAttribute('data-nick') || '';
            const dataWorld = node.getAttribute('data-world') || '';
            const nameSpan = node.querySelector('.character-name, .nick, .name')?.textContent?.trim() || '';
            const worldSpan = node.querySelector('.world, .server')?.textContent?.replace(/^świat:\s*/i, '').trim() || '';
            const nickInput = node.querySelector('input[name="nick"]')?.value || '';
            const worldInput = node.querySelector('input[name="world"]')?.value || '';
            return {
                nick: (dataNick || nameSpan || nickInput).toLowerCase().trim(),
                world: (dataWorld || worldSpan || worldInput).toLowerCase().trim()
            };
        }, el);

        if (info.nick !== cleanNick) continue;

        const worldMatch = !cleanWorld ||
            info.world === cleanWorld ||
            info.world.includes(cleanWorld) ||
            cleanWorld.includes(info.world);

        if (worldMatch) {
            exactMatch = el;
            break; // najlepsze możliwe dopasowanie — przerywamy pętlę
        } else if (!partialMatch) {
            partialMatch = el; // sam nick pasuje, świat nie — zapasowa opcja
        }
    }

    const targetEl = exactMatch || partialMatch;
    if (!targetEl) {
        console.warn(`[Puppeteer] Nie znaleziono postaci: ${targetCharName}`);
        return false;
    }

    // Klik dwufazowy + scroll
    await page.evaluate(node => {
        node.scrollIntoView({ block: 'center', inline: 'center' });
        const child = node.querySelector('.character-name') || node.querySelector('.cimg') || node.querySelector('.charFitWrapper');
        (child || node).click();
    }, targetEl);

    await new Promise(r => setTimeout(r, 250));
    await targetEl.click().catch(() => {}); // drugi klik jako zabezpieczenie
    await new Promise(r => setTimeout(r, 250));

    console.log(`[Puppeteer] Kliknięto postać: ${targetCharName}`);
    return true;
};
    // ── FORCE RELOG HANDLER ──
    const doForceRelog = async (targetNick, targetWorld = null) => {
        if (!targetNick || !page || page.isClosed()) return;
        console.log(`[Puppeteer] 🔥 Force Relog na: ${targetNick} ${targetWorld ? '(' + targetWorld + ')' : ''}`);

        try {
            await page.goto('https://www.margonem.pl/', { 
                waitUntil: 'domcontentloaded', 
                timeout: 20000 
            });

            const isModalOpen = await page.$('.popup-select-character:not([style*="display: none"]), .char-container, .charlist');
            if (!isModalOpen) {
                const selectCharEl = await page.$('.charimg-container, .select-char');
                if (selectCharEl) {
                    await selectCharEl.click();
                    await page.waitForSelector('.popup-select-character, .charc', { timeout: 8000 }).catch(() => {});
                }
            } else {
                await page.waitForSelector('.charc, .char-container', { timeout: 8000 }).catch(() => {});
            }

            const clicked = await selectCharacterFromModal(page, targetNick, targetWorld);

            if (clicked) {
                console.log(`[Puppeteer] ✓ Wybrano postać: ${targetNick} (klik dwufazowy)`);
                await new Promise(r => setTimeout(r, 800));
                const enterBtn = await page.$('.enter-game, .box-enter .enter-game, .c-btn.enter-game, button.enter');
                if (enterBtn) {
                    await enterBtn.click();
                    console.log('[Puppeteer] ✓ Kliknięto "Wejdź do gry"');
                }
            } else {
                console.warn(`[Puppeteer] Nie znaleziono postaci: ${targetNick}`);
            }
        } catch (e) {
            console.error('[Puppeteer] Force relog error:', e.message);
        }
    };

    // Expose do global scope for API access
    _forceRelogFn = doForceRelog;

    // ── Automatyczne logowanie i wybór postaci ──
    const startAutoLoginLoop = () => {
        if (autoLoginInterval) clearInterval(autoLoginInterval);

        autoLoginInterval = setInterval(async () => {
            if (!page || page.isClosed()) return;

            try {
                const currentUrl = page.url();

                if (!currentUrl || currentUrl === 'about:blank' || !currentUrl.includes('margonem.pl')) {
                    if (!page._navigatingToMargonem) {
                        page._navigatingToMargonem = true;
                        console.warn(`[Puppeteer] Strona nie jest załadowana poprawnie (url: "${currentUrl}"). Próba ponownej nawigacji...`);
                        try {
                            await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
                            console.log('[Puppeteer] ✓ Nawigacja powtórzona pomyślnie.');
                        } catch (navErr) {
                            console.error('[Puppeteer] Ponowna nawigacja nie powiodła się (sieć nadal niedostępna):', navErr.message);
                        } finally {
                            page._navigatingToMargonem = false;
                        }
                    }
                    return;
                }

                if (currentUrl.includes('margonem.pl/register') || currentUrl.includes('margonem.pl/intro')) {
                    if (!introWaitStarted) {
                        introWaitStarted = Date.now();
                        console.log('[Puppeteer] Wykryto ekran rejestracji/intro. Oczekiwanie 15 sekund przed przejściem do logowania...');
                        return;
                    }
                    const elapsed = Date.now() - introWaitStarted;
                    if (elapsed < 15000) {
                        return;
                    }
                    console.log('[Puppeteer] Odczekano 15 sekund. Wymuszam twarde przejście na stronę logowania...');
                    introWaitStarted = 0;
                    await page.goto('https://www.margonem.pl/', { waitUntil: 'domcontentloaded', timeout: 20000 });
                    return;
                }
                
                introWaitStarted = 0;

                let targetChar = activeChar || process.env.MARGONEM_START_CHAR || '';
                if (targetChar && page && !page.isClosed()) {
                    await page.evaluate((tc) => {
                        localStorage.setItem('e2h_target_char', tc);
                        localStorage.setItem('e2h_target_char_time', String(Date.now()));
                    }, targetChar).catch(() => {});
                }

                // 1. Formularz logowania
                const hasLoginForm = await page.$('#login-form');
                if (hasLoginForm) {
                    const loginInput = await page.$('#login-input');
                    const passInput = await page.$('#login-password');
                    
                    if (loginInput && passInput) {
                        const currentLoginVal = await page.evaluate(el => el ? el.value : '', loginInput);
                        if (!currentLoginVal) {
                            console.log('[Puppeteer] Wpisywanie danych logowania...');
                            await loginInput.type(process.env.MARGONEM_USER, { delay: 50 + Math.random() * 50 });
                            await passInput.type(process.env.MARGONEM_PASS, { delay: 50 + Math.random() * 50 });

                            if (process.env.MARGONEM_TOTP) {
                                const totpShow = await page.$('#totp-show');
                                if (totpShow) {
                                    await totpShow.click();
                                    await page.waitForSelector('#totp-input', { visible: true });
                                    await page.type('#totp-input', process.env.MARGONEM_TOTP, { delay: 50 + Math.random() * 50 });
                                }
                            }
                            
                            console.log('[Puppeteer] Klikam "Zaloguj się"...');
                            await page.click('#js-login-btn');
                        }
                    }
                    return;
                }

                // Sprawdź czy popup/modal wyboru postaci jest otwarty i widoczny
                const isModalOpen = await page.evaluate(() => {
                    const el = document.querySelector('.popup-select-character, .char-container, .charlist');
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && style.visibility !== 'hidden';
                });

                if (isModalOpen) {
                    // 2b. Pełna lista postaci (popup/modal z wieloma postaciami)
                    try {
                        const scrapedChars = await page.evaluate(() => {
                            const nodes = Array.from(document.querySelectorAll('.charc'));
                            return nodes.map(el => {
                                const nick = el.getAttribute('data-nick')
                                    || el.querySelector('.nick, .name, .char-nick, .character-name')?.textContent?.trim()
                                    || '';
                                const id = el.getAttribute('data-id') || '';
                                const lvlRaw = el.getAttribute('data-lvl')
                                    || el.querySelector('.lvl, .level, .char-lvl, .clvl')?.textContent
                                    || '';
                                const lvl = parseInt(String(lvlRaw).replace(/\D/g, ''), 10) || null;
                                const profInput = el.querySelector('input[name="profname"]');
                                const prof = (profInput ? profInput.value : '')
                                    || (el.querySelector('.character-prof')?.textContent || '').replace(/,\s*$/, '').trim();
                                const world = el.getAttribute('data-world')
                                    || el.querySelector('.world, .server, .char-world')?.textContent?.trim()
                                    || '';
                                return { nick, id, lvl, prof, world };
                            }).filter(c => c.nick);
                        });
                        if (scrapedChars.length) {
                            mergeChars(scrapedChars);
                        }
                    } catch (e) {
                        console.error('[Puppeteer] Błąd scrapowania listy postaci:', e.message);
                    }

                    // Wybór konkretnej postaci
                    if (targetChar) {
                        let targetWorld = null;
                        const charObj = charsCache.find(c => 
                            c.nick.toLowerCase() === targetChar.toLowerCase()
                        );
                        if (charObj && charObj.world) {
                            targetWorld = charObj.world.toLowerCase();
                        }

                        console.log(`[Puppeteer] Szukam postaci: ${targetChar} (${targetWorld || 'dowolny świat'})`);

                        const clicked = await selectCharacterFromModal(page, targetChar, targetWorld);
                        if (clicked) {
                            console.log(`[Puppeteer] ✓ Wybrano postać: ${targetChar}`);
                            await new Promise(r => setTimeout(r, 1000));
                        } else {
                            console.warn(`[Puppeteer] Nie znaleziono postaci: ${targetChar} na liście!`);
                        }
                    }
                    return; // ważne — kończymy iterację
                }

                // 2a. Szybki panel wyboru postaci (jedna postać widoczna)
                const quickSelectBox = await page.$('#js-login-box .select-char');
                if (quickSelectBox) {
                    const quickChar = await page.evaluate(() => {
                        const nick = document.querySelector('#chnick')?.textContent.trim() || '';
                        if (!nick) return null;
                        const prof = document.querySelector('#charprof-name')?.textContent.trim() || '';
                        const lvlRaw = document.querySelector('#chlvl')?.textContent.trim() || '';
                        const lvl = parseInt(lvlRaw, 10) || null;
                        const world = document.querySelector('#chworld')?.textContent.trim() || '';
                        const id = document.querySelector('#chid')?.value || '';
                        return { nick, prof, lvl, world, id };
                    });
                    if (quickChar) mergeChars([quickChar]);
                    const shownNick = quickChar ? quickChar.nick : '';
                    const shownWorld = quickChar ? quickChar.world : '';

                    let targetWorld = null;
                    const charObj = charsCache.find(c => c.nick.toLowerCase() === targetChar.toLowerCase());
                    if (charObj && charObj.world) {
                        targetWorld = charObj.world;
                    }

                    const isCorrectChar = shownNick.toLowerCase() === targetChar.toLowerCase() &&
                        (!targetWorld || !shownWorld || shownWorld.toLowerCase().trim() === targetWorld.toLowerCase().trim());

                    if (isCorrectChar) {
                        const enterBtn = await page.$('.box-enter .enter-game, .c-btn.enter-game, .enter-game');
                        if (enterBtn) {
                            await enterBtn.click();
                            console.log(`[Puppeteer] Szybki panel — właściwa postać (${shownNick} (${shownWorld})). Wchodzę do gry...`);
                            clearInterval(autoLoginInterval);
                        }
                    } else {
                        if (!global._lastQuickPanelNick || global._lastQuickPanelNick !== shownNick) {
                            console.warn(`[Puppeteer] Szybki panel pokazuje "${shownNick}" (${shownWorld}), a potrzebujemy "${targetChar}" (${targetWorld || 'dowolny'}). Otwieram pełną listę postaci...`);
                            global._lastQuickPanelNick = shownNick;
                        }
                        const selectCharEl = await page.$('.charimg-container, .select-char');
                        if (selectCharEl) {
                            await selectCharEl.click();
                        }
                    }
                    return;
                }

                // 3. Wyłączenie pętli jeśli jesteśmy już w grze (Engine gotowy)
                const isGameLoaded = await page.evaluate(() => {
                    return typeof window.Engine !== 'undefined' && typeof window.Engine.hero !== 'undefined';
                });
                if (isGameLoaded) {
                    console.log('[Puppeteer] Gra załadowana. Wyłączam pętlę logowania.');
                    clearInterval(autoLoginInterval);
                }
            } catch (e) {
                console.error('[Puppeteer] Błąd w pętli auto-login:', e.message);
            }
        }, 2000); // sprawdzaj co 2 sekundy
    };

    _restartLoginLoopFn = startAutoLoginLoop;
    startAutoLoginLoop();

    // ── Konsola przeglądarki → logi Node ──
    page.on('console', msg => {
        const type = msg.type();
        const text = msg.text();
        if (text.includes('[MAW]') || text.includes('[CHAT]') || text.includes('[SKILL]') || text.includes('[E2H]')) {
            console.log(`[Browser:${type}] ${text}`);
        }
    });

    // ── Obserwuj crashe ──
    page.on('error', err => {
        console.error('[Puppeteer] Błąd strony:', err.message);
        db.logEvent('PAGE_ERROR', err.message);
    });

    page.on('pageerror', err => {
        console.error('[Puppeteer] JS Error:', err.message);
    });

let pageStateInterval;

    browser.on('disconnected', () => {
        if (browser !== browserInstance) return;
        console.error('[Puppeteer] ⚠ Przeglądarka rozłączona! Restart za 5s...');
        db.logEvent('BROWSER_DISCONNECT', 'Przeglądarka się zamknęła');
        
        if (typeof autoLoginInterval !== 'undefined') clearInterval(autoLoginInterval);
        if (typeof loginTimeout !== 'undefined') clearTimeout(loginTimeout);
        if (pageStateInterval) clearInterval(pageStateInterval);
        
        setTimeout(() => {
            console.log('[Puppeteer] Ponowne uruchamianie...');
            startBotBrowser().catch(e => console.error('[Puppeteer] Restart failed:', e));
        }, 5000);
    });

    
    pageStateInterval = setInterval(async () => {
        if (!page || page.isClosed()) return;

        const _url = page.url() || '';
        if (!_url.startsWith('https://www.margonem.pl')) return;

        try {
// ==================== TIMERY Z MINUTNIKA — NAJLEPSZA WERSJA ====================
            const timers = await page.evaluate(() => {
                const timersList = [];
                
                // NAJLEPSZE SELEKTORY DLA TWOJEGO HTML
                const rows = document.querySelectorAll(`
                    .elite-timer .row,
                    .elite-timer-wnd .row,
                    .npc-list .row,
                    .list .row.tw-list-item,
                    .scroll-pane .row
                `);

                console.log(`[Debug Timery] Znaleziono ${rows.length} wierszy`);

                rows.forEach((row, i) => {
                    // Nazwa
                    const nameEl = row.querySelector('.name-val, .name.cell .name, .name');
                    // Czas
                    const timeEl = row.querySelector('.time-val, .time.cell .time, .time');

                    if (!nameEl || !timeEl) return;

                    const rawName = nameEl.textContent.trim();
                    const cleanName = rawName.replace(/^\[E2?\]\s*/i, '').trim();
                    const timeStr = timeEl.textContent.trim();

                    if (!cleanName) return;

                    let seconds = 9999;
                    const parts = timeStr.split(':').map(n => parseInt(n, 10)).filter(n => !isNaN(n));

                    if (parts.length === 3) seconds = parts[0]*3600 + parts[1]*60 + parts[2];
                    else if (parts.length === 2) seconds = parts[0]*60 + parts[1];
                    else if (parts.length === 1) seconds = parts[0];

                    timersList.push({
                        name: cleanName,
                        rawName: rawName,
                        seconds: seconds,
                        map: window.Engine?.map?.d?.name || '—'
                    });

                    console.log(`[Debug Timer ${i+1}] ${cleanName} → ${seconds}s`);
                });

                return timersList;
            });

            // Wyślij do API
            if (timers && timers.length > 0) {
                try {
                    await fetch(`http://127.0.0.1:${PORT}/api/timers`, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify(timers)
                    });
                    console.log(`[Timers] ✅ Wysłano ${timers.length} timerów!`);
                } catch (e) {
                    console.warn('[Timers] Błąd wysyłania:', e.message);
                }
            } else {
                console.log('[Timers] Brak timerów w minutniku');
            }

            // ==================== STAN BOHATERA ====================
            const state = await page.evaluate(() => {
                if (!window.Engine || !window.Engine.hero?.d) return null;
                const h = window.Engine.hero.d;

                // Detekcja HP
                let hpPct = 100;
                if (h.warrior_stats) {
                    hpPct = Math.round((h.warrior_stats.hp / h.warrior_stats.maxhp) * 100);
                } else if (h.hp !== undefined) {
                    hpPct = Math.round(h.hp);
                }

                // Detekcja śmierci (HP = 0 lub stan duszka)
                const isDead = hpPct <= 0;

                // Detekcja stasis overlay
                let stasisWarning = false;
                const stasisEl = document.querySelector('.stasis-overlay, .stasis-incoming-overlay');
                if (stasisEl) {
                    const st = window.getComputedStyle(stasisEl);
                    stasisWarning = st.display !== 'none' && st.visibility !== 'hidden';
                }

                // Detekcja powrotu do E2 (flaga z userscript)
                const returningToE2 = !!window._needToReturnToE2;

                // Detekcja fazy walki
                let phase = 'idle';
                if (window.g?.battle || document.querySelector('.battle-window')) {
                    phase = 'fighting';
                } else if (isDead) {
                    phase = 'dead';
                } else if (returningToE2) {
                    phase = 'returning';
                }

                return {
                    hero: {
                        name: h.nick || h.name || '—',
                        lvl: h.lvl || null,
                        hp: hpPct,
                        x: h.x,
                        y: h.y,
                        mapId: window.Engine.map?.d?.id,
                        mapName: window.Engine.map?.d?.name || '—',
                    },
                    phase,
                    isDead,
                    stasisWarning,
                    returningToE2,
                    timestamp: Date.now(),
                };
            });

            if (state) {
                botState = state;
                stateUpdatedAt = Date.now();
                await redis.setJson('maw:state', state, 30);
            }

            // ==================== CAPTCHA + RELOG ====================
            await captchaSolver.checkAndSolveCaptcha(page);
            await captchaSolver.tryAutoRelog(page);

            // ==================== Relogger availability (opcjonalnie) ====================
            try {
                const reloggerGroups = await page.evaluate(() => {
                    const groups = Array.from(document.querySelectorAll('.relogger__char-group'));
                    return groups.map(g => ({
                        world: (g.getAttribute('data-world') || '').toLowerCase(),
                        chars: Array.from(g.querySelectorAll('.relogger__one-character')).map(c => ({
                            tipId: c.getAttribute('tip-id') || '',
                            available: !c.classList.contains('disabled'),
                        })),
                    }));
                });

                reloggerGroups.forEach(g => {
                    const worldChars = charsCache.filter(c => 
                        String(c.world || '').toLowerCase() === g.world
                    );
                    g.chars.forEach((rc, i) => {
                        const match = worldChars[i];
                        if (match) {
                            match.available = rc.available;
                            match.reloggerId = rc.tipId;
                        }
                    });
                });
            } catch (e) {
                // cichy fail
            }

        } catch (e) {
            if (!e.message.includes('Execution context') && !e.message.includes('Target closed')) {
                console.error('[pageStateInterval] Błąd:', e.message);
            }
        }
    }, 6500); // co 6.5 sekundy — dobry balans

    // ==================== SZYBKI CAPTCHA CHECK (co 3s) ====================
    setInterval(async () => {
        if (!page || page.isClosed()) return;
        try {
            const hasCaptcha = await page.evaluate(() => {
                const c = document.querySelector('.captcha');
                if (!c) return false;
                const s = window.getComputedStyle(c);
                return s.display !== 'none' && s.visibility !== 'hidden' && !c.hasAttribute('data-maw-solving');
            });
            if (hasCaptcha) {
                console.log('[Captcha] ⚡ Szybki check wykrył captchę — rozwiązuję...');
                await captchaSolver.checkAndSolveCaptcha(page);
            }
        } catch {}
    }, 3000);

    // ==================== ANTI-STASIS BACKUP (co 5s) ====================
    setInterval(async () => {
        if (!page || page.isClosed()) return;
        try {
            const kicked = await page.evaluate(() => {
                const el = document.querySelector('.stasis-overlay, .stasis-incoming-overlay');
                if (!el) return false;
                const st = window.getComputedStyle(el);
                if (st.display === 'none' || st.visibility === 'hidden') return false;

                // Stasis wykryty! Ruszamy postać
                if (window.Engine?.hero?.d) {
                    const h = window.Engine.hero.d;
                    const dx = Math.random() > 0.5 ? 1 : -1;
                    try {
                        window.Engine.hero.autoGoTo({ x: h.x + dx, y: h.y + dx });
                    } catch {}
                    return true;
                }
                return false;
            });
            if (kicked) {
                console.log('[Anti-Stasis] ⚡ Puppeteer backup: wykryto stasis, ruszam postacią!');
            }
        } catch {}
    }, 5000);

    console.log('[Puppeteer] ✓ Bot gotowy! Trwa automatyczne logowanie i wybieranie postaci...');
    console.log(`[API] Dashboard: http://127.0.0.1:${PORT}/dashboard`);
    } catch (e) {
        console.error('[Puppeteer] Fatalny błąd przy uruchamianiu przeglądarki:', e);
        throw e;
    } finally {
        isStartingBrowser = false;
    }
}

async function main() {
    await redis.connect();
    
    // PUBLICZNY NASŁUCH — kluczowa zmiana
    server.listen(PORT, LISTEN_HOST, () => {
        console.log(`[API] Serwer nasłuchuje na http://${LISTEN_HOST}:${PORT}`);
        console.log(`[API] Dashboard → http://botmargo.duckdns.org:${PORT}/dashboard`);
        console.log(`[API] IP → http://83.29.135.191:${PORT}/dashboard`);
    });

    if (process.env.MAW_WATCHDOG_ACTIVE !== 'true') {
        await startBotBrowser();
    }
}

main().catch(err => {
    console.error('[FATAL]', err);
    process.exit(1);
});