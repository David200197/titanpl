# @titanpl/cli

The command-line interface (CLI) for Titan Planet. It provides the `titan` and `tit` commands for initializing, building, and running Titan Planet servers.

## What it works (What it does)
The CLI is responsible for bridging your JavaScript codebase with the underlying Rust/Axum engine. It handles scaffolding, compiling JS actions, generating metadata, and running the server.

## Commands

| Command | Arguments | Description |
| :--- | :--- | :--- |
| `init` | `<dir>` | Initialize a new Titan project in the specified directory. |
| `dev` | | Start the development server with hot-reload and strict type checking. |
| `build` | | Bundle JavaScript/TypeScript actions into `.jsbundle` files. |
| `build` | `--release` | Create a self-contained production bundle in `build/` (incl. engine). |
| `start` | | Start the Titan server (checks for `build/` or local engine). |
| `update` | | Update the local engine to the latest version. |
| `ext create` | `<name>` | Scaffold a new native Extension. |
| `ext run` | | Run the current extension in a test harness. |
| `help` | | Show available commands and options. |

## How it works
You can install this package globally or use it via your package runner (e.g., `npx`). Alternatively, you can install it as a dev dependency in your project.

```bash
npm install -g @titanpl/cli
titan help
```

It parses your application source code, coordinates with `@titanpl/packet` to build the required JS endpoints, and then spins up the pre-compiled native core engine for your OS.

**Note:** All commands now prioritize `tanfig.json` for project configuration.

**Note on Platform Architecture:** Titan Planet's new v2 architecture supports Windows and Linux (incl. Docker). MacOS support is in active development.
