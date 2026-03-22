let _module = null;

export function setModule(mod) {
    _module = mod;
}

export function decodeArgs(name, args) {
    switch (name) {
        case "shim_create_nhwindow":
            args[0] = globalThis.nethackGlobal.constants.WIN_TYPE[args[0]];
            break;
        case "shim_status_update":
            args[0] = globalThis.nethackGlobal.constants.STATUS_FIELD[args[0]];
            if (
                args[0] !== "BL_CONDITION" &&
                args[0] !== "BL_RESET" &&
                args[0] !== "BL_FLUSH" &&
                args[0] !== "BL_CHARACTERISTICS" &&
                args[1]
            ) {
                args[1] = getArg(name, args[1], "s");
            } else {
                args[1] = getArg(name, args[1], "p");
            }
            break;
        case "shim_display_file":
            args[1] = !!args[1];
            break;
        case "shim_display_nhwindow":
            args[0] = decodeWindow(args[0]);
            args[1] = !!args[1];
            break;
        case "shim_getmsghistory":
            args[0] = !!args[0];
            break;
        case "shim_putmsghistory":
            args[1] = !!args[1];
            break;
        case "shim_status_enablefield":
            args[3] = !!args[3];
            break;
        case "shim_add_menu":
        case "shim_putstr":
        case "shim_clear_nhwindow":
        case "shim_destroy_nhwindow":
        case "shim_curs":
        case "shim_start_menu":
        case "shim_end_menu":
        case "shim_print_glyph":
            args[0] = decodeWindow(args[0]);
            break;
        case "shim_select_menu":
            args[0] = decodeWindow(args[0]);
            args[1] = decodeSelected(args[1]);
            break;
    }
}

function decodeWindow(winid) {
    const { WIN_MAP, WIN_INVEN, WIN_STATUS, WIN_MESSAGE } = globalThis.nethackGlobal.globals;
    switch (winid) {
        case WIN_MAP:
            return "WIN_MAP";
        case WIN_MESSAGE:
            return "WIN_MESSAGE";
        case WIN_STATUS:
            return "WIN_STATUS";
        case WIN_INVEN:
            return "WIN_INVEN";
        default:
            return winid;
    }
}

function decodeSelected(how) {
    const { PICK_NONE, PICK_ONE, PICK_ANY } = globalThis.nethackGlobal.constants.MENU_SELECT;
    switch (how) {
        case PICK_NONE:
            return "PICK_NONE";
        case PICK_ONE:
            return "PICK_ONE";
        case PICK_ANY:
            return "PICK_ANY";
        default:
            return how;
    }
}

function getArg(name, ptr, type) {
    const { getPointerValue } = globalThis.nethackGlobal.helpers;
    if (type === "o") {
        return ptr;
    }
    // For string values, the pointer already points to the string data —
    // pass it directly. For other types, dereference first to get the
    // value stored at the pointer address.
    if (type === "s") {
        return getPointerValue(name, ptr, type);
    }
    return getPointerValue(name, _module.getValue(ptr, "*"), type);
}
