'use strict';

const openrouter = require('../openrouter');

const PALADYN_SKILLS = [
    'Taran', 'Święty cios', 'Błogosławieństwo', 'Uderzenie tarczą',
    'Ognisty cios', 'Piorunujący cios', 'Leczenie', 'Uzdrowienie',
    'Aura ochrony', 'Aura siły', 'Moc ciosu', 'Rozdarcie',
];

function buildLocalBattlePlan(context) {
    const hp = Number(context.heroHpPct || 100);
    const skills = (context.availableSkills || []).filter(s => s.ready);
    const names = skills.map(s => s.name);

    if (hp < 35) {
        const heal = names.find(n => /lecz|uzdrow|heal|życie|zycie/i.test(n));
        if (heal) return { action: 'skill', skillName: heal, reason: `HP ${hp}% — leczenie` };
    }

    if (hp < 55) {
        const buff = names.find(n => /aura|blogo|tarcz|ochron/i.test(n));
        if (buff) return { action: 'skill', skillName: buff, reason: `HP ${hp}% — buff obronny` };
    }

    const atk = names.find(n => /taran|święt|swiet|ogni|piorun|uderzen|cios|atak/i.test(n))
        || names[0];
    if (atk) return { action: 'skill', skillName: atk, reason: 'atak paladyna' };

    return { action: 'wait', reason: 'brak gotowych umek' };
}

async function callBattleAi(context) {
    const dryRun = String(process.env.MAW_AI_DRY_RUN || 'false').toLowerCase() === 'true';
    const apiKey = process.env.MAW_AI_API_KEY || '';

    if (!apiKey || dryRun) {
        return { ...buildLocalBattlePlan(context), mode: 'local' };
    }

    const systemPrompt = `Jesteś AI walki Margonem — Paladyn w walce turowej/grupowej.
Zwróć WYŁĄCZNIE JSON: {"action":"skill|wait","skillName":"nazwa lub null","reason":"krótko po polsku"}
Zasady: HP<35% → leczenie, HP<55% → buff/tarcza, inaczej najmocniejszy atak (ogień/błyskawice/święty).
skillName MUSI być z listy availableSkills.`;

    try {
        const raw = await openrouter.callChat([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify(context) },
        ], { jsonMode: true });
        const parsed = JSON.parse(raw.replace(/^```json?\s*|\s*```$/g, ''));
        parsed.mode = 'openrouter-ai';
        return parsed;
    } catch (err) {
        console.warn('[AI Battle] fallback:', err.message);
        return { ...buildLocalBattlePlan(context), mode: 'local-fallback' };
    }
}

module.exports = { buildLocalBattlePlan, callBattleAi, PALADYN_SKILLS };
