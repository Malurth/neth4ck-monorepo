#!/bin/bash
# Build NetHack 3.7 for WebAssembly (WASM) using Emscripten.
#
# NetHack 3.7 has built-in WASM cross-compilation support via CROSS_TO_WASM=1.
# This script wraps the standard build process.
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
    echo "  Run: git submodule update --init packages/wasm-37/NetHack"
    exit 1
fi

echo "=== NetHack 3.7 WASM Build ==="
echo "Source: $NH"
echo ""

# ------------------------------------------------------------------
# Setup: Generate Makefiles from hints
# ------------------------------------------------------------------
echo "--- Setup: Generating Makefiles ---"
cd "$NH"
cd sys/unix && ./setup.sh hints/linux.370 && cd ../..
echo "  done."

# ------------------------------------------------------------------
# Fetch Lua dependency (required for NetHack 3.7)
# ------------------------------------------------------------------
echo ""
echo "--- Fetching Lua ---"
make fetch-lua
echo "  done."

# ------------------------------------------------------------------
# Build WASM
# ------------------------------------------------------------------
echo ""
echo "--- Building WASM ---"
# Workaround WSL clock skew: source files edited from Windows have Windows
# timestamps that may not align with the WSL clock, causing make to either
# warn about clock skew or silently skip linking. Touch all sources to give
# them a current WSL timestamp before building.
find "$NH" \( -name '*.c' -o -name '*.h' -o -name 'Makefile*' \) -exec touch {} + 2>/dev/null || true
make CROSS_TO_WASM=1 all

echo ""
echo "=== Build complete ==="

# Copy output to package build/ directory
if [ -f "$NH/targets/wasm/nethack.js" ] && [ -f "$NH/targets/wasm/nethack.wasm" ]; then
    mkdir -p "$SCRIPT_DIR/build"
    cp "$NH/targets/wasm/nethack.js" "$SCRIPT_DIR/build/nethack.js"
    cp "$NH/targets/wasm/nethack.wasm" "$SCRIPT_DIR/build/nethack.wasm"
    echo "Output copied to $SCRIPT_DIR/build/"
    ls -lh "$SCRIPT_DIR/build/nethack.js" "$SCRIPT_DIR/build/nethack.wasm"
else
    echo "Error: Expected output files not found in $NH/targets/wasm/"
    ls -lh "$NH/targets/wasm/"*.js "$NH/targets/wasm/"*.wasm 2>/dev/null || true
    exit 1
fi
