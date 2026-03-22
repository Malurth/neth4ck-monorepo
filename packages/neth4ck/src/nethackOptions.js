const optionMap = new Map([
    ["autoquiver", "boolean"],
    ["name", "string"],
    ["perm_invent", "boolean"],
]);

export function createNethackOptions(opt) {
    const optStr = [];
    for (const key in opt) {
        if (!optionMap.has(key)) {
            throw new TypeError(`NetHack option not recognized: ${key}`);
        }

        const type = optionMap.get(key);
        checkType(key, opt[key], type);
        switch (type) {
            case "string":
                optStr.push(`${key}:${opt[key]}`);
                break;
            case "boolean":
                optStr.push(`${opt[key] ? "" : "!"}${key}`);
                break;
            default:
                throw new Error(`unknown type: ${type}`);
        }
    }

    return optStr.join(",");
}

function checkType(key, val, type) {
    if (typeof val !== type) {
        throw new Error(`Expected NetHack option '${key}' to be ${type}`);
    }
}
