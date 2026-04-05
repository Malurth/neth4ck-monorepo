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
| `autoDismissMenus` | `""` | Controls how `action()` and `sendPosition()` handle blocking `PICK_NONE`/`PICK_ONE` menus (e.g. tutorial popups). `"dismiss"`: auto-dismiss the menu, consume the input. `"resend"`: auto-dismiss, then resend the original input once the game is ready. Falsy (default): drop the input and emit an `inputBlocked` event. `PICK_ANY` menus are never auto-dismissed since they require real user choices. |

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
        skipTutorial: true,  // default: true — auto-dismiss 3.7's tutorial prompt
        options: [           // arbitrary NETHACKOPTIONS entries
            "color", "showexp", "showscore", "time",
            "number_pad:0", "runmode:walk", "boulder:0",
            "autopickup", "pickup_types:$",
        ],
    },
    print: () => {},     // suppress Emscripten stdout
    printErr: () => {},  // suppress Emscripten stderr
});
```

- **createModule** — default export from `@neth4ck/wasm-367` or `@neth4ck/wasm-37`
- **nethackOptions** — character and game settings:
  - `name`, `role`, `race`, `gender`, `align` — character creation
  - `skipTutorial` (default `true`) — auto-dismiss 3.7's tutorial prompt
  - `options` — array of NETHACKOPTIONS strings (e.g. `["color", "showexp", "number_pad:0"]`). These are appended to the `NETHACKOPTIONS` env var before the game starts.
- **saves** — save file persistence mode:
  - `"none"` (default) — no IDBFS mount, saves don't persist across page reloads
  - `"clear"` — mount IDBFS, delete any existing saves, then start fresh
  - Any other truthy value (e.g. `"load"`) — mount IDBFS and load existing saves for restore
- **saveDir** — IDBFS mount path (default `"/save"`). Each unique path gets its own IndexedDB database, so use different paths for different save slots or versions (e.g. `"/save-37-slot1"`). The API creates a symlink from `/save` (where NetHack writes) to this path.
- All other properties are forwarded to the Emscripten Module config

The startup sequence (character selection, name entry, intro text, tutorial) is handled automatically before `start()` resolves. When restoring from a save, character creation is skipped and the game resumes directly. Set `skipTutorial: false` to have the tutorial menu forwarded via `inputRequired` instead.

### Advanced: Emscripten Module Config

All unrecognized properties in `moduleOptions` are forwarded to the Emscripten Module. This includes `preRun` hooks for low-level setup. For NETHACKOPTIONS, prefer `nethackOptions.options` instead. For save persistence, prefer the built-in `saves` and `saveDir` options.

## Sending Commands

### High-level Actions

The simplest way to interact with the game — no need to know about raw keys or prompt types:

```js
game.action("move_n");     // directional movement (move_n, move_se, etc.)
game.action("search");     // named action → sends the correct key(s)
game.action("eat:d");      // verb + item letter (eat, wield, drop, etc.)
game.action("pray");       // extended command → sends #pray\n
game.action("y");          // fallback: routes through handleKey

// Save & quit (auto-confirms "Really save?" and syncs to IndexedDB)
await game.save();         // returns a Promise, resolves after IndexedDB sync

// Quit the game (auto-confirms all prompts)
game.quit();               // returns a Promise, resolves at gameOver

// Or use action() for manual save/quit (you handle the yn prompts yourself):
game.action("save");       // sends #save — you must answer "Really save?" etc.
game.action("quit");       // sends #quit — you must answer "Really quit?" etc.
```

### Save Management

```js
// Check for save files without booting WASM (static method)
const hasSave = await NethackStateManager.hasSaveFiles("/save-37-slot1");

// List save files in the mounted save directory (requires a running game)
game.listSaves();          // → ["0Player"] or [] if none

// Manually sync save files from memory FS to IndexedDB
await game.syncSaves();    // emits "savesSynced" when complete
```

`save()` handles the full sequence: dispatches `#save`, auto-answers all prompts, waits for the game to exit, syncs to IndexedDB, then resolves. `hasSaveFiles()` checks IndexedDB directly — use it to detect existing saves before starting a game. `listSaves()` and `syncSaves()` are lower-level — use them for custom save management flows.

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

game.handleClick(x, y);  // route a map click — if in position selection
                         // (farlook, targeting), sends the position;
                         // otherwise moves toward the clicked tile
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

#### Position & Look

```js
game.sendPosition(x, y);         // send a map coordinate (for position prompts)
game.lookAt(x, y);               // get the clean description of a map tile (synchronous)
                                  // e.g. "closed door", "a jackal", "a long sword"
                                  // Uses the same do_screen_description() as auto_describe
```

#### Other

```js
game.sendExtCmd(index);           // send an extended command by index
game.resolveCharSelect(value);    // respond to character creation
```

## Reading Game State

All state is available as getters on the game instance. Values update automatically as the game runs.

### Map

```js
game.map        // MapTile[][] — indexed as map[y][x] (default) or map[x][y]
game.cursor     // { x, y } — cursor position on the map (follows farlook cursor)
game.playerPos  // { x, y } — player's true position (unaffected by farlook/targeting)
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
game.status.levelDesc   // dungeon level string (e.g. "Dlvl:1")
game.status.dlvl        // dungeon level number (parsed from levelDesc)
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
// [{ x, y, ch, color, glyph, tileType, tileLabel, category, obscured }, ...]
//   tileType: "object", "statue", or "corpse"
//   tileLabel: descriptive name for statues/corpses (e.g. "goblin corpse")
//   category: item category string (e.g. "weapon", "potion")
//   obscured: true if hidden under another glyph (e.g. monster standing on item)

// Notable features (stairs, fountains, altars, etc.)
game.visibleFeatures
// [{ x, y, ch, color, glyph, name, obscured }, ...]
//   name: human-readable (e.g. "staircase down", "fountain or sink", "staircase")
//   obscured: true if hidden under another glyph (e.g. player on staircase)
//   Note: features beneath monsters are detected via dungeon terrain scan
//   (get_levl_typ + get_stair_direction + get_feature_color), so even
//   the staircase at spawn is reported with correct name, direction, and color.
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
game.isPositionSelection // true when the game is in getpos() — farlook, targeting, etc.
game.inputState         // C engine input state: 0=other, 1=command, 2=getpos, 3=getdir
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
| `actionTaken` | `(info)` | Player performed an action. `info.action` identifies it: `"move"` (+ `direction`, optionally `x`, `y`), `"eat"`/`"wield"`/etc. (+ `item`), `"farlook"` (+ `x`, `y`, `description`), `"search"`, `"pray"`, `"answer"` (+ `key`, `promptType`, `promptQuery`), `"menuSelect"` (+ `key`, `promptQuery`), `"menuDismiss"` (+ `promptQuery`), `"lineAnswer"` (+ `key`, `promptQuery`), `"lineDismiss"` (+ `promptQuery`), `"quit"`, or `"key"` (+ `key`) for raw keystrokes. Prompt-response actions (`answer`, `menuSelect`, `menuDismiss`, `lineAnswer`, `lineDismiss`) include `promptQuery` — the text of the prompt being answered. When `key` matches an inventory item, `itemName` is also included with the resolved display text (e.g. `"an uncursed scroll of blank paper"`). |
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
| `savesSynced` | — | Save files successfully synced to IndexedDB |
| `inputBlocked` | `({ reason, ... })` | Input was dropped because a menu (or other prompt) is blocking. Only emitted when `autoDismissMenus` is `false`. |
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
