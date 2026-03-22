# @neth4ck/api

JavaScript API for NetHack WASM. Wraps `@neth4ck/neth4ck` and accumulates game state from window-port callbacks into a clean, event-driven API. Works with both NetHack 3.6.7 and 3.7 WASM builds.

## Installation

```bash
npm install @neth4ck/api @neth4ck/neth4ck
```

You also need a WASM package:

```bash
npm install @neth4ck/wasm-367   # NetHack 3.6.7
# or
npm install @neth4ck/wasm-37    # NetHack 3.7
```

## Quick Start

```js
import { NethackStateManager } from "@neth4ck/api";
import createModule from "@neth4ck/wasm-367";

const game = new NethackStateManager();

game.on("mapUpdate", () => {
    console.log("Player at:", game.cursor);
    console.log("HP:", game.status.hp, "/", game.status.hpMax);
});

game.on("message", (msg) => {
    console.log(msg.text);
});

game.on("inputRequired", (prompt) => {
    if (prompt.type === "key") {
        game.sendKey(".");  // rest
    }
});

await game.start(createModule, {
    nethackOptions: { name: "Rodney" },
});
```

## API

### `new NethackStateManager(options?)`

- **options.messageHistorySize** — Max messages to retain (default: 200)
- **options.mapCoordinateOrder** — `"yx"` (default) or `"xy"` for map array indexing

### `game.start(createModule, moduleOptions?) → Promise<this>`

Boots the WASM module and starts the game loop. The game suspends via Asyncify whenever it needs player input, emitting an `inputRequired` event.

- **createModule** — WASM factory (default export from `@neth4ck/wasm-367` or `@neth4ck/wasm-37`)
- **moduleOptions.nethackOptions** — NetHack options (e.g., `{ name: "Rodney", autoquiver: true }`)
- Any other properties are passed through as Emscripten Module config

### State Getters

| Getter | Type | Description |
|---|---|---|
| `game.map` | `MapTile[][]` | Map grid. Each tile: `{ glyph, bkglyph, tileIndex, ch, color, special, x, y }` |
| `game.cursor` | `{ x, y }` | Player position on the map |
| `game.status` | `object` | Status bar fields (see below) |
| `game.messages` | `RingBuffer` | Message history. Supports `[i]`, `.length`, `.filter()`, `.map()`, etc. |
| `game.conditions` | `Set<string>` | Active conditions: `"blind"`, `"conf"`, `"hallu"`, etc. |
| `game.phase` | `string` | `"init"`, `"charSelect"`, `"playing"`, or `"gameOver"` |
| `game.pendingInput` | `object\|null` | Current input prompt, or null |
| `game.pendingInputType` | `string\|null` | Shorthand for `pendingInput?.type` |
| `game.isWaitingForInput` | `boolean` | Whether the game is waiting for player input |
| `game.activeMenu` | `object\|null` | Current open menu with items, prompt, and selection mode |
| `game.monsters` | `array\|null` | Monster registry (all types in this version). Available after `start()` |
| `game.visibleMonsters` | `array` | Monsters on the current map frame |
| `game.inventoryNeedsUpdate` | `boolean` | Whether inventory data is stale |
| `game.module` | `Module` | Raw Emscripten module (escape hatch) |
| `game.constants` | `object\|null` | Game constants from WASM (colors, glyphs, attributes) |
| `game.globals` | `object\|null` | Game globals from WASM (window IDs, player name, flags) |
| `game.helpers` | `object\|null` | Helper functions from WASM (glyph mapping, etc.) |

#### Status Fields

```js
game.status = {
    title, str, dx, co, in, wi, ch,   // name/title and attributes
    align,                              // "Lawful", "Neutral", or "Chaotic"
    hp, hpMax, energy, energyMax,       // vitals
    ac, xpLevel, exp, score,            // combat/progression
    gold, hunger, carrying,             // resources
    levelDesc, hd, time,                // dungeon/turn info
}
```

#### Monster Registry

```js
game.monsters[0]
// { index, name, symbol, level, speed, ac, mr, alignment, difficulty, color }

game.visibleMonsters
// [{ x, y, monsterIndex, name, isPet, isRidden, isDetected }, ...]
```

### Input Methods

Call these in response to `inputRequired` events. Throws if no input is pending or the type doesn't match.

| Method | Input Types | Description |
|---|---|---|
| `game.sendKey(key)` | `key`, `poskey` | Send a keypress (string or char code) |
| `game.sendDirection(dir)` | `key`, `poskey` | Send a direction: `"n"`, `"se"`, `"up"`, `"down"`, etc. |
| `game.move(dir)` | `key`, `poskey` | Alias for `sendDirection` |
| `game.rest()` | `key`, `poskey` | Send `.` (rest one turn) |
| `game.search()` | `key`, `poskey` | Send `s` (search) |
| `game.answerYn(answer)` | `yn` | Answer a yes/no prompt |
| `game.answerLine(text)` | `line` | Answer a text prompt |
| `game.selectMenuItems(ids)` | `menu` | Select menu items by identifier |
| `game.selectMenuItem(id)` | `menu` | Select a single menu item |
| `game.dismissMenu()` | `menu` | Close the menu without selecting |
| `game.sendExtCmd(index)` | `extcmd` | Send an extended command index |
| `game.sendPosition(x, y, mod?)` | `poskey` | Send a map position |
| `game.resolveCharSelect(value)` | `charSelect` | Resolve character selection |

### Events

```js
game.on(event, callback)
game.once(event, callback)
game.off(event, callback)
```

| Event | Callback Args | Description |
|---|---|---|
| `mapUpdate` | `(map)` | Map tiles changed |
| `statusChange` | `(status, changedFields)` | Status bar updated. `changedFields` is an array of changed keys |
| `message` | `(msg)` | New message. `msg: { text, attr, turn }` |
| `conditionChange` | `(conditions, added, removed)` | Conditions changed |
| `inputRequired` | `(prompt)` | Game needs input. `prompt: { type, ... }` |
| `menuOpen` | `(menu)` | Menu opened. `menu: { windowId, prompt, selectionMode, items }` |
| `textWindow` | `(lines)` | Text window displayed |
| `phaseChange` | `(phase)` | Game phase changed |
| `inventoryNeedsUpdate` | — | Inventory changed (contents not yet readable) |
| `monstersUpdate` | `(visibleMonsters)` | Visible monsters changed |
| `gameOver` | `({ how, when })` | Game ended |
| `rawCallback` | `(name, args)` | Every WASM callback (escape hatch) |

### Exported Constants

```js
import {
    DIRECTIONS,   // { n: "k", s: "j", e: "l", ... }
    KEY_CODES,    // { ESC: 27, SPACE: 32, ENTER: 13, TAB: 9 }
    MAP_WIDTH,    // 80
    MAP_HEIGHT,   // 21
    COLORS,       // { BLACK: 0, RED: 1, ..., WHITE: 15 }
    ATTR,         // { NONE: 0, BOLD: 1, DIM: 2, ... }
    STATUS_FIELDS,  // ["title", "hp", "hpMax", ...]
    CONDITIONS,     // ["stone", "blind", "conf", ...]
    PHASE,          // { INIT: "init", PLAYING: "playing", ... }
    INPUT_TYPE,     // { KEY: "key", YN: "yn", MENU: "menu", ... }
    MENU_MODE,      // { PICK_NONE, PICK_ONE, PICK_ANY }
    EventEmitter,
    NethackStateManager,
} from "@neth4ck/api";
```

## License

See [LICENSE.md](./LICENSE.md) — NetHack General Public License.
