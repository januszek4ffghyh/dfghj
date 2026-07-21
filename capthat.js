'use strict';

// ═══════════════════════════════════════════════════════════════
//  MARGONEM CAPTCHA SOLVER — Puppeteer mouse-click version
//  Klikanie MYSZKĄ (page.mouse.click) bo gra jest na canvas
// ═══════════════════════════════════════════════════════════════

async function checkAndSolveCaptcha(page) {
    if (!page || page.isClosed()) return false;

    try {
        // ═══ 1. WYKRYWANIE CAPTCHY ═══
        // Prawdziwy selektor w Margonem: div.captcha (NIE .captcha-window!)
        const captchaInfo = await page.evaluate(() => {
            const captcha = document.querySelector('.captcha');
            if (!captcha) return null;

            // Sprawdź widoczność
            const style = window.getComputedStyle(captcha);
            if (style.display === 'none' || style.visibility === 'hidden') return null;

            // Nie rozwiązuj dwa razy naraz
            if (captcha.hasAttribute('data-maw-solving')) return null;
            captcha.setAttribute('data-maw-solving', '1');

            // Pytanie
            const questionEl = captcha.querySelector('.captcha__question');
            const question = questionEl ? questionEl.textContent.trim() : '';

            // Próby
            const triesEl = captcha.querySelector('.captcha__triesleft');
            const tries = triesEl ? triesEl.textContent.trim() : '';

            // Przyciski z ich labelami i POZYCJAMI EKRANOWYMI
            const buttons = [];
            captcha.querySelectorAll('.captcha__buttons .button').forEach((btn, i) => {
                const labelEl = btn.querySelector('.label');
                const label = labelEl ? labelEl.textContent.trim() : '';
                const rect = btn.getBoundingClientRect();
                buttons.push({
                    index: i,
                    label: label,
                    x: Math.round(rect.x + rect.width / 2),
                    y: Math.round(rect.y + rect.height / 2),
                });
            });

            // Przycisk "Potwierdzam" — pozycja ekranowa
            let confirmPos = null;
            const confirmBtn = captcha.querySelector('.captcha__confirm .button');
            if (confirmBtn) {
                const rect = confirmBtn.getBoundingClientRect();
                confirmPos = {
                    x: Math.round(rect.x + rect.width / 2),
                    y: Math.round(rect.y + rect.height / 2),
                };
            }

            return { question, tries, buttons, confirmPos };
        });

        if (!captchaInfo) return false;

        // ═══ CAPTCHA WYKRYTA! ═══
        console.log('[Captcha] 🧩 ═══════════════════════════════════════');
        console.log(`[Captcha] ❗ CAPTCHA WYKRYTA!`);
        console.log(`[Captcha] Pytanie: "${captchaInfo.question}"`);
        console.log(`[Captcha] ${captchaInfo.tries}`);
        console.log(`[Captcha] Przyciski: ${captchaInfo.buttons.map(b => b.label).join(' | ')}`);

        // Screenshot na debug
        try {
            await page.screenshot({ path: 'captcha_debug.png', fullPage: false });
            console.log('[Captcha] 📷 Screenshot zapisany → captcha_debug.png');
        } catch {}

        // ═══ 2. PARSOWANIE PYTANIA — jaki symbol szukamy? ═══
        const symbol = getSymbol(captchaInfo.question.toLowerCase());

        if (!symbol) {
            console.error(`[Captcha] ❌ Nie rozpoznano pytania! Nie klikam.`);
            console.error(`[Captcha] Pytanie: "${captchaInfo.question}"`);
            await cleanup(page);
            return false;
        }

        console.log(`[Captcha] 🔍 Szukam symbolu: "${symbol}"`);

        // ═══ 3. KLIKANIE PRZYCISKÓW — page.mouse.click() ═══
        // Czekamy chwilę żeby wyglądało naturalnie
        await delay(800 + Math.floor(Math.random() * 600));

        let clickedCount = 0;
        for (const btn of captchaInfo.buttons) {
            if (btn.label.includes(symbol)) {
                // ★ KLUCZOWE: klikamy MYSZKĄ Puppeteer, nie DOM .click()!
                await page.mouse.click(btn.x, btn.y);
                clickedCount++;
                console.log(`[Captcha] ✅ Kliknąłem: "${btn.label}" @ [${btn.x}, ${btn.y}]`);
                // Krótka pauza między klikami (naturalność)
                await delay(150 + Math.floor(Math.random() * 250));
            }
        }

        console.log(`[Captcha] Kliknięto ${clickedCount}/${captchaInfo.buttons.length} przycisków`);

        if (clickedCount === 0) {
            console.warn('[Captcha] ⚠ Żaden przycisk nie pasował do symbolu!');
            await cleanup(page);
            return false;
        }

        // ═══ 4. POTWIERDZENIE ═══
        await delay(500 + Math.floor(Math.random() * 400));

        if (captchaInfo.confirmPos) {
            await page.mouse.click(captchaInfo.confirmPos.x, captchaInfo.confirmPos.y);
            console.log(`[Captcha] 📨 Potwierdzono @ [${captchaInfo.confirmPos.x}, ${captchaInfo.confirmPos.y}]`);
        } else {
            console.warn('[Captcha] ⚠ Nie znaleziono przycisku "Potwierdzam"!');
        }

        // ═══ 5. WERYFIKACJA ═══
        await delay(2500);

        const stillThere = await page.evaluate(() => {
            const c = document.querySelector('.captcha');
            if (!c) return false;
            const s = window.getComputedStyle(c);
            return s.display !== 'none' && s.visibility !== 'hidden';
        });

        if (stillThere) {
            console.warn('[Captcha] ⚠ Captcha nadal widoczna — mogło się nie udać (złe odpowiedzi?)');
        } else {
            console.log('[Captcha] ✅✅✅ Captcha ROZWIĄZANA! Gra idzie dalej.');
        }

        await cleanup(page);
        return !stillThere;

    } catch (err) {
        console.error('[Captcha] ❌ Błąd:', err.message);
        await cleanup(page).catch(() => {});
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════
//  PARSOWANIE PYTANIA → SYMBOL
// ═══════════════════════════════════════════════════════════════
function getSymbol(q) {
    // Gwiazdka / asterisk — najczęstszy typ
    if (/gwiazd/.test(q)) return '*';
    // Kratka / hash
    if (/kratk|płotk|hash/.test(q)) return '#';
    // Małpa / at
    if (/małp/.test(q)) return '@';
    // Wykrzyknik
    if (/wykrzyknik/.test(q)) return '!';
    // Dolar
    if (/dolar/.test(q)) return '$';
    // Procent
    if (/procent/.test(q)) return '%';
    // Daszek / karetka
    if (/daszk|daszek|karetk/.test(q)) return '^';
    // Ukośnik / slash
    if (/ukośnik|slash/.test(q)) return '/';
    // Pytajnik
    if (/pytajnik|znak zapytania/.test(q)) return '?';
    // Ampersand
    if (/ampersand/.test(q)) return '&';
    // Plus
    if (/plus/.test(q)) return '+';
    // Minus / myślnik
    if (/minus|myślnik/.test(q)) return '-';
    // Podkreślenie
    if (/podkreśl/.test(q)) return '_';
    // Tylda
    if (/tyld/.test(q)) return '~';
    // Nawias
    if (/nawias.*okrągł|okrągł.*nawias/.test(q)) return '(';
    if (/nawias.*kwadrat|kwadrat.*nawias/.test(q)) return '[';
    // Średnik
    if (/średnik/.test(q)) return ';';
    // Dwukropek
    if (/dwukropek/.test(q)) return ':';

    return null;
}

// ═══════════════════════════════════════════════════════════════
//  CLEANUP — zdejmij flagę "solving"
// ═══════════════════════════════════════════════════════════════
async function cleanup(page) {
    try {
        await page.evaluate(() => {
            const c = document.querySelector('.captcha');
            if (c) c.removeAttribute('data-maw-solving');
        });
    } catch {}
}

// ═══════════════════════════════════════════════════════════════
//  AUTO RELOG Z MINUTNIKA
// ═══════════════════════════════════════════════════════════════
async function tryAutoRelog(page) {
    try {
        // 1. Userscript już zapisał cel
        const relogRequest = await page.evaluate(() => {
            const name = localStorage.getItem('e2h_relog_e2name');
            const time = parseInt(localStorage.getItem('e2h_relog_e2name_time') || '0');
            if (name && (Date.now() - time) < 40000) {
                return { name, fromUserscript: true };
            }
            return null;
        });

        if (!relogRequest) return false;

        console.log(`[Puppeteer:Relogger] 🎯 Cel: "${relogRequest.name}"`);

        // Klik na wiersz minutnika — MYSZKĄ Puppeteer
        const targetRow = await page.evaluate((target) => {
            const rows = Array.from(document.querySelectorAll('.elite-timer .row, .elite-timer-wnd .row'));
            for (const row of rows) {
                const nameEl = row.querySelector('.name-val, .name');
                if (nameEl && nameEl.textContent.includes(target)) {
                    const rect = row.getBoundingClientRect();
                    return {
                        x: Math.round(rect.x + rect.width / 2),
                        y: Math.round(rect.y + rect.height / 2),
                    };
                }
            }
            return null;
        }, relogRequest.name);

        if (targetRow) {
            // Dwuklik MYSZKĄ
            await page.mouse.click(targetRow.x, targetRow.y, { clickCount: 2 });
            console.log('[Puppeteer:Relogger] ✓ Dwuklik na minutnik wykonany');
            await page.evaluate(() => {
                localStorage.removeItem('e2h_relog_e2name');
                localStorage.removeItem('e2h_relog_e2name_time');
            });
            await delay(2500);
            return true;
        }
    } catch (e) {
        console.error('[Relogger] Błąd:', e.message);
    }
    return false;
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { checkAndSolveCaptcha, tryAutoRelog };