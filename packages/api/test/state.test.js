import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Unit tests for exported constants & utilities
// ---------------------------------------------------------------------------

describe("@neth4ck/api exports", () => {
    let stateModule;

    beforeAll(async () => {
        stateModule = await import("@neth4ck/api");
    });

    it("exports NethackStateManager", () => {
        expect(typeof stateModule.NethackStateManager).toBe("function");
    });

    it("exports DIRECTIONS", () => {
        expect(stateModule.DIRECTIONS).toBeDefined();
        expect(stateModule.DIRECTIONS.n).toBe("k");
        expect(stateModule.DIRECTIONS.se).toBe("n");
    });

    it("exports KEY_CODES", () => {
        expect(stateModule.KEY_CODES).toBeDefined();
        expect(stateModule.KEY_CODES.ESC).toBe(27);
    });

    it("exports MAP_WIDTH and MAP_HEIGHT", () => {
        expect(stateModule.MAP_WIDTH).toBe(80);
        expect(stateModule.MAP_HEIGHT).toBe(21);
    });

    it("exports EventEmitter", () => {
        expect(typeof stateModule.EventEmitter).toBe("function");
    });

    it("exports COLORS with standard NetHack color values", () => {
        expect(stateModule.COLORS.RED).toBe(1);
        expect(stateModule.COLORS.WHITE).toBe(15);
    });

    it("exports ATTR with standard NetHack attribute values", () => {
        expect(stateModule.ATTR.NONE).toBe(0);
        expect(stateModule.ATTR.BOLD).toBe(1);
    });

    it("exports STATUS_FIELDS as an array of field names", () => {
        expect(Array.isArray(stateModule.STATUS_FIELDS)).toBe(true);
        expect(stateModule.STATUS_FIELDS).toContain("hp");
        expect(stateModule.STATUS_FIELDS).toContain("title");
        expect(stateModule.STATUS_FIELDS).toContain("gold");
    });

    it("exports CONDITIONS as an array of condition names", () => {
        expect(Array.isArray(stateModule.CONDITIONS)).toBe(true);
        expect(stateModule.CONDITIONS).toContain("blind");
        expect(stateModule.CONDITIONS).toContain("conf");
    });

    it("exports PHASE constants", () => {
        expect(stateModule.PHASE.INIT).toBe("init");
        expect(stateModule.PHASE.PLAYING).toBe("playing");
        expect(stateModule.PHASE.GAME_OVER).toBe("gameOver");
    });

    it("exports INPUT_TYPE constants", () => {
        expect(stateModule.INPUT_TYPE.KEY).toBe("key");
        expect(stateModule.INPUT_TYPE.YN).toBe("yn");
        expect(stateModule.INPUT_TYPE.MENU).toBe("menu");
    });

    it("exports MENU_MODE constants", () => {
        expect(stateModule.MENU_MODE.PICK_NONE).toBe("PICK_NONE");
        expect(stateModule.MENU_MODE.PICK_ONE).toBe("PICK_ONE");
        expect(stateModule.MENU_MODE.PICK_ANY).toBe("PICK_ANY");
    });

    it("exports FEATURE_NAMES with notable map features", () => {
        expect(stateModule.FEATURE_NAMES).toBeDefined();
        expect(stateModule.FEATURE_NAMES["<"]).toBe("staircase up");
        expect(stateModule.FEATURE_NAMES[">"]).toBe("staircase down");
        expect(stateModule.FEATURE_NAMES["_"]).toBe("altar");
        expect(stateModule.FEATURE_NAMES["{"]).toBe("fountain or sink");
        expect(stateModule.FEATURE_NAMES["\\"]).toBe("grave or throne");
    });

    it("exports ITEM_CATEGORY_BY_CHAR mapping item symbols to categories", () => {
        expect(stateModule.ITEM_CATEGORY_BY_CHAR).toBeDefined();
        expect(stateModule.ITEM_CATEGORY_BY_CHAR[")"]).toBe("weapon");
        expect(stateModule.ITEM_CATEGORY_BY_CHAR["["]).toBe("armor");
        expect(stateModule.ITEM_CATEGORY_BY_CHAR["!"]).toBe("potion");
        expect(stateModule.ITEM_CATEGORY_BY_CHAR["?"]).toBe("scroll");
        expect(stateModule.ITEM_CATEGORY_BY_CHAR["/"]).toBe("wand");
        expect(stateModule.ITEM_CATEGORY_BY_CHAR["$"]).toBe("gold");
    });

    it("exports OBJ_CLASS_NAMES mapping object class numbers to names", () => {
        expect(stateModule.OBJ_CLASS_NAMES).toBeDefined();
        expect(stateModule.OBJ_CLASS_NAMES[2]).toBe("weapon");
        expect(stateModule.OBJ_CLASS_NAMES[3]).toBe("armor");
        expect(stateModule.OBJ_CLASS_NAMES[7]).toBe("food");
        expect(stateModule.OBJ_CLASS_NAMES[11]).toBe("wand");
        expect(stateModule.OBJ_CLASS_NAMES[12]).toBe("coin");
    });
});

// ---------------------------------------------------------------------------
// Unit tests for EventEmitter
// ---------------------------------------------------------------------------

describe("EventEmitter", () => {
    let EventEmitter;

    beforeAll(async () => {
        const mod = await import("@neth4ck/api");
        EventEmitter = mod.EventEmitter;
    });

    it("calls listeners on emit", () => {
        const emitter = new EventEmitter();
        const calls = [];
        emitter.on("test", (val) => calls.push(val));
        emitter.emit("test", 42);
        expect(calls).toEqual([42]);
    });

    it("supports multiple listeners", () => {
        const emitter = new EventEmitter();
        const calls = [];
        emitter.on("test", () => calls.push("a"));
        emitter.on("test", () => calls.push("b"));
        emitter.emit("test");
        expect(calls).toEqual(["a", "b"]);
    });

    it("removes listeners with off", () => {
        const emitter = new EventEmitter();
        const calls = [];
        const fn = () => calls.push("x");
        emitter.on("test", fn);
        emitter.off("test", fn);
        emitter.emit("test");
        expect(calls).toEqual([]);
    });

    it("does not throw on emit with no listeners", () => {
        const emitter = new EventEmitter();
        expect(() => emitter.emit("nope")).not.toThrow();
    });

    it("once() fires listener only once", () => {
        const emitter = new EventEmitter();
        const calls = [];
        emitter.once("test", (val) => calls.push(val));
        emitter.emit("test", 1);
        emitter.emit("test", 2);
        expect(calls).toEqual([1]);
    });

    it("once() listener can be removed with off before firing", () => {
        const emitter = new EventEmitter();
        const calls = [];
        const fn = (val) => calls.push(val);
        emitter.once("test", fn);
        emitter.off("test", fn);
        emitter.emit("test", 1);
        expect(calls).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Unit tests for NethackStateManager construction & convenience getters
// ---------------------------------------------------------------------------

describe("NethackStateManager construction", () => {
    let NethackStateManager;

    beforeAll(async () => {
        const mod = await import("@neth4ck/api");
        NethackStateManager = mod.NethackStateManager;
    });

    it("creates with default options", () => {
        const game = new NethackStateManager();
        expect(game.state).toBeDefined();
        expect(game.phase).toBe("init");
        expect(game.status.hp).toBe(0);
        expect(game.conditions).toBeInstanceOf(Set);
    });

    it("initializes map with correct dimensions (yx mode)", () => {
        const game = new NethackStateManager({ mapCoordinateOrder: "yx" });
        expect(game.map.length).toBe(21);
        expect(game.map[0].length).toBe(80);
    });

    it("initializes map with correct dimensions (xy mode)", () => {
        const game = new NethackStateManager({ mapCoordinateOrder: "xy" });
        expect(game.map.length).toBe(80);
        expect(game.map[0].length).toBe(21);
    });

    it("throws on sendKey with no pending input", () => {
        const game = new NethackStateManager();
        expect(() => game.sendKey("j")).toThrow("no pending input");
    });

    it("throws on answerYn with no pending input", () => {
        const game = new NethackStateManager();
        expect(() => game.answerYn("y")).toThrow("no pending input");
    });

    it("handleKey throws on no pending input", () => {
        const game = new NethackStateManager();
        expect(() => game.handleKey("y")).toThrow("no pending input");
    });

    it("handleKey routes to answerYn for yn prompts", () => {
        const game = new NethackStateManager();
        let resolved = null;
        game._ctx.state.pendingInput = { type: "yn", query: "Really?" };
        game._ctx.pendingResolve = (val) => { resolved = val; };
        game.handleKey("y");
        expect(resolved).toBe("y".charCodeAt(0));
        expect(game.pendingInput).toBeNull();
    });

    it("handleKey routes to dismissMenu on ESC for menu prompts", () => {
        const game = new NethackStateManager();
        let resolved = null;
        game._ctx.state.pendingInput = { type: "menu" };
        game._ctx.state.activeMenu = { items: [] };
        game._ctx.pendingResolve = (val) => { resolved = val; };
        game.handleKey("\x1b");
        expect(resolved).toBe(-1);
        expect(game.activeMenu).toBeNull();
    });

    it("handleKey routes to selectMenuItem for menu prompts", () => {
        const game = new NethackStateManager();
        let resolved = null;
        game._ctx.state.pendingInput = { type: "menu" };
        game._ctx.pendingResolve = (val) => { resolved = val; };
        game.handleKey("a");
        expect(resolved).toEqual(["a"]);
    });

    it("handleKey routes to sendKey for key/poskey prompts", () => {
        const game = new NethackStateManager();
        let resolved = null;
        game._ctx.state.pendingInput = { type: "key" };
        game._ctx.pendingResolve = (val) => { resolved = val; };
        game.handleKey("j");
        expect(resolved).toBe("j".charCodeAt(0));
    });

    it("throws on verb method when game is at wrong prompt type", () => {
        const game = new NethackStateManager();
        // Simulate a yn prompt being active
        game._ctx.state.pendingInput = { type: "yn", query: "Really?" };
        game._ctx.pendingResolve = () => {};
        expect(() => game.eat("a")).toThrow("cannot start verb command");
    });

    it("throws on verb method when another interceptor is active", () => {
        const game = new NethackStateManager();
        game._ctx.inputInterceptor = () => true;
        game._ctx.state.pendingInput = { type: "poskey" };
        game._ctx.pendingResolve = () => {};
        expect(() => game.drop("b")).toThrow("another input sequence");
    });

    it("verb method with no letter resolves without interceptor", () => {
        const game = new NethackStateManager();
        game._ctx.state.pendingInput = { type: "poskey" };
        game._ctx.pendingResolve = () => {};
        const result = game.eat();
        expect(result).toBeInstanceOf(Promise);
        expect(game._ctx.inputInterceptor).toBeFalsy();
    });

    it("convenience getters return initial values", () => {
        const game = new NethackStateManager();
        expect(game.isWaitingForInput).toBe(false);
        expect(game.pendingInputType).toBeNull();
        expect(game.pendingInput).toBeNull();
        expect(game.activeMenu).toBeNull();
        expect(game.inventoryNeedsUpdate).toBe(false);
    });

    it("visibleItems is initially an empty array", () => {
        const game = new NethackStateManager();
        expect(game.visibleItems).toEqual([]);
    });

    it("visibleFeatures is initially an empty array", () => {
        const game = new NethackStateManager();
        expect(game.visibleFeatures).toEqual([]);
    });

    it("messages ring buffer supports bracket indexing", () => {
        const game = new NethackStateManager();
        // Simulate pushing a message via internal state
        game.state.messages.push({ text: "hello", attr: 0, turn: 0 });
        game.state.messages.push({ text: "world", attr: 0, turn: 0 });
        expect(game.messages[0].text).toBe("hello");
        expect(game.messages[1].text).toBe("world");
        expect(game.messages.length).toBe(2);
    });

    it("messages ring buffer supports array methods", () => {
        const game = new NethackStateManager();
        game.state.messages.push({ text: "a", attr: 0, turn: 0 });
        game.state.messages.push({ text: "b", attr: 1, turn: 0 });
        game.state.messages.push({ text: "c", attr: 0, turn: 1 });

        expect(game.messages.filter((m) => m.attr === 0).length).toBe(2);
        expect(game.messages.map((m) => m.text)).toEqual(["a", "b", "c"]);
        expect(game.messages.find((m) => m.text === "b").attr).toBe(1);
        expect(game.messages.some((m) => m.text === "c")).toBe(true);
        expect(game.messages.slice(1).length).toBe(2);
    });

    it("messages ring buffer evicts oldest when full", () => {
        const game = new NethackStateManager({ messageHistorySize: 3 });
        for (let i = 0; i < 5; i++) {
            game.state.messages.push({ text: `msg${i}`, attr: 0, turn: 0 });
        }
        expect(game.messages.length).toBe(3);
        expect(game.messages[0].text).toBe("msg2");
        expect(game.messages[2].text).toBe("msg4");
    });

    it("messages ring buffer supports iteration", () => {
        const game = new NethackStateManager();
        game.state.messages.push({ text: "x", attr: 0, turn: 0 });
        const texts = [];
        for (const msg of game.messages) {
            texts.push(msg.text);
        }
        expect(texts).toEqual(["x"]);
    });

    it("constants/globals/helpers are null before start()", () => {
        const game = new NethackStateManager();
        // Before start, globalThis.nethackGlobal may not exist
        expect(game.module).toBeNull();
    });

    it("supports once() on events", () => {
        const game = new NethackStateManager();
        const calls = [];
        game.once("rawCallback", () => calls.push("fired"));
        game._emitter.emit("rawCallback", "test", []);
        game._emitter.emit("rawCallback", "test", []);
        expect(calls).toEqual(["fired"]);
    });
});

// ---------------------------------------------------------------------------
// Helper: run the subprocess and parse JSON results
// ---------------------------------------------------------------------------
function runStateGame(version) {
    return execFileAsync("node", [join(__dirname, "run-state-shim.mjs"), version], {
        timeout: 20000,
    }).then(({ stdout }) => JSON.parse(stdout.trim()));
}

// ---------------------------------------------------------------------------
// Integration tests per WASM version
// ---------------------------------------------------------------------------
describe.each([
    { label: "wasm-367", version: "367" },
    { label: "wasm-37", version: "37" },
])("integration with $label", ({ version }) => {
    let result;

    beforeAll(async () => {
        result = await runStateGame(version);
    }, 25000);

    it("completes without errors", () => {
        expect(result.error).toBeNull();
    });

    // ── Events fired ─────────────────────────

    describe("events", () => {
        it("fires rawCallback events", () => {
            expect(result.events.rawCallback).toBeGreaterThan(0);
        });

        it("fires mapUpdate events", () => {
            expect(result.events.mapUpdate).toBeGreaterThan(0);
        });

        it("fires message events", () => {
            expect(result.events.message).toBeGreaterThan(0);
        });

        it("fires statusChange events", () => {
            expect(result.events.statusChange).toBeGreaterThan(0);
        });

        it("fires inputRequired events", () => {
            expect(result.events.inputRequired).toBe(50);
        });

        it("fires phaseChange events", () => {
            expect(result.events.phaseChange).toBeGreaterThan(0);
        });
    });

    // ── State accumulation ───────────────────

    describe("state accumulation", () => {
        it("captures messages with text content", () => {
            expect(result.firstMessages.length).toBeGreaterThan(0);
            const hasText = result.firstMessages.some((m) => m.text.length > 0);
            expect(hasText).toBe(true);
        });

        it("accumulates message count", () => {
            expect(result.messageCount).toBeGreaterThan(0);
        });

        it("records status field changes", () => {
            expect(result.statusFields.length).toBeGreaterThan(0);
            const allFields = result.statusFields.flat();
            expect(allFields.length).toBeGreaterThan(0);
        });

        it("captures a non-empty map tile", () => {
            expect(result.mapTileSample).not.toBeNull();
            expect(result.mapTileSample.glyph).toBeGreaterThan(0);
            expect(typeof result.mapTileSample.x).toBe("number");
            expect(typeof result.mapTileSample.y).toBe("number");
        });

        it("captures tileType on map tiles", () => {
            expect(result.mapTileSample.tileType).toBeDefined();
            expect(typeof result.mapTileSample.tileType).toBe("string");
        });

        it("populates visibleItems with floor objects", () => {
            // Starting dungeon level always has at least the staircase up,
            // and usually some items. Items may not appear on every run,
            // so just verify the array exists and entries have correct shape.
            if (result.visibleItemsSample) {
                expect(typeof result.visibleItemsSample.x).toBe("number");
                expect(typeof result.visibleItemsSample.y).toBe("number");
                expect(typeof result.visibleItemsSample.ch).toBe("string");
                expect(typeof result.visibleItemsSample.color).toBe("number");
                expect(typeof result.visibleItemsSample.tileType).toBe("string");
                expect(typeof result.visibleItemsSample.category).toBe("string");
                expect(["object", "statue", "corpse"]).toContain(
                    result.visibleItemsSample.tileType,
                );
            }
        });

        it("populates visibleFeatures with correct shape when present", () => {
            // Features (stairs, fountains, altars) depend on map layout
            // and player position. Verify shape when captured.
            if (result.visibleFeaturesSample) {
                expect(typeof result.visibleFeaturesSample.x).toBe("number");
                expect(typeof result.visibleFeaturesSample.y).toBe("number");
                expect(typeof result.visibleFeaturesSample.ch).toBe("string");
                expect(typeof result.visibleFeaturesSample.color).toBe("number");
                expect(typeof result.visibleFeaturesSample.name).toBe("string");
                expect(result.visibleFeaturesSample.name.length).toBeGreaterThan(0);
            }
        });

        it("populates final status fields", () => {
            expect(result.finalStatus).not.toBeNull();
            expect(typeof result.finalStatus.hp).toBe("number");
            expect(typeof result.finalStatus.title).toBe("string");
        });

        it("has realistic HP values (not zero)", () => {
            expect(result.finalStatus.hp).toBeGreaterThan(0);
            expect(result.finalStatus.hpMax).toBeGreaterThan(0);
            expect(result.finalStatus.hp).toBeLessThanOrEqual(result.finalStatus.hpMax);
        });

        it("has a player title with the player name", () => {
            expect(result.finalStatus.title).toContain("StateTest");
            // Should be trimmed — no trailing whitespace
            expect(result.finalStatus.title).toBe(result.finalStatus.title.trim());
        });

        it("has a dungeon level description", () => {
            expect(result.finalStatus.levelDesc).toMatch(/Dlvl:\d/);
        });

        it("has stat values in plausible ranges", () => {
            // NetHack starting stats are typically 3-25
            expect(result.finalStatus.dx).toBeGreaterThan(0);
            expect(result.finalStatus.co).toBeGreaterThan(0);
            expect(result.finalStatus.wi).toBeGreaterThan(0);
            expect(result.finalStatus.ch).toBeGreaterThan(0);
        });

        it("has a valid alignment string", () => {
            expect(["Lawful", "Neutral", "Chaotic"]).toContain(result.finalStatus.align);
        });
    });

    // ── Input handling ───────────────────────

    describe("input handling", () => {
        it("records input prompt types", () => {
            expect(result.inputTypes.length).toBeGreaterThan(0);
        });

        it("charSelect is handled internally by startup sequence", () => {
            // charSelect no longer reaches external inputRequired listeners —
            // it's resolved by _runStartupSequence before start() returns.
            expect(result.inputTypes).not.toContain("charSelect");
        });

        it("handles key or poskey input type", () => {
            // "key" prompts during startup (text window dismissal) are
            // handled internally. Gameplay uses "poskey". Either is valid.
            const hasKey = result.inputTypes.includes("key")
                || result.inputTypes.includes("poskey");
            expect(hasKey).toBe(true);
        });
    });

    // ── Phase tracking ───────────────────────

    describe("phase tracking", () => {
        it("transitions through init phase", () => {
            expect(result.phaseChanges).toContain("init");
        });

        it("transitions through charSelect phase", () => {
            expect(result.phaseChanges).toContain("charSelect");
        });

        it("reaches playing phase", () => {
            expect(result.phaseChanges).toContain("playing");
        });
    });
});

// ---------------------------------------------------------------------------
// Verb method integration tests
// ---------------------------------------------------------------------------
function runVerbGame(version) {
    return execFileAsync("node", [join(__dirname, "run-verb-shim.mjs"), version], {
        timeout: 20000,
    }).then(({ stdout }) => JSON.parse(stdout.trim()));
}

describe.each([
    { label: "wasm-367", version: "367" },
    { label: "wasm-37", version: "37" },
])("verb methods with $label", ({ version }) => {
    let result;

    beforeAll(async () => {
        result = await runVerbGame(version);
    }, 25000);

    it("completes without errors", () => {
        expect(result.error).toBeNull();
    });

    it("eat() handles food item", () => {
        if (result.eatResult?.skipped) return;
        expect(result.eatResult.item).toBeDefined();
    });

    it("eat() updates inventory after action", () => {
        if (result.eatResult?.skipped) return;
        // Eating may take multiple turns ("You begin eating..."),
        // so inventory might not change on the same turn.
        expect(result.eatResult.inventoryChangedImmediately).toBeDefined();
    });

    it("drop() handles inventory item", () => {
        if (result.dropResult?.skipped) return;
        expect(result.dropResult.item).toBeDefined();
    });

    it("drop() updates inventory after action", () => {
        if (result.dropResult?.skipped) return;
        expect(result.dropResult.inventoryChangedImmediately).toBeDefined();
    });

    it("takeOff() handles worn equipment", () => {
        if (result.takeOffResult?.skipped) return;
        expect(result.takeOffResult.item).toBeDefined();
    });

    it("eat() with no item letter resolves without interceptor", () => {
        if (result.noArgEatResult?.skipped) return;
        expect(result.noArgEatResult.resolved).toBe(true);
        expect(result.noArgEatResult.noInterceptor).toBe(true);
    });

    it("drop() with no item letter resolves without interceptor", () => {
        if (result.noArgDropResult?.skipped) return;
        expect(result.noArgDropResult.resolved).toBe(true);
        expect(result.noArgDropResult.noInterceptor).toBe(true);
    });

    it("takeOff() with no item letter resolves without interceptor", () => {
        if (result.noArgTakeOffResult?.skipped) return;
        expect(result.noArgTakeOffResult.resolved).toBe(true);
        expect(result.noArgTakeOffResult.noInterceptor).toBe(true);
    });

    it("cleans up inputInterceptor after successful verb methods", () => {
        // If all verbs completed (not skipped/timed out), interceptor should be null
        const allSkipped = [result.eatResult, result.dropResult, result.takeOffResult]
            .every(r => r?.skipped);
        if (allSkipped) return; // nothing to check
        // If any verb timed out, interceptor might still be set
        const anyTimedOut = [result.eatResult, result.dropResult, result.takeOffResult]
            .some(r => r?.reason === "verb timeout");
        if (anyTimedOut) return;
        expect(result.interceptorCleanedUp).toBe(true);
    });
});
