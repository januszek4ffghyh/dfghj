// ==UserScript==
// @name         Margonem – AutoWalk + AutoAttack v3.0 [PALADYN EDITION]
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Bot z Auto-F, CAPTCHA solvem, statystykami EXP/złota, panelem umiejętności Paladyna.
// @author       you
// @match        https://*.margonem.pl/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════
    //  WYKRYWANIE INTERFEJSU
    // ═══════════════════════════════════════════════════════════
    const IFACE = (function () {
        if (typeof API !== "undefined" && typeof Engine !== "undefined" && typeof margoStorage === "undefined")
            return "new";
        else if (typeof dbget === "undefined" && typeof proceed === "undefined")
            return "old";
        else
            return "superold";
    })();

    // ═══════════════════════════════════════════════════════════
    //  PORUSZANIE SIĘ
    // ═══════════════════════════════════════════════════════════
    function heroGoTo(tx, ty) {
        try {
            if (IFACE === "new") {
                Engine.hero.autoGoTo({ x: tx, y: ty });
            } else if (IFACE === "old") {
                window.hero.searchPath(tx, ty);
            } else {
                window.hero.mx = tx;
                window.hero.my = ty;
                window.global.movebymouse = true;
            }
            return true;
        } catch (e) {
            log(`<span class="err">heroGoTo error: ${e.message}</span>`);
            return false;
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  POZYCJA BOHATERA
    // ═══════════════════════════════════════════════════════════
    function getHeroTile() {
        try {
            if (IFACE === "new") {
                const d = Engine.hero.d;
                return { x: d.x, y: d.y };
            } else {
                return { x: window.hero.x, y: window.hero.y };
            }
        } catch (e) {
            const el = document.querySelector('#hero');
            if (!el) return null;
            return {
                x: Math.round(parseInt(el.style.left) / 32),
                y: Math.round(parseInt(el.style.top)  / 32)
            };
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  HP BOHATERA — z panelu battle lub hero
    // ═══════════════════════════════════════════════════════════
    function getHeroHP() {
        try {
            // Próbuj z troop div gracza w walce
            const heroTroop = document.querySelector('.troop[ctip="t_troop1"]');
            if (heroTroop) {
                const tip = (heroTroop.getAttribute('tip') || '').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&amp;/g,'&');
                const lifeM = tip.match(/Życie:\s*(\d+)%/);
                if (lifeM) return { pct: parseInt(lifeM[1]), source: 'battle' };
            }
            // Fallback: pasek HP z gry
            if (IFACE === "new" && Engine && Engine.hero && Engine.hero.d) {
                const d = Engine.hero.d;
                if (d.hp && d.maxhp) return { pct: Math.round(d.hp / d.maxhp * 100), source: 'engine' };
            }
            if (window.hero && window.hero.hp && window.hero.maxhp) {
                return { pct: Math.round(window.hero.hp / window.hero.maxhp * 100), source: 'hero' };
            }
            // Fallback: DOM procent z paska
            const lifeEl = document.getElementById('hpProcent');
            if (lifeEl) {
                const pct = parseFloat(lifeEl.textContent);
                if (!isNaN(pct)) return { pct: Math.round(pct), source: 'dom' };
            }
        } catch(e) {}
        return { pct: 100, source: 'unknown' };
    }

    // ═══════════════════════════════════════════════════════════
    //  SKANOWANIE MOBÓW
    // ═══════════════════════════════════════════════════════════
    let _mobCache = [];
    let _mobCacheTime = 0;

    function scanMobs(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && now - _mobCacheTime < 300) return _mobCache;

        const mobs = [];
        document.querySelectorAll('.npc[ctip="t_npc"]').forEach(el => {
            const raw = el.getAttribute('tip') || '';
            const tip = raw
                .replace(/&lt;/g,'<').replace(/&gt;/g,'>')
                .replace(/&amp;/g,'&').replace(/&quot;/g,'"');

            const nameM = tip.match(/<b>(.*?)<\/b>/);
            const lvlM  = tip.match(/(\d+)\s*lvl/);
            if (!nameM || !lvlM) return;

            const px = parseInt(el.style.left) || 0;
            const py = parseInt(el.style.top)  || 0;
            const w  = parseInt(el.style.width)  || 32;
            const h  = parseInt(el.style.height) || 32;

            const tx = Math.round((px + w / 2) / 32);
            const ty = Math.round((py + h / 2) / 32);

            mobs.push({
                id:   el.id.replace('npc',''),
                el,
                name: nameM[1],
                lvl:  parseInt(lvlM[1]),
                grp:  tip.includes('grp'),
                tx, ty,
                px: px + w/2,
                py: py + h/2,
            });
        });

        _mobCache = mobs;
        _mobCacheTime = now;
        return mobs;
    }

    function tileDist(hero, mob) {
        const dx = hero.x - mob.tx;
        const dy = hero.y - mob.ty;
        return Math.sqrt(dx*dx + dy*dy);
    }

    function tileDistManhattan(hero, mob) {
        return Math.abs(hero.x - mob.tx) + Math.abs(hero.y - mob.ty);
    }

    // ═══════════════════════════════════════════════════════════
    //  ATAK
    // ═══════════════════════════════════════════════════════════
    function attackMob(mob) {
        const el = document.getElementById('npc' + mob.id);
        if (!el) return false;
        const prev = el.style.pointerEvents;
        el.style.pointerEvents = 'auto';
        el.click();
        el.style.pointerEvents = prev;
        return true;
    }

    // ═══════════════════════════════════════════════════════════
    //  ★ NOWY: AUTO-F (Szybka Walka)
    //  Logika:
    //  - Jeśli HP > cfgAutoFMinHP% → kliknij Szybka Walka
    //  - Jeśli HP <= cfgAutoFMinHP% → kliknij Turowa (bezpieczna)
    //  - Działa tylko gdy panel walki jest widoczny
    // ═══════════════════════════════════════════════════════════
    let autoFEnabled = false;
    let autoFTimer   = null;
    let cfgAutoFMinHP = 40; // % HP poniżej którego przełącza na turową

    function isInBattle() {
        const battleEl = document.getElementById('battle');
        return battleEl && battleEl.style.display !== 'none' && battleEl.offsetParent !== null;
    }

    function autoFTick() {
        if (!autoFEnabled) return;

        if (!isInBattle()) {
            // Nie ma walki — nic nie rób
            updateAutoFStatus('idle');
            return;
        }

        const hp = getHeroHP();
        const autoFBtn   = document.getElementById('autobattleButton');
        const tourBtn    = document.getElementById('tourbattleButton');

        if (hp.pct > cfgAutoFMinHP) {
            // HP ok → użyj szybkiej walki jeśli guzik jest widoczny
            if (autoFBtn && autoFBtn.style.display !== 'none') {
                autoFBtn.click();
                log(`⚡ Auto-F: Szybka walka (HP ${hp.pct}%)`);
                updateAutoFStatus('fast');
            }
        } else {
            // HP nisko → przełącz na turową
            if (tourBtn && tourBtn.style.display !== 'none') {
                tourBtn.click();
                log(`<span class="warn">🛡 Auto-F: HP nisko (${hp.pct}%) → Turowa!</span>`);
                updateAutoFStatus('tour');
            }
        }
    }

    function updateAutoFStatus(state) {
        const el = document.getElementById('maw-autof-status');
        if (!el) return;
        if (state === 'fast') { el.textContent = '⚡ Szybka'; el.style.color = '#34d399'; }
        else if (state === 'tour') { el.textContent = '🛡 Turowa'; el.style.color = '#f87171'; }
        else { el.textContent = '💤 Czeka'; el.style.color = '#4b5a8a'; }
    }

    // ═══════════════════════════════════════════════════════════
    //  ★ NOWY: CAPTCHA SOLVER
    //  Szuka guzików z * w nazwie, klika wszystkie, potem Potwierdzam
    // ═══════════════════════════════════════════════════════════
    let captchaEnabled = true;
    let lastCaptchaCheck = 0;

    function solveCaptcha() {
        const now = Date.now();
        if (now - lastCaptchaCheck < 1500) return false;
        lastCaptchaCheck = now;

        // Znajdź aktywną captchę
        const captcha = document.querySelector('.captcha');
        if (!captcha) return false;

        // Sprawdź czy jest widoczna
        const style = window.getComputedStyle(captcha);
        if (style.display === 'none' || style.visibility === 'hidden') return false;

        // Zbierz wszystkie guziki z odpowiedziami
        const buttons = captcha.querySelectorAll('.captcha__buttons .btn');
        if (!buttons.length) return false;

        let clicked = 0;
        const toClick = [];

        buttons.forEach(btn => {
            const nameEl = btn.querySelector('.gfont[name]');
            if (!nameEl) return;
            const name = nameEl.getAttribute('name') || nameEl.textContent || '';
            // Gwiazdka = * w nazwie
            if (name.includes('*')) {
                toClick.push({ btn, name });
            }
        });

        if (!toClick.length) {
            // Brak gwiazdek — nie klikaj nic (może inna logika captchy)
            return false;
        }

        log(`<span class="ok">🔑 CAPTCHA: Znaleziono ${toClick.length} odpowiedzi z ★</span>`);

        // Kliknij wszystkie z gwiazdką z opóźnieniami
        toClick.forEach((item, i) => {
            setTimeout(() => {
                item.btn.click();
                log(`<span class="ok">🔑 Kliknięto: "${item.name}"</span>`);
                clicked++;
                updateCaptchaStatus(`Kliknięto ${clicked}/${toClick.length}`);
            }, i * 400);
        });

        // Potwierdź po kliknięciu wszystkich
        setTimeout(() => {
            const confirmBtn = captcha.querySelector('.captcha__confirm .btn');
            if (confirmBtn) {
                confirmBtn.click();
                log(`<span class="ok">✅ CAPTCHA potwierdzona!</span>`);
                updateCaptchaStatus('Rozwiązana ✅');
            }
        }, toClick.length * 400 + 600);

        return true;
    }

    function updateCaptchaStatus(txt) {
        const el = document.getElementById('maw-captcha-status');
        if (el) el.textContent = txt;
    }

    // ═══════════════════════════════════════════════════════════
    //  ★ NOWY: ZŁOTO
    // ═══════════════════════════════════════════════════════════
    let _goldAtStart  = null;
    let _goldStartTime = null;

    function getGold() {
        const el = document.getElementById('gold');
        if (!el) return null;
        const raw = el.textContent.replace(/\s/g, '').replace(/\./g, '');
        const n = parseInt(raw);
        return isNaN(n) ? null : n;
    }

    function recordGoldStart() {
        if (_goldAtStart === null) {
            _goldAtStart = getGold();
            _goldStartTime = Date.now();
        }
    }

    function getGoldGain() {
        const cur = getGold();
        if (cur === null || _goldAtStart === null) return 0;
        return cur - _goldAtStart;
    }

    function getGoldRate() {
        if (!_goldStartTime) return 0;
        const dur = (Date.now() - _goldStartTime) / 3600000; // w godzinach
        if (dur < 0.001) return 0;
        return Math.round(getGoldGain() / dur);
    }

    // ═══════════════════════════════════════════════════════════
    //  ★ NOWY: SKANER UMIEJĘTNOŚCI (Paladyn)
    //  Czyta panel #skills i wyciąga nauczone umki + poziomy
    // ═══════════════════════════════════════════════════════════
    let _skillsCache = [];
    let _skillsCacheTime = 0;

    function scanSkills(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && now - _skillsCacheTime < 5000) return _skillsCache;

        const skills = [];
        document.querySelectorAll('.skillbox_border .skillbox').forEach(el => {
            const tip = (el.getAttribute('tip') || '')
                .replace(/&lt;/g,'<').replace(/&gt;/g,'>')
                .replace(/&quot;/g,'"').replace(/&amp;/g,'&');

            const nameM = tip.match(/<b>(.*?)<\/b>/);
            if (!nameM) return;

            const lvlEl  = el.querySelector('.skillbox_lvl');
            const lvlTxt = lvlEl ? lvlEl.textContent.trim() : '0/10';
            const lvlM   = lvlTxt.match(/(\d+)\/(\d+)/);
            const curLvl = lvlM ? parseInt(lvlM[1]) : 0;
            const maxLvl = lvlM ? parseInt(lvlM[2]) : 10;
            const learned = lvlEl ? lvlEl.classList.contains('learned-skill') : false;

            // Ikona (numer ikony ze class)
            const iconEl  = el.querySelector('.skillbox_icon');
            let iconNum = 0;
            if (iconEl) {
                const m = iconEl.className.match(/icon-(\d+)/);
                if (m) iconNum = parseInt(m[1]);
            }

            // Czy aktywna w walce
            const setBorder = el.closest('.skillbox_border');
            const isActive = setBorder ? !!setBorder.querySelector('.set-active-state.active') : false;

            skills.push({
                name: nameM[1],
                curLvl,
                maxLvl,
                learned,
                iconNum,
                isActive,
                tip,
            });
        });

        _skillsCache = skills;
        _skillsCacheTime = now;
        return skills;
    }

    // Licznik rozdanych punktów
    function getSkillPoints() {
        const learntEl = document.querySelector('.skills_learnt');
        const totalEl  = document.querySelector('.skills_total');
        const learnt = learntEl ? parseInt(learntEl.textContent) : 0;
        const total  = totalEl  ? parseInt(totalEl.textContent)  : 0;
        return { learnt, total, free: total - learnt };
    }

    // ═══════════════════════════════════════════════════════════
    //  SKANOWANIE TORBY
    // ═══════════════════════════════════════════════════════════
    function scanBag() {
        let totalSlots = 0, usedSlots = 0, potions = [], bags = [], freeSlots = 0;

        document.querySelectorAll('.item[bag]').forEach(el => {
            const tip = (el.getAttribute('tip') || '').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&amp;/g,'&');
            const bagM  = tip.match(/Mieści\s*<span[^>]*>(\d+)<\/span>/);
            const usedM = el.querySelector('small');
            const usedN = usedM ? parseInt(usedM.textContent) : 0;
            if (bagM) {
                const cap = parseInt(bagM[1]);
                bags.push({ cap, used: usedN });
                totalSlots += cap;
                usedSlots  += usedN;
            }
        });

        freeSlots = totalSlots - usedSlots;

        document.querySelectorAll('.item[id^="item"]').forEach(el => {
            const tip = (el.getAttribute('tip') || '').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&amp;/g,'&');
            const healM  = tip.match(/Leczy\s*<span[^>]*>\s*([\d\s]+)\s*<\/span>\s*punkt/);
            const heal2M = tip.match(/Przywraca\s*<span[^>]*>\s*([\d\s]+)\s*<\/span>\s*punkt.*?życia/);
            if (healM || heal2M) {
                const nameM  = tip.match(/item-name[^>]*>(.*?)<\/div>/);
                const amtM   = tip.match(/Ilość.*?<span[^>]*>\s*(\d+)\s*<\/span>/);
                const healAmt = healM
                    ? parseInt((healM[1]||'').replace(/\s/g,''))
                    : parseInt((heal2M[1]||'').replace(/\s/g,''));
                if (healAmt > 0) {
                    potions.push({
                        id:   el.id.replace('item',''),
                        name: nameM ? nameM[1] : 'Potelek HP',
                        heal: healAmt,
                        qty:  amtM ? parseInt(amtM[1]) : 1,
                    });
                }
            }
        });

        return { bags, totalSlots, usedSlots, freeSlots, potions, hasPotions: potions.length > 0, isFull: freeSlots <= 0 };
    }

    // ═══════════════════════════════════════════════════════════
    //  EXP
    // ═══════════════════════════════════════════════════════════
    let expHistory = [];
    let sessionStartExp = null;
    let sessionStartTime = null;

    function parseExpValue(str) {
        if (!str) return 0;
        str = str.replace(/\s/g, '').replace(',', '.');
        let mult = 1;
        if (str.endsWith('g')) { mult = 1e9; str = str.slice(0,-1); }
        else if (str.endsWith('m')) { mult = 1e6; str = str.slice(0,-1); }
        else if (str.endsWith('k')) { mult = 1e3; str = str.slice(0,-1); }
        return Math.round(parseFloat(str) * mult);
    }

    function getExpInfo() {
        const expEl = document.getElementById('exp1');
        if (!expEl) return null;
        const tip = expEl.getAttribute('tip') || '';
        const curM  = tip.match(/Doświadczenie[^:]*:.*?(\d[\d\s.,gmk]*)\s*\/\s*(\d[\d\s.,gmk]*)/i);
        const leftM = tip.match(/Do\s+\d+\s+poziomu[^:]*:\s*<br>\s*([\d\s]+)/i);
        if (!curM) return null;
        const curExp  = parseExpValue(curM[1]);
        const maxExp  = parseExpValue(curM[2]);
        const expLeft = leftM ? parseInt(leftM[1].replace(/\s/g,'')) : (maxExp - curExp);
        const progress = maxExp > 0 ? (curExp / maxExp) * 100 : 0;
        return { curExp, maxExp, expLeft, progress };
    }

    function recordExpTick(expInfo) {
        if (!expInfo) return;
        const now = Date.now();
        if (sessionStartExp === null) { sessionStartExp = expInfo.curExp; sessionStartTime = now; }
        expHistory.push({ ts: now, exp: expInfo.curExp });
        const cutoff = now - 5 * 60 * 1000;
        expHistory = expHistory.filter(e => e.ts >= cutoff);
    }

    function calcExpRate() {
        if (expHistory.length < 2) return null;
        const oldest = expHistory[0];
        const newest = expHistory[expHistory.length - 1];
        const dt = (newest.ts - oldest.ts) / 1000;
        if (dt < 5) return null;
        const gained = newest.exp - oldest.exp;
        if (gained <= 0) return null;
        return gained / dt;
    }

    function formatDuration(sec) {
        if (!isFinite(sec) || sec <= 0) return '—';
        const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    }

    function calcTimeToLvl(expInfo) {
        const rate = calcExpRate();
        if (!rate || !expInfo) return null;
        const secs = expInfo.expLeft / rate;
        return { secs, formatted: formatDuration(secs) };
    }

    function getSessionGain() {
        if (sessionStartExp === null) return 0;
        const info = getExpInfo();
        if (!info) return 0;
        return info.curExp - sessionStartExp;
    }

    function getSessionDuration() {
        if (!sessionStartTime) return 0;
        return (Date.now() - sessionStartTime) / 1000;
    }

    function fmtExp(n) {
        if (n >= 1e9) return (n/1e9).toFixed(2)+'g';
        if (n >= 1e6) return (n/1e6).toFixed(2)+'m';
        if (n >= 1e3) return (n/1e3).toFixed(1)+'k';
        return String(n);
    }

    // ═══════════════════════════════════════════════════════════
    //  STAN BOTA
    // ═══════════════════════════════════════════════════════════
    let running   = false;
    let phase     = 'idle';
    let target    = null;
    let walkTimer = null;
    let stuckCnt  = 0;
    let lastHeroPos = null;

    let cfgMinLvl    = 1;
    let cfgMaxLvl    = 200;
    let cfgGrpOnly   = false;
    let cfgRange     = 999;
    let cfgWalkDelay = 1500;
    let cfgAtkDelay  = 1000;
    let cfgArrDist   = 2.5;
    let cfgSortBy    = 'dist';
    let cfgStopFull  = false;
    let cfgStopNoPot = false;

    let lastBagInfo = null;
    let lastBagScan = 0;

    function getBagInfo(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && now - lastBagScan < 2000) return lastBagInfo;
        lastBagInfo = scanBag();
        lastBagScan = now;
        return lastBagInfo;
    }

    function getFilteredMobs() {
        const hero = getHeroTile() || { x:0, y:0 };
        return scanMobs()
            .filter(m => m.lvl >= cfgMinLvl && m.lvl <= cfgMaxLvl)
            .filter(m => !cfgGrpOnly || m.grp)
            .filter(m => cfgRange >= 900 || tileDist(hero, m) <= cfgRange)
            .sort((a,b) => {
                if (cfgSortBy === 'lvl_asc')  return a.lvl - b.lvl;
                if (cfgSortBy === 'lvl_desc') return b.lvl - a.lvl;
                return tileDistManhattan(hero,a) - tileDistManhattan(hero,b);
            });
    }

    function pickNextTarget() {
        const mobs = getFilteredMobs();
        if (!mobs.length) return null;
        return mobs.find(m => !target || m.id !== target.id) || mobs[0];
    }

    function checkBagConditions() {
        const bag = getBagInfo(true);
        if (!bag) return true;
        if (cfgStopFull && bag.isFull) {
            log(`<span class="warn">⚠ Torba pełna (${bag.usedSlots}/${bag.totalSlots}) — bot zatrzymany!</span>`);
            stopBot();
            return false;
        }
        if (cfgStopNoPot && !bag.hasPotions) {
            log(`<span class="warn">⚠ Brak poteków HP — bot zatrzymany!</span>`);
            stopBot();
            return false;
        }
        return true;
    }

    // ═══════════════════════════════════════════════════════════
    //  GŁÓWNA PĘTLA
    // ═══════════════════════════════════════════════════════════
    function mainLoop() {
        if (!running) return;

        if (!checkBagConditions()) return;

        const hero = getHeroTile();

        if (phase === 'idle' || phase === 'next') {
            target = pickNextTarget();
            if (!target) {
                log(`<span class="warn">⚠ Brak mobów — czekam...</span>`);
                updateStatus('Brak mobów', '⚠');
                walkTimer = setTimeout(mainLoop, 2000);
                return;
            }
            const d = hero ? tileDist(hero, target).toFixed(1) : '?';
            log(`🎯 Cel: <span class="hi">${target.name}</span> Lv${target.lvl} (${target.tx},${target.ty}) · ${d} kaf.`);
            updateStatus(`Idę do: ${target.name} Lv${target.lvl} · ${d} kaf.`, '🚶');
            stuckCnt = 0;
            lastHeroPos = hero;
            heroGoTo(target.tx, target.ty);
            phase = 'walking';
            walkTimer = setTimeout(checkArrival, cfgWalkDelay);
            renderAll();
            return;
        }

        if (phase === 'walking') {
            checkArrival();
        }
    }

    function checkArrival() {
        if (!running) return;
        const hero = getHeroTile();
        if (!hero || !target) { phase = 'idle'; mainLoop(); return; }

        const d = tileDist(hero, target);
        updateStatus(`Idę: ${target.name} Lv${target.lvl} · ${d.toFixed(1)} kaf.`, '🚶');

        if (!document.getElementById('npc' + target.id)) {
            log(`💀 npc${target.id} zniknął`);
            scanMobs(true);
            phase = 'next';
            walkTimer = setTimeout(mainLoop, 200);
            return;
        }

        if (d <= cfgArrDist) {
            phase = 'attacking';
            log(`⚔ Atakuję: <span class="hi">${target.name}</span> Lv${target.lvl}`);
            updateStatus(`Atakuję: ${target.name} Lv${target.lvl}`, '⚔');
            attackMob(target);
            scanMobs(true);
            walkTimer = setTimeout(() => { phase = 'next'; mainLoop(); }, cfgAtkDelay);
        } else {
            if (lastHeroPos && hero.x === lastHeroPos.x && hero.y === lastHeroPos.y) {
                stuckCnt++;
                if (stuckCnt >= 3) { log(`↩ Stuck — ponawiam ruch`); heroGoTo(target.tx, target.ty); stuckCnt = 0; }
            } else {
                stuckCnt = 0;
            }
            lastHeroPos = hero;
            walkTimer = setTimeout(checkArrival, 400);
        }
    }

    function startBot() {
        if (running) return;
        running = true;
        phase = 'idle';
        target = null;
        sessionStartExp  = null;
        sessionStartTime = null;
        expHistory = [];
        _goldAtStart = null;
        _goldStartTime = null;
        recordGoldStart();
        log(`<span class="ok">▶ Bot uruchomiony (iface: ${IFACE})</span>`);
        mainLoop();
    }

    function stopBot() {
        running = false;
        clearTimeout(walkTimer);
        phase = 'idle';
        target = null;
        log('<span class="warn">⏹ Bot zatrzymany</span>');
        updateStatus('Zatrzymany', '⏹');
        document.getElementById('maw-btn-start').disabled = false;
        document.getElementById('maw-btn-stop').disabled  = true;
        renderAll();
    }

    // ═══════════════════════════════════════════════════════════
    //  CSS
    // ═══════════════════════════════════════════════════════════
    const $style = document.createElement('style');
    $style.textContent = `
    #maw-panel {
        position:fixed; top:55px; right:12px; width:290px;
        background:#090b13; border:1px solid #1c2035; border-radius:11px;
        color:#dde3f5; font:12px 'Segoe UI',sans-serif;
        z-index:99999; box-shadow:0 12px 45px rgba(0,0,0,.8);
        user-select:none; max-height:96vh; overflow-y:auto;
    }
    #maw-panel::-webkit-scrollbar { width:3px; }
    #maw-panel::-webkit-scrollbar-thumb { background:#1c2035; border-radius:2px; }
    #maw-hdr {
        background:#111528; padding:7px 12px; border-radius:11px 11px 0 0;
        cursor:move; border-bottom:1px solid #1c2035;
        display:flex; align-items:center; justify-content:space-between;
        position:sticky; top:0; z-index:2;
    }
    #maw-hdr b { font-size:13px; letter-spacing:.5px; }
    #maw-badge { background:#7c3aed; color:#fff; border-radius:5px; padding:1px 7px; font-size:11px; }
    #maw-body { padding:9px 12px; }

    .maw-section { margin:6px 0; }
    .maw-lbl { color:#3d4875; font-size:10px; text-transform:uppercase; letter-spacing:.9px; margin:8px 0 3px; }
    .maw-row { display:flex; align-items:center; justify-content:space-between; margin:3px 0; gap:4px; }
    .maw-row label { color:#7880a8; font-size:11px; flex-shrink:0; }
    .maw-inp { background:#141829; border:1px solid #1c2035; color:#dde3f5; border-radius:5px; padding:2px 6px; font-size:11px; }
    .maw-inp:focus { outline:none; border-color:#7c3aed; }
    .maw-chk { display:flex; align-items:center; gap:6px; color:#7880a8; cursor:pointer; margin:3px 0; font-size:11px; }
    .maw-chk input { accent-color:#7c3aed; }
    .maw-sel { background:#141829; border:1px solid #1c2035; color:#dde3f5; border-radius:5px; padding:2px 6px; font-size:11px; cursor:pointer; }

    /* LISTA MOBÓW */
    #maw-list { max-height:120px; overflow-y:auto; border:1px solid #1c2035; border-radius:6px; margin-top:4px; }
    #maw-list::-webkit-scrollbar { width:4px; }
    #maw-list::-webkit-scrollbar-thumb { background:#1c2035; border-radius:2px; }
    .maw-mob { display:flex; align-items:center; gap:5px; padding:4px 8px; border-bottom:1px solid #111528; font-size:11px; }
    .maw-mob.cur  { background:#1a1030; border-left:2px solid #7c3aed; }
    .maw-mob.near { background:#0a1520; border-left:2px solid #22c55e; }
    .maw-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; }
    .maw-mname { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .maw-mmeta { color:#323a5a; font-size:10px; white-space:nowrap; }
    .maw-walk-badge { font-size:9px; padding:1px 5px; border-radius:3px; background:#7c3aed22; color:#a78bfa; border:1px solid #7c3aed44; flex-shrink:0; }
    .maw-near-badge { font-size:9px; padding:1px 5px; border-radius:3px; background:#22c55e22; color:#86efac; border:1px solid #22c55e44; flex-shrink:0; }

    /* PRZYCISKI */
    .maw-btns { display:flex; gap:5px; margin-top:9px; }
    .maw-btn { flex:1; padding:7px 4px; border:none; border-radius:7px; cursor:pointer; font-size:12px; font-weight:700; transition:opacity .15s; }
    .maw-btn:hover { opacity:.82; }
    .maw-start  { background:#7c3aed; color:#fff; }
    .maw-stop   { background:#dc2626; color:#fff; }
    .maw-stop:disabled, .maw-start:disabled { background:#3d4875; cursor:not-allowed; opacity:.5; }

    /* STATUS */
    #maw-status-bar { margin-top:7px; padding:5px 8px; background:#111528; border-radius:6px; font-size:11px; color:#a78bfa; display:flex; align-items:center; gap:6px; }
    #maw-status-icon { font-size:14px; }
    #maw-status-txt  { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

    /* LOG */
    #maw-log { margin-top:5px; background:#070910; border:1px solid #1c2035; border-radius:6px; padding:4px 8px; height:60px; overflow-y:auto; font-size:10px; line-height:1.55; color:#3d4875; }
    #maw-log::-webkit-scrollbar { width:4px; }
    #maw-log::-webkit-scrollbar-thumb { background:#1c2035; border-radius:2px; }
    #maw-log .hi   { color:#a78bfa; }
    #maw-log .ok   { color:#34d399; }
    #maw-log .err  { color:#f87171; }
    #maw-log .warn { color:#fbbf24; }

    /* EXP PANEL */
    #maw-exp-panel { margin-top:6px; background:#0a0e1c; border:1px solid #1c2035; border-radius:7px; padding:6px 8px; font-size:11px; }
    .maw-exp-bar-wrap { background:#141829; border-radius:4px; height:7px; margin:4px 0 3px; overflow:hidden; }
    .maw-exp-bar { background:linear-gradient(90deg,#7c3aed,#a78bfa); height:100%; border-radius:4px; transition:width .5s; }
    .maw-exp-row { display:flex; justify-content:space-between; font-size:10px; color:#4b5a8a; }
    .maw-exp-row span { color:#7880a8; }

    /* ZŁOTO PANEL */
    #maw-gold-panel { margin-top:5px; background:#0a0e1c; border:1px solid #1c2035; border-radius:7px; padding:6px 8px; font-size:11px; }
    .maw-gold-row { display:flex; justify-content:space-between; font-size:11px; margin:2px 0; }
    .maw-gold-lbl { color:#4b5a8a; }
    .maw-gold-val { color:#f59e0b; font-weight:600; }

    /* AUTO-F PANEL */
    #maw-autof-panel { margin-top:5px; background:#0a0e1c; border:1px solid #1c2035; border-radius:7px; padding:6px 8px; font-size:11px; }
    .maw-autof-row { display:flex; justify-content:space-between; align-items:center; margin:3px 0; }
    #maw-autof-status { font-weight:700; font-size:11px; color:#4b5a8a; }
    .maw-hp-bar-wrap { background:#141829; border-radius:4px; height:5px; margin:3px 0; overflow:hidden; }
    .maw-hp-bar { background:linear-gradient(90deg,#22c55e,#86efac); height:100%; border-radius:4px; transition:width .3s; }
    .maw-hp-bar.low { background:linear-gradient(90deg,#dc2626,#f87171); }
    .maw-hp-bar.mid { background:linear-gradient(90deg,#f59e0b,#fbbf24); }

    /* CAPTCHA PANEL */
    #maw-captcha-panel { margin-top:5px; background:#0f1020; border:1px solid #7c3aed55; border-radius:7px; padding:6px 8px; font-size:11px; }
    #maw-captcha-status { color:#a78bfa; font-size:11px; }

    /* TORBA PANEL */
    #maw-bag-panel { margin-top:5px; background:#0a0e1c; border:1px solid #1c2035; border-radius:7px; padding:6px 8px; font-size:11px; }
    .maw-bag-row { display:flex; justify-content:space-between; align-items:center; margin:2px 0; font-size:11px; }
    .maw-bag-label { color:#4b5a8a; }
    .maw-bag-val   { color:#7880a8; }
    .maw-bag-warn  { color:#f87171 !important; font-weight:700; }
    .maw-bag-ok    { color:#34d399 !important; }
    .maw-pot-item  { font-size:10px; color:#3d4875; display:flex; justify-content:space-between; margin:1px 0; }
    .maw-pot-item span { color:#5b6a9a; }

    /* UMIEJĘTNOŚCI PANEL */
    #maw-skills-panel { margin-top:5px; background:#0a0e1c; border:1px solid #1c2035; border-radius:7px; padding:6px 8px; font-size:11px; }
    .maw-skill-item { display:flex; align-items:center; gap:5px; margin:2px 0; font-size:11px; }
    .maw-skill-name { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#7880a8; }
    .maw-skill-bar-wrap { width:60px; background:#141829; border-radius:3px; height:5px; }
    .maw-skill-bar { height:100%; border-radius:3px; background:#7c3aed; }
    .maw-skill-lvl { color:#4b5a8a; font-size:10px; min-width:28px; text-align:right; }
    .maw-skill-active { width:6px; height:6px; border-radius:50%; flex-shrink:0; }
    .maw-skill-pts { display:flex; justify-content:space-between; margin-bottom:4px; }
    .maw-skill-pts-lbl { color:#4b5a8a; font-size:10px; }
    .maw-skill-pts-val { color:#a78bfa; font-size:10px; font-weight:700; }

    /* INFO */
    #maw-info { margin-top:5px; background:#060810; border:1px solid #1c2035; border-radius:5px; padding:3px 8px; font-size:10px; color:#2e3660; line-height:1.7; }
    #maw-info span { color:#4b5a8a; }

    .maw-sep { border:none; border-top:1px solid #1c2035; margin:6px 0; }

    /* Tabsy */
    .maw-tabs { display:flex; gap:3px; margin:6px 0 4px; }
    .maw-tab { flex:1; padding:4px; text-align:center; background:#111528; border:1px solid #1c2035; border-radius:5px; cursor:pointer; font-size:10px; color:#4b5a8a; transition:all .15s; }
    .maw-tab.active { background:#7c3aed22; border-color:#7c3aed; color:#a78bfa; }
    `;
    document.head.appendChild($style);

    // ═══════════════════════════════════════════════════════════
    //  HTML PANELU
    // ═══════════════════════════════════════════════════════════
    const panel = document.createElement('div');
    panel.id = 'maw-panel';
    panel.innerHTML = `
    <header id="maw-hdr">
        <b>⚔ AutoWalk v3 <span style="color:#f59e0b;font-size:10px">PALADYN</span></b>
        <span id="maw-badge">gotowy</span>
    </header>
    <div id="maw-body">

        <!-- ZAKŁADKI -->
        <div class="maw-tabs">
            <div class="maw-tab active" data-tab="bot">🤖 Bot</div>
            <div class="maw-tab" data-tab="autof">⚡ Auto-F</div>
            <div class="maw-tab" data-tab="skills">🛡 Umki</div>
            <div class="maw-tab" data-tab="captcha">🔑 CAPTCHA</div>
        </div>

        <!-- === TAB: BOT === -->
        <div id="tab-bot">
            <div class="maw-lbl">Filtr poziomów</div>
            <div class="maw-row">
                <label>Min lvl</label>
                <input class="maw-inp" id="maw-minlvl" type="number" value="1" min="1" max="999" style="width:52px">
                <label>Max lvl</label>
                <input class="maw-inp" id="maw-maxlvl" type="number" value="200" min="1" max="999" style="width:52px">
            </div>
            <div class="maw-row">
                <label>Zasięg</label>
                <input class="maw-inp" id="maw-range" type="number" value="999" min="1" max="999" style="width:52px">
                <label style="color:#3d4875;font-size:10px">(999=∞)</label>
            </div>
            <label class="maw-chk"><input type="checkbox" id="maw-grp"> Tylko grupowe (grp)</label>
            <div class="maw-row" style="margin-top:4px">
                <label>Sortuj</label>
                <select class="maw-sel" id="maw-sort">
                    <option value="dist" selected>Najbliższy ⚡</option>
                    <option value="lvl_asc">Lvl ↑</option>
                    <option value="lvl_desc">Lvl ↓</option>
                </select>
            </div>
            <div class="maw-row">
                <label>Walk delay</label>
                <input class="maw-inp" id="maw-walkd" type="number" value="1500" min="300" max="9999" style="width:58px">ms
                <label>Atk</label>
                <input class="maw-inp" id="maw-atkd" type="number" value="1000" min="200" max="9999" style="width:58px">ms
            </div>
            <hr class="maw-sep">
            <div class="maw-lbl">Torba / Potki</div>
            <label class="maw-chk"><input type="checkbox" id="maw-stopfull"> Stop gdy torba pełna</label>
            <label class="maw-chk"><input type="checkbox" id="maw-stopnopot"> Stop gdy brak poteków</label>
            <hr class="maw-sep">
            <div class="maw-lbl" id="maw-mob-lbl">Moby (0 znalezionych)</div>
            <div id="maw-list"></div>
            <div class="maw-btns">
                <button class="maw-btn maw-start" id="maw-btn-start">▶ Start</button>
                <button class="maw-btn maw-stop"  id="maw-btn-stop" disabled>⏹ Stop</button>
            </div>
            <div id="maw-status-bar">
                <span id="maw-status-icon">💤</span>
                <span id="maw-status-txt">Nieaktywny</span>
            </div>
            <div id="maw-log"></div>
            <!-- EXP -->
            <div id="maw-exp-panel">
                <div class="maw-lbl" style="margin:0 0 3px">📊 EXP / Next Level</div>
                <div class="maw-exp-bar-wrap"><div class="maw-exp-bar" id="maw-exp-bar" style="width:0%"></div></div>
                <div class="maw-exp-row">
                    <div>Postęp: <span id="maw-exp-pct">-</span>%</div>
                    <div>Do lvl: <span id="maw-exp-left">-</span></div>
                </div>
                <div class="maw-exp-row" style="margin-top:2px">
                    <div>Tempo: <span id="maw-exp-rate">-</span>/min</div>
                    <div>Czas: <span id="maw-exp-eta">-</span></div>
                </div>
                <div class="maw-exp-row" style="margin-top:2px">
                    <div>Sesja: <span id="maw-exp-session">0</span></div>
                    <div><span id="maw-exp-session-rate">-</span>/h</div>
                </div>
            </div>
            <!-- ZŁOTO -->
            <div id="maw-gold-panel">
                <div class="maw-lbl" style="margin:0 0 3px">💰 Złoto</div>
                <div class="maw-gold-row">
                    <span class="maw-gold-lbl">Posiadane</span>
                    <span class="maw-gold-val" id="maw-gold-cur">-</span>
                </div>
                <div class="maw-gold-row">
                    <span class="maw-gold-lbl">Zysk sesji</span>
                    <span class="maw-gold-val" id="maw-gold-gain" style="color:#34d399">-</span>
                </div>
                <div class="maw-gold-row">
                    <span class="maw-gold-lbl">Tempo /h</span>
                    <span class="maw-gold-val" id="maw-gold-rate">-</span>
                </div>
            </div>
            <!-- TORBA -->
            <div id="maw-bag-panel">
                <div class="maw-lbl" style="margin:0 0 3px">🎒 Torba / Potki HP</div>
                <div class="maw-bag-row">
                    <span class="maw-bag-label">Wolne sloty</span>
                    <span class="maw-bag-val" id="maw-bag-free">-</span>
                </div>
                <div class="maw-bag-row">
                    <span class="maw-bag-label">Zajęte</span>
                    <span class="maw-bag-val" id="maw-bag-used">-</span>
                </div>
                <div id="maw-pot-list" style="margin-top:3px"></div>
            </div>
        </div>

        <!-- === TAB: AUTO-F === -->
        <div id="tab-autof" style="display:none">
            <div id="maw-autof-panel">
                <div class="maw-lbl" style="margin:0 0 3px">⚡ Auto Szybka Walka</div>
                <label class="maw-chk">
                    <input type="checkbox" id="maw-autof-enable" checked>
                    Włącz Auto-F
                </label>
                <div class="maw-autof-row" style="margin-top:4px">
                    <label style="color:#7880a8;font-size:11px">Min HP dla Auto-F</label>
                    <input class="maw-inp" id="maw-autof-minhp" type="number" value="40" min="1" max="99" style="width:50px">%
                </div>
                <div class="maw-hp-bar-wrap" style="margin-top:5px"><div class="maw-hp-bar" id="maw-hp-bar" style="width:100%"></div></div>
                <div class="maw-autof-row" style="margin-top:3px">
                    <span style="color:#4b5a8a;font-size:10px">HP bohatera</span>
                    <span id="maw-hp-pct" style="color:#7880a8;font-size:11px">?%</span>
                </div>
                <div class="maw-autof-row" style="margin-top:5px;">
                    <span style="color:#4b5a8a;font-size:10px">Status Auto-F</span>
                    <span id="maw-autof-status">💤 Czeka</span>
                </div>
                <div style="margin-top:6px;font-size:10px;color:#2e3660;line-height:1.6">
                    ⚡ Gdy HP > progu → Szybka Walka<br>
                    🛡 Gdy HP ≤ progu → Turowa (bezpieczna)<br>
                    Działa tylko gdy jest aktywna walka.
                </div>
            </div>
        </div>

        <!-- === TAB: UMIEJĘTNOŚCI === -->
        <div id="tab-skills" style="display:none">
            <div id="maw-skills-panel">
                <div class="maw-lbl" style="margin:0 0 3px">🛡 Umiejętności Paladyna</div>
                <div class="maw-skill-pts">
                    <span class="maw-skill-pts-lbl">Rozdane punkty</span>
                    <span class="maw-skill-pts-val" id="maw-skill-pts">-</span>
                </div>
                <div id="maw-skill-list" style="max-height:320px;overflow-y:auto"></div>
                <div style="margin-top:5px">
                    <button class="maw-btn" style="background:#111528;border:1px solid #1c2035;color:#7880a8;padding:4px;font-size:10px;width:100%" id="maw-refresh-skills">🔄 Odśwież umiejętności</button>
                </div>
            </div>
        </div>

        <!-- === TAB: CAPTCHA === -->
        <div id="tab-captcha" style="display:none">
            <div id="maw-captcha-panel">
                <div class="maw-lbl" style="margin:0 0 3px">🔑 CAPTCHA Auto-Solver</div>
                <label class="maw-chk">
                    <input type="checkbox" id="maw-captcha-enable" checked>
                    Włącz auto-solver
                </label>
                <div class="maw-autof-row" style="margin-top:5px">
                    <span style="color:#4b5a8a;font-size:10px">Status</span>
                    <span id="maw-captcha-status" style="color:#a78bfa;font-size:11px">Czeka na CAPTCHĘ</span>
                </div>
                <div style="margin-top:8px">
                    <button class="maw-btn" style="background:#7c3aed;color:#fff;padding:5px;font-size:11px;width:100%" id="maw-captcha-solve-now">🔑 Rozwiąż teraz (ręcznie)</button>
                </div>
                <div style="margin-top:6px;font-size:10px;color:#2e3660;line-height:1.6">
                    Zagadka: <b style="color:#a78bfa">zaznacz odpowiedzi z gwiazdką *</b><br>
                    Bot szuka przycisków z * w nazwie<br>
                    i klika wszystkie, potem Potwierdzam.<br>
                    Sprawdza co 2 sekundy automatycznie.
                </div>
            </div>
        </div>

        <!-- INFO -->
        <div id="maw-info">
            🗺 Iface: <span id="maw-iface">${IFACE}</span> &nbsp;|&nbsp;
            🧑 Tile: <span id="maw-heropos">?</span><br>
            🎯 Cel: <span id="maw-target">brak</span>
        </div>
    </div>
    `;
    document.body.appendChild(panel);

    // ═══════════════════════════════════════════════════════════
    //  ZAKŁADKI LOGIKA
    // ═══════════════════════════════════════════════════════════
    const tabs = {
        bot:     document.getElementById('tab-bot'),
        autof:   document.getElementById('tab-autof'),
        skills:  document.getElementById('tab-skills'),
        captcha: document.getElementById('tab-captcha'),
    };

    document.querySelectorAll('.maw-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.maw-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const name = tab.dataset.tab;
            Object.entries(tabs).forEach(([k, el]) => {
                el.style.display = k === name ? '' : 'none';
            });
            if (name === 'skills') renderSkills();
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  DRAG
    // ═══════════════════════════════════════════════════════════
    let drag = false, ddx=0, ddy=0;
    document.getElementById('maw-hdr').addEventListener('mousedown', e => {
        drag = true;
        const r = panel.getBoundingClientRect();
        ddx = e.clientX - r.left; ddy = e.clientY - r.top;
    });
    document.addEventListener('mousemove', e => {
        if (!drag) return;
        panel.style.left  = (e.clientX - ddx) + 'px';
        panel.style.top   = (e.clientY - ddy) + 'px';
        panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => { drag = false; });

    // ═══════════════════════════════════════════════════════════
    //  LOG
    // ═══════════════════════════════════════════════════════════
    const $log = document.getElementById('maw-log');
    const MAX_LOG = 60;
    function log(html) {
        const line = document.createElement('div');
        line.innerHTML = html;
        $log.appendChild(line);
        while ($log.childElementCount > MAX_LOG) $log.removeChild($log.firstChild);
        $log.scrollTop = $log.scrollHeight;
    }

    function updateStatus(txt, icon='💤') {
        document.getElementById('maw-status-icon').textContent = icon;
        document.getElementById('maw-status-txt').textContent  = txt;
    }

    // ═══════════════════════════════════════════════════════════
    //  RENDER LISTY MOBÓW
    // ═══════════════════════════════════════════════════════════
    const TYPE_COL = {
        'szaman':'#a855f7','wojownik':'#ef4444','goblin':'#22c55e',
        'nocny':'#94a3b8','słabeusz':'#22c55e','ghul':'#64748b',
        'troll':'#f59e0b','wilk':'#10b981','szkielet':'#6366f1',
        'mistrz':'#f59e0b','zły':'#dc2626',
    };
    function typeCol(name) {
        const n = name.toLowerCase();
        for (const [k,v] of Object.entries(TYPE_COL)) if (n.includes(k)) return v;
        return '#7c3aed';
    }

    function renderMobList(mobs) {
        const list = document.getElementById('maw-list');
        list.innerHTML = '';
        document.getElementById('maw-badge').textContent = mobs.length + ' mobów';
        document.getElementById('maw-mob-lbl').textContent = `Moby (${mobs.length} znalezionych)`;

        const hero = getHeroTile() || {x:0,y:0};
        document.getElementById('maw-heropos').textContent = hero ? `${hero.x},${hero.y}` : '?';
        document.getElementById('maw-target').textContent  = target ? `${target.name} (${target.tx},${target.ty})` : 'brak';

        const nearestId = mobs.length > 0 ? mobs[0].id : null;

        mobs.forEach(m => {
            const d   = tileDist(hero, m).toFixed(1);
            const col = typeCol(m.name);
            const isCur  = target && m.id === target.id;
            const isNear = !isCur && m.id === nearestId;
            const row = document.createElement('div');
            row.className = 'maw-mob' + (isCur ? ' cur' : isNear ? ' near' : '');
            row.innerHTML = `
                <span class="maw-dot" style="background:${col}"></span>
                <span class="maw-mname">${m.name}</span>
                <span class="maw-mmeta">Lv${m.lvl}${m.grp?' ⚡':''} · ${d}kaf</span>
                ${isCur  ? '<span class="maw-walk-badge">➤ cel</span>'   : ''}
                ${isNear ? '<span class="maw-near-badge">★ blisko</span>' : ''}
            `;
            list.appendChild(row);
        });
    }

    // ═══════════════════════════════════════════════════════════
    //  RENDER EXP
    // ═══════════════════════════════════════════════════════════
    function renderExp() {
        const info = getExpInfo();
        recordExpTick(info);
        if (!info) return;

        const pct     = info.progress.toFixed(1);
        const rate    = calcExpRate();
        const rateMin = rate ? Math.round(rate * 60) : null;
        const eta     = calcTimeToLvl(info);
        const sessionGain = getSessionGain();
        const sessionDur  = getSessionDuration();
        const sessionRate = sessionDur > 10 ? Math.round(sessionGain / sessionDur * 3600) : 0;

        document.getElementById('maw-exp-bar').style.width  = pct + '%';
        document.getElementById('maw-exp-pct').textContent  = pct;
        document.getElementById('maw-exp-left').textContent = fmtExp(info.expLeft);
        document.getElementById('maw-exp-rate').textContent = rateMin ? fmtExp(rateMin) : '—';
        document.getElementById('maw-exp-eta').textContent  = eta ? eta.formatted : '—';
        document.getElementById('maw-exp-session').textContent = fmtExp(sessionGain);
        document.getElementById('maw-exp-session-rate').textContent = sessionRate > 0 ? fmtExp(sessionRate) : '—';
    }

    // ═══════════════════════════════════════════════════════════
    //  ★ RENDER ZŁOTA
    // ═══════════════════════════════════════════════════════════
    function renderGold() {
        const cur  = getGold();
        const gain = getGoldGain();
        const rate = getGoldRate();

        const curEl  = document.getElementById('maw-gold-cur');
        const gainEl = document.getElementById('maw-gold-gain');
        const rateEl = document.getElementById('maw-gold-rate');

        if (curEl)  curEl.textContent  = cur  !== null ? fmtNum(cur)  : '—';
        if (gainEl) {
            gainEl.textContent = gain !== 0 ? (gain > 0 ? '+' : '') + fmtNum(gain) : '0';
            gainEl.style.color = gain > 0 ? '#34d399' : gain < 0 ? '#f87171' : '#7880a8';
        }
        if (rateEl) rateEl.textContent = rate > 0 ? fmtNum(rate) + '/h' : '—';
    }

    function fmtNum(n) {
        if (n >= 1e9) return (n/1e9).toFixed(2)+'g';
        if (n >= 1e6) return (n/1e6).toFixed(2)+'m';
        if (n >= 1e3) return Math.round(n).toLocaleString('pl-PL');
        return String(n);
    }

    // ═══════════════════════════════════════════════════════════
    //  ★ RENDER HP (dla Auto-F)
    // ═══════════════════════════════════════════════════════════
    function renderHP() {
        const hp = getHeroHP();
        const barEl = document.getElementById('maw-hp-bar');
        const pctEl = document.getElementById('maw-hp-pct');
        if (!barEl || !pctEl) return;

        barEl.style.width = hp.pct + '%';
        pctEl.textContent = hp.pct + '%';

        barEl.classList.remove('low', 'mid');
        if (hp.pct <= cfgAutoFMinHP)         barEl.classList.add('low');
        else if (hp.pct <= cfgAutoFMinHP + 20) barEl.classList.add('mid');
    }

    // ═══════════════════════════════════════════════════════════
    //  ★ RENDER UMIEJĘTNOŚCI
    // ═══════════════════════════════════════════════════════════
    function renderSkills() {
        const skills = scanSkills(true);
        const pts    = getSkillPoints();

        const ptsEl = document.getElementById('maw-skill-pts');
        if (ptsEl) ptsEl.textContent = `${pts.learnt}/${pts.total} (wolne: ${pts.free})`;

        const list = document.getElementById('maw-skill-list');
        if (!list) return;
        list.innerHTML = '';

        const learned = skills.filter(s => s.learned);
        const notLearned = skills.filter(s => !s.learned && s.curLvl === 0);

        if (!learned.length && !notLearned.length) {
            list.innerHTML = '<div style="color:#3d4875;font-size:10px;text-align:center;padding:8px">Otwórz panel umiejętności w grze (U)</div>';
            return;
        }

        // Nauczone
        if (learned.length) {
            const hdr = document.createElement('div');
            hdr.innerHTML = '<div style="color:#34d399;font-size:9px;text-transform:uppercase;letter-spacing:.8px;margin:4px 0 3px">✓ Nauczone</div>';
            list.appendChild(hdr);

            learned.forEach(s => {
                const pct = s.maxLvl > 0 ? (s.curLvl / s.maxLvl * 100) : 0;
                const row = document.createElement('div');
                row.className = 'maw-skill-item';
                row.innerHTML = `
                    <span class="maw-skill-active" style="background:${s.isActive ? '#34d399' : '#3d4875'}"></span>
                    <span class="maw-skill-name" title="${s.name}">${s.name}</span>
                    <div class="maw-skill-bar-wrap"><div class="maw-skill-bar" style="width:${pct}%"></div></div>
                    <span class="maw-skill-lvl">${s.curLvl}/${s.maxLvl}</span>
                `;
                list.appendChild(row);
            });
        }

        // Nie nauczone
        if (notLearned.length) {
            const hdr = document.createElement('div');
            hdr.innerHTML = '<div style="color:#4b5a8a;font-size:9px;text-transform:uppercase;letter-spacing:.8px;margin:6px 0 3px">○ Dostępne</div>';
            list.appendChild(hdr);

            notLearned.slice(0, 5).forEach(s => {
                const row = document.createElement('div');
                row.className = 'maw-skill-item';
                row.innerHTML = `
                    <span class="maw-skill-active" style="background:#1c2035"></span>
                    <span class="maw-skill-name" style="color:#3d4875" title="${s.name}">${s.name}</span>
                    <div class="maw-skill-bar-wrap"><div class="maw-skill-bar" style="width:0%;background:#1c2035"></div></div>
                    <span class="maw-skill-lvl" style="color:#2e3660">0/${s.maxLvl}</span>
                `;
                list.appendChild(row);
            });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  RENDER TORBY
    // ═══════════════════════════════════════════════════════════
    function renderBag() {
        const bag = getBagInfo();
        if (!bag) return;

        const freeEl = document.getElementById('maw-bag-free');
        const usedEl = document.getElementById('maw-bag-used');
        const potEl  = document.getElementById('maw-pot-list');

        freeEl.textContent = bag.freeSlots + ' / ' + bag.totalSlots;
        freeEl.className   = 'maw-bag-val' + (bag.isFull ? ' maw-bag-warn' : bag.freeSlots < 10 ? ' maw-bag-warn' : ' maw-bag-ok');
        usedEl.textContent = bag.usedSlots;

        potEl.innerHTML = '';
        if (bag.potions.length === 0) {
            const d = document.createElement('div');
            d.className = 'maw-pot-item';
            d.innerHTML = '<span style="color:#f87171">Brak poteków HP!</span>';
            potEl.appendChild(d);
        } else {
            let totalPots = 0;
            bag.potions.forEach(p => {
                totalPots += p.qty;
                const d = document.createElement('div');
                d.className = 'maw-pot-item';
                d.innerHTML = `<span>${p.name.slice(0,22)}</span><span>×${p.qty} (${fmtExp(p.heal)} HP)</span>`;
                potEl.appendChild(d);
            });
            if (bag.potions.length > 1) {
                const d = document.createElement('div');
                d.className = 'maw-pot-item';
                d.innerHTML = `<span style="color:#34d399">Razem poteków:</span><span style="color:#34d399">×${totalPots}</span>`;
                potEl.insertBefore(d, potEl.firstChild);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  RENDER WSZYSTKIEGO
    // ═══════════════════════════════════════════════════════════
    function renderAll() {
        renderMobList(getFilteredMobs());
        renderExp();
        renderBag();
        renderGold();
        renderHP();
    }

    // ═══════════════════════════════════════════════════════════
    //  KONTROLKI
    // ═══════════════════════════════════════════════════════════
    document.getElementById('maw-btn-start').addEventListener('click', () => {
        document.getElementById('maw-btn-start').disabled = true;
        document.getElementById('maw-btn-stop').disabled  = false;
        startBot();
    });
    document.getElementById('maw-btn-stop').addEventListener('click', () => { stopBot(); });

    document.getElementById('maw-minlvl').addEventListener('input',  e => { cfgMinLvl    = parseInt(e.target.value)||1; renderAll(); });
    document.getElementById('maw-maxlvl').addEventListener('input',  e => { cfgMaxLvl    = parseInt(e.target.value)||999; renderAll(); });
    document.getElementById('maw-range').addEventListener('input',   e => { cfgRange     = parseInt(e.target.value)||999; renderAll(); });
    document.getElementById('maw-grp').addEventListener('change',    e => { cfgGrpOnly   = e.target.checked; renderAll(); });
    document.getElementById('maw-sort').addEventListener('change',   e => { cfgSortBy    = e.target.value; renderAll(); });
    document.getElementById('maw-walkd').addEventListener('input',   e => { cfgWalkDelay = parseInt(e.target.value)||1500; });
    document.getElementById('maw-atkd').addEventListener('input',    e => { cfgAtkDelay  = parseInt(e.target.value)||1000; });
    document.getElementById('maw-stopfull').addEventListener('change',  e => { cfgStopFull  = e.target.checked; });
    document.getElementById('maw-stopnopot').addEventListener('change', e => { cfgStopNoPot = e.target.checked; });

    // Auto-F kontrolki
    document.getElementById('maw-autof-enable').addEventListener('change', e => {
        autoFEnabled = e.target.checked;
        log(autoFEnabled ? '<span class="ok">⚡ Auto-F włączony</span>' : '<span class="warn">⚡ Auto-F wyłączony</span>');
    });
    document.getElementById('maw-autof-minhp').addEventListener('input', e => {
        cfgAutoFMinHP = parseInt(e.target.value) || 40;
        log(`🛡 Min HP dla Auto-F: ${cfgAutoFMinHP}%`);
    });
    autoFEnabled = document.getElementById('maw-autof-enable').checked;

    // CAPTCHA kontrolki
    document.getElementById('maw-captcha-enable').addEventListener('change', e => {
        captchaEnabled = e.target.checked;
        log(captchaEnabled ? '<span class="ok">🔑 CAPTCHA solver włączony</span>' : '<span class="warn">🔑 CAPTCHA solver wyłączony</span>');
    });
    document.getElementById('maw-captcha-solve-now').addEventListener('click', () => {
        lastCaptchaCheck = 0; // reset cooldown
        const res = solveCaptcha();
        if (!res) {
            log('<span class="warn">🔑 Brak aktywnej CAPTCHY lub brak odpowiedzi z *</span>');
            updateCaptchaStatus('Brak CAPTCHY');
        }
    });

    // Refresh umiejętności
    document.getElementById('maw-refresh-skills').addEventListener('click', () => {
        scanSkills(true);
        renderSkills();
        log('<span class="ok">🛡 Umiejętności odświeżone</span>');
    });

    // ═══════════════════════════════════════════════════════════
    //  TIMERY AUTOMATYCZNE
    // ═══════════════════════════════════════════════════════════

    // Auto-F — co 300ms gdy w walce
    setInterval(() => {
        if (autoFEnabled) autoFTick();
        renderHP();
    }, 300);

    // CAPTCHA — co 2s
    setInterval(() => {
        if (captchaEnabled) {
            const found = solveCaptcha();
            if (!found) updateCaptchaStatus('Czeka na CAPTCHĘ');
        }
    }, 2000);

    // Render wszystkiego co 2s gdy nieaktywny
    setInterval(() => {
        if (!running) renderAll();
    }, 2000);

    // EXP, Złoto, Torba co 3s
    setInterval(() => {
        renderExp();
        renderBag();
        renderGold();
    }, 3000);

    // ═══════════════════════════════════════════════════════════
    //  INIT
    // ═══════════════════════════════════════════════════════════
    setTimeout(() => {
        recordGoldStart();
        renderAll();
        log(`<span class="ok">✓ AutoWalk+Attack v3 PALADYN załadowany (${IFACE})</span>`);
        log('⚡ Auto-F aktywny | 🔑 CAPTCHA Solver gotowy');
        log('Ustaw filtry i kliknij ▶ Start');
    }, 900);

})();