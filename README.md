# neth4ck-monorepo

A fork of [apowers313/neth4ck-monorepo](https://github.com/apowers313/neth4ck-monorepo) focused on providing a high-level API layer for building NetHack frontends. The upstream project compiles NetHack to WebAssembly and exposes a low-level callback interface; this fork adds `@neth4ck/api`, which wraps that into a stateful, event-driven API so frontends can interface with the game without dealing with raw WASM callbacks, glyph math, or prompt sequencing.

## Packages

| Package                                     | Description                                                    |
| ------------------------------------------- | -------------------------------------------------------------- |
| [`@neth4ck/api`](./packages/api/)           | High-level stateful API for building NetHack frontends         |
| [`@neth4ck/neth4ck`](./packages/neth4ck/)   | Version-agnostic shim — callback bridge and module initializer |
| [`@neth4ck/wasm-367`](./packages/wasm-367/) | NetHack 3.6.7 WebAssembly build                                |
| [`@neth4ck/wasm-37`](./packages/wasm-37/)   | NetHack 3.7 WebAssembly build                                  |

## Quick Start

```js
import { NethackStateManager } from "@neth4ck/api";
import createModule from "@neth4ck/wasm-37";

const game = new NethackStateManager();

game.on("message", (msg) => console.log(msg.text));
game.on("mapUpdate", (map) => render(map));
game.on("inputRequired", (prompt) => {
    // respond to the game's prompts
});

await game.start(createModule, {
    nethackOptions: { name: "Bubba" },
});
```

See the [API package README](./packages/api/README.md) for full documentation.

## Development

This is a [pnpm](https://pnpm.io/) + [Nx](https://nx.dev/) monorepo.

```bash
pnpm install
pnpm build
pnpm test
```

## WASM Build

The WASM artifacts are built from NetHack source via git submodules:

- `NetHack/` — NetHack 3.7 source (for `@neth4ck/wasm-37`)
- `NetHack-3.6/` — NetHack 3.6.7 source (for `@neth4ck/wasm-367`)

Built `.js`/`.wasm` files are gitignored but included in npm packages via `"files"` in each package.json.

## License

[NetHack General Public License](./LICENSE.md)
