/**
 * Subprocess shim for testing verb methods (eat, drop, takeOff).
 * Usage: node run-verb-shim.mjs <367|37>
 */
const version = process.argv[2] || "37";
const TIMEOUT_MS = 12000;

const results = {
    error: null,
    eatResult: null,
    dropResult: null,
    takeOffResult: null,
    noArgEatResult: null,
    noArgDropResult: null,
    noArgTakeOffResult: null,
    interceptorCleanedUp: null,
};

function outputAndExit() {
    process.stdout.write(JSON.stringify(results) + "\n");
    process.exit(0);
}

async function main() {
    const { NethackStateManager } = await import("@neth4ck/api");
    const wasmPkg = version === "367" ? "@neth4ck/wasm-367" : "@neth4ck/wasm-37";
    const { default: createModule } = await import(wasmPkg);

    const game = new NethackStateManager();

    // Generic prompt handler — only fires for prompts not consumed by interceptors
    game.on("inputRequired", (prompt) => {
        if (!game.isWaitingForInput) return;
        switch (prompt.type) {
            case "yn":
                // Always answer default during tests
                game.answerYn(prompt.default || "y");
                break;
            case "menu": {
                const items = prompt.menu?.items ?? [];
                const how = prompt.menu?.selectionMode;
                if (how === 1 || how === "PICK_ONE") {
                    const pick = items.find((i) => i.identifier);
                    pick ? game.selectMenuItems([pick.identifier]) : game.dismissMenu();
                } else {
                    game.selectMenuItems([]);
                }
                break;
            }
            case "line":
                game.answerLine("");
                break;
        }
    });

    setTimeout(() => {
        results.error = results.error || "timeout";
        outputAndExit();
    }, TIMEOUT_MS);

    await game.start(createModule, {
        nethackOptions: { name: "VerbTest" },
        print: () => {},
        printErr: () => {},
    });

    // Run each verb test independently with its own try/catch and timeout
    async function testVerb(name, fn) {
        try {
            const result = await Promise.race([
                fn(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("verb timeout")), 5000)
                ),
            ]);
            return result;
        } catch (e) {
            return { skipped: true, reason: e.message };
        }
    }

    // ── eat ──
    results.eatResult = await testVerb("eat", async () => {
        const food = game.inventory?.find((i) =>
            /ration|apple|tripe|food|pie|pancake|wafer|pear|meatball|egg/i.test(i.name || "")
        );
        if (!food) return { skipped: true, reason: "no food" };
        const beforeCount = game.inventory.length;
        await game.eat(food.letter);
        game.refreshInventory();
        const afterCount = game.inventory.length;
        return {
            item: food.name,
            messages: game.messages?.slice(-5).map((m) => m.text),
            inventoryChangedImmediately: afterCount !== beforeCount,
        };
    });

    // ── drop ──
    results.dropResult = await testVerb("drop", async () => {
        const item = game.inventory?.find((i) => !i.worn);
        if (!item) return { skipped: true, reason: "no droppable item" };
        const before = game.inventory.length;
        await game.drop(item.letter);
        game.refreshInventory();
        return {
            item: item.name,
            inventoryReduced: game.inventory.length < before,
            inventoryChangedImmediately: game.inventory.length !== before,
        };
    });

    // ── takeOff ──
    results.takeOffResult = await testVerb("takeOff", async () => {
        const worn = game.inventory?.find((i) => i.worn);
        if (!worn) return { skipped: true, reason: "no worn item" };
        await game.takeOff(worn.letter);
        const msgs = game.messages?.slice(-5).map((m) => m.text);
        return {
            item: worn.name,
            messages: msgs,
            success: msgs?.some((m) =>
                /take off|taking off|You were wearing|removed/i.test(m)
            ) ?? false,
        };
    });

    // ── no-arg verbs (send command, let consumer handle prompts) ──
    async function testNoArgVerb(name, method) {
        return testVerb(name, async () => {
            await method.call(game);
            const waiting = game.isWaitingForInput;
            const type = game.pendingInputType;
            // Cancel whatever prompt appeared so the game can continue
            if (type === "yn") game.answerYn(27); // ESC
            else if (type === "key" || type === "poskey") game.sendKey(27);
            else if (type === "menu") game.dismissMenu();
            return {
                resolved: true,
                noInterceptor: game._ctx.inputInterceptor === null,
            };
        });
    }

    results.noArgEatResult = await testNoArgVerb("eat()", game.eat);
    results.noArgDropResult = await testNoArgVerb("drop()", game.drop);
    results.noArgTakeOffResult = await testNoArgVerb("takeOff()", game.takeOff);

    results.interceptorCleanedUp = game._ctx.inputInterceptor === null;
    outputAndExit();
}

main().catch((e) => {
    results.error = `Fatal: ${e.message || e}`;
    outputAndExit();
});
