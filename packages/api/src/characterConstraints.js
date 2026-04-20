// ── Character constraint tables for NetHack ──
// These define which role/race/alignment/gender combinations are valid.
// Constraints are identical for 3.6.7 and 3.7.

/**
 * @typedef {"arc"|"bar"|"cav"|"hea"|"kni"|"mon"|"pri"|"ran"|"rog"|"sam"|"tou"|"val"|"wiz"} RoleCode
 * @typedef {"hum"|"elf"|"dwa"|"gno"|"orc"} RaceCode
 * @typedef {"law"|"neu"|"cha"} AlignCode
 * @typedef {"mal"|"fem"} GenderCode
 */

/** Role constraints: allowed races and alignments per role */
export const ROLE_CONSTRAINTS = {
    arc: { label: "Archeologist", races: ["hum", "dwa", "gno"], aligns: ["law", "neu"] },
    bar: { label: "Barbarian",    races: ["hum", "orc"],       aligns: ["neu", "cha"] },
    cav: { label: "Caveman",      races: ["hum", "dwa", "gno"], aligns: ["law", "neu"] },
    hea: { label: "Healer",       races: ["hum", "gno"],       aligns: ["neu"] },
    kni: { label: "Knight",       races: ["hum"],              aligns: ["law"] },
    mon: { label: "Monk",         races: ["hum"],              aligns: ["law", "neu", "cha"] },
    pri: { label: "Priest",       races: ["hum", "elf"],       aligns: ["law", "neu", "cha"] },
    ran: { label: "Ranger",       races: ["hum", "elf", "gno", "orc"], aligns: ["neu", "cha"] },
    rog: { label: "Rogue",        races: ["hum", "orc"],       aligns: ["cha"] },
    sam: { label: "Samurai",      races: ["hum"],              aligns: ["law"] },
    tou: { label: "Tourist",      races: ["hum"],              aligns: ["neu"] },
    val: { label: "Valkyrie",     races: ["hum", "dwa"],       aligns: ["law", "neu"], genders: ["fem"] },
    wiz: { label: "Wizard",       races: ["hum", "elf", "gno", "orc"], aligns: ["neu", "cha"] },
};

/** Race constraints: allowed alignments per race (narrows role constraints further) */
export const RACE_CONSTRAINTS = {
    hum: { label: "Human",  aligns: ["law", "neu", "cha"] },
    elf: { label: "Elf",    aligns: ["cha"] },
    dwa: { label: "Dwarf",  aligns: ["law"] },
    gno: { label: "Gnome",  aligns: ["neu"] },
    orc: { label: "Orc",    aligns: ["cha"] },
};

/** All valid roles */
export const ALL_ROLES = Object.keys(ROLE_CONSTRAINTS);
/** All valid races */
export const ALL_RACES = Object.keys(RACE_CONSTRAINTS);
/** All valid alignments */
export const ALL_ALIGNS = ["law", "neu", "cha"];
/** All valid genders */
export const ALL_GENDERS = ["mal", "fem"];

/**
 * Get valid races for a given role.
 * @param {RoleCode} [role] - If undefined, returns all races.
 * @returns {RaceCode[]}
 */
export function getValidRaces(role) {
    if (!role) return [...ALL_RACES];
    const constraint = ROLE_CONSTRAINTS[role];
    if (!constraint) return [...ALL_RACES];
    return [...constraint.races];
}

/**
 * Get valid alignments for a given role + race combination.
 * The result is the intersection of role-allowed and race-allowed alignments.
 * @param {RoleCode} [role]
 * @param {RaceCode} [race]
 * @returns {AlignCode[]}
 */
export function getValidAlignments(role, race) {
    let aligns = [...ALL_ALIGNS];

    if (role) {
        const rc = ROLE_CONSTRAINTS[role];
        if (rc) aligns = aligns.filter(a => rc.aligns.includes(a));
    }

    if (race) {
        const raceC = RACE_CONSTRAINTS[race];
        if (raceC) aligns = aligns.filter(a => raceC.aligns.includes(a));
    }

    return aligns;
}

/**
 * Get valid genders for a given role.
 * @param {RoleCode} [role]
 * @returns {GenderCode[]}
 */
export function getValidGenders(role) {
    if (!role) return [...ALL_GENDERS];
    const constraint = ROLE_CONSTRAINTS[role];
    if (!constraint) return [...ALL_GENDERS];
    return constraint.genders ? [...constraint.genders] : [...ALL_GENDERS];
}

/**
 * Get valid roles for a given race/alignment/gender (reverse lookup).
 * @param {{ race?: RaceCode, align?: AlignCode, gender?: GenderCode }} [filters]
 * @returns {RoleCode[]}
 */
export function getValidRoles(filters = {}) {
    const { race, align, gender } = filters;
    return ALL_ROLES.filter(roleCode => {
        const rc = ROLE_CONSTRAINTS[roleCode];
        if (race && !rc.races.includes(race)) return false;
        if (align && !rc.aligns.includes(align)) return false;
        if (gender && rc.genders && !rc.genders.includes(gender)) return false;
        // Also check race-alignment intersection
        if (race && align) {
            const raceC = RACE_CONSTRAINTS[race];
            if (raceC && !raceC.aligns.includes(align)) return false;
        }
        return true;
    });
}

/**
 * Validate a full character selection. Returns an object with `valid` boolean
 * and `errors` array describing any constraint violations.
 * @param {{ role?: RoleCode, race?: RaceCode, align?: AlignCode, gender?: GenderCode }} options
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateCharacterOptions({ role, race, align, gender } = {}) {
    const errors = [];

    if (role && !ROLE_CONSTRAINTS[role]) {
        errors.push(`Unknown role: "${role}"`);
        return { valid: false, errors };
    }
    if (race && !RACE_CONSTRAINTS[race]) {
        errors.push(`Unknown race: "${race}"`);
        return { valid: false, errors };
    }
    if (align && !ALL_ALIGNS.includes(align)) {
        errors.push(`Unknown alignment: "${align}"`);
        return { valid: false, errors };
    }
    if (gender && !ALL_GENDERS.includes(gender)) {
        errors.push(`Unknown gender: "${gender}"`);
        return { valid: false, errors };
    }

    if (role && race) {
        const rc = ROLE_CONSTRAINTS[role];
        if (!rc.races.includes(race)) {
            errors.push(`${rc.label} cannot be ${RACE_CONSTRAINTS[race].label}`);
        }
    }

    if (role && align) {
        const rc = ROLE_CONSTRAINTS[role];
        if (!rc.aligns.includes(align)) {
            const alignLabel = { law: "Lawful", neu: "Neutral", cha: "Chaotic" }[align];
            errors.push(`${rc.label} cannot be ${alignLabel}`);
        }
    }

    if (race && align) {
        const raceC = RACE_CONSTRAINTS[race];
        if (!raceC.aligns.includes(align)) {
            const alignLabel = { law: "Lawful", neu: "Neutral", cha: "Chaotic" }[align];
            errors.push(`${raceC.label} cannot be ${alignLabel}`);
        }
    }

    if (role && gender) {
        const rc = ROLE_CONSTRAINTS[role];
        if (rc.genders && !rc.genders.includes(gender)) {
            const genderLabel = { mal: "Male", fem: "Female" }[gender];
            errors.push(`${rc.label} cannot be ${genderLabel}`);
        }
    }

    return { valid: errors.length === 0, errors };
}
