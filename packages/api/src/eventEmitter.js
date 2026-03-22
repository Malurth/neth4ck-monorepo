export class EventEmitter {
    constructor() {
        this._listeners = new Map();
    }

    on(event, fn) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, []);
        }
        this._listeners.get(event).push(fn);
        return this;
    }

    once(event, fn) {
        const wrapper = (...args) => {
            this.off(event, wrapper);
            fn(...args);
        };
        wrapper._original = fn;
        return this.on(event, wrapper);
    }

    off(event, fn) {
        const list = this._listeners.get(event);
        if (!list) {
            return this;
        }
        const idx = list.findIndex((f) => f === fn || f._original === fn);
        if (idx !== -1) {
            list.splice(idx, 1);
        }
        return this;
    }

    emit(event, ...args) {
        const list = this._listeners.get(event);
        if (!list) {
            return;
        }
        // Iterate over a copy since once() listeners remove themselves
        for (const fn of [...list]) {
            fn(...args);
        }
    }
}
