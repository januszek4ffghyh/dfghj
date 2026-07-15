'use strict';

/**
 * Canvas-aware Captcha Solver dla Margonem
 */
async function checkAndSolveCaptcha(page) {
    if (!page || page.isClosed()) return;

    try {
        const hasCaptcha = await page.evaluate(() => {
            const wnd = document.querySelector('.captcha-window, .captcha');
            if (!wnd || wnd.style.display === 'none') return false;

            if (wnd.hasAttribute('data-solving')) return false;
            wnd.setAttribute('data-solving', '1');
            return true;
        });

        if (!hasCaptcha) return;

        console.log('[Puppeteer:Captcha] 🧩 Wykryto captcha (canvas) – rozwiązuję...');

        await delay(600 + Math.random() * 400);   // <-- ZAMIENIONE

        // 1. Pobierz pytanie
        const question = await page.evaluate(() => {
            const q = document.querySelector('.captcha__question');
            return q ? q.textContent.trim().toLowerCase() : '';
        });

        const symbol = getSymbol(question);
        if (!symbol) {
            console.warn(`[Captcha] Nieznane pytanie: ${question}`);
            await cleanup(page);
            return;
        }

        console.log(`[Captcha] Symbol: "${symbol}"`);

        // 2. Klikaj przyciski
        const buttons = await page.$$('.captcha__buttons .button, .captcha__buttons .btn');

        for (let i = 0; i < buttons.length; i++) {
            const text = await buttons[i].evaluate(el => el.textContent.trim());
            if (text.includes(symbol)) {
                await buttons[i].click({ delay: 60 + Math.random() * 90 });
                console.log(`[Captcha] Klik: ${text}`);
                await delay(380 + Math.random() * 320);
            }
        }

        // 3. Potwierdź
        await delay(550 + Math.random() * 450);
        const confirm = await page.$('.captcha__confirm .button, .captcha__confirm .btn');
        if (confirm) {
            await confirm.click({ delay: 80 });
            console.log('[Captcha] ✓ Potwierdzono!');
        }

        await delay(1800);
        await cleanup(page);

    } catch (err) {
        if (!err.message.includes('Execution context') && !err.message.includes('Target closed')) {
            console.error('[Captcha] Błąd:', err.message);
        }
        await cleanup(page).catch(() => {});
    }
}

// Pomocnicza funkcja delay (zamiast page.waitForTimeout)
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getSymbol(q) {
    if (/gwiazdk|gwiazde|gwiazd/.test(q)) return '*';
    if (/kratk|płotk|hash|kratce/.test(q)) return '#';
    if (/małp/.test(q)) return '@';
    if (/wykrzyknik/.test(q)) return '!';
    if (/dolar/.test(q)) return '$';
    if (/procent/.test(q)) return '%';
    if (/daszk|daszek/.test(q)) return '^';
    if (/ukośnik|slash/.test(q)) return '/';
    if (/pytajnik|zapytania/.test(q)) return '?';
    if (/ampersand|and|&/.test(q)) return '&';
    return null;
}

async function cleanup(page) {
    await page.evaluate(() => {
        const w = document.querySelector('.captcha-window, .captcha, .captcha-layer');
        if (w) w.removeAttribute('data-solving');
    });
}


async function tryAutoRelog(page) {
    try {
        // 1. Sprawdź czy userscript zapisał cel relogu w localStorage
        const relogRequest = await page.evaluate(() => {
            const targetName = localStorage.getItem('e2h_relog_e2name');
            const targetTime = parseInt(localStorage.getItem('e2h_relog_e2name_time') || '0');
            // Cel jest aktualny jeśli zapisany w ciągu ostatnich 30 sekund
            if (targetName && (Date.now() - targetTime) < 30000) {
                return { name: targetName, fromUserscript: true };
            }
            // 2. Fallback: Sam szukaj w minutniku E2 z timerem <= 10s
            const rows = Array.from(document.querySelectorAll('.elite-timer .row'));
            for (const row of rows) {
                const nameEl = row.querySelector('.name-val');
                const timeEl = row.querySelector('.time-val');
                if (!nameEl || !timeEl) continue;
                const rawName = nameEl.textContent.trim();
                const timeStr = timeEl.textContent.trim();
                const parts = timeStr.split(':').map(Number);
                let seconds = 0;
                if (parts.length === 3) seconds = parts[0]*3600 + parts[1]*60 + parts[2];
                else if (parts.length === 2) seconds = parts[0]*60 + parts[1];
                else seconds = parseInt(timeStr) || 999;
                if (seconds <= 10) {
                    return { name: rawName, seconds, fromUserscript: false };
                }
            }
            return null;
        });

        if (!relogRequest) return false;

        console.log(`[Puppeteer:Relogger] 🎯 Cel: "${relogRequest.name}" (źródło: ${relogRequest.fromUserscript ? 'userscript' : 'auto-scan'})`);

        // 3. Znajdź wiersz minutnika pasujący do nazwy E2
        const rowSelector = await page.evaluate((targetName) => {
            const cleanTarget = targetName.replace(/^\[E2?\]\s*/i, '').trim().toLowerCase();
            const nameElements = Array.from(document.querySelectorAll('.elite-timer .name-val, .elite-timer .name'));
            for (const el of nameElements) {
                const rowName = el.textContent.trim().replace(/^\[E2?\]\s*/i, '').trim().toLowerCase();
                if (rowName === cleanTarget || rowName.includes(cleanTarget) || cleanTarget.includes(rowName)) {
                    el.setAttribute('data-puppeteer-target-relog', '1');
                    return '[data-puppeteer-target-relog="1"]';
                }
            }
            return null;
        }, relogRequest.name);

        if (!rowSelector) {
            console.log('[Puppeteer:Relogger] ⚠️ Nie znaleziono wiersza minutnika (być może okno jest zamknięte)');
            return false;
        }

        console.log(`[Puppeteer:Relogger] 🖱️ Dwuklik na minutnik: "${relogRequest.name}"`);

        // 4. PRAWDZIWY klik Puppeteera (isTrusted: true!) — dwuklik
        await page.click(rowSelector, { clickCount: 2, delay: 30 + Math.random() * 40 });

        console.log('[Puppeteer:Relogger] ✓ Dwuklik wykonany (prawdziwy klik przeglądarki)');

        // Oczyszczanie atrybutu i celu
        await page.evaluate(() => {
            const el = document.querySelector('[data-puppeteer-target-relog="1"]');
            if (el) el.removeAttribute('data-puppeteer-target-relog');
            localStorage.removeItem('e2h_relog_e2name');
            localStorage.removeItem('e2h_relog_e2name_time');
        }).catch(() => {});

        // 5. Poczekaj na reakcję gry (okno relogu / przekierowanie)
        await delay(2000);

        // 6. Sprawdź czy pojawiło się okno wylogowywania i kliknij "Przeloguj"
        const relogBtnClicked = await page.evaluate(() => {
            const logOffWnd = document.querySelector('.log-off-wnd, .log-off');
            if (!logOffWnd) return false;
            const btn = Array.from(logOffWnd.querySelectorAll('.button, .btn'))
                .find(b => b.textContent.includes('Przeloguj'));
            return !!btn;
        });

        if (relogBtnClicked) {
            // Kliknij przycisk "Przeloguj" PRAWDZIWYM klikiem Puppeteera
            const przelogujBtn = await page.$x("//div[contains(@class,'log-off')]//div[contains(@class,'button') or contains(@class,'btn')][contains(text(),'Przeloguj')]");
            if (przelogujBtn.length > 0) {
                await przelogujBtn[0].click({ delay: 80 });
                console.log('[Puppeteer:Relogger] ✓ Kliknięto [Przeloguj] prawdziwym klikiem');
            }
        }

        return true;
    } catch (e) {
        if (!e.message.includes('Execution context') && !e.message.includes('Target closed') && !e.message.includes('No element found')) {
            console.error('[Puppeteer:Relogger] Błąd:', e.message);
        }
    }
    return false;
}


function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

module.exports = { checkAndSolveCaptcha, tryAutoRelog };
