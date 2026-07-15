'use strict';

/**
 * Redis z fallbackiem in-memory gdy Redis nie działa.
 * Używany do kolejki komend, cache stanu bota i pub/sub zdarzeń.
 */
const memoryStore = new Map();
const memoryLists = new Map();
let client = null;
let useMemory = true;

async function connect() {
    const url = process.env.REDIS_URL || process.env.MAW_REDIS_URL || 'redis://127.0.0.1:6379';
    if (String(process.env.MAW_REDIS_ENABLED || 'true').toLowerCase() === 'false') {
        console.log('[Redis] Wyłączony — używam pamięci RAM');
        return false;
    }

    try {
        const { createClient } = require('redis');
        client = createClient({ url });
        client.on('error', err => console.warn('[Redis]', err.message));
        await client.connect();
        useMemory = false;
        console.log('[Redis] Połączono:', url);
        return true;
    } catch (err) {
        console.warn('[Redis] Brak połączenia — fallback RAM:', err.message);
        client = null;
        useMemory = true;
        return false;
    }
}

async function get(key) {
    if (useMemory || !client) return memoryStore.get(key) ?? null;
    const val = await client.get(key);
    return val == null ? null : val;
}

async function set(key, value, ttlSec = 0) {
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    if (useMemory || !client) {
        memoryStore.set(key, str);
        if (ttlSec > 0) setTimeout(() => memoryStore.delete(key), ttlSec * 1000);
        return;
    }
    if (ttlSec > 0) await client.setEx(key, ttlSec, str);
    else await client.set(key, str);
}

async function getJson(key, fallback = null) {
    const raw = await get(key);
    if (raw == null) return fallback;
    try {
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

async function setJson(key, obj, ttlSec = 0) {
    await set(key, JSON.stringify(obj), ttlSec);
}

async function pushList(key, value) {
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    if (useMemory || !client) {
        if (!memoryLists.has(key)) memoryLists.set(key, []);
        memoryLists.get(key).push(str);
        return;
    }
    await client.rPush(key, str);
}

async function popList(key) {
    if (useMemory || !client) {
        const list = memoryLists.get(key) || [];
        return list.shift() ?? null;
    }
    return await client.lPop(key);
}

async function publish(channel, message) {
    const str = typeof message === 'string' ? message : JSON.stringify(message);
    if (useMemory || !client) return;
    await client.publish(channel, str);
}

module.exports = {
    connect,
    get,
    set,
    getJson,
    setJson,
    pushList,
    popList,
    publish,
    isMemory: () => useMemory,
};
