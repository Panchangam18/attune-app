<p align="center">
  <a href="https://github.com/Panchangam18/attune-app/releases/download/v0.1.17/Attune-0.1.17-mac-universal.dmg">
    <img src="public/readme-icon.svg" width="144" alt="Download the latest Attune release for macOS">
  </a>
</p>

# Attune App

Attune App is a desktop control panel for the sibling
[`attune`](https://github.com/Panchangam18/attune) runtime. It scans supported Chromium desktop apps,
applies Attune theme adapters, and launches/stops live CSS sessions without
requiring an LLM to run commands by hand.

Official themes and attunements live in the public
[`Panchangam18/attunements`](https://github.com/Panchangam18/attunements)
catalog. Development reads a sibling checkout directly; packaged releases
include a pinned catalog snapshot so the app remains reproducible and works
offline.

## Development

```sh
npm install
npm run dev
```

By default the app expects the runtime at `../attune`. You can override that
with:

```sh
ATTUNE_ROOT=/path/to/attune npm run dev
```

The package catalog defaults to `../attunements` and can be overridden with
`ATTUNE_CATALOG_ROOT=/path/to/attunements`.

At startup, Attune installs versioned catalog packages into
`~/Library/Application Support/Attune/workspaces`. Catalog-managed packages
receive an `.attune-package.json` marker and can be upgraded safely; unmarked
folders are considered user-owned and are preserved. Built-in themes are read
from the bundled catalog, while user themes override matching catalog IDs.

If the runtime is not built yet, either run `npm run build` in `../attune` or
use the app's build button.

## Coding agent integrations

Settings can install Attune's skill for ChatGPT, Cursor, and Claude. Each
toggle writes an Attune-managed skill to that agent's global skill directory
and removes only files previously created by Attune. Existing user-managed
skills are preserved and reported as conflicts.

The installed skill uses a launcher in Attune's application-support directory
so packaged agents can invoke the bundled runtime. Start a new agent session
after changing an integration toggle so the agent reloads its skill catalog.
Enabled managed skills are refreshed from the bundled canonical skill whenever
Attune reads its state, so runtime and agent instructions remain in sync after
an app update.

## Scripts

- `npm run dev` starts Vite and Electron.
- `npm run build` type-checks and builds the renderer and Electron main process.
- `npm start` builds and opens the production Electron bundle locally.
