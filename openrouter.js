'use strict';

const https = require('https');

async function callOpenRouter(apiKey, model, messages, options = {}) {
    const body = JSON.stringify({
        model: model || 'meta-llama/llama-3-8b-instruct:free',
        messages,
        ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    });

    return new Promise((resolve, reject) => {
        const req = https.request('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'https://github.com/danessi/margonem-bot',
                'X-Title': 'Margonem AI AutoWalk Bot',
                'Content-Length': Buffer.byteLength(body),
            },
            timeout: 12000,
        }, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    reject(new Error(`OpenRouter HTTP ${res.statusCode}: ${raw.slice(0, 400)}`));
                    return;
                }
                try {
                    const parsed = JSON.parse(raw);
                    const content = parsed.choices?.[0]?.message?.content;
                    if (content) resolve(content.trim());
                    else reject(new Error('Pusta odpowiedź z OpenRouter API'));
                } catch (err) {
                    reject(err);
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Timeout połączenia z OpenRouter'));
        });
        req.write(body);
        req.end();
    });
}

class OpenRouterClient {
    getApiKey() {
        return process.env.MAW_AI_API_KEY || '';
    }

    getModel() {
        return process.env.MAW_AI_MODEL || 'meta-llama/llama-3-8b-instruct:free';
    }

    async callChat(messages, options = {}) {
        const apiKey = this.getApiKey();
        if (!apiKey) throw new Error('Brak MAW_AI_API_KEY');
        return callOpenRouter(apiKey, this.getModel(), messages, options);
    }

    async generateResponse(author, message, history = []) {
        const apiKey = this.getApiKey();
        const model = this.getModel();

        if (!apiKey) {
            console.warn('[AI] Brak klucza MAW_AI_API_KEY. AI nie odpowie.');
            return this.fallbackChatReply(message);
        }

        const botNick = process.env.MAW_BOT_NICK || 'Certyfikowany Janusz';
        const systemPrompt = `Jesteś graczem polskiej gry MMORPG Margonem. Nick: ${botNick}. Profesja: Paladyn.
Zasady:
1. Pisz wyłącznie po polsku, luźnym slangiem gracza (xd, afk, ni, zw, jj, kk, spoko, siema).
2. Bardzo krótko — maks 1-6 słów, jak na czacie podczas expa.
3. Bez interpunkcji na końcu, bez wielkich liter na początku.
4. Na "kto ni na afk" / "afk?" / "kto gra" → potwierdź że grasz (np. "ja ni", "nie afk", "jestem xd").
5. Dostosuj się do kontekstu ostatnich wiadomości.`;

        const messages = [{ role: 'system', content: systemPrompt }];

        for (const h of history.slice(-6)) {
            messages.push({
                role: 'user',
                content: `[${h.author}]: ${h.message}`,
            });
        }

        messages.push({
            role: 'user',
            content: `[${author}]: ${message}`,
        });

        try {
            console.log(`[AI] Chat → ${author}: "${message}"`);
            const response = await callOpenRouter(apiKey, model, messages);
            console.log(`[AI] Odpowiedź: "${response}"`);
            return response;
        } catch (err) {
            console.error('[AI] Błąd:', err.message);
            return this.fallbackChatReply(message);
        }
    }

    fallbackChatReply(message) {
        const low = String(message || '').toLowerCase();
        if (/afk|kto ni|kto gra|gramy|aktywn/.test(low)) return 'ja ni';
        if (/siema|elo|czesc|cześć|hej/.test(low)) return 'siema';
        return null;
    }

    shouldReplyToChat(message) {
        const normalized = String(message || '').toLowerCase();
        const keywords = [
            'afk', 'gra', 'janusz', 'kto ni', 'ktos', 'gramy', 'jestes', 'jesteś',
            'aktywny', 'siema', 'elo', 'czesc', 'cześć', 'hej', 'yhm', '??',
            process.env.MAW_BOT_NICK?.toLowerCase(),
        ].filter(Boolean);
        return keywords.some(k => normalized.includes(k));
    }
}

module.exports = new OpenRouterClient();
module.exports.callOpenRouter = callOpenRouter;
