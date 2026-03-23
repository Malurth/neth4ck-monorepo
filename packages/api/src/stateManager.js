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
            inventory: [],
            inventoryNeedsUpdate: false,
            cursor: { x: 0, y: 0 },
            monsters: null,
            visibleMonsters: [],
        };
    }

    // ── Lifecycle ────────────────────────────

    async start(createModule, moduleOptions = {}) {
        const { nethackOptions, ...rest } = moduleOptions;

        // Separate API-level options, birth options, and game options.
        // Birth options (role/race/gender/align) are character creation
        // parameters handled by the API — they don't belong in the core
        // package's NETHACKOPTIONS formatter.
        const {
            skipTutorial = true,
            role, race, gender, align,
            ...gameOptions
        } = nethackOptions ?? {};

        // Build a preRun hook that appends birth options to NETHACKOPTIONS.
        // This runs before nethackStart's own setupNethackOptions preRun,
        // so both birth options and game options end up in the env var.
        const birthOptParts = [];
        if (role) birthOptParts.push(`role:${role}`);
        if (race) birthOptParts.push(`race:${race}`);
        if (gender) birthOptParts.push(`gender:${gender}`);
        if (align) birthOptParts.push(`align:${align}`);

        const consumerPreRun = rest.preRun ?? [];
        const preRunArray = Array.isArray(consumerPreRun)
            ? [...consumerPreRun] : [consumerPreRun];
        if (birthOptParts.length > 0) {
            preRunArray.push((mod) => {
                const existing = (mod.ENV?.NETHACKOPTIONS ?? "").trim();
                mod.ENV = mod.ENV || {};
                mod.ENV.NETHACKOPTIONS = existing
                    ? `${existing},${birthOptParts.join(",")}`
                    : birthOptParts.join(",");
            });
        }

        const moduleConfig = {
            noInitialRun: true,
            ...rest,
            preRun: preRunArray,
            nethackOptions: Object.keys(gameOptions).length > 0
                ? gameOptions : undefined,
        };

        this._module = await nethackStart(createModule, this._router, moduleConfig);
        this._ctx.module = this._module;

        // Install startup handler BEFORE _main so it catches the very first
        // input prompt (charSelect). External listeners registered before
        // start() also fire, but _runStartupSequence resolves the prompts.
        const startupDone = this._runStartupSequence(
            gameOptions?.name, { skipTutorial });

        // Start the game loop (non-blocking — Asyncify suspends on input).
        // _main() runs synchronously through init (which installs helpers via
        // js_helpers_init) before suspending at the first input prompt.
        this._module._main(0, 0);

        // Build monster registry from WASM data (must be after _main, which
        // runs js_constants_init to export struct pointers and offsets)
        this._buildMonsterRegistry();

        // Refresh inventory on every input prompt — this is when the game is
        // suspended and WASM memory is stable. Compares against the previous
        // snapshot and only emits inventoryUpdate if something changed.
        this.on("inputRequired", () => this._maybeRefreshInventory());

        // Wait for the startup sequence to complete (charSelect → askname →
        // intro text → tutorial → first gameplay input).
        await startupDone;

        return this;
    }

    /**
     * Intro backstory text captured during startup (array of strings).
     * Available after start() resolves. Empty if no intro text was shown.
     */
    get introText() {
        return this._introText ?? [];
    }

    /**
     * Messages captured during startup (e.g. "Hello Player, welcome to
     * NetHack!"). Array of { text, attr, turn } objects. Available after
     * start() resolves.
     */
    get startupMessages() {
        return this._startupMessages ?? [];
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
     *   difficulty, color }
     * Available after start(). null before start or if WASM lacks exported struct data.
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

    /**
     * Current inventory items, read from WASM memory. Auto-refreshes on input prompts.
     * Each entry: { letter, name, appearance, oclass, otyp, quantity, enchantment, worn, wornMask }
     */
    get inventory() {
        return this._ctx.state.inventory;
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

    /**
     * Auto-resolve all startup prompts (charSelect, askname, intro text
     * windows, tutorial yn) and transition to "playing" phase.
     * Resolves when the game is waiting for the first real gameplay input.
     */
    _runStartupSequence(name, { skipTutorial = true } = {}) {
        this._introText = [];
        this._startupMessages = [];
        let sawMap = false;
        let keyPromptCount = 0;

        // Capture text windows during startup
        const textHandler = (lines) => {
            this._introText.push(...lines);
        };
        this.on("textWindow", textHandler);

        // Capture messages during startup (e.g. "Hello, welcome to NetHack!")
        const messageHandler = (msg) => {
            this._startupMessages.push(msg);
        };
        this.on("message", messageHandler);

        // Track when the first map update arrives
        const mapHandler = () => { sawMap = true; };
        this.on("mapUpdate", mapHandler);

        return new Promise((resolve) => {
            const cleanup = () => {
                this._ctx.startupInputHandler = null;
                this.off("textWindow", textHandler);
                this.off("message", messageHandler);
                this.off("mapUpdate", mapHandler);
                this._ctx.state.phase = "playing";
                this._emitter.emit("phaseChange", "playing");
                // Populate inventory before resolving so it's ready
                // when start() returns.
                this._maybeRefreshInventory();
                resolve();
            };

            // Install as ctx.startupInputHandler so it intercepts prompts
            // before they reach external inputRequired listeners.
            this._ctx.startupInputHandler = (prompt) => {
                switch (prompt.type) {
                    case "charSelect":
                        this.resolveCharSelect(false);
                        break;
                    case "line":
                        this.answerLine(name || "");
                        break;
                    case "yn":
                        if (skipTutorial) {
                            this.answerYn(prompt.default || "y");
                        } else {
                            // Forward to consumer — startup is done
                            cleanup();
                            this._emitter.emit("inputRequired", prompt);
                        }
                        break;
                    case "menu": {
                        const items = prompt.menu?.items ?? [];
                        const how = prompt.menu?.selectionMode;
                        const isTutorial = (prompt.menu?.prompt ?? "")
                            .toLowerCase().includes("tutorial");

                        if (isTutorial && !skipTutorial) {
                            // User wants the tutorial — forward to consumer
                            cleanup();
                            this._emitter.emit("inputRequired", prompt);
                        } else if (how === 1 || how === "PICK_ONE") {
                            // PICK_ONE: find the "no" option for tutorial,
                            // otherwise pick the first selectable item.
                            const noItem = items.find(i => i.accelerator === "n");
                            const firstItem = items.find(i => i.identifier);
                            const pick = noItem || firstItem;
                            if (pick) {
                                this.selectMenuItems([pick.identifier]);
                            } else {
                                this.dismissMenu();
                            }
                        } else {
                            this.selectMenuItems([]);
                        }
                        break;
                    }
                    case "key":
                    case "poskey":
                        keyPromptCount++;
                        if (sawMap && keyPromptCount >= 2) {
                            // After map + at least 2 key prompts (text window + gameplay),
                            // startup is done.
                            cleanup();
                            this._emitter.emit("inputRequired", prompt);
                        } else {
                            this.sendKey(32);
                        }
                        break;
                    case "extcmd":
                        this.sendExtCmd(-1);
                        break;
                    default:
                        this.sendKey(27); // ESC fallback
                        break;
                }
            };
        });
    }

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

    _maybeRefreshInventory() {
        const prev = this._ctx.state.inventory;
        this.refreshInventory();
        const curr = this._ctx.state.inventory;
        // Quick change detection: different length, or any letter/otyp/quan mismatch
        if (prev.length !== curr.length
            || prev.some((p, i) => p.letter !== curr[i].letter
                || p.otyp !== curr[i].otyp
                || p.quantity !== curr[i].quantity)) {
            this._emitter.emit("inventoryUpdate", curr);
        }
    }

    /**
     * Read inventory directly from WASM memory.
     * Walks the invent linked list and snapshots each item.
     */
    refreshInventory() {
        const ng = globalThis.nethackGlobal;
        const obj = ng?.constants?.OBJ;
        const oc = ng?.constants?.OBJCLASS;
        const od = ng?.constants?.OBJDESCR;
        // 3.7 exports as "gi.invent", 3.6.7 as "invent"
        const inventPtr = ng?.pointers?.["gi.invent"] ?? ng?.pointers?.invent;
        const objectsPtr = ng?.pointers?.objects;
        const objDescrPtr = ng?.pointers?.obj_descr;
        if (!obj || !oc || !od || !inventPtr || !objectsPtr || !objDescrPtr) {
            return;
        }

        const { getValue, UTF8ToString } = this._module;
        const items = [];

        // inventPtr is &invent (pointer to a pointer) — dereference to get list head
        let cur = getValue(inventPtr, "*");
        while (cur) {
            const otyp = getValue(cur + obj.OTYP, "i16");
            const oclass = getValue(cur + obj.OCLASS, "i8");
            const invlet = String.fromCharCode(getValue(cur + obj.INVLET, "i8"));
            const quan = getValue(cur + obj.QUAN, "i32");
            const spe = getValue(cur + obj.SPE, "i8");
            const owornmask = getValue(cur + obj.OWORNMASK, "i32");

            // Look up name: obj_descr[objects[otyp].oc_name_idx].oc_name
            const ocBase = objectsPtr + otyp * oc.SIZEOF;
            const nameIdx = getValue(ocBase + oc.OC_NAME_IDX, "i16");
            const descrIdx = getValue(ocBase + oc.OC_DESCR_IDX, "i16");
            const namePtr = getValue(objDescrPtr + nameIdx * od.SIZEOF + od.OC_NAME, "*");
            const descrPtr = getValue(objDescrPtr + descrIdx * od.SIZEOF + od.OC_DESCR, "*");
            const name = namePtr ? UTF8ToString(namePtr) : null;
            const appearance = descrPtr ? UTF8ToString(descrPtr) : null;

            items.push({
                letter: invlet,
                name,
                appearance,
                oclass,
                otyp,
                quantity: quan,
                enchantment: spe,
                worn: owornmask !== 0,
                wornMask: owornmask,
            });

            cur = getValue(cur + obj.NOBJ, "*");
        }

        this._ctx.state.inventory = items;
        this._ctx.state.inventoryNeedsUpdate = false;
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
