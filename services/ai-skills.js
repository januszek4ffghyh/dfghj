'use strict';

const openrouter = require('../openrouter');

function buildLocalSkillPlan(payload, eqSnapshot) {
    const hero = payload.hero || {};
    const skills = (payload.skills || []).filter(s => s && s.name);
    const free = Math.max(0, Number((payload.points || {}).free || payload.freePoints || 0));
    const eqText = JSON.stringify(eqSnapshot.weapons || []).toLowerCase();
    const profession = String(hero.profession || hero.prof || 'paladyn').toLowerCase();
    const isPaladin = /palad|p\b/.test(profession);
    const ranged = /łowca|tropiciel|dystansowe|strzały|luk|łuk|kusza|miotacz/.test(profession + ' ' + eqText);
    const fire = /ogni|fire|ogień/.test(eqText);
    const lightning = /błysk|piorun|lightning/.test(eqText);

    const scored = skills.map(skill => {
        const text = `${skill.name} ${skill.tip || ''}`.toLowerCase();
        let score = 10;
        const reasons = [];
        if (skill.curLvl >= skill.maxLvl) score -= 999;
        if (/aktywn|cios|strzał|strzal|atak|obraż|obrazen|obrażeń|dmg|święt|swiet|taran|uderzeni/.test(text)) {
            score += 35;
            reasons.push('skill daje dmg lub aktywny atak');
        }
        if (isPaladin && /tarcz|blok|blogo|aura|święt|swiet|ogień|ogni|błysk|piorun/.test(text)) {
            score += 28;
            reasons.push('synergia paladyna');
        }
        if (fire && /ogni|ogień|fire|płom/.test(text)) {
            score += 22;
            reasons.push('EQ ma ogień');
        }
        if (lightning && /błysk|piorun|lightning/.test(text)) {
            score += 22;
            reasons.push('EQ ma błyskawice');
        }
        if (ranged && /dystans|strzał|strzal|łuk|luk|kusz|celn|przebic|przebicie/.test(text)) {
            score += 30;
            reasons.push('build dystansowy');
        }
        if (/leczen|leczenie|życie|zycie|obron|pancerz|odporno|uzdrow/.test(text)) {
            score += 14;
            reasons.push('przeżywalność');
        }
        if (/kryt|przebic|przebicie|szybkość|szybkosc|sa|unik/.test(text)) {
            score += 18;
            reasons.push('kryt/przebicie/sa/unik');
        }
        if (!reasons.length) reasons.push('najlepszy lokalny wybór');
        return { skill, score, reasons };
    }).sort((a, b) => b.score - a.score);

    const allocations = [];
    let left = free;
    for (const row of scored) {
        if (left <= 0) break;
        const canAdd = Math.max(0, Number(row.skill.maxLvl || 0) - Number(row.skill.curLvl || 0));
        if (canAdd <= 0 || row.score < 0) continue;
        const points = Math.min(canAdd, left, row.score >= 40 ? 2 : 1);
        allocations.push({
            name: row.skill.name,
            points,
            targetLvl: Number(row.skill.curLvl || 0) + points,
            reason: row.reasons.join('; '),
        });
        left -= points;
    }

    return {
        mode: 'local-dry-run',
        summary: isPaladin
            ? 'Plan lokalny paladyn: dmg święty/ogień/błyskawice + tarcza + leczenie.'
            : 'Plan lokalny: dmg, aktywne ataki i przeżywalność.',
        allocations,
        warnings: left > 0 ? [`Zostało ${left} pkt bez mocnego dopasowania.`] : [],
    };
}

async function callAiSkillPlanner(payload, eqSnapshot) {
    const dryRun = String(process.env.MAW_AI_DRY_RUN || 'false').toLowerCase() === 'true';
    const apiKey = process.env.MAW_AI_API_KEY || '';

    if (!apiKey || dryRun) {
        return buildLocalSkillPlan(payload, eqSnapshot);
    }

    const systemPrompt = `Jesteś plannerem umiejętności Margonem (Paladyn).
Zwróć WYŁĄCZNIE JSON: {"summary":"...","allocations":[{"name":"...","points":1,"targetLvl":1,"reason":"..."}],"warnings":[]}
Suma points <= wolne punkty. targetLvl = curLvl + points <= maxLvl.
Priorytet paladyna: aktywne ataki (ogień/błyskawice/święte), tarcza, leczenie, buffy.`;

    const userContent = JSON.stringify({
        hero: payload.hero,
        skills: payload.skills,
        freePoints: (payload.points || {}).free || payload.freePoints,
        eqWeapons: eqSnapshot.weapons.slice(0, 8),
    });

    try {
        const raw = await openrouter.callChat([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
        ], { jsonMode: true });

        const parsed = JSON.parse(raw.replace(/^```json?\s*|\s*```$/g, ''));
        parsed.mode = 'openrouter-ai';
        return parsed;
    } catch (err) {
        console.warn('[AI Skills] fallback lokalny:', err.message);
        return buildLocalSkillPlan(payload, eqSnapshot);
    }
}

module.exports = { buildLocalSkillPlan, callAiSkillPlanner };
