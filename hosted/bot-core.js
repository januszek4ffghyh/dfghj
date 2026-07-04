/**
 * Margonem AutoWalk – logika bota (hostowana, ładowana przez Tampermonkey loader)
 * window.MawBot.init(bridge, maps) → API dla UI
 */
(function (global) {
    'use strict';

    let bridge = null;
    let maps = null;

    let running = false;
    let phase = 'idle';
    let target = null;
    let walkTimer = null;
    let stuckCnt = 0;
    let lastHeroPos = null;

    let cfgMinLvl = 1;
    let cfgMaxLvl = 200;
    let cfgGrpOnly = false;
    let cfgRange = 999;
    let cfgWalkDelay = 1500;
    let cfgAtkDelay = 1000;
    let cfgArrDist = 2.5;
    let cfgSortBy = 'dist';
    let cfgStopFull = false;
    let cfgStopNoPot = false;
    let cfgTravelEnabled = false;
    let cfgTargetMapId = 0;
    let cfgHeroHunterEnabled = false;
    let cfgHeroHunterName = "Zmora";
    let cfgPatrolMapIds = [];

    let autoFEnabled = false;
    let cfgAutoFMinHP = 40;

    let lastBagInfo = null;
    let lastBagScan = 0;

    function tileDist(hero, mob) {
        const dx = hero.x - mob.tx;
        const dy = hero.y - mob.ty;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function tileDistManhattan(hero, mob) {
        return Math.abs(hero.x - mob.tx) + Math.abs(hero.y - mob.ty);
    }

    function getBagInfo(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && now - lastBagScan < 2000) return lastBagInfo;
        lastBagInfo = bridge.scanBag();
        lastBagScan = now;
        return lastBagInfo;
    }

    function getFilteredMobs() {
        const hero = bridge.getHeroTile() || { x: 0, y: 0 };
        const rawMobs = bridge.scanMobs();
        
        if (cfgHeroHunterEnabled) {
            const heroes = rawMobs.filter(m => {
                const isHeroRank = m.rank === 'hero';
                const matchesName = cfgHeroHunterName && m.name.toLowerCase().includes(cfgHeroHunterName.toLowerCase());
                return isHeroRank || matchesName;
            });
            if (heroes.length > 0) {
                return heroes.sort((a, b) => tileDistManhattan(hero, a) - tileDistManhattan(hero, b));
            }
        }

        return rawMobs
            .filter(m => m.lvl >= cfgMinLvl && m.lvl <= cfgMaxLvl)
            .filter(m => !cfgGrpOnly || m.grp)
            .filter(m => cfgRange >= 900 || tileDist(hero, m) <= cfgRange)
            .sort((a, b) => {
                if (cfgSortBy === 'lvl_asc') return a.lvl - b.lvl;
                if (cfgSortBy === 'lvl_desc') return b.lvl - a.lvl;
                return tileDistManhattan(hero, a) - tileDistManhattan(hero, b);
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
            bridge.log(`<span class="warn">⚠ Torba pełna (${bag.usedSlots}/${bag.totalSlots}) — bot zatrzymany!</span>`);
            stopBot();
            return false;
        }
        if (cfgStopNoPot && !bag.hasPotions) {
            bridge.log(`<span class="warn">⚠ Brak poteków HP — bot zatrzymany!</span>`);
            stopBot();
            return false;
        }
        return true;
    }

    function pollBattleEnd() {
        if (!running) return;
        if (bridge.isInBattle()) {
            bridge.updateStatus('W walce...', '⚔');
            walkTimer = setTimeout(pollBattleEnd, 800);
            return;
        }
        bridge.scanMobs(true);
        phase = 'next';
        walkTimer = setTimeout(mainLoop, 600);
    }

    function mainLoop() {
        if (!running) return;

        if (cfgTravelEnabled) {
            bridge.updateStatus('Podróż w toku...', '🗺');
            walkTimer = setTimeout(mainLoop, 1000);
            return;
        }

        if (bridge.isInBattle()) {
            phase = 'in_battle';
            bridge.updateStatus('W walce...', '⚔');
            walkTimer = setTimeout(pollBattleEnd, 800);
            return;
        }

        if (!checkBagConditions()) return;

        const hero = bridge.getHeroTile();

        if (phase === 'idle' || phase === 'next') {
            target = pickNextTarget();
            if (!target) {
                bridge.log(`<span class="warn">⚠ Brak mobów — czekam...</span>`);
                bridge.updateStatus('Brak mobów', '⚠');
                walkTimer = setTimeout(mainLoop, 2000);
                return;
            }
            const d = hero ? tileDist(hero, target).toFixed(1) : '?';
            bridge.log(`🎯 Cel: <span class="hi">${target.name}</span> Lv${target.lvl} (${target.tx},${target.ty}) · ${d} kaf.`);
            bridge.updateStatus(`Idę do: ${target.name} Lv${target.lvl} · ${d} kaf.`, '🚶');
            stuckCnt = 0;
            lastHeroPos = hero;
            bridge.heroGoTo(target.tx, target.ty);
            phase = 'walking';
            walkTimer = setTimeout(checkArrival, cfgWalkDelay);
            bridge.renderAll();
            return;
        }

        if (phase === 'walking') {
            checkArrival();
        }
    }

    function checkArrival() {
        if (!running) return;

        if (bridge.isInBattle()) {
            phase = 'in_battle';
            walkTimer = setTimeout(pollBattleEnd, 800);
            return;
        }

        const hero = bridge.getHeroTile();
        if (!hero || !target) { phase = 'idle'; mainLoop(); return; }

        const d = tileDist(hero, target);
        bridge.updateStatus(`Idę: ${target.name} Lv${target.lvl} · ${d.toFixed(1)} kaf.`, '🚶');

        if (!bridge.npcExists(target.id)) {
            bridge.log(`💀 npc${target.id} zniknął`);
            bridge.scanMobs(true);
            phase = 'next';
            walkTimer = setTimeout(mainLoop, 200);
            return;
        }

        if (d <= cfgArrDist) {
            if (bridge.isInBattle()) {
                phase = 'in_battle';
                walkTimer = setTimeout(pollBattleEnd, 800);
                return;
            }
            phase = 'attacking';
            bridge.log(`⚔ Atakuję: <span class="hi">${target.name}</span> Lv${target.lvl}`);
            bridge.updateStatus(`Atakuję: ${target.name} Lv${target.lvl}`, '⚔');
            const ok = bridge.attackMob(target);
            bridge.scanMobs(true);
            if (!ok) {
                phase = 'next';
                walkTimer = setTimeout(mainLoop, 400);
                return;
            }
            phase = 'in_battle';
            walkTimer = setTimeout(pollBattleEnd, 1200);
        } else {
            if (lastHeroPos && hero.x === lastHeroPos.x && hero.y === lastHeroPos.y) {
                stuckCnt++;
                if (stuckCnt >= 3) {
                    bridge.log(`↩ Stuck — ponawiam ruch`);
                    bridge.heroGoTo(target.tx, target.ty);
                    stuckCnt = 0;
                }
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
        bridge.resetSessionStats();
        bridge.recordGoldStart();
        bridge.log(`<span class="ok">▶ Bot uruchomiony (iface: ${bridge.iface})</span>`);
        mainLoop();
    }

    function stopBot() {
        running = false;
        clearTimeout(walkTimer);
        phase = 'idle';
        target = null;
        bridge.log('<span class="warn">⏹ Bot zatrzymany</span>');
        bridge.updateStatus('Zatrzymany', '⏹');
        bridge.onBotStopped();
    }

    let autoFLastMode = null;

    function autoFTick() {
        if (!autoFEnabled) return;

        if (!bridge.isInBattle()) {
            autoFLastMode = null;
            bridge.updateAutoFStatus('idle');
            return;
        }

        if (!bridge.isBattleReady()) {
            bridge.updateAutoFStatus('ładuje...');
            return;
        }

        const hp = bridge.getHeroHP();
        const wantFast = hp.pct > cfgAutoFMinHP;

        if (wantFast) {
            if (bridge.clickFastBattle()) {
                if (autoFLastMode !== 'fast') {
                    bridge.log(`⚡ Auto-F: Szybka walka (HP ${hp.pct}%)`);
                }
                autoFLastMode = 'fast';
                bridge.updateAutoFStatus('fast');
            }
        } else {
            if (bridge.clickTourBattle()) {
                if (autoFLastMode !== 'tour') {
                    bridge.log(`<span class="warn">🛡 Auto-F: HP nisko (${hp.pct}%) → Turowa!</span>`);
                }
                autoFLastMode = 'tour';
                bridge.updateAutoFStatus('tour');
            }
        }
    }

    function setConfig(cfg) {
        if (cfg.minLvl != null) cfgMinLvl = cfg.minLvl;
        if (cfg.maxLvl != null) cfgMaxLvl = cfg.maxLvl;
        if (cfg.grpOnly != null) cfgGrpOnly = cfg.grpOnly;
        if (cfg.range != null) cfgRange = cfg.range;
        if (cfg.walkDelay != null) cfgWalkDelay = cfg.walkDelay;
        if (cfg.atkDelay != null) cfgAtkDelay = cfg.atkDelay;
        if (cfg.arrDist != null) cfgArrDist = cfg.arrDist;
        if (cfg.sortBy != null) cfgSortBy = cfg.sortBy;
        if (cfg.stopFull != null) cfgStopFull = cfg.stopFull;
        if (cfg.stopNoPot != null) cfgStopNoPot = cfg.stopNoPot;
        if (cfg.travelEnabled != null) cfgTravelEnabled = cfg.travelEnabled;
        if (cfg.targetMapId != null) cfgTargetMapId = cfg.targetMapId;
        if (cfg.heroHunterEnabled != null) cfgHeroHunterEnabled = cfg.heroHunterEnabled;
        if (cfg.heroHunterName != null) cfgHeroHunterName = cfg.heroHunterName;
        if (cfg.patrolMapIds != null) cfgPatrolMapIds = cfg.patrolMapIds;
    }

    function getConfig() {
        return {
            minLvl: cfgMinLvl,
            maxLvl: cfgMaxLvl,
            grpOnly: cfgGrpOnly,
            range: cfgRange,
            walkDelay: cfgWalkDelay,
            atkDelay: cfgAtkDelay,
            arrDist: cfgArrDist,
            sortBy: cfgSortBy,
            stopFull: cfgStopFull,
            stopNoPot: cfgStopNoPot,
            autoFEnabled,
            autoFMinHP: cfgAutoFMinHP,
            travelEnabled: cfgTravelEnabled,
            targetMapId: cfgTargetMapId,
            heroHunterEnabled: cfgHeroHunterEnabled,
            heroHunterName: cfgHeroHunterName,
            patrolMapIds: cfgPatrolMapIds,
        };
    }

    function setAutoFConfig(cfg) {
        if (cfg.enabled != null) autoFEnabled = cfg.enabled;
        if (cfg.minHP != null) cfgAutoFMinHP = cfg.minHP;
    }

    function lookupMap(id) {
        return maps ? maps[String(id)] : null;
    }

    global.MawBot = {
        init(b, m) {
            bridge = b;
            maps = m;
            return {
                startBot,
                stopBot,
                getFilteredMobs,
                getTarget: () => target,
                isRunning: () => running,
                getPhase: () => phase,
                setConfig,
                getConfig,
                setAutoFConfig,
                autoFTick,
                getBagInfo,
                lookupMap,
                getMaps: () => maps,
                tileDist,
            };
        },
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
