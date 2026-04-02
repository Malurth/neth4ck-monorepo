import nethackStart from "@neth4ck/neth4ck";

import { createCallbackRouter } from "./callbackRouter.js";
import { ACTION_KEYS, DIRECTIONS, EXTENDED_COMMANDS } from "./constants.js";
import { EventEmitter } from "./eventEmitter.js";
import { createRingBuffer } from "./ringBuffer.js";

const DEFAULT_OPTIONS = {
    messageHistorySize: 200,
    mapCoordinateOrder: "yx",
    autoResolvePickNone: false,
    autoDismissMenus: "",  //falsy = off, "dismiss" = dismiss only, "resend" = dismiss + resend input
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
                dlvl: 0,
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
            visibleItems: [],
            visibleFeatures: [],
        };
        this._pendingDirectionalAction = null;
        this._savesMounted = false;
    }

    // ── Lifecycle ────────────────────────────

    async start(createModule, moduleOptions = {}) {
        const { nethackOptions, saves, saveDir, ...rest } = moduleOptions;

        // Separate API-level options, birth options, game options, and
        // general NETHACKOPTIONS entries.
        const {
            skipTutorial = true,
            role, race, gender, align,
            options: extraOptions,
            ...gameOptions
        } = nethackOptions ?? {};

        // Build NETHACKOPTIONS parts from birth options + general options.
        // These are appended to the NETHACKOPTIONS env var via a preRun hook,
        // which runs before nethackStart's own setupNethackOptions preRun.
        const optParts = [];
        if (role) optParts.push(`role:${role}`);
        if (race) optParts.push(`race:${race}`);
        if (gender) optParts.push(`gender:${gender}`);
        if (align) optParts.push(`align:${align}`);
        // General NETHACKOPTIONS: accepts an array of strings like
        // ["color", "number_pad:0", "showexp"] or a single string.
        if (extraOptions) {
            const extras = Array.isArray(extraOptions)
                ? extraOptions : [extraOptions];
            optParts.push(...extras);
        }

        const consumerPreRun = rest.preRun ?? [];
        const preRunArray = Array.isArray(consumerPreRun)
            ? [...consumerPreRun] : [consumerPreRun];
        if (optParts.length > 0) {
            preRunArray.push((mod) => {
                const existing = (mod.ENV?.NETHACKOPTIONS ?? "").trim();
                mod.ENV = mod.ENV || {};
                mod.ENV.NETHACKOPTIONS = existing
                    ? `${existing},${optParts.join(",")}`
                    : optParts.join(",");
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

        // ── Save filesystem setup ──
        // Must happen AFTER module init (FS available) but BEFORE _main
        // (game reads saves during startup). Properly awaits IDBFS sync.
        const saveMode = saves ?? "none";
        if (saveMode !== "none") {
            await this._setupSaveFilesystem(saveMode, saveDir || "/save");
        }

        // Reset nethackGlobal to prevent stale data from a previous game
        // session. _main() will re-populate it via js_helpers_init,
        // js_constants_init, and js_globals_init.
        globalThis.nethackGlobal = {};

        // Start the game loop (non-blocking — Asyncify suspends on input).
        // _main() runs synchronously through init (which installs helpers via
        // js_helpers_init) before suspending at the first input prompt.
        this._module._main(0, 0);

        // Capture this session's nethackGlobal on the context so all reads
        // are scoped to this game instance, not the (overwritable) global.
        this._ctx.ng = globalThis.nethackGlobal;

        // Build monster registry from WASM data (must be after _main, which
        // runs js_constants_init to export struct pointers and offsets)
        this._buildMonsterRegistry();

        // Refresh inventory on every input prompt and map update — these are
        // points when the game is suspended and WASM memory is stable.
        // Compares against the previous snapshot and only emits
        // inventoryUpdate if something changed.
        this.on("inputRequired", () => {
            this._maybeRefreshInventory();
            this._refreshGivenNames();
        });
        this.on("mapUpdate", () => this._maybeRefreshInventory());

        // Auto-persist saves to IndexedDB when the game ends
        this.on("phaseChange", (phase) => {
            if (phase === "gameOver" && this._savesMounted) {
                this.syncSaves().catch((e) =>
                    console.warn("[saves] sync on exit failed:", e));
            }
        });

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

    /** Player's true map coordinates (unaffected by farlook/targeting): { x, y } */
    get playerPos() {
        const mod = this._ctx.module;
        if (mod?._get_player_x && mod?._get_player_y) {
            return { x: mod._get_player_x(), y: mod._get_player_y() };
        }
        // Fallback to cursor if WASM functions aren't available
        return this._ctx.state.cursor;
    }

    /** Current input state from the C engine.
     * 0 = otherInp, 1 = commandInp, 2 = getposInp, 3 = getdirInp.
     * Use isPositionSelection for a convenient boolean check. */
    get inputState() {
        const mod = this._ctx.module;
        if (mod?._get_input_state) {
            return mod._get_input_state();
        }
        return 0;
    }

    /** Whether the game is currently in position selection mode
     * (farlook, targeting, teleport destination, etc.). */
    get isPositionSelection() {
        return this.inputState === 2;
    }

    /**
     * Get the clean screen description for a map position.
     * Returns the unambiguous "firstmatch" description (e.g. "closed door",
     * "a jackal", "a long sword") or an empty string if nothing is there.
     * Synchronous — reads from WASM memory without triggering game prompts.
     */
    lookAt(x, y) {
        const mod = this._ctx.module;
        if (!mod?._get_screen_description) return "";
        const ptr = mod._get_screen_description(x, y);
        if (!ptr) return "";
        return mod.UTF8ToString(ptr);
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
     * Items visible on the current map frame (objects, statues, corpses).
     * Each entry: { x, y, ch, color, glyph, tileType, tileLabel, category }
     * Updated on each mapUpdate event.
     */
    get visibleItems() {
        return this._ctx.state.visibleItems;
    }

    /**
     * Notable features visible on the current map frame (stairs, fountains, altars, etc.).
     * Each entry: { x, y, ch, color, glyph, name }
     * Updated on each mapUpdate event.
     */
    get visibleFeatures() {
        return this._ctx.state.visibleFeatures;
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
     * Available after start() — scoped to this game session.
     */
    get constants() {
        return this._ctx.ng?.constants ?? null;
    }

    /**
     * Game globals from the WASM module (window IDs, player name, flags)
     * Available after start() — scoped to this game session.
     */
    get globals() {
        return this._ctx.ng?.globals ?? null;
    }

    /**
     * Helper functions for glyph/tile mapping
     * Available after start() — scoped to this game session.
     */
    get helpers() {
        return this._ctx.ng?.helpers ?? null;
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

    // ── High-level Actions ─────────────────────

    /**
     * Dispatch a named action. Handles:
     *   - "verb:letter" (e.g. "eat:d") → verb method with item letter
     *   - "move_north", "move_southeast", etc. → directional movement
     *   - extended commands ("pray", "loot") → #name\n key sequence
     *   - mapped actions ("search", "pickup") → raw key sequence
     *   - fallback → treat as raw key via handleKey
     *
     * Fire-and-forget — does not return a promise. Listen for events
     * (mapUpdate, inputRequired, etc.) to react to the result.
     */
    _emitAction(info) {
        // Track non-trivial actions as potential directional parents.
        // When a direction yn prompt follows, we merge the direction into
        // the pending action to produce e.g. {action: "kick", direction: "w"}.
        const trivial = new Set(["answer", "move", "key", "direction", "menuDismiss", "menuSelect"]);
        if (!trivial.has(info.action)) {
            this._pendingDirectionalAction = info;
        }
        this._emitter.emit("actionTaken", info);
    }

    /**
     * Whether the current yn prompt is a direction prompt (getdir).
     * 3.7: C engine sets inputState = 3 (getdirInp).
     * 3.6.7: falls back to regex on the yn query text.
     */
    _isDirectionPrompt() {
        if (this.inputState === 3) return true;
        const query = this.pendingInput?.query || "";
        return /direction/i.test(query);
    }

    action(name) {
        // If a yn prompt is active (e.g. "In what direction?", "Really attack?"),
        // route single-key actions through answerYn. For direction prompts,
        // merge with the pending action (e.g. kick + west → {action: "kick", direction: "w"}).
        if (this.pendingInputType === "yn") {
            const isDir = this._isDirectionPrompt();
            const pending = this._pendingDirectionalAction;

            // Directional movement → send direction char as yn answer
            if (name.startsWith("move_")) {
                const dir = name.slice(5);
                const ch = DIRECTIONS[dir];
                if (ch) {
                    if (isDir && pending) {
                        this._emitter.emit("actionTaken", { ...pending, direction: dir });
                        this._pendingDirectionalAction = null;
                    } else {
                        this._emitAction({ action: "direction", direction: dir });
                    }
                    this.answerYn(ch);
                    return;
                }
            }
            // Mapped single-key actions → send the key as yn answer
            const keys = ACTION_KEYS[name];
            if (keys && keys.length === 1) {
                this._emitAction({ action: name });
                this.answerYn(keys[0]);
                return;
            }
            // Multi-step actions can't be dispatched during yn
            this._emitter.emit("inputBlocked", { reason: "yn", action: name });
            throw new Error("cannot dispatch action: yn prompt is active");
        }

        // If a menu is blocking, handle based on autoDismissMenus setting.
        // PICK_ANY menus are never auto-dismissed (require real user choices).
        if (this.pendingInputType === "menu") {
            const mode = this.activeMenu?.selectionMode;
            const dismiss = this._options.autoDismissMenus;
            if (dismiss && mode !== 2 && mode !== "PICK_ANY") {
                this.dismissMenu();
                // "resend": re-dispatch the action once the game processes the dismiss
                if (dismiss === "resend") {
                    this.once("inputRequired", () => this.action(name));
                }
            } else {
                this._emitter.emit("inputBlocked", { reason: "menu", action: name });
            }
            return;
        }

        // "action:direction" compound syntax — dispatch the action and
        // auto-answer the direction yn prompt in one call.
        // Must be checked before "verb:letter" to avoid misinterpreting
        // direction names as inventory letters.
        const colonIdx = name.indexOf(":");
        if (colonIdx > 0) {
            const base = name.slice(0, colonIdx);
            const suffix = name.slice(colonIdx + 1);

            // "action:direction" compound syntax (kick:north, loot:southwest, etc.)
            // Direction names are multi-char so they can't collide with
            // single-letter inventory letters.
            if (DIRECTIONS[suffix] !== undefined) {
                this._emitAction({ action: base, direction: suffix });
                this._pendingDirectionalAction = null;
                this._dispatchDirectionalAction(base, suffix);
                return;
            }

            // "verb:letter" → call the verb method (eat, wield, etc.)
            if (typeof this[base] === "function") {
                this._emitAction({ action: base, item: suffix });
                this[base](suffix);
                return;
            }
        }

        // Directional movement (move_north, move_southeast, etc.)
        if (name.startsWith("move_")) {
            const dir = name.slice(5); // "move_northeast" → "northeast"
            this._emitAction({ action: "move", direction: dir });
            this.move(dir);
            return;
        }

        // Extended command (#name → extcmd index)
        if (EXTENDED_COMMANDS.has(name)) {
            this._emitAction({ action: name });
            const idx = this._lookupExtCmdIndex(name);
            // Use an inputInterceptor to catch the extcmd prompt that
            // fires asynchronously after sendKey("#") via Asyncify.
            // Same pattern as quit() — sendExtCmd can't be called
            // immediately because the prompt isn't set up yet.
            this._ctx.inputInterceptor = (prompt) => {
                this._ctx.inputInterceptor = null;
                if (prompt.type === "extcmd") {
                    this.sendExtCmd(idx);
                    return true;
                }
                return false; // forward unexpected prompts to listeners
            };
            this.sendKey("#");
            return;
        }

        // Mapped action → key sequence
        const keys = ACTION_KEYS[name];
        if (keys) {
            this._emitAction({ action: name });
            for (const key of keys) {
                this.sendKey(key);
            }
            return;
        }

        // Fallback: treat as raw key
        this._emitAction({ action: "key", key: name });
        this.handleKey(name);
    }

    /**
     * Quit the game. Sends #quit and auto-confirms all subsequent prompts
     * ("Really quit?" → y, "DYWYPI?" → n).
     *
     * Returns a promise that resolves when the quit sequence is complete
     * (game over phase). The promise rejects if the game isn't in a state
     * where quitting is possible.
     */
    quit() {
        this._emitAction({ action: "quit" });
        if (this._ctx.inputInterceptor) {
            return Promise.reject(
                new Error("another input sequence is already in progress")
            );
        }
        const inputType = this.pendingInputType;
        if (inputType && inputType !== "key" && inputType !== "poskey") {
            return Promise.reject(
                new Error(
                    `cannot quit: game is waiting for '${inputType}' input, not gameplay`
                )
            );
        }

        // Install interceptor to auto-answer all prompts during quit
        this._ctx.inputInterceptor = (prompt) => {
            if (prompt.type === "extcmd") {
                const idx = this._lookupExtCmdIndex("quit");
                this.sendExtCmd(idx);
                return true;
            }
            if (prompt.type === "yn") {
                const query = (prompt.query || "").toLowerCase();
                if (query.includes("really quit")) {
                    this.answerYn("y");
                    return true;
                }
                if (query.includes("possessions identified")
                        || query.includes("disclosure")) {
                    this.answerYn("n");
                    return true;
                }
                // Any other yn during quit — default to the prompt's default
                this.answerYn(prompt.default || "n");
                return true;
            }
            if (prompt.type === "key") {
                // "--More--" or similar during quit — dismiss
                this.sendKey(" ");
                return true;
            }
            return false;
        };

        // Send # to trigger the extended command prompt.
        // The entire quit sequence (extcmd → yn prompts → exit) runs
        // synchronously via Asyncify before sendKey returns.
        this.sendKey("#");

        // Clean up and set gameOver — the WASM process has exited by now.
        this._ctx.inputInterceptor = null;
        this._ctx.state.phase = "gameOver";
        this._emitter.emit("phaseChange", "gameOver");

        return Promise.resolve();
    }

    // ── Save Management ─────────────────────

    /**
     * Mount IDBFS at the given path and sync from IndexedDB.
     * If mode is 'clear', deletes all save files and syncs the deletion.
     * Skips silently if IDBFS is not available (Node.js tests).
     */
    async _setupSaveFilesystem(mode, dir) {
        const mod = this._module;
        const FS = mod?.FS;
        const IDBFS = FS?.filesystems?.IDBFS ?? mod?.IDBFS;

        if (!FS || !IDBFS) {
            console.warn("[saves] IDBFS not available, saves will not persist");
            return;
        }

        try { FS.mkdir(dir); } catch { /* already exists */ }
        FS.mount(IDBFS, {}, dir);

        // Populate from IndexedDB → memory FS (await completion)
        await new Promise((resolve, reject) => {
            FS.syncfs(true, (err) => err ? reject(err) : resolve(undefined));
        });

        if (mode === "clear") {
            const files = FS.readdir(dir).filter((f) => f !== "." && f !== "..");
            for (const file of files) {
                try { FS.unlink(`${dir}/${file}`); } catch { /* ignore */ }
            }
            // Persist deletion back to IndexedDB
            await new Promise((resolve, reject) => {
                FS.syncfs(false, (err) => err ? reject(err) : resolve(undefined));
            });
        }

        this._savesMounted = true;
        this._saveDir = dir;
    }

    /**
     * Persist save files from memory FS to IndexedDB.
     * Call after game save/quit to ensure saves survive page reloads.
     */
    async syncSaves() {
        if (!this._savesMounted) return;
        const FS = this._module?.FS;
        if (!FS) return;
        await new Promise((resolve, reject) => {
            FS.syncfs(false, (err) => err ? reject(err) : resolve(undefined));
        });
        this._emitter.emit("savesSynced");
    }

    // ── Input Methods ────────────────────────

    /**
     * Dispatch a command that expects a direction prompt, auto-answering it.
     * Works for both ACTION_KEYS commands (kick, open, close) and
     * EXTENDED_COMMANDS (loot, untrap, chat).
     */
    _dispatchDirectionalAction(actionName, direction) {
        const dirChar = DIRECTIONS[direction];
        if (!dirChar) throw new Error(`unknown direction: ${direction}`);

        // Interceptor that catches the direction yn prompt and auto-answers it.
        const answerDirection = (prompt) => {
            this._ctx.inputInterceptor = null;
            if (prompt.type === "yn" && this._isDirectionPrompt()) {
                this.answerYn(dirChar);
                return true;
            }
            // Not a direction prompt (e.g. "Really attack?") — forward to listeners
            return false;
        };

        if (EXTENDED_COMMANDS.has(actionName)) {
            // Extended command: send "#", intercept extcmd prompt, THEN intercept direction
            const idx = this._lookupExtCmdIndex(actionName);
            this._ctx.inputInterceptor = (prompt) => {
                if (prompt.type === "extcmd") {
                    // Chain: now install the direction interceptor
                    this._ctx.inputInterceptor = answerDirection;
                    this.sendExtCmd(idx);
                    return true;
                }
                return false;
            };
            this.sendKey("#");
        } else {
            // Mapped action key: send the key(s), then intercept direction
            const keys = ACTION_KEYS[actionName];
            if (!keys) throw new Error(`unknown directional action: ${actionName}`);
            this._ctx.inputInterceptor = answerDirection;
            for (const key of keys) {
                this.sendKey(key);
            }
        }
    }

    /**
     * Route a keystroke to the correct input handler based on the current
     * prompt type. Convenience method so frontends don't need to inspect
     * pendingInputType and branch themselves.
     *
     * - yn prompt → answerYn (merges with pending directional action if applicable)
     * - menu prompt + ESC → dismissMenu; otherwise selectMenuItem
     * - key/poskey/anything else → sendKey
     */
    handleKey(key) {
        const type = this.pendingInputType;
        if (type === "yn") {
            // Check for directional merge: if a kick/loot/etc. is pending
            // and this yn is a direction prompt, emit the combined event.
            if (this._pendingDirectionalAction && this._isDirectionPrompt()) {
                const code = typeof key === "string" ? key.charCodeAt(0) : key;
                const dirEntry = Object.entries(DIRECTIONS).find(
                    ([, ch]) => ch.charCodeAt(0) === code
                );
                if (dirEntry) {
                    const [dir] = dirEntry;
                    this._emitter.emit("actionTaken", {
                        ...this._pendingDirectionalAction, direction: dir,
                    });
                    this._pendingDirectionalAction = null;
                    this.answerYn(key);
                    return;
                }
            }
            this._emitAction({ action: "answer", key, promptType: "yn" });
            this.answerYn(key);
        } else if (type === "line") {
            // Line input (naming monsters, engraving text, etc.)
            // Single keystrokes can't answer a line prompt — ESC cancels,
            // anything else is ignored. Use answerLine(text) instead.
            const code = typeof key === "string" ? key.charCodeAt(0) : key;
            if (code === 27) { // ESC
                this._emitAction({ action: "lineDismiss" });
                this.answerLine("");
            }
            // Other keys silently ignored — frontend should show a text input
        } else if (type === "menu") {
            const code = typeof key === "string" ? key.charCodeAt(0) : key;
            if (code === 27) { // ESC
                this._emitAction({ action: "menuDismiss" });
                this.dismissMenu();
            } else {
                this._emitAction({ action: "menuSelect", key });
                this.selectMenuItem(key);
            }
        } else {
            this._emitAction({ action: "key", key });
            this.sendKey(key);
        }
    }

    /**
     * If a menu is currently blocking, dismiss it. Returns true if a menu
     * was dismissed, false otherwise. Useful for auto-clearing informational
     * menus (tutorials, etc.) that shouldn't block gameplay input.
     */
    dismissIfMenu() {
        if (this.pendingInputType === "menu") {
            this.dismissMenu();
            return true;
        }
        return false;
    }

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

    /**
     * Handle a map click at (x, y). If the game is in position selection
     * mode (farlook, targeting, etc.), sends the position. Otherwise
     * computes directional movement toward the clicked tile.
     */
    handleClick(x, y) {
        // If a non-directional prompt is active, clicks can't be processed.
        const inputType = this.pendingInputType;
        if (inputType === "menu" || inputType === "line" || inputType === "extcmd") {
            this._emitter.emit("inputBlocked", { reason: inputType, x, y });
            return;
        }
        // If a yn prompt is active (e.g. "In what direction?"), compute
        // direction and send as yn answer so kicks/loots etc. work via click.
        if (inputType === "yn") {
            if (!this._isDirectionPrompt()) return; // ignore clicks for non-direction yn
            const pos = this.playerPos;
            const dx = Math.sign(x - pos.x);
            const dy = Math.sign(y - pos.y);
            if (dx === 0 && dy === 0) return;
            const dirMap = {
                "0,-1": "north", "0,1": "south", "1,0": "east", "-1,0": "west",
                "1,-1": "northeast", "-1,-1": "northwest", "1,1": "southeast", "-1,1": "southwest",
            };
            const dir = dirMap[`${dx},${dy}`];
            if (dir) {
                const ch = DIRECTIONS[dir];
                if (ch) {
                    const pending = this._pendingDirectionalAction;
                    if (pending) {
                        this._emitter.emit("actionTaken", { ...pending, direction: dir, x, y });
                        this._pendingDirectionalAction = null;
                    } else {
                        this._emitAction({ action: "direction", direction: dir, x, y });
                    }
                    this.answerYn(ch);
                }
            }
            return;
        }
        if (this.isPositionSelection) {
            const description = this.lookAt(x, y);
            this._emitAction({ action: "farlook", x, y, description });
            this.sendPosition(x, y);
        } else {
            const pos = this.playerPos;
            const dx = Math.sign(x - pos.x);
            const dy = Math.sign(y - pos.y);
            if (dx === 0 && dy === 0) return;
            const dirMap = {
                "0,-1": "north", "0,1": "south", "1,0": "east", "-1,0": "west",
                "1,-1": "northeast", "-1,-1": "northwest", "1,1": "southeast", "-1,1": "southwest",
            };
            const dir = dirMap[`${dx},${dy}`];
            if (dir) {
                this._emitAction({ action: "move", direction: dir, x, y });
                this.move(dir);
            }
        }
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

    sendPosition(x, y, mod = 1) {
        // If a menu is blocking, handle based on autoDismissMenus setting.
        // PICK_ANY menus are never auto-dismissed (require real user choices).
        if (this.pendingInputType === "menu") {
            const mode = this.activeMenu?.selectionMode;
            const dismiss = this._options.autoDismissMenus;
            if (dismiss && mode !== 2 && mode !== "PICK_ANY") {
                this.dismissMenu();
                if (dismiss === "resend") {
                    this.once("inputRequired", () => this.sendPosition(x, y, mod));
                }
            } else {
                this._emitter.emit("inputBlocked", { reason: "menu", x, y });
            }
            return;
        }
        this._resolveInput(["poskey"], { x, y, mod });
    }

    // ── Inventory Actions ─────────────────────
    // High-level methods that send a verb key, wait for the game to
    // prompt for an item, then send the item letter automatically.

    /**
     * Send a command key and then automatically answer the item prompt.
     * Waits for a key/poskey prompt (the "What do you want to [verb]?"
     * item selection) and sends the item letter. Other prompt types
     * (yn questions, menus) that fire in between are forwarded to
     * external listeners.
     */
    _sendVerbThenItem(verbKey, itemLetter) {
        if (this._ctx.inputInterceptor) {
            throw new Error("another input sequence is already in progress");
        }
        const inputType = this.pendingInputType;
        if (inputType && inputType !== "key" && inputType !== "poskey") {
            throw new Error(
                `cannot start verb command: game is waiting for '${inputType}' input, not gameplay`
            );
        }
        // No item specified — just send the verb key and let the
        // consumer handle all subsequent prompts.
        if (!itemLetter) {
            this.sendKey(verbKey);
            return Promise.resolve();
        }
        this.sendKey(verbKey);
        return new Promise((resolve) => {
            let rejected = false;

            const done = () => {
                this._ctx.inputInterceptor = null;
                this._emitter.off("mapUpdate", mapHandler);
                this._emitter.off("message", messageHandler);
                resolve(undefined);
            };

            // If NetHack rejects the verb entirely (e.g. "Not wearing any
            // accessories or armor."), a message fires before the next input
            // prompt. Mark as rejected so we clean up instead of sending the
            // item letter to an unrelated prompt.
            const messageHandler = () => {
                rejected = true;
            };
            this._emitter.on("message", messageHandler);

            this._ctx.inputInterceptor = (prompt) => {
                if (prompt.type === "key" || prompt.type === "poskey") {
                    if (rejected) {
                        // Verb was rejected — back at normal gameplay.
                        // Clean up without sending the item letter.
                        done();
                        return false;
                    }
                    // Item selection prompt (nhgetch) — send the letter.
                    // sendKey executes the action synchronously via Asyncify,
                    // so done() (which refreshes inventory) must come after.
                    this.sendKey(itemLetter);
                    done();
                    return true;
                }
                if (prompt.type === "yn") {
                    // NetHack uses yn_function for item selection when few
                    // items match (e.g. "What do you want to eat? [gh or ?*]").
                    // Check both resp choices and the bracketed query text.
                    // [*] means "accepts any inventory letter".
                    const choices = prompt.choices || "";
                    const queryMatch = (prompt.query || "").match(/\[([^\]]+)\]/);
                    const allChoices = choices + (queryMatch ? queryMatch[1] : "");
                    if (allChoices.includes("*") || allChoices.includes(itemLetter)) {
                        this.answerYn(itemLetter);
                        done();
                        return true;
                    }
                }
                // Any other prompt — forward to the consumer.
                return false;
            };

            // If the game auto-completed (only one valid item),
            // mapUpdate fires with no item prompt. Clean up.
            const mapHandler = () => {
                this._emitter.off("mapUpdate", mapHandler);
                if (this._ctx.inputInterceptor) done();
            };
            this._emitter.on("mapUpdate", mapHandler);
        });
    }

    apply(itemLetter) { return this._sendVerbThenItem("a", itemLetter); }
    drink(itemLetter) { return this._sendVerbThenItem("q", itemLetter); }
    eat(itemLetter) { return this._sendVerbThenItem("e", itemLetter); }
    read(itemLetter) { return this._sendVerbThenItem("r", itemLetter); }
    wear(itemLetter) { return this._sendVerbThenItem("W", itemLetter); }
    wield(itemLetter) { return this._sendVerbThenItem("w", itemLetter); }
    takeOff(itemLetter) { return this._sendVerbThenItem("R", itemLetter); }
    putOn(itemLetter) { return this._sendVerbThenItem("P", itemLetter); }
    drop(itemLetter) { return this._sendVerbThenItem("d", itemLetter); }
    throw(itemLetter) { return this._sendVerbThenItem("t", itemLetter); }
    zap(itemLetter) { return this._sendVerbThenItem("z", itemLetter); }

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
                this._ctx.inputInterceptor = null;
                this.off("textWindow", textHandler);
                this.off("message", messageHandler);
                this.off("mapUpdate", mapHandler);
                this._ctx.state.phase = "playing";
                this._emitter.emit("phaseChange", "playing");
                this._maybeRefreshInventory();
                resolve();
            };

            // Install as inputInterceptor — returns true if handled,
            // false to forward to external listeners.
            this._ctx.inputInterceptor = (prompt) => {
                switch (prompt.type) {
                    case "charSelect":
                        this.resolveCharSelect(false);
                        return true;
                    case "line":
                        this.answerLine(name || "");
                        return true;
                    case "yn":
                        if (skipTutorial) {
                            this.answerYn(prompt.default || "y");
                            return true;
                        }
                        cleanup();
                        return false; // forward to consumer
                    case "menu": {
                        const items = prompt.menu?.items ?? [];
                        const how = prompt.menu?.selectionMode;
                        const isTutorial = (prompt.menu?.prompt ?? "")
                            .toLowerCase().includes("tutorial");

                        if (isTutorial && !skipTutorial) {
                            cleanup();
                            return false; // forward to consumer
                        } else if (how === 1 || how === "PICK_ONE") {
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
                        return true;
                    }
                    case "key":
                    case "poskey":
                        keyPromptCount++;
                        if (sawMap && keyPromptCount >= 2) {
                            cleanup();
                            return false; // forward to consumer
                        }
                        this.sendKey(32);
                        return true;
                    case "extcmd":
                        this.sendExtCmd(-1);
                        return true;
                    default:
                        this.sendKey(27);
                        return true;
                }
            };
        });
    }

    _buildMonsterRegistry() {
        const ng = this._ctx.ng;
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

    _refreshGivenNames() {
        const getGivenName = this._module?._get_monster_givenname;
        if (!getGivenName || !this._module?.UTF8ToString) return;
        for (const mon of this._ctx.state.visibleMonsters) {
            const ptr = getGivenName(mon.x, mon.y);
            if (ptr) {
                const gname = this._module.UTF8ToString(ptr);
                mon.givenName = gname || undefined;
            }
        }
    }

    _maybeRefreshInventory() {
        const prev = this._ctx.state.inventory;
        this.refreshInventory();
        const curr = this._ctx.state.inventory;
        // Change detection: length, letter/otyp/quantity, or worn state
        if (prev.length !== curr.length
            || prev.some((p, i) => p.letter !== curr[i].letter
                || p.otyp !== curr[i].otyp
                || p.quantity !== curr[i].quantity
                || p.wornMask !== curr[i].wornMask)) {
            this._emitter.emit("inventoryUpdate", curr);
        }
    }

    /**
     * Read inventory directly from WASM memory.
     * Walks the invent linked list and snapshots each item.
     */
    refreshInventory() {
        const ng = this._ctx.ng;
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

        // Use NetHack's doname() for canonical display text if available.
        // doname(obj*) returns a char* with the fully formatted item description
        // (e.g. "a +2 blessed rustproof long sword (weapon in hand)").
        const hasDoname = typeof this._module._doname === "function";

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

            // Get NetHack's canonical formatted description via doname()
            let displayText = null;
            if (hasDoname) {
                const strPtr = this._module._doname(cur);
                if (strPtr) displayText = UTF8ToString(strPtr);
            }

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
                displayText,
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

    /**
     * Look up an extended command index by name using the WASM helper.
     * Falls back to -1 (cancel) if the helper is unavailable.
     */
    _lookupExtCmdIndex(name) {
        const fn = this._module?._get_extcmd_index;
        if (!fn) return -1;
        // Allocate a C string on the WASM heap, call the lookup, then free
        const mod = this._module;
        const len = name.length + 1;
        const ptr = mod._malloc(len);
        mod.stringToUTF8(name, ptr, len);
        const idx = fn(ptr);
        mod._free(ptr);
        return idx;
    }
}
