// ==UserScript==
// @name         Auto Quester Lista questów! (+Berserk Smart & A*)
// @namespace    http://tampermonkey.net/
// @version      2026-07-02
// @description  try to take over the world! (Now with A* Pathfinding)
// @author       You
// @match        https://*/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================
    // BAZA DANYCH QUESTÓW
    // ==========================================
    const QUESTS_DATABASE = {
        "[ZR]: Brązowe mrówki": [
            { type: 'talk', nick: 'Zakonnik Równowagi', desc: 'Porozmawiaj z Zakonnik Równowagi' },
            { type: 'dialog', option: 3, desc: 'Wybierz 3 z opcji dialogowej' },
            { type: 'dialog_text', text: 'Mrowisko', desc: 'Wybierz dialog dotyczący: Mrowisko' },
            { type: 'dialog', option: 1, desc: 'Wybierz 1 z opcji dialogowej' },
            { type: 'dialog', option: 1, desc: 'Wybierz 1 z opcji dialogowej' },
            { type: 'path', maps: [2, 2029, 2523], desc: 'Podążaj wyznaczoną ścieżką map' },
            { type: 'berserk', enabled: true, lvl: 17, desc: 'Włącz Berserk (Lvl 17)' },
            { type: 'hunt', uiName: 'Brązowe mrówki', mobs: ['Brązowa mrówka tragarz', 'Brązowa mrówka żołnierz', 'Brązowa mrówka robotnica'], maps: [2523, 2529, 2491, 2783, 2528, 2522, 2029, 2523], targetCount: 100, desc: 'Rozpocznij polowanie na moby' },
            { type: 'berserk', enabled: false, desc: 'Wyłącz Berserk po expieniu' },
            { type: 'path', maps: [2523, 2529, 2491, 2783, 2528, 2522, 2029, 2], desc: 'Podążaj wyznaczoną ścieżką map' },
            { type: 'talk', nick: 'Zakonnik Równowagi', desc: 'Porozmawiaj z Zakonnik Równowagi' },
            { type: 'dialog', option: 4, desc: 'Wybierz 4 z opcji dialogowej' },
            { type: 'dialog_text', text: 'Mrówki', desc: 'Wybierz dialog dotyczący: Mrówki' },
            { type: 'dialog', option: 1, desc: 'Wybierz 1 z opcji dialogowej' },
        ],
        "[ZR]: Dzikie koty": [
            { type: 'talk', nick: 'Zakonnik Równowagi', desc: 'Porozmawiaj z Zakonnik Równowagi' },
            { type: 'dialog', option: 3, desc: 'Wybierz 3 z opcji dialogowej' },
            { type: 'dialog_text', text: 'Dzikie Koty', desc: 'Wybierz dialog dotyczący: Dzikie Koty' },
            { type: 'dialog', option: 1, desc: 'Wybierz 1 z opcji dialogowej' },
            { type: 'dialog', option: 1, desc: 'Wybierz 1 z opcji dialogowej' },
            { type: 'path', maps: [2, 1108], desc: 'Podążaj wyznaczoną ścieżką map' },
            { type: 'berserk', enabled: true, lvl: 19, desc: 'Włącz Berserk (Lvl 19)' },
            { type: 'hunt', uiName: 'Dzikie Koty', mobs: ['Puma', 'Tygrys'], maps: [1108, 1263, 1108], targetCount: 100, desc: 'Rozpocznij polowanie na moby' },
            { type: 'berserk', enabled: false, desc: 'Wyłącz Berserk po expieniu' },
            { type: 'path', maps: [1263, 1108, 2], desc: 'Podążaj wyznaczoną ścieżką map' },
            { type: 'talk', nick: 'Zakonnik Równowagi', desc: 'Porozmawiaj z Zakonnik Równowagi' },
            { type: 'dialog', option: 4, desc: 'Wybierz 4 z opcji dialogowej' },
            { type: 'dialog_text', text: 'Kotowate', desc: 'Wybierz dialog dotyczący: Kotowate' },
            { type: 'dialog', option: 1, desc: 'Wybierz 1 z opcji dialogowej' },
        ],
        "[ZR]: Drapieżniki": [
            { type: 'talk', nick: 'Zakonnik Równowagi', desc: 'Porozmawiaj z Zakonnik Równowagi' },
            { type: 'dialog', option: 3, desc: 'Wybierz 3 z opcji dialogowej' },
            { type: 'dialog_text', text: 'Drapieżnicy', desc: 'Wybierz dialog dotyczący: Drapieżnicy' },
            { type: 'dialog', option: 1, desc: 'Wybierz 1 z opcji dialogowej' },
            { type: 'dialog', option: 1, desc: 'Wybierz 1 z opcji dialogowej' },
            { type: 'path', maps: [2, 12, 631], desc: 'Podążaj wyznaczoną ścieżką map' },
            { type: 'berserk', enabled: true, lvl: 20, desc: 'Włącz Berserk (Lvl 20)' },
            { type: 'hunt', uiName: 'Drapieżniki', mobs: ['Niedźwiedź czarny', 'Niedźwiedź brunatny', 'Niedźwiadek', 'Niedźwiedź szary', 'Gacek szary'], maps: [631, 147, 146, 145, 144, 143, 631], targetCount: 100, desc: 'Rozpocznij polowanie na moby' },
            { type: 'berserk', enabled: false, desc: 'Wyłącz Berserk po expieniu' },
            { type: 'path', maps: [[147, 146, 145, 144, 143, 631, 12, 2], [2521, 145, 144, 143, 631, 12, 2]], desc: 'Podążaj wyznaczoną ścieżką map' },
            { type: 'talk', nick: 'Zakonnik Równowagi', desc: 'Porozmawiaj z Zakonnik Równowagi' },
            { type: 'dialog', option: 4, desc: 'Wybierz 4 z opcji dialogowej' },
            { type: 'dialog_text', text: 'drapieżnikami ', desc: 'Wybierz dialog dotyczący: drapieżnikami' },
            { type: 'dialog', option: 1, desc: 'Wybierz 1 z opcji dialogowej' },
        ],
        "[ZR]: Bazyliszki": [
            { type: 'talk', nick: 'Zakonnik Równowagi', desc: 'Porozmawiaj z Zakonnik Równowagi' },
            { type: 'dialog', option: 3, desc: 'Wybierz 3 z opcji dialogowej' },
            { type: 'dialog_text', text: 'Leśne bazyliszki', desc: 'Wybierz dialog dotyczący: Leśne bazyliszki' },
            { type: 'dialog', option: 1, desc: 'Wybierz 1 z opcji dialogowej' },
            { type: 'dialog', option: 1, desc: 'Wybierz 1 z opcji dialogowej' },
            { type: 'path', maps: [2, 12, 631, 632], desc: 'Podążaj wyznaczoną ścieżką map' },
            { type: 'berserk', enabled: true, lvl: 23, desc: 'Włącz Berserk (Lvl 23)' },
            { type: 'hunt', uiName: 'Bazyliszki', mobs: ['Bazyliszek'], maps: [632], targetCount: 100, desc: 'Rozpocznij polowanie na moby' },
            { type: 'berserk', enabled: false, desc: 'Wyłącz Berserk po expieniu' },
            { type: 'path', maps: [632, 631, 12, 2], desc: 'Podążaj wyznaczoną ścieżką map' },
            { type: 'talk', nick: 'Zakonnik Równowagi', desc: 'Porozmawiaj z Zakonnik Równowagi' },
            { type: 'dialog', option: 4, desc: 'Wybierz 4 z opcji dialogowej' },
            { type: 'dialog_text', text: 'bazyliszków', desc: 'Wybierz dialog dotyczący: leśnych bazyliszków' },
            { type: 'dialog', option: 1, desc: 'Wybierz 1 z opcji dialogowej' },
        ],
        "[ZR]: Mulusy": [
            { type: 'talk', nick: 'Zakonnik Równowagi', desc: 'Porozmawiaj z Zakonnik Równowagi' },
            { type: 'dialog', option: 3, desc: 'Wybierz 3 z opcji dialogowej' },
            { type: 'dialog_text', text: 'Osada Mulusów', desc: 'Wybierz dialog dotyczący: Osada Mulusów' },
            { type: 'dialog', option: 1, desc: 'Wybierz 1 z opcji dialogowej' },
            { type: 'dialog', option: 1, desc: 'Wybierz 1 z opcji dialogowej' },
            { type: 'path', maps: [2, 1108, 1263, 1267], desc: 'Podążaj wyznaczoną ścieżką map' },
            { type: 'berserk', enabled: true, lvl: 22, desc: 'Włącz Berserk (Lvl 22)' },
            { type: 'hunt', uiName: 'Mulusy', mobs: ['Gula', 'Mulu'], maps: [1267, 3361, 1285, 3361, 1267], targetCount: 100, desc: 'Rozpocznij polowanie na moby' },
            { type: 'berserk', enabled: false, desc: 'Wyłącz Berserk po expieniu' },
            { type: 'path', maps: [1285, 3361, 1267, 1263, 1108, 2], desc: 'Podążaj wyznaczoną ścieżką map' },
            { type: 'talk', nick: 'Zakonnik Równowagi', desc: 'Porozmawiaj z Zakonnik Równowagi' },
            { type: 'dialog', option: 4, desc: 'Wybierz 4 z opcji dialogowej' },
            { type: 'dialog_text', text: 'dzikusów', desc: 'Wybierz dialog dotyczący: dzikusów' },
            { type: 'dialog', option: 1, desc: 'Wybierz 1 z opcji dialogowej' },
        ],
        "[ZR]: Demony": [
            { type: 'talk', nick: 'Zakonnik Równowagi', desc: 'Porozmawiaj z Zakonnik Równowagi' },
            { type: 'dialog', option: 3, desc: 'Wybierz 3 z opcji dialogowej' },
            { type: 'dialog_text', text: 'Demony zamieszkujące', desc: 'Wybierz dialog dotyczący: Demony zamieszkujące' },
            { type: 'dialog', option: 1, desc: 'Wybierz 1 z opcji dialogowej' },
            { type: 'dialog', option: 1, desc: 'Wybierz 1 z opcji dialogowej' },
            { type: 'path', maps: [2, 12, 3, 5733], desc: 'Podążaj wyznaczoną ścieżką map' },
            { type: 'berserk', enabled: true, lvl: 25, desc: 'Włącz Berserk (Lvl 25)' },
            { type: 'hunt', uiName: 'Demony', mobs: ['demon', 'bies'], maps: [5733, 5736, 5733, 5734, 5735, 5734, 5733, 5737, 5739, 5737], targetCount: 100, desc: 'Rozpocznij polowanie na moby' },
            { type: 'berserk', enabled: false, desc: 'Wyłącz Berserk po expieniu' },
            { type: 'path', maps: [[5736, 5733, 3, 12, 2], [5739, 5737, 5733, 3, 12, 2], [5735, 5734, 5733, 3, 12, 2]], desc: 'Podążaj wyznaczoną ścieżką map' },
            { type: 'talk', nick: 'Zakonnik Równowagi', desc: 'Porozmawiaj z Zakonnik Równowagi' },
            { type: 'dialog', option: 4, desc: 'Wybierz 4 z opcji dialogowej' },
            { type: 'dialog_text', text: 'demonom', desc: 'Wybierz dialog dotyczący: demonom' },
            { type: 'dialog', option: 1, desc: 'Wybierz 1 z opcji dialogowej' },
        ]
    };

    // ==========================================
    // ZMIENNE STANU BOTA
    // ==========================================
    let questNames = Object.keys(QUESTS_DATABASE);
    let currentQuestName = localStorage.getItem('margo_quest_active_name') || questNames[0];
    if (!QUESTS_DATABASE[currentQuestName]) currentQuestName = questNames[0];

    let currentStepIndex = 0;
    let isRunning = false;
    let sequenceInterval = null;
    let lastActionTime = 0;

    // Zmienna pamiętająca, czy bot włączył Berserka w skrypcie
    let botBerserkActive = false;

    // ==========================================
    // WBUDOWANY SYSTEM A* I SKANOWANIE ŚCIAN
    // ==========================================
    let cachedColMethod = null;
    let skanerMapId = null;

    function odnajdzUkrytaFunkcjeScian(w, h) {
        let col = Engine.map.col;
        if (!col) return null;
        if (typeof col.check === 'function') return (x, y) => col.check(x, y);
        if (typeof col.checkCollision === 'function') return (x, y) => col.checkCollision(x, y);
        if (typeof col.get === 'function') return (x, y) => {
            let val = col.get(x, y);
            return val !== 0 && val !== '0' && val !== false && val !== undefined && val !== null;
        };
        for (let key in col) {
            let ukryteDane = col[key];
            if (ukryteDane && (typeof ukryteDane === 'string' || Array.isArray(ukryteDane))) {
                if (ukryteDane.length === w * h) {
                    return (x, y) => {
                        let v = ukryteDane[x + y * w];
                        return v !== '0' && v !== 0 && v !== ' ';
                    };
                }
            }
        }
        if (typeof col === 'object') return (x, y) => col[x] && col[x][y];
        return null;
    }

    function czyPoleZablokowane(x, y) {
        if (typeof Engine === 'undefined' || !Engine.map || !Engine.map.d) return true;
        const w = Engine.map.d.x;
        const h = Engine.map.d.y;

        if (x < 0 || y < 0 || x >= w || y >= h) return true;

        if (skanerMapId !== Engine.map.d.id) {
            cachedColMethod = odnajdzUkrytaFunkcjeScian(w, h);
            skanerMapId = Engine.map.d.id;
        }

        if (cachedColMethod) return cachedColMethod(x, y);

        if (Engine.map.d.col && typeof Engine.map.d.col === 'string') {
            return Engine.map.d.col.charAt(x + y * w) !== '0';
        }
        return false;
    }

    function szukajDrogi(startX, startY, celX, celY, isBlockedFunc) {
        if (startX === celX && startY === celY) return [];

        let openSet = [{ x: startX, y: startY, g: 0, f: Math.abs(startX - celX) + Math.abs(startY - celY), parent: null }];
        let closedSet = new Set();
        let openMap = new Map();

        function getId(x, y) { return x + "," + y; }
        openMap.set(getId(startX, startY), openSet[0]);

        let iterations = 0;

        while (openSet.length > 0) {
            iterations++;
            if (iterations > 1500) return null;

            let minIndex = 0;
            for (let i = 1; i < openSet.length; i++) {
                if (openSet[i].f < openSet[minIndex].f) minIndex = i;
            }

            let current = openSet[minIndex];
            openSet.splice(minIndex, 1);
            openMap.delete(getId(current.x, current.y));

            if (current.x === celX && current.y === celY) {
                let path = [];
                let curr = current;
                while(curr.parent) { path.push({x: curr.x, y: curr.y}); curr = curr.parent; }
                return path.reverse();
            }

            closedSet.add(getId(current.x, current.y));

            let sasiedzi = [
                {x: current.x, y: current.y - 1}, {x: current.x, y: current.y + 1},
                {x: current.x - 1, y: current.y}, {x: current.x + 1, y: current.y}
            ];

            for (let s of sasiedzi) {
                if (isBlockedFunc(s.x, s.y) && !(s.x === celX && s.y === celY)) continue;

                let sId = getId(s.x, s.y);
                if (closedSet.has(sId)) continue;

                let g = current.g + 1;
                let existing = openMap.get(sId);

                if (!existing) {
                    let newNode = { x: s.x, y: s.y, g: g, f: g + Math.abs(s.x - celX) + Math.abs(s.y - celY), parent: current };
                    openSet.push(newNode);
                    openMap.set(sId, newNode);
                } else if (g < existing.g) {
                    existing.g = g;
                    existing.f = g + Math.abs(s.x - celX) + Math.abs(s.y - celY);
                    existing.parent = current;
                }
            }
        }
        return null;
    }
    // ==========================================

    // Pobieranie aktualnego lvla gracza
    function getHeroLevel() {
        if (typeof Engine !== 'undefined' && Engine.hero && Engine.hero.d) return Engine.hero.d.lvl;
        if (typeof hero !== 'undefined' && hero.lvl) return hero.lvl;
        return 1;
    }

    // Funkcja pobierająca aktualną sekwencję kroków
    function getActiveSequence() {
        return QUESTS_DATABASE[currentQuestName] || [];
    }

    // Ulepszona funkcja pomocnicza do interakcji
    function forceInteract(target) {
        if (!target) return;

        let mockEvent = { preventDefault: () => {}, stopPropagation: () => {}, button: 2 };

        if (typeof target.onclick === 'function') {
            target.onclick(mockEvent);
        } else if (target.d && target.d.isGw) {
            let gwObj = Engine.map.gateways.getList().find(g => g.d && g.d.id === target.d.id);
            if (gwObj && typeof gwObj.onclick === 'function') gwObj.onclick(mockEvent);
        } else if (target.emit) {
            target.emit('interact');
        } else if (typeof Engine !== 'undefined' && Engine.hero && typeof Engine.hero.interact === 'function') {
            Engine.hero.interact(target.d.id);
        } else {
            console.warn("[Bot] Obiekt nie posiada wspieranej metody interakcji!");
        }
    }

    function rebuildStepSelect() {
        const stepSelect = document.getElementById('quest-step-select');
        if (!stepSelect) return;

        stepSelect.innerHTML = '';
        const sequence = getActiveSequence();

        sequence.forEach((step, index) => {
            let opt = document.createElement('option');
            opt.value = index;
            opt.innerText = `[Krok ${index + 1}] ${step.desc}`;
            stepSelect.appendChild(opt);
        });
        stepSelect.value = currentStepIndex;
    }

    function updateDisplay() {
        const statusEl = document.getElementById('quest-bot-status');
        const stepEl = document.getElementById('quest-bot-step');
        const stepSelect = document.getElementById('quest-step-select');
        const sequence = getActiveSequence();

        if (stepSelect) stepSelect.value = currentStepIndex;

        if (currentStepIndex >= sequence.length) {
            if (stepEl) stepEl.innerText = "Quest ukończony! 🎉";
            if (statusEl) {
                statusEl.innerText = "Zakończono";
                statusEl.style.color = "#2ecc71";
            }
            isRunning = false;
            clearInterval(sequenceInterval);
            const toggleBtn = document.getElementById('quest-toggle-btn');
            if (toggleBtn) {
                toggleBtn.innerHTML = "▶ START";
                toggleBtn.style.background = "#27ae60";
            }
            return;
        }

        const currentStep = sequence[currentStepIndex];
        if (stepEl && currentStep) {
            stepEl.innerText = `Krok ${currentStepIndex + 1}: ${currentStep.desc || currentStep.type}`;
        }
    }

    // ==========================================
    // GŁÓWNA PĘTLA PROCESUJĄCA KROKI
    // ==========================================
    function processSequence() {
        let now = Date.now();
        if (now < lastActionTime) return;

        const currentMap = Engine.map.d ? parseInt(Engine.map.d.id, 10) : 0;

        if (typeof Engine !== 'undefined' && Engine.battle && Engine.battle.show) {
            let fastFightBtn = document.querySelector('.auto-fight-btn');
            if (!Engine.battle._botAutoFought) {
                if (fastFightBtn) {
                    fastFightBtn.click();
                    Engine.battle._botAutoFought = true;
                    lastActionTime = now + 1500;
                } else {
                    lastActionTime = now + 500;
                }
            } else {
                lastActionTime = now + 500;
            }
            return;
        } else if (typeof Engine !== 'undefined' && Engine.battle) {
            Engine.battle._botAutoFought = false;
        }

        const sequence = getActiveSequence();
        if (currentStepIndex >= sequence.length) {
            updateDisplay();
            return;
        }

        let step = sequence[currentStepIndex];
        updateDisplay();

        // Skróty do współrzędnych gracza (często używane przy A*)
        const graczX = Engine.hero.d.x;
        const graczY = Engine.hero.d.y;

        switch (step.type) {
            case 'dialog_text':
                let dialogueOptions = Array.from(document.querySelectorAll('.dialogue-window-answer, .dialog-answer, .answer'))
                                           .filter(el => el.offsetParent !== null);

                if (dialogueOptions.length > 0) {
                    let foundIndex = dialogueOptions.findIndex(el => {
                        let textContent = el.innerText || el.textContent;
                        return textContent.toLowerCase().includes(step.text.toLowerCase());
                    });

                    if (foundIndex !== -1) {
                        if (typeof Engine !== 'undefined' && Engine.dialogue && typeof Engine.dialogue.choose === 'function') {
                            try {
                                Engine.dialogue.choose(foundIndex);
                                currentStepIndex++;
                                lastActionTime = now + 1000;
                                break;
                            } catch(e) {
                                console.error("[Bot] Błąd Engine.dialogue.choose:", e);
                            }
                        }
                        dialogueOptions[foundIndex].click();
                        currentStepIndex++;
                        lastActionTime = now + 1000;
                    } else {
                        console.warn(`[Bot] Nie znaleziono opcji dialogowej zawierającej: "${step.text}"`);
                        lastActionTime = now + 1000;
                    }
                } else {
                    lastActionTime = now + 500;
                }
                break;

            case 'path':
                let nowTimePath = Date.now();
                if (!step.maps || step.maps.length === 0) {
                    console.error("[Bot] Błąd: Brak tablicy maps w akcji 'path'.");
                    currentStepIndex++;
                    break;
                }

                // 1. USTALENIE CELU (sprawdzamy czy to zwykła tablica, czy tablica w tablicy)
                let isMultiPath = Array.isArray(step.maps[0]);

                // Ostatnia mapa z pierwszej dostępnej ścieżki to nasz ostateczny cel
                let finalMap = isMultiPath ? step.maps[0][step.maps[0].length - 1] : step.maps[step.maps.length - 1];

                let pathStatusEl = document.getElementById('quest-bot-status');
                if (pathStatusEl) {
                    pathStatusEl.innerText = `Trasa: Cel -> ${finalMap}`;
                    pathStatusEl.style.color = "#3498db";
                }

                // 2. SPRAWDZENIE CZY JESTEŚMY U CELU
                if (currentMap === finalMap) {
                    console.log(`[Bot] Dotarto do celu trasy: ${finalMap}`);
                    currentStepIndex++;
                    lastActionTime = nowTimePath + 500;
                    break;
                }

                // 3. SZUKANIE NASTĘPNEJ MAPY
                let nextMapId = null;

                if (isMultiPath) {
                    // ZAAWANSOWANE: Znajdź pierwszą ścieżkę, która zawiera obecną mapę,
                    // i na której obecna mapa NIE JEST jej ostatnim elementem
                    let activePath = step.maps.find(p => p.includes(currentMap) && p.indexOf(currentMap) < p.length - 1);
                    if (activePath) {
                        nextMapId = activePath[activePath.indexOf(currentMap) + 1];
                    }
                } else {
                    // KLASYCZNE: Zwykła płaska tablica
                    let mapIndex = step.maps.indexOf(currentMap);
                    if (mapIndex !== -1 && mapIndex < step.maps.length - 1) {
                        nextMapId = step.maps[mapIndex + 1];
                    }
                }

                // 4. IDZIEMY DO BRAMKI
                if (nextMapId !== null) {
                    let gates = Engine.map.gateways.getList();
                    let celBramka = gates.find(g => g.d && (parseInt(g.d.target) === nextMapId || parseInt(g.d.id) === nextMapId));

                    if (celBramka) {
                        let dX = Math.abs(graczX - celBramka.d.x);
                        let dY = Math.abs(graczY - celBramka.d.y);

                        if (dX > 1 || dY > 1) {
                            Engine.hero.autoGoTo({ x: celBramka.d.x, y: celBramka.d.y });
                            lastActionTime = nowTimePath + 800;
                        } else {
                            forceInteract(celBramka);
                            console.log(`[Bot] Podążam trasą. Przechodzę na mapę: ${nextMapId}`);
                            lastActionTime = nowTimePath + 2500;
                        }
                    } else {
                        console.warn(`[Bot] Na trasie, ale nie widzę bramki na mapę ${nextMapId}!`);
                        if (pathStatusEl) pathStatusEl.innerText = `Brak przejścia do ${nextMapId}`;
                        lastActionTime = nowTimePath + 1000;
                    }
                } else {
                    console.warn(`[Bot] Zgubiłem się! Obecna mapa (${currentMap}) nie należy do trasy.`);
                    if (pathStatusEl) {
                        pathStatusEl.innerText = `Zgubiono trasę!`;
                        pathStatusEl.style.color = "#e74c3c";
                    }
                    lastActionTime = nowTimePath + 2000;
                }
                break;

            case 'hunt':
                let nowTime = Date.now();
                if (step.killedCount === undefined) step.killedCount = 0;

                let uiKills = -1, uiTarget = step.targetCount || 0, uiDone = false;
                let missionElements = document.querySelectorAll('.one-quest-mission.mission-type-2 .one-name');
                for (let el of missionElements) {
                    let text = el.innerText.trim();
                    let searchPhrases = step.uiName ? [step.uiName] : step.mobs;
                    if (searchPhrases.some(m => text.toLowerCase().includes(m.toLowerCase()))) {
                        if (el.closest('.one-quest-mission').classList.contains('quest-done')) uiDone = true;
                        let match = text.match(/\((\d+)\/(\d+)\)/);
                        if (match) { uiKills = parseInt(match[1], 10); uiTarget = parseInt(match[2], 10); }
                        break;
                    }
                }
                if (uiKills !== -1) { step.killedCount = uiKills; step.targetCount = uiTarget; }

                if (uiDone || (step.targetCount > 0 && step.killedCount >= step.targetCount)) {
                    console.log(`[Hunt] Quest ukończony!`);
                    currentStepIndex++;
                    lastActionTime = nowTime + 500;
                    break;
                }

                let npcs = Object.values(Engine.npcs.check());
                let kandydaci = [];

                // Dodano wyliczanie matematycznego dystansu w pierwszej kolejności
                for (let n of npcs) {
                    if (n.d && (n.d.type === 2 || n.d.type === 3) && step.mobs.some(m => n.d.nick.toLowerCase().includes(m.toLowerCase()))) {
                        let prosta = Math.abs(graczX - n.d.x) + Math.abs(graczY - n.d.y);
                        kandydaci.push({ obj: n, prosta: prosta });
                    }
                }

                // Optymalizacja A* z poprzednich wersji:
                kandydaci.sort((a, b) => a.prosta - b.prosta);

                let tMob = null;
                let minDystans = Infinity;

                for (let mob of kandydaci) {
                    if (mob.prosta >= minDystans) break;
                    let sciezka = szukajDrogi(graczX, graczY, mob.obj.d.x, mob.obj.d.y, czyPoleZablokowane);
                    if (sciezka !== null) {
                        let dystansKrokowy = sciezka.length;
                        if (dystansKrokowy < minDystans) {
                            minDystans = dystansKrokowy;
                            tMob = mob.obj;
                        }
                    }
                }

                let isMoving = (Engine.hero.opt && Engine.hero.opt.go);

                if (tMob) {
                    let dX = Math.abs(graczX - tMob.d.x);
                    let dY = Math.abs(graczY - tMob.d.y);

                    if (dX > 1 || dY > 1) {
                        if (!isMoving) {
                            console.log(`[Hunt] Biegnę do: ${tMob.d.nick} na [${tMob.d.x}, ${tMob.d.y}]`);
                            Engine.hero.autoGoTo({ x: tMob.d.x, y: tMob.d.y });
                            lastActionTime = nowTime + 1000;
                        } else {
                            lastActionTime = nowTime + 500;
                        }
                    } else {
                        // BOT DECYDUJE: Jeśli berserk OFF to bije ręcznie. Jeśli ON, tylko stoi.
                        if (!botBerserkActive) {
                            console.log(`[Hunt] Biję (Aktywny atak): ${tMob.d.nick}`);
                            forceInteract(tMob);
                            if (uiKills === -1) step.killedCount++;
                            lastActionTime = nowTime + 2000;
                        } else {
                            console.log(`[Hunt] Stoję i czekam aż zaatakuje mnie ${tMob.d.nick} (Berserk)...`);
                            lastActionTime = nowTime + 1000;
                        }
                    }
                } else {
                    console.log("[Hunt] Nie widzę mobów z bezpieczną ścieżką, szukam bramki.");
                    if(step.maps && step.maps.length > 0) {
                        if(step.currentRouteIndex === undefined) step.currentRouteIndex = 0;
                        let nextMapId = step.maps[step.currentRouteIndex + 1];
                        let gates = Engine.map.gateways.getList();
                        let celBramka = gates.find(g => g.d && (parseInt(g.d.target) === nextMapId || parseInt(g.d.id) === nextMapId));

                        if (celBramka) {
                            console.log(`[Hunt] Idę do bramki na mapę: ${nextMapId}`);
                            Engine.hero.autoGoTo({ x: celBramka.d.x, y: celBramka.d.y });
                            lastActionTime = nowTime + 1000;
                        } else {
                            step.currentRouteIndex = (step.currentRouteIndex + 1) % step.maps.length;
                            lastActionTime = nowTime + 1000;
                        }
                    }
                }
                break;

            case 'bramka':
                if (currentMap === step.targetMapId) {
                    console.log(`[Bot] Jesteśmy na mapie: ${step.targetMapId}. Przechodzę dalej.`);
                    currentStepIndex++;
                    lastActionTime = now + 500;
                    break;
                }
                let gates = Engine.map.gateways.getList();
                let celBramka = gates.find(b =>
                    b.d &&
                    (parseInt(b.d.id) === step.targetMapId || parseInt(b.d.target) === step.targetMapId)
                );

                if (celBramka) {
                    let dX = Math.abs(graczX - celBramka.d.x);
                    let dY = Math.abs(graczY - celBramka.d.y);

                    if (dX > 1 || dY > 1) {
                        Engine.hero.autoGoTo({ x: celBramka.d.x, y: celBramka.d.y });
                        lastActionTime = now + 800;
                    } else {
                        forceInteract(celBramka);
                        console.log(`[Bot] Kliknięto bramkę prowadzącą do ID: ${step.targetMapId}`);
                        lastActionTime = now + 2500;
                    }
                } else if (step.x !== undefined && step.y !== undefined) {
                    Engine.hero.autoGoTo({ x: step.x, y: step.y });
                    lastActionTime = now + 800;
                } else {
                    console.warn(`[Bot] Nie widzę bramki o ID: ${step.targetMapId}`);
                    lastActionTime = now + 1000;
                }
                break;

            case 'sleep':
                let sleepTime = step.time || 1000;
                console.log(`[Bot] Śpię przez ${sleepTime}ms`);
                lastActionTime = now + sleepTime;
                currentStepIndex++;
                break;

            case 'craft_close':
                let craftCloseBtn = document.querySelector('.barter-window.window-on-peak .close-button');
                if (craftCloseBtn) {
                    craftCloseBtn.click();
                    currentStepIndex++;
                    lastActionTime = now + 1000;
                } else {
                    currentStepIndex++;
                    lastActionTime = now + 500;
                }
                break;

            case 'craft_use':
                let allButtons = Array.from(document.querySelectorAll('.button'));
                let useBtn = allButtons.find(b => b.innerText.trim() === "Użyj");
                if (useBtn) {
                    useBtn.click();
                    currentStepIndex++;
                    lastActionTime = now + 1000;
                } else {
                    lastActionTime = now + 500;
                }
                break;

            case 'craft_item':
                let recipes = Array.from(document.querySelectorAll('.crafting-recipe-in-list'));
                let targetRecipe = recipes.find(el => {
                    let nameEl = el.querySelector('.name');
                    return nameEl && nameEl.innerText.includes(step.itemName);
                });

                if (targetRecipe) {
                    if (targetRecipe.classList.contains('active')) {
                        let craftBtn = document.querySelector('.do-recipe');
                        if (craftBtn) {
                            craftBtn.click();
                            currentStepIndex++;
                            lastActionTime = now + 1000;
                        } else {
                            lastActionTime = now + 500;
                        }
                    } else {
                        targetRecipe.click();
                        lastActionTime = now + 500;
                    }
                } else {
                    lastActionTime = now + 1000;
                }
                break;

            case 'move_bag':
                let sourceItem = document.querySelector(`.item-tpl-${step.tpl}`);
                let targetSlot = document.querySelector(`.${step.target}`);
                if (sourceItem && targetSlot) {
                    let sRect = sourceItem.getBoundingClientRect();
                    let tRect = targetSlot.getBoundingClientRect();
                    sourceItem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: sRect.left + 16, clientY: sRect.top + 16 }));
                    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: tRect.left + 16, clientY: tRect.top + 16 }));
                    targetSlot.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: tRect.left + 16, clientY: tRect.top + 16 }));
                    currentStepIndex++;
                    lastActionTime = now + 1000;
                } else {
                    lastActionTime = now + 1000;
                }
                break;

            case 'shop_close':
                let allWindows = document.querySelectorAll('.c-window');
                let shopWindow = Array.from(allWindows).find(win => {
                    let header = win.querySelector('.header-label .text');
                    return header && header.innerText.includes("Sklep");
                });

                if (shopWindow) {
                    let closeBtn = shopWindow.querySelector('.close-button-corner-decor .close-button');
                    if (closeBtn) {
                        closeBtn.click();
                        currentStepIndex++;
                        lastActionTime = now + 1000;
                    } else {
                        currentStepIndex++;
                        lastActionTime = now + 500;
                    }
                } else {
                    currentStepIndex++;
                    lastActionTime = now + 500;
                }
                break;

            case 'shop_buy':
                let itemToBuy = document.querySelector(`.shop-items .item-id-${step.itemId}`);
                if (itemToBuy) {
                    itemToBuy.click();
                    currentStepIndex++;
                    lastActionTime = now + 500;
                } else {
                    lastActionTime = now + 1000;
                }
                break;

            case 'shop_accept':
                let acceptBtn = Array.from(document.querySelectorAll('.finalize-button .button'))
                                     .find(el => el.innerText.includes("Akceptuj"));

                if (acceptBtn) {
                    acceptBtn.click();
                    currentStepIndex++;
                    lastActionTime = now + 1000;
                } else {
                    lastActionTime = now + 500;
                }
                break;

            case 'alert_confirm':
                let btnClass = (step.option === 'no') ? '.alert-cancel-hotkey' : '.alert-accept-hotkey';
                let alertBtn = document.querySelector(btnClass);

                if (alertBtn) {
                    alertBtn.click();
                    currentStepIndex++;
                    lastActionTime = now + 1000;
                } else {
                    lastActionTime = now + 500;
                }
                break;

            case 'choose_prof':
                let outfitCards = document.querySelectorAll('.outfit-card');

                if (outfitCards.length > 0) {
                    let targetCard = Array.from(outfitCards).find(card => {
                        let textEl = card.querySelector('.text');
                        return textEl && textEl.innerText.trim().toLowerCase() === step.profName.toLowerCase();
                    });

                    if (targetCard) {
                        let borderEl = targetCard.querySelector('.outfit-border');

                        if (borderEl && borderEl.classList.contains('active')) {
                            let confirmBtn = document.querySelector('.button.confirmButton');

                            if (confirmBtn && !confirmBtn.classList.contains('disable')) {
                                confirmBtn.click();
                                currentStepIndex++;
                                lastActionTime = now + 1500;
                            } else {
                                lastActionTime = now + 300;
                            }
                        } else {
                            targetCard.click();
                            lastActionTime = now + 500;
                        }
                    } else {
                        lastActionTime = now + 1000;
                    }
                } else {
                    lastActionTime = now + 500;
                }
                break;

            case 'follow_arrow':
                if (!window._celQuesta && typeof Engine.targets.getTargets === 'function') {
                    let tgts = Engine.targets.getTargets();
                    let k = Object.keys(tgts)[0];
                    if (k && tgts[k]) window._celQuesta = { x: tgts[k].x, y: tgts[k].y };
                }

                if (window._celQuesta) {
                    let cel = window._celQuesta;
                    let distX = Math.abs(graczX - cel.x);
                    let distY = Math.abs(graczY - cel.y);

                    // Zastosowano Skaner Ścian zamiast starego Engine.map.col.check()
                    let isCollision = czyPoleZablokowane(cel.x, cel.y);
                    let targetDist = isCollision ? 1 : 0;

                    if (distX <= targetDist && distY <= targetDist) {
                        currentStepIndex++;
                        lastActionTime = now + 500;
                    } else {
                        Engine.hero.autoGoTo(cel);
                        lastActionTime = now + 800;
                    }
                } else {
                    lastActionTime = now + 1000;
                }
                break;

            case 'move':
                let mDistX = Math.abs(graczX - step.x);
                let mDistY = Math.abs(graczY - step.y);
                if (mDistX <= 1 && mDistY <= 1) {
                    currentStepIndex++;
                    lastActionTime = now + 200;
                } else {
                    Engine.hero.autoGoTo({ x: step.x, y: step.y });
                    lastActionTime = now + 1000;
                }
                break;

            case 'talk':
                let npcsTalk = Object.values(Engine.npcs.check()).filter(n => n.d && n.d.nick.toLowerCase().includes(step.nick.toLowerCase()));
                let gws = Engine.map.gateways.getList().filter(g => g.d && g.tip && g.tip[0].toLowerCase().includes(step.nick.toLowerCase()));

                let talkCandidates = [
                    ...npcsTalk.map(n => ({ d: n.d, obj: n, type: 'npc' })),
                    ...gws.map(g => ({ d: g.d, obj: g, type: 'gateway' }))
                ];

                if (step.x !== undefined && step.y !== undefined) {
                    talkCandidates = talkCandidates.filter(c => c.d.x === step.x && c.d.y === step.y);
                }

                // Dodano logikę zoptymalizowanego A* do podchodzenia do NPC
                talkCandidates.forEach(c => {
                    c.prosta = Math.abs(graczX - c.d.x) + Math.abs(graczY - c.d.y);
                });
                talkCandidates.sort((a, b) => a.prosta - b.prosta);

                let tTarget = null;
                let minTalkDist = Infinity;

                for (let c of talkCandidates) {
                    if (c.prosta >= minTalkDist) break;
                    let sciezka = szukajDrogi(graczX, graczY, c.d.x, c.d.y, czyPoleZablokowane);
                    if (sciezka !== null) {
                        if (sciezka.length < minTalkDist) {
                            minTalkDist = sciezka.length;
                            tTarget = c;
                        }
                    }
                }

                if (tTarget) {
                    let dX = Math.abs(graczX - tTarget.d.x);
                    let dY = Math.abs(graczY - tTarget.d.y);

                    if (dX > 1 || dY > 1) {
                        Engine.hero.autoGoTo({ x: tTarget.d.x, y: tTarget.d.y });
                        lastActionTime = now + 800;
                    } else {
                        let interactObj = (tTarget.type === 'npc') ? tTarget.obj : { d: tTarget.d, onclick: tTarget.obj.onclick };
                        forceInteract(interactObj);
                        currentStepIndex++;
                        lastActionTime = now + 1500;
                    }
                } else {
                    lastActionTime = now + 1000;
                }
                break;

            case 'attack':
                let npcsAttack = Object.values(Engine.npcs.check());
                let aTarget = null;

                if (step.targetId) {
                    aTarget = npcsAttack.find(n => n.d && n.d.id === step.targetId);
                } else {
                    // Dodano logikę zoptymalizowanego A* dla precyzyjnego ataku
                    let candidates = npcsAttack.filter(n => {
                        if (!n.d || !(n.d.type === 2 || n.d.type === 3) || !n.d.nick.toLowerCase().includes(step.nick.toLowerCase())) return false;
                        if (step.x !== undefined && step.y !== undefined) {
                            return n.d.x === step.x && n.d.y === step.y;
                        }
                        return true;
                    }).map(n => ({ obj: n, prosta: Math.abs(graczX - n.d.x) + Math.abs(graczY - n.d.y) }));

                    candidates.sort((a,b) => a.prosta - b.prosta);
                    let minAttackDist = Infinity;

                    for(let c of candidates) {
                        if(c.prosta >= minAttackDist) break;
                        let sciezka = szukajDrogi(graczX, graczY, c.obj.d.x, c.obj.d.y, czyPoleZablokowane);
                        if (sciezka !== null) {
                            if(sciezka.length < minAttackDist) {
                                minAttackDist = sciezka.length;
                                aTarget = c.obj;
                            }
                        }
                    }
                    if (aTarget) step.targetId = aTarget.d.id;
                }

                if (aTarget) {
                    let dX = Math.abs(graczX - aTarget.d.x);
                    let dY = Math.abs(graczY - aTarget.d.y);

                    if (dX > 1 || dY > 1) {
                        Engine.hero.autoGoTo({ x: aTarget.d.x, y: aTarget.d.y });
                        lastActionTime = now + 800;
                    } else {
                        forceInteract(aTarget);
                        lastActionTime = now + 2000;
                    }
                } else {
                    if (step.targetId) {
                        console.log(`[Bot] Cel pokonany! Przechodzę dalej.`);
                        currentStepIndex++;
                        delete step.targetId;
                        lastActionTime = now + 500;
                    } else {
                        let questStatus = document.getElementById('quest-bot-status');
                        if (questStatus) questStatus.innerText = "Czekam na potwora...";
                        lastActionTime = now + 1000;
                    }
                }
                break;

            case 'equip':
                let itemElement = document.querySelector(`.item-tpl-${step.tpl}.inventory-item`);
                if (itemElement) {
                    let event = new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window });
                    itemElement.dispatchEvent(event);
                    currentStepIndex++;
                    lastActionTime = now + 1000;
                } else {
                    currentStepIndex++;
                    lastActionTime = now + 500;
                }
                break;

            case 'dialog':
                let opcje = Array.from(document.querySelectorAll('.dialogue-window-answer, .dialog-answer, .answer'))
                                 .filter(el => el.offsetParent !== null);

                if (opcje.length > 0) {
                    if (typeof Engine !== 'undefined' && Engine.dialogue && typeof Engine.dialogue.choose === 'function') {
                        try {
                            Engine.dialogue.choose(step.option - 1);
                            currentStepIndex++;
                            lastActionTime = now + 1000;
                            break;
                        } catch(e) {}
                    }

                    if (opcje.length >= step.option) {
                        opcje[step.option - 1].click();
                        currentStepIndex++;
                        lastActionTime = now + 1000;
                    } else {
                        lastActionTime = now + 1000;
                    }
                } else {
                    lastActionTime = now + 500;
                }
                break;

            case 'wait_map':
                if (Engine.map && Engine.map.d && Engine.map.d.name.includes(step.mapName)) {
                    currentStepIndex++;
                    lastActionTime = now + 500;
                } else {
                    lastActionTime = now + 1000;
                }
                break;

            case 'berserk':
                let isEnabled = step.enabled !== false;
                let targetLvl = step.lvl || 1;
                let heroLvl = getHeroLevel();
                let minLvl = targetLvl - heroLvl;
                let maxLvl = 13;

                // Zapisujemy w pamięci bota stan berserka - to kontroluje czy bot sam klika
                botBerserkActive = isEnabled;

                if (typeof window._g === 'function') {
                    window._g(`settings&action=update&id=34&v=${isEnabled ? 1 : 0}`);
                    window._g(`settings&action=update&id=35&v=${isEnabled ? 1 : 0}`);

                    if (isEnabled) {
                        window._g(`settings&action=update&id=34&key=lvlmin&v=${minLvl}`);
                        window._g(`settings&action=update&id=35&key=lvlmin&v=${minLvl}`);
                        window._g(`settings&action=update&id=34&key=lvlmax&v=${maxLvl}`);
                        window._g(`settings&action=update&id=35&key=lvlmax&v=${maxLvl}`);
                    }
                }

                console.log(`[Bot] Berserk: ${isEnabled ? 'WŁ (Od: ' + targetLvl + ' lvl)' : 'WYŁ'}`);

                currentStepIndex++;
                lastActionTime = now + 500;
                break;
        }
    }
})();
