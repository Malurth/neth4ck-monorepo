import nethackStart from "@neth4ck/neth4ck";

import { createCallbackRouter } from "./callbackRouter.js";
import { DIRECTIONS } from "./constants.js";
import { EventEmitter } from "./eventEmitter.js";
import { createRingBuffer } from "./ringBuffer.js";

const DEFAULT_OPTIONS = {
    messageHistorySize: 200,
    mapCoordinateOrder: "yx",
};

export class NethackStateManager {
    constructor(options = {}) {
        this._options = { ...DEFAULT_OPTIONS, ...options };
        this._emitter = new EventEmitter();
        this._module = null;

        // Internal context shared with the callback router
        this._ctx = {
            state: null,
            emitter: this._emitter,
            options: this._options,
            pendingResolve: null,
            nextWindowId: 1,
        };

        this._initState();
        this._router = createCallbackRouter(this._ctx);
    }

    _initState() {
        this._ctx.state = {
            phase: "init",
            map: [],
            messages: createRingBuffer(this._options.messageHistorySize),
            status: {
                title: "",
                str: "",
                dx: 0,
                co: 0,
                in: 0,
                wi: 0,
                ch: 0,
                align: "",
                score: 0,
                carrying: "",
                gold: 0,
                energy: 0,
                energyMax: 0,
                xpLevel: 0,
                ac: 0,
                hd: 0,
                time: 0,
                hunger: "",
                hp: 0,
                hpMax: 0,
                levelDesc: "",
                exp: 0,
            },
            conditions: new Set(),
            pendingInput: null,
            activeMenu: null,
            inventoryNeedsUpdate: false,
            cursor: { x: 0, y: 0 },
            monsters: null,
            visibleMonsters: [],
        };
    }

    // ── Lifecycle ────────────────────────────

    async start(createModule, moduleOptions = {}) {
        const { nethackOptions, ...rest } = moduleOptions;
        const moduleConfig = {
            noInitialRun: true,
            ...rest,
            nethackOptions,
        };

        this._module = await nethackStart(createModule, this._router, moduleConfig);
        this._ctx.state.phase = "playing";
        this._emitter.emit("phaseChange", "playing");

        // Start the game loop (non-blocking — Asyncify suspends on input).
        // _main() runs synchronously through init (which installs helpers via
        // js_helpers_init) before suspending at the first input prompt.
        this._module._main(0, 0);

        // Build monster registry from WASM data (must be after _main, which
        // runs js_helpers_init to install getMonsterInfo/getNumMons)
        this._buildMonsterRegistry();

        return this;
    }

    // ── State Access ─────────────────────────

    /** Full game state object */
    get state() {
        return this._ctx.state;
    }

    /** Current map grid (MapTile[][]) */
    get map() {
        return this._ctx.state.map;
    }

    /** Player cursor position on the map: { x, y } */
    get cursor() {
        return this._ctx.state.cursor;
    }

    /** Status bar fields */
    get status() {
        return this._ctx.state.status;
    }

    /** Message history (supports bracket indexing, iteration, .length) */
    get messages() {
        return this._ctx.state.messages;
    }

    /** Active conditions as a Set of strings */
    get conditions() {
        return this._ctx.state.conditions;
    }

    /** Current game phase: "init" | "charSelect" | "playing" | "gameOver" */
    get phase() {
        return this._ctx.state.phase;
    }

    /** Current pending input prompt, or null if game is processing */
    get pendingInput() {
        return this._ctx.state.pendingInput;
    }

    /** Current open menu, or null */
    get activeMenu() {
        return this._ctx.state.activeMenu;
    }

    /** Whether the game is waiting for player input */
    get isWaitingForInput() {
        return this._ctx.state.pendingInput !== null;
    }

    /** The type of input currently expected, or null */
    get pendingInputType() {
        return this._ctx.state.pendingInput?.type ?? null;
    }

    /**
     * Full monster registry — array of all monster types in this version.
     * Each entry: { index, name, symbol, level, speed, ac, mr, alignment,
     *   difficulty, color, ... }
     * Available after start(). null before start or if WASM lacks monster helpers.
     */
    get monsters() {
        return this._ctx.state.monsters;
    }

    /**
     * Monsters visible on the current map frame.
     * Each entry: { x, y, monsterIndex, name, isPet, isRidden, isDetected }
     * Updated on each mapUpdate event.
     */
    get visibleMonsters() {
        return this._ctx.state.visibleMonsters;
    }

    /** Whether inventory data is stale */
    get inventoryNeedsUpdate() {
        return this._ctx.state.inventoryNeedsUpdate;
    }

    /** Raw Emscripten WASM module (escape hatch) */
    get module() {
        return this._module;
    }

    /**
     * Game constants from the WASM module (colors, glyphs, attributes, etc.)
     * Available after start() — mirrors globalThis.nethackGlobal.constants
     */
    get constants() {
        return globalThis.nethackGlobal?.constants ?? null;
    }

    /**
     * Game globals from the WASM module (window IDs, player name, flags)
     * Available after start() — mirrors globalThis.nethackGlobal.globals
     */
    get globals() {
        return globalThis.nethackGlobal?.globals ?? null;
    }

    /**
     * Helper functions for glyph/tile mapping
     * Available after start() — mirrors globalThis.nethackGlobal.helpers
     */
    get helpers() {
        return globalThis.nethackGlobal?.helpers ?? null;
    }

    // ── Events ───────────────────────────────

    on(event, fn) {
        this._emitter.on(event, fn);
        return this;
    }

    once(event, fn) {
        this._emitter.once(event, fn);
        return this;
    }

    off(event, fn) {
        this._emitter.off(event, fn);
        return this;
    }

    // ── Input Methods ────────────────────────

    sendKey(key) {
        const code = typeof key === "string" ? key.charCodeAt(0) : key;
        this._resolveInput(["key", "poskey"], code);
    }

    sendDirection(dir) {
        const ch = DIRECTIONS[dir];
        if (!ch) {
            throw new Error(`unknown direction: ${dir}`);
        }
        this.sendKey(ch);
    }

    move(dir) {
        this.sendDirection(dir);
    }

    rest() {
        this.sendKey(".");
    }

    search() {
        this.sendKey("s");
    }

    answerYn(answer) {
        const code = typeof answer === "string" ? answer.charCodeAt(0) : answer;
        this._resolveInput(["yn"], code);
    }

    answerLine(text) {
        this._resolveInput(["line"], text);
    }

    selectMenuItems(identifiers) {
        this._resolveInput(["menu"], identifiers);
    }

    selectMenuItem(identifier) {
        this.selectMenuItems([identifier]);
    }

    dismissMenu() {
        this._resolveInput(["menu"], -1);
        this._ctx.state.activeMenu = null;
    }

    sendExtCmd(cmdIndex) {
        this._resolveInput(["extcmd"], cmdIndex);
    }

    resolveCharSelect(value) {
        this._resolveInput(["charSelect"], value);
    }

    sendPosition(x, y, mod = 0) {
        this._resolveInput(["poskey"], { x, y, mod });
    }

    // ── Internal ─────────────────────────────

    _buildMonsterRegistry() {
        const ng = globalThis.nethackGlobal;
        const pm = ng?.constants?.PERMONST;
        const cs = ng?.constants?.CLASS_SYM;
        const monsPtr = ng?.pointers?.mons;
        const monsymsPtr = ng?.pointers?.def_monsyms;
        const numMons = ng?.constants?.GLYPH?.NUMMONS;
        if (!pm || !cs || !monsPtr || !monsymsPtr || !numMons) {
            return;
        }

        const { getValue, UTF8ToString } = this._module;
        const registry = new Array(numMons);
        for (let i = 0; i < numMons; i++) {
            const base = monsPtr + i * pm.SIZEOF;

            // Name: 3.6.7 has MNAME (single pointer), 3.7 has PMNAMES (array)
            let name = null;
            if (pm.MNAME !== undefined) {
                const ptr = getValue(base + pm.MNAME, "*");
                if (ptr) name = UTF8ToString(ptr);
            } else {
                // 3.7: scan pmnames backward — NAM() sets only the last slot
                for (let g = pm.NUM_MGENDERS - 1; g >= 0; g--) {
                    const ptr = getValue(base + pm.PMNAMES + g * 4, "*");
                    if (ptr) { name = UTF8ToString(ptr); break; }
                }
            }

            // Symbol: look up mlet in def_monsyms
            const mlet = getValue(base + pm.MLET, "i8");
            const sym = String.fromCharCode(
                getValue(monsymsPtr + mlet * cs.SIZEOF + cs.SYM, "i8"),
            );

            registry[i] = Object.freeze({
                index: i,
                name,
                symbol: sym,
                level: getValue(base + pm.MLEVEL, "i8"),
                speed: getValue(base + pm.MMOVE, "i8"),
                ac: getValue(base + pm.AC, "i8"),
                mr: getValue(base + pm.MR, "i8"),
                alignment: getValue(base + pm.MALIGNTYP, "i8"),
                difficulty: getValue(base + pm.DIFFICULTY, "i8"),
                color: pm.MCOLOR !== undefined ? getValue(base + pm.MCOLOR, "i8") : 0,
            });
        }
        Object.freeze(registry);
        this._ctx.state.monsters = registry;
    }

    _resolveInput(allowedTypes, value) {
        const pending = this._ctx.state.pendingInput;
        if (!pending) {
            throw new Error("no pending input to resolve");
        }
        if (!allowedTypes.includes(pending.type)) {
            throw new Error(`wrong input type: expected one of [${allowedTypes.join(", ")}], got '${pending.type}'`);
        }
        const resolve = this._ctx.pendingResolve;
        if (!resolve) {
            throw new Error("no pending resolve function");
        }
        this._ctx.state.pendingInput = null;
        this._ctx.pendingResolve = null;
        if (pending.type === "menu") {
            this._ctx.state.activeMenu = null;
        }
        resolve(value);
    }
}
