/**
 * A bounded array that evicts the oldest items when capacity is exceeded.
 * Supports bracket indexing (e.g. buf[0], buf[buf.length - 1]) via Proxy.
 */
export function createRingBuffer(capacity) {
    const items = [];

    const buffer = {
        push(item) {
            items.push(item);
            if (items.length > capacity) {
                items.shift();
            }
        },

        get length() {
            return items.length;
        },

        at(index) {
            if (index < 0) {
                return items[items.length + index];
            }
            return items[index];
        },

        toArray() {
            return [...items];
        },

        clear() {
            items.length = 0;
        },

        slice(...args) {
            return items.slice(...args);
        },

        filter(...args) {
            return items.filter(...args);
        },

        map(...args) {
            return items.map(...args);
        },

        forEach(...args) {
            items.forEach(...args);
        },

        find(...args) {
            return items.find(...args);
        },

        some(...args) {
            return items.some(...args);
        },

        every(...args) {
            return items.every(...args);
        },

        reduce(...args) {
            return items.reduce(...args);
        },

        includes(...args) {
            return items.includes(...args);
        },

        indexOf(...args) {
            return items.indexOf(...args);
        },

        [Symbol.iterator]() {
            return items[Symbol.iterator]();
        },
    };

    return new Proxy(buffer, {
        get(target, prop, receiver) {
            // Numeric index access: buf[0], buf[3], etc.
            if (typeof prop === "string" && /^\d+$/.test(prop)) {
                return items[Number(prop)];
            }
            return Reflect.get(target, prop, receiver);
        },
    });
}
