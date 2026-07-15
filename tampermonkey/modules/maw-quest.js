// ═══════════════════════════════════════════════════════════════
//  MAW MODULE: Quest + Dialog + SI Auto-Grupka
//  Dane z: QUEST.txt, dialogi.txt, TAJNE.TXT
//
//  DIALOG (dialogi.txt):
//   - okno: .dialogue-window.is-open
//   - odpowiedzi: li.dialogue-window-answer.line_option / line_exit / line_cont_quest
//   - tekst odpowiedzi: span.answer-text
//   - BRAK data-answer-id — tylko DOM click
//
//  QUEST (QUEST.txt):
//   - śledzony: .quest-observe-list .one-observe.quest-tracked
//   - klasa questa: quest-observe-{id} + quest-tracked
//   - misja type-13: "Udaj się do:" (LOKACJA — brama, nie NPC!)
//   - misja type-17: "Porozmawiaj z:" (NPC — szukaj po nazwie)
//
//  CAPTCHA (dialogi.txt linia 96-121):
//   - pytanie: .captcha__question (tekst: "Zaznacz wszystkie odpowiedzi z gwiazdką")
//   - przyciski: .captcha__buttons .button .label (tekst np. "*a*", "@b@", "*c*")
//   - gwiazdki: tekst zawiera "*" na początku I końcu np. "*a*"
//   - potwierdzenie: .captcha__confirm .button
//
//  Wymaga: window.MAW_CTX
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';
    function waitCtx(cb, n) {
        if (window.MAW_CTX) return cb(window.MAW_CTX);
        if ((n || 0) > 200) return;
        setTimeout(function () { waitCtx(cb, (n || 0) + 1); }, 50);
    }
    waitCtx(function (ctx) {
        var IFACE = ctx.IFACE, $w = ctx.$w, settings = ctx.settings,
            log = ctx.log, click = ctx.clickElementHelper,
            heroGoTo = ctx.heroGoTo, decodeTip = ctx.decodeTip,
            hasNewEngine = ctx.hasNewEngine, isInBattle = ctx.isInBattle;

        var lastDlg = 0;
        window._mawQuestNpc = null;    // nazwa NPC do rozmowy
        window._mawQuestLoc = null;    // nazwa lokacji do przejścia

        // ══════════════════════════════════════════════════════
        //  scanTrackedQuest
        //  Czyta śledzone zadanie z .quest-observe-list
        //  (patrz QUEST.txt linia 228-246)
        // ══════════════════════════════════════════════════════
        function scanTrackedQuest() {
            // Metoda 1: obserwowane okno (miniaturka)
            var tracked = document.querySelector('.quest-observe-list .one-observe.quest-tracked');
            if (tracked) {
                var cls = Array.from(tracked.classList).find(function(c){ return c.startsWith('quest-observe-'); });
                var id = cls ? cls.replace('quest-observe-', '') : null;
                var name = (tracked.querySelector('.one-observe__title.full') ||
                            tracked.querySelector('.one-observe__title') || {}).textContent || '';
                var desc = (tracked.querySelector('.quest-description.full') ||
                            tracked.querySelector('.quest-description') || {}).textContent || '';
                var ms = [];
                tracked.querySelectorAll('.one-quest-mission').forEach(function(m) {
                    var tc = Array.from(m.classList).find(function(c){ return c.startsWith('mission-type-'); });
                    ms.push({
                        done: m.classList.contains('quest-done'),
                        type: tc ? parseInt(tc.replace('mission-type-', ''), 10) : 0,
                        label: ((m.querySelector('.mission-type-label') || {}).textContent || '').trim(),
                        npcName: ((m.querySelector('.one-name') || {}).textContent || '').trim()
                    });
                });
                return { id: id, name: name.trim(), desc: desc.trim(), missions: ms };
            }

            // Metoda 2: dziennik zadań (button-tracking-id-X.window-is-open)
            var tb = document.querySelector('[class*="button-tracking-id-"].window-is-open');
            if (tb) {
                var m2 = tb.className.match(/button-tracking-id-(\d+)/);
                var qid = m2 ? m2[1] : null;
                var row = tb.closest('.one-new-quests');
                if (row) {
                    var qn = (row.querySelector('.quest-name') || {}).textContent || '';
                    var qd = (row.querySelector('.quest-description') || {}).textContent || '';
                    var qms = [];
                    row.querySelectorAll('.one-quest-mission').forEach(function(m) {
                        var tc2 = Array.from(m.classList).find(function(c){ return c.startsWith('mission-type-'); });
                        qms.push({
                            done: m.classList.contains('quest-done'),
                            type: tc2 ? parseInt(tc2.replace('mission-type-', ''), 10) : 0,
                            label: ((m.querySelector('.mission-type-label') || {}).textContent || '').trim(),
                            npcName: ((m.querySelector('.one-name') || {}).textContent || '').trim()
                        });
                    });
                    return { id: qid, name: qn.trim(), desc: qd.trim(), missions: qms };
                }
            }
            return null;
        }

        // ══════════════════════════════════════════════════════
        //  autoQuestNpcClick
        //  Szuka NPC po nazwie, idzie do niego i rozmawia
        //  Engine.hero.sendRequestToTalk(id) z TAJNE.TXT
        // ══════════════════════════════════════════════════════
        // ==========================================
        // WBUDOWANY SYSTEM A* I SKANOWANIE ŚCIAN
        // ==========================================
        var cachedColMethod = null;
        var skanerMapId = null;

        function odnajdzUkrytaFunkcjeScian(w, h) {
            var col = $w.Engine && $w.Engine.map ? $w.Engine.map.col : null;
            if (!col) return null;
            if (typeof col.check === 'function') return function(x, y) { return col.check(x, y); };
            if (typeof col.checkCollision === 'function') return function(x, y) { return col.checkCollision(x, y); };
            if (typeof col.get === 'function') return function(x, y) {
                var val = col.get(x, y);
                return val !== 0 && val !== '0' && val !== false && val !== undefined && val !== null;
            };
            for (var key in col) {
                var ukryteDane = col[key];
                if (ukryteDane && (typeof ukryteDane === 'string' || Array.isArray(ukryteDane))) {
                    if (ukryteDane.length === w * h) {
                        return function(x, y) {
                            var v = ukryteDane[x + y * w];
                            return v !== '0' && v !== 0 && v !== ' ';
                        };
                    }
                }
            }
            if (typeof col === 'object') return function(x, y) { return col[x] && col[x][y]; };
            return null;
        }

        function czyPoleZablokowane(x, y) {
            if (typeof $w.Engine === 'undefined' || !$w.Engine.map || !$w.Engine.map.d) return true;
            var w = $w.Engine.map.d.x;
            var h = $w.Engine.map.d.y;

            if (x < 0 || y < 0 || x >= w || y >= h) return true;

            if (skanerMapId !== $w.Engine.map.d.id) {
                cachedColMethod = odnajdzUkrytaFunkcjeScian(w, h);
                skanerMapId = $w.Engine.map.d.id;
            }

            if (cachedColMethod) return cachedColMethod(x, y);

            if ($w.Engine.map.d.col && typeof $w.Engine.map.d.col === 'string') {
                return $w.Engine.map.d.col.charAt(x + y * w) !== '0';
            }
            return false;
        }

        function szukajDrogi(startX, startY, celX, celY, isBlockedFunc) {
            if (startX === celX && startY === celY) return [];

            var openSet = [{ x: startX, y: startY, g: 0, f: Math.abs(startX - celX) + Math.abs(startY - celY), parent: null }];
            var closedSet = {};
            var openMap = {};

            function getId(x, y) { return x + "," + y; }
            openMap[getId(startX, startY)] = openSet[0];

            var iterations = 0;

            while (openSet.length > 0) {
                iterations++;
                if (iterations > 1500) return null;

                var minIndex = 0;
                for (var i = 1; i < openSet.length; i++) {
                    if (openSet[i].f < openSet[minIndex].f) minIndex = i;
                }

                var current = openSet[minIndex];
                openSet.splice(minIndex, 1);
                delete openMap[getId(current.x, current.y)];

                if (current.x === celX && current.y === celY) {
                    var path = [];
                    var curr = current;
                    while(curr.parent) { path.push({x: curr.x, y: curr.y}); curr = curr.parent; }
                    return path.reverse();
                }

                closedSet[getId(current.x, current.y)] = true;

                var sasiedzi = [
                    {x: current.x, y: current.y - 1}, {x: current.x, y: current.y + 1},
                    {x: current.x - 1, y: current.y}, {x: current.x + 1, y: current.y}
                ];

                for (var s = 0; s < sasiedzi.length; s++) {
                    var ns = sasiedzi[s];
                    if (isBlockedFunc(ns.x, ns.y) && !(ns.x === celX && ns.y === celY)) continue;

                    var sId = getId(ns.x, ns.y);
                    if (closedSet[sId]) continue;

                    var g = current.g + 1;
                    var existing = openMap[sId];

                    if (!existing) {
                        var newNode = { x: ns.x, y: ns.y, g: g, f: g + Math.abs(ns.x - celX) + Math.abs(ns.y - celY), parent: current };
                        openSet.push(newNode);
                        openMap[sId] = newNode;
                    } else if (g < existing.g) {
                        existing.g = g;
                        existing.f = g + Math.abs(ns.x - celX) + Math.abs(ns.y - celY);
                        existing.parent = current;
                    }
                }
            }
            return null;
        }
        // ==========================================

        function autoQuestNpcClick(npcName) {
            if (!npcName) return false;
            var norm = npcName.trim().toLowerCase().replace(/^\s+/, '');

            // NI: Engine.npcs.check() → obiekt {id: npcObj}
            if ((IFACE === 'new' || hasNewEngine()) && $w.Engine && $w.Engine.npcs && $w.Engine.hero) {
                try {
                    var map = typeof $w.Engine.npcs.check === 'function'
                        ? $w.Engine.npcs.check()
                        : (typeof $w.Engine.npcs.get === 'function' ? $w.Engine.npcs.get() : $w.Engine.npcs);

                    var list = map instanceof Map ? Array.from(map.values()) :
                               Array.isArray(map) ? map : Object.values(map || {});

                    var candidates = [];
                    var graczX = $w.Engine.hero.d.x || 0;
                    var graczY = $w.Engine.hero.d.y || 0;

                    for (var i = 0; i < list.length; i++) {
                        var npc = list[i];
                        if (!npc || !npc.d) continue;
                        var n = (npc.d.name || npc.d.nick || '').toLowerCase();
                        if (!n) continue;
                        if (n.indexOf(norm) >= 0 || (norm.indexOf(n) >= 0 && n.length > 3)) {
                            var prosta = Math.abs(graczX - (npc.d.x || 0)) + Math.abs(graczY - (npc.d.y || 0));
                            candidates.push({ npc: npc, prosta: prosta });
                        }
                    }

                    if (candidates.length > 0) {
                        candidates.sort(function(a, b) { return a.prosta - b.prosta; });
                        var tTarget = null;
                        var minTalkDist = Infinity;

                        for (var c = 0; c < candidates.length; c++) {
                            var cand = candidates[c];
                            if (cand.prosta >= minTalkDist) break;
                            var sciezka = szukajDrogi(graczX, graczY, cand.npc.d.x, cand.npc.d.y, czyPoleZablokowane);
                            if (sciezka !== null) {
                                if (sciezka.length < minTalkDist) {
                                    minTalkDist = sciezka.length;
                                    tTarget = cand.npc;
                                }
                            }
                        }

                        // Jeśli z jakiegoś powodu A* nie znajdzie drogi, a my wiemy, że tam jest, spróbuj klasycznie (np. cel stoi w ścianie)
                        if (!tTarget) tTarget = candidates[0].npc;

                        if (tTarget) {
                            var tx = tTarget.d.x || 0, ty = tTarget.d.y || 0;
                            var nid = tTarget.d.id || tTarget.id;
                            var dx = Math.abs(graczX - tx);
                            var dy = Math.abs(graczY - ty);

                            // Idź do NPC jeśli za daleko
                            if (tx && ty && (dx > 1 || dy > 1)) {
                                heroGoTo(tx, ty);
                            }
                            
                            var _nid = nid;
                            // Jeśli jesteśmy obok, gadamy. Jeśli nie, idziemy.
                            if (dx <= 1 && dy <= 1) {
                                setTimeout(function() {
                                    try {
                                        if ($w.Engine && $w.Engine.hero && !$w.Engine.hero.waitForDialog) {
                                            $w.Engine.hero.sendRequestToTalk(_nid);
                                        } else {
                                            var dom = document.getElementById('npc' + _nid);
                                            if (dom) { dom.style.pointerEvents='auto'; click(dom); }
                                        }
                                    } catch(e) {
                                        var dom2 = document.getElementById('npc' + _nid);
                                        if (dom2) { dom2.style.pointerEvents='auto'; click(dom2); }
                                    }
                                }, 200);
                            } else {
                                log('<span class="ok">📜 NPC [NI] idę do "' + npcName + '" id=' + nid + ' (Dystans: ' + (dx+dy) + ')</span>');
                            }
                            return true;
                        }
                    }
                } catch(e) { /* fallback DOM */ }
            }

            // DOM fallback: .npc[tip] z <b>NazwaNPC</b>
            var found = null;
            document.querySelectorAll('.npc').forEach(function(el) {
                if (found) return;
                var tip = decodeTip(el.getAttribute('tip') || '');
                var tn = ((tip.match(/<b>(.*?)<\/b>/) || [])[1] || '').toLowerCase().trim();
                if (tn && (tn.indexOf(norm) >= 0 || (norm.indexOf(tn) >= 0 && tn.length > 3))) found = el;
            });
            if (found) {
                found.style.pointerEvents = 'auto';
                click(found);
                log('<span class="ok">📜 NPC [DOM]: "' + npcName + '"</span>');
                return true;
            }
            log('<span class="warn">📜 NPC "' + npcName + '" nie ma na tej mapie</span>');
            return false;
        }

        // ══════════════════════════════════════════════════════
        //  renderQuestPanel — odświeża UI zakładki quest
        // ══════════════════════════════════════════════════════
        function renderQuestPanel() {
            var ne = document.getElementById('maw-quest-name');
            var me = document.getElementById('maw-quest-mission');
            var npe = document.getElementById('maw-quest-npc');
            var gb = document.getElementById('maw-quest-go');
            var se = document.getElementById('maw-quest-status');
            if (!ne) return;

            var q = scanTrackedQuest();
            if (!q || !q.name) {
                ne.textContent = 'Brak śledzonego questa';
                if (me) me.textContent = 'Włącz śledzenie w dzienniku zadań';
                if (npe) { npe.textContent = ''; npe.classList.remove('visible'); }
                if (gb) gb.classList.remove('visible');
                if (se) se.textContent = '💤 Brak questa';
                window._mawQuestNpc = null;
                window._mawQuestLoc = null;
                return;
            }

            ne.textContent = '[' + (q.id || '?') + '] ' + q.name;
            var am = q.missions ? q.missions.find(function(m){ return !m.done; }) : null;

            if (am) {
                if (me) me.textContent = (am.label + ' ' + am.npcName).trim() || q.desc || '—';

                if (am.type === 17 || am.label.indexOf('Porozmawiaj') >= 0) {
                    // type-17: Porozmawiaj z NPC
                    window._mawQuestNpc = am.npcName || null;
                    window._mawQuestLoc = null;
                    if (npe) { npe.textContent = '🧑 ' + (am.npcName || '?'); npe.classList.add('visible'); }
                    if (gb) gb.classList.add('visible');
                    if (se) se.textContent = '🗣 Porozmawiaj: ' + (am.npcName || '?');

                } else if (am.type === 13 || am.label.indexOf('Udaj się') >= 0) {
                    // type-13: Udaj się do lokacji (brama/przejście — NIE NPC!)
                    window._mawQuestNpc = null;
                    window._mawQuestLoc = am.npcName || null;
                    if (npe) { npe.textContent = '📍 ' + (am.npcName || '?'); npe.classList.add('visible'); }
                    if (gb) gb.classList.add('visible');
                    if (se) se.textContent = '🚶 Idź do: ' + (am.npcName || '?');

                } else {
                    window._mawQuestNpc = am.npcName || null;
                    window._mawQuestLoc = null;
                    if (npe) npe.classList.remove('visible');
                    if (gb) gb.classList.remove('visible');
                    if (se) se.textContent = '⚙️ ' + (am.label || 'Realizuj misję');
                }
            } else if (q.missions && q.missions.length > 0) {
                if (me) me.textContent = '✅ Misje ukończone!';
                if (npe) npe.classList.remove('visible');
                if (gb) gb.classList.remove('visible');
                if (se) se.textContent = '🎉 Oddaj questa!';
            } else {
                if (me) me.textContent = q.desc || '—';
                if (se) se.textContent = '';
            }
        }

        // ══════════════════════════════════════════════════════
        //  handleQuestDialog
        //  Oparta na rzeczywistej strukturze z dialogi.txt:
        //   - okno: .dialogue-window.is-open
        //   - <ul class="answers">
        //       <li class="dialogue-window-answer answer line_option">
        //         <span class="answer-text">1. No właśnie! </span>
        //       </li>
        //   - BRAK data-answer-id → używamy wyłącznie .click()
        //
        //  Priorytety:
        //   P1: line_cont_quest / line_take_quest / line_end_quest (pogrubione)
        //   P2: zawiera "Pomiń" → skip
        //   P3: jedyna odpowiedź → klikaj (nawet line_exit)
        //   P4: 2 opcje: "Dalej" + "Pomiń" → kliknij "Pomiń"
        //   P5: 1 line_option bez exit → klikaj
        //   P6: wiele → gracz wybiera
        // ══════════════════════════════════════════════════════
        function handleQuestDialog() {
            if (!settings.questAutoEnabled) return;
            var now = Date.now();
            if (now - lastDlg < 300) return;

            // ── askAlert (Rozpocznij / OK / Tak) ──
            var aa = document.querySelector('.c-window.askAlert, .c-window.alert-window');
            if (aa && window.getComputedStyle(aa).display !== 'none') {
                var btns = Array.from(aa.querySelectorAll('.window-controlls .button, .buttons-group .button'));
                if (btns.length > 0) {
                    var sb = btns.find(function(b){
                        var t = (b.textContent || '').trim().toLowerCase();
                        return t.indexOf('rozpocznij') >= 0 || t.indexOf('ok') >= 0 ||
                               t.indexOf('tak') >= 0 || t.indexOf('dalej') >= 0;
                    }) || btns[0];
                    click(sb);
                    log('<span class="ok">📜 Alert: "' + (sb.textContent||'').trim() + '"</span>');
                    lastDlg = now; return;
                }
            }

            // ── Okno dialogu NPC ──
            // Struktura z dialogi.txt: .dialogue-window.is-open > .content > .answers-scroll > ul.answers > li.dialogue-window-answer
            var dw = document.querySelector('.dialogue-window.is-open');
            if (!dw) dw = document.querySelector('.dialogue-window');
            if (!dw || window.getComputedStyle(dw).display === 'none') return;

            var ans = Array.from(dw.querySelectorAll('li.dialogue-window-answer'));
            if (!ans.length) return;

            // Pomocnicza: tekst odpowiedzi
            function getText(el) {
                return ((el.querySelector('.answer-text') || el).textContent || '').trim();
            }

            // P1: questowe (pogrubione — przyjęcie/kontynuacja/zakończenie questa)
            var quest = ans.filter(function(a){
                return a.classList.contains('line_cont_quest') ||
                       a.classList.contains('line_take_quest') ||
                       a.classList.contains('line_end_quest');
            });
            if (quest.length > 0) {
                var q0 = quest[0];
                click(q0);
                log('<span class="ok">📜 [QUEST]: "' + getText(q0).substring(0,50) + '"</span>');
                lastDlg = now; return;
            }

            // P2: "Pomiń" — skip dialog/cutscena
            var pomin = ans.find(function(a){
                var t = getText(a).toLowerCase();
                return t.indexOf('pomiń') >= 0 || t.indexOf('pomin') >= 0 || t === 'pomiń.' || t === '2. pomiń.';
            });
            if (pomin) {
                click(pomin);
                log('<span class="ok">📜 [POMIŃ]: "' + getText(pomin).substring(0,50) + '"</span>');
                lastDlg = now; return;
            }

            // P3: dokładnie 1 odpowiedź (nawet line_exit) → zawsze klikaj
            // Przykład z dialogi.txt: tylko "1. No właśnie!" → klikaj
            if (ans.length === 1) {
                click(ans[0]);
                log('<span class="ok">📜 [AUTO-1]: "' + getText(ans[0]).substring(0,50) + '"</span>');
                lastDlg = now; return;
            }

            // P4: dokładnie 2 opcje = "Dalej" + "Pomiń" → kliknij "Pomiń"
            // Przykład z dialogi.txt: "1. Dalej." + "2. Pomiń."
            if (ans.length === 2) {
                var hasDalej = ans.some(function(a){ return getText(a).toLowerCase().indexOf('dalej') >= 0; });
                var hasPomin2 = ans.some(function(a){ var t = getText(a).toLowerCase(); return t.indexOf('pomiń') >= 0 || t.indexOf('pomin') >= 0; });
                if (hasDalej && hasPomin2) {
                    var skipBtn = ans.find(function(a){ var t=getText(a).toLowerCase(); return t.indexOf('pomiń')>=0||t.indexOf('pomin')>=0; });
                    click(skipBtn);
                    log('<span class="ok">📜 [DALEJ+POMIŃ → POMIŃ]: "' + getText(skipBtn).substring(0,40) + '"</span>');
                    lastDlg = now; return;
                }
            }

            // P5: 1 line_option, zero line_exit → klikaj (scenariuszowy bez wyboru)
            var opts = ans.filter(function(a){ return a.classList.contains('line_option'); });
            var exits = ans.filter(function(a){ return a.classList.contains('line_exit'); });
            if (opts.length === 1 && exits.length === 0) {
                click(opts[0]);
                log('<span class="ok">📜 [SINGLE-OPT]: "' + getText(opts[0]).substring(0,50) + '"</span>');
                lastDlg = now; return;
            }

            // P6: 1 non-exit → klikaj
            var nonExit = ans.filter(function(a){ return !a.classList.contains('line_exit'); });
            if (nonExit.length === 1) {
                click(nonExit[0]);
                log('<span class="ok">📜 [NON-EXIT]: "' + getText(nonExit[0]).substring(0,50) + '"</span>');
                lastDlg = now; return;
            }

            // P7: Wiele opcji — automatycznie kliknij pierwszą (zgodnie z życzeniem użytkownika)
            if (ans.length > 0) {
                click(ans[0]);
                log('<span class="ok">📜 [AUTO-FALLBACK]: "' + getText(ans[0]).substring(0,50) + '"</span>');
                lastDlg = now; return;
            }
        }


        // ══════════════════════════════════════════════════════
        //  solveCaptchaNI
        //  Struktura z dialogi.txt (linia 95-121):
        //   .captcha > .captcha__buttons > .button > .label
        //   Tekst labela: "*a*" (z gwiazdkami), "@b@" (bez), "*c*"
        //   Gwiazdka = PIERWSZA i OSTATNIA litera to "*"
        //   Potwierdzenie: .captcha__confirm .button
        // ══════════════════════════════════════════════════════
        function simulateClick(element) {
            if (!element) return;
            var rect = element.getBoundingClientRect();
            var x = rect.left + rect.width / 2;
            var y = rect.top + rect.height / 2;

            var mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y });
            var mouseup = new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y });
            var clk = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y });

            element.dispatchEvent(mousedown);
            element.dispatchEvent(mouseup);
            element.dispatchEvent(clk);
        }

        function solveCaptchaNI() {
            var cap = document.querySelector('.captcha-window, .captcha');
            if (!cap) return false;
            // Sprawdź czy widoczna
            var cw = cap.closest('.captcha-window, .c-window');
            if (cw && window.getComputedStyle(cw).display === 'none') return false;

            // Zbierz przyciski z gwiazdkami w tekście labela
            var allBtns = cap.querySelectorAll('.captcha__buttons .button');
            if (!allBtns.length) return false;

            var toClick = [];
            allBtns.forEach(function(btn) {
                var label = (btn.querySelector('.label') || btn).textContent.trim();
                // Gwiazdka: w tekście znajduje się '*' np. "*a*", "*abc*", " * " - zgodne ze skryptem
                if (label.indexOf('*') !== -1 && !btn.classList.contains('pressed')) {
                    toClick.push({ btn: btn, label: label });
                }
            });

            if (!toClick.length) return false;

            log('<span class="ok">🔑 CAPTCHA: ' + toClick.length + ' odpowiedzi z *gwiazdką* (Tryb mechaniczny)</span>');

            // Klikaj mechanicznie symulując prawdziwą myszkę
            toClick.forEach(function(item, i) {
                setTimeout(function() {
                    simulateClick(item.btn);
                    log('<span class="ok">🔑 Kliknięto: "' + item.label + '"</span>');
                }, i * 350 + 150);
            });

            // Po kliknięciu wszystkich — Potwierdzam
            setTimeout(function() {
                var conf = cap.querySelector('.captcha__confirm .button');
                if (conf) {
                    simulateClick(conf);
                    log('<span class="ok">✅ CAPTCHA potwierdzona!</span>');
                } else {
                    log('<span class="warn">⚠ CAPTCHA: brak przycisku Potwierdzam</span>');
                }
            }, toClick.length * 450 + 700);

            return true;
        }

        // ══════════════════════════════════════════════════════
        //  SI AUTO-GRUPKA
        // ══════════════════════════════════════════════════════
        (function() {
            if (IFACE !== 'old' && IFACE !== 'superold') return;
            var qs = {};
            try { qs = JSON.parse(localStorage.getItem('maw_qg_settings')) || {}; } catch(e) {}
            var qa = qs.add || 'all', qr = qs.reject !== false;

            function verify(msg, re) {
                if (!$w._g) return false;
                var m = msg.match(/\[b\](.+?)\[\/b\]/), nick = m ? m[1] : null;
                if (qa === 'all') { $w._g(re + '1'); return true; }
                if (qa === 'no') { if (qr) $w._g(re + '0'); return true; }
                var p = null;
                if ($w.g && $w.g.other && nick)
                    for (var id in $w.g.other) if ($w.g.other[id].nick === nick) { p = $w.g.other[id]; break; }
                if (!p) { if (qr) $w._g(re + '0'); return true; }
                var rl = p.relation || '';
                if (qa === 'no-en' && (rl === 'en' || rl === 'cl-en')) { if (qr) $w._g(re + '0'); return true; }
                if (qa.split('_').indexOf(rl) >= 0) { $w._g(re + '1'); return true; }
                if (qr) $w._g(re + '0');
                return true;
            }

            if (typeof $w.parseInput === 'function') {
                var orig = $w.parseInput;
                $w.parseInput = function(d) {
                    if (d && d.ask && typeof d.ask.q === 'string' &&
                        d.ask.q.indexOf('do drużyny gracza') >= 0 && d.ask.re) {
                        if (verify(d.ask.q, d.ask.re)) { delete d.ask; return orig.apply(this, arguments); }
                    }
                    return orig.apply(this, arguments);
                };
                log('<span style="color:#34d399">⚔ SI Auto-grupka aktywna</span>');
            }
        })();

        // ── Rejestracja API ──
        window.MAW = window.MAW || {};
        window.MAW.quest = {
            scan:     scanTrackedQuest,
            npcClick: autoQuestNpcClick,
            render:   renderQuestPanel,
            dialog:   handleQuestDialog,
            captcha:  solveCaptchaNI
        };

        // Timer panelu questa (tylko gdy zakładka otwarta)
        setInterval(function() {
            var qt = document.getElementById('tab-quest');
            if (qt && qt.style.display !== 'none') renderQuestPanel();
        }, 3000);

        log('<span style="color:#818cf8">📦 maw-quest loaded (dialogi.txt + QUEST.txt API)</span>');
    });
})();
