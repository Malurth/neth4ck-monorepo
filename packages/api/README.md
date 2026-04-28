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

Character options (`role`, `race`, `gender`, `align`) are validated against NetHack's constraint tables before booting WASM. Invalid combinations (e.g. Elf Healer, Chaotic Knight) throw an `Error` with descriptive messages instead of silently falling back to defaults. Use `validateCharacterOptions()` to check before calling `start()`, or use the `getValid*` helpers to build a UI that only offers legal choices.

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
game.selectMenuItems([ids]);  // select items by accelerator char or identifier
game.selectMenuItem(id);      // select a single item
game.dismissMenu();           // close without selecting (ESC)
```

Menu items from the WASM engine sometimes lack accelerator keys (e.g. the container loot options menu). The API auto-assigns sequential keys (`a`, `b`, `c`...) to any selectable item without one, so frontends can always use character-based selection via `handleKey()`. The original `identifier` values remain available on the item objects for programmatic use.

Invalid selections (values that don't match any item's accelerator or identifier) are dropped before reaching the WASM engine and emit a `warning` event with `type: "invalidMenuSelection"`.

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

### Character Identity

```js
game.playerName  // "Rodney" — the name as known by the C engine (from plname)
game.role        // "Valkyrie" — role/class name (from pl_character)
game.race        // "Human" — race name (from flags.initrace)
game.gender      // "Female" — gender (from flags.initgend)
```

These read live WASM memory via `nethackGlobal.globals`. Available after `start()` resolves.

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

3.7 adds: `"bareh"`, `"busy"`, `"elf_iron"`, `"glowhands"`, `"grab"`, `"held"`, `"holding"`, `"icy"`, `"inlava"`, `"parlyz"`, `"sleeping"`, `"slippery"`, `"submerged"`, `"tethered"`, `"trapped"`, `"unconsc"`, `"woundedl"`

### Properties (Intrinsics & Extrinsics)

The full player property system — resistances, senses, movement modes, and more. These go far beyond conditions, covering everything NetHack tracks in `u.uprops[]`.

```js
// All properties with full detail
game.properties   // Map<string, { index, intrinsic, extrinsic, blocked, active }>

game.properties.get("FIRE_RES")
// {
//   index: 1,           — enum index in u.uprops[]
//   intrinsic: 67108864, — bitmask: FROMOUTSIDE, FROMRACE, timeout, etc.
//   extrinsic: 0,       — bitmask: which worn item slots grant this
//   blocked: 0,         — bitmask: which items/situations block this
//   active: true,       — true when (intrinsic || extrinsic) && !blocked
// }

// Convenience: just the active property names
game.activeProperties   // Set<string> — e.g. Set { "FIRE_RES", "SEE_INVIS", "STEALTH" }
```

Property names match the C enum: `FIRE_RES`, `COLD_RES`, `SLEEP_RES`, `DISINT_RES`, `SHOCK_RES`, `POISON_RES`, `ACID_RES`, `STONE_RES`, `DRAIN_RES`, `SICK_RES`, `INVULNERABLE`, `ANTIMAGIC`, `STUNNED`, `CONFUSION`, `BLINDED`, `DEAF`, `SICK`, `STONED`, `STRANGLED`, `VOMITING`, `GLIB`, `SLIMED`, `HALLUC`, `HALLUC_RES`, `FUMBLING`, `WOUNDED_LEGS`, `SLEEPY`, `HUNGER`, `SEE_INVIS`, `TELEPAT`, `WARNING`, `WARN_OF_MON`, `WARN_UNDEAD`, `SEARCHING`, `CLAIRVOYANT`, `INFRAVISION`, `DETECT_MONSTERS`, `ADORNED`, `INVIS`, `DISPLACED`, `STEALTH`, `AGGRAVATE_MONSTER`, `CONFLICT`, `JUMPING`, `TELEPORT`, `TELEPORT_CONTROL`, `LEVITATION`, `FLYING`, `WWALKING`, `SWIMMING`, `MAGICAL_BREATHING`, `PASSES_WALLS`, `SLOW_DIGESTION`, `HALF_SPDAM`, `HALF_PHDAM`, `REGENERATION`, `ENERGY_REGENERATION`, `PROTECTION`, `PROT_FROM_SHAPE_CHANGERS`, `POLYMORPH`, `POLYMORPH_CONTROL`, `UNCHANGING`, `FAST`, `REFLECTING`, `FREE_ACTION`, `FIXED_ABIL`, `LIFESAVED`

3.7 also includes `BLND_RES`.

These read live WASM memory — call during input prompts or after events when the game is suspended.

### Warned Monsters

When `WARN_OF_MON` is active, `warnedMonsters` tells you *what* the player is warned about:

```js
game.warnedMonsters   // string[] — e.g. ["orcs"] or ["humans", "elves"]
```

Sources include artifact warnings (Sting/Orcrist → orcs, Grimtooth → elves) and polymorph-based awareness (vampire → humans + elves, purple worm → shriekers). Returns an empty array when no warn targets are set.

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
// [{ x, y, monsterIndex, name, isPet, isRidden, isDetected, m_id?, givenName? }, ...]
// m_id: unique monster ID from the C engine — stable across turns within a game session
// givenName: player-assigned or role-default name (e.g. pet name)
```

### Visible Items & Features

Updated on each `mapUpdate` — no need to scan the full map yourself:

```js
// Items on the floor (objects, statues, corpses) — includes full piles
game.visibleItems
// [{ x, y, ch, color, glyph, tileType, tileLabel, category, obscured, o_id, nameKnown, name? }, ...]
//   tileType: "object", "statue", or "corpse"
//   tileLabel: descriptive name for statues/corpses (e.g. "goblin corpse")
//   category: item category string (e.g. "weapon", "potion")
//   o_id: unique object identity from C engine (unsigned int, never reused
//         within a game session). Use to track item identity across turns
//         even when the display name changes (e.g. "a weapon" → "11 arrows").
//         0 for glyph-only entries before the floor scan backfills.
//   nameKnown: true if the game has revealed this item's specific name to the
//         player (stepped on it, picked it up, nearby farlook, etc.). When false,
//         the name may be generic; when true, it's the real identity.
//   name: player-perceived item name from the C engine (e.g. "a large box",
//         "11 arrows", "a scroll labeled ZELGO MER"). Equivalent to what
//         the farlook command (;) would show. Absent for glyph-only entries
//         and remembered items.
//   obscured: true if hidden under another glyph (monster/player on top, or
//             buried in a pile beneath the top item). Multiple items at the
//             same position appear as separate entries — the pile top has
//             obscured=false (unless a monster/player is on top), and items
//             beneath have obscured=true.

// Notable features (stairs, fountains, altars, etc.)
game.visibleFeatures
// [{ x, y, ch, color, glyph, name, obscured }, ...]
//   name: human-readable (e.g. "staircase down", "fountain or sink", "staircase")
//   obscured: true if hidden under another glyph (e.g. player on staircase)
//   Note: features beneath monsters are detected via dungeon terrain scan
//   (get_levl_typ + get_stair_direction + get_feature_color), so even
//   the staircase at spawn is reported with correct name, direction, and color.
```

### Vision & Terrain Queries

Direct queries into the WASM engine's dungeon and vision data — useful for AI narration, accessibility, or any frontend that needs spatial awareness beyond the glyph map.

#### Bulk terrain dump (preferred)

```js
game.getTerrainMap()
// Returns { chars, colors, typs, visions, lits, roomNos } or null if unavailable.
// Each field is a parallel array of length COLNO * ROWNO (1680), row-major,
// indexed as `y * COLNO + x`. All come from one bulk WASM call:
//
//   chars   — string of 1680 chars: the terrain glyph at each tile
//             (back_to_glyph — entity-stripped, no monsters/items/effects)
//   colors  — Uint8Array: NetHack color enum (0-15) per tile
//   typs    — Uint8Array: terrain enum from levl[x][y].typ (e.g. ROOM, DOOR, FOUNTAIN)
//             use game.constants.LEVL_TYP to map values to names
//   visions — Uint8Array: vision flags (COULD_SEE=0x1 | IN_SIGHT=0x2 | TEMP_LIT=0x4)
//   lits    — Uint8Array: 1 if lit, 0 if dark
//   roomNos — Uint8Array: room number 0-63 (0 = corridor / no room)
//
// Stable across entity movement; only changes on real terrain changes
// (vision expansion, doors opening, level transitions, etc.).
// One FFI call replaces ~6 separate per-tile queries — much faster for
// frontends that need to scan the whole map.
```

#### Per-tile queries (one-off / fallback)

```js
// Vision state at a map position (bitmask)
game.getVisionAt(x, y)
// Returns: COULD_SEE (0x1) | IN_SIGHT (0x2) | TEMP_LIT (0x4)
//   COULD_SEE: has line-of-sight (even if dark)
//   IN_SIGHT:  actually visible (lit + LOS)
//   TEMP_LIT:  temporarily illuminated by a light source
// Returns 0 for out-of-bounds.

// Lighting
game.getLevelLit(x, y)    // 1 = lit room, 0 = dark, -1 = unseen/OOB

// Room number (from levl[x][y].roomno)
game.getLevelRoomNo(x, y) // 0-63 room ID, -1 = unseen/OOB

// Terrain type (from levl[x][y].typ)
game.getLevelTyp(x, y)    // enum value, -1 = unseen/OOB
                          // e.g. ROOM=25, CORR=24, DOOR=23 (3.7)
                          //      ROOM=24, CORR=23, DOOR=22 (3.6.7)

// Human-readable tile description (synchronous)
game.lookAt(x, y)         // e.g. "floor of a room", "an open door", "a fountain"
```

For scanning the whole map, prefer `getTerrainMap()` — it returns all the
above data in one call instead of doing thousands of individual FFI calls.

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
| `menuOpen` | `(menu)` | Menu opened. `menu: { windowId, prompt, selectionMode, items }`. Items have `{ identifier, accelerator, text, ... }` — accelerators are auto-assigned for items that lack them. |
| `textWindow` | `(lines)` | Text window displayed (array of strings) |
| `phaseChange` | `(phase)` | Game phase changed |
| `gameOver` | `({ how, when })` | Game ended |
| `savesSynced` | — | Save files successfully synced to IndexedDB |
| `inputBlocked` | `({ reason, ... })` | Input was dropped because a menu (or other prompt) is blocking. Only emitted when `autoDismissMenus` is `false`. |
| `warning` | `({ type, message, ... })` | Non-fatal issue detected. `type: "invalidMenuSelection"` when a menu selection doesn't match any item (dropped to prevent WASM crash). |
| `rawCallback` | `(name, args)` | Every WASM window-port callback (escape hatch for anything not covered above) |

## Character Constraints

Helpers for validating NetHack's role/race/alignment/gender restrictions. Use these to build dynamic character creation UIs that prevent invalid combinations.

```js
import {
    ROLE_CONSTRAINTS,       // { arc: { label, races, aligns }, hea: { ... }, ... }
    RACE_CONSTRAINTS,       // { hum: { label, aligns }, elf: { ... }, ... }
    getValidRaces,          // (role?) → RaceCode[]
    getValidAlignments,     // (role?, race?) → AlignCode[]
    getValidGenders,        // (role?) → GenderCode[]
    getValidRoles,          // ({ race?, align?, gender? }) → RoleCode[]
    validateCharacterOptions, // ({ role?, race?, align?, gender? }) → { valid, errors[] }
} from "@neth4ck/api";
```

### Filtering Options

Each helper returns the valid codes given the current selection state:

```js
getValidRaces("hea");              // ["hum", "gno"] — Healer can only be Human or Gnome
getValidAlignments("hea");         // ["neu"]        — Healer must be Neutral
getValidAlignments("ran", "orc");  // ["cha"]        — Ranger+Orc narrows to Chaotic
getValidGenders("val");            // ["fem"]        — Valkyrie is female-only
getValidRoles({ race: "elf" });    // ["pri", "ran", "wiz"] — only these roles allow Elf
```

### Validation

`validateCharacterOptions()` checks a full combination and returns descriptive errors:

```js
validateCharacterOptions({ role: "hea", race: "elf", align: "cha" });
// {
//   valid: false,
//   errors: [
//     "Healer cannot be Elf",
//     "Healer cannot be Chaotic",
//   ]
// }

validateCharacterOptions({ role: "val", race: "dwa", align: "law", gender: "fem" });
// { valid: true, errors: [] }
```

`start()` calls this internally and throws if the combination is invalid — no more silent fallback to random characters.

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

    // Character constraints
    ROLE_CONSTRAINTS,   // { arc: { label, races, aligns }, ... }
    RACE_CONSTRAINTS,   // { hum: { label, aligns }, ... }
    ALL_ROLES,          // ["arc", "bar", "cav", ...]
    ALL_RACES,          // ["hum", "elf", "dwa", "gno", "orc"]
    ALL_ALIGNS,         // ["law", "neu", "cha"]
    ALL_GENDERS,        // ["mal", "fem"]

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
