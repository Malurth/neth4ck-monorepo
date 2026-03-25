# @neth4ck/api

JavaScript API for NetHack WASM. Run a NetHack game, send commands, and read all game state from any JS frontend. Works with both NetHack 3.6.7 and 3.7.

## Installation

```bash
npm install @neth4ck/api @neth4ck/neth4ck @neth4ck/wasm-367
```

Or for NetHack 3.7:

```bash
npm install @neth4ck/api @neth4ck/neth4ck @neth4ck/wasm-37
```

## Quick Start

```js
import { NethackStateManager } from "@neth4ck/api";
import createModule from "@neth4ck/wasm-367";

const game = new NethackStateManager();

game.on("message", (msg) => console.log(msg.text));

game.on("inputRequired", (prompt) => {
    switch (prompt.type) {
        case "key":
            game.sendKey(".");  // rest one turn
            break;
        case "yn":
            game.answerYn("y");
            break;
        case "menu":
            game.dismissMenu();
            break;
        // ... handle other prompt types
    }
});

await game.start(createModule, {
    nethackOptions: { name: "Rodney" },
});

// After start() resolves, the game is fully initialized:
console.log(game.introText);        // backstory text lines
console.log(game.startupMessages);  // welcome message(s)
console.log(game.inventory);        // starting equipment
```

`start()` handles the full startup sequence automatically — character selection, name entry, intro text dismissal, and tutorial skip. By the time the returned Promise resolves, the game is in the `"playing"` phase with map, stats, inventory, and messages all populated. The first `inputRequired` event is for actual gameplay input.

## Starting a Game

### `new NethackStateManager(options?)`

| Option | Default | Description |
|---|---|---|
| `messageHistorySize` | `200` | Max messages to keep in the ring buffer |
| `mapCoordinateOrder` | `"yx"` | `"yx"` for `map[y][x]`, `"xy"` for `map[x][y]` |

### `game.start(createModule, moduleOptions?)`

Returns a `Promise` that resolves once the game is fully initialized and ready for gameplay input.

```js
await game.start(createModule, {
    nethackOptions: {
        name: "Rodney",
        role: "val",         // Valkyrie (omit or "random" for random)
        race: "hum",         // Human
        gender: "fem",       // Female
        align: "neu",        // Neutral
        autoquiver: true,
        perm_invent: true,
        skipTutorial: true,  // default: true — auto-dismiss 3.7's tutorial prompt
    },
    print: () => {},     // suppress Emscripten stdout
    printErr: () => {},  // suppress Emscripten stderr
});
```

- **createModule** — default export from `@neth4ck/wasm-367` or `@neth4ck/wasm-37`
- **nethackOptions** — character options and game settings. `name`, `role`, `race`, `gender`, `align` configure the character. Boolean flags (`autoquiver`, `perm_invent`) are passed as `NETHACKOPTIONS` env var. `skipTutorial` (default `true`) controls whether the 3.7 tutorial prompt is auto-dismissed.
- All other properties are forwarded to the Emscripten Module config

The startup sequence (character selection, name entry, intro text, tutorial) is handled automatically before `start()` resolves. Set `skipTutorial: false` to have the tutorial menu forwarded via `inputRequired` instead.

### Advanced: Emscripten Module Config

All unrecognized properties in `moduleOptions` are forwarded to the Emscripten Module. This includes `preRun` hooks for low-level setup:

```js
await game.start(createModule, {
    nethackOptions: { name: "Rodney" },
    preRun: [(mod) => {
        // Set NETHACKOPTIONS beyond what nethackOptions covers
        const existing = mod.ENV.NETHACKOPTIONS ?? "";
        mod.ENV.NETHACKOPTIONS = existing + ",autopickup,pickup_types:$";

        // Mount IndexedDB filesystem for save persistence
        mod.FS.mkdir("/save");
        mod.FS.mount(mod.IDBFS, {}, "/save");
        mod.FS.syncfs(true, () => {});
    }],
    print: () => {},
    printErr: () => {},
});
```

`preRun` hooks run before `_main()`. The API's own NETHACKOPTIONS setup runs after consumer hooks, so `nethackOptions` values are appended to whatever you set.

## Sending Commands

### High-level Actions

The simplest way to interact with the game — no need to know about raw keys or prompt types:

```js
game.action("move_n");     // directional movement (move_n, move_se, etc.)
game.action("search");     // named action → sends the correct key(s)
game.action("eat:d");      // verb + item letter (eat, wield, drop, etc.)
game.action("pray");       // extended command → sends #pray\n
game.action("y");          // fallback: routes through handleKey
```

`action()` handles all dispatch logic:
1. **`verb:letter`** — calls the verb method (e.g. `eat("d")`) which manages the item prompt sequence
2. **`move_*`** — directional movement via `move()`
3. **Extended commands** — sends `#name\n` key sequence
4. **Mapped actions** — looks up the key in `ACTION_KEYS` and sends it
5. **Fallback** — routes through `handleKey()`

```js
game.handleKey("y");  // route a keystroke based on current prompt type:
                      //   yn prompt → answerYn
                      //   menu + ESC → dismissMenu
                      //   menu + letter → selectMenuItem
                      //   anything else → sendKey
```

### Low-level Input

All input methods respond to the current `inputRequired` prompt. Calling them when no input is pending (or with the wrong type) throws an error.

#### Keyboard

```js
game.sendKey("j");          // send a single key (string or char code)
game.sendKey(32);           // spacebar
game.sendDirection("n");    // move north (sends "k")
game.move("se");            // move southeast (alias for sendDirection)
game.rest();                // send "." — wait one turn
game.search();              // send "s" — search adjacent squares
```

Directions: `"n"`, `"s"`, `"e"`, `"w"`, `"ne"`, `"nw"`, `"se"`, `"sw"`, `"up"`, `"down"`

#### Prompts

```js
game.answerYn("y");               // answer a yes/no question
game.answerLine("Excalibur");     // answer a text prompt (e.g. "Call this item:")
```

#### Menus

```js
game.selectMenuItems([ids]);  // select items by identifier
game.selectMenuItem(id);      // select a single item
game.dismissMenu();           // close without selecting (ESC)
```

#### Other

```js
game.sendPosition(x, y);         // send a map coordinate (for position prompts)
game.sendExtCmd(index);           // send an extended command by index
game.resolveCharSelect(value);    // respond to character creation
```

## Reading Game State

All state is available as getters on the game instance. Values update automatically as the game runs.

### Map

```js
game.map        // MapTile[][] — indexed as map[y][x] (default) or map[x][y]
game.cursor     // { x, y } — player position on the map
```

Each tile: `{ glyph, bkglyph, tileIndex, ch, color, special, x, y, tileType, tileLabel }`

`tileType` classifies the glyph: `"monster"`, `"pet"`, `"ridden"`, `"detected"`, `"object"`, `"corpse"`, `"statue"`, `"feature"`, `"effect"`, `"warning"`, `"invisible"`, `"unexplored"`, `"nothing"`, or `null`.

`tileLabel` provides a descriptive name for statues and corpses (e.g., `"statue of goblin"`, `"goblin corpse"`). `null` for other tile types.

### Player Status

```js
game.status.hp          // current hit points
game.status.hpMax       // max hit points
game.status.energy      // current power
game.status.energyMax   // max power
game.status.ac          // armor class
game.status.str         // strength (string — may be "18/50")
game.status.dx          // dexterity
game.status.co          // constitution
game.status.in          // intelligence
game.status.wi          // wisdom
game.status.ch          // charisma
game.status.align       // "Lawful", "Neutral", or "Chaotic"
game.status.xpLevel     // experience level
game.status.exp         // experience points
game.status.gold        // gold pieces
game.status.score       // score
game.status.hunger      // hunger state string
game.status.carrying    // encumbrance string
game.status.levelDesc   // dungeon level (e.g. "Dlvl:1")
game.status.title       // player name and title
game.status.time        // turn count
game.status.hd          // hit dice
```

### Conditions

```js
game.conditions   // Set<string> — e.g. Set { "blind", "conf" }
```

Possible values: `"stone"`, `"slime"`, `"strngl"`, `"foodpois"`, `"termill"`, `"blind"`, `"deaf"`, `"stun"`, `"conf"`, `"hallu"`, `"lev"`, `"fly"`, `"ride"`

### Messages

```js
game.messages         // ring buffer of recent messages
game.messages[0]      // oldest message: { text, attr, turn }
game.messages.length  // number of messages in buffer
game.messages.at(-1)  // most recent message

// also supports .filter(), .map(), .find(), .some(), .slice(), etc.
```

### Inventory

Inventory is read directly from WASM memory on every input prompt and emits `inventoryUpdate` when items change. You can also force a refresh with `game.refreshInventory()`.

```js
game.inventory    // array of items currently carried

game.inventory[0]
// {
//   letter: "a",                    — inventory slot
//   displayText: "a +2 long sword (weapon in hand)", — NetHack's formatted description
//   name: "long sword",             — actual object name
//   appearance: "long sword",       — randomized description (when unidentified)
//   oclass: 41,                     — object class code
//   otyp: 5,                        — object type index
//   quantity: 1,                    — stack count
//   enchantment: 0,                 — +/- enchantment or charge count
//   worn: true,                     — equipped in any slot
//   wornMask: 2,                    — bitmask of equipment slots
// }
```

### Monsters

```js
// Full bestiary — all monster types in this NetHack version
game.monsters         // array, available after start()
game.monsters[0]
// { index, name, symbol, level, speed, ac, mr, alignment, difficulty, color }

// Monsters visible on the current map frame
game.visibleMonsters
// [{ x, y, monsterIndex, name, isPet, isRidden, isDetected }, ...]
```

### Visible Items & Features

Updated on each `mapUpdate` — no need to scan the full map yourself:

```js
// Items on the floor (objects, statues, corpses)
game.visibleItems
// [{ x, y, ch, color, glyph, tileType, tileLabel, category }, ...]
//   tileType: "object", "statue", or "corpse"
//   tileLabel: descriptive name for statues/corpses (e.g. "goblin corpse")
//   category: item category string (e.g. "weapon", "potion")

// Notable features (stairs, fountains, altars, etc.)
game.visibleFeatures
// [{ x, y, ch, color, glyph, name }, ...]
//   name: human-readable (e.g. "staircase down", "fountain or sink")
```

### Startup Text

Available after `start()` resolves:

```js
game.introText        // string[] — backstory lines ("It is written in the Book of...")
game.startupMessages  // message[] — welcome messages captured during startup
                      // e.g. [{ text: "Hello Rodney, welcome to NetHack!...", attr, turn }]
```

### Game Phase

```js
game.phase              // "init" | "charSelect" | "playing" | "gameOver"
game.pendingInput       // current input prompt object, or null
game.pendingInputType   // shorthand for pendingInput?.type
game.isWaitingForInput  // boolean
game.activeMenu         // current open menu, or null
```

### Escape Hatches

For advanced use or things the API doesn't cover yet:

```js
game.module     // raw Emscripten Module
game.constants  // globalThis.nethackGlobal.constants (colors, glyphs, etc.)
game.globals    // globalThis.nethackGlobal.globals (window IDs, flags, etc.)
game.helpers    // globalThis.nethackGlobal.helpers (glyph mapping, etc.)
```

## Events

```js
game.on(event, callback);
game.once(event, callback);
game.off(event, callback);
```

| Event | Callback Args | When |
|---|---|---|
| `inputRequired` | `(prompt)` | Game needs player input. `prompt.type` is `"key"`, `"yn"`, `"line"`, `"menu"`, `"poskey"`, or `"extcmd"`. (Character creation prompts are handled internally by the startup sequence.) |
| `mapUpdate` | `(map)` | Map tiles changed |
| `statusChange` | `(status, changedFields)` | Status bar updated. `changedFields` lists which keys changed |
| `message` | `(msg)` | New message. `msg: { text, attr, turn }` |
| `conditionChange` | `(conditions, added, removed)` | Conditions added or removed |
| `inventoryUpdate` | `(items)` | Inventory changed |
| `monstersUpdate` | `(visibleMonsters)` | Visible monsters on the map changed |
| `menuOpen` | `(menu)` | Menu opened. `menu: { windowId, prompt, selectionMode, items }` |
| `textWindow` | `(lines)` | Text window displayed (array of strings) |
| `phaseChange` | `(phase)` | Game phase changed |
| `gameOver` | `({ how, when })` | Game ended |
| `rawCallback` | `(name, args)` | Every WASM window-port callback (escape hatch for anything not covered above) |

## Exported Constants

```js
import {
    // Action/input mappings
    ACTION_KEYS,        // { search: ["s"], eat: ["e"], pickup: [","], ... }
    EXTENDED_COMMANDS,  // Set { "pray", "loot", "dip", "enhance", ... }
    DIRECTIONS,         // { n: "k", s: "j", e: "l", w: "h", ne: "u", ... }
    KEY_CODES,          // { ESC: 27, SPACE: 32, ENTER: 13, TAB: 9 }

    // Map
    MAP_WIDTH,          // 80
    MAP_HEIGHT,         // 21
    FEATURE_NAMES,      // { "<": "staircase up", "{": "fountain or sink", ... }
    ITEM_CATEGORY_BY_CHAR, // { ")": "weapon", "!": "potion", ... }
    OBJ_CLASS_NAMES,    // { 2: "weapon", 7: "food", 11: "wand", ... }

    // Display
    COLORS,             // { BLACK: 0, RED: 1, ..., WHITE: 15 }
    ATTR,               // { NONE: 0, BOLD: 1, DIM: 2, ULINE: 4, BLINK: 5, INVERSE: 7 }

    // Enums
    STATUS_FIELDS,      // ["title", "hp", "hpMax", ...]
    CONDITIONS,         // ["stone", "blind", "conf", ...]
    PHASE,              // { INIT: "init", CHAR_SELECT: "charSelect", PLAYING: "playing", GAME_OVER: "gameOver" }
    INPUT_TYPE,         // { KEY: "key", YN: "yn", LINE: "line", MENU: "menu", ... }
    MENU_MODE,          // { PICK_NONE, PICK_ONE, PICK_ANY }
} from "@neth4ck/api";
```

## License

See [LICENSE.md](./LICENSE.md) — NetHack General Public License.
