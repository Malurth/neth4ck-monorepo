import {
    CONDITION_NAMES,
    MAP_HEIGHT,
    MAP_WIDTH,
    STATUS_FIELD_MAP,
    STRING_STATUS_FIELDS,
} from "./constants.js";

/**
 * Given a glyph and the GLYPH offset constants, determine if it represents
 * a monster and return the monster index + category. Returns null if not a monster.
 */
function classifyMonsterGlyph(glyph, glyphConstants) {
    if (!glyphConstants) {
        return null;
    }

    const {
        GLYPH_MON_OFF,
        GLYPH_PET_OFF,
        GLYPH_DETECT_OFF,
        GLYPH_RIDDEN_OFF,
        GLYPH_STATUE_OFF,
        NUMMONS,
        MAX_GLYPH,
    } = glyphConstants;

    if (NUMMONS === undefined) {
        return null;
    }

    if (glyph >= GLYPH_MON_OFF && glyph < GLYPH_MON_OFF + NUMMONS) {
        return { monsterIndex: glyph - GLYPH_MON_OFF, isPet: false, isRidden: false, isDetected: false, isStatue: false };
    }
    if (glyph >= GLYPH_PET_OFF && glyph < GLYPH_PET_OFF + NUMMONS) {
        return { monsterIndex: glyph - GLYPH_PET_OFF, isPet: true, isRidden: false, isDetected: false, isStatue: false };
    }
    if (glyph >= GLYPH_DETECT_OFF && glyph < GLYPH_DETECT_OFF + NUMMONS) {
        return { monsterIndex: glyph - GLYPH_DETECT_OFF, isPet: false, isRidden: false, isDetected: true, isStatue: false };
    }
    if (glyph >= GLYPH_RIDDEN_OFF && glyph < GLYPH_RIDDEN_OFF + NUMMONS) {
        return { monsterIndex: glyph - GLYPH_RIDDEN_OFF, isPet: false, isRidden: true, isDetected: false, isStatue: false };
    }
    if (glyph >= GLYPH_STATUE_OFF && glyph < MAX_GLYPH) {
        return { monsterIndex: glyph - GLYPH_STATUE_OFF, isPet: false, isRidden: false, isDetected: false, isStatue: true };
    }

    return null;
}

export function createCallbackRouter(ctx) {
    const { state, emitter, options } = ctx;
    const menuBuilders = new Map();
    const textBuffers = new Map();
    const changedFields = new Set();
    let mapDirty = false;
    let prevConditions = new Set();
    let turnCounter = 0;
    let pendingVisibleMonsters = [];

    function setTile(x, y, tile) {
        if (options.mapCoordinateOrder === "xy") {
            state.map[x][y] = tile;
        } else {
            state.map[y][x] = tile;
        }
    }

    function clearMap() {
        const emptyTile = () => ({
            glyph: 0,
            bkglyph: 0,
            tileIndex: 0,
            ch: 0,
            color: 0,
            special: 0,
            x: 0,
            y: 0,
        });

        if (options.mapCoordinateOrder === "xy") {
            state.map = Array.from({ length: MAP_WIDTH }, (_, x) =>
                Array.from({ length: MAP_HEIGHT }, (_, y) => emptyTile(x, y)),
            );
        } else {
            state.map = Array.from({ length: MAP_HEIGHT }, (_, y) =>
                Array.from({ length: MAP_WIDTH }, (_, x) => emptyTile(x, y)),
            );
        }
    }

    function parseConditionBitmask(value) {
        const newConditions = new Set();
        for (const [mask, name] of Object.entries(CONDITION_NAMES)) {
            if (value & Number(mask)) {
                newConditions.add(name);
            }
        }
        state.conditions = newConditions;
    }

    function emitConditionDiff() {
        const added = [];
        const removed = [];
        for (const c of state.conditions) {
            if (!prevConditions.has(c)) {
                added.push(c);
            }
        }
        for (const c of prevConditions) {
            if (!state.conditions.has(c)) {
                removed.push(c);
            }
        }
        if (added.length > 0 || removed.length > 0) {
            emitter.emit("conditionChange", state.conditions, added, removed);
        }
        prevConditions = new Set(state.conditions);
    }

    function updateStatusField(field, value) {
        const key = STATUS_FIELD_MAP[field];
        if (!key) {
            return;
        }
        if (STRING_STATUS_FIELDS.has(key)) {
            state.status[key] = String(value ?? "").trim();
        } else {
            state.status[key] = Number(value) || 0;
        }
        changedFields.add(key);
    }

    function setInput(prompt) {
        state.pendingInput = prompt;
        const p = new Promise((resolve) => {
            ctx.pendingResolve = resolve;
        });
        emitter.emit("inputRequired", prompt);
        return p;
    }

    // Initialize map
    clearMap();

    return async function routeCallback(name, ...args) {
        emitter.emit("rawCallback", name, args);

        switch (name) {
            // ── Map ──────────────────────────────
            case "shim_print_glyph": {
                const [, x, y, glyph, bkglyph] = args;
                let tileIndex = 0;
                let ch = 0;
                let color = 0;
                let special = 0;
                const helpers = globalThis.nethackGlobal?.helpers;
                // Use mapglyphHelper (3.6.7) for full tile info.
                // mapGlyphInfoHelper (3.7) calls _map_glyphinfo which can
                // trigger memory access issues during the print_glyph callback,
                // so we skip it and use tileIndexForGlyph as the safe fallback.
                if (helpers?.mapglyphHelper) {
                    const info = helpers.mapglyphHelper(glyph, x, y, 0);
                    tileIndex = info.tileIdx;
                    ch = info.ch;
                    color = info.color;
                    special = info.special;
                } else if (helpers?.tileIndexForGlyph) {
                    tileIndex = helpers.tileIndexForGlyph(glyph);
                }
                setTile(x, y, { glyph, bkglyph, tileIndex, ch, color, special, x, y });

                // Track visible monsters
                const glyphConstants = globalThis.nethackGlobal?.constants?.GLYPH;
                const monInfo = classifyMonsterGlyph(glyph, glyphConstants);
                if (monInfo && !monInfo.isStatue) {
                    const registry = state.monsters;
                    const monster = registry?.[monInfo.monsterIndex];
                    pendingVisibleMonsters.push({
                        x,
                        y,
                        monsterIndex: monInfo.monsterIndex,
                        name: monster?.name ?? `monster#${monInfo.monsterIndex}`,
                        isPet: monInfo.isPet,
                        isRidden: monInfo.isRidden,
                        isDetected: monInfo.isDetected,
                    });
                }

                mapDirty = true;
                return 0;
            }

            case "shim_display_nhwindow": {
                const [winName, blocking] = args;
                if (winName === "WIN_MAP" && mapDirty) {
                    mapDirty = false;
                    turnCounter++;
                    state.visibleMonsters = pendingVisibleMonsters;
                    pendingVisibleMonsters = [];
                    emitter.emit("mapUpdate", state.map);
                    if (state.visibleMonsters.length > 0) {
                        emitter.emit("monstersUpdate", state.visibleMonsters);
                    }
                }
                // Flush text buffers for non-standard windows
                for (const [winId, lines] of textBuffers) {
                    if (String(winId) === String(winName) || winId === winName) {
                        emitter.emit("textWindow", lines);
                        textBuffers.delete(winId);
                    }
                }
                if (blocking) {
                    return setInput({ type: "key" });
                }
                return 0;
            }

            case "shim_clear_nhwindow":
                if (args[0] === "WIN_MAP") {
                    clearMap();
                    pendingVisibleMonsters = [];
                }
                return 0;

            // ── Messages ─────────────────────────
            case "shim_putstr": {
                const [winName, attr, str] = args;
                if (winName === "WIN_MESSAGE") {
                    const msg = { text: str, attr, turn: turnCounter };
                    state.messages.push(msg);
                    emitter.emit("message", msg);
                } else if (textBuffers.has(winName)) {
                    textBuffers.get(winName).push(str);
                } else {
                    // Could be a text window we haven't started tracking,
                    // or a menu/status window — just buffer it
                    textBuffers.set(winName, [str]);
                }
                return 0;
            }

            case "shim_raw_print":
            case "shim_raw_print_bold": {
                const msg = { text: args[0], attr: name === "shim_raw_print_bold" ? 1 : 0, turn: turnCounter };
                state.messages.push(msg);
                emitter.emit("message", msg);
                return 0;
            }

            // ── Status ───────────────────────────
            case "shim_status_init":
                return 0;

            case "shim_status_enablefield":
                return 0;

            case "shim_status_update": {
                const [field, value] = args;
                if (field === "BL_FLUSH" || field === "BL_RESET") {
                    if (changedFields.size > 0) {
                        emitter.emit("statusChange", state.status, [...changedFields]);
                        changedFields.clear();
                    }
                    emitConditionDiff();
                } else if (field === "BL_CONDITION") {
                    parseConditionBitmask(value);
                } else if (field !== "BL_CHARACTERISTICS") {
                    updateStatusField(field, value);
                }
                return 0;
            }

            // ── Menu protocol ────────────────────
            case "shim_start_menu":
                menuBuilders.set(args[0], { items: [], prompt: "" });
                return 0;

            case "shim_add_menu": {
                const [winId, glyph, identifier, ch, gch, attr, str, preselected] = args;
                const builder = menuBuilders.get(winId);
                if (builder) {
                    builder.items.push({
                        glyph,
                        identifier,
                        accelerator: ch > 0 ? String.fromCharCode(ch) : "",
                        groupAccelerator: gch > 0 ? String.fromCharCode(gch) : "",
                        attr,
                        text: str,
                        preselected: !!preselected,
                    });
                }
                return 0;
            }

            case "shim_end_menu": {
                const builder = menuBuilders.get(args[0]);
                if (builder) {
                    builder.prompt = args[1] || "";
                }
                return 0;
            }

            case "shim_select_menu": {
                const [winId, how] = args;
                const builder = menuBuilders.get(winId);
                const menu = {
                    windowId: winId,
                    prompt: builder?.prompt ?? "",
                    selectionMode: how,
                    items: builder?.items ?? [],
                };
                state.activeMenu = menu;
                menuBuilders.delete(winId);
                emitter.emit("menuOpen", menu);
                return setInput({ type: "menu", menu });
            }

            // ── Input ────────────────────────────
            case "shim_nhgetch":
                return setInput({ type: "key" });

            case "shim_nh_poskey":
                return setInput({ type: "poskey" });

            case "shim_yn_function": {
                const [query, resp, def] = args;
                return setInput({
                    type: "yn",
                    query,
                    choices: resp || "",
                    default: def > 0 ? String.fromCharCode(def) : "",
                });
            }

            case "shim_getlin":
                return setInput({ type: "line", query: args[0] });

            case "shim_get_ext_cmd":
                return setInput({ type: "extcmd" });

            case "shim_message_menu":
                return 0;

            case "shim_doprev_message":
                return 0;

            // ── Character selection ──────────────
            case "shim_player_selection":
            case "shim_player_selection_cb": {
                state.phase = "charSelect";
                emitter.emit("phaseChange", "charSelect");
                return setInput({ type: "charSelect" });
            }

            case "shim_askname":
                return setInput({ type: "line", query: "Who are you? " });

            // ── Window management ────────────────
            case "shim_create_nhwindow": {
                const winId = ctx.nextWindowId++;
                return winId;
            }

            case "shim_destroy_nhwindow":
                menuBuilders.delete(args[0]);
                textBuffers.delete(args[0]);
                return 0;

            case "shim_init_nhwindows":
                state.phase = "init";
                emitter.emit("phaseChange", "init");
                return 0;

            // ── Inventory (stub) ─────────────────
            case "shim_update_inventory":
                state.inventoryNeedsUpdate = true;
                emitter.emit("inventoryNeedsUpdate");
                return 0;

            // ── Game over ────────────────────────
            case "shim_outrip": {
                state.phase = "gameOver";
                emitter.emit("phaseChange", "gameOver");
                emitter.emit("gameOver", { how: args[1], when: args[2] });
                return 0;
            }

            // ── Display ─────────────────────────
            case "shim_display_file":
                return 0;

            case "shim_curs": {
                const [winName, x, y] = args;
                if (winName === "WIN_MAP") {
                    state.cursor = { x, y };
                }
                return 0;
            }

            case "shim_cliparound":
                return 0;

            case "shim_nhbell":
                return 0;

            case "shim_delay_output":
                return 0;

            case "shim_preference_update":
                return 0;

            case "shim_getmsghistory":
                return "";

            case "shim_putmsghistory":
                return 0;

            case "shim_mark_synch":
            case "shim_wait_synch":
            case "shim_suspend_nhwindows":
            case "shim_resume_nhwindows":
            case "shim_get_nh_event":
            case "shim_exit_nhwindows":
            case "shim_start_screen":
            case "shim_end_screen":
            case "shim_number_pad":
            case "shim_change_color":
            case "shim_change_background":
            case "shim_update_positionbar":
            case "shim_get_color_string":
            case "set_shim_font_name":
            case "shim_ctrl_nhwindow":
                return 0;

            default:
                return 0;
        }
    };
}
