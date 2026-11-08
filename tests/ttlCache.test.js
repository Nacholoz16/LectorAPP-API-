const TtlCache = require('../src/utils/ttlCache');

describe('TtlCache', () => {
    afterEach(() => jest.useRealTimers());

    test('devuelve lo guardado mientras no expire', () => {
        const cache = new TtlCache({ ttlMs: 1000 });
        cache.set('a', [1, 2]);
        expect(cache.get('a')).toEqual([1, 2]);
        expect(cache.get('b')).toBeUndefined();
    });

    test('expira después del TTL', () => {
        jest.useFakeTimers();
        const cache = new TtlCache({ ttlMs: 1000 });
        cache.set('a', 1);
        jest.advanceTimersByTime(1001);
        expect(cache.get('a')).toBeUndefined();
    });

    test('expulsa la entrada menos usada al superar maxEntries', () => {
        const cache = new TtlCache({ maxEntries: 2 });
        cache.set('a', 1);
        cache.set('b', 2);
        cache.get('a'); // 'a' pasa a ser la más reciente
        cache.set('c', 3); // expulsa 'b'
        expect(cache.get('a')).toBe(1);
        expect(cache.get('b')).toBeUndefined();
        expect(cache.get('c')).toBe(3);
    });
});
