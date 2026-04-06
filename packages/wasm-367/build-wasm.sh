#!/bin/bash
# Build NetHack 3.6.7 for WebAssembly (WASM) using Emscripten.
#
# Single-hints-file build using sys/unix/hints/linux-wasm throughout.
# All Makefiles get the same CFLAGS (including -DNOMAIL, -DSHIM_GRAPHICS, etc.)
# so that makedefs generates headers (onames.h, pm.h) with indices that match
# the WASM game build. Native utilities are built by overriding CC=cc.
#
# Build phases:
#   Phase 1: Build native utilities (makedefs, lev_comp, dgn_comp, dlb)
#            and generate data files, using CC=cc override.
#   Phase 2: Prepare WASM data directory (nhdat, sysconf, etc.).
#   Phase 3: Build the game with emcc (the default CC from hints).
#
# Prerequisites:
#   - Emscripten SDK installed and activated (emcc, emar on PATH)
#   - Standard build tools (gcc/cc, make, lex, yacc/bison)
#
# Usage:
#   ./build-wasm.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NH="$SCRIPT_DIR/NetHack"

# Check for emscripten
if ! command -v emcc &>/dev/null; then
    echo "Error: emcc not found. Please install and activate the Emscripten SDK."
    echo "  https://emscripten.org/docs/getting_started/downloads.html"
    exit 1
fi

# Check for submodule
if [ ! -f "$NH/sys/unix/setup.sh" ]; then
    echo "Error: NetHack submodule not initialized."
    echo "  Run: git submodule update --init packages/wasm-367/NetHack"
    exit 1
fi

echo "=== NetHack 3.6.7 WASM Build ==="
echo "Source: $NH"
echo ""

# ------------------------------------------------------------------
# Setup: Generate all Makefiles from the WASM hints file.
# ------------------------------------------------------------------
echo "--- Setup: Generating Makefiles from WASM hints ---"
cd "$NH"
sh sys/unix/setup.sh sys/unix/hints/linux-wasm
echo "  done."

# ------------------------------------------------------------------
# Phase 1: Build native utilities and generate data files.
# ------------------------------------------------------------------
echo ""
echo "--- Phase 1: Building native utilities and data ---"
NATIVE_OVERRIDES="CC=cc LINK=cc LFLAGS="

echo "  Cleaning stale object files..."
rm -f "$NH/src/"*.o "$NH/util/"*.o

echo "  Building utilities..."
make -C util $NATIVE_OVERRIDES makedefs lev_comp dgn_comp dlb tilemap

echo "  Generating tile.c..."
make -C util $NATIVE_OVERRIDES ../src/tile.c

echo "  Generating data files..."
make -C dat $NATIVE_OVERRIDES

echo "  Building DLB archive..."
make check-dlb $NATIVE_OVERRIDES

echo "  Native build complete."

# ------------------------------------------------------------------
# Phase 2: Prepare WASM data directory
# ------------------------------------------------------------------
echo ""
echo "--- Phase 2: Preparing WASM data directory ---"

WASM_DATA="$NH/wasm-data"
rm -rf "$WASM_DATA"
mkdir -p "$WASM_DATA"

if [ -f "$NH/dat/nhdat" ]; then
    cp "$NH/dat/nhdat" "$WASM_DATA/nhdat"
    echo "  nhdat: $(wc -c < "$WASM_DATA/nhdat") bytes"
else
    echo "Error: nhdat not found in dat/. DLB build may have failed."
    exit 1
fi

cp "$NH/sys/libnh/sysconf" "$WASM_DATA/sysconf"
touch "$WASM_DATA/perm"
touch "$WASM_DATA/record"
touch "$WASM_DATA/logfile"
touch "$WASM_DATA/xlogfile"

echo "  WASM data directory ready: $WASM_DATA"

# ------------------------------------------------------------------
# Phase 3: Build the WASM game
# ------------------------------------------------------------------
echo ""
echo "--- Phase 3: Building WASM game ---"

# Write no-op rules to a separate file (idempotent: overwritten each build)
cat > "$NH/src/Makefile.wasm-noop" << 'NOOP_RULES'
# No-op rules to prevent src/Makefile from rebuilding native utilities with emcc.
# Written by build-wasm.sh; included by src/Makefile via -include directive.
../util/makedefs: ;
../util/lev_comp: ;
../util/dgn_comp: ;
../util/dlb: ;
../include/onames.h: ;
../include/pm.h: ;
../include/vis_tab.h: ;
vis_tab.c: ;
../include/date.h: ;
tile.c: ;
NOOP_RULES

# Append -include directive only if not already present (idempotent)
if ! grep -q 'Makefile.wasm-noop' "$NH/src/Makefile"; then
    echo '-include Makefile.wasm-noop' >> "$NH/src/Makefile"
fi

echo "  Cleaning old object files..."
rm -f "$NH/src/"*.o "$NH/src/Sysunix" "$NH/src/nethack" "$NH/src/nethack.js" "$NH/src/nethack.wasm"

# Workaround WSL clock skew: source files edited from Windows have Windows
# timestamps that may not align with the WSL clock, causing make to either
# warn about clock skew or silently skip linking. Touch all sources to give
# them a current WSL timestamp before building.
echo "  Touching sources to fix WSL clock skew..."
find "$NH" \( -name '*.c' -o -name '*.h' -o -name 'Makefile*' \) -exec touch {} + 2>/dev/null || true

echo "  Compiling with emcc..."
make -C src

echo ""
echo "=== Build complete ==="

# Copy output to package build/ directory
mkdir -p "$SCRIPT_DIR/build"
cp "$NH/src/nethack.js" "$SCRIPT_DIR/build/nethack.js"
cp "$NH/src/nethack.wasm" "$SCRIPT_DIR/build/nethack.wasm"

echo "Output copied to $SCRIPT_DIR/build/"
ls -lh "$SCRIPT_DIR/build/nethack.js" "$SCRIPT_DIR/build/nethack.wasm"
