/**
 * Caché en memoria con expiración (TTL) y tamaño máximo (LRU simple).
 * Suficiente para un solo proceso Node. Si en el futuro hay varias instancias
 * detrás de un balanceador, reemplazar por Redis.
 */
class TtlCache {
    constructor({ maxEntries = 500, ttlMs = 10 * 60 * 1000 } = {}) {
        this.maxEntries = maxEntries;
        this.ttlMs = ttlMs;
        this.map = new Map(); // Map conserva el orden de inserción: el primero es el más antiguo
    }

    get(key) {
        const entry = this.map.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt <= Date.now()) {
            this.map.delete(key);
            return undefined;
        }
        // Marcar como usado recientemente (mover al final)
        this.map.delete(key);
        this.map.set(key, entry);
        return entry.value;
    }

    set(key, value) {
        this.map.delete(key);
        this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
        if (this.map.size > this.maxEntries) {
            // Expulsar el menos usado recientemente
            this.map.delete(this.map.keys().next().value);
        }
    }

    clear() {
        this.map.clear();
    }
}

module.exports = TtlCache;
