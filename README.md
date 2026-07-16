# Attune App

Attune App is a desktop control panel for the sibling
[`attune`](../attune) runtime. It scans supported Chromium desktop apps,
applies Attune theme adapters, and launches/stops live CSS sessions without
requiring an LLM to run commands by hand.

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

If the runtime is not built yet, either run `npm run build` in `../attune` or
use the app's build button.

## Scripts

- `npm run dev` starts Vite and Electron.
- `npm run build` type-checks and builds the renderer and Electron main process.
- `npm start` builds and opens the production Electron bundle locally.

