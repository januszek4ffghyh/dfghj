'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

class BotDatabase {
    constructor(dbPath = 'maw-bot.db') {
        this.dbPath = path.resolve(dbPath);
        this.db = null;
    }

    init() {
        console.log(`[DB] Inicjalizacja bazy SQLite: ${this.dbPath}`);
        this.db = new DatabaseSync(this.dbPath);

        // Wykonaj pragmy optymalizacyjne
        this.db.exec('PRAGMA journal_mode = WAL;');
        this.db.exec('PRAGMA synchronous = NORMAL;');

        // Tabela logów zdarzeń bota
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS bot_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                message TEXT NOT NULL
            );
        `);

        // Tabela historii czatów (grupa, klan, itp.)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS chat_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                channel TEXT NOT NULL,
                author TEXT NOT NULL,
                message TEXT NOT NULL,
                ai_response TEXT
            );
        `);

        // Tabela ustawień (pary klucz-wartość)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS bot_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);

        console.log('[DB] Tabele bazy danych są gotowe.');
    }

    logEvent(type, message) {
        try {
            const stmt = this.db.prepare('INSERT INTO bot_logs (timestamp, event_type, message) VALUES (?, ?, ?)');
            stmt.run(Date.now(), type, message);
        } catch (err) {
            console.error('[DB] Błąd logowania zdarzenia:', err);
        }
    }

    saveChatMessage(channel, author, message, aiResponse = null) {
        try {
            const stmt = this.db.prepare(`
                INSERT INTO chat_history (timestamp, channel, author, message, ai_response)
                VALUES (?, ?, ?, ?, ?)
            `);
            stmt.run(Date.now(), channel, author, message, aiResponse);
        } catch (err) {
            console.error('[DB] Błąd zapisu wiadomości czatu:', err);
        }
    }

    getRecentChatHistory(limit = 10) {
        try {
            const stmt = this.db.prepare(`
                SELECT * FROM chat_history 
                ORDER BY timestamp DESC 
                LIMIT ?
            `);
            return stmt.all(limit).reverse();
        } catch (err) {
            console.error('[DB] Błąd pobierania historii czatu:', err);
            return [];
        }
    }

    saveSetting(key, val) {
        try {
            const stmt = this.db.prepare(`
                INSERT INTO bot_settings (key, value) 
                VALUES (?, ?) 
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
            `);
            stmt.run(key, JSON.stringify(val));
        } catch (err) {
            console.error('[DB] Błąd zapisu ustawienia:', err);
        }
    }

    getSetting(key, defaultValue = null) {
        try {
            const stmt = this.db.prepare('SELECT value FROM bot_settings WHERE key = ?');
            const row = stmt.get(key);
            return row ? JSON.parse(row.value) : defaultValue;
        } catch (err) {
            console.error('[DB] Błąd odczytu ustawienia:', err);
            return defaultValue;
        }
    }

    getAllSettings() {
        try {
            const stmt = this.db.prepare('SELECT * FROM bot_settings');
            const rows = stmt.all();
            const settings = {};
            for (const row of rows) {
                settings[row.key] = JSON.parse(row.value);
            }
            return settings;
        } catch (err) {
            console.error('[DB] Błąd pobierania wszystkich ustawień:', err);
            return {};
        }
    }

    getRecentLogs(limit = 50) {
        try {
            const stmt = this.db.prepare(`
                SELECT * FROM bot_logs
                ORDER BY timestamp DESC
                LIMIT ?
            `);
            return stmt.all(limit).reverse();
        } catch (err) {
            console.error('[DB] Błąd pobierania logów:', err);
            return [];
        }
    }

    getStats() {
        try {
            const chatCount = this.db.prepare('SELECT COUNT(*) as cnt FROM chat_history').get();
            const logCount = this.db.prepare('SELECT COUNT(*) as cnt FROM bot_logs').get();
            const aiReplies = this.db.prepare("SELECT COUNT(*) as cnt FROM chat_history WHERE ai_response IS NOT NULL").get();
            return {
                totalChats: chatCount?.cnt || 0,
                totalLogs: logCount?.cnt || 0,
                aiReplies: aiReplies?.cnt || 0,
            };
        } catch (err) {
            return { totalChats: 0, totalLogs: 0, aiReplies: 0 };
        }
    }
}

module.exports = new BotDatabase();
