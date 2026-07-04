// ==UserScript==
// @name         Margonem – AutoWalk + AutoAttack v3.0 [PALADYN EDITION]
// @namespace    http://tampermonkey.net/
// @version      3.1.4-dev
// @description  Bot z Auto-F, CAPTCHA solvem, statystykami EXP/złota. Logika hostowana (loader + bridge).
// @author       you
// @match        https://*.margonem.pl/*
// @grant        GM_addElement
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindowQ
// @connect      cdn.jsdelivr.net
// @connect      raw.githubusercontent.com
// @connect      127.0.0.1
// @connect      localhost
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ─── Tryb DEV (localhost) ───────────────────────────────────────────────
    // Lokalne testowanie bez GitHub/CDN:
    //   1. npm run dev  (serwer na http://127.0.0.1:3847)
    //   2. Ustaw DEV = true poniżej (lub GM_setValue('maw_dev_mode', true))
    //   3. Zainstaluj loader w Tampermonkey, otwórz margonem.pl
    //   4. Dashboard: http://127.0.0.1:3847/
    //   5. Przy mixed content w przeglądarce — zezwól na HTTP z HTTPS strony
    const DEV_PORT = 3847;
    // Ustaw true dla localhost + dashboard (npm run dev)
    const DEV = true;
    const DEV_GM_KEY = 'maw_dev_mode';
    // const DEV = GM_getValue(DEV_GM_KEY, false); // alternatywa: włącz z konsoli TM
    const DEV_API = `http://127.0.0.1:${DEV_PORT}/api/state`;
    const AI_SKILLS_API = `http://127.0.0.1:${DEV_PORT}/api/ai/skills`;
    const PROD_HOST = 'https://cdn.jsdelivr.net/gh/USER/REPO@main/hosted/';
    const HOST = DEV ? `http://127.0.0.1:${DEV_PORT}/hosted/` : PROD_HOST;
    const MAPS_VERSION = '1';
    const CORE_VERSION = '3';
    const MAPS_CACHE_KEY = 'maw_maps_v' + MAPS_VERSION;
    const SETTINGS_KEY = 'maw_settings_v2';

    // Obiekty gry (Engine, hero) są na stronie — nie w sandboxie Tampermonkey
    const $w = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    const DEFAULT_SETTINGS = {
        minLvl: 1,
        maxLvl: 200,
        range: 999,
        grpOnly: false,
        sortBy: 'dist',
        walkDelay: 1500,
        atkDelay: 1000,
        arrDist: 2.5,
        stopFull: false,
        stopNoPot: false,
        autoFEnabled: true,
        autoFMinHP: 40,
        captchaEnabled: true,
        aiSkillsEnabled: false,
        aiApplyEnabled: false,
        panelLeft: null,
        panelTop: null,
        travelEnabled: false,
        targetMapId: 0,
        heroHunterEnabled: false,
        heroHunterName: 'Zmora',
        patrolMapIds: [],
        antiStasisEnabled: true,
        questAutoEnabled: true,
        questAutoNav: true,
    };

    function loadSettings() {
        try {
            return { ...DEFAULT_SETTINGS, ...(JSON.parse(GM_getValue(SETTINGS_KEY, '{}')) || {}) };
        } catch (e) {
            return { ...DEFAULT_SETTINGS };
        }
    }

    function saveSettings(patch = {}) {
        Object.assign(settings, patch);
        GM_setValue(SETTINGS_KEY, JSON.stringify(settings));
    }

    let settings = loadSettings();
    let lastSkillPlan = null;
    let lastAiSkillStatus = 'nie pytano';
    let lastAiSkillMode = 'off';
    let lastPatrolMapId = null;
    let patrolVisitTime = 0;
    let patrolStatusText = 'nieaktywna';
    let lastKnownMapId = null;
    let lastPlayerTile = null;

    // ═══════════════════════════════════════════════════════════
    //  WYKRYWANIE INTERFEJSU
    // ═══════════════════════════════════════════════════════════
    const IFACE = (function () {
        if (typeof $w.API !== 'undefined' && typeof $w.Engine !== 'undefined' && typeof $w.margoStorage === 'undefined')
            return 'new';
        if (typeof $w.dbget === 'undefined' && typeof $w.proceed === 'undefined')
            return 'old';
        return 'superold';
    })();

    function hasNewEngine() {
        return $w.Engine && $w.Engine.hero && typeof $w.Engine.hero.autoGoTo === 'function';
    }

    let botApi = null;
    let mapsData = null;

    // ═══════════════════════════════════════════════════════════
    //  BRIDGE — interakcja z DOM / grą (musi zostać lokalnie)
    // ═══════════════════════════════════════════════════════════
    let _mobCache = [];
    let _mobCacheTime = 0;
    let _skillsCache = [];
    let _skillsCacheTime = 0;

    function decodeTip(raw) {
        return (raw || '')
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
            .replace(/&#039;/g, "'");
    }

    function stripTip(raw) {
        return decodeTip(raw)
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function heroGoTo(tx, ty) {
        try {
            if (IFACE === 'new' || hasNewEngine()) {
                try {
                    $w.Engine.hero.autoGoTo({ x: tx, y: ty });
                } catch (e) {
                    // Jeśli pole docelowe to kolizja (np. brama), spróbuj sąsiednich kafelków
                    const neighbors = [
                        { x: tx, y: ty + 1 }, { x: tx, y: ty - 1 },
                        { x: tx + 1, y: ty }, { x: tx - 1, y: ty },
                        { x: tx + 1, y: ty + 1 }, { x: tx - 1, y: ty - 1 },
                        { x: tx + 1, y: ty - 1 }, { x: tx - 1, y: ty + 1 }
                    ];
                    let ok = false;
                    for (const n of neighbors) {
                        try {
                            $w.Engine.hero.autoGoTo({ x: n.x, y: n.y });
                            ok = true;
                            break;
                        } catch (err) {}
                    }
                    if (!ok) throw e;
                }
            } else if (IFACE === 'old' && $w.hero) {
                try {
                    $w.hero.searchPath(tx, ty);
                } catch (e) {
                    const neighbors = [
                        { x: tx, y: ty + 1 }, { x: tx, y: ty - 1 },
                        { x: tx + 1, y: ty }, { x: tx - 1, y: ty }
                    ];
                    let ok = false;
                    for (const n of neighbors) {
                        try {
                            $w.hero.searchPath(n.x, n.y);
                            ok = true;
                            break;
                        } catch (err) {}
                    }
                    if (!ok) throw e;
                }
            } else if ($w.hero) {
                $w.hero.mx = tx;
                $w.hero.my = ty;
                if ($w.global) $w.global.movebymouse = true;
            } else {
                throw new Error('Brak Engine/hero — czy jesteś w grze?');
            }
            return true;
        } catch (e) {
            log(`<span class="err">heroGoTo error: ${e.message}</span>`);
            return false;
        }
    }

    function getHeroTile() {
        try {
            if ((IFACE === 'new' || hasNewEngine()) && $w.Engine.hero && $w.Engine.hero.d) {
                const d = $w.Engine.hero.d;
                return { x: d.x, y: d.y };
            }
            if ($w.hero) return { x: $w.hero.x, y: $w.hero.y };
        } catch (e) {
            const el = document.querySelector('#hero');
            if (!el) return null;
            return {
                x: Math.round(parseInt(el.style.left) / 32),
                y: Math.round(parseInt(el.style.top) / 32),
            };
        }
        return null;
    }

    function getHeroHP() {
        try {
            const heroTroop = document.querySelector('.troop[ctip="t_troop1"]');
            if (heroTroop) {
                const tip = (heroTroop.getAttribute('tip') || '')
                    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
                const lifeM = tip.match(/Życie:\s*(\d+)%/);
                if (lifeM) return { pct: parseInt(lifeM[1], 10), source: 'battle' };
            }
            if ((IFACE === 'new' || hasNewEngine()) && $w.Engine && $w.Engine.hero && $w.Engine.hero.d) {
                const d = $w.Engine.hero.d;
                if (d.hp && d.maxhp) return { pct: Math.round(d.hp / d.maxhp * 100), source: 'engine' };
            }
            if ($w.hero && $w.hero.hp && $w.hero.maxhp) {
                return { pct: Math.round($w.hero.hp / $w.hero.maxhp * 100), source: 'hero' };
            }
            const hpPctEl = document.getElementById('hpProcent');
            if (hpPctEl) {
                const pct = parseFloat(hpPctEl.textContent);
                if (!isNaN(pct)) return { pct: Math.round(pct), source: 'hpProcent' };
            }
            const life1 = document.getElementById('life1');
            if (life1) {
                const tip = (life1.getAttribute('tip') || '')
                    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
                const m = tip.match(/(\d[\d\s]*)\s*\/\s*(\d[\d\s]*)/);
                if (m) {
                    const cur = parseInt(m[1].replace(/\s/g, ''), 10);
                    const max = parseInt(m[2].replace(/\s/g, ''), 10);
                    if (max > 0) return { pct: Math.round(cur / max * 100), source: 'life1' };
                }
            }
            const lifeEl = document.getElementById('hpProcent');
            if (lifeEl) {
                const pct = parseFloat(lifeEl.textContent);
                if (!isNaN(pct)) return { pct: Math.round(pct), source: 'dom' };
            }
        } catch (e) { /* ignore */ }
        return { pct: 100, source: 'unknown' };
    }

    function scanMobs(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && now - _mobCacheTime < 300) return _mobCache;

        const mobs = [];

        // ══ NI: użyj Engine.npcs jeśli dostępne ══
        if ((IFACE === 'new' || hasNewEngine()) && $w.Engine && $w.Engine.npcs) {
            try {
                const npcsMap = typeof $w.Engine.npcs.get === 'function'
                    ? $w.Engine.npcs.get()
                    : ($w.Engine.npcs.list || $w.Engine.npcs);

                const npcList = npcsMap instanceof Map
                    ? Array.from(npcsMap.values())
                    : (Array.isArray(npcsMap) ? npcsMap : Object.values(npcsMap || {}));

                npcList.forEach(npc => {
                    if (!npc || !npc.d) return;
                    const d = npc.d;
                    // Pomijaj NPCe questowe (typ dialog) i własne party
                    if (d.type === 'h' || d.wt === 0) return; // 'h' = hero/gracz
                    const name = d.name || d.nick || '';
                    const lvl = d.lvl || d.level || 0;
                    const tx = d.x || 0;
                    const ty = d.y || 0;

                    const tip = (d.tip || '').toLowerCase();
                    let rank = 'regular';
                    if (tip.includes('kolos') || tip.includes('colossus')) rank = 'colossus';
                    else if (tip.includes('heros') || tip.includes('hero')) rank = 'hero';
                    else if (tip.includes('elita ii') || tip.includes('elite ii')) rank = 'elite2';
                    else if (tip.includes('elita') || tip.includes('elite')) rank = 'elite';
                    else if (d.wt && d.wt >= 10) rank = 'colossus'; // wt=waga/typ: 10+ = kolos w NI

                    mobs.push({
                        id: String(d.id || npc.id || ''),
                        el: document.getElementById('npc' + (d.id || npc.id || '')),
                        name,
                        lvl,
                        grp: !!d.grp,
                        rank,
                        tx,
                        ty,
                        px: tx * 32 + 16,
                        py: ty * 32 + 16,
                        _niNpc: npc,
                    });
                });

                if (mobs.length > 0) {
                    _mobCache = mobs;
                    _mobCacheTime = now;
                    return mobs;
                }
            } catch (e) {
                // Fallback do DOM
            }
        }

        // ══ SI / fallback: skanuj DOM ══
        document.querySelectorAll('.npc[ctip="t_npc"]').forEach(el => {
            const raw = el.getAttribute('tip') || '';
            const tip = raw
                .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&').replace(/&quot;/g, '"');

            const nameM = tip.match(/<b>(.*?)<\/b>/);
            const lvlM = tip.match(/(\d+)\s*lvl/);
            if (!nameM || !lvlM) return;

            const px = parseInt(el.style.left, 10) || 0;
            const py = parseInt(el.style.top, 10) || 0;
            const w = parseInt(el.style.width, 10) || 32;
            const h = parseInt(el.style.height, 10) || 32;
            const tx = Math.round((px + w / 2) / 32);
            const ty = Math.round((py + h / 2) / 32);

            const lowerTip = tip.toLowerCase();
            let rank = 'regular';
            if (lowerTip.includes('kolos') || lowerTip.includes('colossus')) rank = 'colossus';
            else if (lowerTip.includes('heros') || lowerTip.includes('hero')) rank = 'hero';
            else if (lowerTip.includes('elita ii') || lowerTip.includes('elite ii') || lowerTip.includes('elita 2') || lowerTip.includes('elite 2')) rank = 'elite2';
            else if (lowerTip.includes('elita') || lowerTip.includes('elite')) rank = 'elite';

            mobs.push({
                id: el.id.replace('npc', ''),
                el,
                name: nameM[1],
                lvl: parseInt(lvlM[1], 10),
                grp: tip.includes('grp'),
                rank,
                tx, ty,
                px: px + w / 2,
                py: py + h / 2,
            });
        });

        _mobCache = mobs;
        _mobCacheTime = now;
        return mobs;
    }

    function attackMob(mob) {
        if (isInBattle()) return false;

        // NI: użyj Engine.battle lub Engine.npcs
        if ((IFACE === 'new' || hasNewEngine()) && $w.Engine) {
            try {
                // Metoda 1: Engine.battle.attack (jeśli jest dostępna)
                if ($w.Engine.battle && typeof $w.Engine.battle.attack === 'function') {
                    $w.Engine.battle.attack(mob._niNpc || { id: mob.id });
                    return true;
                }
                // Metoda 2: kliknij element NPC w DOM
                const el = document.getElementById('npc' + mob.id);
                if (el) {
                    const prev = el.style.pointerEvents;
                    el.style.pointerEvents = 'auto';
                    clickElementHelper(el);
                    el.style.pointerEvents = prev;
                    return true;
                }
                // Metoda 3: Engine.hero.attack / Engine.hero.startFight
                if ($w.Engine.hero && typeof $w.Engine.hero.attack === 'function') {
                    $w.Engine.hero.attack(mob._niNpc || { id: mob.id });
                    return true;
                }
            } catch (e) { /* fallback do SI */ }
        }

        // SI fallback
        const el = document.getElementById('npc' + mob.id);
        if (!el) return false;
        const prev = el.style.pointerEvents;
        el.style.pointerEvents = 'auto';
        el.click();
        el.style.pointerEvents = prev;
        return true;
    }

    function npcExists(id) {
        return !!document.getElementById('npc' + id);
    }

    function scanSkills(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && now - _skillsCacheTime < 5000) return _skillsCache;

        const skills = [];
        document.querySelectorAll('.skillbox_border .skillbox').forEach(el => {
            const tip = decodeTip(el.getAttribute('tip') || '');
            const tipText = stripTip(tip);

            const nameM = tip.match(/<b>(.*?)<\/b>/);
            if (!nameM) return;

            const lvlEl = el.querySelector('.skillbox_lvl');
            const lvlTxt = lvlEl ? lvlEl.textContent.trim() : '0/10';
            const lvlM = lvlTxt.match(/(\d+)\/(\d+)/);
            const curLvl = lvlM ? parseInt(lvlM[1], 10) : 0;
            const maxLvl = lvlM ? parseInt(lvlM[2], 10) : 10;
            const learned = lvlEl ? lvlEl.classList.contains('learned-skill') : false;

            const iconEl = el.querySelector('.skillbox_icon');
            let iconNum = 0;
            if (iconEl) {
                const m = iconEl.className.match(/icon-(\d+)/);
                if (m) iconNum = parseInt(m[1], 10);
            }

            const setBorder = el.closest('.skillbox_border');
            const isActive = setBorder ? !!setBorder.querySelector('.set-active-state.active') : false;

            skills.push({ name: nameM[1], curLvl, maxLvl, learned, iconNum, isActive, tip, tipText, el });
        });

        _skillsCache = skills;
        _skillsCacheTime = now;
        return skills;
    }

    function getSkillPoints() {
        const learntEl = document.querySelector('.skills_learnt');
        const totalEl = document.querySelector('.skills_total');
        const learnt = learntEl ? parseInt(learntEl.textContent, 10) : 0;
        const total = totalEl ? parseInt(totalEl.textContent, 10) : 0;
        return { learnt, total, free: total - learnt };
    }

    function scanBag() {
        let totalSlots = 0, usedSlots = 0, potions = [], bags = [], freeSlots = 0;

        document.querySelectorAll('.item[bag]').forEach(el => {
            const tip = (el.getAttribute('tip') || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
            const bagM = tip.match(/Mieści\s*<span[^>]*>(\d+)<\/span>/);
            const usedM = el.querySelector('small');
            const usedN = usedM ? parseInt(usedM.textContent, 10) : 0;
            if (bagM) {
                const cap = parseInt(bagM[1], 10);
                bags.push({ cap, used: usedN });
                totalSlots += cap;
                usedSlots += usedN;
            }
        });

        freeSlots = totalSlots - usedSlots;

        document.querySelectorAll('.item[id^="item"]').forEach(el => {
            const tip = (el.getAttribute('tip') || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
            const healM = tip.match(/Leczy\s*<span[^>]*>\s*([\d\s]+)\s*<\/span>\s*punkt/);
            const heal2M = tip.match(/Przywraca\s*<span[^>]*>\s*([\d\s]+)\s*<\/span>\s*punkt.*?życia/);
            if (healM || heal2M) {
                const nameM = tip.match(/item-name[^>]*>(.*?)<\/div>/);
                const amtM = tip.match(/Ilość.*?<span[^>]*>\s*(\d+)\s*<\/span>/);
                const healAmt = healM
                    ? parseInt((healM[1] || '').replace(/\s/g, ''), 10)
                    : parseInt((heal2M[1] || '').replace(/\s/g, ''), 10);
                if (healAmt > 0) {
                    potions.push({
                        id: el.id.replace('item', ''),
                        name: nameM ? nameM[1] : 'Potelek HP',
                        heal: healAmt,
                        qty: amtM ? parseInt(amtM[1], 10) : 1,
                    });
                }
            }
        });

        return { bags, totalSlots, usedSlots, freeSlots, potions, hasPotions: potions.length > 0, isFull: freeSlots <= 0 };
    }

    function getGold() {
        // NI: pobierz z Engine.hero.d
        if ((IFACE === 'new' || hasNewEngine()) && $w.Engine && $w.Engine.hero && $w.Engine.hero.d) {
            try {
                const d = $w.Engine.hero.d;
                if (d.gold != null) return d.gold;
                if (d.money != null) return d.money;
            } catch(e) { /* ignore */ }
        }
        // NI: element .gold-value lub #gold
        const niGold = document.querySelector('.gold-value, .hero-gold, [class*="gold"][class*="value"]');
        if (niGold) {
            const raw = niGold.textContent.replace(/\s/g, '').replace(/\./g, '');
            const n = parseInt(raw, 10);
            if (!isNaN(n)) return n;
        }
        // SI fallback
        const el = document.getElementById('gold');
        if (!el) return null;
        const raw = el.textContent.replace(/\s/g, '').replace(/\./g, '');
        const n = parseInt(raw, 10);
        return isNaN(n) ? null : n;
    }

    function parseExpValue(str) {
        if (!str) return 0;
        str = str.replace(/\s/g, '').replace(',', '.');
        let mult = 1;
        if (str.endsWith('g')) { mult = 1e9; str = str.slice(0, -1); }
        else if (str.endsWith('m')) { mult = 1e6; str = str.slice(0, -1); }
        else if (str.endsWith('k')) { mult = 1e3; str = str.slice(0, -1); }
        return Math.round(parseFloat(str) * mult);
    }

    function getHeroInfo() {
        try {
            if ((IFACE === 'new' || hasNewEngine()) && $w.Engine && $w.Engine.hero && $w.Engine.hero.d) {
                const d = $w.Engine.hero.d;
                return {
                    name: d.name || d.nick || null,
                    level: d.lvl || d.level || null,
                };
            }
            if ($w.hero) {
                return {
                    name: $w.hero.name || $w.hero.nick || null,
                    level: $w.hero.lvl || $w.hero.level || null,
                };
            }
            const nickEl = document.querySelector('#nick, .nick, [class*="nick"]');
            if (nickEl) return { name: nickEl.textContent.trim(), level: null };
        } catch (e) { /* ignore */ }
        return { name: null, level: null };
    }

    function getMapId() {
        try {
            if ((IFACE === 'new' || hasNewEngine()) && $w.Engine && $w.Engine.hero && $w.Engine.hero.d) {
                const d = $w.Engine.hero.d;
                if (d.map != null) return d.map;
                if (d.mapId != null) return d.mapId;
            }
            if ($w.hero) {
                if ($w.hero.map != null) return $w.hero.map;
                if ($w.hero.mapId != null) return $w.hero.mapId;
            }
            if (typeof $w.map !== 'undefined' && $w.map) {
                if ($w.map.id != null) return $w.map.id;
                if ($w.map.mapId != null) return $w.map.mapId;
            }
        } catch (e) { }
        return null;
    }

    function resolveMapInfo(mapId) {
        if (mapId == null) return { id: null, name: null, slug: null };
        const entry = mapsData ? mapsData[String(mapId)] : null;
        if (entry) return { id: mapId, name: entry.name, slug: entry.slug };
        if (botApi) {
            const looked = botApi.lookupMap(mapId);
            if (looked) return { id: mapId, name: looked.name, slug: looked.slug };
        }
        return { id: mapId, name: `Mapa #${mapId}`, slug: null };
    }

    function getExpInfo() {
        if ((IFACE === 'new' || hasNewEngine()) && $w.Engine && $w.Engine.hero && $w.Engine.hero.d) {
            try {
                const d = $w.Engine.hero.d;
                const curExp = d.exp || d.experience || 0;
                const maxExp = d.expMax || d.maxExp || d.nextLevelExp || 0;
                if (maxExp > 0) {
                    const expLeft = maxExp - curExp;
                    const progress = Math.round(curExp / maxExp * 100 * 100) / 100;
                    return { curExp, maxExp, expLeft, progress };
                }
            } catch(e) { }
        }
        const expEl = document.getElementById('exp1');
        if (!expEl) return null;
        const tip = (expEl.getAttribute('tip') || '')
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        const curM = tip.match(/Doświadczenie[^:]*:.*?(\d[\d\s.,gmk]*)\s*\/\s*(\d[\d\s.,gmk]*)/i);
        const leftM = tip.match(/Do\s+\d+\s+poziomu[^:]*:\s*(?:<br>\s*)?([\d\s]+)/i);
        if (!curM) return null;
        const curExp = parseExpValue(curM[1]);
        const maxExp = parseExpValue(curM[2]);
        const expLeft = leftM ? parseInt(leftM[1].replace(/\s/g, ''), 10) : (maxExp - curExp);
        let progress = maxExp > 0 ? (curExp / maxExp) * 100 : 0;
        const expPctEl = document.getElementById('expProcent');
        if (expPctEl) {
            const pct = parseFloat(expPctEl.textContent);
            if (!isNaN(pct)) progress = pct;
        }
        return { curExp, maxExp, expLeft, progress };
    }

    // Auto-F / CAPTCHA — kliknięcia DOM
    let captchaEnabled = !!settings.captchaEnabled;
    let lastCaptchaCheck = 0;
    let cfgAutoFMinHP = 40;

    function getSkillPoints() {
        const learntEl = document.querySelector('#skillcount .skills_learnt, .skills_learnt');
        const totalEl = document.querySelector('#skillcount .skills_total, .skills_total');
        const battleEl = document.querySelector('#skillInBattleCount');
        const learnt = learntEl ? parseInt(learntEl.textContent, 10) : 0;
        const total = totalEl ? parseInt(totalEl.textContent, 10) : 0;
        const inBattle = battleEl ? battleEl.textContent.replace(/[()]/g, '') : null;
        return { learnt, total, free: total - learnt, inBattle };
    }

    function isBtnVisible(el) {
        if (!el) return false;
        const st = window.getComputedStyle(el);
        return st.display !== 'none' && st.visibility !== 'hidden' && el.offsetParent !== null;
    }

    function isInBattle() {
        // NI: sprawdza Engine.battle
        if ((IFACE === 'new' || hasNewEngine()) && $w.Engine) {
            try {
                if ($w.Engine.battle) {
                    if (typeof $w.Engine.battle.isActive === 'function') return $w.Engine.battle.isActive();
                    if ($w.Engine.battle.active !== undefined) return !!$w.Engine.battle.active;
                    if ($w.Engine.battle.state !== undefined) return $w.Engine.battle.state !== 'idle' && $w.Engine.battle.state !== null;
                }
            } catch (e) { /* ignore */ }
        }
        // SI / NI fallback: DOM
        const battleEl = document.getElementById('battle');
        if (battleEl) {
            const style = window.getComputedStyle(battleEl);
            if (style.display !== 'none' && style.visibility !== 'hidden')
                return battleEl.offsetParent !== null || style.display === 'block';
        }
        // NI: battle window
        const niBattle = document.querySelector('.battle-window, .fight-window, [class*="battle"][class*="active"]');
        return !!niBattle && window.getComputedStyle(niBattle).display !== 'none';
    }

    function isBattleReady() {
        if (!isInBattle()) return false;
        return !!document.querySelector('.troop[ctip="t_troop1"]');
    }

    let lastAutoFClick = 0;

    function clickFastBattle() {
        // NI: szukaj przycisku szybkiej walki NI
        if (IFACE === 'new' || hasNewEngine()) {
            try {
                if (typeof $w.autoFightForMe === 'function') { $w.autoFightForMe(); return true; }
                // NI DOM: .action-fast-fight lub .quick-fight-button
                const niBtn = document.querySelector('.action-fast-fight, .quick-fight-button, [class*="fast-fight"], [class*="autoFight"]');
                if (niBtn && window.getComputedStyle(niBtn).display !== 'none') {
                    clickElementHelper(niBtn); return true;
                }
            } catch(e) { /* fallback */ }
        }
        const btn = document.getElementById('autobattleButton');
        if (!isBtnVisible(btn)) return false;
        const now = Date.now();
        if (now - lastAutoFClick < 1200) return false;
        lastAutoFClick = now;
        if (typeof $w.autoFightForMe === 'function') {
            $w.autoFightForMe();
            return true;
        }
        btn.click();
        return true;
    }

    function clickTourBattle() {
        // NI: szukaj przycisku walki turowej NI
        if (IFACE === 'new' || hasNewEngine()) {
            try {
                if (typeof $w.tourFight === 'function') { $w.tourFight(); return true; }
                const niBtn = document.querySelector('.action-tour-fight, .tour-fight-button, [class*="tour-fight"], [class*="tourFight"]');
                if (niBtn && window.getComputedStyle(niBtn).display !== 'none') {
                    clickElementHelper(niBtn); return true;
                }
            } catch(e) { /* fallback */ }
        }
        const btn = document.getElementById('tourbattleButton');
        if (!isBtnVisible(btn)) return false;
        const now = Date.now();
        if (now - lastAutoFClick < 1200) return false;
        lastAutoFClick = now;
        if (typeof $w.tourFight === 'function') {
            $w.tourFight();
            return true;
        }
        btn.click();
        return true;
    }

    function updateAutoFStatus(state) {
        const el = document.getElementById('maw-autof-status');
        if (!el) return;
        if (state === 'fast') { el.textContent = '⚡ Szybka'; el.style.color = '#34d399'; }
        else if (state === 'tour') { el.textContent = '🛡 Turowa'; el.style.color = '#f87171'; }
        else { el.textContent = '💤 Czeka'; el.style.color = '#4b5a8a'; }
    }

    function clickElementHelper(el) {
        if (!el) return;
        try {
            el.click();
        } catch(e) {}

        const events = ['mousedown', 'mouseup', 'click'];
        events.forEach(name => {
            try {
                const ev = new MouseEvent(name, {
                    bubbles: true,
                    cancelable: true,
                    view: window
                });
                el.dispatchEvent(ev);
            } catch(e) {}
        });
    }

    function solveCaptcha() {
        const now = Date.now();
        if (now - lastCaptchaCheck < 1500) return false;
        lastCaptchaCheck = now;

        // Szukaj widocznej captchy (NI: .captcha, .captcha-window)
        const captcha = (() => {
            const els = document.querySelectorAll('.captcha, .captcha-window');
            for (const el of els) {
                const st = window.getComputedStyle(el);
                if (st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0') return el;
            }
            return null;
        })();
        if (!captcha) return false;

        // ── Metoda 1: NI — Engine.captcha.getFinishRequest() + _g() ──
        // Prawdziwe API z kodu gry: "captcha&answerId=ID1,ID2"
        if ((IFACE === 'new' || hasNewEngine()) && $w.Engine && $w.Engine.captcha) {
            try {
                const cap = $w.Engine.captcha;
                // Pobierz zaznaczone odpowiedzi przez getSelectedAnswer() lub selectedAnswers
                const getReq = cap.getFinishRequest || (cap.confirmOnClick && (() => {
                    const sel = cap.getSelectedAnswer ? cap.getSelectedAnswer() : (cap.selectedAnswers || []);
                    return 'captcha&answerId=' + [...sel].sort().join(',');
                }));
                if (getReq) {
                    // Najpierw kliknij przyciski z gwiazdką żeby je zaznaczyć
                    const btns = captcha.querySelectorAll('.captcha__buttons .btn, .captcha__buttons button');
                    const toMark = [];
                    btns.forEach(btn => {
                        const nm = (btn.getAttribute('name') || btn.textContent || '').trim();
                        if (nm.includes('*') || nm.includes('★')) toMark.push(btn);
                    });
                    if (!toMark.length) return false;
                    log(`<span class="ok">🔑 CAPTCHA [NI]: zaznaczam ${toMark.length} odpowiedź/i...</span>`);
                    toMark.forEach((btn, i) => {
                        setTimeout(() => { clickElementHelper(btn); }, i * 400 + 100);
                    });
                    // Po zaznaczeniu wyślij przez API gry
                    setTimeout(() => {
                        try {
                            const req = typeof getReq === 'function' ? getReq.call(cap) : null;
                            if (req && $w._g) {
                                $w._g(req);
                                log(`<span class="ok">✅ CAPTCHA [NI API]: ${req}</span>`);
                                updateCaptchaStatus('Rozwiązana ✅');
                                return;
                            }
                        } catch(e) {}
                        // Fallback: kliknij przycisk potwierdź DOM
                        const conf = captcha.querySelector('.captcha__confirm .btn, .captcha__confirm button');
                        if (conf) { clickElementHelper(conf); log(`<span class="ok">✅ CAPTCHA confirm (DOM)</span>`); }
                        updateCaptchaStatus('Rozwiązana ✅');
                    }, toMark.length * 400 + 600);
                    return true;
                }
            } catch(e) { /* fallback do DOM */ }
        }

        // ── Metoda 2: DOM fallback (SI + NI bez Engine.captcha) ──
        const buttons = captcha.querySelectorAll('.captcha__buttons .btn, .captcha__buttons button, .captcha-btn, .captcha__answer');
        if (!buttons.length) return false;

        const toClick = [];
        buttons.forEach(btn => {
            const nameEl = btn.querySelector('.gfont[name]');
            let name = nameEl ? (nameEl.getAttribute('name') || nameEl.textContent || '') :
                                (btn.getAttribute('name') || btn.getAttribute('tip') || btn.textContent || '');
            name = name.trim();
            if (name.includes('*') || name.includes('★')) toClick.push({ btn, name });
        });

        if (!toClick.length) return false;

        log(`<span class="ok">🔑 CAPTCHA [DOM]: ${toClick.length} odpowiedź/i z ★</span>`);
        updateCaptchaStatus(`Klikam ${toClick.length}...`);

        let clicked = 0;
        toClick.forEach((item, i) => {
            setTimeout(() => {
                clickElementHelper(item.btn);
                clicked++;
                log(`<span class="ok">🔑 [${clicked}/${toClick.length}]: "${item.name}"</span>`);
                updateCaptchaStatus(`Kliknięto ${clicked}/${toClick.length}`);
            }, i * 500 + 200);
        });

        setTimeout(() => {
            const conf = captcha.querySelector('.captcha__confirm .btn, .captcha__confirm button, .captcha-confirm');
            if (conf) {
                clickElementHelper(conf);
                log(`<span class="ok">✅ CAPTCHA potwierdzona!</span>`);
                updateCaptchaStatus('Rozwiązana ✅');
            } else {
                log(`<span class="warn">⚠ CAPTCHA: brak przycisku confirm!</span>`);
            }
        }, toClick.length * 500 + 800);

        return true;
    }


    // ═══════════════════════════════════════════════════════════
    //  ANTI-STASIS: losowy ruch co 2-3 minut gdy bot nie działa
    // ═══════════════════════════════════════════════════════════
    let lastAntiStasisMove = Date.now();
    let nextAntiStasisDelay = 120000 + Math.random() * 60000; // 2–3 min

    function doAntiStasisMove() {
        if (!settings.antiStasisEnabled) return;
        if (botApi && botApi.isRunning()) return; // Bot już chodzi – nie przeszkadzaj
        if (isInBattle()) return; // W walce – nie ruszaj

        const tile = getHeroTile();
        if (!tile) return;

        // Losowy kafel w pobliżu (±1–2 kafle, nigdy (0,0) żeby faktycznie ruszyć)
        let dx = 0, dy = 0;
        while (dx === 0 && dy === 0) {
            dx = Math.floor(Math.random() * 5) - 2; // -2..+2
            dy = Math.floor(Math.random() * 5) - 2;
        }
        const targetX = tile.x + dx;
        const targetY = tile.y + dy;

        // heroGoTo obsługuje NI (Engine.hero.autoGoTo) i SI (hero.searchPath)
        const moved = heroGoTo(targetX, targetY);

        if (moved) {
            log(`<span style="color:#4b5a8a">🦵 Anti-stasis: ruch do [${targetX},${targetY}]</span>`);
        }

        // Zaplanuj następny ruch niezależnie od wyniku
        lastAntiStasisMove = Date.now();
        nextAntiStasisDelay = 120000 + Math.random() * 60000;
    }

    // ═══════════════════════════════════════════════════════════
    //  MODUŁY — eksport kontekstu + ładowanie zewnętrznych plików
    //  Quest/Dialog/Auto-grupka → modules/maw-quest.js
    // ═══════════════════════════════════════════════════════════
    window.MAW_CTX = {
        IFACE, $w, settings, log, clickElementHelper,
        heroGoTo, decodeTip, hasNewEngine, isInBattle, saveSettings
    };
    // Zmostkuj kontekst na obiekt window strony głównej (dla skryptów ładowanych przez script tag)
    if (typeof unsafeWindow !== 'undefined') {
        unsafeWindow.MAW_CTX = window.MAW_CTX;
    } else {
        $w.MAW_CTX = window.MAW_CTX;
    }

    // Automatyczny getter/setter przekazujący obiekt MAW między sandboxem a window gry
    Object.defineProperty(window, 'MAW', {
        get: () => $w.MAW || window._sandboxMAW,
        set: (v) => {
            $w.MAW = v;
            window._sandboxMAW = v;
        },
        configurable: true
    });

    // Ładowanie modułów z folderu modules/
    function loadModule(name) {
        const url = HOST + 'modules/' + name;
        gmRequest(url).then(r => {
            try { new Function(r.responseText)(); }
            catch (e) { console.warn('[MAW] Moduł ' + name + ':', e); }
        }).catch(() => {
            // fallback: script tag (jeśli CORS OK)
            const s = document.createElement('script');
            s.src = HOST + 'modules/' + name + '?t=' + Date.now();
            document.head.appendChild(s);
        });
    }
    loadModule('maw-quest.js');


    function updateCaptchaStatus(txt) {
        const el = document.getElementById('maw-captcha-status');
        if (el) el.textContent = txt;
    }

    // ═══════════════════════════════════════════════════════════
    //  STATYSTYKI SESJI (UI)
    // ═══════════════════════════════════════════════════════════
    let _goldAtStart = null;
    let _goldStartTime = null;
    let expHistory = [];
    let sessionStartExp = null;
    let sessionStartTime = null;

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
        const dur = (Date.now() - _goldStartTime) / 3600000;
        if (dur < 0.001) return 0;
        return Math.round(getGoldGain() / dur);
    }

    function resetSessionStats() {
        sessionStartExp = null;
        sessionStartTime = null;
        expHistory = [];
        _goldAtStart = null;
        _goldStartTime = null;
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
        if (n >= 1e9) return (n / 1e9).toFixed(2) + 'g';
        if (n >= 1e6) return (n / 1e6).toFixed(2) + 'm';
        if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
        return String(n);
    }

    function fmtNum(n) {
        if (n >= 1e9) return (n / 1e9).toFixed(2) + 'g';
        if (n >= 1e6) return (n / 1e6).toFixed(2) + 'm';
        if (n >= 1e3) return Math.round(n).toLocaleString('pl-PL');
        return String(n);
    }

    // ═══════════════════════════════════════════════════════════
    //  LOG + STATUS (definiowane przed bridge, używane w UI)
    // ═══════════════════════════════════════════════════════════
    let $log = null;

    function log(html) {
        if (!$log) return;
        const line = document.createElement('div');
        line.innerHTML = html;
        $log.appendChild(line);
        while ($log.childElementCount > 60) $log.removeChild($log.firstChild);
        $log.scrollTop = $log.scrollHeight;
    }

    function updateStatus(txt, icon = '💤') {
        const iconEl = document.getElementById('maw-status-icon');
        const txtEl = document.getElementById('maw-status-txt');
        if (iconEl) iconEl.textContent = icon;
        if (txtEl) txtEl.textContent = txt;
    }

    function onBotStopped() {
        document.getElementById('maw-btn-start').disabled = false;
        document.getElementById('maw-btn-stop').disabled = true;
        renderAll();
    }

    const bridge = {
        iface: IFACE,
        log,
        updateStatus,
        heroGoTo,
        getHeroTile,
        getHeroHP,
        scanMobs,
        attackMob,
        npcExists,
        scanBag,
        isInBattle,
        isBattleReady,
        clickFastBattle,
        clickTourBattle,
        updateAutoFStatus,
        renderAll: () => { if (botApi) renderAll(); },
        onBotStopped,
        resetSessionStats,
        recordGoldStart,
    };

    // ═══════════════════════════════════════════════════════════
    //  LOADER — maps.json (GM cache) + bot-core.js
    //  GM_xmlhttpRequest omija blokadę Firefox (HTTPS → localhost)
    // ═══════════════════════════════════════════════════════════
    function gmRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: options.method || 'GET',
                url,
                headers: options.headers || {},
                data: options.body,
                onload(r) {
                    if (r.status >= 200 && r.status < 300) resolve(r);
                    else reject(new Error(`HTTP ${r.status}: ${url}`));
                },
                onerror: () => reject(new Error('Sieć: ' + url)),
            });
        });
    }

    /** bot-core musi działać w sandboxie TM (ten sam window co loader), nie w kontekście strony */
    async function loadCoreScript(relativePath) {
        const url = HOST + relativePath;
        const r = await gmRequest(url);
        new Function(r.responseText)();
    }

    function getMawBot() {
        if (typeof window.MawBot !== 'undefined') return window.MawBot;
        if (typeof unsafeWindow !== 'undefined' && unsafeWindow.MawBot) return unsafeWindow.MawBot;
        return null;
    }

    async function loadMaps() {
        if (!DEV) {
            const cached = GM_getValue(MAPS_CACHE_KEY);
            if (cached) {
                try { return JSON.parse(cached); } catch (e) { /* refetch */ }
            }
        }
        const url = HOST + 'maps.json?v=' + MAPS_VERSION;
        const r = await gmRequest(url);
        const data = JSON.parse(r.responseText);
        GM_setValue(MAPS_CACHE_KEY, JSON.stringify(data));
        return data;
    }

    async function bootstrapBot() {
        try {
            mapsData = await loadMaps();
            log(`<span class="ok">🗺 Załadowano ${Object.keys(mapsData).length} map (cache v${MAPS_VERSION})</span>`);
        } catch (e) {
            log(`<span class="warn">⚠ maps.json: ${e.message} — bot bez map</span>`);
            mapsData = {};
        }

        try {
            await loadCoreScript('bot-core.js?v=' + CORE_VERSION);
        } catch (e) {
            log(`<span class="err">✗ bot-core.js: ${e.message}</span>`);
            updateStatus('Błąd ładowania core', '✗');
            return;
        }

        const MawBot = getMawBot();
        if (!MawBot) {
            log('<span class="err">✗ MawBot nie znaleziony — zaktualizuj loader (v3.1.2)</span>');
            return;
        }

        botApi = MawBot.init(bridge, mapsData);
        syncConfigFromUI();
        wireBotControls();
        recordGoldStart();
        renderAll();
        const devTag = DEV ? '<span class="ok"> [DEV localhost]</span>' : '';
        log(`<span class="ok">✓ AutoWalk+Attack v3 PALADYN załadowany (${IFACE})${devTag}</span>`);
        if (DEV) log(`<span class="ok">📡 Telemetry → ${DEV_API}</span>`);
        log('⚡ Auto-F aktywny | 🔑 CAPTCHA Solver gotowy');
        log('Ustaw filtry i kliknij ▶ Start');
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
    .maw-btns { display:flex; gap:5px; margin-top:9px; }
    .maw-btn { flex:1; padding:7px 4px; border:none; border-radius:7px; cursor:pointer; font-size:12px; font-weight:700; transition:opacity .15s; }
    .maw-btn:hover { opacity:.82; }
    .maw-start  { background:#7c3aed; color:#fff; }
    .maw-stop   { background:#dc2626; color:#fff; }
    .maw-stop:disabled, .maw-start:disabled { background:#3d4875; cursor:not-allowed; opacity:.5; }
    #maw-status-bar { margin-top:7px; padding:5px 8px; background:#111528; border-radius:6px; font-size:11px; color:#a78bfa; display:flex; align-items:center; gap:6px; }
    #maw-status-icon { font-size:14px; }
    #maw-status-txt  { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    #maw-log { margin-top:5px; background:#070910; border:1px solid #1c2035; border-radius:6px; padding:4px 8px; height:60px; overflow-y:auto; font-size:10px; line-height:1.55; color:#3d4875; }
    #maw-log::-webkit-scrollbar { width:4px; }
    #maw-log::-webkit-scrollbar-thumb { background:#1c2035; border-radius:2px; }
    #maw-log .hi   { color:#a78bfa; }
    #maw-log .ok   { color:#34d399; }
    #maw-log .err  { color:#f87171; }
    #maw-log .warn { color:#fbbf24; }
    #maw-exp-panel { margin-top:6px; background:#0a0e1c; border:1px solid #1c2035; border-radius:7px; padding:6px 8px; font-size:11px; }
    .maw-exp-bar-wrap { background:#141829; border-radius:4px; height:7px; margin:4px 0 3px; overflow:hidden; }
    .maw-exp-bar { background:linear-gradient(90deg,#7c3aed,#a78bfa); height:100%; border-radius:4px; transition:width .5s; }
    .maw-exp-row { display:flex; justify-content:space-between; font-size:10px; color:#4b5a8a; }
    .maw-exp-row span { color:#7880a8; }
    #maw-gold-panel { margin-top:5px; background:#0a0e1c; border:1px solid #1c2035; border-radius:7px; padding:6px 8px; font-size:11px; }
    .maw-gold-row { display:flex; justify-content:space-between; font-size:11px; margin:2px 0; }
    .maw-gold-lbl { color:#4b5a8a; }
    .maw-gold-val { color:#f59e0b; font-weight:600; }
    #maw-autof-panel { margin-top:5px; background:#0a0e1c; border:1px solid #1c2035; border-radius:7px; padding:6px 8px; font-size:11px; }
    .maw-autof-row { display:flex; justify-content:space-between; align-items:center; margin:3px 0; }
    #maw-autof-status { font-weight:700; font-size:11px; color:#4b5a8a; }
    .maw-hp-bar-wrap { background:#141829; border-radius:4px; height:5px; margin:3px 0; overflow:hidden; }
    .maw-hp-bar { background:linear-gradient(90deg,#22c55e,#86efac); height:100%; border-radius:4px; transition:width .3s; }
    .maw-hp-bar.low { background:linear-gradient(90deg,#dc2626,#f87171); }
    .maw-hp-bar.mid { background:linear-gradient(90deg,#f59e0b,#fbbf24); }
    #maw-captcha-panel { margin-top:5px; background:#0f1020; border:1px solid #7c3aed55; border-radius:7px; padding:6px 8px; font-size:11px; }
    #maw-captcha-status { color:#a78bfa; font-size:11px; }
    #maw-quest-panel { margin-top:5px; background:#060f0a; border:1px solid #22c55e33; border-radius:7px; padding:7px 9px; font-size:11px; animation:maw-qpulse 3s ease-in-out infinite; }
    @keyframes maw-qpulse { 0%,100%{border-color:#22c55e33;box-shadow:none}50%{border-color:#22c55e66;box-shadow:0 0 10px #22c55e18} }
    #maw-quest-name { color:#86efac; font-weight:700; font-size:12px; margin-bottom:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    #maw-quest-mission { color:#bbf7d0; font-size:10px; line-height:1.5; margin-bottom:5px; padding:3px 5px; background:#0d2818; border-radius:4px; }
    #maw-quest-npc { color:#34d399; font-size:11px; font-weight:600; padding:3px 6px; background:#052e16; border:1px solid #22c55e44; border-radius:4px; margin-bottom:5px; display:none; }
    #maw-quest-npc.visible { display:block; animation:maw-npc-in .3s ease; }
    @keyframes maw-npc-in { from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)} }
    #maw-quest-go { width:100%; padding:6px; background:linear-gradient(90deg,#14532d,#166534); border:1px solid #22c55e55; border-radius:6px; color:#86efac; font-size:12px; font-weight:700; cursor:pointer; transition:all .2s; display:none; margin-bottom:4px; }
    #maw-quest-go.visible { display:block; }
    #maw-quest-go:hover { background:linear-gradient(90deg,#166534,#15803d); box-shadow:0 0 8px #22c55e44; transform:translateY(-1px); }
    #maw-quest-status { color:#4b5a8a; font-size:10px; margin-top:3px; }
    #maw-bag-panel { margin-top:5px; background:#0a0e1c; border:1px solid #1c2035; border-radius:7px; padding:6px 8px; font-size:11px; }
    .maw-bag-row { display:flex; justify-content:space-between; align-items:center; margin:2px 0; font-size:11px; }
    .maw-bag-label { color:#4b5a8a; }
    .maw-bag-val   { color:#7880a8; }
    .maw-bag-warn  { color:#f87171 !important; font-weight:700; }
    .maw-bag-ok    { color:#34d399 !important; }
    .maw-pot-item  { font-size:10px; color:#3d4875; display:flex; justify-content:space-between; margin:1px 0; }
    .maw-pot-item span { color:#5b6a9a; }
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
    .maw-ai-status { margin:5px 0; padding:5px 7px; border-radius:6px; border:1px solid #1c2035; background:#070910; color:#7880a8; font-size:10px; line-height:1.45; }
    .maw-ai-status.ok { border-color:#22c55e44; color:#34d399; background:#22c55e12; }
    .maw-ai-status.warn { border-color:#f59e0b55; color:#fbbf24; background:#f59e0b12; }
    .maw-ai-status.err { border-color:#dc262644; color:#f87171; background:#dc262612; }
    #maw-ai-plan { max-height:120px; overflow-y:auto; color:#4b5a8a; font-size:10px; line-height:1.45; }
    .maw-ai-pick { display:flex; justify-content:space-between; gap:6px; padding:4px 0; border-bottom:1px solid #111528; }
    .maw-ai-pick b { color:#a78bfa; font-weight:700; }
    .maw-ai-pick span { color:#7880a8; text-align:right; }
    #maw-info { margin-top:5px; background:#060810; border:1px solid #1c2035; border-radius:5px; padding:3px 8px; font-size:10px; color:#2e3660; line-height:1.7; }
    #maw-info span { color:#4b5a8a; }
    .maw-sep { border:none; border-top:1px solid #1c2035; margin:6px 0; }
    .maw-tabs { display:flex; gap:3px; margin:6px 0 4px; }
    .maw-tab { flex:1; padding:3px 2px; text-align:center; background:#111528; border:1px solid #1c2035; border-radius:5px; cursor:pointer; font-size:9.5px; color:#4b5a8a; transition:all .15s; }
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
        <b>⚔ AutoWalk v3 <span style="color:#f59e0b;font-size:10px">PALADYN</span>${DEV ? '<span style="color:#34d399;font-size:9px"> DEV</span>' : ''}</b>
        <span id="maw-badge">ładowanie…</span>
    </header>
    <div id="maw-body">
        <div class="maw-tabs">
            <div class="maw-tab active" data-tab="bot">🤖 Bot</div>
            <div class="maw-tab" data-tab="autof">⚡ Auto-F</div>
            <div class="maw-tab" data-tab="skills">🛡 Umki</div>
            <div class="maw-tab" data-tab="captcha">🔑 Captcha</div>
            <div class="maw-tab" data-tab="travel">🗺 Podróż</div>
            <div class="maw-tab" data-tab="quest">📜 Quest</div>
        </div>
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
            <div class="maw-row">
                <label>Dystans ataku</label>
                <input class="maw-inp" id="maw-arrdist" type="number" value="2.5" min="0.5" max="8" step="0.5" style="width:58px"> kaf.
            </div>
            <hr class="maw-sep">
            <div class="maw-lbl">Torba / Potki</div>
            <label class="maw-chk"><input type="checkbox" id="maw-stopfull"> Stop gdy torba pełna</label>
            <label class="maw-chk"><input type="checkbox" id="maw-stopnopot"> Stop gdy brak poteków</label>
            <hr class="maw-sep">
            <div class="maw-lbl">🛡 Zabezpieczenia</div>
            <label class="maw-chk"><input type="checkbox" id="maw-antistasis-enable" checked> 🦵 Anti-Stasis (ruch co 2-3 min)</label>
            <label class="maw-chk"><input type="checkbox" id="maw-quest-auto-enable" checked> 📜 Auto-Quest (dialog NI)</label>
            <hr class="maw-sep">
            <div class="maw-lbl" id="maw-mob-lbl">Moby (0 znalezionych)</div>
            <div id="maw-list"></div>
            <div class="maw-btns">
                <button class="maw-btn maw-start" id="maw-btn-start" disabled>▶ Start</button>
                <button class="maw-btn maw-stop"  id="maw-btn-stop" disabled>⏹ Stop</button>
            </div>
            <div id="maw-status-bar">
                <span id="maw-status-icon">💤</span>
                <span id="maw-status-txt">Ładowanie core…</span>
            </div>
            <div id="maw-log"></div>
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
        <div id="tab-skills" style="display:none">
            <div id="maw-skills-panel">
                <div class="maw-lbl" style="margin:0 0 3px">🛡 Umiejętności Paladyna</div>
                <div class="maw-skill-pts">
                    <span class="maw-skill-pts-lbl">Rozdane punkty</span>
                    <span class="maw-skill-pts-val" id="maw-skill-pts">-</span>
                </div>
                <div id="maw-skill-list" style="max-height:320px;overflow-y:auto"></div>
                <hr class="maw-sep">
                <div class="maw-lbl" style="margin:0 0 3px">AI auto-rozkładanie</div>
                <label class="maw-chk">
                    <input type="checkbox" id="maw-ai-skills-enable">
                    Włącz planowanie umek przez API AI
                </label>
                <label class="maw-chk">
                    <input type="checkbox" id="maw-ai-allow-apply">
                    Zezwól botowi klikać umki z planu
                </label>
                <div class="maw-ai-status" id="maw-ai-skill-status">AI: nie pytano</div>
                <div id="maw-ai-plan"></div>
                <div class="maw-btns">
                    <button class="maw-btn" style="background:#7c3aed;color:#fff;padding:5px;font-size:11px" id="maw-ai-plan-skills">AI plan</button>
                    <button class="maw-btn" style="background:#111528;border:1px solid #1c2035;color:#7880a8;padding:5px;font-size:11px" id="maw-ai-apply-skills">Zastosuj</button>
                </div>
                <div style="margin-top:5px">
                    <button class="maw-btn" style="background:#111528;border:1px solid #1c2035;color:#7880a8;padding:4px;font-size:10px;width:100%" id="maw-refresh-skills">🔄 Odśwież umiejętności</button>
                </div>
            </div>
        </div>
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
        <div id="tab-travel" style="display:none">
            <div id="maw-travel-panel" style="background:#0a0e1c; border:1px solid #1c2035; border-radius:7px; padding:6px 8px; font-size:11px;">
                <div class="maw-lbl" style="margin:0 0 3px">🗺️ Podróż przez mapy</div>
                <label class="maw-chk">
                    <input type="checkbox" id="maw-travel-enable">
                    Włącz Auto-Travel
                </label>
                <div class="maw-row" style="margin-top:6px; display: flex; align-items: center; gap: 8px;">
                    <label style="font-size:10px; color:#4b5a8a">Cel (ID):</label>
                    <input class="maw-inp" id="maw-targetmapid-input" type="number" placeholder="np. 2524" style="width:64px; background:#141829; border:1px solid #1c2035; color:#fff; border-radius:3px; padding:2px 4px; font-size:11px;">
                </div>
                <div class="maw-btns" style="margin-top:8px; display: flex; gap: 4px;">
                    <button class="maw-btn" id="maw-btn-travel-go" style="flex:1; background:#7c3aed; color:#fff; padding:4px 0; font-size:10px; border:none; border-radius:4px; cursor:pointer;">Rozpocznij</button>
                    <button class="maw-btn" id="maw-btn-travel-stop" style="flex:1; background:#dc2626; color:#fff; padding:4px 0; font-size:10px; border:none; border-radius:4px; cursor:pointer;">Przerwij</button>
                </div>
                <div class="maw-ai-status" id="maw-travel-in-game-status" style="margin-top:8px; font-size:10px; line-height:1.4;">Status trasy: nieaktywna</div>

                <hr class="maw-sep">

                <div class="maw-lbl" style="margin:0 0 3px">👹 Poszukiwacz Herosów</div>
                <label class="maw-chk">
                    <input type="checkbox" id="maw-herohunter-enable">
                    Włącz szukanie Herosów
                </label>
                <div class="maw-row" style="margin-top:5px; display: flex; align-items: center; gap: 8px;">
                    <label style="font-size:10px; color:#4b5a8a">Nazwa:</label>
                    <input class="maw-inp" id="maw-herohunter-name" type="text" placeholder="np. Zmora" style="width:100px; background:#141829; border:1px solid #1c2035; color:#fff; border-radius:3px; padding:2px 4px; font-size:11px;">
                </div>
                <div style="margin-top:6px; font-size:10.5px; color:#5b6a9a; line-height:1.3" id="maw-herohunter-patrol-info">
                    Patrol: nieaktywny
                </div>
            </div>
        </div>
        <div id="tab-quest" style="display:none">
            <div id="maw-quest-panel">
                <div class="maw-lbl" style="margin:0 0 5px;color:#86efac">📜 Aktywny Quest</div>
                <div id="maw-quest-name">Brak śledzonego questa</div>
                <div id="maw-quest-mission" style="margin-top:4px">Włącz śledzenie w dzienniku zadań gry</div>
                <div id="maw-quest-npc"></div>
                <button id="maw-quest-go">🏃 Idź do NPC i rozmawiaj</button>
                <div id="maw-quest-status">💤 Brak questa</div>
                <hr class="maw-sep">
                <label class="maw-chk"><input type="checkbox" id="maw-quest-auto-enable2" checked> 📜 Auto klikanie dialogów</label>
                <label class="maw-chk"><input type="checkbox" id="maw-quest-autonav" checked> 🏃 Auto-nawigacja do NPC</label>
            </div>
        </div>
        <div id="maw-info">
            🗺 Iface: <span id="maw-iface">${IFACE}</span> &nbsp;|&nbsp;
            🧑 Tile: <span id="maw-heropos">?</span><br>
            🎯 Cel: <span id="maw-target">brak</span>
        </div>
    </div>`;
    document.body.appendChild(panel);
    $log = document.getElementById('maw-log');

    function setInputValue(id, value) {
        const el = document.getElementById(id);
        if (el) el.value = value;
    }

    function setChecked(id, value) {
        const el = document.getElementById(id);
        if (el) el.checked = !!value;
    }

    function applySettingsToUI() {
        setInputValue('maw-minlvl', settings.minLvl);
        setInputValue('maw-maxlvl', settings.maxLvl);
        setInputValue('maw-range', settings.range);
        setInputValue('maw-walkd', settings.walkDelay);
        setInputValue('maw-atkd', settings.atkDelay);
        setInputValue('maw-arrdist', settings.arrDist);
        setInputValue('maw-autof-minhp', settings.autoFMinHP);
        setChecked('maw-grp', settings.grpOnly);
        setChecked('maw-stopfull', settings.stopFull);
        setChecked('maw-stopnopot', settings.stopNoPot);
        setChecked('maw-autof-enable', settings.autoFEnabled);
        setChecked('maw-captcha-enable', settings.captchaEnabled);
        setChecked('maw-ai-skills-enable', settings.aiSkillsEnabled);
        setChecked('maw-ai-allow-apply', settings.aiApplyEnabled);
        setChecked('maw-travel-enable', settings.travelEnabled);
        setChecked('maw-antistasis-enable', settings.antiStasisEnabled !== false);
        setChecked('maw-quest-auto-enable', settings.questAutoEnabled !== false);
        setChecked('maw-quest-autonav', settings.questAutoNav !== false);
        setInputValue('maw-targetmapid-input', settings.targetMapId || '');
        const sort = document.getElementById('maw-sort');
        if (sort) sort.value = settings.sortBy || 'dist';
        if (settings.panelLeft != null && settings.panelTop != null) {
            panel.style.left = settings.panelLeft + 'px';
            panel.style.top = settings.panelTop + 'px';
            panel.style.right = 'auto';
        }
        captchaEnabled = !!settings.captchaEnabled;
        cfgAutoFMinHP = Number(settings.autoFMinHP) || 40;
    }

    applySettingsToUI();

    // ═══════════════════════════════════════════════════════════
    //  ZAKŁADKI + DRAG
    // ═══════════════════════════════════════════════════════════
    const tabs = {
        bot: document.getElementById('tab-bot'),
        autof: document.getElementById('tab-autof'),
        skills: document.getElementById('tab-skills'),
        captcha: document.getElementById('tab-captcha'),
        travel: document.getElementById('tab-travel'),
        quest: document.getElementById('tab-quest'),
    };

    document.querySelectorAll('.maw-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.maw-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const name = tab.dataset.tab;
            Object.entries(tabs).forEach(([k, el]) => { el.style.display = k === name ? '' : 'none'; });
            if (name === 'skills') renderSkills();
            if (name === 'quest' && window.MAW && window.MAW.quest) window.MAW.quest.render();
        });
    });

    let drag = false, ddx = 0, ddy = 0;
    document.getElementById('maw-hdr').addEventListener('mousedown', e => {
        drag = true;
        const r = panel.getBoundingClientRect();
        ddx = e.clientX - r.left;
        ddy = e.clientY - r.top;
    });
    document.addEventListener('mousemove', e => {
        if (!drag) return;
        panel.style.left = (e.clientX - ddx) + 'px';
        panel.style.top = (e.clientY - ddy) + 'px';
        panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => {
        if (drag) {
            saveSettings({
                panelLeft: Math.round(panel.getBoundingClientRect().left),
                panelTop: Math.round(panel.getBoundingClientRect().top),
            });
        }
        drag = false;
    });

    // ═══════════════════════════════════════════════════════════
    //  RENDER
    // ═══════════════════════════════════════════════════════════
    const TYPE_COL = {
        szaman: '#a855f7', wojownik: '#ef4444', goblin: '#22c55e',
        nocny: '#94a3b8', 'słabeusz': '#22c55e', ghul: '#64748b',
        troll: '#f59e0b', wilk: '#10b981', szkielet: '#6366f1',
        mistrz: '#f59e0b', 'zły': '#dc2626',
    };

    function typeCol(name) {
        const n = name.toLowerCase();
        for (const [k, v] of Object.entries(TYPE_COL)) if (n.includes(k)) return v;
        return '#7c3aed';
    }

    function renderMobList(mobs) {
        const list = document.getElementById('maw-list');
        list.innerHTML = '';
        document.getElementById('maw-badge').textContent = mobs.length + ' mobów';
        document.getElementById('maw-mob-lbl').textContent = `Moby (${mobs.length} znalezionych)`;

        const hero = getHeroTile() || { x: 0, y: 0 };
        document.getElementById('maw-heropos').textContent = hero ? `${hero.x},${hero.y}` : '?';
        const target = botApi ? botApi.getTarget() : null;
        document.getElementById('maw-target').textContent = target ? `${target.name} (${target.tx},${target.ty})` : 'brak';

        const nearestId = mobs.length > 0 ? mobs[0].id : null;
        const tileDistFn = botApi ? botApi.tileDist : (h, m) => Math.sqrt((h.x - m.tx) ** 2 + (h.y - m.ty) ** 2);

        mobs.forEach(m => {
            const d = tileDistFn(hero, m).toFixed(1);
            const col = typeCol(m.name);
            const isCur = target && m.id === target.id;
            const isNear = !isCur && m.id === nearestId;
            const row = document.createElement('div');
            row.className = 'maw-mob' + (isCur ? ' cur' : isNear ? ' near' : '');

            let rankBadge = '';
            if (m.rank === 'hero') rankBadge = '<span style="background:#ef4444;color:#fff;font-size:8px;padding:0px 3px;border-radius:3px;font-weight:700;margin-right:4px;">HEROS</span>';
            else if (m.rank === 'colossus') rankBadge = '<span style="background:#a855f7;color:#fff;font-size:8px;padding:0px 3px;border-radius:3px;font-weight:700;margin-right:4px;">KOLOS</span>';
            else if (m.rank === 'elite2') rankBadge = '<span style="background:#f59e0b;color:#fff;font-size:8px;padding:0px 3px;border-radius:3px;font-weight:700;margin-right:4px;">E2</span>';
            else if (m.rank === 'elite') rankBadge = '<span style="background:#10b981;color:#fff;font-size:8px;padding:0px 3px;border-radius:3px;font-weight:700;margin-right:4px;">ELITA</span>';

            row.innerHTML = `
                <span class="maw-dot" style="background:${col}"></span>
                <span class="maw-mname">${rankBadge}${m.name}</span>
                <span class="maw-mmeta">Lv${m.lvl}${m.grp ? ' ⚡' : ''} · ${d}kaf</span>
                ${isCur ? '<span class="maw-walk-badge">➤ cel</span>' : ''}
                ${isNear ? '<span class="maw-near-badge">★ blisko</span>' : ''}`;
            list.appendChild(row);
        });
    }

    function renderExp() {
        const info = getExpInfo();
        recordExpTick(info);
        if (!info) return;
        const pct = info.progress.toFixed(1);
        const rate = calcExpRate();
        const rateMin = rate ? Math.round(rate * 60) : null;
        const eta = calcTimeToLvl(info);
        const sessionGain = getSessionGain();
        const sessionDur = getSessionDuration();
        const sessionRate = sessionDur > 10 ? Math.round(sessionGain / sessionDur * 3600) : 0;

        document.getElementById('maw-exp-bar').style.width = pct + '%';
        document.getElementById('maw-exp-pct').textContent = pct;
        document.getElementById('maw-exp-left').textContent = fmtExp(info.expLeft);
        document.getElementById('maw-exp-rate').textContent = rateMin ? fmtExp(rateMin) : '—';
        document.getElementById('maw-exp-eta').textContent = eta ? eta.formatted : '—';
        document.getElementById('maw-exp-session').textContent = fmtExp(sessionGain);
        document.getElementById('maw-exp-session-rate').textContent = sessionRate > 0 ? fmtExp(sessionRate) : '—';
    }

    function renderGold() {
        const cur = getGold();
        const gain = getGoldGain();
        const rate = getGoldRate();
        const curEl = document.getElementById('maw-gold-cur');
        const gainEl = document.getElementById('maw-gold-gain');
        const rateEl = document.getElementById('maw-gold-rate');
        if (curEl) curEl.textContent = cur !== null ? fmtNum(cur) : '—';
        if (gainEl) {
            gainEl.textContent = gain !== 0 ? (gain > 0 ? '+' : '') + fmtNum(gain) : '0';
            gainEl.style.color = gain > 0 ? '#34d399' : gain < 0 ? '#f87171' : '#7880a8';
        }
        if (rateEl) rateEl.textContent = rate > 0 ? fmtNum(rate) + '/h' : '—';
    }

    function renderHP() {
        const hp = getHeroHP();
        const barEl = document.getElementById('maw-hp-bar');
        const pctEl = document.getElementById('maw-hp-pct');
        if (!barEl || !pctEl) return;
        barEl.style.width = hp.pct + '%';
        pctEl.textContent = hp.pct + '%';
        barEl.classList.remove('low', 'mid');
        if (hp.pct <= cfgAutoFMinHP) barEl.classList.add('low');
        else if (hp.pct <= cfgAutoFMinHP + 20) barEl.classList.add('mid');
    }

    function renderSkills() {
        const skills = scanSkills(true);
        const pts = getSkillPoints();
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
                    <span class="maw-skill-lvl">${s.curLvl}/${s.maxLvl}</span>`;
                list.appendChild(row);
            });
        }
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
                    <span class="maw-skill-lvl" style="color:#2e3660">0/${s.maxLvl}</span>`;
                list.appendChild(row);
            });
        }
    }

    function renderBag() {
        const bag = botApi ? botApi.getBagInfo() : scanBag();
        if (!bag) return;
        const freeEl = document.getElementById('maw-bag-free');
        const usedEl = document.getElementById('maw-bag-used');
        const potEl = document.getElementById('maw-pot-list');
        freeEl.textContent = bag.freeSlots + ' / ' + bag.totalSlots;
        freeEl.className = 'maw-bag-val' + (bag.isFull ? ' maw-bag-warn' : bag.freeSlots < 10 ? ' maw-bag-warn' : ' maw-bag-ok');
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
                d.innerHTML = `<span>${p.name.slice(0, 22)}</span><span>×${p.qty} (${fmtExp(p.heal)} HP)</span>`;
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

    function renderAll() {
        const mobs = botApi ? botApi.getFilteredMobs() : scanMobs();
        renderMobList(mobs);
        renderExp();
        renderBag();
        renderGold();
        renderHP();

        // Update travel UI in game panel
        const chk = document.getElementById('maw-travel-enable');
        if (chk) chk.checked = !!settings.travelEnabled;
        const inp = document.getElementById('maw-targetmapid-input');
        if (inp && document.activeElement !== inp) inp.value = settings.targetMapId || '';
        const travelStatusEl = document.getElementById('maw-travel-in-game-status');
        if (travelStatusEl) {
            const active = settings.travelEnabled;
            const targetId = settings.targetMapId;
            if (active && targetId) {
                travelStatusEl.innerHTML = `Cel: <b style="color:#a78bfa">${targetId}</b><br>Status: <span style="color:#34d399">${travelStatusText}</span>`;
            } else {
                travelStatusEl.innerHTML = `Status: <span style="color:#7880a8">nieaktywna</span>`;
            }
        }

        // Update hero hunter UI in game panel
        const hunterChk = document.getElementById('maw-herohunter-enable');
        if (hunterChk) hunterChk.checked = !!settings.heroHunterEnabled;
        const hunterInp = document.getElementById('maw-herohunter-name');
        if (hunterInp && document.activeElement !== hunterInp) hunterInp.value = settings.heroHunterName || '';
        const hunterInfoEl = document.getElementById('maw-herohunter-patrol-info');
        if (hunterInfoEl) {
            if (settings.heroHunterEnabled) {
                const count = Array.isArray(settings.patrolMapIds) ? settings.patrolMapIds.length : 0;
                hunterInfoEl.innerHTML = `Patrol: <span style="color:#a78bfa">${count} map</span><br>Status: <span style="color:#34d399">${patrolStatusText}</span>`;
            } else {
                hunterInfoEl.innerHTML = 'Patrol: nieaktywny';
            }
        }
    }

    function syncConfigFromUI() {
        if (!botApi) return;
        const next = {
            minLvl: parseInt(document.getElementById('maw-minlvl').value, 10) || 1,
            maxLvl: parseInt(document.getElementById('maw-maxlvl').value, 10) || 999,
            range: parseInt(document.getElementById('maw-range').value, 10) || 999,
            grpOnly: document.getElementById('maw-grp').checked,
            sortBy: document.getElementById('maw-sort').value,
            walkDelay: parseInt(document.getElementById('maw-walkd').value, 10) || 1500,
            atkDelay: parseInt(document.getElementById('maw-atkd').value, 10) || 1000,
            arrDist: parseFloat(document.getElementById('maw-arrdist').value) || 2.5,
            stopFull: document.getElementById('maw-stopfull').checked,
            stopNoPot: document.getElementById('maw-stopnopot').checked,
            travelEnabled: settings.travelEnabled,
            targetMapId: settings.targetMapId,
            heroHunterEnabled: settings.heroHunterEnabled,
            heroHunterName: settings.heroHunterName,
            patrolMapIds: settings.patrolMapIds,
        };
        botApi.setConfig(next);
        cfgAutoFMinHP = parseInt(document.getElementById('maw-autof-minhp').value, 10) || 40;
        botApi.setAutoFConfig({
            enabled: document.getElementById('maw-autof-enable').checked,
            minHP: cfgAutoFMinHP,
        });
        saveSettings({
            ...next,
            autoFEnabled: document.getElementById('maw-autof-enable').checked,
            autoFMinHP: cfgAutoFMinHP,
            captchaEnabled: document.getElementById('maw-captcha-enable').checked,
            aiSkillsEnabled: document.getElementById('maw-ai-skills-enable').checked,
            aiApplyEnabled: document.getElementById('maw-ai-allow-apply').checked,
        });
    }

    function pushConfigToCore() {
        syncConfigFromUI();
        if (botApi) renderAll();
    }

    function getHeroProfession() {
        try {
            const nick = document.getElementById('nick');
            const txt = stripTip(nick ? nick.getAttribute('tip') || '' : '');
            const m = txt.match(/Profesja:\s*([^\s].*?)(?: Poziom|$)/i);
            if (m) return m[1].trim();
        } catch (e) { /* ignore */ }
        return null;
    }

    function parseItemTip(el, idx) {
        const tip = decodeTip(el.getAttribute('tip') || '');
        const plain = stripTip(tip);
        if (!plain) return null;
        const name = (tip.match(/item-name[^>]*>\s*([^<]+)/) || [])[1];
        const type = (plain.match(/Typ:\s*(.+?)(?:\s+(?:Pospolity|Unikatowy|Heroiczny|Legendarny|Obrażenia|Atak|Pancerz|Wymagana|Wartość)|$)/i) || [])[1];
        const damage = (plain.match(/(?:Obrażenia|Atak)[^0-9]*(\d+\s*-\s*\d+|\d+)/i) || [])[1];
        const profession = (plain.match(/Wymagana profesja:\s*([^<]+?)(?: Wymagany| Wartość|$)/i) || [])[1];
        const level = (plain.match(/Wymagany poziom:\s*(\d+)/i) || [])[1];
        return {
            idx,
            id: el.id || null,
            name: name ? name.trim() : `Item ${idx + 1}`,
            type: type ? type.trim() : null,
            damage: damage ? damage.replace(/\s+/g, ' ') : null,
            profession: profession ? profession.trim() : null,
            level: level ? Number(level) : null,
            summary: plain.slice(0, 500),
        };
    }

    function scanEquipmentForAi() {
        const items = [];
        document.querySelectorAll('.item[id^="item"]').forEach((el, idx) => {
            const parsed = parseItemTip(el, idx);
            if (parsed) items.push(parsed);
        });
        const weapons = items.filter(i => /dystansowe|jednoręczne|dwuręczne|pomocnicze|różdżki|laski|strzały|obrażenia|atak/i.test(`${i.type || ''} ${i.summary || ''}`));
        return { items: items.slice(0, 80), weapons: weapons.slice(0, 12) };
    }

    function buildAiSkillPayload() {
        const heroInfo = getHeroInfo();
        const hp = getHeroHP();
        const tile = getHeroTile();
        const skills = scanSkills(true).map(s => ({
            name: s.name,
            curLvl: s.curLvl,
            maxLvl: s.maxLvl,
            learned: s.learned,
            isActive: s.isActive,
            tip: s.tipText || stripTip(s.tip || ''),
        }));
        return {
            ts: Date.now(),
            hero: {
                ...heroInfo,
                profession: getHeroProfession(),
                hpPct: hp.pct,
                tile,
                iface: IFACE,
            },
            points: getSkillPoints(),
            skills,
            equipment: scanEquipmentForAi(),
            preferences: {
                autoApplyAllowed: document.getElementById('maw-ai-allow-apply').checked,
                safeMode: true,
            },
        };
    }

    function updateAiSkillStatus(text, cls = '') {
        lastAiSkillStatus = text;
        const el = document.getElementById('maw-ai-skill-status');
        if (!el) return;
        el.textContent = 'AI: ' + text;
        el.className = 'maw-ai-status' + (cls ? ' ' + cls : '');
    }

    function renderAiPlan(plan) {
        const el = document.getElementById('maw-ai-plan');
        if (!el) return;
        if (!plan || !Array.isArray(plan.allocations) || !plan.allocations.length) {
            el.innerHTML = '<div style="padding:5px 0">Brak propozycji. Otwórz panel umek (U) i spróbuj ponownie.</div>';
            return;
        }
        el.innerHTML = '';
        if (plan.summary) {
            const summary = document.createElement('div');
            summary.style.margin = '4px 0';
            summary.style.color = '#7880a8';
            summary.textContent = plan.summary;
            el.appendChild(summary);
        }
        plan.allocations.forEach(a => {
            const row = document.createElement('div');
            row.className = 'maw-ai-pick';
            row.innerHTML = `<b>${a.name}</b><span>+${a.points}${a.reason ? ' · ' + a.reason : ''}</span>`;
            el.appendChild(row);
        });
        (plan.warnings || []).forEach(w => {
            const warn = document.createElement('div');
            warn.style.color = '#fbbf24';
            warn.style.marginTop = '3px';
            warn.textContent = 'Uwaga: ' + w;
            el.appendChild(warn);
        });
    }

    async function requestAiSkillPlan() {
        if (!document.getElementById('maw-ai-skills-enable').checked) {
            updateAiSkillStatus('włącz najpierw planowanie umek', 'warn');
            return null;
        }
        updateAiSkillStatus('wysyłam dane do API...', 'warn');
        try {
            const payload = buildAiSkillPayload();
            const r = await gmRequest(AI_SKILLS_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = JSON.parse(r.responseText);
            if (!data.ok) throw new Error(data.error || 'API error');
            lastSkillPlan = data.plan;
            lastAiSkillMode = data.plan && data.plan.mode ? data.plan.mode : (data.dryRun ? 'dry-run' : 'ai');
            renderAiPlan(lastSkillPlan);
            updateAiSkillStatus(`${lastAiSkillMode}; EQ: ${data.eq ? data.eq.weaponCount : 0} broni, ${data.eq ? data.eq.itemCount : 0} itemów`, data.dryRun ? 'warn' : 'ok');
            log(`<span class="ok">AI umki: plan gotowy (${lastAiSkillMode})</span>`);
            return lastSkillPlan;
        } catch (e) {
            updateAiSkillStatus(e.message, 'err');
            log(`<span class="err">AI umki: ${e.message}</span>`);
            return null;
        }
    }

    function findSkillElementByName(name) {
        const wanted = String(name || '').trim().toLowerCase();
        if (!wanted) return null;
        const skills = scanSkills(true);
        const found = skills.find(s => String(s.name || '').trim().toLowerCase() === wanted)
            || skills.find(s => String(s.name || '').toLowerCase().includes(wanted));
        return found ? found.el : null;
    }

    function clickSkillByName(name) {
        const el = findSkillElementByName(name);
        if (!el) return false;
        const btn = el.querySelector('.skillbox_icon, .skillbox_lvl') || el;
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
    }

    async function applyAiSkillPlan() {
        if (!lastSkillPlan) {
            updateAiSkillStatus('najpierw pobierz plan AI', 'warn');
            return;
        }
        if (!document.getElementById('maw-ai-allow-apply').checked) {
            updateAiSkillStatus('zaznacz zgodę na klikanie umek', 'warn');
            return;
        }
        let clicked = 0;
        for (const alloc of lastSkillPlan.allocations || []) {
            const points = Math.max(0, Number(alloc.points || 0));
            for (let i = 0; i < points; i++) {
                if (clickSkillByName(alloc.name)) clicked++;
                await new Promise(resolve => setTimeout(resolve, 350));
            }
        }
        scanSkills(true);
        renderSkills();
        updateAiSkillStatus(`zastosowano kliknięć: ${clicked}`, clicked ? 'ok' : 'warn');
        log(clicked ? `<span class="ok">AI umki: kliknięto ${clicked} razy</span>` : '<span class="warn">AI umki: nic nie kliknięto</span>');
    }

    let isAutoAllocating = false;

    async function checkAutoSkillAllocation() {
        if (isAutoAllocating) return;

        const enabled = document.getElementById('maw-ai-skills-enable')?.checked || settings.aiSkillsEnabled;
        const allowApply = document.getElementById('maw-ai-allow-apply')?.checked || settings.aiApplyEnabled;

        if (!enabled || !allowApply) return;

        const pts = getSkillPoints();
        if (pts.free <= 0) return;

        isAutoAllocating = true;
        log(`<span class="warn">🧠 AI: Wykryto wolne punkty (${pts.free}). Uruchamiam auto-rozdawanie...</span>`);

        let autoOpened = false;
        try {
            let skills = scanSkills();
            if (!skills || skills.length === 0) {
                log('🧠 AI: Otwieram panel umiejętności w celu pobrania listy...');
                if ($w.g && $w.g.skills && typeof $w.g.skills.show === 'function') {
                    $w.g.skills.show();
                    autoOpened = true;
                    await new Promise(resolve => setTimeout(resolve, 1500));
                } else {
                    const btn = document.getElementById('b_skills');
                    if (btn) {
                        btn.click();
                        autoOpened = true;
                        await new Promise(resolve => setTimeout(resolve, 1500));
                    }
                }
            }

            skills = scanSkills(true);
            if (!skills || skills.length === 0) {
                throw new Error('Nie udało się załadować panelu umiejętności');
            }

            log('🧠 AI: Generowanie planu rozwoju...');
            const plan = await requestAiSkillPlan();
            if (!plan || !plan.allocations || !plan.allocations.length) {
                throw new Error('AI nie zwróciło żadnych alokacji punktów');
            }

            log('🧠 AI: Rozpoczynam automatyczne klikanie umiejętności...');
            await applyAiSkillPlan();

            log('<span class="ok">✅ AI: Umiejętności zostały pomyślnie rozdane!</span>');
        } catch (e) {
            log(`<span class="err">❌ AI Auto-rozdawanie: ${e.message}</span>`);
        } finally {
            if (autoOpened) {
                log('🧠 AI: Zamykanie panelu umiejętności...');
                closeSkillsPanel();
            }
            isAutoAllocating = false;
        }
    }

    function closeSkillsPanel() {
        try {
            const closeBtn = document.querySelector('#skills .w-close, #skills .close, .skills_close');
            if (closeBtn) {
                closeBtn.click();
            } else if ($w.g && $w.g.skills && typeof $w.g.skills.show === 'function') {
                $w.g.skills.show();
            }
        } catch(e) {}
    }

    function scanGateways() {
        const gateways = [];

        // NI: pobierz bramy z Engine.map
        if ((IFACE === 'new' || hasNewEngine()) && $w.Engine && $w.Engine.map) {
            try {
                const mapData = $w.Engine.map.d || $w.Engine.map;
                const gates = mapData.gateways || mapData.gates || mapData.gw || [];
                const gateArr = Array.isArray(gates) ? gates : Object.values(gates);

                gateArr.forEach(gate => {
                    if (!gate) return;
                    const targetMapId = gate.targetMapId || gate.toMap || gate.map || gate.id2 || 0;
                    if (!targetMapId) return;
                    const tx = gate.x || gate.tx || 0;
                    const ty = gate.y || gate.ty || 0;
                    const name = gate.name || `Mapa #${targetMapId}`;
                    gateways.push({
                        el: null, // NI może nie mieć elementu DOM
                        id: `gw_ni_${targetMapId}`,
                        targetMapId,
                        tx, ty, name,
                        _niGate: gate,
                    });
                });

                if (gateways.length > 0) return gateways;
            } catch(e) {
                // Fallback do DOM
            }
        }

        // SI / DOM fallback: .gw elements
        document.querySelectorAll('.gw').forEach(el => {
            const idMatch = el.className.match(/gwmap(\d+)/);
            if (!idMatch) return;
            const targetMapId = parseInt(idMatch[1], 10);
            const px = parseInt(el.style.left, 10) || 0;
            const py = parseInt(el.style.top, 10) || 0;
            const w = parseInt(el.style.width, 10) || 32;
            const h = parseInt(el.style.height, 10) || 32;
            const tx = Math.round((px + w / 2) / 32);
            const ty = Math.round((py + h / 2) / 32);
            const tip = el.getAttribute('tip') || '';
            const name = tip.replace(/<[^>]*>/g, '').trim() || `Mapa #${targetMapId}`;
            gateways.push({
                el,
                id: el.id,
                targetMapId,
                tx,
                ty,
                name
            });
        });
        return gateways;
    }

    let lastReportedMapId = null;

    async function reportCurrentGateways() {
        const mapId = getMapId();
        if (!mapId || mapId === lastReportedMapId) return;

        const gws = scanGateways();
        if (!gws.length) return;

        const payload = {
            fromMapId: mapId,
            connections: gws.map(g => ({
                toMapId: g.targetMapId,
                gatewayId: g.id,
                tx: g.tx,
                ty: g.ty,
                name: g.name
            }))
        };

        try {
            const r = await gmRequest(DEV_API.replace('/api/state', '/api/map/connections'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = JSON.parse(r.responseText);
            if (data && data.added > 0) {
                log(`<span class="ok">🗺️ Odkryto ${data.added} nowe przejścia z tej mapy!</span>`);
            }
            lastReportedMapId = mapId;
        } catch (e) {
            // ignore
        }
    }

    let mapGraph = null;
    let lastGraphFetchTime = 0;

    async function fetchMapGraph() {
        const now = Date.now();
        if (mapGraph && now - lastGraphFetchTime < 10000) return mapGraph;

        try {
            const r = await gmRequest(DEV_API.replace('/api/state', '/api/map/connections'), {
                method: 'GET'
            });
            const data = JSON.parse(r.responseText);
            if (data && data.ok) {
                mapGraph = data.connections;
                lastGraphFetchTime = now;
            }
        } catch(e) {
            if (!mapGraph) mapGraph = {};
        }
        return mapGraph;
    }

    function findMapPath(graph, startId, targetId) {
        startId = Number(startId);
        targetId = Number(targetId);
        if (startId === targetId) return [];
        if (!graph) return null;

        const queue = [[startId, []]];
        const visited = new Set([startId]);

        while (queue.length > 0) {
            const [currentId, path] = queue.shift();

            const connections = graph[String(currentId)] || [];
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

    let lastTravelTick = 0;
    let travelStatusText = 'nieaktywna';
    let travelPath = [];
    let gatewayStuckCount = 0;
    let lastAttemptedGatewayId = null;

    async function checkMapTravelTick() {
        const now = Date.now();
        if (now - lastTravelTick < 1500) return;
        lastTravelTick = now;

        const travelEnabled = settings.travelEnabled;
        const targetMapId = Number(settings.targetMapId);
        const currentMapId = Number(getMapId());

        // 1. Sprawdź czy nie ma Herosa na mapie
        if (settings.heroHunterEnabled && currentMapId) {
            const mobs = scanMobs();
            const foundHero = mobs.find(m => {
                const isHeroRank = m.rank === 'hero';
                const matchesName = settings.heroHunterName && m.name.toLowerCase().includes(settings.heroHunterName.toLowerCase());
                return isHeroRank || matchesName;
            });
            if (foundHero) {
                if (settings.travelEnabled) {
                    log(`<span class="ok" style="font-weight:700;font-size:13px">🔥 Wykryto HEROSA: ${foundHero.name} (Lvl ${foundHero.lvl})! Przerywam podróż i atakuję!</span>`);
                    settings.travelEnabled = false;
                    saveSettings({ travelEnabled: false });
                    if (botApi) botApi.setConfig({ travelEnabled: false });
                }
                if (botApi && !botApi.isRunning()) {
                    botApi.startBot();
                }
                travelStatusText = 'Wykryto herosa!';
                patrolStatusText = `Walka z: ${foundHero.name}`;
                travelPath = [];
                return;
            }
        }

        // 2. Obsługa automatycznej rotacji patrolu (tylko gdy nie podróżuje)
        if (settings.heroHunterEnabled && !travelEnabled && Array.isArray(settings.patrolMapIds) && settings.patrolMapIds.length > 0 && currentMapId) {
            const patrolIds = settings.patrolMapIds.map(Number);
            const isPatrolMap = patrolIds.includes(currentMapId);

            if (isPatrolMap) {
                if (currentMapId !== lastPatrolMapId) {
                    lastPatrolMapId = currentMapId;
                    patrolVisitTime = now;
                    patrolStatusText = `Skanowanie mapy ID ${currentMapId}...`;
                    log(`🗺️ Herosi: Wszedłem na mapę ID ${currentMapId}. Skanuję mapę...`);
                }

                const elapsed = now - patrolVisitTime;
                if (elapsed > 5000) {
                    const currentIdx = patrolIds.indexOf(currentMapId);
                    const nextIndex = (currentIdx + 1) % patrolIds.length;
                    const nextMapId = patrolIds[nextIndex];
                    const nextMapName = resolveMapInfo(nextMapId) ? resolveMapInfo(nextMapId).name : `Mapa #${nextMapId}`;

                    log(`🗺️ Herosi: Mapa czysta. Brak herosa. Ruszam do kolejnej mapy: <b>${nextMapName}</b> (ID ${nextMapId})`);

                    settings.travelEnabled = true;
                    settings.targetMapId = nextMapId;
                    saveSettings({ travelEnabled: true, targetMapId: nextMapId });
                    if (botApi) botApi.setConfig({ travelEnabled: true, targetMapId: nextMapId });
                } else {
                    patrolStatusText = `Czekam i skanuję (${Math.max(0, Math.round((5000 - elapsed) / 1000))}s)`;
                }
            } else {
                const nextMapId = patrolIds[0];
                const nextMapName = resolveMapInfo(nextMapId) ? resolveMapInfo(nextMapId).name : `Mapa #${nextMapId}`;
                log(`🗺️ Herosi: Postać poza listą patrolu. Ruszam do pierwszej mapy patrolowej: <b>${nextMapName}</b> (ID ${nextMapId})`);

                settings.travelEnabled = true;
                settings.targetMapId = nextMapId;
                saveSettings({ travelEnabled: true, targetMapId: nextMapId });
                if (botApi) botApi.setConfig({ travelEnabled: true, targetMapId: nextMapId });
            }
        } else if (settings.heroHunterEnabled) {
            if (travelEnabled) {
                patrolStatusText = `podróż do ID ${targetMapId}`;
            } else {
                patrolStatusText = 'aktywny';
            }
        } else {
            patrolStatusText = 'nieaktywny';
        }

        if (!travelEnabled || isNaN(targetMapId) || targetMapId <= 0) {
            travelStatusText = 'nieaktywna';
            travelPath = [];
            return;
        }

        if (!currentMapId) return;

        if (currentMapId === targetMapId) {
            log(`<span class="ok">🎉 Osiągnięto mapę docelową: ${currentMapId}</span>`);
            settings.travelEnabled = false;
            saveSettings({ travelEnabled: false });

            travelStatusText = 'Cel osiągnięty';
            travelPath = [];

            if (botApi) botApi.setConfig({ travelEnabled: false });
            return;
        }

        travelStatusText = `Podróż do ID: ${targetMapId}`;

        // Dynamic gateway reporting
        await reportCurrentGateways();

        // Pathfinding
        const graph = await fetchMapGraph();
        const path = findMapPath(graph, currentMapId, targetMapId);

        if (!path) {
            travelStatusText = 'Brak znanej trasy';
            travelPath = [];
            if (Math.random() < 0.15) {
                log(`<span class="warn">🗺️ Nawigacja: Brak drogi do mapy ID ${targetMapId}. Przejdź ręcznie bramę, aby bot ją zapamiętał.</span>`);
            }
            return;
        }

        travelPath = path.map(conn => {
            const mapId = conn.toMapId;
            const mapInfo = resolveMapInfo(mapId);
            return {
                id: mapId,
                name: mapInfo ? mapInfo.name : conn.name || `Mapa #${mapId}`
            };
        });

        // Find next gateway
        const nextConn = path[0];
        const gws = scanGateways();
        const targetGw = gws.find(g => Number(g.targetMapId) === Number(nextConn.toMapId));

        if (!targetGw) {
            travelStatusText = `Szukanie bramy do: ${nextConn.name}`;
            const targetTx = nextConn.tx;
            const targetTy = nextConn.ty;

            log(`🗺️ Nawigacja: Idę do bramy do: ${nextConn.name} (${targetTx}, ${targetTy})`);
            heroGoTo(targetTx, targetTy);
            return;
        }

        const hero = getHeroTile();
        if (!hero) return;

        // Używamy precyzyjnych współrzędnych wejścia z bazy połączeń (nextConn) zamiast pozycji grafiki DOM!
        const targetTx = Number(nextConn.tx);
        const targetTy = Number(nextConn.ty);

        const dist = Math.sqrt((hero.x - targetTx) ** 2 + (hero.y - targetTy) ** 2);
        if (dist > 1.2) {
            travelStatusText = `Idę do bramy (${targetTx},${targetTy})`;
            log(`🗺️ Nawigacja: Idę do kafla wejścia: ${nextConn.name} (${targetTx}, ${targetTy})`);
            heroGoTo(targetTx, targetTy);
            gatewayStuckCount = 0;
            lastAttemptedGatewayId = null;
        } else {
            // Zabezpieczenie przed utknięciem stojąc bezpośrednio na bramie
            if (lastAttemptedGatewayId === targetGw.id) {
                gatewayStuckCount++;
            } else {
                lastAttemptedGatewayId = targetGw.id;
                gatewayStuckCount = 1;
            }

            if (gatewayStuckCount > 3) {
                log(`<span class="warn">🗺️ Nawigacja: Prawdopodobne utknięcie na bramie do ${targetGw.name}. Robię krok w tył...</span>`);
                const stepBackTiles = [
                    {x: hero.x + 1, y: hero.y}, {x: hero.x - 1, y: hero.y},
                    {x: hero.x, y: hero.y + 1}, {x: hero.x, y: hero.y - 1}
                ].filter(t => t.x !== targetTx || t.y !== targetTy);

                if (stepBackTiles.length > 0) {
                    const t = stepBackTiles[Math.floor(Math.random() * stepBackTiles.length)];
                    heroGoTo(t.x, t.y);
                }
                gatewayStuckCount = 0; // reset
                return;
            }

            travelStatusText = `Wchodzę do: ${targetGw.name}`;
            log(`🗺️ Nawigacja: Przechodzę przez bramę do: ${targetGw.name} (Próba ${gatewayStuckCount})`);
            // NI: el może być null - użyj heroGoTo do kafla bramy
            if (targetGw.el) {
                clickElementHelper(targetGw.el);
            } else if (targetGw.tx && targetGw.ty) {
                heroGoTo(targetGw.tx, targetGw.ty);
            }
        }
    }

    function applyConfigFromDashboard(patch) {
        if (!patch || typeof patch !== 'object') return;

        let needRender = false;
        let configChanged = false;
        const configKeys = ['minLvl', 'maxLvl', 'range', 'grpOnly', 'sortBy', 'walkDelay', 'atkDelay', 'arrDist', 'stopFull', 'stopNoPot', 'travelEnabled', 'targetMapId', 'heroHunterEnabled', 'heroHunterName', 'patrolMapIds'];

        const nextCfg = {};
        configKeys.forEach(k => {
            if (patch[k] !== undefined) {
                nextCfg[k] = patch[k];
                configChanged = true;

                if (k === 'travelEnabled') {
                    settings.travelEnabled = !!patch[k];
                    saveSettings({ travelEnabled: !!patch[k] });
                }
                if (k === 'targetMapId') {
                    settings.targetMapId = Number(patch[k]);
                    saveSettings({ targetMapId: Number(patch[k]) });
                }
                if (k === 'heroHunterEnabled') {
                    settings.heroHunterEnabled = !!patch[k];
                    saveSettings({ heroHunterEnabled: !!patch[k] });
                }
                if (k === 'heroHunterName') {
                    settings.heroHunterName = String(patch[k]);
                    saveSettings({ heroHunterName: String(patch[k]) });
                }
                if (k === 'patrolMapIds') {
                    settings.patrolMapIds = Array.isArray(patch[k]) ? patch[k].map(Number) : [];
                    saveSettings({ patrolMapIds: settings.patrolMapIds });
                }

                // Sync loader inputs
                let mappedId = k.toLowerCase();
                if (mappedId === 'walkdelay') mappedId = 'walkd';
                if (mappedId === 'atkdelay') mappedId = 'atkd';
                if (mappedId === 'arrdist') mappedId = 'arrdist';
                if (mappedId === 'herohunterenabled') mappedId = 'herohunter-enable';
                if (mappedId === 'herohuntername') mappedId = 'herohunter-name';
                const el = document.getElementById('maw-' + mappedId);
                if (el) {
                    if (el.type === 'checkbox') el.checked = !!patch[k];
                    else el.value = patch[k];
                }
            }
        });

        if (configChanged && botApi) {
            botApi.setConfig(nextCfg);
            saveSettings(nextCfg);
            needRender = true;
        }

        // Auto-F
        if (patch.autoFEnabled !== undefined || patch.autoFMinHP !== undefined) {
            const autofPatch = {};
            if (patch.autoFEnabled !== undefined) {
                autofPatch.enabled = patch.autoFEnabled;
                const el = document.getElementById('maw-autof-enable');
                if (el) el.checked = !!patch.autoFEnabled;
            }
            if (patch.autoFMinHP !== undefined) {
                autofPatch.minHP = patch.autoFMinHP;
                const el = document.getElementById('maw-autof-minhp');
                if (el) el.value = patch.autoFMinHP;
            }

            if (botApi) botApi.setAutoFConfig(autofPatch);

            const nextSettings = {};
            if (patch.autoFEnabled !== undefined) nextSettings.autoFEnabled = patch.autoFEnabled;
            if (patch.autoFMinHP !== undefined) nextSettings.autoFMinHP = patch.autoFMinHP;
            saveSettings(nextSettings);
            needRender = true;
        }

        // Captcha
        if (patch.captchaEnabled !== undefined) {
            captchaEnabled = !!patch.captchaEnabled;
            const el = document.getElementById('maw-captcha-enable');
            if (el) el.checked = captchaEnabled;
            saveSettings({ captchaEnabled });
            needRender = true;
        }

        // AI Skill switches
        if (patch.aiSkillsEnabled !== undefined) {
            const el = document.getElementById('maw-ai-skills-enable');
            if (el) el.checked = !!patch.aiSkillsEnabled;
            saveSettings({ aiSkillsEnabled: patch.aiSkillsEnabled });
            updateAiSkillStatus(patch.aiSkillsEnabled ? 'planowanie włączone' : 'wyłączone', patch.aiSkillsEnabled ? 'ok' : '');
            needRender = true;
        }
        if (patch.aiApplyEnabled !== undefined) {
            const el = document.getElementById('maw-ai-allow-apply');
            if (el) el.checked = !!patch.aiApplyEnabled;
            saveSettings({ aiApplyEnabled: patch.aiApplyEnabled });
            updateAiSkillStatus(patch.aiApplyEnabled ? 'może klikać plan po przycisku Zastosuj' : 'tryb tylko plan', patch.aiApplyEnabled ? 'warn' : '');
            needRender = true;
        }

        // Bot commands
        if (patch.botRunning !== undefined) {
            if (botApi) {
                if (patch.botRunning && !botApi.isRunning()) {
                    botApi.startBot();
                } else if (!patch.botRunning && botApi.isRunning()) {
                    botApi.stopBot();
                }
            }
        }

        // Action Triggers
        if (patch.triggerAiPlan) {
            requestAiSkillPlan();
        }
        if (patch.triggerAiApply) {
            applyAiSkillPlan();
        }

        if (needRender && botApi) {
            renderAll();
        }
    }

    function wireBotControls() {
        document.getElementById('maw-btn-start').disabled = false;

        document.getElementById('maw-btn-start').addEventListener('click', () => {
            syncConfigFromUI();
            document.getElementById('maw-btn-start').disabled = true;
            document.getElementById('maw-btn-stop').disabled = false;
            botApi.startBot();
        });
        document.getElementById('maw-btn-stop').addEventListener('click', () => botApi.stopBot());

        document.getElementById('maw-minlvl').addEventListener('input', pushConfigToCore);
        document.getElementById('maw-maxlvl').addEventListener('input', pushConfigToCore);
        document.getElementById('maw-range').addEventListener('input', pushConfigToCore);
        document.getElementById('maw-grp').addEventListener('change', pushConfigToCore);
        document.getElementById('maw-sort').addEventListener('change', pushConfigToCore);
        document.getElementById('maw-arrdist').addEventListener('input', pushConfigToCore);
        document.getElementById('maw-walkd').addEventListener('input', () => {
            pushConfigToCore();
        });
        document.getElementById('maw-atkd').addEventListener('input', () => {
            pushConfigToCore();
        });
        document.getElementById('maw-stopfull').addEventListener('change', () => {
            pushConfigToCore();
        });
        document.getElementById('maw-stopnopot').addEventListener('change', () => {
            pushConfigToCore();
        });

        document.getElementById('maw-autof-enable').addEventListener('change', e => {
            if (botApi) botApi.setAutoFConfig({ enabled: e.target.checked });
            saveSettings({ autoFEnabled: e.target.checked });
            log(e.target.checked ? '<span class="ok">⚡ Auto-F włączony</span>' : '<span class="warn">⚡ Auto-F wyłączony</span>');
        });
        document.getElementById('maw-autof-minhp').addEventListener('input', e => {
            cfgAutoFMinHP = parseInt(e.target.value, 10) || 40;
            if (botApi) botApi.setAutoFConfig({ minHP: cfgAutoFMinHP });
            saveSettings({ autoFMinHP: cfgAutoFMinHP });
            log(`🛡 Min HP dla Auto-F: ${cfgAutoFMinHP}%`);
        });

        document.getElementById('maw-captcha-enable').addEventListener('change', e => {
            captchaEnabled = e.target.checked;
            saveSettings({ captchaEnabled });
            log(captchaEnabled ? '<span class="ok">🔑 CAPTCHA solver włączony</span>' : '<span class="warn">🔑 CAPTCHA solver wyłączony</span>');
        });
        document.getElementById('maw-captcha-solve-now').addEventListener('click', () => {
            lastCaptchaCheck = 0;
            const res = solveCaptcha();
            if (!res) {
                log('<span class="warn">🔑 Brak aktywnej CAPTCHY lub brak odpowiedzi z *</span>');
                updateCaptchaStatus('Brak CAPTCHY');
            }
        });

        document.getElementById('maw-refresh-skills').addEventListener('click', () => {
            scanSkills(true);
            renderSkills();
            log('<span class="ok">🛡 Umiejętności odświeżone</span>');
        });

        document.getElementById('maw-ai-skills-enable').addEventListener('change', e => {
            saveSettings({ aiSkillsEnabled: e.target.checked });
            updateAiSkillStatus(e.target.checked ? 'planowanie włączone' : 'wyłączone', e.target.checked ? 'ok' : '');
        });
        document.getElementById('maw-ai-allow-apply').addEventListener('change', e => {
            saveSettings({ aiApplyEnabled: e.target.checked });
            updateAiSkillStatus(e.target.checked ? 'może klikać plan po przycisku Zastosuj' : 'tryb tylko plan', e.target.checked ? 'warn' : '');
        });
        document.getElementById('maw-ai-plan-skills').addEventListener('click', () => requestAiSkillPlan());
        document.getElementById('maw-ai-apply-skills').addEventListener('click', () => applyAiSkillPlan());

        document.getElementById('maw-travel-enable').addEventListener('change', e => {
            settings.travelEnabled = e.target.checked;
            saveSettings({ travelEnabled: e.target.checked });
            if (botApi) botApi.setConfig({ travelEnabled: e.target.checked });
            log(e.target.checked ? '<span class="ok">🗺️ Podróż Auto-Travel włączona</span>' : '<span class="warn">🗺️ Podróż Auto-Travel wyłączona</span>');
        });
        document.getElementById('maw-btn-travel-go').addEventListener('click', () => {
            const inp = document.getElementById('maw-targetmapid-input');
            const targetId = parseInt(inp.value, 10);
            if (isNaN(targetId) || targetId <= 0) {
                log('<span class="err">🗺️ Wpisz poprawne ID mapy docelowej!</span>');
                return;
            }
            settings.travelEnabled = true;
            settings.targetMapId = targetId;
            saveSettings({ travelEnabled: true, targetMapId: targetId });
            document.getElementById('maw-travel-enable').checked = true;
            if (botApi) botApi.setConfig({ travelEnabled: true, targetMapId: targetId });
            log(`<span class="ok">🗺️ Rozpoczęto podróż do mapy ID ${targetId}</span>`);
        });
        document.getElementById('maw-btn-travel-stop').addEventListener('click', () => {
            settings.travelEnabled = false;
            saveSettings({ travelEnabled: false });
            document.getElementById('maw-travel-enable').checked = false;
            if (botApi) botApi.setConfig({ travelEnabled: false });
            log('<span class="warn">🗺️ Podróż Auto-Travel zatrzymana</span>');
        });

        document.getElementById('maw-herohunter-enable').addEventListener('change', e => {
            settings.heroHunterEnabled = e.target.checked;
            saveSettings({ heroHunterEnabled: e.target.checked });
            if (botApi) botApi.setConfig({ heroHunterEnabled: e.target.checked });
            log(e.target.checked ? '<span class="ok">👹 Szukanie Herosów włączone</span>' : '<span class="warn">👹 Szukanie Herosów wyłączone</span>');
        });
        document.getElementById('maw-herohunter-name').addEventListener('input', e => {
            const val = e.target.value.trim();
            settings.heroHunterName = val;
            saveSettings({ heroHunterName: val });
            if (botApi) botApi.setConfig({ heroHunterName: val });
        });
        document.getElementById('maw-antistasis-enable').addEventListener('change', e => {
            saveSettings({ antiStasisEnabled: e.target.checked });
            lastAntiStasisMove = Date.now(); // zresetuj timer
            log(e.target.checked ? '<span class="ok">🦵 Anti-Stasis włączony</span>' : '<span class="warn">🦵 Anti-Stasis wyłączony</span>');
        });
        document.getElementById('maw-quest-auto-enable').addEventListener('change', e => {
            saveSettings({ questAutoEnabled: e.target.checked });
            log(e.target.checked ? '<span class="ok">📜 Auto-Quest włączony</span>' : '<span class="warn">📜 Auto-Quest wyłączony</span>');
            // Synchronizuj drugi checkbox w zakładce Quest
            const cb2 = document.getElementById('maw-quest-auto-enable2');
            if (cb2) cb2.checked = e.target.checked;
        });

        // Zakładka Quest — drugi checkbox (synchronizacja z głównym)
        const qcb2 = document.getElementById('maw-quest-auto-enable2');
        if (qcb2) {
            qcb2.checked = settings.questAutoEnabled !== false;
            qcb2.addEventListener('change', e => {
                saveSettings({ questAutoEnabled: e.target.checked });
                const cb1 = document.getElementById('maw-quest-auto-enable');
                if (cb1) cb1.checked = e.target.checked;
            });
        }

        // Auto-nawigacja do NPC
        const qnav = document.getElementById('maw-quest-autonav');
        if (qnav) {
            qnav.checked = settings.questAutoNav !== false;
            qnav.addEventListener('change', e => saveSettings({ questAutoNav: e.target.checked }));
        }

        // Przycisk "Idź do NPC i rozmawiaj"
        const goBtn = document.getElementById('maw-quest-go');
        if (goBtn) {
            goBtn.addEventListener('click', () => {
                const mq = window.MAW && window.MAW.quest;
                if (!mq) return;
                const npc = window._mawQuestNpc;
                if (npc) {
                    if (!mq.npcClick(npc)) log('<span class="warn">📜 NPC nie znaleziony!</span>');
                } else {
                    log('<span class="warn">📜 Brak aktywnej misji NPC</span>');
                }
            });
        }
        // Timer questa — obsługiwany przez moduł maw-quest.js
    }

    // ═══════════════════════════════════════════════════════════
    //  TELEMETRY DEV → dashboard (osobny interwał, nie w mainLoop)
    // ═══════════════════════════════════════════════════════════
    function buildTelemetryState() {
        const heroInfo = getHeroInfo();
        const hp = getHeroHP();
        const tile = getHeroTile();
        const mapId = getMapId();
        const mapInfo = resolveMapInfo(mapId);
        const expInfo = getExpInfo();
        const goldCur = getGold();
        const goldGain = getGoldGain();
        const goldRate = getGoldRate();
        const expRate = calcExpRate();
        const expRateMin = expRate ? Math.round(expRate * 60) : null;
        const sessionGain = getSessionGain();
        const sessionDur = getSessionDuration();
        const sessionExpRate = sessionDur > 10 ? Math.round(sessionGain / sessionDur * 3600) : 0;
        const eta = calcTimeToLvl(expInfo);
        const bag = botApi ? botApi.getBagInfo() : scanBag();
        const skills = scanSkills();
        const skillPts = getSkillPoints();
        const mobs = botApi ? botApi.getFilteredMobs() : scanMobs();
        const hero = tile || { x: 0, y: 0 };
        const target = botApi ? botApi.getTarget() : null;
        const tileDistFn = botApi ? botApi.tileDist : (h, m) => Math.sqrt((h.x - m.tx) ** 2 + (h.y - m.ty) ** 2);
        const statusTxt = document.getElementById('maw-status-txt');
        const autofStatusEl = document.getElementById('maw-autof-status');
        const captchaStatusEl = document.getElementById('maw-captcha-status');

        return {
            ts: Date.now(),
            dev: true,
            hero: {
                name: heroInfo.name,
                level: heroInfo.level,
                hpPct: hp.pct,
                hpSource: hp.source,
                tile: tile ? { x: tile.x, y: tile.y } : null,
                iface: IFACE,
            },
            map: mapInfo,
            gold: {
                current: goldCur,
                sessionGain: goldGain,
                ratePerHour: goldRate,
            },
            exp: expInfo ? {
                current: expInfo.curExp,
                max: expInfo.maxExp,
                left: expInfo.expLeft,
                progress: expInfo.progress,
                sessionGain: sessionGain,
                ratePerMin: expRateMin,
                ratePerHour: sessionExpRate,
                timeToLevel: eta ? eta.formatted : null,
            } : null,
            bot: {
                running: botApi ? botApi.isRunning() : false,
                phase: botApi ? botApi.getPhase() : 'idle',
                target: target ? {
                    id: target.id, name: target.name, lvl: target.lvl,
                    tx: target.tx, ty: target.ty, grp: target.grp,
                } : null,
                mobCount: mobs.length,
                statusText: statusTxt ? statusTxt.textContent : null,
                mobs: mobs.slice(0, 25).map(m => ({
                    id: m.id, name: m.name, lvl: m.lvl, grp: m.grp,
                    rank: m.rank || 'regular',
                    tx: m.tx, ty: m.ty,
                    dist: parseFloat(tileDistFn(hero, m).toFixed(1)),
                })),
            },
            bag: bag ? {
                totalSlots: bag.totalSlots,
                usedSlots: bag.usedSlots,
                freeSlots: bag.freeSlots,
                isFull: bag.isFull,
                hasPotions: bag.hasPotions,
                potions: bag.potions.map(p => ({
                    name: p.name, qty: p.qty, heal: p.heal,
                })),
            } : null,
            skills: {
                points: skillPts,
                list: skills.filter(s => s.learned).map(s => ({
                    name: s.name, curLvl: s.curLvl, maxLvl: s.maxLvl, isActive: s.isActive,
                })),
            },
            autof: {
                enabled: botApi ? botApi.getConfig().autoFEnabled : false,
                minHP: botApi ? botApi.getConfig().autoFMinHP : cfgAutoFMinHP,
                status: autofStatusEl ? autofStatusEl.textContent : null,
            },
            captcha: {
                enabled: captchaEnabled,
                status: captchaStatusEl ? captchaStatusEl.textContent : null,
            },
            travelStatusText: travelStatusText,
            travelPath: travelPath,
            patrolStatusText: patrolStatusText,
            aiPlan: lastSkillPlan,
            config: botApi ? {
                ...botApi.getConfig(),
                aiSkillsEnabled: document.getElementById('maw-ai-skills-enable').checked,
                aiApplyEnabled: document.getElementById('maw-ai-allow-apply').checked,
                aiLastMode: lastAiSkillMode,
                aiLastStatus: lastAiSkillStatus,
            } : null,
        };
    }

    let telemetryOk = false;
    let telemetryErrCount = 0;

    function startTelemetry() {
        const send = () => {
            try {
                const payload = buildTelemetryState();
                gmRequest(DEV_API, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                }).then((r) => {
                    if (!telemetryOk) {
                        telemetryOk = true;
                        log('<span class="ok">📡 Dashboard połączony</span>');
                    }
                    telemetryErrCount = 0;
                    try {
                        const data = JSON.parse(r.responseText);
                        if (data && data.configPatch) {
                            applyConfigFromDashboard(data.configPatch);
                        }
                    } catch (err) {}
                }).catch((e) => {
                    telemetryErrCount++;
                    if (telemetryErrCount === 1 || telemetryErrCount % 5 === 0) {
                        log(`<span class="warn">📡 Dashboard: ${e.message} — npm run dev?</span>`);
                    }
                });
            } catch (e) { /* ignore */ }
        };
        send();
        setInterval(send, 2000);
    }

    // ═══════════════════════════════════════════════════════════
    //  TIMERY UI
    // ═══════════════════════════════════════════════════════════
    setInterval(() => {
        if (botApi) botApi.autoFTick();
        renderHP();
    }, 800);

    setInterval(() => {
        if (captchaEnabled) {
            const found = solveCaptcha();
            if (!found) updateCaptchaStatus('Czeka na CAPTCHĘ');
        }
    }, 2000);

    // Anti-stasis: sprawdzaj co 15s czy czas na losowy ruch
    setInterval(() => {
        if (settings.antiStasisEnabled && Date.now() - lastAntiStasisMove > nextAntiStasisDelay) {
            doAntiStasisMove();
        }
    }, 15000);

    // Quest auto-dialog: obsługiwany przez moduł maw-quest.js
    setInterval(() => {
        if (settings.questAutoEnabled && window.MAW && window.MAW.quest) window.MAW.quest.dialog();
    }, 1500);

    // Auto-nawigacja questowa (NPC + lokacje mapy z mapsData)
    // Skanuje quest i automatycznie idzie do celu co 3s
    setInterval(() => {
        if (settings.questAutoEnabled && settings.questAutoNav !== false && window.MAW && window.MAW.quest) {
            // Tylko poza walką, bez otwartego dialogu i bez oczekiwania na dialog
            if (isInBattle()) return;
            const dw = document.querySelector('.dialogue-window.is-open, .dialogue-window');
            if (dw && window.getComputedStyle(dw).display !== 'none') return;
            if ($w.Engine && $w.Engine.hero && $w.Engine.hero.waitForDialog) return;

            // 1. Zeskanuj i odśwież cel
            const q = window.MAW.quest.scan();
            if (!q) return;
            window.MAW.quest.render();

            const npc = window._mawQuestNpc;
            const loc = window._mawQuestLoc;

            // 2. Jeśli misją jest NPC na obecnej mapie - idź i zagadaj
            if (npc) {
                // Wyłączamy ewentualną podróż na inną mapę
                if (settings.travelEnabled) {
                    settings.travelEnabled = false;
                    saveSettings({ travelEnabled: false });
                }
                window.MAW.quest.npcClick(npc);
            }
            // 3. Jeśli misją jest przejście do innej lokacji
            else if (loc) {
                // Znajdź mapę o podobnej nazwie w mapsData
                let targetId = null;
                const norm = loc.trim().toLowerCase();
                if (mapsData) {
                    for (const [id, m] of Object.entries(mapsData)) {
                        if (m && m.name && m.name.toLowerCase().includes(norm)) {
                            targetId = Number(id);
                            break;
                        }
                    }
                }
                const currentMapId = Number(getMapId());
                if (targetId && currentMapId && currentMapId !== targetId) {
                    if (Number(settings.targetMapId) !== targetId || !settings.travelEnabled) {
                        log(`🗺️ Quest: Automatyczna podróż do lokacji docelowej: <b>${loc}</b> (ID ${targetId})`);
                        settings.targetMapId = targetId;
                        settings.travelEnabled = true;
                        saveSettings({ targetMapId: targetId, travelEnabled: true });
                        if (botApi) botApi.setConfig({ targetMapId: targetId, travelEnabled: true });
                    }
                }
            }
        }
    }, 3000);


    setInterval(() => {
        if (botApi && !botApi.isRunning()) renderAll();
    }, 2000);

    setInterval(() => {
        renderExp();
        renderBag();
        renderGold();
    }, 3000);

    // AI auto-allocator loop (check every 5s)
    setInterval(() => {
        checkAutoSkillAllocation();
    }, 5000);

    // Auto-travel tick loop (check every 1.5s)
    setInterval(() => {
        checkMapTravelTick();
    }, 1500);

    // Precise transition coordinate tracker loop (every 300ms)
    setInterval(() => {
        const hero = getHeroTile();
        const mapId = getMapId();
        if (!mapId) return;

        if (lastKnownMapId && mapId !== lastKnownMapId) {
            if (lastPlayerTile) {
                const payload = {
                    fromMapId: lastKnownMapId,
                    connections: [{
                        toMapId: mapId,
                        tx: lastPlayerTile.x,
                        ty: lastPlayerTile.y
                    }]
                };
                gmRequest(DEV_API.replace('/api/state', '/api/map/connections'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }).catch(() => {});
            }
        }

        lastKnownMapId = mapId;
        if (hero) {
            lastPlayerTile = { x: hero.x, y: hero.y };
        }
    }, 300);

    // ═══════════════════════════════════════════════════════════
    //  INIT
    // ═══════════════════════════════════════════════════════════
    if (DEV) startTelemetry();
    setTimeout(() => bootstrapBot(), 900);

})();
