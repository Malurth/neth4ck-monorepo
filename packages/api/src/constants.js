export const MAP_WIDTH = 80;
export const MAP_HEIGHT = 21;

export const DIRECTIONS = {
    north: "k",
    south: "j",
    east: "l",
    west: "h",
    northeast: "u",
    northwest: "y",
    southeast: "n",
    southwest: "b",
    up: "<",
    down: ">",
    self: ".",
};

export const KEY_CODES = {
    ESC: 27,
    SPACE: 32,
    ENTER: 13,
    TAB: 9,
};

// ── Status field internals (used by callbackRouter) ──────────

// Status field name → status object key
export const STATUS_FIELD_MAP = {
    BL_TITLE: "title",
    BL_STR: "str",
    BL_DX: "dx",
    BL_CO: "co",
    BL_IN: "in",
    BL_WI: "wi",
    BL_CH: "ch",
    BL_ALIGN: "align",
    BL_SCORE: "score",
    BL_CAP: "carrying",
    BL_GOLD: "gold",
    BL_ENE: "energy",
    BL_ENEMAX: "energyMax",
    BL_XP: "xpLevel",
    BL_AC: "ac",
    BL_HD: "hd",
    BL_TIME: "time",
    BL_HUNGER: "hunger",
    BL_HP: "hp",
    BL_HPMAX: "hpMax",
    BL_LEVELDESC: "levelDesc",
    BL_EXP: "exp",
};

// Fields where the value is always a string (not parsed as number)
export const STRING_STATUS_FIELDS = new Set([
    "title",
    "str",
    "align",
    "carrying",
    "hunger",
    "levelDesc",
]);

// Condition bitmask → human-readable name
export const CONDITION_NAMES = {
    0x00000001: "stone",
    0x00000002: "slime",
    0x00000004: "strngl",
    0x00000008: "foodpois",
    0x00000010: "termill",
    0x00000020: "blind",
    0x00000040: "deaf",
    0x00000080: "stun",
    0x00000100: "conf",
    0x00000200: "hallu",
    0x00000400: "lev",
    0x00000800: "fly",
    0x00001000: "ride",
};

// ── Frontend-facing constants ────────────────────────────────

/** All possible status field keys on state.status */
export const STATUS_FIELDS = Object.values(STATUS_FIELD_MAP);

/** All possible condition names that can appear in state.conditions */
export const CONDITIONS = Object.values(CONDITION_NAMES);

/** Text attribute constants (matches NetHack ATR_* values) */
export const ATTR = {
    NONE: 0,
    BOLD: 1,
    DIM: 2,
    ULINE: 4,
    BLINK: 5,
    INVERSE: 7,
};

/** Color constants (matches NetHack CLR_* values) */
export const COLORS = {
    BLACK: 0,
    RED: 1,
    GREEN: 2,
    BROWN: 3,
    BLUE: 4,
    MAGENTA: 5,
    CYAN: 6,
    GRAY: 7,
    NO_COLOR: 8,
    ORANGE: 9,
    BRIGHT_GREEN: 10,
    YELLOW: 11,
    BRIGHT_BLUE: 12,
    BRIGHT_MAGENTA: 13,
    BRIGHT_CYAN: 14,
    WHITE: 15,
};

/** Menu selection modes */
export const MENU_MODE = {
    PICK_NONE: "PICK_NONE",
    PICK_ONE: "PICK_ONE",
    PICK_ANY: "PICK_ANY",
};

/** Game phases */
export const PHASE = {
    INIT: "init",
    CHAR_SELECT: "charSelect",
    PLAYING: "playing",
    GAME_OVER: "gameOver",
};

/** Input prompt types */
export const INPUT_TYPE = {
    KEY: "key",
    POSKEY: "poskey",
    YN: "yn",
    LINE: "line",
    MENU: "menu",
    EXT_CMD: "extcmd",
    CHAR_SELECT: "charSelect",
};

/** Notable map feature characters → human-readable names */
export const FEATURE_NAMES = {
    "{": "fountain or sink",
    "\\": "grave or throne",
    "_": "altar",
    "<": "staircase up",
    ">": "staircase down",
};

/** Item display character → category name */
export const ITEM_CATEGORY_BY_CHAR = {
    ")": "weapon",
    "[": "armor",
    "=": "ring",
    '"': "amulet",
    "(": "tool",
    "%": "food",
    "!": "potion",
    "?": "scroll",
    "+": "spellbook",
    "/": "wand",
    "*": "gem",
    "$": "gold",
    "`": "rock",
};

/** Object class number → string name */
export const OBJ_CLASS_NAMES = {
    1: "random",
    2: "weapon",
    3: "armor",
    4: "ring",
    5: "amulet",
    6: "tool",
    7: "food",
    8: "potion",
    9: "scroll",
    10: "spellbook",
    11: "wand",
    12: "coin",
    13: "gem",
    14: "rock",
    15: "ball",
    16: "chain",
    17: "venom",
};

/** Named action → raw NetHack key sequence */
export const ACTION_KEYS = {
    // Basic
    wait: ["."], pickup: [","], go_down: [">"], go_up: ["<"],
    more: [" "], search: ["s"], inventory: ["i"],
    // Interaction
    apply: ["a"], cast: ["Z"], close: ["c"], engrave: ["E"],
    fire: ["f"], open: ["o"], kick: ["\x04"],
    // Inventory verbs (names match stateManager verb methods)
    eat: ["e"], drink: ["q"], read: ["r"], zap: ["z"],
    wear: ["W"], wield: ["w"], putOn: ["P"], takeOff: ["T"],
    drop: ["d"], throw: ["t"], quiver: ["Q"],
    // Utility
    swap: ["x"], look: [":"], autopickup: ["@"], call: ["C"],
    pay: ["p"], remove: ["R"], twoweapon: ["X"],
    takeoffall: ["A"], droptype: ["D"], fight: ["F"],
    esc: ["\x1b"],
};

/** Extended commands available via #name\n */
export const EXTENDED_COMMANDS = new Set([
    "chat", "dip", "enhance", "force", "invoke", "jump", "monster",
    "loot", "pray", "quit", "rub", "save", "sit", "turn", "untrap",
    "wipe", "offer", "ride", "tip",
]);

/**
 * Terrain type name → human-readable feature name.
 * Keys are the string names from LEVL_TYP constants exported by WASM
 * (e.g. LEVL_TYP[26] = "STAIRS" in 3.7).
 * Used by the terrain scanner to identify features beneath other glyphs.
 */
export const TERRAIN_TYPE_NAMES = {
    STAIRS: "staircase",
    LADDER: "ladder",
    FOUNTAIN: "fountain",
    THRONE: "throne",
    SINK: "sink",
    GRAVE: "grave",
    ALTAR: "altar",
    POOL: "pool",
    MOAT: "moat",
    LAVAPOOL: "lava pool",
    IRONBARS: "iron bars",
    TREE: "tree",
    ICE: "ice",
};

/**
 * Terrain type name → display character (best guess without glyph data).
 * Used when terrain scanner creates feature entries from levl[x][y].typ.
 */
export const TERRAIN_TYPE_CHARS = {
    STAIRS: "<",  // direction unknown from typ alone; < is more common at spawn
    LADDER: "<",
    FOUNTAIN: "{",
    THRONE: "\\",
    SINK: "{",
    GRAVE: "|",
    ALTAR: "_",
    POOL: "}",
    MOAT: "}",
    LAVAPOOL: "}",
    IRONBARS: "#",
    TREE: "#",
    ICE: ".",
};

/**
 * Terrain type name → NetHack display color (CLR_* values from color.h).
 * Used when terrain scanner creates feature entries from levl[x][y].typ.
 */
