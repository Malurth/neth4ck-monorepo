export const MAP_WIDTH = 80;
export const MAP_HEIGHT = 21;

export const DIRECTIONS = {
    n: "k",
    s: "j",
    e: "l",
    w: "h",
    ne: "u",
    nw: "y",
    se: "n",
    sw: "b",
    up: "<",
    down: ">",
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
