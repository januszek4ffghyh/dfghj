// ==UserScript==
// @name         ⚔ E2 Hunter – Margonem Bot
// @namespace    http://tampermonkey.net/
// @version      1.3.0
// @description  Zoptymalizowany bot na E2 z auto-dobijaniem, auto-patrolowaniem, AI auto-odpowiedzi na prywatne i premium UI
// @author       Dannessi
// @match        https://*.margonem.pl/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=margonem.pl
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════
    //  KONFIGURACJA
    // ═══════════════════════════════════════════════════════════════
    const VERSION = '1.3.0';
    const STORAGE_KEY = 'e2hunter_cfg_v3';

    const DEFAULT_CFG = {
        // Polowanie
        botEnabled: false,
        e2Only: true,           // tylko E2/Kolosy/Herosy
        huntElite: true,        // poluj na Elity I
        huntElite2: true,       // poluj na Elity II (E2)
        huntHero: true,         // poluj na Herosy
        huntColossus: true,     // poluj na Kolosy
        huntTitan: true,        // poluj na Tytany
        huntRegular: false,     // poluj na zwykłe moby
        minLvl: 1,
        maxLvl: 999,
        maxRange: 30,           // max odległość od bohatera
        e2NameFilter: '',       // Filtrowanie po nazwach E2 (np. Mushita, Kotołak)

        // Patrol
        autoPatrol: false,      // Automatyczne przechodzenie map
        patrolRoute: 'Andarum Ilami, Skały Mroźnych Śpiewów, Cmentarzysko Szerpów, Śnieżna Granica',
        maxTicksBeforeChange: 4, // Ile ticków (~5 sek) czekać na pustej mapie

        // Walka
        autoFight: true,        // auto walka
        autoFinish: true,       // auto dobijanie (szybka walka)
        autoLeave: true,        // auto wyjdź z walki
        autoHealThreshold: 40,  // % HP do zmiany na turową
        
        // UI
        panelX: null,
        panelY: null,
        soundAlert: true,       // dźwięk przy znalezieniu E2
        showNotif: true,        // powiadomienie na ekranie

        // AI Auto-Reply
        aiEnabled: false,
        aiApiKey: '',
        aiModel: 'cohere/north-mini-code:free',
        aiPrompt: 'Jesteś prawdziwym graczem w MMORPG Margonem. Odpisuj krótko, naturalnie, po polsku, jak zwykły gracz. Czasem kogoś wyśmiej albo skrytykuj żartobliwie. Używaj skrótów typu "xd", "lol", "elo", "nw", "spk", "nk". NIE mów że jesteś AI ani botem. Bądź luzacki i krótki (max 1-2 zdania). Nie nadużywaj emotikon.',
        aiDelay: 3000,          // opóźnienie odpowiedzi w ms (żeby wyglądało naturalnie)
        aiMaxHistory: 8,        // ile ostatnich wiadomości pamiętać per gracz
        
        // Auto-Relog (Minutnik)
        autoRelog: true,
        relogSecondsBefore: 10,  // Ile sekund przed 0s ma klikać relog

        // Harmonogram
        scheduleEnabled: false,
        scheduleSlots: '06:00-12:00, 14:00-24:00',  // Przedziały godzinowe, np. "06:00-12:00, 14:00-24:00"
    };

    // ═══════════════════════════════════════════════════════════════
    //  STATE
    // ═══════════════════════════════════════════════════════════════
    let cfg = loadCfg();
    let botRunning = false;
    let botTickTimer = null;
    let autoFTimer = null;
    let currentTarget = null;
    let phase = 'idle'; // idle, scanning, walking, fighting, patrol_wait
    let stats = { kills: 0, e2Found: 0, e2Killed: 0, expGained: 0, goldGained: 0, startTime: 0, startExp: 0, startGold: 0, legDropped: 0, heroDropped: 0, uniDropped: 0 };
    let logLines = [];
    let lastScanTime = 0;
    let mobCache = [];
    let lastMapId = null;
    let ticksOnEmptyMap = 0;
    let routeDirection = 1;
    let _lockBot = false;
    let _lastLootId = 0;
    let _battleProcessed = false;
    const _processedLootIds = new Set();
    let _needToWalkAway = false;
    let _lastTimeMoved = Date.now();
    let _localE2TimerZeroTime = null;
    let _lastRelogClickTime = 0;
    let _acLastMouseMove = 0;
    let _acFakeMouseTimer = null;

    // AI Auto-Reply State
    let _aiChatObserverStarted = false;
    // _aiProcessedMessages removed — using data-ai-done attribute on DOM elements instead
    const _aiRecentMessages = []; // Cache do deduplikacji wiadomości z różnych paneli czatu ({author, message, time})
    const _aiConversations = {};  // { nick: [ {role, content}, ... ] }
    let _aiPendingReply = false;
    let _aiReplyCount = 0;
    let _aiLastReplyTime = 0;

    const E2_DATABASE = [
        { name: "Mushita", lvl: 23, map: "Grota Dzikiego Kota" },
        { name: "Kotołak Tropiciel", lvl: 27, map: "Las Tropicieli" },
        { name: "Shae Phu", lvl: 30, map: "Przeklęta Strażnica - podziemia p.2 s.1" },
        { name: "Zorg Jednooki Baron", lvl: 33, map: "Schowek na Łupy" },
        { name: "Władca rzek", lvl: 37, map: "Podmokła Dolina" },
        { name: "Gobbos", lvl: 40, map: "Jaskinia Pogardy" },
        { name: "Tyrtajos", lvl: 42, map: "Pieczara Kwiku - sala 2" },
        { name: "Tollok Shimger", lvl: 47, map: "Skalne Turnie" },
        { name: "Szczęt alias Gładki", lvl: 47, map: "Stary Kupiecki Trakt" },
        { name: "Agar", lvl: 51, map: "Mokra Grota p.2" },
        { name: "Razuglag Oklash", lvl: 51, map: "Stare Wyrobisko p.3" },
        { name: "Foverk Turrim", lvl: 57, map: "Lazurytowa Grota p.4" },
        { name: "Owadzia Matka", lvl: 58, map: "Kopalnia Kapiącego Miodu p.2 - sala Owadziej Matki" },
        { name: "Furruk Kozug", lvl: 66, map: "Jaskinia Gnollich Szamanów - komnata Kozuga" },
        { name: "Vari Kruger", lvl: 66, map: "Namiot Vari Krugera" },
        { name: "Jotun", lvl: 70, map: "Kamienna Jaskinia - sala 3" },
        { name: "Tollok Utumutu", lvl: 73, map: "Głębokie Skałki p.4" },
        { name: "Tollok Atamatu", lvl: 73, map: "Głębokie Skałki p.3" },
        { name: "Lisz", lvl: 75, map: "Krypty Dusz Śniegu p.3 - komnata Lisza" },
        { name: "Grabarz świątynny", lvl: 80, map: "Erem Czarnego Słońca p.5" },
        { name: "Wielka Stopa", lvl: 82, map: "Firnowa Grota p.2 s.1" },
        { name: "Podły zbrojmistrz", lvl: 82, map: "Świątynia Andarum - zbrojownia" },
        { name: "Choukker", lvl: 84, map: "Wylęgarnia Choukkerów p.1" },
        { name: "Nadzorczyni krasnoludów", lvl: 88, map: "Kopalnia Margorii" },
        { name: "Morthen", lvl: 89, map: "Margoria - Sala Królewska" },
        { name: "Leśne Widmo", lvl: 92, map: "Zapomniany Święty Gaj p.3" },
        { name: "Żelazoręki Ohydziarz", lvl: 92, map: "Grota Samotnych Dusz p.6" },
        { name: "Goplana", lvl: 93, map: "Kamienna Strażnica - Sanktuarium" },
        { name: "Gnom Figlid", lvl: 96, map: "Zagrzybiałe Ścieżki p.3" },
        { name: "Centaur Zyfryd", lvl: 99, map: "Dolina Centaurów" },
        { name: "Kambion", lvl: 101, map: "Namiot Kambiona" },
        { name: "Jertek Moxos", lvl: 105, map: "Podziemia Zniszczonej Wieży p.5" },
        { name: "Miłośnik rycerzy", lvl: 108, map: "Zabłocona Jama p.2 - Sala Błotnistych Odmętów" },
        { name: "Miłośnik magii", lvl: 108, map: "Zabłocona Jama p.2 - Sala Magicznego Błota" },
        { name: "Miłośnik łowców", lvl: 108, map: "Zabłocona Jama p.2 - Sala Duszącej Stęchlizny" },
        { name: "Łowca czaszek", lvl: 112, map: "Skalne Cmentarzysko p.4" },
        { name: "Ozirus Władca Hieroglifów", lvl: 115, map: "Piramida Pustynnego Władcy p.3" },
        { name: "Morski potwór", lvl: 118, map: "Jama Morskiej Macki p.1 - sala 3" },
        { name: "Krab pustelnik", lvl: 124, map: "Opuszczony statek - pokład" },
        { name: "Borgoros Garamir III", lvl: 124, map: "Twierdza Rogogłowych - Sala Byka" },
        { name: "Stworzyciel", lvl: 125, map: "Piaskowa Pułapka - Grota Piaskowej Śmierci" },
        { name: "Ifryt", lvl: 128, map: "Wulkan Politraki p.1 - sala 3" },
        { name: "Jack Truciciel", lvl: 131, map: "Ukryta Grota Morskich Diabłów - magazyn" },
        { name: "Helga Opiekunka Rumu", lvl: 131, map: "Ukryta Grota Morskich Diabłów - siedziba" },
        { name: "Henry Kaprawe Oko", lvl: 131, map: "Ukryta Grota Morskich Diabłów - skarbiec" },
        { name: "Eol", lvl: 135, map: "Piaszczysta Grota p.1 - sala 2" },
        { name: "Grubber Ochlaj", lvl: 136, map: "Kopalnia Żółtego Kruszcu p.2 - sala 2" },
        { name: "Mistrz Worundriel", lvl: 139, map: "Kuźnia Worundriela - Komnata Żaru" },
        { name: "Wójt Fistuła", lvl: 144, map: "Chata wójta Fistuły p.1" },
        { name: "Teściowa Rumcajsa", lvl: 145, map: "Chata Teściowej" },
        { name: "Berserker Amuno", lvl: 148, map: "Cenotaf Berserkerów p.1 - sala 2" },
        { name: "Fodug Zolash", lvl: 150, map: "Mała Twierdza - sala główna" },
        { name: "Goons Asterus", lvl: 154, map: "Lokum Złych Goblinów - warsztat" },
        { name: "Adariel", lvl: 155, map: "Laboratorium Adariel" },
        { name: "Burkog Lorulk", lvl: 160, map: "Grota Orczej Hordy p.2 s.3" },
        { name: "Sheba Orcza Szamanka", lvl: 160, map: "Grota Orczych Szamanów p.3 s.1" },
        { name: "Shakkru", lvl: 160, map: "Grota Orczych Szamanów p.3 s.1" },
        { name: "Duch Władcy Klanów", lvl: 165, map: "Nawiedzone Kazamaty p.4" },
        { name: "Bragarth Myśliwy Dusz", lvl: 170, map: "Sala Rady Orków" },
        { name: "Fursharag Pożeracz Umysłów", lvl: 170, map: "Sala Rady Orków" },
        { name: "Ziuggrael Strażnik Królowej", lvl: 170, map: "Sala Rady Orków" },
        { name: "Lusgrathera Królowa Pramatka", lvl: 175, map: "Sala Królewska" },
        { name: "Królowa Śniegu", lvl: 175, map: "Kryształowa Grota - Sala Smutku" },
        { name: "Wrzosera", lvl: 177, map: "Drzewo Dusz p.2" },
        { name: "Chryzoprenia", lvl: 177, map: "Drzewo Dusz p.2" },
        { name: "Cantedewia", lvl: 177, map: "Drzewo Dusz p.2" },
        { name: "Ogr Stalowy Pazur", lvl: 183, map: "Ogrza Kawerna p.4" },
        { name: "Torunia Ankelwald", lvl: 186, map: "Krypty Bezsennych p.3" },
        { name: "Pięknotka Mięsożerna", lvl: 189, map: "Skarpa Trzech Słów" },
        { name: "Breheret Żelazny Łeb", lvl: 192, map: "Przysiółek Valmirów" },
        { name: "Cerasus", lvl: 193, map: "Starodrzew Przedwiecznych p.2" },
        { name: "Mysiur Myświórowy Król", lvl: 197, map: "Szlamowe Kanały p.2 - sala 3" },
        { name: "Sadolia Nadzorczyni Hurys", lvl: 200, map: "Przerażające Sypialnie" },
        { name: "Sataniel Skrytobójca", lvl: 204, map: "Sala Skaryfikacji Grzeszników" },
        { name: "Bergermona Krwawa Hrabina", lvl: 204, map: "Sale Rozdzierania" },
        { name: "Annaniel Wysysacz Marzeń", lvl: 204, map: "Tajemnicza Siedziba" },
        { name: "Gothardus Kolekcjoner Głów", lvl: 204, map: "Tajemnicza Siedziba" },
        { name: "Zufulus Smakosz Serc", lvl: 205, map: "Sala Tysiąca Świec" },
        { name: "Czempion Furboli", lvl: 210, map: "Zalana Grota" },
        { name: "Arachniregina Colosseus", lvl: 214, map: "Arachnitopia p.6" },
        { name: "Rycerz z za małym mieczem", lvl: 214, map: "Arachnitopia p.6" },
        { name: "Al'diphrin Ilythirahel", lvl: 218, map: "Erem Aldiphrina" },
        { name: "Marlloth Malignitas", lvl: 220, map: "Ołtarz Pajęczej Bogini" },
        { name: "Arytodam olbrzymi", lvl: 226, map: "Gnijące Topielisko" },
        { name: "Mocny Maddoks", lvl: 231, map: "Jaszczurze Korytarze p.2 - sala 5" },
        { name: "Fangaj", lvl: 235, map: "Gardziel Podgnitych Mchów p.3" },
        { name: "Dendroculus", lvl: 240, map: "Źródło Zakorzenionego Ludu" },
        { name: "Tolypeutes", lvl: 245, map: "Złota Góra p.3 - sala 2" },
        { name: "Cuaitl Citlalin", lvl: 250, map: "Chantli Cuaitla Citlalina" },
        { name: "Yaotl", lvl: 258, map: "Zachodni Mictlan p.9" },
        { name: "Quetzalcoatl", lvl: 258, map: "Wschodni Mictlan p.9" },
        { name: "Wabicielka", lvl: 260, map: "Siedlisko Przyjemnej Woni - źródło" },
        { name: "Pogardliwa Sybilla", lvl: 263, map: "Potępione Zamczysko - pracownia" },
        { name: "Chopesz", lvl: 267, map: "Katakumby Gwałtownej Śmierci" },
        { name: "Neferkar Set", lvl: 274, map: "Grobowiec Seta" },
        { name: "Terrozaur", lvl: 280, map: "Urwisko Vapora" },
        { name: "Vaenra Charkhaam", lvl: 280, map: "Świątynia Hebrehotha - sala ofiary" },
        { name: "Chaegd Agnrakh", lvl: 280, map: "Świątynia Hebrehotha - sala czciciela" },
        { name: "Nymphemonia", lvl: 287, map: "Drzewo Życia p.3" },
        { name: "Artenius", lvl: 300, map: "Sala Lodowej Magii" },
        { name: "Furion", lvl: 300, map: "Sala Mroźnych Strzał" },
        { name: "Zorin", lvl: 300, map: "Sala Mroźnych Szeptów" }
    ];

    // Słownik E2 z nowego kodu do szybkiego wklejenia w filtr
    const PRESETS = {
        "ALL ELITES II": "Mushita, Kotołak Tropiciel, Shae Phu, Zorg Jednooki Baron, Władca rzek, Gobbos, Tyrtajos, Tollok Shimger, Szczęt alias Gładki, Agar, Razuglag Oklash, Foverk Turrim, Owadzia Matka, Furruk Kozug, Vari Kruger, Jotun, Tollok Utumutu, Tollok Atamatu, Lisz, Grabarz świątynny, Wielka Stopa, Podły zbrojmistrz, Choukker, Nadzorczyni krasnoludów, Morthen, Leśne Widmo, Żelazoręki Ohydziarz, Goplana, Gnom Figlid, Centaur Zyfryd, Kambion, Jertek Moxos, Miłośnik rycerzy, Miłośnik magii, Miłośnik łowców, Łowca czaszek, Ozirus Władca Hieroglifów, Morski potwór, Krab pustelnik, Borgoros Garamir III, Stworzyciel, Ifryt, Jack Truciciel, Helga Opiekunka Rumu, Henry Kaprawe Oko, Eol, Grubber Ochlaj, Mistrz Worundriel, Wójt Fistuła, Teściowa Rumcajsa, Berserker Amuno, Fodug Zolash, Goons Asterus, Adariel, Burkog Lorulk, Sheba Orcza Szamanka, Shakkru, Duch Władcy Klanów, Bragarth Myśliwy Dusz, Fursharag Pożeracz Umysłów, Ziuggrael Strażnik Królowej, Lusgrathera Królowa Pramatka, Królowa Śniegu, Wrzosera, Chryzoprenia, Cantedewia, Ogr Stalowy Pazur, Torunia Ankelwald, Pięknotka Mięsożerna, Breheret Żelazny Łeb, Cerasus, Mysiur Myświórowy Król, Sadolia Nadzorczyni Hurys, Sataniel Skrytobójca, Bergermona Krwawa Hrabina, Annaniel Wysysacz Marzeń, Gothardus Kolekcjoner Głów, Zufulus Smakosz Serc, Czempion Furboli, Arachniregina Colosseus, Rycerz z za małym mieczem, Al'diphrin Ilythirahel, Marlloth Malignitas, Arytodam olbrzymi, Mocny Maddoks, Fangaj, Dendroculus, Tolypeutes, Cuaitl Citlalin, Yaotl, Quetzalcoatl, Wabicielka, Pogardliwa Sybilla, Chopesz, Neferkar Set, Terrozaur, Vaenra Charkhaam, Chaegd Agnrakh, Nymphemonia, Artenius, Furion, Zorin"
    };

    // ═══════════════════════════════════════════════════════════════
    //  CONFIG PERSISTENCE
    // ═══════════════════════════════════════════════════════════════
    function loadCfg() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return { ...DEFAULT_CFG, ...(raw ? JSON.parse(raw) : {}) };
        } catch { return { ...DEFAULT_CFG }; }
    }
    function saveCfg() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    }

    // ═══════════════════════════════════════════════════════════════
    //  WAIT FOR ENGINE
    // ═══════════════════════════════════════════════════════════════
    function waitForEngine(cb) {
        const check = () => {
            if (window.Engine && Engine.hero && Engine.hero.d && Engine.npcs) {
                cb();
            } else {
                setTimeout(check, 500);
            }
        };
        check();
    }

    // ═══════════════════════════════════════════════════════════════
    //  LOGGING
    // ═══════════════════════════════════════════════════════════════
    function log(msg, type = 'info') {
        const time = new Date().toLocaleTimeString('pl-PL');
        logLines.push({ time, msg, type });
        if (logLines.length > 150) logLines.shift();
        renderLog();
        console.log(`[E2H][${type}] ${msg}`);
    }

    // ═══════════════════════════════════════════════════════════════
    //  MOB RANK DETECTION (z danych wt + tip)
    // ═══════════════════════════════════════════════════════════════
    function getMobRank(npcData) {
        const wt = npcData.wt || 0;
        const tip = (npcData.tip || '').toLowerCase();

        // Warrior Type ma priorytet
        if (wt >= 100) return 'titan';
        if (wt >= 90) return 'colossus';
        if (wt >= 80) return 'hero';
        if (wt >= 30) return 'elite3';
        if (wt >= 20) return 'elite2';
        if (wt >= 10) return 'elite';

        // Fallback: parsowanie tipa
        if (tip.includes('tytan') || tip.includes('titan')) return 'titan';
        if (tip.includes('kolos') || tip.includes('colossus')) return 'colossus';
        if (tip.includes('heros') || tip.includes('heroes')) return 'hero';
        if (tip.includes('elita iii') || tip.includes('elite iii') || tip.includes('elita 3')) return 'elite3';
        if (tip.includes('elita ii') || tip.includes('elite ii') || tip.includes('elita 2')) return 'elite2';
        if (tip.includes('elita') || tip.includes('elite')) return 'elite';

        return 'regular';
    }

    // ═══════════════════════════════════════════════════════════════
    //  HELPER COLORS/LABELS
    // ═══════════════════════════════════════════════════════════════
    function getRankLabel(rank) {
        const labels = {
            titan: '🔱 Tytan', colossus: '💎 Kolos', hero: '👑 Heros',
            elite3: '🔥 Elita III', elite2: '⚡ Elita II', elite: '⭐ Elita', regular: '🟢 Zwykły'
        };
        return labels[rank] || rank;
    }

    function getRankColor(rank) {
        const colors = {
            titan: '#ff4444', colossus: '#a855f7', hero: '#ff69b4',
            elite3: '#ff8c00', elite2: '#3b82f6', elite: '#22c55e', regular: '#6b7280'
        };
        return colors[rank] || '#6b7280';
    }

    function getRankPriority(rank) {
        const prio = { titan: 7, colossus: 6, hero: 5, elite3: 4, elite2: 3, elite: 2, regular: 1 };
        return prio[rank] || 0;
    }

    function isTargetRank(rank) {
        if (rank === 'elite' && cfg.huntElite) return true;
        if (rank === 'elite2' && cfg.huntElite2) return true;
        if (rank === 'elite3' && cfg.huntElite2) return true;
        if (rank === 'hero' && cfg.huntHero) return true;
        if (rank === 'colossus' && cfg.huntColossus) return true;
        if (rank === 'titan' && cfg.huntTitan) return true;
        if (rank === 'regular' && cfg.huntRegular) return true;
        return false;
    }

    // ═══════════════════════════════════════════════════════════════
    //  SKANOWANIE GATEWAY'ÓW (Dynamiczne)
    // ═══════════════════════════════════════════════════════════════
    function scanGateways() {
        const gateways = [];
        if (window.Engine && Engine.map) {
            try {
                const mapData = Engine.map.d || Engine.map;
                const gates = mapData.gateways || mapData.gates || mapData.gw || [];
                const gateArr = Array.isArray(gates) ? gates : Object.values(gates);

                gateArr.forEach(gate => {
                    if (!gate) return;
                    const targetMapId = gate.targetMapId || gate.toMap || gate.map || gate.id2 || 0;
                    const tx = gate.x || gate.tx || 0;
                    const ty = gate.y || gate.ty || 0;
                    const name = (gate.name || `Mapa #${targetMapId}`).trim();
                    gateways.push({
                        targetMapId,
                        tx, ty, name
                    });
                });
                if (gateways.length > 0) return gateways;
            } catch(e) {}
        }
        // DOM fallback
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
                targetMapId,
                tx, ty, name
            });
        });
        return gateways;
    }

    // ═══════════════════════════════════════════════════════════════
    //  SKANOWANIE MOBÓW (Zoptymalizowane pod getDrawableList())
    // ═══════════════════════════════════════════════════════════════
    function scanMobs() {
        const now = Date.now();
        if (now - lastScanTime < 250) return mobCache;
        lastScanTime = now;

        const mobs = [];
        try {
            // Najlepsza logika pobierania rysowanych NPC
            const npcs = window.Engine.npcs.getDrawableList();
            const heroX = Engine.hero.d.x;
            const heroY = Engine.hero.d.y;

            for (const id in npcs) {
                const npc = npcs[id];
                if (!npc || !npc.d || npc.isDead || npc.d.dead) continue; // filtruj martwe

                const d = npc.d;
                if (d.type !== 2 && d.type !== 3) continue; // tylko potwory

                const lvl = d.lvl || d.level || 0;
                if (lvl < 1) continue;

                const nick = (d.nick || d.name || '').trim();
                if (!nick) continue;

                const rank = getMobRank(d);
                // Dystans Manhattan: abs(dx) + abs(dy) z nowego kodu bicia
                const dist = Math.abs(heroX - d.x) + Math.abs(heroY - d.y);

                mobs.push({
                    id: d.id || npc.id,
                    npc: npc,
                    nick: nick,
                    lvl: lvl,
                    rank: rank,
                    x: d.x,
                    y: d.y,
                    dist: dist,
                    grp: !!d.grp,
                    wt: d.wt || 0,
                    icon: d.icon || '',
                });
            }
        } catch (e) {
            console.error('[E2H] scanMobs error:', e);
        }

        // Sortuj: najwyższy rank -> najbliższy
        mobs.sort((a, b) => {
            const pa = getRankPriority(a.rank);
            const pb = getRankPriority(b.rank);
            if (pa !== pb) return pb - pa;
            return a.dist - b.dist;
        });

        mobCache = mobs;
        return mobs;
    }

    // ═══════════════════════════════════════════════════════════════
    //  HERO HELPERS
    // ═══════════════════════════════════════════════════════════════
    function getHeroHP() {
        try {
            const d = window.Engine?.hero?.d || window.g?.hero;
            if (d && d.hp !== undefined && d.maxhp) return Math.round(d.hp / d.maxhp * 100);
        } catch {}
        try {
            const bloodEl = document.querySelector('.hp-indicator-wrapper .blood');
            if (bloodEl) {
                const pctAttr = bloodEl.getAttribute('bar-percent');
                if (pctAttr !== null) {
                    const val = parseInt(pctAttr, 10);
                    if (!isNaN(val)) return val;
                }
            }
            const valEl = document.querySelector('.hp-indicator-wrapper .hpp .value');
            if (valEl) {
                const txt = valEl.textContent || "";
                const val = parseInt(txt.replace('%', ''), 10);
                if (!isNaN(val)) return val;
            }
        } catch (e) {
            console.error('[E2H] getHeroHP DOM read error:', e);
        }
        return 100;
    }

    function getHeroInfo() {
        try {
            const d = Engine.hero.d;
            return {
                nick: d.nick || '?',
                lvl: d.lvl || 0,
                hp: d.hp || 0,
                maxhp: d.maxhp || 1,
                hpPct: getHeroHP(),
                x: d.x || 0,
                y: d.y || 0,
                exp: d.exp || 0,
                gold: d.gold || 0,
            };
        } catch { return null; }
    }

    function getMapInfo() {
        try {
            return { name: Engine.map.d.name || '?', id: Engine.map.d.id || 0 };
        } catch { return { name: '?', id: 0 }; }
    }

    // ═══════════════════════════════════════════════════════════════
    //  WALKA - DETEKCJA
    // ═══════════════════════════════════════════════════════════════
    function isInBattle() {
        try {
            if (Engine.battle && Engine.battle.show === true) return true;
            if (Engine.battle && typeof Engine.battle.isActive === 'function') return Engine.battle.isActive();
        } catch {}
        // DOM fallback
        const el = document.getElementById('battle');
        if (el) {
            const st = window.getComputedStyle(el);
            if (st.display !== 'none' && st.visibility !== 'hidden') return true;
        }
        const niBattle = document.querySelector('.battle-window, .fight-window');
        return !!niBattle && window.getComputedStyle(niBattle).display !== 'none';
    }

    function isBattleOver() {
        try {
            if (Engine.battle && Engine.battle.endBattle) return true;
            
            // Sprawdzenie warstwy końca walki (np. w battle-controller)
            const endLayer = document.querySelector('.battle-end-layer');
            if (endLayer && window.getComputedStyle(endLayer).display !== 'none') return true;
            
            // Sprawdzenie przycisków wyjścia z walki / logów walki
            const closeLogs = document.querySelector('.close-battle-logs');
            if (closeLogs && window.getComputedStyle(closeLogs).display !== 'none') return true;

            const closeGround = document.querySelector('.close-battle-ground');
            if (closeGround && window.getComputedStyle(closeGround).display !== 'none') return true;

            const leaveBtn = document.querySelector('.leave-battle-button, [class*="leave"][class*="battle"], #leaveBattleButton');
            if (leaveBtn && window.getComputedStyle(leaveBtn).display !== 'none') return true;
        } catch {}
        return false;
    }

    function didHeroWinBattle() {
        try {
            const hero = getHeroInfo();
            const heroNick = hero ? hero.nick : null;
            
            const winMsg = document.querySelector('.battle-controller .battle-msg.win, .battle-window .battle-msg.win');
            if (winMsg) {
                const txt = winMsg.textContent || "";
                if (heroNick && txt.includes(heroNick)) return true;
                
                const loseMsg = document.querySelector('.battle-controller .battle-msg.lose, .battle-window .battle-msg.lose');
                if (loseMsg && heroNick && loseMsg.textContent.includes(heroNick)) return false;
                
                if (heroNick) return !document.body.innerHTML.includes(`Poległ(a) ${heroNick}`);
            }
            
            const loseMsg = document.querySelector('.battle-controller .battle-msg.lose, .battle-window .battle-msg.lose');
            if (loseMsg && heroNick && loseMsg.textContent.includes(heroNick)) return false;
        } catch (e) {
            console.error('[E2H] didHeroWinBattle error:', e);
        }
        return true; // Domyślnie true
    }

    function checkBattleType() {
        let isE2 = false;
        try {
            // 1. Sprawdzenie przez silnik gry (wt = warrior type: 2=E2, 3=Heros, 4=Tytan/Kolos)
            const warriors = (window.Engine?.battle?.warriors) || (window.g?.battle?.warriors);
            if (warriors) {
                for (const id in warriors) {
                    const w = warriors[id];
                    if (w && w.team === 2) {
                        if (w.wt === 2 || w.wt === 3 || w.wt === 4) {
                            isE2 = true;
                            break;
                        }
                    }
                }
            }
        } catch (e) {}

        // 2. Fallback: Jeśli bot sam go zaatakował i nazwa zgadza się ze słownikiem E2
        if (!isE2 && currentTarget) {
            const name = (currentTarget.nick || '').toLowerCase();
            const presetsLower = PRESETS["ALL ELITES II"].toLowerCase();
            if (presetsLower.includes(name)) {
                isE2 = true;
            }
        }

        // 3. Fallback: Sprawdzenie klas CSS w DOM (dla NI/SI)
        if (!isE2) {
            const e2Nick = document.querySelector('.battle-content .nick.c-elite2, .battle-content .nick.c-hero, .battle-content .nick.c-colossus')
                || document.querySelector('.battle-window .c-elite2, .battle-window .c-hero');
            if (e2Nick) {
                isE2 = true;
            }
        }

        // 4. Sprawdzenie po nazwie przeciwnika z paska battle-controller
        if (!isE2) {
            const nickEl = document.querySelector('.battle-controller .nick, .battle-content .nick, .battle-window .nick');
            if (nickEl) {
                const name = (nickEl.textContent || '').trim().toLowerCase();
                if (name) {
                    const presetsLower = PRESETS["ALL ELITES II"].toLowerCase();
                    if (presetsLower.includes(name)) {
                        isE2 = true;
                    }
                }
            }
        }

        // 5. Sprawdzenie po URL-u awatara w turn-prediction (npc/e2, npc/hero, etc.)
        if (!isE2) {
            const avatars = document.querySelectorAll('.battle-controller .img-avatar-correct, .battle-window .img-avatar-correct, .turn-prediction .img-avatar-correct');
            for (const av of avatars) {
                const bg = av.style.backgroundImage || "";
                if (bg.includes('/npc/e2/') || bg.includes('/npc/hero/') || bg.includes('/npc/colossus/')) {
                    isE2 = true;
                    break;
                }
            }
        }

        return isE2;
    }

    // ═══════════════════════════════════════════════════════════════
    //  AUTO-FIGHT + DOBIJANIE (Najlepsza logika z autoFight(true))
    // ═══════════════════════════════════════════════════════════════
    function doAutoFight() {
        if (!isInBattle()) return;
        if (!cfg.autoFight) return;

        try {
            const hpPct = getHeroHP();

            // Jeśli HP niskie — turowa walka (bezpieczniejsza)
            if (hpPct <= cfg.autoHealThreshold) {
                if (typeof window.tourFight === 'function') {
                    window.tourFight();
                } else {
                    const tourBtn = document.getElementById('tourbattleButton') ||
                        document.querySelector('.action-tour-fight, .tour-fight-button');
                    if (tourBtn) tourBtn.click();
                }
                updateBattleStatus('tour');
                return;
            }

            // Najlepsza logika szybkiej walki z parametrem autoFight(true)
            if (cfg.autoFinish) {
                if (window.Engine.battle && window.Engine.battle.autoFight && !window.Engine.battle.isAuto) {
                    window.Engine.battle.autoFight(true);
                    updateBattleStatus('fast');
                    return;
                }
                if (typeof window.autoFightForMe === 'function') {
                    window.autoFightForMe();
                    updateBattleStatus('fast');
                    return;
                }
                const autoBtn = document.getElementById('autobattleButton') ||
                    document.querySelector('.action-fast-fight, .quick-fight-button, [class*="fast-fight"], [class*="autoFight"]');
                if (autoBtn) {
                    autoBtn.click();
                    updateBattleStatus('fast');
                    return;
                }
            }

            if (typeof Engine.battle.autoFight === 'function') {
                Engine.battle.autoFight(true);
            }
            updateBattleStatus('fight');
        } catch (e) {
            console.error('[E2H] autoFight error:', e);
        }
    }

    function scanLootFromDom() {
        try {
            const lootWindow = document.querySelector('.loot-window');
            if (!lootWindow) return;

            const items = lootWindow.querySelectorAll('.item');
            items.forEach(itemEl => {
                let itemId = null;
                itemEl.classList.forEach(cls => {
                    if (cls.startsWith('item-id-')) {
                        itemId = cls.replace('item-id-', '');
                    }
                });
                
                if (!itemId) {
                    const wrapper = itemEl.closest('[loot-id]');
                    if (wrapper) itemId = wrapper.getAttribute('loot-id');
                }

                if (!itemId) return;
                if (_processedLootIds.has(itemId)) return;

                const itemType = itemEl.getAttribute('data-item-type') || "";
                const highlightEl = itemEl.querySelector('.highlight');
                const highlightClass = highlightEl ? highlightEl.className : "";

                if (itemType === 't-leg' || highlightClass.includes('t-leg')) {
                    stats.legDropped = (stats.legDropped || 0) + 1;
                    _processedLootIds.add(itemId);
                    log(`⭐ LEGENDA! Zliczono z DOM, ID: ${itemId}`, 'warn');
                    renderAll();
                } else if (itemType === 't-her' || highlightClass.includes('t-her')) {
                    stats.heroDropped = (stats.heroDropped || 0) + 1;
                    _processedLootIds.add(itemId);
                    log(`💙 Heroik! Zliczono z DOM, ID: ${itemId}`, 'info');
                    renderAll();
                } else if (itemType === 't-uni' || itemType === 't-uniupg' || highlightClass.includes('t-uni')) {
                    stats.uniDropped = (stats.uniDropped || 0) + 1;
                    _processedLootIds.add(itemId);
                    log(`💛 Unikat! Zliczono z DOM, ID: ${itemId}`, 'ok');
                    renderAll();
                } else {
                    _processedLootIds.add(itemId);
                }
            });
        } catch (e) {
            console.error('[E2H] scanLootFromDom error:', e);
        }
    }

    function processLootItems(lootObj) {
        try {
            if (!lootObj || !lootObj.items) return;
            for (const key in lootObj.items) {
                const item = lootObj.items[key];
                if (!item) continue;
                
                const itemId = String(item.id || key);
                if (_processedLootIds.has(itemId)) continue;

                const name = item.name || "?";
                const stat = (item.stat || "").toLowerCase();
                const cl = item.cl;
                
                let counted = false;
                if (stat.includes('legendary') || cl === 5 || cl === 'leg') {
                    stats.legDropped = (stats.legDropped || 0) + 1;
                    log(`⭐ LEGENDA! Zdobyto: ${name}!`, 'warn');
                    counted = true;
                } else if (stat.includes('heroic') || cl === 3 || cl === 'heroic') {
                    stats.heroDropped = (stats.heroDropped || 0) + 1;
                    log(`💙 Heroik! Zdobyto: ${name}`, 'info');
                    counted = true;
                } else if (stat.includes('unique') || cl === 2 || cl === 'unique') {
                    stats.uniDropped = (stats.uniDropped || 0) + 1;
                    log(`💛 Unikat! Zdobyto: ${name}`, 'ok');
                    counted = true;
                }

                if (counted || itemId) {
                    _processedLootIds.add(itemId);
                }
            }
        } catch (e) {
            console.error('[E2H] processLootItems error:', e);
        }
    }

    function getColloquialE2Name(fullName) {
        if (!fullName) return "e2";
        const name = fullName.toLowerCase();
        if (name.includes("szczęt")) return "szczeta";
        if (name.includes("kotołak")) return "kotołaka";
        if (name.includes("shae phu")) return "shae phu";
        if (name.includes("zorg")) return "zorga";
        if (name.includes("władca rzek")) return "władcę rzek";
        if (name.includes("gobbos")) return "gobbosa";
        if (name.includes("tyrtajos")) return "tyrtajosa";
        if (name.includes("tollok shimger")) return "shimgera";
        if (name.includes("agar")) return "agara";
        if (name.includes("razuglag")) return "razuglaga";
        if (name.includes("foverk")) return "foverka";
        if (name.includes("owadzia matka")) return "matkę";
        if (name.includes("furruk")) return "kozuga";
        if (name.includes("vari kruger")) return "vari";
        if (name.includes("jotun")) return "jotuna";
        if (name.includes("tollok utumutu")) return "utumutu";
        if (name.includes("tollok atamatu")) return "atamatu";
        if (name.includes("lisz")) return "lisza";
        if (name.includes("grabarz")) return "grabarza";
        if (name.includes("wielka stopa")) return "stopę";
        if (name.includes("podły zbrojmistrz")) return "zbrojmistrza";
        if (name.includes("choukker")) return "choukkera";
        if (name.includes("nadzorczyni")) return "nadzorczynię";
        if (name.includes("morthen")) return "morthena";
        if (name.includes("leśne widmo")) return "widmo";
        if (name.includes("ohydziarz")) return "ohydziarza";
        if (name.includes("goplana")) return "goplanę";
        if (name.includes("figlid")) return "figlida";
        if (name.includes("zyfryd")) return "zyfryda";
        if (name.includes("kambion")) return "kambiona";
        if (name.includes("moxos")) return "jerteka";
        if (name.includes("rycerzy")) return "miłośnika rycków";
        if (name.includes("magii")) return "miłośnika magii";
        if (name.includes("łowców")) return "miłośnika łowców";
        if (name.includes("łowca czaszek")) return "łowcę";
        if (name.includes("ozirus")) return "ozirusa";
        if (name.includes("morski potwór")) return "morskiego";
        if (name.includes("krab")) return "kraba";
        if (name.includes("borgoros")) return "byka";
        if (name.includes("stworzyciel")) return "stworę";
        if (name.includes("ifryt")) return "ifryta";
        if (name.includes("jack")) return "jacka";
        if (name.includes("helga")) return "helgę";
        if (name.includes("henry")) return "henryego";
        if (name.includes("eol")) return "eola";
        if (name.includes("grubber")) return "grubbera";
        if (name.includes("worundriel")) return "worundriela";
        if (name.includes("fistuła")) return "fistułę";
        if (name.includes("teściowa")) return "teściową";
        if (name.includes("amuno")) return "amuno";
        if (name.includes("fodug")) return "foduga";
        if (name.includes("asterus")) return "asterusa";
        if (name.includes("adariel")) return "adariel";
        if (name.includes("burkog")) return "burkoga";
        if (name.includes("sheba")) return "shebę";
        if (name.includes("shakkru")) return "shakkru";
        if (name.includes("władcy klanów")) return "ducha";
        if (name.includes("bragarth")) return "bragartha";
        if (name.includes("fursharag")) return "fursharaga";
        if (name.includes("ziuggrael")) return "ziuggraela";
        if (name.includes("lusgrathera")) return "królową pramatkę";
        if (name.includes("śniegu")) return "królową";
        if (name.includes("wrzosera")) return "wrzoserę";
        if (name.includes("chryzoprenia")) return "chryzkę";
        if (name.includes("cantedewia")) return "cantedewię";
        if (name.includes("ogr")) return "ogra";
        if (name.includes("torunia")) return "torunię";
        if (name.includes("pięknotka")) return "pięknotkę";
        if (name.includes("breheret")) return "brehereta";
        if (name.includes("cerasus")) return "cerasusa";
        if (name.includes("mysiur")) return "mysiura";
        if (name.includes("sadolia")) return "sadolię";
        if (name.includes("sataniel")) return "sataniela";
        if (name.includes("bergermona")) return "bergermonę";
        if (name.includes("annaniel")) return "annaniela";
        if (name.includes("gothardus")) return "gothardusa";
        if (name.includes("zufulus")) return "zufulusa";
        if (name.includes("furboli")) return "furbola";
        if (name.includes("arachniregina")) return "pająka";
        if (name.includes("mieczem")) return "rycerza";
        if (name.includes("ilythirahel")) return "aldiphrina";
        if (name.includes("malignitas")) return "marlotha";
        if (name.includes("arytodam")) return "arytodama";
        if (name.includes("maddoks")) return "maddoksa";
        if (name.includes("fangaj")) return "fangaja";
        if (name.includes("dendroculus")) return "dendro";
        if (name.includes("tolypeutes")) return "tolypeutesa";
        if (name.includes("citlalin")) return "cuaitla";
        if (name.includes("yaotl")) return "yaotla";
        if (name.includes("quetzalcoatl")) return "quetzala";
        if (name.includes("wabicielka")) return "wabicielkę";
        if (name.includes("sybilla")) return "sybillę";
        if (name.includes("chopesz")) return "chopesza";
        if (name.includes("neferkar")) return "seta";
        if (name.includes("terrozaur")) return "terro";
        if (name.includes("vaenra")) return "vaenrę";
        if (name.includes("chaegd")) return "chaegda";
        if (name.includes("nymphemonia")) return "nymfę";
        if (name.includes("artenius")) return "arteniusa";
        if (name.includes("furion")) return "furiona";
        if (name.includes("zorin")) return "zorina";
        return fullName.split(' ')[0].toLowerCase();
    }

    let _movementQueue = [];
    let _movementHome = null;
    let _isExecutingMovement = false;

    function isValidTile(x, y) {
        if (!window.Engine?.map?.d) return false;
        const w = window.Engine.map.d.w || 100;
        const h = window.Engine.map.d.h || 100;
        if (x < 0 || x >= w || y < 0 || y >= h) return false;
        if (window.Engine.map.isCol && window.Engine.map.isCol(x, y)) return false;
        return true;
    }

    async function executeMovementQueue() {
        if (_isExecutingMovement || _movementQueue.length === 0) return;
        _isExecutingMovement = true;

        while (_movementQueue.length > 0) {
            if (!botRunning || isInBattle() || currentTarget) {
                _movementQueue = [];
                break;
            }

            const nextPos = _movementQueue.shift();
            if (isValidTile(nextPos.x, nextPos.y)) {
                window.Engine.hero.autoGoTo(nextPos);
                // Czekamy na dojście (średnio 200-300ms na kratkę + margines bezpieczeństwa)
                await delay(800 + Math.random() * 600);
            }
            
            // Losowy odstęp czasowy między kolejnymi krokami (symulacja naturalnego zachowania)
            await delay(500 + Math.random() * 1000);
        }

        _isExecutingMovement = false;
    }

    function isPathClear(x1, y1, x2, y2) {
        const dx = Math.abs(x2 - x1);
        const dy = Math.abs(y2 - y1);
        const steps = Math.max(dx, dy);
        
        if (steps === 0) return true;

        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const cx = Math.round(x1 + (x2 - x1) * t);
            const cy = Math.round(y1 + (y2 - y1) * t);
            
            if (!isValidTile(cx, cy)) {
                return false;
            }
        }
        return true;
    }

    function walkToRandomNearPosition(range = 4) {
        // Zachowaj kompatybilność ze starymi wywołaniami (np. po walce)
        try {
            const hero = getHeroInfo();
            if (!hero) return;
            for (let i = 0; i < 20; i++) {
                const dist = Math.floor(Math.random() * (range - 2 + 1)) + 2;
                const angle = Math.random() * Math.PI * 2;
                const dx = Math.round(Math.cos(angle) * dist);
                const dy = Math.round(Math.sin(angle) * dist);
                const tx = hero.x + dx;
                const ty = hero.y + dy;

                if (isValidTile(tx, ty) && isPathClear(hero.x, hero.y, tx, ty)) {
                    log(`🚶 Losowy ruch anty-bot: idę na [${tx}, ${ty}]`, 'info');
                    window.Engine.hero.autoGoTo({ x: tx, y: ty });
                    break;
                }
            }
        } catch (e) {
            console.error('[E2H] walkToRandomNearPosition error:', e);
        }
    }

    function triggerAntiBanMovement() {
        try {
            const hero = getHeroInfo();
            if (!hero) return;

            // Ustaw pozycję startową (domową) jako bazę powrotu, jeśli jeszcze jej nie ma
            if (!_movementHome) {
                _movementHome = { x: hero.x, y: hero.y };
            }

            const rand = Math.random();
            const queue = [];

            if (rand < 0.35) {
                // Typ 1: Krok w losową stronę o 3 kratki (w górę, dół, lewo lub prawo) i powrót
                const directions = [
                    { dx: 0, dy: -3 }, // w górę
                    { dx: 0, dy: 3 },  // w dół
                    { dx: -3, dy: 0 }, // w lewo
                    { dx: 3, dy: 0 }   // w prawo
                ];
                const dir = directions[Math.floor(Math.random() * directions.length)];
                const stepX = _movementHome.x + dir.dx;
                const stepY = _movementHome.y + dir.dy;

                if (isValidTile(stepX, stepY) && isPathClear(_movementHome.x, _movementHome.y, stepX, stepY)) {
                    log(`🚶 [Anty-Bot] Krok w bok [${stepX}, ${stepY}] i powrót na pozycję główną [${_movementHome.x}, ${_movementHome.y}]`, 'info');
                    queue.push({ x: stepX, y: stepY });
                    queue.push({ x: _movementHome.x, y: _movementHome.y });
                }
            } else if (rand < 0.70) {
                // Typ 2: Spacer w kwadracie 3x3 lub 4x4 i powrót na pozycję główną
                const size = Math.random() < 0.5 ? 3 : 4;
                const hx = _movementHome.x;
                const hy = _movementHome.y;

                // Definiujemy wierzchołki kwadratu wokół pozycji domowej
                const path = [
                    { x: hx + size, y: hy },
                    { x: hx + size, y: hy + size },
                    { x: hx, y: hy + size },
                    { x: hx, y: hy } // powrót
                ];

                // Upewnij się, że cała ścieżka (krok po kroku) jest przejezdna i wolna od kolizji
                let pathOk = true;
                let lastPos = { x: hx, y: hy };
                for (const pos of path) {
                    if (!isValidTile(pos.x, pos.y) || !isPathClear(lastPos.x, lastPos.y, pos.x, pos.y)) {
                        pathOk = false;
                        break;
                    }
                    lastPos = pos;
                }

                if (pathOk) {
                    log(`🚶 [Anty-Bot] Spacer w kwadracie ${size}x${size} i powrót na pozycję główną`, 'info');
                    path.forEach(pos => queue.push(pos));
                }
            }

            // Jeśli nie wybrano żadnej powyższej lub ścieżka była zablokowana kolizjami, zrób zwykły losowy ruch
            if (queue.length === 0) {
                const range = 4;
                for (let i = 0; i < 20; i++) {
                    const dist = Math.floor(Math.random() * (range - 2 + 1)) + 2;
                    const angle = Math.random() * Math.PI * 2;
                    const dx = Math.round(Math.cos(angle) * dist);
                    const dy = Math.round(Math.sin(angle) * dist);
                    const tx = _movementHome.x + dx;
                    const ty = _movementHome.y + dy;

                    if (isValidTile(tx, ty) && isPathClear(_movementHome.x, _movementHome.y, tx, ty)) {
                        log(`🚶 [Anty-Bot] Krótki spacer i powrót na pozycję`, 'info');
                        queue.push({ x: tx, y: ty });
                        queue.push({ x: _movementHome.x, y: _movementHome.y });
                        break;
                    }
                }
            }

            if (queue.length > 0) {
                _movementQueue = queue;
                executeMovementQueue();
            }
        } catch (e) {
            console.error('[E2H] triggerAntiBanMovement error:', e);
        }
    }

    function getAiContextPrompt(nick) {
        const map = getMapInfo().name;
        const filter = cfg.e2NameFilter || 'wszystkie';
        const target = currentTarget ? currentTarget.nick : 'brak (szukam)';
        
        // Znajdź E2 przypisaną do tej mapy w bazie
        const mapLower = map.toLowerCase();
        const localE2 = E2_DATABASE.find(e => mapLower.includes(e.map.split(' - ')[0].split(' p.')[0].toLowerCase()) || e.map.toLowerCase().includes(mapLower));
        const localE2Text = localE2 ? `${localE2.name} (${localE2.lvl}lvl)` : 'brak znanej E2 na tej mapie';
        const localE2Colloquial = localE2 ? getColloquialE2Name(localE2.name) : 'e2';

        let context = `\n\n=== AKTUALNY STAN GRY (do Twojej wiadomości, nie przepisuj tego wprost, pisz jak człowiek) ===\n`;
        context += `- Stoisz na mapie: ${map}\n`;
        context += `- E2 na tej mapie: ${localE2Text}\n`;
        context += `- Twoje cele E2 (filtr bota): ${filter}\n`;
        context += `- Aktualnie atakujesz: ${target}\n`;
        context += `- Łącznie zabitych potworów w tej sesji: ${stats.kills}\n`;
        context += `- Łącznie zabitych Elit II (E2+): ${stats.e2Killed || 0}\n`;
        
        const uni = stats.uniDropped || 0;
        const hero = stats.heroDropped || 0;
        const leg = stats.legDropped || 0;
        context += `- Wypadło unikatów (uni): ${uni}\n`;
        context += `- Wypadło heroików (hero): ${hero}\n`;
        context += `- Wypadło legend (lega): ${leg}\n`;
        
        context += `\n=== WAŻNE INSTRUKCJE DOTYCZĄCE ODPOWIEDZI ===\n`;
        if (localE2) {
            context += `1. Ponieważ stoisz na mapie "${map}", Twoim jedynym celem, na który czekasz / stoisz / bijesz tutaj jest E2: "${localE2.name}". Potoczne nazwy tego bossa w bierniku/dopełniaczu to np. "${localE2Colloquial}".\n`;
            context += `2. Jeśli ktoś pyta "jaka e2", "na czym stoisz", "co bijesz", "co tu stoi", to odpowiadaj potocznie, np. "stoję na ${localE2Colloquial}", "czekam na ${localE2Colloquial}", "bije ${localE2Colloquial}", "${localE2Colloquial}".\n`;
            context += `3. NIGDY nie wymieniaj innych bossów z filtra (np. ${filter.split(',').slice(0, 3).join(', ')}), jeśli na tej mapie ich nie ma! To by zdradziło, że jesteś botem. Realny gracz stojąc na tej mapie interesuje się tylko "${localE2.name}".\n`;
        } else {
            context += `1. Stoisz na mapie bez przypisanej konkretnej E2, ale Twoje cele w filtrze to: ${filter}.\n`;
        }
        context += `4. Odpowiadaj bardzo krótko (maksymalnie jedno zdanie, parę słów), pisz luźno jak gracz np. "stoje na ${localE2 ? localE2Colloquial : 'e2'}", "czekam na bossa", "nic nie spada :/", "uni spadlo jedno").\n`;
        context += `5. Pisz z małej litery, bez kropek na końcu, bez myślników na początku, jak normalny gracz na czacie!`;
        
        return context;
    }

    function doLeaveBattle() {
        if (!cfg.autoLeave) return;
        try {
            if (typeof Engine.battle.leaveBattle === 'function') {
                Engine.battle.leaveBattle();
                return;
            }
            const leaveBtn = document.querySelector('.leave-battle-button, [class*="leave"][class*="battle"], #leaveBattleButton');
            if (leaveBtn) leaveBtn.click();
        } catch (e) {
            console.error('[E2H] leaveBattle error:', e);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  AUTO PATROLOwanie MAP
    // ═══════════════════════════════════════════════════════════════
    function doPatrolTransition() {
        const route = cfg.patrolRoute.split(',').map(s => s.trim().toLowerCase()).filter(s => s.length > 0);
        if (route.length < 2) {
            log('⚠️ Trasa patrolu jest zbyt krótka (wymagane min. 2 mapy)!', 'err');
            ticksOnEmptyMap = 0;
            return;
        }

        const currentMap = getMapInfo().name.toLowerCase();
        const currentIndex = route.indexOf(currentMap);
        if (currentIndex === -1) {
            log(`⚠️ Obecna mapa [${getMapInfo().name}] nie jest na liście trasy patrolu!`, 'err');
            ticksOnEmptyMap = 0;
            return;
        }

        if (currentIndex === route.length - 1) {
            routeDirection = -1;
        } else if (currentIndex === 0) {
            routeDirection = 1;
        }

        const nextMapName = route[currentIndex + routeDirection];
        log(`🔄 Patrol: szukam bramy do następnej mapy: [${nextMapName}]`, 'info');

        const gateways = scanGateways();
        const gate = gateways.find(g => g.name.toLowerCase().includes(nextMapName) || String(g.targetMapId) === nextMapName);

        if (gate) {
            phase = 'walking';
            log(`🚶 Przechodzę do bramy: [${gate.name}] (kordy: ${gate.tx}, ${gate.ty})`, 'warn');
            try {
                Engine.hero.autoGoTo({ x: gate.tx, y: gate.ty }, false);
                ticksOnEmptyMap = 0;
            } catch (e) {
                log(`❌ Błąd ruchu do bramy: ${e.message}`, 'err');
            }
        } else {
            log(`❌ Nie znaleziono przejścia do mapy: ${nextMapName}!`, 'err');
            ticksOnEmptyMap = 0;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  AUTO-RELOG (Minutnik)
    // ═══════════════════════════════════════════════════════════════
    function parseTimeToSeconds(timeStr) {
        if (!timeStr) return 999999;
        const clean = timeStr.replace(/[^\d:]/g, '');
        const parts = clean.split(':').map(Number);
        if (parts.some(isNaN)) return 999999;
        
        if (parts.length === 3) {
            return parts[0] * 3600 + parts[1] * 60 + parts[2];
        } else if (parts.length === 2) {
            return parts[0] * 60 + parts[1];
        } else if (parts.length === 1) {
            return parts[0];
        }
        return 999999;
    }

    let lastLootlogTimers = [];

    async function fetchLootlogTimers() {
        try {
            const host = window.location.hostname;
            const world = host.split('.')[0] || 'luvia';
            const res = await fetch(`https://api.lootlog.pl/timers?world=${encodeURIComponent(world)}`, {
                method: "GET",
                headers: { "Accept": "application/json" },
                cache: "no-store",
                credentials: "include"
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (Array.isArray(data)) {
                lastLootlogTimers = data;
                // Push timerów do runbot API (jeśli dostępny)
                if (window.MAW_NODE_API) {
                    fetch(`${window.MAW_NODE_API}/api/timers`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    }).catch(() => {});
                }
            }
        } catch (e) {
            console.error('[E2H] Błąd wczytywania LootLog timers:', e);
        }
    }

    function findCharacterForE2(e2Name) {
        // Czyść prefix [E2]/[E] gdyby ktoś wrzucił surową nazwę z minutnika
        const cleanE2Name = e2Name.replace(/^\[E2?\]\s*/i, '').trim();
        const e2 = E2_DATABASE.find(e => e.name.toLowerCase() === cleanE2Name.toLowerCase());
        if (!e2) {
            log(`⚠️ findCharacterForE2: Nie znaleziono E2 "${cleanE2Name}" w bazie danych!`, 'warn');
            return null;
        }
        
        const targetMap = e2.map.toLowerCase();
        
        // 1. Sprawdź najpierw w lokalnym rejestrze map postaci (zapisywanym na bieżąco w grze)
        for (const char of lastAccountCharacters) {
            const savedMap = localStorage.getItem(`e2h_char_map_${char.nick.toLowerCase()}`);
            if (savedMap) {
                const charMap = savedMap.toLowerCase();
                if (targetMap.includes(charMap) || charMap.includes(targetMap) || 
                    targetMap.split(' - ')[0].split(' p.')[0].includes(charMap.split(' - ')[0].split(' p.')[0])) {
                    return char;
                }
            }
        }
        
        // 2. Fallback na API konta
        for (const char of lastAccountCharacters) {
            // API charlist Margonem używa różnych nazw pola: mapName, map_name, location
            const charMap = (char.mapName || char.map_name || char.location || "").toLowerCase();
            if (charMap && (targetMap.includes(charMap) || charMap.includes(targetMap) || 
                targetMap.split(' - ')[0].split(' p.')[0].includes(charMap.split(' - ')[0].split(' p.')[0]))) {
                return char;
            }
        }
        log(`⚠️ findCharacterForE2: Brak postaci zaparkowanej na mapie "${e2.map}" (znaleziono ${lastAccountCharacters.length} postaci na koncie)`, 'warn');
        return null;
    }

    function findVisibleWatcherMob(name) {
        if (!name || !window.g || !g.npc) return null;
        const target = name.trim().toLowerCase();
        for (const id in g.npc) {
            const n = g.npc[id];
            if (!n) continue;
            const npcName = String(n.nick || n.name || "").trim().toLowerCase();
            if (npcName.includes(target) || target.includes(npcName)) {
                return n;
            }
        }
        return null;
    }

    function getLocalE2ForMap(mapName) {
        if (!mapName) return null;
        const nameLower = mapName.toLowerCase().trim();
        
        for (const e2 of E2_DATABASE) {
            const e2MapLower = e2.map.toLowerCase().trim();
            if (nameLower === e2MapLower || nameLower.includes(e2MapLower) || e2MapLower.includes(nameLower)) {
                return e2;
            }
            const simplifiedE2Map = e2MapLower.split(' - ')[0].split(' p.')[0].trim();
            const simplifiedCurrentMap = nameLower.split(' - ')[0].split(' p.')[0].trim();
            if (simplifiedCurrentMap.length > 5 && simplifiedE2Map.length > 5) {
                if (simplifiedCurrentMap.includes(simplifiedE2Map) || simplifiedE2Map.includes(simplifiedCurrentMap)) {
                    return e2;
                }
            }
        }
        return null;
    }

    let lastAccountCharacters = [];

    async function fetchAccountCharacters() {
        try {
            const hs3Cookie = document.cookie.match(/hs3=([^;]+)/)?.[1] || 'UgU';
            const res = await fetch(`https://public-api.margonem.pl/account/charlist?hs3=${encodeURIComponent(hs3Cookie)}`, {
                method: "GET",
                headers: { "Accept": "application/json" },
                cache: "no-store",
                credentials: "include"
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (Array.isArray(data)) {
                lastAccountCharacters = data;
                log(`👥 Wczytano listę postaci (${lastAccountCharacters.length} postaci)`, 'info');
                // Push listy postaci do runbot API
                if (window.MAW_NODE_API) {
                    fetch(`${window.MAW_NODE_API}/api/chars`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    }).catch(() => {});
                }
            }
        } catch (e) {
            console.error('[E2H] Błąd wczytywania postaci:', e);
        }
    }

    function pushStatsToServer() {
        if (!window.MAW_NODE_API) return;
        const hero = getHeroInfo();
        if (!hero || !hero.nick || hero.nick === '?') return;
        const payload = {
            nick:       hero.nick,
            leg:        stats.legDropped   || 0,
            hero:       stats.heroDropped  || 0,
            uni:        stats.uniDropped   || 0,
            kills:      stats.kills        || 0,
            e2kills:    stats.e2Killed     || 0,
            expGained:  stats.expGained    || 0,
            goldGained: stats.goldGained   || 0,
        };
        fetch(`${window.MAW_NODE_API}/api/drops`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(() => {});
        // Push stanu (hp, mapa, faza)
        const mapInfo = getMapInfo();
        const statePayload = {
            hero: {
                name: hero.nick,
                lvl:  hero.lvl,
                hp:   hero.hp,
                maxHp: hero.maxHp,
                x: hero.x,
                y: hero.y,
                mapName: mapInfo.name,
                mapId:   mapInfo.id,
            },
            phase,
            botRunning,
            timestamp: Date.now()
        };
        fetch(`${window.MAW_NODE_API}/api/state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(statePayload)
        }).catch(() => {});
    }

    function relogToCharacter(charName) {
        if (!charName) return false;
        if (!lastAccountCharacters || lastAccountCharacters.length === 0) {
            fetchAccountCharacters();
            return false;
        }

        const char = lastAccountCharacters.find(c => c.nick.toLowerCase() === charName.toLowerCase());
        if (!char) {
            log(`⚠️ Nie znaleziono postaci o nicku: ${charName} na liście konta.`, 'warn');
            return false;
        }

        const targetHeroId = char.id;
        const host = window.location.hostname;
        const world = char.world || host.split('.')[0] || 'luvia';

        log(`🔄 Przelogowywanie ciasteczkiem na postać: ${char.nick} (ID: ${targetHeroId}, Świat: ${world})`, 'warn');

        localStorage.setItem('e2h_target_char', char.nick);
        localStorage.setItem('e2h_target_char_time', Date.now().toString());

        document.cookie = `mchar_id=${targetHeroId}; domain=.margonem.pl; path=/`;
        window.location.href = `https://${world}.margonem.pl`;
        return true;
    }

    function checkMinutnikAndRelog() {
        if (!cfg.autoRelog) return false;
        if (isInBattle()) return false;
        if (document.querySelector('.loot-window')) return false;

        const mapInfo = getMapInfo();
        if (!mapInfo || mapInfo.name === '?' || !mapInfo.name) return false;

        // 1. Obsługa okna wylogowywania (log-off-wnd)
        const logOffWnd = document.querySelector('.log-off-wnd, .log-off');
        if (logOffWnd) {
            const timeToOutEl = logOffWnd.querySelector('.time-to-out');
            if (timeToOutEl) {
                const text = timeToOutEl.textContent || "";
                const match = text.match(/przelogowanie na Postać ([^\(]+)/i) || text.match(/przelogowanie na Postać ([^\n]+)/i);
                if (match) {
                    const charName = match[1].split('(')[0].trim();
                    if (relogToCharacter(charName)) {
                        return true;
                    }
                }
            }

            const relogBtn = Array.from(logOffWnd.querySelectorAll('.button, .btn'))
                .find(btn => btn.textContent.includes('Przeloguj'));
            if (relogBtn && window.getComputedStyle(relogBtn).display !== 'none') {
                log('🔄 Klikam [Przeloguj] w oknie wylogowywania...', 'warn');
                relogBtn.click();
                _lastRelogClickTime = Date.now();
                return true;
            }
            return true; // W trakcie wylogowywania nie rób nic innego
        }

        // Blokada po kliknięciu relogu, aby system zdążył zareagować i się wylogować
        if (Date.now() - _lastRelogClickTime < 15000) return true;

        const timerItems = [];
        const now = Date.now();

        // 1. (LootLog API wyłączone — używamy wyłącznie Minutnika z DOM zgodnie z życzeniem)

        // 2. Szukamy okna minutnika jako uzupełnienie
        const timerWnd = document.querySelector('.elite-timer, .elite-timer-wnd');
        if (timerWnd) {
            const rows = timerWnd.querySelectorAll('.npc-list .row, .list .row');
            rows.forEach(row => {
                const nameEl = row.querySelector('.name-val');
                const timeEl = row.querySelector('.time-val');
                if (nameEl && timeEl) {
                    const rawName = nameEl.textContent || "";
                    const cleanName = rawName.replace(/\[E2\]|\[E\]/gi, '').trim();
                    if (!cleanName || cleanName.toLowerCase() === 'e2' || cleanName.toLowerCase() === 'e') return;
                    
                    const exists = timerItems.some(item => item.name.toLowerCase() === cleanName.toLowerCase());
                    if (!exists) {
                        const timeStr = (timeEl.textContent || "").trim();
                        const seconds = parseTimeToSeconds(timeStr);
                        timerItems.push({
                            rowEl: row,
                            name: cleanName,
                            timeStr: timeStr,
                            seconds: seconds,
                            isApi: false
                        });
                    }
                }
            });
        }

        if (timerItems.length === 0) return false;

        // Znajdź E2 powiązaną z naszą obecną mapą
        const localE2 = getLocalE2ForMap(mapInfo.name);

        // 3. Sprawdzamy czy nasza lokalna E2 ma timer 0 i czy nie ma jej na mapie przez 30 sekund
        if (localE2) {
            const localTimerItem = timerItems.find(item => item.name.toLowerCase() === localE2.name.toLowerCase());
            const mobs = scanMobs();
            const localE2Spawned = mobs.some(m => m.nick.toLowerCase().includes(localE2.name.toLowerCase())) ||
                                   !!findVisibleWatcherMob(localE2.name);

            if (localTimerItem && localTimerItem.seconds <= 0) {
                if (!localE2Spawned) {
                    if (!_localE2TimerZeroTime) {
                        _localE2TimerZeroTime = Date.now();
                        log(`⏱️ Uruchamiam licznik 30s oczekiwania na spawn E2: ${localE2.name}`, 'info');
                    } else if (Date.now() - _localE2TimerZeroTime > 30000) {
                        log(`⏱️ E2 ${localE2.name} nie zrespiła się w ciągu 30s. Przełączam na inną E2.`, 'warn');
                        
                        // Znajdź inną E2 z najkrótszym czasem respu
                        const otherItems = timerItems.filter(item => item.name.toLowerCase() !== localE2.name.toLowerCase());
                        if (otherItems.length > 0) {
                            otherItems.sort((a, b) => a.seconds - b.seconds);
                            const nextTarget = otherItems[0];
                            log(`🔄 Przełączam na: ${nextTarget.name} (resp za ${nextTarget.timeStr})`, 'warn');
                            
                            const matchedChar = findCharacterForE2(nextTarget.name);
                            if (matchedChar && relogToCharacter(matchedChar.nick)) {
                                _localE2TimerZeroTime = null;
                                return true;
                            } else if (nextTarget.rowEl) {
                                log(`🔄 Sygnalizuję Puppeteerowi relog na: ${nextTarget.name}`, 'warn');
                                localStorage.setItem('e2h_relog_e2name', nextTarget.name);
                                localStorage.setItem('e2h_relog_e2name_time', Date.now().toString());
                                _lastRelogClickTime = Date.now();
                                _localE2TimerZeroTime = null;
                                return true;
                            }
                        }
                    }
                } else {
                    _localE2TimerZeroTime = null;
                }
            } else {
                _localE2TimerZeroTime = null;
            }
        }

        // 4. Szukamy najkrótszego czasu respu
        timerItems.sort((a, b) => a.seconds - b.seconds);
        const shortest = timerItems[0];

        // Sprawdzamy czy najkrótsza E2 to ta, na której aktualnie stoimy
        if (localE2 && shortest.name.toLowerCase() === localE2.name.toLowerCase()) {
            return false;
        }

        // Jeśli czas pozostały do respu najkrótszej E2 wynosi <= cfg.relogSecondsBefore sekund, przelogowujemy!
        if (shortest.seconds <= cfg.relogSecondsBefore) {
            log(`🔄 Wykryto bliski respawn E2: ${shortest.name} (${shortest.timeStr}). Przelogowuję...`, 'warn');
            
            const matchedChar = findCharacterForE2(shortest.name);
            if (matchedChar && relogToCharacter(matchedChar.nick)) {
                return true;
            } else if (shortest.rowEl) {
                log(`🔄 Sygnalizuję Puppeteerowi relog na: ${shortest.name} (${shortest.timeStr})`, 'warn');
                localStorage.setItem('e2h_relog_e2name', shortest.name);
                localStorage.setItem('e2h_relog_e2name_time', Date.now().toString());
                _lastRelogClickTime = Date.now();
                return true;
            }
        }

        return false;
    }

    // ═══════════════════════════════════════════════════════════════
    //  GŁÓWNA PĘTLA BOTA (Najlepsza logika bicia i podnoszenia lootu)
    // ═══════════════════════════════════════════════════════════════
    function botTick() {
        if (!botRunning) return;

        try {
            // OBSŁUGA AUTO-RELAGOWANIA Z MINUTNIKA
            if (checkMinutnikAndRelog()) return;

            // OBSŁUGA LOOTU (Najlepsza logika z klawiszem F)
            scanLootFromDom();

            if (window.g?.loot && window.g.loot.id !== _lastLootId) {
                _lastLootId = window.g.loot.id;
                log('🎁 Wykryto loot! Podnoszę...', 'ok');
                processLootItems(window.g.loot);
                setTimeout(() => { 
                    if (window.Engine?.keyHandler) {
                        window.Engine.keyHandler.down(70); 
                        setTimeout(() => window.Engine.keyHandler.up(70), 50); 
                    }
                }, 300);
                return;
            }

            // OBSŁUGA WALKI
            if (isInBattle()) {
                phase = 'fighting';
                doAutoFight();

                // Sprawdzamy typ walki w trakcie jej trwania, bo na koniec informacje mogą zniknąć
                if (!window._currentBattleIsE2) {
                    window._currentBattleIsE2 = checkBattleType();
                }

                if (isBattleOver()) {
                    if (!_battleProcessed) {
                        _battleProcessed = true;
                        
                        const won = didHeroWinBattle();
                        if (won) {
                            stats.kills++;
                            if (window._currentBattleIsE2) {
                                stats.e2Killed = (stats.e2Killed || 0) + 1;
                                log(`🏆 Pokonałeś E2+! (Razem zabitych E2+: ${stats.e2Killed})`, 'info');
                                _needToWalkAway = true;
                            } else {
                                log(`✅ Walka wygrana! (zabito: ${stats.kills})`, 'ok');
                            }
                        } else {
                            log(`❌ Walka przegrana! Nie doliczono zabójstwa.`, 'warn');
                        }

                        window._currentBattleIsE2 = false; // Reset na koniec walki

                        const hero = getHeroInfo();
                        if (hero) {
                            const expNow = hero.exp;
                            const goldNow = hero.gold;
                            if (stats.startExp > 0 && expNow > 0) {
                                stats.expGained = expNow - stats.startExp;
                            }
                            if (stats.startGold > 0 && goldNow > 0) {
                                stats.goldGained = goldNow - stats.startGold;
                            }
                        }
                        setTimeout(() => renderAll(), 1000);
                    }
                    doLeaveBattle();
                    currentTarget = null;
                    phase = 'idle';
                }
                renderAll();
                return;
            } else {
                _battleProcessed = false;
            }

            if (_lockBot) return;

            // Monitorowanie zmiany mapy
            const mapInfo = getMapInfo();
            if (mapInfo.id !== lastMapId) {
                lastMapId = mapInfo.id;
                ticksOnEmptyMap = 0;
                log(`🗺️ Załadowano mapę: ${mapInfo.name}`, 'info');
                
                // Zresetuj pozycję domową i kolejkę ruchów przy zmianie mapy
                _movementHome = null;
                _movementQueue = [];
                
                // Zapisz mapę dla aktualnej postaci w localStorage (do natychmiastowego relogu ciasteczkowego)
                const hero = getHeroInfo();
                if (hero && hero.nick && hero.nick !== '?' && mapInfo.name && mapInfo.name !== '?') {
                    localStorage.setItem(`e2h_char_map_${hero.nick.toLowerCase()}`, mapInfo.name);
                }
            }

            // Szukaj celów
            phase = 'scanning';
            const mobs = scanMobs();
            const hero = getHeroInfo();
            if (!hero) return;

            // Filtruj moby wg ustawień
            const targets = mobs.filter(m => {
                if (!isTargetRank(m.rank)) return false;
                if (m.lvl < cfg.minLvl || m.lvl > cfg.maxLvl) return false;
                if (m.dist > cfg.maxRange) return false;

                // Nazwy (filtr ręczny lub preset)
                if (cfg.e2NameFilter) {
                    const filters = cfg.e2NameFilter.split(',').map(f => f.trim().toLowerCase()).filter(f => f.length > 0);
                    if (filters.length > 0) {
                        const mobName = m.nick.toLowerCase();
                        const matches = filters.some(f => mobName.includes(f));
                        if (!matches) return false;
                    }
                }
                return true;
            });

            // Brak mobów
            if (targets.length === 0) {
                if (currentTarget) {
                    const isE2 = PRESETS["ALL ELITES II"].toLowerCase().includes(currentTarget.nick.toLowerCase());
                    if (isE2) {
                        log(`⚠️ E2 (${currentTarget.nick}) zniknęła z mapy (ktoś ubił lub my).`, 'info');
                        _needToWalkAway = true;
                    }
                }
                currentTarget = null;

                if (cfg.autoPatrol) {
                    ticksOnEmptyMap++;
                    phase = 'patrol_wait';
                    log(`⏳ Brak celów na mapie. Czekam... (${ticksOnEmptyMap}/${cfg.maxTicksBeforeChange})`, 'info');
                    if (ticksOnEmptyMap >= cfg.maxTicksBeforeChange) {
                        doPatrolTransition();
                    }
                } else {
                    phase = 'idle';

                    if (_needToWalkAway) {
                        _needToWalkAway = false;
                        _lastTimeMoved = Date.now();
                        const delayTime = 1500 + Math.random() * 2000;
                        setTimeout(() => {
                            if (!isInBattle() && botRunning && phase === 'idle') {
                                walkToRandomNearPosition(5);
                                // Ustaw nową bezpieczną pozycję stojącą jako pozycję domową po odejściu ze spawnu
                                setTimeout(() => {
                                    const hero = getHeroInfo();
                                    if (hero && hero.nick !== '?') {
                                        _movementHome = { x: hero.x, y: hero.y };
                                    }
                                }, 2500);
                            }
                        }, delayTime);
                    } else if (Date.now() - _lastTimeMoved > (75 + Math.random() * 90) * 1000) {
                        _lastTimeMoved = Date.now();
                        if (botRunning && !isInBattle() && phase === 'idle') {
                            triggerAntiBanMovement();
                        }
                    }
                }
                renderAll();
                return;
            }

            // Wybierz najlepszy cel
            const target = targets[0];
            currentTarget = target;
            ticksOnEmptyMap = 0;

            // Powiadom o E2+
            const prio = getRankPriority(target.rank);
            if (prio >= 3 && cfg.showNotif) {
                showE2Notification(target);
            }
            if (prio >= 3 && cfg.soundAlert) {
                playAlertSound();
            }
            if (prio >= 3) {
                stats.e2Found++;
            }

            // Najlepsza logika ataku:
            // Jeśli odległość wynosi <= 1 pole, atakujemy bezpośrednio
            if (target.dist <= 1) {
                _lockBot = true;
                phase = 'fighting';
                log(`⚔️ Atak bezpośredni: ${target.nick}`, 'warn');
                
                // Losowe opóźnienie reakcji (80-320ms) - symuluje ludzki czas reakcji
                const attackDelay = 80 + Math.random() * 240;
                setTimeout(() => {
                    const heroObj = window.Engine.hero;
                    if (heroObj && heroObj.heroAtackRequest) {
                        heroObj.heroAtackRequest(target.id);
                    } else if (target.npc && typeof target.npc.onMouseClick === 'function') {
                        target.npc.onMouseClick();
                    }
                    setTimeout(() => _lockBot = false, 600 + Math.random() * 300);
                }, attackDelay);
            } else {
                // Losowe opóźnienie przed ruchem (50-180ms) - symuluje czas decyzji
                const walkDelay = 50 + Math.random() * 130;
                setTimeout(() => {
                    phase = 'walking';
                    log(`🎯 Podróż do: ${target.nick} [${target.x}, ${target.y}] dist: ${target.dist}`, 'hi');
                    window.Engine.hero.autoGoTo({ x: target.x, y: target.y });
                }, walkDelay);
            }

        } catch (e) {
            console.error('[E2H] botTick error:', e);
            log(`❌ Błąd: ${e.message}`, 'err');
        }

        renderAll();
    }

    // ═══════════════════════════════════════════════════════════════
    //  VISUAL OVERLAYS (Highlight E2 & Path)
    // ═══════════════════════════════════════════════════════════════
    let _visualsLoopActive = false;

    function getCameraOffset() {
        if (window.g && window.g.vx !== undefined) {
            return { x: window.g.vx, y: window.g.vy };
        }
        if (window.Engine?.map) {
            const m = window.Engine.map;
            if (m.offset && typeof m.offset[0] === 'number') {
                return { x: m.offset[0], y: m.offset[1] };
            }
            if (m.x !== undefined && m.y !== undefined) {
                return { x: m.x, y: m.y };
            }
            if (window.Engine.viewport) {
                const vp = window.Engine.viewport;
                if (vp.offset && typeof vp.offset[0] === 'number') {
                    return { x: vp.offset[0], y: vp.offset[1] };
                }
                if (vp.x !== undefined) {
                    return { x: vp.x, y: vp.y };
                }
            }
        }
        try {
            const hero = window.Engine?.hero?.d;
            const canvas = document.getElementById('re-main-map') || document.querySelector('.re-map-canvas') || document.querySelector('canvas');
            if (hero && canvas) {
                const w = canvas.clientWidth || 800;
                const h = canvas.clientHeight || 600;
                return {
                    x: hero.x * 32 - w / 2 + 16,
                    y: hero.y * 32 - h / 2 + 16
                };
            }
        } catch {}
        return { x: 0, y: 0 };
    }

    function initVisuals() {
        let parent = document.getElementById('re-main-map') || document.querySelector('.re-map-canvas') || document.getElementById('gw') || document.getElementById('game');
        if (!parent) return null;

        let canvas = document.getElementById('e2h-visual-overlay');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'e2h-visual-overlay';
            canvas.style.position = 'absolute';
            canvas.style.left = '0';
            canvas.style.top = '0';
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            canvas.style.pointerEvents = 'none';
            canvas.style.zIndex = '9999';
            parent.appendChild(canvas);
        }
        
        const rect = parent.getBoundingClientRect();
        if (canvas.width !== rect.width || canvas.height !== rect.height) {
            canvas.width = rect.width;
            canvas.height = rect.height;
        }
        
        return canvas;
    }

    function drawVisuals() {
        const canvas = initVisuals();
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const cam = getCameraOffset();
        const hero = getHeroInfo();
        if (!hero) return;

        const mobs = scanMobs();
        
        mobs.forEach(mob => {
            const prio = getRankPriority(mob.rank);
            const isE2 = prio >= 3 || PRESETS["ALL ELITES II"].toLowerCase().includes(mob.nick.toLowerCase());
            if (!isE2) return;

            const isTarget = currentTarget && currentTarget.id === mob.id;
            
            const screenX = mob.x * 32 - cam.x + 16;
            const screenY = mob.y * 32 - cam.y + 16;

            if (screenX < -50 || screenX > canvas.width + 50 || screenY < -50 || screenY > canvas.height + 50) return;

            ctx.save();
            ctx.beginPath();
            ctx.arc(screenX, screenY, 24, 0, Math.PI * 2);
            ctx.lineWidth = 3;
            
            if (isTarget) {
                const pulse = 0.6 + 0.4 * Math.sin(Date.now() / 200);
                ctx.strokeStyle = `rgba(239, 68, 68, ${pulse})`;
                ctx.fillStyle = `rgba(239, 68, 68, ${0.15 * pulse})`;
            } else {
                ctx.strokeStyle = 'rgba(59, 130, 246, 0.7)';
                ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
            }
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            ctx.save();
            ctx.font = 'bold 11px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            
            ctx.fillStyle = 'black';
            ctx.fillText(`${mob.nick} (${mob.lvl} lvl)`, screenX + 1, screenY - 24 + 1);
            ctx.fillText(`${mob.nick} (${mob.lvl} lvl)`, screenX - 1, screenY - 24 - 1);
            
            ctx.fillStyle = isTarget ? '#f59e0b' : '#3b82f6';
            ctx.fillText(`${mob.nick} (${mob.lvl} lvl)`, screenX, screenY - 24);
            ctx.restore();
        });

        if (currentTarget) {
            const heroScreenX = hero.x * 32 - cam.x + 16;
            const heroScreenY = hero.y * 32 - cam.y + 16;
            const targetScreenX = currentTarget.x * 32 - cam.x + 16;
            const targetScreenY = currentTarget.y * 32 - cam.y + 16;

            ctx.save();
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.setLineDash([6, 6]);
            
            const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 250);
            ctx.strokeStyle = `rgba(245, 158, 11, ${pulse})`;

            let drawStraight = true;
            try {
                const road = window.Engine?.hero?.road || window.Engine?.hero?.path;
                if (Array.isArray(road) && road.length > 0) {
                    ctx.beginPath();
                    ctx.moveTo(heroScreenX, heroScreenY);
                    
                    road.forEach(pt => {
                        const px = pt.x * 32 - cam.x + 16;
                        const py = pt.y * 32 - cam.y + 16;
                        ctx.lineTo(px, py);
                    });
                    
                    ctx.lineTo(targetScreenX, targetScreenY);
                    ctx.stroke();
                    drawStraight = false;
                }
            } catch (e) {}

            if (drawStraight) {
                ctx.beginPath();
                ctx.moveTo(heroScreenX, heroScreenY);
                ctx.lineTo(targetScreenX, targetScreenY);
                ctx.stroke();
            }
            ctx.restore();
        }
    }

    function startVisualsLoop() {
        if (_visualsLoopActive) return;
        _visualsLoopActive = true;
        
        function drawFrame() {
            if (!botRunning) {
                clearVisuals();
                _visualsLoopActive = false;
                return;
            }
            
            try {
                drawVisuals();
            } catch (e) {
                console.error('[E2H] drawVisuals error:', e);
            }
            
            requestAnimationFrame(drawFrame);
        }
        
        requestAnimationFrame(drawFrame);
    }

    function clearVisuals() {
        const canvas = document.getElementById('e2h-visual-overlay');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  HARMONOGRAM (SCHEDULE)
    // ═══════════════════════════════════════════════════════════════
    let _scheduleWatchdogTimer = null;

    function parseTimeToMinutes(timeStr) {
        // "HH:MM" -> minuty od północy; obsługa "24:00" jako 1440
        const [h, m] = timeStr.trim().split(':').map(Number);
        if (isNaN(h) || isNaN(m)) return null;
        return Math.min(h * 60 + m, 1440);
    }

    function isScheduleActive() {
        if (!cfg.scheduleEnabled) return null; // null = harmonogram wyłączony (nie blokuje)
        const slotStr = cfg.scheduleSlots || '';
        const slots = slotStr.split(',').map(s => s.trim()).filter(s => s);

        if (slots.length === 0) return false;

        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();

        for (const slot of slots) {
            const parts = slot.split('-');
            if (parts.length !== 2) continue;
            const startMin = parseTimeToMinutes(parts[0]);
            const endMin = parseTimeToMinutes(parts[1]);
            if (startMin === null || endMin === null) continue;

            if (currentMinutes >= startMin && currentMinutes < endMin) {
                return true;
            }
        }
        return false;
    }

    function updateScheduleStatus() {
        const statusEl = document.getElementById('e2h-schedule-status');
        const nextEl = document.getElementById('e2h-schedule-next');
        if (!statusEl) return;

        if (!cfg.scheduleEnabled) {
            statusEl.style.color = '#64748b';
            statusEl.textContent = '⏸ Harmonogram wyłączony';
            if (nextEl) nextEl.textContent = '';
            return;
        }

        const active = isScheduleActive();
        const now = new Date();
        const nowStr = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });

        if (active) {
            statusEl.style.color = '#34d399';
            statusEl.textContent = `✅ BOT POWINIEN DZIAŁAĆ (teraz ${nowStr})`;
        } else {
            statusEl.style.color = '#f87171';
            statusEl.textContent = `⛔ BOT POWINIEN STAĆ (teraz ${nowStr})`;
        }

        // Znajdź następne zdarzenie (start lub stop)
        if (nextEl && cfg.scheduleSlots) {
            const slots = cfg.scheduleSlots.split(',').map(s => s.trim()).filter(s => s);
            const currentMinutes = now.getHours() * 60 + now.getMinutes();
            let nearest = null;
            let nearestLabel = '';

            for (const slot of slots) {
                const parts = slot.split('-');
                if (parts.length !== 2) continue;
                const startMin = parseTimeToMinutes(parts[0]);
                const endMin = parseTimeToMinutes(parts[1]);
                if (startMin === null || endMin === null) continue;

                if (startMin > currentMinutes && (nearest === null || startMin < nearest)) {
                    nearest = startMin;
                    nearestLabel = `▶ Start za ${startMin - currentMinutes} min (${parts[0]})`;
                }
                if (endMin > currentMinutes && (nearest === null || endMin < nearest)) {
                    nearest = endMin;
                    nearestLabel = `⏹ Stop za ${endMin - currentMinutes} min (${parts[1]})`;
                }
            }
            nextEl.textContent = nearestLabel || '(brak zaplanowanych akcji dzisiaj)';
        }
    }

    function startScheduleWatchdog() {
        if (_scheduleWatchdogTimer) clearInterval(_scheduleWatchdogTimer);

        _scheduleWatchdogTimer = setInterval(() => {
            if (!cfg.scheduleEnabled) return;

            const active = isScheduleActive();
            updateScheduleStatus();

            if (active && !botRunning) {
                log('⏰ [Harmonogram] Wchodzę w zakres godzinowy → Startuję bota!', 'ok');
                startBot();
            } else if (active === false && botRunning) {
                log('⏰ [Harmonogram] Wychodzę poza zakres godzinowy → Zatrzymuję bota!', 'warn');
                stopBot();
            }
        }, 30000); // co 30 sekund

        log('⏰ Watchdog harmonogramu uruchomiony (co 30s)', 'info');
    }

    // ═══════════════════════════════════════════════════════════════
    //  BOT START / STOP
    // ═══════════════════════════════════════════════════════════════

    function startBot() {
        if (botRunning) return;
        botRunning = true;
        cfg.botEnabled = true;
        saveCfg();

        const hero = getHeroInfo();
        if (hero) {
            stats.startTime = Date.now();
            stats.startExp = hero.exp;
            stats.startGold = hero.gold;
            stats.kills = 0;
            stats.e2Found = 0;
            stats.e2Killed = 0;
            stats.expGained = 0;
            stats.goldGained = 0;
            stats.legDropped = 0;
            stats.heroDropped = 0;
            stats.uniDropped = 0;
        }

        log('🟢 Bot E2 Hunter AKTYWNY!', 'ok');
        ticksOnEmptyMap = 0;
        _lockBot = false;

        // Zamiast stałego setInterval (400ms = wykrywalny wzorzec),
        // używamy self-schedulingowego setTimeout z losowym jitterem (+/- 75ms)
        function scheduleNextTick() {
            if (!botRunning) return;
            const jitter = Math.floor((Math.random() - 0.5) * 150); // -75 to +75ms
            const delay = 400 + jitter;
            botTickTimer = setTimeout(() => {
                botTick();
                scheduleNextTick();
            }, delay);
        }
        scheduleNextTick();

        // Auto-fight również z jitterem
        function scheduleAutoFight() {
            if (!botRunning) return;
            const jitter = Math.floor((Math.random() - 0.5) * 80);
            const delay = 300 + jitter;
            autoFTimer = setTimeout(() => {
                doAutoFight();
                scheduleAutoFight();
            }, delay);
        }
        scheduleAutoFight();

        // Fake mouse movement na canvasie gry co 15-45 sekund
        function scheduleFakeMouseMove() {
            if (!botRunning) { _acFakeMouseTimer = null; return; }
            const delay = (15 + Math.random() * 30) * 1000;
            _acFakeMouseTimer = setTimeout(() => {
                try {
                    const canvas = document.querySelector('#gw canvas, #game canvas, canvas');
                    if (canvas) {
                        const rect = canvas.getBoundingClientRect();
                        const cx = rect.left + rect.width * (0.3 + Math.random() * 0.4);
                        const cy = rect.top + rect.height * (0.3 + Math.random() * 0.4);
                        const steps = 3 + Math.floor(Math.random() * 4);
                        for (let i = 0; i <= steps; i++) {
                            setTimeout(() => {
                                canvas.dispatchEvent(new MouseEvent('mousemove', {
                                    bubbles: true, cancelable: true,
                                    clientX: cx + (Math.random() - 0.5) * 20,
                                    clientY: cy + (Math.random() - 0.5) * 20,
                                }));
                            }, i * (50 + Math.random() * 50));
                        }
                    }
                } catch (e) {}
                scheduleFakeMouseMove();
            }, delay);
        }
        scheduleFakeMouseMove();

        startVisualsLoop();
        renderAll();
    }

    function stopBot() {
        botRunning = false;
        cfg.botEnabled = false;
        saveCfg();
        if (botTickTimer) { clearTimeout(botTickTimer); botTickTimer = null; }
        if (autoFTimer) { clearTimeout(autoFTimer); autoFTimer = null; }
        if (_acFakeMouseTimer) { clearTimeout(_acFakeMouseTimer); _acFakeMouseTimer = null; }
        phase = 'idle';
        currentTarget = null;
        clearVisuals();
        log('🔴 Bot ZATRZYMANY', 'err');
        renderAll();
    }

    // ═══════════════════════════════════════════════════════════════
    //  SOUND ALERT
    // ═══════════════════════════════════════════════════════════════
    let lastSoundTime = 0;
    function playAlertSound() {
        const now = Date.now();
        if (now - lastSoundTime < 10000) return;
        lastSoundTime = now;
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            [523, 659, 784, 1047].forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.value = freq;
                osc.type = 'sine';
                gain.gain.value = 0.15;
                osc.start(ctx.currentTime + i * 0.12);
                osc.stop(ctx.currentTime + i * 0.12 + 0.1);
            });
        } catch {}
    }

    // ═══════════════════════════════════════════════════════════════
    //  E2 NOTIFICATION
    // ═══════════════════════════════════════════════════════════════
    let notifTimer = null;
    function showE2Notification(mob) {
        let el = document.getElementById('e2h-notif');
        if (!el) {
            el = document.createElement('div');
            el.id = 'e2h-notif';
            document.body.appendChild(el);
        }
        el.innerHTML = `
            <div class="e2h-notif-icon">${getRankLabel(mob.rank).split(' ')[0]}</div>
            <div class="e2h-notif-body">
                <div class="e2h-notif-title">ZNALEZIONO ${mob.rank.toUpperCase()}!</div>
                <div class="e2h-notif-info">${mob.nick} (${mob.lvl} lvl) — ${getMapInfo().name}</div>
                <div class="e2h-notif-coords">[${mob.x}, ${mob.y}] — ${mob.dist} pól</div>
            </div>`;
        el.classList.add('show');
        if (notifTimer) clearTimeout(notifTimer);
        notifTimer = setTimeout(() => el.classList.remove('show'), 5000);
    }

    // ═══════════════════════════════════════════════════════════════
    //  BATTLE STATUS
    // ═══════════════════════════════════════════════════════════════
    function updateBattleStatus(mode) {
        const el = document.getElementById('e2h-battle-status');
        if (!el) return;
        if (mode === 'fast') { el.textContent = '⚡ SZYBKA (dobijanie)'; el.className = 'e2h-bs fast'; }
        else if (mode === 'tour') { el.textContent = '🛡️ TUROWA (heal)'; el.className = 'e2h-bs tour'; }
        else if (mode === 'fight') { el.textContent = '⚔️ AUTO-FIGHT'; el.className = 'e2h-bs fight'; }
        else { el.textContent = '💤 Oczekiwanie'; el.className = 'e2h-bs idle'; }
    }

    // ═══════════════════════════════════════════════════════════════
    //  STATS HELPERS
    // ═══════════════════════════════════════════════════════════════
    function getUptime() {
        if (!stats.startTime) return '0:00';
        const s = Math.floor((Date.now() - stats.startTime) / 1000);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
        return `${m}:${String(sec).padStart(2,'0')}`;
    }

    function getRate(val) {
        if (!stats.startTime) return 0;
        const h = (Date.now() - stats.startTime) / 3600000;
        if (h < 0.001) return 0;
        return Math.round(val / h);
    }

    function fmtNum(n) {
        if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
        if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
        return String(n);
    }

    // ═══════════════════════════════════════════════════════════════
    //  BUILD UI — STYLES
    // ═══════════════════════════════════════════════════════════════
    function buildStyles() {
        const style = document.createElement('style');
        style.textContent = `
/* ═══ E2 HUNTER PANEL ═══ */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

#e2h-panel {
    position: fixed; top: 60px; right: 14px; width: 310px;
    background: rgba(8, 10, 22, 0.92);
    border: 1px solid rgba(59, 130, 246, 0.35);
    border-radius: 18px; color: #e2e8f0;
    font: 12px/1.5 'Inter', 'Segoe UI', sans-serif;
    z-index: 99999;
    box-shadow: 0 20px 60px rgba(0,0,0,0.7), 0 0 30px rgba(59, 130, 246, 0.15),
                inset 0 1px 0 rgba(255,255,255,0.05);
    backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
    user-select: none; overflow: hidden;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    max-height: 94vh; overflow-y: auto;
}
#e2h-panel::-webkit-scrollbar { width: 4px; }
#e2h-panel::-webkit-scrollbar-thumb { background: rgba(59,130,246,0.4); border-radius: 3px; }
#e2h-panel.minimized { max-height: 44px; overflow: hidden; border-radius: 14px; }

/* HEADER */
.e2h-hdr {
    background: linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(30, 41, 59, 0.7));
    padding: 10px 14px; cursor: move;
    border-bottom: 1px solid rgba(59, 130, 246, 0.2);
    display: flex; align-items: center; justify-content: space-between;
    position: sticky; top: 0; z-index: 3;
    backdrop-filter: blur(10px);
}
.e2h-logo {
    font-size: 14px; font-weight: 900; letter-spacing: 1.5px;
    background: linear-gradient(135deg, #3b82f6, #8b5cf6);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    text-transform: uppercase;
    filter: drop-shadow(0 0 8px rgba(59,130,246,0.4));
}
.e2h-ver {
    background: linear-gradient(90deg, #3b82f6, #6366f1);
    color: #fff; border-radius: 8px; padding: 2px 8px;
    font-size: 9px; font-weight: 700;
    box-shadow: 0 0 10px rgba(59,130,246,0.4);
    margin-left: 6px;
}
.e2h-hdr-btns { display: flex; gap: 6px; }
.e2h-hdr-btn {
    width: 24px; height: 24px; border: none; border-radius: 6px;
    background: rgba(255,255,255,0.08); color: #94a3b8;
    cursor: pointer; font-size: 13px; display: flex; align-items: center; justify-content: center;
    transition: all 0.2s;
}
.e2h-hdr-btn:hover { background: rgba(59,130,246,0.3); color: #fff; transform: scale(1.1); }

/* STATUS LED */
.e2h-led {
    width: 10px; height: 10px; border-radius: 50%; margin-right: 8px;
    box-shadow: 0 0 8px currentColor;
    transition: all 0.3s; flex-shrink: 0;
}
.e2h-led.off { background: #ef4444; color: #ef4444; }
.e2h-led.on { background: #22c55e; color: #22c55e; animation: e2h-pulse 2s infinite; }
.e2h-led.fight { background: #f59e0b; color: #f59e0b; animation: e2h-pulse 0.5s infinite; }
@keyframes e2h-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

/* TABS */
.e2h-tabs {
    display: flex; gap: 3px; padding: 6px 10px;
    background: rgba(0,0,0,0.25);
    border-bottom: 1px solid rgba(59,130,246,0.1);
}
.e2h-tab {
    flex: 1; padding: 6px 4px; text-align: center;
    border-radius: 8px; cursor: pointer;
    font-size: 10px; font-weight: 700; color: #64748b;
    transition: all 0.25s; letter-spacing: 0.3px;
}
.e2h-tab.active {
    background: linear-gradient(135deg, #3b82f6, #6366f1);
    color: #fff; box-shadow: 0 3px 12px rgba(59,130,246,0.4);
    transform: translateY(-1px);
}
.e2h-tab:hover:not(.active) { background: rgba(59,130,246,0.15); color: #cbd5e1; }
.e2h-tab-page { display: none; padding: 10px 14px; }
.e2h-tab-page.active { display: block; animation: e2h-fadein 0.3s; }
@keyframes e2h-fadein { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

/* GLASS CARDS */
.e2h-card {
    background: rgba(15, 23, 42, 0.5);
    border: 1px solid rgba(59,130,246,0.15);
    border-radius: 12px; padding: 10px 12px; margin-bottom: 8px;
    box-shadow: inset 0 2px 10px rgba(0,0,0,0.3);
}
.e2h-card-title {
    font-size: 10px; font-weight: 800; text-transform: uppercase;
    letter-spacing: 1.2px; color: #60a5fa; margin-bottom: 8px;
    text-shadow: 0 0 6px rgba(96,165,250,0.3);
}

/* TOGGLE SWITCH */
.e2h-sw { display: flex; align-items: center; justify-content: space-between; margin: 6px 0; }
.e2h-sw-label { font-size: 11px; color: #cbd5e1; font-weight: 500; }
.e2h-toggle { position: relative; width: 38px; height: 20px; flex-shrink: 0; }
.e2h-toggle input { opacity: 0; width: 0; height: 0; }
.e2h-toggle .sl {
    position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5); border-radius: 20px;
    border: 1px solid rgba(59,130,246,0.25); transition: 0.3s;
}
.e2h-toggle .sl:before {
    content: ""; position: absolute; height: 14px; width: 14px;
    left: 2px; bottom: 2px; background: #64748b;
    border-radius: 50%; transition: 0.3s;
}
.e2h-toggle input:checked + .sl {
    background: #3b82f6; border-color: #60a5fa;
    box-shadow: 0 0 12px rgba(59,130,246,0.6);
}
.e2h-toggle input:checked + .sl:before { transform: translateX(18px); background: #fff; }

/* INPUTS */
.e2h-inp {
    background: rgba(0,0,0,0.4); border: 1px solid rgba(59,130,246,0.25);
    color: #fff; border-radius: 8px; padding: 5px 10px; font-size: 11px;
    width: 60px; font-family: 'Inter', sans-serif;
    transition: border-color 0.2s;
}
.e2h-inp:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 8px rgba(59,130,246,0.3); }
.e2h-row { display: flex; align-items: center; justify-content: space-between; margin: 5px 0; gap: 6px; }
.e2h-row label { color: #94a3b8; font-size: 11px; font-weight: 500; }

/* BUTTONS */
.e2h-btns { display: flex; gap: 8px; margin-top: 10px; }
.e2h-btn {
    flex: 1; padding: 10px 6px; border: none; border-radius: 10px;
    cursor: pointer; font-size: 12px; font-weight: 800;
    transition: all 0.25s; text-transform: uppercase; letter-spacing: 0.8px;
    box-shadow: 0 4px 14px rgba(0,0,0,0.3);
}
.e2h-btn:hover { transform: translateY(-2px); }
.e2h-btn:active { transform: translateY(0); }
.e2h-btn-start {
    background: linear-gradient(135deg, #059669, #10b981); color: #fff;
}
.e2h-btn-start:hover { box-shadow: 0 6px 20px rgba(16,185,129,0.5); }
.e2h-btn-stop {
    background: linear-gradient(135deg, #dc2626, #ef4444); color: #fff;
}
.e2h-btn-stop:hover { box-shadow: 0 6px 20px rgba(239,68,68,0.5); }
.e2h-btn:disabled { background: #1e293b !important; color: #475569; cursor: not-allowed; opacity: 0.5; transform: none !important; box-shadow: none !important; }

/* MOB LIST */
.e2h-mobs { max-height: 160px; overflow-y: auto; margin-top: 6px; border-radius: 10px; border: 1px solid rgba(59,130,246,0.1); }
.e2h-mobs::-webkit-scrollbar { width: 3px; }
.e2h-mobs::-webkit-scrollbar-thumb { background: rgba(59,130,246,0.4); border-radius: 2px; }
.e2h-mob {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 10px; font-size: 11px;
    border-bottom: 1px solid rgba(255,255,255,0.03);
    transition: background 0.2s; cursor: default;
}
.e2h-mob:hover { background: rgba(59,130,246,0.1); }
.e2h-mob.target { background: rgba(59,130,246,0.2); border-left: 3px solid #3b82f6; }
.e2h-mob.e2plus { background: rgba(139,92,246,0.15); border-left: 3px solid #8b5cf6; }
.e2h-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; box-shadow: 0 0 6px currentColor; }
.e2h-mname { flex: 1; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.e2h-mlvl { color: #64748b; font-size: 10px; font-weight: 700; }
.e2h-mdist { color: #475569; font-size: 9px; }

/* STATS */
.e2h-stat-row { display: flex; justify-content: space-between; margin: 4px 0; font-size: 11px; }
.e2h-stat-label { color: #64748b; }
.e2h-stat-val { color: #e2e8f0; font-weight: 700; }
.e2h-stat-val.gold { color: #fbbf24; text-shadow: 0 0 5px rgba(251,191,36,0.3); }
.e2h-stat-val.exp { color: #a78bfa; text-shadow: 0 0 5px rgba(167,139,250,0.3); }
.e2h-stat-val.e2 { color: #60a5fa; text-shadow: 0 0 5px rgba(96,165,250,0.3); }

/* HP BAR */
.e2h-hp-wrap { background: rgba(0,0,0,0.5); border-radius: 6px; height: 8px; overflow: hidden; margin: 6px 0; box-shadow: inset 0 1px 3px rgba(0,0,0,0.5); }
.e2h-hp-bar { height: 100%; border-radius: 6px; transition: width 0.4s, background 0.3s; }
.e2h-hp-bar.high { background: linear-gradient(90deg, #22c55e, #4ade80); box-shadow: 0 0 8px rgba(74,222,128,0.4); }
.e2h-hp-bar.mid { background: linear-gradient(90deg, #f59e0b, #fbbf24); box-shadow: 0 0 8px rgba(251,191,36,0.4); }
.e2h-hp-bar.low { background: linear-gradient(90deg, #ef4444, #f87171); box-shadow: 0 0 8px rgba(248,113,113,0.5); }

/* STATUS BAR */
.e2h-status {
    margin-top: 8px; padding: 8px 12px;
    background: rgba(0,0,0,0.4); border: 1px solid rgba(59, 130, 246, 0.15);
    border-radius: 10px; font-size: 11px; color: #94a3b8;
    display: flex; align-items: center; gap: 8px;
    box-shadow: inset 0 2px 8px rgba(0,0,0,0.4);
}
.e2h-status-icon { font-size: 16px; }
.e2h-status-txt { flex: 1; font-weight: 600; }

/* BATTLE STATUS */
.e2h-bs { font-weight: 800; font-size: 12px; padding: 4px 0; }
.e2h-bs.fast { color: #22c55e; }
.e2h-bs.tour { color: #f59e0b; }
.e2h-bs.fight { color: #60a5fa; }
.e2h-bs.idle { color: #475569; }

/* LOG */
.e2h-log {
    margin-top: 8px; background: rgba(0,0,0,0.5);
    border: 1px solid rgba(59,130,246,0.1); border-radius: 10px;
    padding: 8px 10px; max-height: 100px; overflow-y: auto;
    font-size: 10px; line-height: 1.7; color: #64748b;
    font-family: 'Consolas', 'Monaco', monospace;
}
.e2h-log::-webkit-scrollbar { width: 3px; }
.e2h-log::-webkit-scrollbar-thumb { background: rgba(59,130,246,0.3); border-radius: 2px; }
.e2h-log .ok { color: #4ade80; } .e2h-log .err { color: #f87171; }
.e2h-log .warn { color: #fbbf24; } .e2h-log .hi { color: #60a5fa; font-weight: 600; }
.e2h-log .info { color: #94a3b8; }
.e2h-log-time { color: #475569; margin-right: 4px; }

/* NOTIFICATION */
#e2h-notif {
    position: fixed; top: 20px; left: 50%; transform: translateX(-50%) translateY(-100px);
    background: rgba(15, 23, 42, 0.95); border: 2px solid #8b5cf6;
    border-radius: 16px; padding: 14px 20px; z-index: 999999;
    display: flex; align-items: center; gap: 12px;
    box-shadow: 0 20px 50px rgba(0,0,0,0.6), 0 0 40px rgba(139,92,246,0.4);
    backdrop-filter: blur(20px);
    transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
    min-width: 320px;
}
#e2h-notif.show { transform: translateX(-50%) translateY(0); }
.e2h-notif-icon { font-size: 36px; filter: drop-shadow(0 0 10px rgba(139,92,246,0.6)); }
.e2h-notif-title { color: #c084fc; font-size: 14px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; }
.e2h-notif-info { color: #e2e8f0; font-size: 13px; font-weight: 600; margin-top: 2px; }
.e2h-notif-coords { color: #64748b; font-size: 11px; margin-top: 2px; }

/* FOOTER */
.e2h-footer {
    padding: 6px 14px; background: rgba(0,0,0,0.3);
    border-top: 1px solid rgba(59,130,246,0.1);
    font-size: 9px; color: #475569; text-align: center;
}

/* AI TAB */
.e2h-ai-key {
    background: rgba(0,0,0,0.4); border: 1px solid rgba(139,92,246,0.3);
    color: #fff; border-radius: 8px; padding: 6px 10px; font-size: 11px;
    width: 100%; font-family: 'Inter', sans-serif; box-sizing: border-box;
    transition: border-color 0.2s;
}
.e2h-ai-key:focus { outline: none; border-color: #8b5cf6; box-shadow: 0 0 10px rgba(139,92,246,0.3); }
.e2h-ai-key::placeholder { color: #475569; }
.e2h-ai-prompt {
    background: rgba(0,0,0,0.4); border: 1px solid rgba(139,92,246,0.25);
    color: #e2e8f0; border-radius: 10px; padding: 8px 10px; font-size: 10px;
    width: 100%; min-height: 60px; resize: vertical; box-sizing: border-box;
    font-family: 'Inter', sans-serif; line-height: 1.5;
    transition: border-color 0.2s;
}
.e2h-ai-prompt:focus { outline: none; border-color: #8b5cf6; box-shadow: 0 0 10px rgba(139,92,246,0.3); }
.e2h-ai-chat-log {
    max-height: 120px; overflow-y: auto; border-radius: 10px;
    border: 1px solid rgba(139,92,246,0.15); background: rgba(0,0,0,0.4);
    padding: 8px; font-size: 10px; line-height: 1.7;
    font-family: 'Consolas', 'Monaco', monospace;
}
.e2h-ai-chat-log::-webkit-scrollbar { width: 3px; }
.e2h-ai-chat-log::-webkit-scrollbar-thumb { background: rgba(139,92,246,0.4); border-radius: 2px; }
.e2h-ai-msg-in { color: #93b900; margin: 2px 0; }
.e2h-ai-msg-out { color: #a78bfa; margin: 2px 0; }
.e2h-ai-msg-sys { color: #475569; font-style: italic; margin: 2px 0; }
.e2h-ai-status {
    display: flex; align-items: center; gap: 8px; margin-top: 6px;
    padding: 8px 12px; border-radius: 10px;
    background: rgba(0,0,0,0.4); border: 1px solid rgba(139,92,246,0.15);
    font-size: 11px;
}
.e2h-ai-led {
    width: 8px; height: 8px; border-radius: 50%;
    box-shadow: 0 0 6px currentColor; flex-shrink: 0;
}
.e2h-ai-led.off { background: #64748b; color: #64748b; }
.e2h-ai-led.on { background: #a78bfa; color: #a78bfa; animation: e2h-pulse 2s infinite; }
.e2h-ai-led.busy { background: #fbbf24; color: #fbbf24; animation: e2h-pulse 0.4s infinite; }
        `;
        document.head.appendChild(style);
    }

    // ═══════════════════════════════════════════════════════════════
    //  BUILD UI — HTML
    // ═══════════════════════════════════════════════════════════════
    function buildPanel() {
        const panel = document.createElement('div');
        panel.id = 'e2h-panel';
        panel.innerHTML = `
        <!-- HEADER -->
        <div class="e2h-hdr" id="e2h-hdr">
            <div style="display:flex;align-items:center">
                <div class="e2h-led off" id="e2h-led"></div>
                <span class="e2h-logo">⚔ E2 Hunter</span>
                <span class="e2h-ver">v${VERSION}</span>
            </div>
            <div class="e2h-hdr-btns">
                <button class="e2h-hdr-btn" id="e2h-minimize" title="Minimalizuj">─</button>
            </div>
        </div>

        <!-- TABS -->
        <div class="e2h-tabs">
            <div class="e2h-tab active" data-tab="hunt">🎯 Polowanie</div>
            <div class="e2h-tab" data-tab="fight">⚔️ Walka</div>
            <div class="e2h-tab" data-tab="ai">🤖 AI</div>
            <div class="e2h-tab" data-tab="stats">📊 Statsy</div>
            <div class="e2h-tab" data-tab="schedule">⏰ Plan</div>
            <div class="e2h-tab" data-tab="log">📋 Log</div>
        </div>

        <!-- TAB: POLOWANIE -->
        <div class="e2h-tab-page active" data-page="hunt">
            <!-- Rangi do polowania -->
            <div class="e2h-card">
                <div class="e2h-card-title">🏆 Rangi do polowania</div>
                <div class="e2h-sw"><span class="e2h-sw-label">🔱 Tytany</span><label class="e2h-toggle"><input type="checkbox" id="e2h-huntTitan" ${cfg.huntTitan?'checked':''}><span class="sl"></span></label></div>
                <div class="e2h-sw"><span class="e2h-sw-label">💎 Kolosy</span><label class="e2h-toggle"><input type="checkbox" id="e2h-huntColossus" ${cfg.huntColossus?'checked':''}><span class="sl"></span></label></div>
                <div class="e2h-sw"><span class="e2h-sw-label">👑 Herosy</span><label class="e2h-toggle"><input type="checkbox" id="e2h-huntHero" ${cfg.huntHero?'checked':''}><span class="sl"></span></label></div>
                <div class="e2h-sw"><span class="e2h-sw-label">⚡ Elity II (E2)</span><label class="e2h-toggle"><input type="checkbox" id="e2h-huntElite2" ${cfg.huntElite2?'checked':''}><span class="sl"></span></label></div>
                <div class="e2h-sw"><span class="e2h-sw-label">⭐ Elity I</span><label class="e2h-toggle"><input type="checkbox" id="e2h-huntElite" ${cfg.huntElite?'checked':''}><span class="sl"></span></label></div>
                <div class="e2h-sw"><span class="e2h-sw-label">🟢 Zwykłe moby</span><label class="e2h-toggle"><input type="checkbox" id="e2h-huntRegular" ${cfg.huntRegular?'checked':''}><span class="sl"></span></label></div>
            </div>

            <!-- Filtry i Presety -->
            <div class="e2h-card">
                <div class="e2h-card-title">🔧 Filtry</div>
                <div class="e2h-row"><label>Min poziom</label><input class="e2h-inp" type="number" id="e2h-minLvl" value="${cfg.minLvl}" min="1"></div>
                <div class="e2h-row"><label>Max poziom</label><input class="e2h-inp" type="number" id="e2h-maxLvl" value="${cfg.maxLvl}" min="1"></div>
                <div class="e2h-row"><label>Max zasięg</label><input class="e2h-inp" type="number" id="e2h-maxRange" value="${cfg.maxRange}" min="1"></div>
                
                <div class="e2h-row"><label>Wybierz E2 Preset</label>
                    <select id="e2h-preset-select" style="background:#222;color:white;border:1px solid #444;padding:3px;font-size:10px;">
                        <option value="">-- Presety --</option>
                        ${Object.keys(PRESETS).map(k => `<option value="${k}">${k}</option>`).join('')}
                    </select>
                </div>
                
                <div class="e2h-row" style="flex-direction:column;align-items:stretch"><label>Nazwy E2 (przecinki, np. Szczęt, Mushita)</label><input class="e2h-inp" type="text" id="e2h-e2NameFilter" value="${cfg.e2NameFilter}" style="width:100%;margin-top:4px"></div>
            </div>

            <!-- Auto-Patrol -->
            <div class="e2h-card">
                <div class="e2h-card-title">🗺️ Auto-Patrol (Sektory)</div>
                <div class="e2h-sw"><span class="e2h-sw-label">Aktywny patrol map</span><label class="e2h-toggle"><input type="checkbox" id="e2h-autoPatrol" ${cfg.autoPatrol?'checked':''}><span class="sl"></span></label></div>
                <div class="e2h-row"><label>Czekaj na pustej mapie (ticki)</label><input class="e2h-inp" type="number" id="e2h-maxTicksBeforeChange" value="${cfg.maxTicksBeforeChange}" min="2" max="60"></div>
                <div class="e2h-row" style="flex-direction:column;align-items:stretch"><label>Trasa patrolu (nazwy map po przecinku)</label><textarea class="e2h-inp" id="e2h-patrolRoute" style="width:100%;height:50px;margin-top:4px;resize:vertical;font-size:10px">${cfg.patrolRoute}</textarea></div>
            </div>

            <!-- Auto-Relog -->
            <div class="e2h-card">
                <div class="e2h-card-title">⏱️ Auto-Relog (Minutnik)</div>
                <div class="e2h-sw"><span class="e2h-sw-label">Aktywne przelogowanie</span><label class="e2h-toggle"><input type="checkbox" id="e2h-autoRelog" ${cfg.autoRelog?'checked':''}><span class="sl"></span></label></div>
                <div class="e2h-row"><label>Początek relogu (sekund przed 0s)</label><input class="e2h-inp" type="number" id="e2h-relogSecondsBefore" value="${cfg.relogSecondsBefore}" min="1" max="180"></div>
            </div>

            <!-- Moby na mapie -->
            <div class="e2h-card">
                <div class="e2h-card-title">📡 Moby na mapie <span id="e2h-mob-count" style="color:#60a5fa">(0)</span></div>
                <div class="e2h-mobs" id="e2h-mobs"></div>
            </div>

            <!-- Start/Stop -->
            <div class="e2h-btns">
                <button class="e2h-btn e2h-btn-start" id="e2h-start">▶ START</button>
                <button class="e2h-btn e2h-btn-stop" id="e2h-stop" disabled>⏹ STOP</button>
            </div>

            <!-- Status -->
            <div class="e2h-status" id="e2h-status-bar">
                <span class="e2h-status-icon" id="e2h-phase-icon">💤</span>
                <span class="e2h-status-txt" id="e2h-phase-txt">Oczekiwanie</span>
            </div>
        </div>

        <!-- TAB: WALKA -->
        <div class="e2h-tab-page" data-page="fight">
            <div class="e2h-card">
                <div class="e2h-card-title">⚡ Auto-Fight</div>
                <div class="e2h-sw"><span class="e2h-sw-label">Auto walka</span><label class="e2h-toggle"><input type="checkbox" id="e2h-autoFight" ${cfg.autoFight?'checked':''}><span class="sl"></span></label></div>
                <div class="e2h-sw"><span class="e2h-sw-label">Auto dobijanie (szybka)</span><label class="e2h-toggle"><input type="checkbox" id="e2h-autoFinish" ${cfg.autoFinish?'checked':''}><span class="sl"></span></label></div>
                <div class="e2h-sw"><span class="e2h-sw-label">Auto wyjdź z walki</span><label class="e2h-toggle"><input type="checkbox" id="e2h-autoLeave" ${cfg.autoLeave?'checked':''}><span class="sl"></span></label></div>
                <div class="e2h-row"><label>HP do turowej (%)</label><input class="e2h-inp" type="number" id="e2h-autoHealThreshold" value="${cfg.autoHealThreshold}" min="1" max="100"></div>
            </div>

            <div class="e2h-card">
                <div class="e2h-card-title">❤️ Zdrowie bohatera</div>
                <div class="e2h-row"><label>HP</label><span id="e2h-hp-text" style="color:#4ade80;font-weight:700">100%</span></div>
                <div class="e2h-hp-wrap"><div class="e2h-hp-bar high" id="e2h-hp-bar" style="width:100%"></div></div>
                <div id="e2h-battle-status" class="e2h-bs idle">💤 Oczekiwanie</div>
            </div>

            <div class="e2h-card">
                <div class="e2h-card-title">🔔 Powiadomienia</div>
                <div class="e2h-sw"><span class="e2h-sw-label">Dźwięk przy E2</span><label class="e2h-toggle"><input type="checkbox" id="e2h-soundAlert" ${cfg.soundAlert?'checked':''}><span class="sl"></span></label></div>
                <div class="e2h-sw"><span class="e2h-sw-label">Powiadomienie wizualne</span><label class="e2h-toggle"><input type="checkbox" id="e2h-showNotif" ${cfg.showNotif?'checked':''}><span class="sl"></span></label></div>
            </div>
        </div>

        <!-- TAB: STATYSTYKI -->
        <div class="e2h-tab-page" data-page="stats">
            <div class="e2h-card">
                <div class="e2h-card-title">📊 Sesja</div>
                <div class="e2h-stat-row"><span class="e2h-stat-label">⏱ Czas</span><span class="e2h-stat-val" id="e2h-uptime">0:00</span></div>
                <div class="e2h-stat-row"><span class="e2h-stat-label">💀 Zabite moby</span><span class="e2h-stat-val" id="e2h-kills">0</span></div>
                <div class="e2h-stat-row"><span class="e2h-stat-label">🏆 Zabite E2+</span><span class="e2h-stat-val e2" id="e2h-e2killed">0</span></div>
                <div class="e2h-stat-row"><span class="e2h-stat-label">⚡ E2+ znalezione</span><span class="e2h-stat-val e2" id="e2h-e2found">0</span></div>
            </div>
            <div class="e2h-card">
                <div class="e2h-card-title">💰 Zarobki</div>
                <div class="e2h-stat-row"><span class="e2h-stat-label">EXP zdobyte</span><span class="e2h-stat-val exp" id="e2h-exp-total">0</span></div>
                <div class="e2h-stat-row"><span class="e2h-stat-label">EXP / godzinę</span><span class="e2h-stat-val exp" id="e2h-exp-rate">0</span></div>
                <div class="e2h-stat-row"><span class="e2h-stat-label">Złoto zdobyte</span><span class="e2h-stat-val gold" id="e2h-gold-total">0</span></div>
                <div class="e2h-stat-row"><span class="e2h-stat-label">Złoto / godzinę</span><span class="e2h-stat-val gold" id="e2h-gold-rate">0</span></div>
                <div class="e2h-stat-row"><span class="e2h-stat-label">⭐ Legendy (lega)</span><span class="e2h-stat-val leg" id="e2h-dropped-leg" style="color:#c084fc;font-weight:bold">0</span></div>
                <div class="e2h-stat-row"><span class="e2h-stat-label">💙 Heroiki (hero)</span><span class="e2h-stat-val heroic" id="e2h-dropped-hero" style="color:#60a5fa;font-weight:bold">0</span></div>
                <div class="e2h-stat-row"><span class="e2h-stat-label">💛 Unikaty (uni)</span><span class="e2h-stat-val uni" id="e2h-dropped-uni" style="color:#facc15;font-weight:bold">0</span></div>
            </div>
            <div class="e2h-card">
                <div class="e2h-card-title">🗺️ Lokalizacja</div>
                <div class="e2h-stat-row"><span class="e2h-stat-label">Mapa</span><span class="e2h-stat-val" id="e2h-map">-</span></div>
                <div class="e2h-stat-row"><span class="e2h-stat-label">Pozycja</span><span class="e2h-stat-val" id="e2h-pos">-</span></div>
                <div class="e2h-stat-row"><span class="e2h-stat-label">Bohater</span><span class="e2h-stat-val" id="e2h-hero-info">-</span></div>
            </div>
        </div>

        <!-- TAB: AI AUTO-REPLY -->
        <div class="e2h-tab-page" data-page="ai">
            <div class="e2h-card">
                <div class="e2h-card-title" style="color:#a78bfa;text-shadow:0 0 6px rgba(167,139,250,0.3)">🤖 AI Auto-Odpowiedzi (Prywatne)</div>
                <div class="e2h-sw"><span class="e2h-sw-label">Włącz AI auto-odpowiedzi</span><label class="e2h-toggle"><input type="checkbox" id="e2h-aiEnabled" ${cfg.aiEnabled?'checked':''}><span class="sl"></span></label></div>
                <div class="e2h-row" style="flex-direction:column;align-items:stretch;margin-top:8px">
                    <label style="color:#94a3b8;font-size:10px;font-weight:600;margin-bottom:4px">🔑 OpenRouter API Key</label>
                    <input class="e2h-ai-key" type="password" id="e2h-aiApiKey" value="${cfg.aiApiKey}" placeholder="">
                </div>
                <div class="e2h-row" style="flex-direction:column;align-items:stretch;margin-top:8px">
                    <label style="color:#94a3b8;font-size:10px;font-weight:600;margin-bottom:4px">🧠 Model AI (wpisz nazwę)</label>
                    <input class="e2h-ai-key" type="text" id="e2h-aiModelInput" value="${cfg.aiModel}" placeholder="np. cohere/north-mini-code:free">
                </div>
                <div class="e2h-row" style="flex-direction:column;align-items:stretch;margin-top:8px">
                    <label style="color:#94a3b8;font-size:10px;font-weight:600;margin-bottom:4px">💬 Prompt systemowy (osobowość AI)</label>
                    <textarea class="e2h-ai-prompt" id="e2h-aiPrompt">${cfg.aiPrompt}</textarea>
                </div>
                <div class="e2h-row"><label>Opóźnienie odpowiedzi (ms)</label><input class="e2h-inp" type="number" id="e2h-aiDelay" value="${cfg.aiDelay}" min="500" max="15000" style="width:80px"></div>
            </div>

            <div class="e2h-card">
                <div class="e2h-card-title" style="color:#a78bfa">💬 Historia czatu AI</div>
                <div class="e2h-ai-chat-log" id="e2h-ai-chat-log">
                    <div class="e2h-ai-msg-sys">Oczekiwanie na wiadomości prywatne...</div>
                </div>
                <div class="e2h-ai-status">
                    <div class="e2h-ai-led off" id="e2h-ai-led"></div>
                    <span style="color:#94a3b8;font-weight:600" id="e2h-ai-status-txt">AI wyłączone</span>
                    <span style="color:#64748b;margin-left:auto;font-size:10px" id="e2h-ai-counter">0 odpowiedzi</span>
                </div>
            </div>
        </div>

        <!-- TAB: SCHEDULE -->
        <div class="e2h-tab-page" data-page="schedule">
            <div class="e2h-card">
                <div class="e2h-card-title" style="color:#34d399;text-shadow:0 0 6px rgba(52,211,153,0.3)">⏰ Harmonogram działania bota</div>
                <div class="e2h-sw"><span class="e2h-sw-label">Włącz harmonogram</span><label class="e2h-toggle"><input type="checkbox" id="e2h-scheduleEnabled" ${cfg.scheduleEnabled?'checked':''}><span class="sl"></span></label></div>
                <div style="color:#94a3b8;font-size:10px;margin:8px 0 4px">Wpisz przedziały godzinowe oddzielone przecinkiem, np.:</div>
                <div style="color:#64748b;font-size:10px;font-family:monospace;margin-bottom:8px">06:00-12:00, 14:00-24:00</div>
                <div class="e2h-row" style="flex-direction:column;align-items:stretch">
                    <label style="color:#94a3b8;font-size:10px;font-weight:600;margin-bottom:4px">🕐 Przedziały godzinowe</label>
                    <input class="e2h-ai-key" type="text" id="e2h-scheduleSlots" value="${cfg.scheduleSlots}" placeholder="np. 06:00-12:00, 14:00-24:00">
                </div>
                <div style="margin-top:12px;padding:8px;background:rgba(52,211,153,0.08);border-radius:8px;border:1px solid rgba(52,211,153,0.2)">
                    <div style="color:#94a3b8;font-size:10px;font-weight:600;margin-bottom:4px">📋 Status harmonogramu</div>
                    <div id="e2h-schedule-status" style="color:#34d399;font-size:11px;font-weight:600">Ładowanie...</div>
                    <div id="e2h-schedule-next" style="color:#64748b;font-size:10px;margin-top:4px"></div>
                </div>
            </div>
            <div class="e2h-card" style="margin-top:8px">
                <div class="e2h-card-title" style="color:#94a3b8">ℹ️ Jak działa harmonogram?</div>
                <div style="color:#64748b;font-size:10px;line-height:1.6">
                    Bot automatycznie <b style="color:#34d399">startuje</b> gdy wejdzie w zakres godzinowy<br>
                    i <b style="color:#f87171">zatrzymuje się</b> gdy wyjdzie poza zakres.<br><br>
                    Sprawdzanie co <b style="color:#94a3b8">30 sekund</b>.<br>
                    <b>00:00</b> = północ, <b>24:00</b> = koniec dnia.
                </div>
            </div>
        </div>

        <!-- TAB: LOG -->
        <div class="e2h-tab-page" data-page="log">
            <div class="e2h-log" id="e2h-log"></div>
        </div>

        <!-- FOOTER -->
        <div class="e2h-footer">E2 Hunter v${VERSION} — Klawisz <b>=</b> toggle | Przeciągnij nagłówek</div>
        `;

        document.body.appendChild(panel);

        // Tabs switcher
        panel.querySelectorAll('.e2h-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                panel.querySelectorAll('.e2h-tab').forEach(t => t.classList.remove('active'));
                panel.querySelectorAll('.e2h-tab-page').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                const page = panel.querySelector(`[data-page="${tab.dataset.tab}"]`);
                if (page) page.classList.add('active');
            });
        });

        // Minimize
        document.getElementById('e2h-minimize').addEventListener('click', () => {
            panel.classList.toggle('minimized');
        });

        // Start/Stop
        document.getElementById('e2h-start').addEventListener('click', startBot);
        document.getElementById('e2h-stop').addEventListener('click', stopBot);

        // Preset select listener
        document.getElementById('e2h-preset-select').addEventListener('change', function() {
            if (this.value && PRESETS[this.value]) {
                const input = document.getElementById('e2h-e2NameFilter');
                if (input) {
                    input.value = PRESETS[this.value];
                    cfg.e2NameFilter = input.value;
                    saveCfg();
                    log(`📋 Wczytano preset: ${this.value}`, 'ok');
                }
            }
        });

        // Settings toggles
        const toggles = [
            ['e2h-huntTitan', 'huntTitan'], ['e2h-huntColossus', 'huntColossus'],
            ['e2h-huntHero', 'huntHero'], ['e2h-huntElite2', 'huntElite2'],
            ['e2h-huntElite', 'huntElite'], ['e2h-huntRegular', 'huntRegular'],
            ['e2h-autoFight', 'autoFight'], ['e2h-autoFinish', 'autoFinish'],
            ['e2h-autoLeave', 'autoLeave'], ['e2h-soundAlert', 'soundAlert'],
            ['e2h-showNotif', 'showNotif'], ['e2h-autoPatrol', 'autoPatrol'],
            ['e2h-aiEnabled', 'aiEnabled'], ['e2h-autoRelog', 'autoRelog'],
            ['e2h-scheduleEnabled', 'scheduleEnabled'],
        ];
        toggles.forEach(([id, key]) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', () => { cfg[key] = el.checked; saveCfg(); });
        });

        // Number inputs
        const inputs = [
            ['e2h-minLvl', 'minLvl'], ['e2h-maxLvl', 'maxLvl'],
            ['e2h-maxRange', 'maxRange'], ['e2h-autoHealThreshold', 'autoHealThreshold'],
            ['e2h-maxTicksBeforeChange', 'maxTicksBeforeChange'],
            ['e2h-aiDelay', 'aiDelay'], ['e2h-relogSecondsBefore', 'relogSecondsBefore'],
        ];
        inputs.forEach(([id, key]) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', () => { cfg[key] = parseInt(el.value, 10) || DEFAULT_CFG[key]; saveCfg(); });
        });

        // Text & Textarea inputs
        const textInputs = [
            ['e2h-e2NameFilter', 'e2NameFilter'],
            ['e2h-patrolRoute', 'patrolRoute'],
            ['e2h-aiApiKey', 'aiApiKey'],
            ['e2h-aiPrompt', 'aiPrompt'],
            ['e2h-scheduleSlots', 'scheduleSlots'],
        ];
        textInputs.forEach(([id, key]) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', () => { cfg[key] = el.value.trim(); saveCfg(); updateScheduleStatus(); });
        });

        // Schedule status initial render
        updateScheduleStatus();

        // AI Model text input
        const aiModelInput = document.getElementById('e2h-aiModelInput');
        if (aiModelInput) {
            aiModelInput.addEventListener('change', () => {
                const val = aiModelInput.value.trim();
                if (val) {
                    cfg.aiModel = val;
                    saveCfg();
                    log(`🧠 Model AI: ${cfg.aiModel}`, 'ok');
                }
            });
        }

        // Dragging
        makeDraggable(panel, document.getElementById('e2h-hdr'));

        // Keyboard toggle
        document.addEventListener('keydown', (e) => {
            if (e.key === '=' || e.key === '+') {
                if (botRunning) stopBot(); else startBot();
            }
        });

        // Position restore
        if (cfg.panelX !== null && cfg.panelY !== null) {
            panel.style.left = cfg.panelX + 'px';
            panel.style.top = cfg.panelY + 'px';
            panel.style.right = 'auto';
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  DRAGGABLE
    // ═══════════════════════════════════════════════════════════════
    function makeDraggable(panel, handle) {
        let dragging = false, ox = 0, oy = 0;
        handle.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            dragging = true;
            ox = e.clientX - panel.offsetLeft;
            oy = e.clientY - panel.offsetTop;
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            panel.style.left = (e.clientX - ox) + 'px';
            panel.style.top = (e.clientY - oy) + 'px';
            panel.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => {
            if (dragging) {
                dragging = false;
                cfg.panelX = panel.offsetLeft;
                cfg.panelY = panel.offsetTop;
                saveCfg();
            }
        });
    }

    // ═══════════════════════════════════════════════════════════════
    //  RENDER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════
    function renderAll() {
        renderMobs();
        renderHP();
        renderPhase();
        renderStats();
        renderButtons();
    }

    function renderMobs() {
        const el = document.getElementById('e2h-mobs');
        const countEl = document.getElementById('e2h-mob-count');
        if (!el) return;

        const mobs = scanMobs();
        if (countEl) countEl.textContent = `(${mobs.length})`;

        if (mobs.length === 0) {
            el.innerHTML = '<div style="padding:12px;text-align:center;color:#475569;font-size:10px">Brak mobów na mapie</div>';
            return;
        }

        el.innerHTML = mobs.slice(0, 25).map(m => {
            const color = getRankColor(m.rank);
            const isTarget = currentTarget && currentTarget.id === m.id;
            const isE2Plus = getRankPriority(m.rank) >= 3;
            const cls = isTarget ? 'target' : (isE2Plus ? 'e2plus' : '');
            return `<div class="e2h-mob ${cls}">
                <div class="e2h-dot" style="background:${color};color:${color}"></div>
                <span class="e2h-mname" style="color:${color}">${m.nick}</span>
                <span class="e2h-mlvl">${m.lvl}</span>
                <span class="e2h-mdist">${m.dist}p</span>
            </div>`;
        }).join('');
    }

    function renderHP() {
        const hp = getHeroHP();
        const bar = document.getElementById('e2h-hp-bar');
        const txt = document.getElementById('e2h-hp-text');
        if (bar) {
            bar.style.width = hp + '%';
            bar.className = 'e2h-hp-bar ' + (hp > 60 ? 'high' : hp > 30 ? 'mid' : 'low');
        }
        if (txt) {
            txt.textContent = hp + '%';
            txt.style.color = hp > 60 ? '#4ade80' : hp > 30 ? '#fbbf24' : '#f87171';
        }
    }

    function renderPhase() {
        const icon = document.getElementById('e2h-phase-icon');
        const txt = document.getElementById('e2h-phase-txt');
        const led = document.getElementById('e2h-led');
        if (!icon || !txt || !led) return;

        const phases = {
            idle: ['💤', 'Oczekiwanie', 'off'],
            scanning: ['🔍', 'Skanowanie...', 'on'],
            walking: ['🚶', `Idę do: ${currentTarget?.nick || '?'}`, 'on'],
            fighting: ['⚔️', `Walka: ${currentTarget?.nick || '?'}`, 'fight'],
            patrol_wait: ['⏳', `Patrol za moment... (${ticksOnEmptyMap}/${cfg.maxTicksBeforeChange})`, 'on']
        };
        const p = phases[phase] || phases.idle;
        icon.textContent = p[0];
        txt.textContent = p[1];
        led.className = 'e2h-led ' + (botRunning ? p[2] : 'off');
    }

    function renderStats() {
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('e2h-uptime', getUptime());
        set('e2h-kills', stats.kills);
        set('e2h-e2killed', stats.e2Killed || 0);
        set('e2h-e2found', stats.e2Found);
        set('e2h-exp-total', fmtNum(stats.expGained));
        set('e2h-exp-rate', fmtNum(getRate(stats.expGained)) + '/h');
        set('e2h-gold-total', fmtNum(stats.goldGained));
        set('e2h-gold-rate', fmtNum(getRate(stats.goldGained)) + '/h');
        set('e2h-dropped-leg', stats.legDropped || 0);
        set('e2h-dropped-hero', stats.heroDropped || 0);
        set('e2h-dropped-uni', stats.uniDropped || 0);

        const map = getMapInfo();
        set('e2h-map', map.name);
        const hero = getHeroInfo();
        if (hero) {
            set('e2h-pos', `[${hero.x}, ${hero.y}]`);
            set('e2h-hero-info', `${hero.nick} lv${hero.lvl}`);
        }
    }

    function renderButtons() {
        const startBtn = document.getElementById('e2h-start');
        const stopBtn = document.getElementById('e2h-stop');
        if (startBtn) startBtn.disabled = botRunning;
        if (stopBtn) stopBtn.disabled = !botRunning;
    }

    function renderLog() {
        const el = document.getElementById('e2h-log');
        if (!el) return;
        const last = logLines.slice(-50);
        el.innerHTML = last.map(l =>
            `<div><span class="e2h-log-time">${l.time}</span><span class="${l.type}">${l.msg}</span></div>`
        ).join('');
        el.scrollTop = el.scrollHeight;
    }

    function startRenderLoop() {
        setInterval(() => {
            renderAll();
            if (botRunning) {
                const hero = getHeroInfo();
                if (hero && stats.startExp > 0) {
                    stats.expGained = hero.exp - stats.startExp;
                    stats.goldGained = hero.gold - stats.startGold;
                }
            }
        }, 1500);
    }

    // ═══════════════════════════════════════════════════════════════
    //  INIT
    // ═══════════════════════════════════════════════════════════════
    // ═══════════════════════════════════════════════════════════════
    //  AI AUTO-REPLY SYSTEM
    // ═══════════════════════════════════════════════════════════════
    function getHeroNick() {
        try { return (Engine.hero.d.nick || '').trim(); } catch { return ''; }
    }

    function aiLogChat(msg, type = 'sys') {
        const el = document.getElementById('e2h-ai-chat-log');
        if (!el) return;
        const time = new Date().toLocaleTimeString('pl-PL');
        const cls = type === 'in' ? 'e2h-ai-msg-in' : type === 'out' ? 'e2h-ai-msg-out' : 'e2h-ai-msg-sys';
        el.innerHTML += `<div class="${cls}"><span style="color:#475569">[${time}]</span> ${msg}</div>`;
        el.scrollTop = el.scrollHeight;
        // Limit lines
        while (el.children.length > 100) el.removeChild(el.firstChild);
    }

    function updateAiStatus(status, ledClass) {
        const txt = document.getElementById('e2h-ai-status-txt');
        const led = document.getElementById('e2h-ai-led');
        const counter = document.getElementById('e2h-ai-counter');
        if (txt) txt.textContent = status;
        if (led) led.className = 'e2h-ai-led ' + ledClass;
        if (counter) counter.textContent = `${_aiReplyCount} odpowiedzi`;
    }

// ═══════════════════════════════════════════════════════════════
//  AI AUTO-REPLY – TYLKO PRYWATNE
// ═══════════════════════════════════════════════════════════════

function sendPrivateMessage(nick, text) {
    try {
        // 1. Spróbuj przez silnik gry (API websocket Margonem)
        if (window.Engine?.chat?.sendMessage) {
            console.log(`[AI] Wysyłam przez Engine.chat do ${nick}`);
            window.Engine.chat.sendMessage(text, 'PRIVATE', nick);
            return true;
        }

        // 2. Spróbuj przez _g (starszy endpoint)
        if (window._g) {
            console.log(`[AI] Wysyłam przez _g do ${nick}`);
            window._g(`chat&c=${encodeURIComponent(nick)}&txt=${encodeURIComponent(text)}`);
            return true;
        }

        // 3. Kliknięcie na nick nadawcy w ostatniej prywatnej wiadomości żeby otworzyć czat prywatny
        const privMsgs = document.querySelectorAll('.chat-PRIVATE-message');
        let clicked = false;

        for (let i = privMsgs.length - 1; i >= 0; i--) {
            const msg = privMsgs[i];
            const authorEl = msg.querySelector('.author-section.click-able');
            if (!authorEl) continue;

            const author = authorEl.textContent.trim().replace(/[«»:\s]+$/g, '');
            if (author === nick) {
                authorEl.click();
                clicked = true;
                break;
            }
        }

        if (!clicked) {
            log('<span class="warn">⚠ AI: Nie udało się kliknąć nicku prywatnej wiadomości</span>');
            return false;
        }

        // 4. Czekamy na przełączenie czatu i wpisujemy tekst
        setTimeout(() => {
            // Szukamy pola czatu – magic_input Margonem to contenteditable div lub custom element
            const input = document.querySelector('magic_input') ||
                         document.querySelector('.magic-input') ||
                         document.querySelector('[contenteditable="true"]');

            if (!input) {
                log('<span class="warn">⚠ AI: Nie znaleziono pola tekstowego czatu</span>');
                return;
            }

            input.focus();

            // Wyczyść pole
            input.textContent = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));

            // Wstaw tekst przez execCommand – jedyna metoda działająca z contenteditable Margonem
            try {
                document.execCommand('insertText', false, text);
            } catch (e) {
                // Fallback: bezpośrednie ustawienie textContent z ręcznym triggerem
                input.textContent = text;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }

            // Wyślij Enterem po chwili (potrzeba by Margonem zobaczył wpisany tekst)
            setTimeout(() => {
                // Margonem nasłuchuje keydown z keyCode 13
                const enterEvent = new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    bubbles: true,
                    cancelable: true
                });
                input.dispatchEvent(enterEvent);

                // Dodatkowy fallback: sprawdź czy tekst nadal w polu (nie wysłany) i spróbuj kliknąć przycisk Send
                setTimeout(() => {
                    if (input.textContent && input.textContent.trim().length > 0) {
                        const sendBtn = document.querySelector('.chat-send-button') ||
                                       document.querySelector('[data-action="send"]') ||
                                       document.querySelector('.chat-submit');
                        if (sendBtn) {
                            sendBtn.click();
                        } else {
                            // Ostatni resort: symuluj naciśnięcie klawisza
                            input.dispatchEvent(new KeyboardEvent('keypress', {
                                key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
                            }));
                            input.dispatchEvent(new KeyboardEvent('keyup', {
                                key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
                            }));
                        }
                    }
                }, 200);
            }, 150);
        }, 400);

        return true;
    } catch (e) {
        log(`<span class="err">✗ AI: Błąd wysyłania → ${e.message}</span>`);
        return false;
    }
}

 

    async function askOpenRouter(nick, message) {
        if (!cfg.aiApiKey) {
            aiLogChat('❌ Brak klucza API! Ustaw go w zakładce AI.', 'sys');
            return null;
        }

        // Buduj historię konwersacji
        if (!_aiConversations[nick]) _aiConversations[nick] = [];
        _aiConversations[nick].push({ role: 'user', content: message });

        // Ogranicz historię
        if (_aiConversations[nick].length > cfg.aiMaxHistory) {
            _aiConversations[nick] = _aiConversations[nick].slice(-cfg.aiMaxHistory);
        }

        const heroNick = getHeroNick();
        const systemPrompt = cfg.aiPrompt + `\n\nTwój nick w grze to "${heroNick}". Rozmawiasz z graczem "${nick}". Odpowiadaj TYLKO treścią odpowiedzi, bez żadnego prefiksu ani formatowania. Max 180 znaków. Pamiętaj, aby NIGDY nie zaczynać zdania od myślnika '-' ani innych znaków dialogowych!` + getAiContextPrompt(nick);

        try {
            updateAiStatus('Myślę...', 'busy');
            _aiPendingReply = true;

            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${cfg.aiApiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://margonem.pl',
                    'X-Title': 'Margonem Bot'
                },
                body: JSON.stringify({
                    model: cfg.aiModel,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        ..._aiConversations[nick]
                    ],
                    max_tokens: 120,
                    temperature: 0.9,
                    top_p: 0.95
                })
            });

            if (!response.ok) {
                const err = await response.text();
                aiLogChat(`❌ API Error ${response.status}: ${err.slice(0, 100)}`, 'sys');
                updateAiStatus('Błąd API', 'off');
                _aiPendingReply = false;
                return null;
            }

            const data = await response.json();
            const reply = (data.choices?.[0]?.message?.content || '').trim();

            if (reply) {
                // Czyszczenie wypowiedzi z ewentualnych myślników na początku
                let cleanReply = reply.replace(/^[\s\-\—\–\.\:\,\(\)\{\}\[\]\>\<\/\?\!\*\@\#\$\%\^\&\+\=\_]+/g, '').trim();
                if (!cleanReply) cleanReply = reply;

                // Zapisz odpowiedź w historii
                _aiConversations[nick].push({ role: 'assistant', content: cleanReply });
                _aiPendingReply = false;
                updateAiStatus('Nasłuchuję...', 'on');
                return cleanReply;
            }

            _aiPendingReply = false;
            updateAiStatus('Nasłuchuję...', 'on');
            return null;
        } catch (e) {
            aiLogChat(`❌ Fetch error: ${e.message}`, 'sys');
            _aiPendingReply = false;
            updateAiStatus('Błąd połączenia', 'off');
            return null;
        }
    }

    function processPrivateMessage(authorNick, messageText) {
        if (!cfg.aiEnabled) return;
        if (_aiPendingReply) return; // jedna odpowiedź na raz

        const heroNick = getHeroNick();
        if (!heroNick) return;

        // Nie odpowiadaj sam sobie
        if (authorNick === heroNick) return;

        const msgLow = messageText.toLowerCase().trim();
        if (!msgLow) return;

        aiLogChat(`<b>${authorNick}</b>: ${messageText}`, 'in');
        log(`<span class="hi">💬 [P] ${authorNick}: ${messageText}</span>`);

        // Losowe opóźnienie żeby wyglądało naturalnie
        const delay = cfg.aiDelay + Math.floor(Math.random() * 2000);

        setTimeout(async () => {
            let reply;

            // Specjalna reguła: jeśli ktoś mówi "bot"
            if (/\bbot\b/i.test(msgLow)) {
                reply = 'sam zes bot xd';
                aiLogChat(`🤖 Wykryto słowo "bot" → auto odpowiedź`, 'sys');
            } else {
                // Zapytaj AI
                reply = await askOpenRouter(authorNick, messageText);
            }

            if (reply) {
                // Czyszczenie myślników na początku
                let cleanReply = reply.replace(/^[\s\-\—\–\.\:\,\(\)\{\}\[\]\>\<\/\?\!\*\@\#\$\%\^\&\+\=\_]+/g, '').trim();
                if (!cleanReply) cleanReply = reply;

                // Ucinaj do 180 znaków (limit Margonem)
                if (cleanReply.length > 180) cleanReply = cleanReply.slice(0, 177) + '...';

                const sent = sendPrivateMessage(authorNick, cleanReply);
                _aiReplyCount++;
                _aiLastReplyTime = Date.now();
                aiLogChat(`<b>→ ${heroNick}</b>: ${cleanReply}`, 'out');
                log(`<span class="ok">🤖 → ${authorNick}: ${cleanReply}</span>`);
                updateAiStatus('Nasłuchuję...', 'on');
                if (!sent) {
                    log(`<span class="warn">⚠ AI: Wiadomość przetworzona ale wysyłka niepewna (brak potwierdzenia od silnika gry)</span>`);
                }
            }
        }, delay);
    }

    function startAiChatObserver() {
        if (_aiChatObserverStarted) return;

        // Szukamy kontenera czatu — precyzyjny selektor z podanego HTML
        const chatContainer = document.querySelector('.chat-message-wrapper .scroll-pane')
            || document.querySelector('.scroll-pane')
            || document.querySelector('.chat-message-wrapper');

        if (!chatContainer) {
            log('<span class="warn">⏳ AI: Czekam na kontener czatu...</span>');
            setTimeout(startAiChatObserver, 2000);
            return;
        }

        _aiChatObserverStarted = true;

        // Oznacz WSZYSTKIE istniejące wiadomości jako przeczytane (nie przetwarzaj starych)
        chatContainer.querySelectorAll('.chat-PRIVATE-message').forEach(msgEl => {
            msgEl.setAttribute('data-ai-done', '1');
        });

        log('<span class="ok">🤖 AI Chat Observer aktywny</span>');
        aiLogChat('👁 Observer aktywny — nasłuchuję nowych prywatnych wiadomości...', 'sys');
        updateAiStatus('Nasłuchuję...', 'on');

        // Główny observer na dodane nody w scroll-pane
        const observer = new MutationObserver((mutations) => {
            if (!cfg.aiEnabled) return;

            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (!(node instanceof HTMLElement)) continue;

                    // Zbierz prywatne wiadomości z dodanego noda
                    const msgs = [];
                    if (node.classList && node.classList.contains('chat-PRIVATE-message')) {
                        msgs.push(node);
                    }
                    // Sprawdź też zagnieżdżone (np. one-message-wrapper)
                    if (node.querySelectorAll) {
                        node.querySelectorAll('.chat-PRIVATE-message').forEach(n => msgs.push(n));
                    }

                    for (const msgEl of msgs) {
                        // ★ KLUCZOWE: sprawdź czy już przetworzona (oznaczona)
                        if (msgEl.getAttribute('data-ai-done') === '1') continue;

                        const authorEl = msgEl.querySelector('.author-section');
                        const messageEl = msgEl.querySelector('.message-section');

                        if (!authorEl || !messageEl) continue;

                        const author = (authorEl.textContent || '').replace(/\s+/g, ' ').replace(/[«»:\s]+$/g, '').trim();
                        const message = (messageEl.textContent || '').trim();

                        if (!author || !message) continue;

                        const heroNick = getHeroNick();
                        // Pomiń wiadomości które MY wysłaliśmy (porównanie case-insensitive i trim)
                        if (author.toLowerCase() === heroNick.toLowerCase()) { 
                            msgEl.setAttribute('data-ai-done', '1'); 
                            continue; 
                        }

                        // Deduplikacja na poziomie treści w krótkim oknie czasowym (15 sekund)
                        const now = Date.now();
                        const isDup = _aiRecentMessages.some(m => 
                            m.author === author && 
                            m.message === message && 
                            (now - m.time) < 15000
                        );
                        if (isDup) {
                            msgEl.setAttribute('data-ai-done', '1');
                            continue;
                        }
                        
                        _aiRecentMessages.push({ author, message, time: now });
                        if (_aiRecentMessages.length > 50) _aiRecentMessages.shift();

                        // ★ OZNACZ JAKO PRZECZYTANE — nigdy więcej nie przetworzymy
                        msgEl.setAttribute('data-ai-done', '1');

                        processPrivateMessage(author, message);
                    }
                }
            }
        });

        observer.observe(chatContainer, { childList: true, subtree: true });

        // Dodatkowy polling co 10s — gdyby observer się zablokował
        // Szuka wiadomości BEZ data-ai-done (nieprzetworzone)
        setInterval(() => {
            if (!cfg.aiEnabled) return;
            const freshMsgs = chatContainer.querySelectorAll('.chat-PRIVATE-message:not([data-ai-done])');
            freshMsgs.forEach(msgEl => {
                const authorEl = msgEl.querySelector('.author-section');
                const messageEl = msgEl.querySelector('.message-section');
                if (!authorEl || !messageEl) { msgEl.setAttribute('data-ai-done', '1'); return; }

                const author = (authorEl.textContent || '').replace(/\s+/g, ' ').replace(/[«»:\s]+$/g, '').trim();
                const message = (messageEl.textContent || '').trim();
                if (!author || !message) { msgEl.setAttribute('data-ai-done', '1'); return; }

                const heroNick = getHeroNick();
                if (author.toLowerCase() === heroNick.toLowerCase()) { msgEl.setAttribute('data-ai-done', '1'); return; }

                // Deduplikacja na poziomie treści
                const now = Date.now();
                const isDup = _aiRecentMessages.some(m => 
                    m.author === author && 
                    m.message === message && 
                    (now - m.time) < 15000
                );
                if (isDup) {
                    msgEl.setAttribute('data-ai-done', '1');
                    return;
                }

                _aiRecentMessages.push({ author, message, time: now });
                if (_aiRecentMessages.length > 50) _aiRecentMessages.shift();

                // ★ Oznacz i przetwórz
                msgEl.setAttribute('data-ai-done', '1');
                processPrivateMessage(author, message);
            });
        }, 10000);
    }

  // ═══════════════════════════════════════════════════════════════
//  AUTO-RELOGGER – NAJLEPSZA E2 (czas + lvl)
// ═══════════════════════════════════════════════════════════════

let _reloggerEnabled = true;
let _lastRelogTime = 0;
const RELOG_COOLDOWN = 8000; // 8 sekund cooldown między relogami

function getEliteTimers() {
    const timers = [];
    document.querySelectorAll('.elite-timer .row').forEach(row => {
        const nameEl = row.querySelector('.name-val');
        const timeEl = row.querySelector('.time-val');
        if (!nameEl || !timeEl) return;

        // WAŻNE: Czyścimy prefix [E2]/[E] żeby nazwa matchowała E2_DATABASE!
        const rawName = nameEl.textContent.trim();
        const name = rawName.replace(/^\[E2?\]\s*/i, '').trim();
        const timeStr = timeEl.textContent.trim();
        const seconds = timeToSeconds(timeStr);

        // Pobierz lvl z E2_DATABASE zamiast z nazwy (nazwy E2 nie zawierają lvl)
        const e2Entry = typeof E2_DATABASE !== 'undefined' 
            ? E2_DATABASE.find(e => e.name.toLowerCase() === name.toLowerCase())
            : null;
        const lvl = e2Entry ? e2Entry.lvl : 0;

        if (seconds >= 0) {
            timers.push({ name, seconds, lvl, element: row });
        }
    });
    return timers;
}

function timeToSeconds(timeStr) {
    const parts = timeStr.split(':').map(Number);
    if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
    if (parts.length === 2) return parts[0]*60 + parts[1];
    return parseInt(timeStr) || 0;
}

function findBestE2ForRelog(maxSeconds) {
    const timers = getEliteTimers().filter(t => t.seconds <= maxSeconds);
    if (timers.length === 0) return null;

    // Sortuj: najmniejszy czas → najwyższy lvl
    timers.sort((a, b) => {
        if (a.seconds !== b.seconds) return a.seconds - b.seconds;
        return b.lvl - a.lvl;
    });

    return timers[0];
}

// Klikanie przez canvas / DOM (podobnie jak captcha)
async function clickReloggerCharacter(targetCharName) {
    if (!targetCharName) return false;
    // 1. Otwórz okno reloggera jeśli zamknięte
    const relogBtn = document.querySelector('.relogger__characters') || 
                     document.querySelector('.relogger-window');
    if (!relogBtn) return false;

    // 2. Znajdź postać
    const chars = document.querySelectorAll('.relogger__one-character');
    for (const char of chars) {
        const tipId = char.getAttribute('tip-id');
        if (!tipId) continue;

        // Pobierz tooltip (canvas-aware)
        char.dispatchEvent(new MouseEvent('mouseenter'));
        await delay(120);

        const tooltip = document.querySelector('.tip-wrapper, .normal-tip, #tooltip, .tooltip, .tip-content');
        const tipText = tooltip ? tooltip.textContent.toLowerCase().replace(/\s+/g, ' ').trim() : '';

        char.dispatchEvent(new MouseEvent('mouseleave'));

        const cleanTarget = targetCharName.toLowerCase().replace(/\s+/g, ' ').trim();

        if (tipText.includes(cleanTarget)) {
            // Dwukrotne kliknięcie
            char.click();
            await delay(120);
            char.click();
            console.log(`[Relogger] Kliknięto postać: ${targetCharName}`);
            return true;
        }
    }
    return false;
}

function startAutoRelogger() {
    if (!_reloggerEnabled) return;

    setInterval(() => {
        if (Date.now() - _lastRelogTime < RELOG_COOLDOWN) return;

        const cfgRelogTime = cfg.relogSecondsBefore || 30;
        const bestE2 = findBestE2ForRelog(cfgRelogTime);

        if (bestE2) {
            _lastRelogTime = Date.now();

            // NOWA STRATEGIA: Zapisz cel relogu w localStorage
            // Puppeteer (capthat.js tryAutoRelog) odczyta i zrobi PRAWDZIWY klik przeglądarki
            // (isTrusted: true) na wierszu minutnika — gra to zaakceptuje jako klik gracza!
            log(`🔄 Auto-relog → ${bestE2.name} (resp za ${bestE2.seconds}s) — sygnalizuję Puppeteerowi...`, 'ok');
            localStorage.setItem('e2h_relog_e2name', bestE2.name);
            localStorage.setItem('e2h_relog_e2name_time', Date.now().toString());

            // Opcjonalnie: zachowaj też target_char jeśli znaleziono postać (dla cookie fallbacku)
            const matchedChar = findCharacterForE2(bestE2.name);
            if (matchedChar) {
                localStorage.setItem('e2h_target_char', matchedChar.nick);
                localStorage.setItem('e2h_target_char_time', Date.now().toString());
            }
        }
    }, 2500); // co 2.5s sprawdzaj
}

// Pomocnicza delay
function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// Uruchom
setTimeout(() => {
    startAutoRelogger();
    log('🔄 Auto-relogger aktywowany (czas + priorytet lvl)', 'ok');
}, 4000);

    // ═══════════════════════════════════════════════════════════════
    //  INIT
    // ═══════════════════════════════════════════════════════════════
    waitForEngine(() => {
        console.log('[E2H] Engine ready, building UI...');
        buildStyles();
        buildPanel();
        startRenderLoop();
        log('✅ E2 Hunter + AI Auto-Reply załadowane! Naciśnij = lub START.', 'ok');
        log(`📍 Mapa: ${getMapInfo().name}`, 'info');
        renderAll();

        // Start AI chat observer
        setTimeout(startAiChatObserver, 2000);

        // Start harmonogram watchdog (auto start/stop według godzin)
        setTimeout(startScheduleWatchdog, 3500);

        // Cykliczne odświeżanie postaci i timerów z API
        setInterval(fetchLootlogTimers, 30000);
        setInterval(fetchAccountCharacters, 300000);

        // Push statystyk do runbot API co 15 sekund
        setInterval(pushStatsToServer, 15000);

        // WAŻNE: Wczytaj listę postaci OD RAZU (nie czekaj 5 minut!)
        setTimeout(fetchAccountCharacters, 3000);

        // Auto-start bota po F5 jeśli był włączony
        if (cfg.botEnabled) {
            // Jeśli harmonogram jest włączony, sprawdź czy teraz jest pora działania
            if (cfg.scheduleEnabled) {
                const inSchedule = isScheduleActive();
                if (inSchedule === true) {
                    log('⚡ Auto-start bota (wznowienie po odświeżeniu) — harmonogram aktywny.', 'info');
                    setTimeout(startBot, 1000);
                } else if (inSchedule === false) {
                    log('⏰ Auto-start POMINIĘTY — poza harmonogramem godzinowym.', 'warn');
                }
            } else {
                log('⚡ Auto-start bota (wznowienie po odświeżeniu)...', 'info');
                setTimeout(startBot, 1000);
            }
        }
    });

})();
