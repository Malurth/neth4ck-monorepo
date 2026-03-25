// Subprocess helper for @neth4ck/api integration tests
// Usage: node run-state-shim.mjs <367|37>
// Outputs JSON results to stdout, then exits

import { NethackStateManager } from "@neth4ck/api";

const version = process.argv[2];
if (!version || !["367", "37"].includes(version)) {
    process.stderr.write("Usage: node run-state-shim.mjs <367|37>\n");
    process.exit(1);
}

const MAX_INPUTS = 50;
const TIMEOUT_MS = 15000;

const results = {
    version,
    error: null,
    events: {
        mapUpdate: 0,
        message: 0,
        statusChange: 0,
        conditionChange: 0,
        inputRequired: 0,
        menuOpen: 0,
        textWindow: 0,
        phaseChange: 0,
        inventoryNeedsUpdate: 0,
        rawCallback: 0,
    },
    // Sampled data
    firstMessages: [],
    statusFields: [],
    inputTypes: [],
    phaseChanges: [],
    mapTileSample: null,
    visibleItemsSample: null,
    visibleFeaturesSample: null,
    visibleItemsCount: 0,
    visibleFeaturesCount: 0,
    // State snapshot at exit
    finalStatus: null,
    finalPhase: null,
    finalConditions: [],
    messageCount: 0,
};

let inputCount = 0;

function outputAndExit() {
    process.stdout.write(`${JSON.stringify(results)}\n`);
    process.exit(0);
}

async function main() {
    const createModule =
        version === "367" ? (await import("@neth4ck/wasm-367")).default : (await import("@neth4ck/wasm-37")).default;

    const game = new NethackStateManager({
        messageHistorySize: 200,
        mapCoordinateOrder: "yx",
    });

    // ── Wire up event listeners ──────────────

    game.on("mapUpdate", (map) => {
        results.events.mapUpdate++;
        // Sample a tile from the map on first update
        if (!results.mapTileSample) {
            for (let y = 0; y < map.length; y++) {
                for (let x = 0; x < map[y].length; x++) {
                    if (map[y][x].glyph !== 0) {
                        results.mapTileSample = { ...map[y][x] };
                        break;
                    }
                }
                if (results.mapTileSample) break;
            }
        }

        // Track visible items and features
        const items = game.visibleItems;
        const features = game.visibleFeatures;
        if (items.length > 0) {
            results.visibleItemsCount = Math.max(results.visibleItemsCount, items.length);
            if (!results.visibleItemsSample) {
                results.visibleItemsSample = { ...items[0] };
            }
        }
        if (features.length > 0) {
            results.visibleFeaturesCount = Math.max(results.visibleFeaturesCount, features.length);
            if (!results.visibleFeaturesSample) {
                results.visibleFeaturesSample = { ...features[0] };
            }
        }
    });

    game.on("message", (msg) => {
        results.events.message++;
        if (results.firstMessages.length < 10) {
            results.firstMessages.push({ text: msg.text, attr: msg.attr });
        }
    });

    game.on("statusChange", (status, changedFields) => {
        results.events.statusChange++;
        if (results.statusFields.length < 5) {
            results.statusFields.push([...changedFields]);
        }
    });

    game.on("conditionChange", () => {
        results.events.conditionChange++;
    });

    // After start() resolves, the game is past startup (charSelect, askname,
    // intro text, tutorial are all handled internally). Only gameplay inputs
    // reach this handler.
    game.on("inputRequired", (prompt) => {
        results.events.inputRequired++;
        if (results.inputTypes.length < 20) {
            results.inputTypes.push(prompt.type);
        }

        inputCount++;
        if (inputCount >= MAX_INPUTS) {
            // Capture final state and exit
            results.finalStatus = { ...game.state.status };
            results.finalPhase = game.state.phase;
            results.finalConditions = [...game.state.conditions];
            results.messageCount = game.state.messages.length;
            outputAndExit();
        }

        // If the startup handler already resolved this prompt, skip
        if (!game.isWaitingForInput) return;

        // Auto-respond to gameplay inputs to keep the game running
        try {
            switch (prompt.type) {
                case "key":
                case "poskey":
                    game.sendKey(32); // space
                    break;
                case "yn":
                    game.answerYn("y");
                    break;
                case "line":
                    game.answerLine("");
                    break;
                case "menu":
                    game.dismissMenu();
                    break;
                case "extcmd":
                    game.sendExtCmd(-1);
                    break;
                default:
                    game.sendKey(32);
                    break;
            }
        } catch (e) {
            results.error = `input error: ${e.message}`;
            outputAndExit();
        }
    });

    game.on("menuOpen", () => {
        results.events.menuOpen++;
    });

    game.on("textWindow", () => {
        results.events.textWindow++;
    });

    game.on("phaseChange", (phase) => {
        results.events.phaseChange++;
        results.phaseChanges.push(phase);
    });

    game.on("inventoryNeedsUpdate", () => {
        results.events.inventoryNeedsUpdate++;
    });

    game.on("rawCallback", () => {
        results.events.rawCallback++;
    });

    // ── Start the game ───────────────────────

    setTimeout(() => outputAndExit(), TIMEOUT_MS);

    try {
        await game.start(createModule, {
            nethackOptions: { name: "StateTest" },
            print: () => {},
            printErr: () => {},
        });
        // Capture inventory snapshot after start (game is fully initialized)
        const inv = game.inventory;
        results.inventoryCount = inv.length;
        if (inv.length > 0) {
            results.inventorySample = { ...inv[0] };
        }
    } catch (e) {
        results.error = `start() threw: ${e.message || e}`;
        outputAndExit();
    }
}

main().catch((e) => {
    results.error = `Fatal: ${e.message || e}`;
    outputAndExit();
});
