# neth4ck-monorepo

A pnpm + Nx monorepo providing a JavaScript API layer over NetHack compiled to WebAssembly. The goal is to let any frontend interact with NetHack through a pleasant, high-level API without dealing with WASM memory, callback protocols, or version differences.

## Active Branch: `feat/api-layer`

The primary development branch. Adds the `@neth4ck/api` package — a high-level state manager that wraps all WASM complexity behind a clean event-driven interface.

## Workspace Context

This monorepo is developed alongside `NethackNarrated` (sibling directory), which is the first consumer of `@neth4ck/api`. Both repos are open in the workspace. NethackNarrated uses `file:` links to these packages.

**Key principle:** When NethackNarrated needs functionality that involves WASM details, game state parsing, or anything a generic frontend would need, that logic belongs here in `@neth4ck/api` — not in the frontend.

## Packages

| Package | Path | Purpose |
|---------|------|---------|
| `@neth4ck/api` | `packages/api/` | **The API layer.** High-level NethackStateManager class, event system, state getters, verb actions, constants |
| `@neth4ck/neth4ck` | `packages/neth4ck/` | Low-level shim/callback bridge between Emscripten WASM and JavaScript. Handles module init, callback installation, arg decoding |
| `@neth4ck/wasm-37` | `packages/wasm-37/` | NetHack 3.7 compiled to WASM via Emscripten (git submodule) |
| `@neth4ck/wasm-367` | `packages/wasm-367/` | NetHack 3.6.7 compiled to WASM via Emscripten (git submodule) |

### Package Dependency Chain
```
Frontend (e.g. NethackNarrated)
  └─ @neth4ck/api
       └─ @neth4ck/neth4ck
            └─ @neth4ck/wasm-37 or @neth4ck/wasm-367
```

## Key Source Files

### @neth4ck/api (`packages/api/src/`)

| File | Lines | Role |
|------|-------|------|
| `stateManager.js` | ~685 | Main class: lifecycle, state getters, input methods, verb actions, startup sequence, inventory/monster registry |
| `callbackRouter.js` | ~590 | Routes ~40 WASM callbacks: map rendering, messages, status, menus, input prompts, glyph classification |
| `constants.js` | ~141 | Exported constants: DIRECTIONS, KEY_CODES, COLORS, STATUS_FIELDS, CONDITIONS, PHASE, INPUT_TYPE, etc. |
| `eventEmitter.js` | ~45 | Simple on/once/off/emit EventEmitter |
| `ringBuffer.js` | ~89 | Bounded circular buffer with proxy-based indexing (for message history) |
| `index.js` | ~15 | Package entry: exports NethackStateManager, EventEmitter, constants |

### @neth4ck/neth4ck (`packages/neth4ck/src/`)

| File | Role |
|------|------|
| `index.js` | `nethackStart()` factory, SyncThenable wrapper, preRun/NETHACKOPTIONS setup |
| `decodeArgs.js` | Converts WASM integer IDs to friendly names, dereferences pointers, reads strings |
| `nethackOptions.js` | Formats character options into NETHACKOPTIONS env var |

## What the API Layer Handles (so frontends don't have to)

These are the "nasty implementation details" abstracted away:

- **WASM memory management** — pointer dereferencing, string extraction, struct traversal, malloc/free
- **Callback protocol** — routing ~40 different shim_* callbacks, decoding argument format strings, window ID mapping
- **Version differences** — 3.6.7 vs 3.7 struct layouts, glyph offsets, monster name access, object struct offsets
- **Glyph classification** — mapping raw glyph integers to tile types (monster, pet, object, corpse, statue, feature, effect, etc.)
- **Input sequencing** — character creation workflow, startup auto-resolution, prompt/menu/position selection handling
- **Verb action sequences** — send command key, intercept item prompt, handle auto-complete edge cases
- **Status field parsing** — mapping BL_* indices to named fields, numeric vs string parsing, condition bitmask decoding
- **Inventory reading** — walking the invent linked list in WASM memory, diffing snapshots, extracting names/appearance/properties
- **Monster registry** — building from PERMONST array, handling struct differences, symbol lookup
- **Event batching** — aggregating map updates, coordinating related events (mapUpdate + monstersUpdate)
- **Asyncify coordination** — Promise vs SyncThenable routing for blocking vs non-blocking callbacks

## Public API Surface

### NethackStateManager

**Lifecycle:** `new NethackStateManager(options?)` → `await game.start(createModule, moduleOptions)`

**State getters (read-only):** `map`, `cursor`, `status`, `messages`, `conditions`, `inventory`, `monsters`, `visibleMonsters`, `phase`, `pendingInput`, `pendingInputType`, `isWaitingForInput`, `introText`, `startupMessages`

**Input methods:** `sendKey()`, `sendDirection()`, `sendLine()`, `answerYn()`, `selectMenuItems()`, `sendPosition()`

**Verb actions:** `wield()`, `wear()`, `eat()`, `drink()`, `apply()`, `read()`, `drop()`, `throw()`, `zap()`, `takeOff()`, `remove()`, `put_on()`, `invoke_item()`, `offer()`, `dip()`, `tip()`, `tin()`, `name_item()`, `call_item()`, `adjust()`, `sacrifice()`

**Events:** `mapUpdate`, `monstersUpdate`, `statusChange`, `inventoryUpdate`, `inputRequired`, `inputResolved`, `message`, `gameOver`, `rawCallback`

**Escape hatches:** `module`, `constants`, `globals`, `helpers` (raw Emscripten access)

## Commands

```bash
pnpm install                    # Install all workspace deps
pnpm --filter @neth4ck/api test # Run API tests
npx nx build @neth4ck/api       # Build API package
```

## Architecture Notes

- All packages are plain JavaScript (no build step for api/neth4ck, only WASM packages need compilation)
- WASM packages contain git submodules pointing to Malurth/NetHack fork branches (`wasm-3.7`, `wasm-3.6.7`)
- WASM compiled with Emscripten `-s ASYNCIFY` to allow JS async callbacks from synchronous C game loop
- The `shim_graphics_set_callback` C function installs a single callback handler that routes all window operations to JS
- `SyncThenable` is used for non-blocking callbacks (synchronous value wrapped in thenable interface) to avoid unnecessary Asyncify suspends

## Conventions

- Plain JavaScript with JSDoc types (not TypeScript) for the API and shim packages
- Comprehensive README.md in `packages/api/` serves as the primary API documentation
- Constants are SCREAMING_CASE objects, frozen with Object.freeze
- EventEmitter is custom (no dependencies) — supports on/once/off/emit
- State getters return snapshots/copies, not live references
