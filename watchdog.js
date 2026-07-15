'use strict';

const { spawn } = require('child_process');

let botProcess = null;
const CHECK_INTERVAL = 45000;        // co ile sprawdza harmonogram
const STATUS_LOG_INTERVAL = 90000;   // co 90 sekund ładny status (1.5 min)

const RAW_SCHEDULE = process.env.MAW_SCHEDULE || "06:00-24:00";

let scheduleSlots = [];

function parseSchedule(raw) {
    return raw.split(',').map(slot => {
        const [start, end] = slot.trim().split('-');
        return { start, end };
    });
}

function timeToMinutes(t) {
    const [h, m] = t.split(':').map(Number);
    if (h === 24) return 24 * 60;
    return h * 60 + m;
}

function isInSlot(nowMin, slot) {
    const s = timeToMinutes(slot.start);
    const e = timeToMinutes(slot.end);
    if (s <= e) return nowMin >= s && nowMin < e;
    return nowMin >= s || nowMin < e;
}

function startBot() {
    if (botProcess) return;
    console.log(`[WATCHDOG] ▶ Startuję runbot.js`);
    botProcess = spawn('node', ['runbot.js'], {
        cwd: __dirname,
        env: process.env,
        stdio: 'inherit'
    });

    botProcess.on('exit', (code) => {
        console.log(`[WATCHDOG] ❌ runbot.js zakończył (kod: ${code})`);
        botProcess = null;
    });
}

function stopBot() {
    if (!botProcess) return;
    console.log(`[WATCHDOG] ⛔ Zatrzymuję runbot.js`);
    botProcess.kill('SIGTERM');
    botProcess = null;
}

function checkSchedule() {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const active = scheduleSlots.some(slot => isInSlot(nowMin, slot));

    if (active) {
        if (!botProcess) startBot();
    } else {
        if (botProcess) stopBot();
    }
}

// Nowa funkcja — ładny status co 90 sekund
function printStatus() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const isActive = scheduleSlots.some(slot => {
        const nowMin = now.getHours() * 60 + now.getMinutes();
        return isInSlot(nowMin, slot);
    });

    const status = isActive ? '🟢 BOT AKTYWNY' : '🔴 BOT WYŁĄCZONY (poza harmonogramem)';
    
    console.log(`[WATCHDOG STATUS] ${timeStr} | ${status} | Harmonogram: ${RAW_SCHEDULE}`);
}

function main() {
    console.log('[WATCHDOG] Uruchamiam z harmonogramem:', RAW_SCHEDULE);
    scheduleSlots = parseSchedule(RAW_SCHEDULE);

    // Sprawdza harmonogram
    setInterval(checkSchedule, CHECK_INTERVAL);
    
    // Status co ~1.5 minuty
    setInterval(printStatus, STATUS_LOG_INTERVAL);
    
    // Pierwsze uruchomienie
    checkSchedule();
    printStatus(); // od razu pokaż status
}

main();