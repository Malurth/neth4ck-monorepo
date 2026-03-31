import {
    CONDITION_NAMES,
    FEATURE_NAMES,
    ITEM_CATEGORY_BY_CHAR,
    MAP_HEIGHT,
    MAP_WIDTH,
    STATUS_FIELD_MAP,
    STRING_STATUS_FIELDS,
    TERRAIN_TYPE_CHARS,
    TERRAIN_TYPE_NAMES,
} from "./constants.js";

/**
 * Classify a glyph into a tile type string. Uses the GLYPH_*_OFF constants
 * to determine which category the glyph belongs to. Works for any offset
 * ordering (3.6.7 and 3.7 differ).
 */
let _sortedGlyphRanges = null;
function classifyGlyph(glyph, gc) {
    if (!gc || glyph === gc.NO_GLYPH) return "nothing";
    // Build sorted ranges on first call (they don't change per game)
    if (!_sortedGlyphRanges) {
        const ranges = [
            [gc.GLYPH_MON_OFF, "monster"],
            [gc.GLYPH_PET_OFF, "pet"],
            [gc.GLYPH_INVIS_OFF, "invisible"],
            [gc.GLYPH_DETECT_OFF, "detected"],
            [gc.GLYPH_BODY_OFF, "corpse"],
            [gc.GLYPH_RIDDEN_OFF, "ridden"],
            [gc.GLYPH_OBJ_OFF, "object"],
            [gc.GLYPH_CMAP_OFF, "feature"],
            [gc.GLYPH_EXPLODE_OFF, "effect"],
            [gc.GLYPH_ZAP_OFF, "effect"],
            [gc.GLYPH_SWALLOW_OFF, "effect"],
            [gc.GLYPH_WARNING_OFF, "warning"],
            [gc.GLYPH_STATUE_OFF, "statue"],
        ];
        if (gc.GLYPH_UNEXPLORED_OFF !== undefined) {
            ranges.push([gc.GLYPH_UNEXPLORED_OFF, "unexplored"]);
        }
        if (gc.GLYPH_NOTHING_OFF !== undefined) {
            ranges.push([gc.GLYPH_NOTHING_OFF, "nothing"]);
        }
        // Sort descending — first match (glyph >= offset) wins
        _sortedGlyphRanges = ranges.sort((a, b) => b[0] - a[0]);
    }
    for (const [offset, type] of _sortedGlyphRanges) {
        if (glyph >= offset) return type;
    }
    return null;
}

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

    // In 3.7, each monster category spans 2*NUMMONS (male + female).
    // Use the gap between offsets to determine the actual range size.
    // In 3.6.7 the gap equals NUMMONS; in 3.7 it's 2*NUMMONS.
    const monSpan = GLYPH_PET_OFF - GLYPH_MON_OFF;

    function monIndex(g, off) {
        return (g - off) % NUMMONS;
    }

    if (glyph >= GLYPH_MON_OFF && glyph < GLYPH_MON_OFF + monSpan) {
        return { monsterIndex: monIndex(glyph, GLYPH_MON_OFF), isPet: false, isRidden: false, isDetected: false, isStatue: false };
    }
    if (glyph >= GLYPH_PET_OFF && glyph < GLYPH_PET_OFF + monSpan) {
        return { monsterIndex: monIndex(glyph, GLYPH_PET_OFF), isPet: true, isRidden: false, isDetected: false, isStatue: false };
    }
    if (glyph >= GLYPH_DETECT_OFF && glyph < GLYPH_DETECT_OFF + monSpan) {
        return { monsterIndex: monIndex(glyph, GLYPH_DETECT_OFF), isPet: false, isRidden: false, isDetected: true, isStatue: false };
    }
    if (glyph >= GLYPH_RIDDEN_OFF && glyph < GLYPH_RIDDEN_OFF + monSpan) {
        return { monsterIndex: monIndex(glyph, GLYPH_RIDDEN_OFF), isPet: false, isRidden: true, isDetected: false, isStatue: false };
    }
    if (glyph >= GLYPH_STATUE_OFF && glyph < MAX_GLYPH) {
        return { monsterIndex: monIndex(glyph, GLYPH_STATUE_OFF), isPet: false, isRidden: false, isDetected: false, isStatue: true };
    }

    return null;
}

export function createCallbackRouter(ctx) {
    const { state, emitter, options } = ctx;
    const menuBuilders = new Map();
    const textBuffers = new Map();
    const changedFields = new Set();
    let mapDirty = false;

    // Reset cached glyph ranges — they differ between 3.7 and 3.6.7
    _sortedGlyphRanges = null;
    let prevConditions = new Set();
    let turnCounter = 0;
    // Persistent map of visible monsters by position. Updated incrementally
    // on each print_glyph — entries are added/updated for monster glyphs,
    // removed when a position is overwritten with a non-monster glyph.
    // This avoids losing monsters that didn't move (NetHack only redraws
    // tiles that changed).
    const monstersByPosition = new Map();
    const itemsByPosition = new Map();
    const featuresByPosition = new Map();

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

        // Derive dlvl from levelDesc (e.g. "Dlvl:3" → 3)
        if (key === "levelDesc") {
            const match = state.status.levelDesc.match(/(\d+)/);
            state.status.dlvl = match ? parseInt(match[1], 10) : 0;
            changedFields.add("dlvl");
        }
    }

    function setInput(prompt) {
        state.pendingInput = prompt;
        const p = new Promise((resolve) => {
            ctx.pendingResolve = resolve;
        });
        if (ctx.inputInterceptor) {
            // An interceptor has exclusive first-look at prompts.
            // Deferred via setTimeout so Asyncify unwinds before
            // the promise is resolved (avoids doRewind reentrancy).
            setTimeout(() => {
                const handled = ctx.inputInterceptor?.(prompt);
                if (!handled) {
                    emitter.emit("inputRequired", prompt);
                }
            }, 0);
        } else {
            emitter.emit("inputRequired", prompt);
        }
        return p;
    }

    // Initialize map
    clearMap();

    return function routeCallback(name, ...args) {
        emitter.emit("rawCallback", name, args);

        switch (name) {
            // ── Map ──────────────────────────────
            case "shim_print_glyph": {
                const [, x, y, glyphArg] = args;
                let glyph = glyphArg;
                let tileIndex = 0;
                let ch = 0;
                let color = 0;
                let special = 0;
                const helpers = ctx.ng?.helpers;

                if (helpers?.mapglyphHelper) {
                    // 3.6.7: glyphArg is a raw glyph int, use mapglyphHelper
                    const info = helpers.mapglyphHelper(glyph, x, y, 0);
                    tileIndex = info.tileIdx;
                    ch = info.ch;
                    color = info.color;
                    special = info.special;
                } else if (glyphArg > 65535) {
                    // 3.7: glyphArg is a pointer to a glyph_info struct
                    const mod = ctx.module;
                    if (mod?.getValue) {
                        glyph = mod.getValue(glyphArg, "i32");
                        ch = mod.getValue(glyphArg + 4, "i32") & 0xFF;
                        color = mod.getValue(glyphArg + 16, "i32");
                        special = mod.getValue(glyphArg + 12, "i32");
                        tileIndex = mod.getValue(glyphArg + 30, "i16");
                    }
                }

                // Classify the foreground glyph
                const glyphConstants = ctx.ng?.constants?.GLYPH;
                const tileType = classifyGlyph(glyph, glyphConstants);
                let tileLabel = null;
                if ((tileType === "statue" || tileType === "corpse") && glyphConstants) {
                    const offKey = tileType === "statue" ? "GLYPH_STATUE_OFF" : "GLYPH_BODY_OFF";
                    const monIdx = (glyph - glyphConstants[offKey]) % glyphConstants.NUMMONS;
                    const monster = state.monsters?.[monIdx];
                    if (monster) {
                        tileLabel = tileType === "statue"
                            ? `statue of ${monster.name}`
                            : `${monster.name} corpse`;
                    }
                }

                setTile(x, y, { glyph, tileIndex, ch, color, special, x, y, tileType, tileLabel });

                // Track visible monsters — update persistent map by position.
                // When a tile is redrawn with a monster glyph, add/update.
                // When redrawn with a non-monster glyph, remove.
                const posKey = `${x},${y}`;
                const monInfo = classifyMonsterGlyph(glyph, glyphConstants);
                if (monInfo && !monInfo.isStatue) {
                    const registry = state.monsters;
                    const monster = registry?.[monInfo.monsterIndex];
                    monstersByPosition.set(posKey, {
                        x,
                        y,
                        monsterIndex: monInfo.monsterIndex,
                        name: monster?.name ?? `monster#${monInfo.monsterIndex}`,
                        isPet: monInfo.isPet,
                        isRidden: monInfo.isRidden,
                        isDetected: monInfo.isDetected,
                    });
                } else {
                    monstersByPosition.delete(posKey);
                }

                // Track visible items (objects, statues, corpses).
                // Persistent: items stay until position is explicitly cleared.
                const isItem = (t) => t === "object" || t === "statue" || t === "corpse";
                if (isItem(tileType)) {
                    const charStr = ch ? String.fromCharCode(ch) : "";
                    itemsByPosition.set(posKey, {
                        x, y, ch: charStr, color, glyph, tileType, tileLabel,
                        category: ITEM_CATEGORY_BY_CHAR[charStr] || "item",
                        obscured: false,
                    });
                } else if (tileType === "feature" || tileType === "nothing"
                        || tileType === "unexplored" || tileType === null) {
                    // Position is now plain terrain/empty — item is gone
                    itemsByPosition.delete(posKey);
                } else if (itemsByPosition.has(posKey)) {
                    // Something else drawn on top (monster, player) — mark obscured
                    itemsByPosition.get(posKey).obscured = true;
                }

                // Track visible features (stairs, fountains, altars, etc.).
                // Persistent: features stay until position shows plain terrain.
                if (tileType === "feature") {
                    const charStr = ch ? String.fromCharCode(ch) : "";
                    const featureName = FEATURE_NAMES[charStr];
                    if (featureName) {
                        featuresByPosition.set(posKey, {
                            x, y, ch: charStr, color, glyph,
                            name: featureName,
                            obscured: false,
                        });
                    } else {
                        // Non-notable feature (floor, wall) — clears any prior entry
                        featuresByPosition.delete(posKey);
                    }
                } else if (tileType === "nothing" || tileType === "unexplored"
                        || tileType === null) {
                    featuresByPosition.delete(posKey);
                } else if (featuresByPosition.has(posKey)) {
                    // Something else drawn on top (monster, player, item) — mark obscured
                    featuresByPosition.get(posKey).obscured = true;
                }

                mapDirty = true;
                return 0;
            }

            case "shim_display_nhwindow": {
                const [winName, blocking] = args;
                if (winName === "WIN_MAP" && mapDirty) {
                    mapDirty = false;
                    turnCounter++;

                    // Terrain scan: check for features hidden beneath other glyphs.
                    // Uses get_levl_typ(x,y) to read dungeon structure directly,
                    // supplementing glyph-based persistence (which can miss features
                    // that were never drawn as foreground, e.g. staircase at spawn).
                    const getLevlTyp = ctx.module?._get_levl_typ;
                    const getStairDir = ctx.module?._get_stair_direction;
                    const getFeatureColor = ctx.module?._get_feature_color;
                    const levlTyp = ctx.ng?.constants?.LEVL_TYP;
                    if (getLevlTyp && levlTyp) {
                        for (const [posKey, monster] of monstersByPosition) {
                            if (featuresByPosition.has(posKey)) continue;
                            const typ = getLevlTyp(monster.x, monster.y);
                            const typName = levlTyp[typ];
                            let featureName = TERRAIN_TYPE_NAMES[typName];
                            let ch = TERRAIN_TYPE_CHARS[typName] || "?";

                            // For stairs/ladders, resolve direction
                            if (featureName && getStairDir
                                    && (typName === "STAIRS" || typName === "LADDER")) {
                                const dir = getStairDir(monster.x, monster.y);
                                // 1=stairs up, 2=stairs down, 3=ladder up, 4=ladder down
                                if (dir === 1 || dir === 3) {
                                    featureName += " up";
                                    ch = "<";
                                } else if (dir === 2 || dir === 4) {
                                    featureName += " down";
                                    ch = ">";
                                }
                            }

                            if (featureName) {
                                // Get the exact display color via back_to_glyph + mapglyph
                                const color = getFeatureColor
                                    ? getFeatureColor(monster.x, monster.y)
                                    : 0;
                                featuresByPosition.set(posKey, {
                                    x: monster.x,
                                    y: monster.y,
                                    ch,
                                    color: color >= 0 ? color : 0,
                                    glyph: 0,
                                    name: featureName,
                                    obscured: true,
                                });
                            }
                        }
                    }

                    state.visibleMonsters = Array.from(monstersByPosition.values());
                    state.visibleItems = Array.from(itemsByPosition.values());
                    state.visibleFeatures = Array.from(featuresByPosition.values());
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
                    monstersByPosition.clear();
                    itemsByPosition.clear();
                    featuresByPosition.clear();
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
                // 3.7 format: "vipi00iisi" → winId, glyphinfo, identifier, ch, gch, attr, clr, str, itemflags
                // 3.6.7 format: "viniicis" → winId, glyph, identifier, accelerator, groupacc, attr, str
                // Detect by checking if we have 9 args (3.7) or fewer (3.6.7)
                const [winId] = args;
                let glyph, identifier, ch, gch, attr, str, preselected;
                if (args.length >= 9) {
                    // 3.7: extra clr field between attr and str
                    [, glyph, identifier, ch, gch, attr, , str, preselected] = args;
                } else {
                    // 3.6.7
                    [, glyph, identifier, ch, gch, attr, str, preselected] = args;
                }
                const builder = menuBuilders.get(winId);
                if (builder) {
                    // 3.6.7 passes identifier as a pointer (format "p") — read
                    // the value now while the stack is valid. All items in a loop
                    // share the same &any address, so the pointer goes stale.
                    // 3.7 passes identifier as an integer (format "i") — already
                    // the value.
                    let idValue = identifier;
                    if (args.length < 9 && identifier) {
                        const mod = ctx.module;
                        if (mod?.getValue) {
                            idValue = mod.getValue(identifier, "i32");
                        }
                    }
                    builder.items.push({
                        glyph,
                        identifier: idValue,
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
                menuBuilders.delete(winId);

                // Auto-resolve display-only menus if configured.
                // Emit items as a textWindow so consumers see the content
                // without blocking gameplay.
                if ((how === 0 || how === "PICK_NONE") && options?.autoResolvePickNone) {
                    const lines = menu.items.map(i => i.text).filter(Boolean);
                    if (lines.length > 0) emitter.emit("textWindow", lines);
                    return 0;
                }

                state.activeMenu = menu;
                emitter.emit("menuOpen", menu);
                // WASM expects an integer return (count of selected items,
                // or -1 for cancel). For selections (count > 0), we must
                // also write a MENU_ITEM_P array to WASM heap memory and
                // store its pointer in the global select_menu_pick_list.
                // The C shim copies it to *menu_list after Asyncify resumes
                // (same pattern as poskey click coordinates).
                return setInput({ type: "menu", menu }).then(value => {
                    state.activeMenu = null;
                    if (value === null || value === undefined) return -1;
                    if (Array.isArray(value) && value.length > 0) {
                        const mod = ctx.module;
                        if (mod?._malloc && mod?.setValue && mod?._get_select_menu_pick_list_ptr) {
                            // Map selected identifiers to menu items.
                            // selectMenuItem passes accelerator chars; match on those.
                            const selected = [];
                            for (const sel of value) {
                                const found = menu.items.find(
                                    i => i.accelerator === sel || i.identifier === sel
                                );
                                if (found) selected.push(found);
                            }
                            if (selected.length > 0) {
                                // Allocate MENU_ITEM_P array on WASM heap.
                                // struct mi { anything item (8 bytes); long count (4); unsigned itemflags (4); } = 16 bytes
                                const SIZEOF_MI = 16;
                                const ptr = mod._malloc(SIZEOF_MI * selected.length);
                                for (let i = 0; i < selected.length; i++) {
                                    const offset = ptr + i * SIZEOF_MI;
                                    // identifier was already read as a value during
                                    // add_menu (not a pointer) — use it directly
                                    mod.setValue(offset, selected[i].identifier, "i32"); // item.a_int
                                    mod.setValue(offset + 4, 0, "i32");     // padding (rest of anything union)
                                    mod.setValue(offset + 8, -1, "i32");    // count = -1 (all)
                                    mod.setValue(offset + 12, 0, "i32");    // itemflags = 0
                                }
                                // Store pointer in global for C shim to copy
                                const globalPtr = mod._get_select_menu_pick_list_ptr();
                                mod.setValue(globalPtr, ptr, "*");
                                return selected.length;
                            }
                        }
                        return value.length;
                    }
                    return 0;
                });
            }

            // ── Input ────────────────────────────
            case "shim_nhgetch":
                return setInput({ type: "key" });

            case "shim_nh_poskey": {
                // poskey receives output pointers: [x_ptr, y_ptr, mod_ptr]
                // When resolved with a number → key press (return the key code).
                // When resolved with { x, y, mod } → position click
                //   (write to global click buffer and return 0).
                //
                // NOTE: We write to global memory (poskey_click_*) rather than
                // the stack-allocated out-pointers because Asyncify restores the
                // C stack on resume, overwriting any values written to stack
                // addresses during suspension. The C side copies from the globals
                // to the out-pointers after nh_poskey returns.
                return setInput({ type: "poskey" }).then((value) => {
                    if (typeof value === "object" && value !== null) {
                        const mod = ctx.module;
                        if (mod?.setValue) {
                            const xGlobal = mod._get_poskey_click_x_ptr();
                            const yGlobal = mod._get_poskey_click_y_ptr();
                            const modGlobal = mod._get_poskey_click_mod_ptr();
                            mod.setValue(xGlobal, value.x ?? 0, "i32");
                            mod.setValue(yGlobal, value.y ?? 0, "i32");
                            mod.setValue(modGlobal, value.mod ?? 0, "i32");
                        }
                        return 0; // no key — position was sent
                    }
                    return value; // key code
                });
            }

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

            case "shim_askname": {
                // shim_askname receives a buffer pointer — the name must be
                // written into WASM memory (not returned as a value).
                const nameBuf = args[0];
                return setInput({ type: "line", query: "Who are you? " })
                    .then((name) => {
                        if (nameBuf && ctx.module?.stringToUTF8) {
                            ctx.module.stringToUTF8(
                                String(name ?? ""),
                                nameBuf,
                                128, // PL_NSIZ is 32, but 128 is safe
                            );
                        }
                        return 0;
                    });
            }

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

            case "shim_exit_nhwindows":
                // Game is shutting down (quit, save, or after death sequence).
                // Ensure gameOver phase is set even for non-death exits.
                // Only trigger if we're past the startup phase — exit_nhwindows
                // is also called during initial window system setup.
                if (state.phase === "playing") {
                    state.phase = "gameOver";
                    emitter.emit("phaseChange", "gameOver");
                }
                return 0;
            case "shim_mark_synch":
            case "shim_wait_synch":
            case "shim_suspend_nhwindows":
            case "shim_resume_nhwindows":
            case "shim_get_nh_event":
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
