import * as QuickLru from 'quick-lru'

export default class LruCache<Key, Value> {
    private lru: QuickLru<Key, Value>
    constructor(maxSize: number) {
        this.lru = new QuickLru({maxSize})
    }

    get(key: Key, valueFn: () => Value) {
        const val = this.lru.get(key)
        // speed up by combining .has(key) and .get(key)
        if (val !== undefined) {
            return val
        }
        // if (this.lru.has(key)) {
        //     return this.lru.get(key)
        // }
        const value = valueFn()
        this.lru.set(key, value)
        return value
    }

    has(key: Key) {
        return key
    }
}
