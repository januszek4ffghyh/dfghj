'use strict';

/* ═══════════════════════════════════════════
   MARGONEM E2 HUNTER — DASHBOARD APP.JS
   ═══════════════════════════════════════════ */

const API = window.location.origin; // http://127.0.0.1:3847

// ── STATE ──
let state = {
    chars: [],
    activeChar: '',
    timers: [],
    drops: {},
    botState: null,
    schedule: { enabled: false, slots: '' },
    connected: false,
    logs: [],
    charBossMap: {},
};

// ── HELPERS ──
function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => el.remove(), 3500);
}

function fmtSeconds(secs) {
    if (secs <= 0) return '✅ Aktywna!';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtNum(n) {
    if (!n || n === 0) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000)    return (n / 1000).toFixed(1) + 'k';
    return String(n);
}

function getHpClass(pct) {
    if (pct < 30) return 'low';
    if (pct < 60) return 'medium';
    return '';
}

function classForIcon(prof) {
    const icons = {
        'warrior': '⚔️', 'knight': '🛡️', 'bladedancer': '🗡️',
        'archer': '🏹', 'hunter': '🎯', 'ranger': '🌿',
        'mage': '🔮', 'wizard': '✨', 'shaman': '🌀',
        'druid': '🌳', 'bard': '🎵',
    };
    if (!prof) return '👤';
    const key = String(prof).toLowerCase();
    for (const [k, v] of Object.entries(icons)) if (key.includes(k)) return v;
    return '👤';
}

function parseTimeToMinutes(str) {
    const [h, m] = str.trim().split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    return Math.min(h * 60 + m, 1440);
}

function isScheduleActive(config) {
    if (!config.enabled) return null;
    const slots = (config.slots || '').split(',').map(s => s.trim()).filter(s => s);
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    for (const slot of slots) {
        const parts = slot.split('-');
        if (parts.length !== 2) continue;
        const start = parseTimeToMinutes(parts[0]);
        const end   = parseTimeToMinutes(parts[1]);
        if (start === null || end === null) continue;
        if (cur >= start && cur < end) return true;
    }
    return false;
}

// ── NAV (tabs) ──
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
        item.classList.add('active');
        document.getElementById(`tab-${item.dataset.tab}`).classList.add('active');
    });
});

// ── CHARS TAB ──
function renderChars() {
    const grid = document.getElementById('chars-grid');
    const { chars, activeChar, drops, charBossMap } = state;

    if (!chars.length) {
        grid.innerHTML = `<div class="empty-state"><div class="empty-icon">👤</div><div>Brak postaci — bot jeszcze nie zalogował się do gry</div></div>`;
        return;
    }

    grid.innerHTML = '';
    chars.forEach(ch => {
        const nick = ch.nick || ch.name || '?';
        const lvl  = ch.lvl  || ch.level || '?';
        const prof = ch.prof || ch.profession || '';
        const icon = classForIcon(prof);
        const isActive = nick.toLowerCase() === (activeChar || '').toLowerCase();
        const world = ch.world || 'luvia';
        const mapName = ch.mapName || ch.map_name || ch.location || '';
        const assignedBoss = charBossMap[nick.toLowerCase()] || 'Brak (nieaktywny)';

        // HP z aktualnego stanu bota (jeśli aktywna)
        let hpPct = null;
        if (isActive && state.botState && state.botState.hero) {
            const h = state.botState.hero;
            if (h.maxHp && h.hp) hpPct = Math.round(h.hp / h.maxHp * 100);
            else if (h.hp !== undefined && h.hp <= 100) hpPct = h.hp;
        }

        // Dropy tej postaci
        const d = drops[nick] || {};

        const card = document.createElement('div');
        card.className = 'char-card' + (isActive ? ' active-char' : '');
        
        let avatarHtml = `<div class="char-avatar">${icon}</div>`;
        if (ch.avatarUrl) {
            avatarHtml = `<div class="char-avatar" style="background-image: url('${ch.avatarUrl}'); background-size: contain; background-repeat: no-repeat; background-position: center; border-radius: 50%;"></div>`;
        }

        card.innerHTML = `
            <div class="char-top">
                ${avatarHtml}
                <div class="char-info">
                    <div class="char-name">${nick}</div>
                    <div class="char-meta">Lv${lvl} ${prof} · ${world}</div>
                </div>
                ${isActive ? '<span class="char-bot-badge">🤖 BOT</span>' : ''}
            </div>
            ${hpPct !== null ? `
            <div class="char-hp-row">
                <div class="char-hp-label"><span>HP</span><span>${hpPct}%</span></div>
                <div class="hp-bar-wrap"><div class="hp-bar-fill ${getHpClass(hpPct)}" style="width:${hpPct}%"></div></div>
            </div>` : ''}
            <div class="char-map">📍 ${mapName || 'Nieznana lokalizacja'}</div>
            <div class="char-card-boss">
                🎯 E2: <strong>${assignedBoss}</strong>
            </div>
            <div style="display:flex;gap:12px;margin-top:10px;font-size:11px;color:#64748b">
                <span title="Legendy">⭐ <b style="color:#c084fc">${d.leg || 0}</b></span>
                <span title="Heroiki">💙 <b style="color:#60a5fa">${d.hero || 0}</b></span>
                <span title="Unikaty">💛 <b style="color:#facc15">${d.uni || 0}</b></span>
                <span title="Zabójstwa E2">⚔️ <b style="color:#22c55e">${d.e2kills || 0}</b> E2</span>
            </div>
            <div class="char-actions">
                <button class="btn btn-success btn-sm btn-login" data-nick="${nick}">⚔️ Zaloguj</button>
                <button class="btn btn-ghost btn-sm btn-set-boss" data-nick="${nick}">🎯 Ustaw E2</button>
                ${isActive ? '<button class="btn btn-ghost btn-sm" disabled style="margin-left:auto">✅ Aktywna</button>' : ''}
            </div>
        `;
        grid.appendChild(card);
    });

    // Listeners
    grid.querySelectorAll('.btn-login').forEach(btn => {
        btn.addEventListener('click', () => {
            const nick = btn.dataset.nick;
            selectChar(nick);
        });
    });

    grid.querySelectorAll('.btn-set-boss').forEach(btn => {
        btn.addEventListener('click', () => {
            const nick = btn.dataset.nick;
            openE2Drawer(nick);
        });
    });
}

async function selectChar(nick) {
    try {
        toast(`🔄 Zlecam logowanie na: ${nick}...`, 'info');
        const res = await fetch(`${API}/api/chars/select`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nick })
        });
        const data = await res.json();
        if (data.ok) {
            toast(`✅ Logowanie na ${nick} zlecone`, 'success');
            state.activeChar = nick;
            renderChars();
        } else {
            toast(`❌ ${data.error || 'Nieznany błąd'}`, 'error');
        }
    } catch (e) {
        toast('❌ Brak połączenia z botem', 'error');
    }
}

// ── TIMERS TAB ──
let lastTimersData = []; // zapamiętujemy ostatnie dane z serwera

function renderTimers() {
    const list = document.getElementById('timers-list');
    let timers = [...(state.timers || [])];

    const search = document.getElementById('timer-search').value.toLowerCase().trim();
    const filter = document.getElementById('timer-filter').value;

    if (search) {
        timers = timers.filter(t => {
            const name = (t.name || t.rawName || t.npcName || '').toLowerCase();
            return name.includes(search);
        });
    }

    // Parsowanie + zachowanie stanu
    timers = timers.map(t => {
        let secs = null;
        if (typeof t.seconds === 'number') secs = t.seconds;
        else if (typeof t.timeLeft === 'number') secs = t.timeLeft;
        else if (typeof t.respawnAt === 'number') secs = Math.round(t.respawnAt / 1000 - (Date.now() / 1000));

        return { ...t, _secs: secs };
    });

    if (filter === 'soon') timers = timers.filter(t => t._secs !== null && t._secs >= 0 && t._secs < 600);
    if (filter === 'active') timers = timers.filter(t => t._secs !== null && t._secs <= 0);

    timers.sort((a, b) => (a._secs ?? 999999) - (b._secs ?? 999999));

    // Badge
    const urgentCount = timers.filter(t => t._secs !== null && t._secs >= 0 && t._secs <= 600).length;
    const badge = document.getElementById('nav-badge-timers');
    badge.textContent = state.timers.length || 0;
    if (urgentCount > 0) {
        badge.classList.add('urgent');
        badge.textContent = `🔴 ${urgentCount}`;
    } else badge.classList.remove('urgent');

    if (!timers.length) {
        list.innerHTML = `<div class="empty-state"><div class="empty-icon">⏳</div><div>Brak timerów E2</div></div>`;
        return;
    }

    list.innerHTML = '';
    timers.forEach(t => {
        const name = t.name || t.rawName || '?';
        const map = t.map || t.mapName || '—';
        const secs = t._secs;

        let dotClass = '', rowClass = '', cdClass = '';
        if (secs === null) dotClass = '';
        else if (secs <= 0) { dotClass = 'danger'; rowClass = 'danger'; cdClass = 'danger'; }
        else if (secs < 300) { dotClass = 'danger'; rowClass = 'danger'; cdClass = 'danger'; }
        else if (secs < 600) { dotClass = 'soon'; rowClass = 'soon'; cdClass = 'soon'; }
        else { dotClass = 'active'; }

        const row = document.createElement('div');
        row.className = `timer-row ${rowClass}`;
        row.dataset.secs = secs !== null ? secs : '';
        row.innerHTML = `
            <div class="timer-dot ${dotClass}"></div>
            <div class="timer-info">
                <div class="timer-name">${name}</div>
                <div class="timer-map">📍 ${map}</div>
            </div>
            <div class="timer-countdown ${cdClass}" data-secs="${secs !== null ? secs : ''}">
                ${secs !== null ? fmtSeconds(Math.max(0, secs)) : '—'}
            </div>
        `;
        list.appendChild(row);
    });
}

// Live countdown (lokalne odliczanie)
function tickTimers() {
    document.querySelectorAll('.timer-countdown[data-secs]').forEach(el => {
        let s = parseInt(el.dataset.secs);
        if (isNaN(s)) return;

        s = Math.max(0, s - 1);
        el.dataset.secs = s;
        el.textContent = fmtSeconds(s);

        const row = el.closest('.timer-row');
        if (s <= 0) {
            row.classList.add('danger');
            el.classList.add('danger');
        } else if (s < 300) {
            row.classList.add('danger');
            el.classList.add('danger');
        } else if (s < 600) {
            row.classList.add('soon');
            el.classList.add('soon');
        }
    });
}

setInterval(tickTimers, 1000);

// Event listeners
document.getElementById('timer-search').addEventListener('input', renderTimers);
document.getElementById('timer-filter').addEventListener('change', renderTimers);

// ── STATS TAB ──
function renderStats() {
    const grid = document.getElementById('stats-grid');
    const { drops, chars, activeChar } = state;

    const entries = Object.entries(drops);
    if (!entries.length) {
        grid.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><div>Brak danych — bot jeszcze nie grał w tej sesji</div></div>`;
        return;
    }

    grid.innerHTML = '';
    entries.sort((a, b) => {
        if (a[0].toLowerCase() === (activeChar || '').toLowerCase()) return -1;
        return 0;
    });

    entries.forEach(([nick, d]) => {
        const isActive = nick.toLowerCase() === (activeChar || '').toLowerCase();
        const updAt = d.updatedAt ? new Date(d.updatedAt).toLocaleTimeString('pl-PL') : '—';
        const card = document.createElement('div');
        card.className = 'stat-char-card';
        card.innerHTML = `
            <div class="stat-char-name">
                ${isActive ? '<span class="active-dot"></span>' : ''}
                ${nick}
                <span style="font-size:11px;color:#64748b;font-weight:400;margin-left:auto">🕐 ${updAt}</span>
            </div>
            <div class="stat-row"><span class="stat-lbl">⭐ Legendy (lega)</span><span class="stat-val leg">${d.leg || 0}</span></div>
            <div class="stat-row"><span class="stat-lbl">💙 Heroiki (hero)</span><span class="stat-val hero">${d.hero || 0}</span></div>
            <div class="stat-row"><span class="stat-lbl">💛 Unikaty (uni)</span><span class="stat-val uni">${d.uni || 0}</span></div>
            <div class="stat-row"><span class="stat-lbl">⚔️ Zabójstwa E2</span><span class="stat-val green">${d.e2kills || 0}</span></div>
            <div class="stat-row"><span class="stat-lbl">🗡️ Zabójstwa ogółem</span><span class="stat-val green">${d.kills || 0}</span></div>
            <div class="stat-row"><span class="stat-lbl">✨ EXP zdobyte</span><span class="stat-val exp">${fmtNum(d.expGained || 0)}</span></div>
            <div class="stat-row"><span class="stat-lbl">🪙 Złoto zdobyte</span><span class="stat-val gold">${fmtNum(d.goldGained || 0)}</span></div>
        `;
        grid.appendChild(card);
    });
}

// ── MONITOR TAB ──
function renderMonitor() {
    const s = state.botState;
    if (!s || !s.hero) return;

    const h = s.hero;
    const phase = s.phase || 'idle';

    document.getElementById('mon-name').textContent = h.name || '—';
    document.getElementById('mon-lvl').textContent  = h.lvl ? `Lv${h.lvl}` : 'Lv?';
    document.getElementById('mon-map').textContent  = h.mapName || '—';
    document.getElementById('mon-pos').textContent  = (h.x !== undefined && h.y !== undefined) ? `[${h.x}, ${h.y}]` : '[?, ?]';

    let hpPct = null;
    if (h.maxHp && h.hp) hpPct = Math.round(h.hp / h.maxHp * 100);
    else if (h.hp !== undefined && h.hp <= 100) hpPct = h.hp;

    if (hpPct !== null) {
        document.getElementById('mon-hp-pct').textContent = hpPct;
        const bar = document.getElementById('mon-hp-bar');
        bar.style.width = hpPct + '%';
        bar.className = `hp-bar-fill ${getHpClass(hpPct)}`;
    }

    const phaseBadge = document.getElementById('mon-phase');
    phaseBadge.textContent = phase.toUpperCase();
    phaseBadge.className = `phase-badge ${phase}`;

    // === AUTO RETURN TO E2 BUTTON ===
    let returnBtn = document.getElementById('btn-auto-return');
    if (!returnBtn) {
        const monitorCard = document.querySelector('.monitor-hero-card');
        if (monitorCard) {
            returnBtn = document.createElement('button');
            returnBtn.id = 'btn-auto-return';
            returnBtn.className = 'btn btn-ghost';
            returnBtn.style.marginTop = '16px';
            returnBtn.style.width = '100%';
            returnBtn.innerHTML = `🔄 <span id="return-text">Auto Return to E2</span> <span id="return-status" style="margin-left:8px; font-size:12px;"></span>`;
            monitorCard.appendChild(returnBtn);

            returnBtn.addEventListener('click', async () => {
                const enabled = returnBtn.dataset.enabled === 'true';
                const newState = !enabled;

                try {
                    const res = await fetch(`${API}/api/config`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ autoReturnToE2: newState })
                    });
                    const data = await res.json();
                    if (data.ok) {
                        returnBtn.dataset.enabled = newState;
                        updateReturnButton(returnBtn);
                        toast(`✅ Auto Return to E2 ${newState ? 'WŁĄCZONY' : 'WYŁĄCZONY'}`, 'success');
                    }
                } catch (e) {
                    toast('❌ Błąd połączenia', 'error');
                }
            });
        }
    }

    // Aktualizuj stan przycisku
    if (returnBtn) updateReturnButton(returnBtn);
}

function updateReturnButton(btn) {
    const enabled = btn.dataset.enabled === 'true';
    const statusEl = document.getElementById('return-status');
    const textEl = document.getElementById('return-text');

    if (enabled) {
        btn.style.borderColor = '#35d488';
        btn.style.color = '#35d488';
        statusEl.textContent = '✅ AKTYWNY';
        statusEl.style.color = '#35d488';
    } else {
        btn.style.borderColor = '';
        btn.style.color = '';
        statusEl.textContent = '⭕ WYŁĄCZONY';
        statusEl.style.color = '#94a3b8';
    }
}

// LOG FEED
function addLog(msg, type = 'info') {
    state.logs.unshift({ msg, type, ts: new Date().toLocaleTimeString('pl-PL') });
    if (state.logs.length > 40) state.logs.pop();
    renderLogFeed();
}

function renderLogFeed() {
    const feed = document.getElementById('log-feed');
    if (!state.logs.length) { feed.innerHTML = '<div class="log-empty">Brak logów...</div>'; return; }
    feed.innerHTML = state.logs.map(l => `
        <div class="log-line ${l.type}"><span class="ts">${l.ts}</span>${l.msg}</div>
    `).join('');
}

document.getElementById('btn-clear-log').addEventListener('click', () => {
    state.logs = [];
    renderLogFeed();
});

// SCREENSHOT
async function refreshScreenshot() {
    const wrap = document.getElementById('screenshot-wrap');
    wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><div>Pobieranie...</div></div>';
    try {
        const res = await fetch(`${API}/api/browser/screenshot`);
        const data = await res.json();
        if (data.ok && data.image) {
            wrap.innerHTML = `<img src="data:image/jpeg;base64,${data.image}" alt="Screenshot" style="width:100%;border-radius:0 0 12px 12px">`;
        } else {
            wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">❌</div><div>Brak podglądu (bot nieaktywny?)</div></div>';
        }
    } catch {
        wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">❌</div><div>Błąd połączenia</div></div>';
    }
}
document.getElementById('btn-refresh-ss').addEventListener('click', refreshScreenshot);
document.getElementById('btn-screenshot').addEventListener('click', refreshScreenshot);

// ── SCHEDULE TAB ──
async function loadSchedule() {
    try {
        const res = await fetch(`${API}/api/schedule`);
        const data = await res.json();
        if (data.ok) {
            state.schedule = data.schedule;
            document.getElementById('sched-enabled').checked = !!state.schedule.enabled;
            document.getElementById('sched-slots').value = state.schedule.slots || '';
            updateScheduleStatus();
        }
    } catch {}
}

function updateScheduleStatus() {
    const active = isScheduleActive(state.schedule);
    const statusEl = document.getElementById('sched-status-val');
    const nextEl   = document.getElementById('sched-next');

    if (!state.schedule.enabled) {
        statusEl.textContent = '⏸ Harmonogram wyłączony';
        statusEl.style.color = '#64748b';
        nextEl.textContent = '';
        return;
    }

    const now = new Date();
    const nowStr = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });

    if (active) {
        statusEl.textContent = `✅ BOT POWINIEN DZIAŁAĆ (${nowStr})`;
        statusEl.style.color = '#22c55e';
    } else {
        statusEl.textContent = `⛔ BOT POWINIEN STAĆ (${nowStr})`;
        statusEl.style.color = '#ef4444';
    }

    // Następna akcja
    const slots = (state.schedule.slots || '').split(',').map(s => s.trim()).filter(s => s);
    const curMin = now.getHours() * 60 + now.getMinutes();
    let nearest = null, nearestLabel = '';
    for (const slot of slots) {
        const parts = slot.split('-');
        if (parts.length !== 2) continue;
        const s = parseTimeToMinutes(parts[0]);
        const e = parseTimeToMinutes(parts[1]);
        if (s === null || e === null) continue;
        if (s > curMin && (nearest === null || s < nearest)) {
            nearest = s; nearestLabel = `▶ Start za ${s - curMin} min (${parts[0]})`;
        }
        if (e > curMin && (nearest === null || e < nearest)) {
            nearest = e; nearestLabel = `⏹ Stop za ${e - curMin} min (${parts[1]})`;
        }
    }
    nextEl.textContent = nearestLabel || '(brak zaplanowanych akcji dzisiaj)';
}
setInterval(updateScheduleStatus, 30000);

document.getElementById('btn-sched-save').addEventListener('click', async () => {
    const enabled = document.getElementById('sched-enabled').checked;
    const slots   = document.getElementById('sched-slots').value.trim();
    try {
        const res = await fetch(`${API}/api/schedule`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled, slots })
        });
        const data = await res.json();
        if (data.ok) {
            state.schedule = data.schedule;
            updateScheduleStatus();
            toast('✅ Harmonogram zapisany!', 'success');
        } else {
            toast('❌ Błąd zapisu harmonogramu', 'error');
        }
    } catch {
        toast('❌ Błąd połączenia', 'error');
    }
});

// ── RELOG / LOGOUT ──
document.getElementById('btn-logout').addEventListener('click', async () => {
    if (!confirm('Wylogować bota z gry (przejdzie na stronę główną Margonem)?')) return;
    try {
        const res = await fetch(`${API}/api/browser/logout`, { method: 'POST' });
        const data = await res.json();
        if (data.ok) toast('✅ Bot wylogowany z gry', 'success');
        else toast(`❌ Błąd: ${data.error}`, 'error');
    } catch {
        toast('❌ Błąd połączenia', 'error');
    }
});

// ── STATUS DOT (połączenie) ──
function setConnected(ok, server) {
    state.connected = ok;
    const dot = document.getElementById('conn-dot');
    const lbl = document.getElementById('conn-label');
    const srv = document.getElementById('conn-server');
    dot.className = 'status-dot ' + (ok ? 'online' : 'offline');
    lbl.textContent = ok ? 'Połączony' : 'Brak połączenia';
    if (server) srv.textContent = server;
}

// ── MAIN DATA FETCH LOOP ──
async function fetchAll() {
    try {
        const [charsRes, dropsRes, timersRes, stateRes] = await Promise.all([
            fetch(`${API}/api/chars`),
            fetch(`${API}/api/drops`),
            fetch(`${API}/api/timers`),
            fetch(`${API}/api/state`),
        ]);

        const [charsData, dropsData, timersData, stateData] = await Promise.all([
            charsRes.json(), dropsRes.json(), timersRes.json(), stateRes.json()
        ]);

        if (charsData.ok) {
            state.chars = charsData.chars || [];
            state.activeChar = charsData.active || '';
        }
        if (dropsData.ok)  state.drops  = dropsData.drops  || {};
        if (timersData.ok) state.timers = timersData.timers || [];
        if (stateData.ok)  state.botState = stateData.state || null;

        setConnected(true, `${window.location.host}`);

        // Dodaj log jeśli bot działa
        if (state.botState && state.botState.hero) {
            const h = state.botState.hero;
            const phase = state.botState.phase || 'idle';
            addLog(`[${h.name}] ${phase} — ${h.mapName || '?'}`, phase === 'fighting' ? 'ok' : 'info');

if (timersData.ok) {
            const newTimers = timersData.timers || [];
            // Jeśli timer zniknął — znaczy ktoś zabił E2
            if (lastTimersData.length > 0 && newTimers.length < lastTimersData.length) {
                addLog('⚠️ Któryś E2 został zabity — odświeżam timery', 'warn');
            }
            lastTimersData = newTimers;
            state.timers = newTimers;
        }

        }

        // Render all
        renderChars();
        renderTimers();
        renderStats();
        renderMonitor();

    } catch (e) {
        setConnected(false, '');
        addLog('Błąd połączenia z serwerem bota', 'warn');
    }
}

// ── INITIAL LOAD ──
fetchAll();
loadSchedule();

// ── POLLING every 5s ──
setInterval(fetchAll, 5000);
setInterval(updateScheduleStatus, 1000);

// ── SCREENSHOT modal ──
document.getElementById('modal-ss-close').addEventListener('click', () => {
    document.getElementById('modal-ss').style.display = 'none';
});

// ── E2 DRAWER SELECTION ──
const BOSSES_LIST = [
    "Mushita", "Kotołak Tropiciel", "Shae Phu", "Zorg Jednooki Baron", "Władca rzek", 
    "Gobbos", "Tyrtajos", "Tollok Shimger", "Szczęt alias Gładki", "Agar", 
    "Razuglag Oklash", "Foverk Turrim", "Owadzia Matka", "Furruk Kozug", "Vari Kruger"
];

function openE2Drawer(nick) {
    const drawer = document.getElementById('drawer-e2');
    const charNameEl = document.getElementById('drawer-char-name');
    const listEl = document.getElementById('drawer-e2-list');

    charNameEl.textContent = nick;
    const currentBoss = state.charBossMap[nick.toLowerCase()] || '';

    listEl.innerHTML = '';

    // Option "Brak"
    const noneItem = document.createElement('div');
    noneItem.className = 'e2-select-item none-option' + (!currentBoss ? ' selected' : '');
    noneItem.innerHTML = '<span>❌ Brak przypisanego E2</span>';
    noneItem.addEventListener('click', () => saveCharBossMapping(nick, ''));
    listEl.appendChild(noneItem);

    // List of bosses
    BOSSES_LIST.forEach(boss => {
        const isSelected = currentBoss.toLowerCase() === boss.toLowerCase();
        const item = document.createElement('div');
        item.className = 'e2-select-item' + (isSelected ? ' selected' : '');
        item.innerHTML = `
            <span>${boss}</span>
            ${isSelected ? '<span>✔</span>' : ''}
        `;
        item.addEventListener('click', () => saveCharBossMapping(nick, boss));
        listEl.appendChild(item);
    });

    drawer.style.display = 'flex';
}

async function saveCharBossMapping(nick, boss) {
    const newMapping = { ...state.charBossMap };
    if (!boss) {
        delete newMapping[nick.toLowerCase()];
    } else {
        newMapping[nick.toLowerCase()] = boss;
    }

    try {
        const res = await fetch(`${API}/api/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ char_boss_map: newMapping })
        });
        const data = await res.json();
        if (data.ok) {
            state.charBossMap = newMapping;
            toast(`✅ Przypisano ${boss || 'Brak'} do postaci ${nick}`, 'success');
            document.getElementById('drawer-e2').style.display = 'none';
            renderChars();
        } else {
            toast('❌ Błąd zapisu konfiguracji', 'error');
        }
    } catch (e) {
        toast('❌ Błąd połączenia', 'error');
    }
}

async function loadConfig() {
    try {
        const res = await fetch(`${API}/api/config`);
        const data = await res.json();
        if (data.ok && data.settings) {
            let mapping = data.settings.char_boss_map || {};
            if (typeof mapping === 'string') {
                try {
                    mapping = JSON.parse(mapping);
                } catch {
                    mapping = {};
                }
            }
            state.charBossMap = mapping;

            const autoReturnToggle = document.getElementById('auto-return-toggle');
            if (autoReturnToggle && typeof data.settings.autoReturnToE2 !== 'undefined') {
                autoReturnToggle.checked = !!data.settings.autoReturnToE2;
            }

            renderChars();
        }
    } catch {}
}

const autoReturnToggle = document.getElementById('auto-return-toggle');
if (autoReturnToggle) {
    autoReturnToggle.addEventListener('change', async () => {
        const val = autoReturnToggle.checked;
        try {
            const res = await fetch(`${API}/api/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ autoReturnToE2: val })
            });
            if (res.ok) {
                toast(`🔄 Auto-powrót do E2: ${val ? 'WŁĄCZONY' : 'WYŁĄCZONY'}`, 'info');
            }
        } catch (e) {
            toast('❌ Błąd zapisu ustawień', 'error');
        }
    });
}

document.getElementById('drawer-e2-close').addEventListener('click', () => {
    document.getElementById('drawer-e2').style.display = 'none';
});

// Run loadConfig
loadConfig();

