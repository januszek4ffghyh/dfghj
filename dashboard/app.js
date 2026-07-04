'use strict';

const API_URL = '/api/state';
const CONFIG_API_URL = '/api/config';
const POLL_MS = 1000; // Poll every 1s for smoother dashboard feel
const STALE_MS = 6000;
const HIDE_AFTER_MS = 30000;

const $ = id => document.getElementById(id);
let lastGoodState = null;
let lastGoodUpdatedAt = 0;
let mapsDb = {};
let mapConnections = {};
let hasInitialTargetSync = false;

async function initMapsDb() {
    try {
        const resp = await fetch('/hosted/maps.json');
        if (resp.ok) {
            mapsDb = await resp.json();
            populateDatalist();
        }
    } catch (e) {
        console.error('Failed to load maps.json:', e);
    }
    
    try {
        const resp = await fetch('/api/map/connections');
        if (resp.ok) {
            const data = await resp.json();
            mapConnections = data.connections || {};
        }
    } catch (e) {
        console.error('Failed to load map connections:', e);
    }
}

function populateDatalist() {
    const dl = $('maps-datalist');
    if (!dl) return;
    dl.innerHTML = '';
    
    const sorted = Object.values(mapsDb).sort((a, b) => a.name.localeCompare(b.name, 'pl'));
    sorted.forEach(m => {
        const opt = document.createElement('option');
        opt.value = `[${m.id}] ${m.name}`;
        dl.appendChild(opt);
    });
}

function parseMapIdFromInput(val) {
    if (!val) return null;
    val = val.trim();
    
    // 1. Dopasowanie formatu "[ID] Nazwa"
    const m = val.match(/^\[(\d+)\]/);
    if (m) return parseInt(m[1], 10);
    
    // 2. Bezpośrednio surowa liczba ID
    const id = parseInt(val, 10);
    if (!isNaN(id) && String(id) === val) return id;
    
    // 3. Wyszukiwanie po nazwie w bazie map (case-insensitive)
    const lower = val.toLowerCase();
    const found = Object.values(mapsDb).find(map => map.name.toLowerCase() === lower)
        || Object.values(mapsDb).find(map => map.name.toLowerCase().includes(lower));
        
    return found ? found.id : null;
}

function parsePatrolMapsToIds(text) {
    if (!text) return [];
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const ids = [];
    lines.forEach(line => {
        const id = parseMapIdFromInput(line);
        if (id) {
            ids.push(id);
        }
    });
    return ids;
}

function getMapNameById(id) {
    const m = mapsDb[String(id)];
    return m ? m.name : `Mapa #${id}`;
}

function findPathLocal(startId, targetId) {
    startId = Number(startId);
    targetId = Number(targetId);
    if (startId === targetId) return [];
    if (!mapConnections) return null;

    const queue = [[startId, []]];
    const visited = new Set([startId]);

    while (queue.length > 0) {
        const [currentId, path] = queue.shift();

        const connections = mapConnections[String(currentId)] || [];
        for (const conn of connections) {
            const nextId = Number(conn.toMapId);
            if (nextId === targetId) {
                return [...path, conn];
            }
            if (!visited.has(nextId)) {
                visited.add(nextId);
                queue.push([nextId, [...path, conn]]);
            }
        }
    }
    return null;
}

function renderSimulatedPath(startId, targetId, path) {
    const container = $('travel-path-container');
    container.innerHTML = '';
    
    const startMap = mapsDb[String(startId)] || { id: startId, name: `Mapa #${startId}` };
    const targetMap = mapsDb[String(targetId)] || { id: targetId, name: `Mapa #${targetId}` };
    
    const timeline = document.createElement('div');
    timeline.className = 'route-timeline';
    
    // Start Step
    const startStep = document.createElement('div');
    startStep.className = 'route-step start';
    startStep.innerHTML = `
        <span class="route-step-name">${startMap.name}</span>
        <span class="route-step-id">ID: ${startMap.id}</span>
        <span class="route-step-meta">Punkt startowy</span>
    `;
    timeline.appendChild(startStep);
    
    if (!path || !path.length) {
        if (startId === targetId) {
            const step = document.createElement('div');
            step.className = 'route-step end';
            step.innerHTML = `
                <span class="route-step-name">${targetMap.name}</span>
                <span class="route-step-id">ID: ${targetMap.id}</span>
                <span class="route-step-meta">Cel podróży (jesteś na miejscu)</span>
            `;
            timeline.appendChild(step);
        } else {
            const step = document.createElement('div');
            step.className = 'route-step';
            step.style.color = 'var(--red)';
            step.innerHTML = `
                <span class="route-step-name" style="color: var(--red); font-weight:700;">Brak znanej drogi w bazie</span>
                <span class="route-step-meta">Postać musi najpierw przejść portale ręcznie, aby bot je zapamiętał.</span>
            `;
            timeline.appendChild(step);
        }
    } else {
        path.forEach((conn, idx) => {
            const isEnd = idx === path.length - 1;
            const step = document.createElement('div');
            step.className = 'route-step ' + (isEnd ? 'end' : 'regular');
            
            const stepMap = mapsDb[String(conn.toMapId)] || { id: conn.toMapId, name: conn.name || `Mapa #${conn.toMapId}` };
            step.innerHTML = `
                <span class="route-step-name">${stepMap.name}</span>
                <span class="route-step-id">ID: ${stepMap.id}</span>
                <span class="route-step-meta">Przejście z ${getMapNameById(conn.fromMapId || startId)} ➔ Portal: ${conn.gatewayId || 'przejście'} (${conn.tx},${conn.ty})</span>
            `;
            timeline.appendChild(step);
        });
    }
    
    container.appendChild(timeline);
}

// Caches for rendering lists to prevent DOM flickering & scroll resetting
let lastRendered = {
    mobs: '',
    potions: '',
    skills: '',
    aiPlan: '',
    travelPath: '',
};

function fmtNum(n) {
    if (n == null || isNaN(n)) return '—';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'g';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'm';
    if (n >= 1e3) return Math.round(n).toLocaleString('pl-PL');
    return String(n);
}

function fmtExp(n) {
    if (n == null || isNaN(n)) return '—';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'g';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'm';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(n);
}

function setConn(status, text) {
    const el = $('conn-badge');
    if (!el) return;
    el.textContent = text;
    el.className = 'conn-badge ' + status; // ok, err, warn
}

function showNoData() {
    $('no-data').classList.remove('hidden');
    $('dashboard').classList.add('hidden');
}

function showDashboard() {
    $('no-data').classList.add('hidden');
    $('dashboard').classList.remove('hidden');
}

let lastUserChangeTimes = {};

function markUserChange(id) {
    lastUserChangeTimes[id] = Date.now();
}

// Safely update input field values if the user is not actively typing
function updateFieldVal(id, val, isCheckbox = false) {
    const el = $(id);
    if (!el) return;
    if (document.activeElement === el) return; // Skip if user is editing
    
    // Skip if user recently changed this field manually (cooldown 3s)
    const lastChange = lastUserChangeTimes[id];
    if (lastChange && (Date.now() - lastChange < 3000)) return;

    if (isCheckbox) {
        el.checked = !!val;
    } else {
        el.value = val ?? '';
    }
}

async function sendConfigPatch(patch) {
    try {
        const resp = await fetch(CONFIG_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch)
        });
        if (!resp.ok) {
            console.error('Failed to apply config patch:', resp.statusText);
        }
    } catch (e) {
        console.error('Failed to send config update:', e);
    }
}

function renderState(s) {
    if (!s) return;

    // 1. Bohater
    const hero = s.hero || {};
    $('hero-name').textContent = hero.name || 'Bohater';
    $('hero-sub').textContent = [
        hero.level ? `Poziom ${hero.level}` : null,
        hero.iface ? `Iface: ${hero.iface}` : null,
        hero.tile ? `Kafel: ${hero.tile.x},${hero.tile.y}` : null,
    ].filter(Boolean).join(' · ');

    const hpPct = hero.hpPct ?? 100;
    const hpBar = $('hp-bar');
    hpBar.style.width = hpPct + '%';
    hpBar.className = 'bar bar-hp' + (hpPct <= 40 ? ' low' : hpPct <= 65 ? ' mid' : '');
    $('hp-pct').textContent = hpPct + '%';

    // 2. Mapa
    const map = s.map || {};
    $('map-name').textContent = map.name || 'Nieznana lokacja';
    $('map-id').textContent = map.id != null ? `ID: ${map.id}` : 'ID: —';
    $('map-slug').textContent = map.slug || '—';

    // 3. Bot Status Badge
    const bot = s.bot || {};
    const pill = $('bot-status-badge');
    const running = !!bot.running;
    pill.textContent = running ? 'ONLINE' : 'STOPPED';
    pill.className = 'status-badge ' + (running ? 'running' : 'stopped');
    $('bot-status').textContent = running ? '▶ Działa' : '⏹ Zatrzymany';
    $('bot-phase').textContent = bot.phase || '—';
    $('bot-status-txt').textContent = bot.statusText || '—';
    $('bot-target').textContent = bot.target
        ? `${bot.target.name} Lv${bot.target.lvl} (${bot.target.tx},${bot.target.ty})`
        : 'brak';

    // Enable/Disable dashboard button states based on running state
    $('btn-start-bot').disabled = running;
    $('btn-stop-bot').disabled = !running;

    // 4. Złoto
    const gold = s.gold || {};
    $('gold-cur').textContent = fmtNum(gold.current);
    const gain = gold.sessionGain ?? 0;
    $('gold-gain').textContent = gain !== 0 ? (gain > 0 ? '+' : '') + fmtNum(gain) : '0';
    $('gold-gain').className = 'val ' + (gain > 0 ? 'green' : gain < 0 ? 'red' : '');
    $('gold-rate').textContent = gold.ratePerHour > 0 ? fmtNum(gold.ratePerHour) + '/h' : '—';

    // 5. Doświadczenie (EXP)
    const exp = s.exp || {};
    const pct = exp.progress != null ? exp.progress.toFixed(1) : 0;
    $('exp-bar').style.width = pct + '%';
    $('exp-pct').textContent = pct + '%';
    $('exp-cur').textContent = fmtExp(exp.current) + ' / ' + fmtExp(exp.max);
    $('exp-left').textContent = fmtExp(exp.left);
    $('exp-session').textContent = fmtExp(exp.sessionGain);
    $('exp-session-rate').textContent = exp.ratePerHour > 0 ? fmtExp(exp.ratePerHour) + '/h' : '—';
    $('exp-eta').textContent = exp.timeToLevel || '—';

    // 6. Mob list (Cached rendering)
    const mobList = $('mob-list');
    const mobs = bot.mobs || [];
    const mobsJson = JSON.stringify(mobs);
    if (mobsJson !== lastRendered.mobs) {
        lastRendered.mobs = mobsJson;
        mobList.innerHTML = '';
        if (!mobs.length) {
            mobList.innerHTML = '<div style="padding: 10px; text-align: center; color: var(--text-dim);">Brak potworów w filtrze</div>';
        } else {
            mobs.slice(0, 15).forEach(m => {
                const div = document.createElement('div');
                div.className = 'mob-item' + (bot.target && m.id === bot.target.id ? ' target' : '');
                div.innerHTML = `<span>${m.name} (Lv${m.lvl})</span><span>${m.dist} kaf${m.grp ? ' ⚡' : ''}</span>`;
                mobList.appendChild(div);
            });
        }
    }

    // 7. Torba (Bags & Potions)
    const bag = s.bag || {};
    $('bag-free').textContent = bag.freeSlots != null ? `${bag.freeSlots} / ${bag.totalSlots}` : '—';
    $('bag-used').textContent = bag.usedSlots != null ? bag.usedSlots : '—';
    if (bag.isFull) $('bag-free').className = 'val red';
    else if (bag.freeSlots < 6) $('bag-free').className = 'val warn';
    else $('bag-free').className = 'val green';

    const potList = $('pot-list');
    const potions = bag.potions || [];
    const potJson = JSON.stringify(potions);
    if (potJson !== lastRendered.potions) {
        lastRendered.potions = potJson;
        potList.innerHTML = '';
        if (!potions.length) {
            potList.innerHTML = '<div style="color: var(--red); padding: 4px 0;">Brak potek leczących HP!</div>';
        } else {
            potions.forEach(p => {
                const div = document.createElement('div');
                div.className = 'pot-item';
                div.innerHTML = `<span>${p.name}</span><span>×${p.qty} (${fmtExp(p.heal)} HP)</span>`;
                potList.appendChild(div);
            });
        }
    }

    // 8. Auto-F / CAPTCHA Statuses
    const autof = s.autof || {};
    $('autof-status').textContent = autof.status || '—';
    const captcha = s.captcha || {};
    $('captcha-status').textContent = captcha.status || '—';

    // 9. AI Skills Plan (Cached rendering)
    const aiPlan = s.aiPlan || null;
    const aiPlanJson = JSON.stringify(aiPlan);
    if (aiPlanJson !== lastRendered.aiPlan) {
        lastRendered.aiPlan = aiPlanJson;
        const aiContainer = $('ai-plan-container');
        aiContainer.innerHTML = '';
        if (!aiPlan || !aiPlan.allocations || !aiPlan.allocations.length) {
            aiContainer.innerHTML = '<span class="placeholder">Brak wygenerowanego planu AI. Otwórz panel umiejętności i wygeneruj plan.</span>';
        } else {
            if (aiPlan.summary) {
                const summary = document.createElement('div');
                summary.className = 'ai-plan-summary';
                summary.textContent = aiPlan.summary;
                aiContainer.appendChild(summary);
            }
            aiPlan.allocations.forEach(a => {
                const div = document.createElement('div');
                div.className = 'ai-plan-item';
                div.innerHTML = `
                    <div>
                        <div class="name">${a.name}</div>
                        <div class="reason">${a.reason || ''}</div>
                    </div>
                    <span class="pts">+${a.points}</span>
                `;
                aiContainer.appendChild(div);
            });
            if (aiPlan.warnings && aiPlan.warnings.length) {
                aiPlan.warnings.forEach(w => {
                    const warnDiv = document.createElement('div');
                    warnDiv.className = 'ai-plan-warn';
                    warnDiv.textContent = `⚠ ${w}`;
                    aiContainer.appendChild(warnDiv);
                });
            }
        }
    }

    // 10. Skills (Cached rendering)
    const skills = s.skills || {};
    $('skill-pts').textContent = skills.points
        ? `${skills.points.learnt}/${skills.points.total} (wolne: ${skills.points.free})`
        : '—';
    if (skills.points && skills.points.free > 0) $('skill-pts').className = 'stat-value green';
    else $('skill-pts').className = 'stat-value accent';

    const skillList = $('skill-list');
    const skillItems = skills.list || [];
    const skillsJson = JSON.stringify(skillItems);
    if (skillsJson !== lastRendered.skills) {
        lastRendered.skills = skillsJson;
        skillList.innerHTML = '';
        if (!skillItems.length) {
            skillList.innerHTML = '<div style="color: var(--text-dim); text-align: center; padding: 10px; font-size: 11px;">Brak danych umek. Otwórz panel umiejętności w grze (U)</div>';
        } else {
            skillItems.forEach(sk => {
                const pct = sk.maxLvl > 0 ? (sk.curLvl / sk.maxLvl * 100) : 0;
                const div = document.createElement('div');
                div.className = 'skill-item';
                div.innerHTML = `
                    <span class="skill-name" title="${sk.name}">${sk.name}</span>
                    <div class="skill-bar-wrap"><div class="skill-bar" style="width:${pct}%"></div></div>
                    <span class="skill-lvl">${sk.curLvl}/${sk.maxLvl}</span>
                `;
                skillList.appendChild(div);
            });
        }
    }

    // 11. Konfiguracja (Synchronizacja pól formularza)
    const cfg = s.config || {};
    updateFieldVal('field-min-lvl', cfg.minLvl);
    updateFieldVal('field-max-lvl', cfg.maxLvl);
    updateFieldVal('field-range', cfg.range);
    updateFieldVal('field-arr-dist', cfg.arrDist);
    updateFieldVal('field-walk-delay', cfg.walkDelay);
    updateFieldVal('field-atk-delay', cfg.atkDelay);
    updateFieldVal('field-sort-by', cfg.sortBy);
    updateFieldVal('field-grp-only', cfg.grpOnly, true);
    updateFieldVal('field-stop-full', cfg.stopFull, true);
    updateFieldVal('field-stop-no-pot', cfg.stopNoPot, true);
    updateFieldVal('field-autof-enabled', cfg.autoFEnabled, true);
    updateFieldVal('field-autof-minhp', cfg.autoFMinHP);
    updateFieldVal('field-captcha-enabled', s.captcha ? s.captcha.enabled : null, true);
    updateFieldVal('field-ai-skills-enabled', cfg.aiSkillsEnabled, true);
    updateFieldVal('field-ai-apply-enabled', cfg.aiApplyEnabled, true);

    // 12. Travel & Navigation rendering
    const travelActive = !!cfg.travelEnabled;
    
    // Toggle start/stop panels
    if (travelActive) {
        $('btn-stop-travel-container').style.display = 'block';
        $('btn-simulate-path').disabled = true;
        $('btn-start-travel').disabled = true;
        $('field-start-map').disabled = true;
        $('field-target-map').disabled = true;
    } else {
        $('btn-stop-travel-container').style.display = 'none';
        $('btn-simulate-path').disabled = false;
        $('btn-start-travel').disabled = false;
        $('field-start-map').disabled = false;
        $('field-target-map').disabled = false;
    }

    // Status text
    if (s.travelStatusText) {
        $('travel-status-txt').textContent = s.travelStatusText;
    } else {
        $('travel-status-txt').textContent = travelActive ? 'W podróży' : 'nieaktywna';
    }

    // If bot is active traveling, render the current path as timeline!
    if (travelActive) {
        const pathContainer = $('travel-path-container');
        const pathItems = s.travelPath || [];
        const pathJson = JSON.stringify(pathItems);
        if (pathJson !== lastRendered.travelPath) {
            lastRendered.travelPath = pathJson;
            pathContainer.innerHTML = '';
            if (!pathItems.length) {
                pathContainer.innerHTML = '<span style="color: var(--text-dim);">Trasa ukończona lub brak drogi w bazie.</span>';
            } else {
                const timeline = document.createElement('div');
                timeline.className = 'route-timeline';
                
                // First step is current map
                const startStep = document.createElement('div');
                startStep.className = 'route-step active';
                startStep.innerHTML = `
                    <span class="route-step-name">${s.map.name || 'Bieżąca mapa'}</span>
                    <span class="route-step-id">ID: ${s.map.id}</span>
                    <span class="route-step-meta">Aktualna lokalizacja bota</span>
                `;
                timeline.appendChild(startStep);

                pathItems.forEach((p, idx) => {
                    const isEnd = idx === pathItems.length - 1;
                    const step = document.createElement('div');
                    step.className = 'route-step ' + (isEnd ? 'end' : 'regular');
                    step.innerHTML = `
                        <span class="route-step-name">${p.name}</span>
                        <span class="route-step-id">ID: ${p.id}</span>
                        <span class="route-step-meta">${isEnd ? 'Cel podróży' : 'Kolejny krok w trasie'}</span>
                    `;
                    timeline.appendChild(step);
                });
                pathContainer.appendChild(timeline);
            }
        }
    } else {
        // Jeśli podróż jest aktywna, wymuś poprawne wyświetlenie celu w zablokowanym polu
        if (travelActive && cfg.targetMapId) {
            const targetMapName = getMapNameById(cfg.targetMapId);
            $('field-target-map').value = `[${cfg.targetMapId}] ${targetMapName}`;
        } else {
            // Zsynchronizuj cel przy pierwszym załadowaniu strony
            const skipTargetSync = lastUserChangeTimes['field-target-map'] && (Date.now() - lastUserChangeTimes['field-target-map'] < 3000);
            if (!hasInitialTargetSync && cfg.targetMapId && !skipTargetSync) {
                hasInitialTargetSync = true;
                const targetMapName = getMapNameById(cfg.targetMapId);
                $('field-target-map').value = `[${cfg.targetMapId}] ${targetMapName}`;
            }
        }
    }

    // Ustaw placeholder dla mapy startowej bota
    if (s.map && s.map.id) {
        $('field-start-map').placeholder = `Bieżąca: [${s.map.id}] ${s.map.name || 'Nieznana mapa'}`;
    } else {
        $('field-start-map').placeholder = 'Bieżąca mapa bota';
    }

    // 13. Hero Hunter rendering
    updateFieldVal('field-hero-hunter-enabled', cfg.heroHunterEnabled, true);
    updateFieldVal('field-hero-hunter-name', cfg.heroHunterName);
    
    if (s.patrolStatusText) {
        $('patrol-status-txt').textContent = s.patrolStatusText;
    } else {
        $('patrol-status-txt').textContent = cfg.heroHunterEnabled ? 'aktywny' : 'nieaktywny';
    }

    // Sync patrol maps textarea if user is not currently editing it
    const patrolMapsEl = $('field-patrol-maps');
    const lastPatrolChange = lastUserChangeTimes['field-patrol-maps'];
    const skipPatrolSync = lastPatrolChange && (Date.now() - lastPatrolChange < 3000);

    if (Array.isArray(cfg.patrolMapIds) && document.activeElement !== patrolMapsEl && !skipPatrolSync) {
        const lines = cfg.patrolMapIds.map(id => {
            const name = getMapNameById(id);
            return name ? `[${id}] ${name}` : String(id);
        });
        const expectedText = lines.join('\n');
        if (patrolMapsEl.value !== expectedText) {
            patrolMapsEl.value = expectedText;
        }
    }

    updateFieldVal('field-travel-enabled', cfg.travelEnabled, true);

    const ts = s.ts ? new Date(s.ts).toLocaleTimeString('pl-PL') : '—';
    $('last-update').textContent = `Ostatnia aktualizacja: ${ts}`;
}

async function poll() {
    try {
        const resp = await fetch(API_URL);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();

        const age = data.updatedAt ? Date.now() - data.updatedAt : Infinity;
        // MUST check hero.name to avoid overwriting lastGoodState with empty payload during loading screen!
        const hasState = data.state && data.state.hero && data.state.hero.name && data.updatedAt > 0;
        const isFresh = age < STALE_MS;
        const isTooOld = age > HIDE_AFTER_MS;

        if (!hasState && !lastGoodState) {
            setConn('err', 'Rozłączony');
            showNoData();
            const pill = $('bot-status-badge');
            if (pill) {
                pill.textContent = 'OFFLINE';
                pill.className = 'status-badge stopped';
            }
            return;
        }

        if (hasState) {
            lastGoodState = data.state;
            lastGoodUpdatedAt = data.updatedAt;
        }

        showDashboard();
        renderState(lastGoodState);

        if (!isFresh && !isTooOld) {
            setConn('warn', `Ostatni sygnał: ${Math.round(age / 1000)}s temu`);
        } else if (isTooOld) {
            setConn('err', `Bot offline: ${Math.round(age / 1000)}s`);
            const pill = $('bot-status-badge');
            if (pill) {
                pill.textContent = 'DISCONNECTED';
                pill.className = 'status-badge stopped';
            }
        } else {
            setConn('ok', 'Połączony z botem');
        }
    } catch (e) {
        if (lastGoodState) {
            setConn('warn', 'Serwer offline - pokazuję ostatnie dane');
            showDashboard();
            renderState(lastGoodState);
            const age = lastGoodUpdatedAt ? Date.now() - lastGoodUpdatedAt : 0;
            $('last-update').textContent = `Ostatnia aktualizacja: ${Math.round(age / 1000)}s temu`;
            const pill = $('bot-status-badge');
            if (pill) {
                pill.textContent = 'SERVER OFFLINE';
                pill.className = 'status-badge stopped';
            }
            return;
        }
        setConn('err', 'Serwer offline');
        showNoData();
    }
}

// Bind event listeners to input elements to send updates to the bot
function setupConfigListeners() {
    const bindInput = (id, key, isCheckbox = false) => {
        const el = $(id);
        if (!el) return;
        
        const eventName = isCheckbox ? 'change' : 'change';
        el.addEventListener(eventName, () => {
            markUserChange(id);
            const val = isCheckbox ? el.checked : (el.type === 'number' ? parseFloat(el.value) : el.value);
            sendConfigPatch({ [key]: val });
        });
    };

    bindInput('field-min-lvl', 'minLvl');
    bindInput('field-max-lvl', 'maxLvl');
    bindInput('field-range', 'range');
    bindInput('field-arr-dist', 'arrDist');
    bindInput('field-walk-delay', 'walkDelay');
    bindInput('field-atk-delay', 'atkDelay');
    bindInput('field-sort-by', 'sortBy');
    bindInput('field-grp-only', 'grpOnly', true);
    bindInput('field-stop-full', 'stopFull', true);
    bindInput('field-stop-no-pot', 'stopNoPot', true);
    bindInput('field-autof-enabled', 'autoFEnabled', true);
    bindInput('field-autof-minhp', 'autoFMinHP');
    bindInput('field-captcha-enabled', 'captchaEnabled', true);
    bindInput('field-ai-skills-enabled', 'aiSkillsEnabled', true);
    bindInput('field-ai-apply-enabled', 'aiApplyEnabled', true);

    // Operational Buttons
    $('btn-start-bot').addEventListener('click', () => {
        sendConfigPatch({ botRunning: true });
    });
    $('btn-stop-bot').addEventListener('click', () => {
        sendConfigPatch({ botRunning: false });
    });

    // AI Buttons
    $('btn-ai-plan').addEventListener('click', () => {
        sendConfigPatch({ triggerAiPlan: true });
    });
    $('btn-ai-apply').addEventListener('click', () => {
        sendConfigPatch({ triggerAiApply: true });
    });

    // Travel Simulator & Execution Buttons
    bindInput('field-travel-enabled', 'travelEnabled', true);

    $('btn-simulate-path').addEventListener('click', () => {
        fetch('/api/map/connections')
            .then(resp => resp.json())
            .then(data => {
                mapConnections = data.connections || {};
                
                let startId = parseMapIdFromInput($('field-start-map').value);
                if (!startId) {
                    startId = lastGoodState && lastGoodState.map ? lastGoodState.map.id : null;
                }
                
                if (!startId) {
                    alert('Nie można określić mapy startowej (bot nie wysłał stanu lub brak wyboru)!');
                    return;
                }
                
                const targetId = parseMapIdFromInput($('field-target-map').value);
                if (!targetId) {
                    alert('Wybierz poprawną mapę docelową z listy lub wpisz jej ID!');
                    return;
                }
                
                const path = findPathLocal(startId, targetId);
                lastRendered.travelPath = 'SIMULATED';
                renderSimulatedPath(startId, targetId, path);
            });
    });

    $('btn-start-travel').addEventListener('click', () => {
        markUserChange('field-target-map');
        const targetId = parseMapIdFromInput($('field-target-map').value);
        if (!targetId) {
            alert('Wybierz poprawną mapę docelową z listy lub wpisz jej ID!');
            return;
        }
        sendConfigPatch({ travelEnabled: true, targetMapId: targetId });
    });

    $('btn-stop-travel').addEventListener('click', () => {
        markUserChange('field-target-map');
        sendConfigPatch({ travelEnabled: false });
    });

    // Hero Hunter Inputs
    bindInput('field-hero-hunter-enabled', 'heroHunterEnabled', true);
    bindInput('field-hero-hunter-name', 'heroHunterName');

    $('field-patrol-maps').addEventListener('change', () => {
        markUserChange('field-patrol-maps');
        const text = $('field-patrol-maps').value;
        const ids = parsePatrolMapsToIds(text);
        sendConfigPatch({ patrolMapIds: ids });
    });

    $('btn-load-zmora-maps').addEventListener('click', () => {
        markUserChange('field-patrol-maps');
        const ZMORA_MAPS = [
            "Skład Grabieżców",
            "Schowek na Łupy",
            "Pagórki Łupieżców",
            "Przełęcz Łotrzyków",
            "Kamienna Kryjówka",
            "Dolina Rozbójników",
            "Zapomniany Grobowiec p.5",
            "Zapomniany Grobowiec p.4",
            "Zapomniany Grobowiec p.3",
            "Zapomniany Grobowiec p.2",
            "Zapomniany Grobowiec p.1",
            "Ghuli Mogilnik",
            "Polana Ścierwojadów",
            "Podmokła Dolina",
            "Morwowe Przejście",
            "Las Goblinów",
            "Mokradła",
            "Fort Eder"
        ];
        $('field-patrol-maps').value = ZMORA_MAPS.join('\n');
        const ids = parsePatrolMapsToIds($('field-patrol-maps').value);
        sendConfigPatch({ patrolMapIds: ids });
    });
}

// Init
initMapsDb();
setupConfigListeners();
poll();
setInterval(poll, POLL_MS);
