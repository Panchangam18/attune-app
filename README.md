<p align="center">
  <a href="https://github.com/Panchangam18/attune-app/releases/download/v0.1.20/Attune-0.1.20-mac-universal.dmg">
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

## Pick an element

With Attune running, press `Option+Command+A` while an attached Chromium app,
Attune-opened Chrome window, or Safari tab is in front. Attune highlights the
component under the pointer. Use the up and down arrow keys to move between the
highlighted element and its ancestors, click to copy a chat-ready element
reference, or press Escape to cancel.

Option-click chooses the highlighted component as a component-smuggling
source. The source remains visible and authoritative in its original app.
Bring a different Attune app to the front, press `Option+Command+A` again, and
move across the highlighted destination component to choose placement. Its
top, bottom, left, and right zones reserve an internal lane within the destination's
existing bounds; the center uses the normal inside placement. The transplant stays at
its source size, and the destination becomes the scroll boundary when both
full-size panes cannot fit.

The transplanted view relays hover, clicks, typing, keyboard shortcuts, and
scroll gestures to the source while displaying the source app's rendered
output. To resize that complete view, enter selection mode in the destination
app and drag any edge or corner handle; pointer coordinates remain mapped to
the original source component. Its close control also stays hidden during
normal use. In selection mode, the `×` control appears on the transplant and
closes both ends when clicked.

While picking, Attune freezes the visible frame, pauses CSS motion, and blocks
host input. Existing semantic roles are copied directly. Unmapped selections
carry bounded resolver evidence so an agent can add a durable, purpose-named
role before styling.

Detailed selection receipts stay local in Attune's application-support folder
and expire after 24 hours. The clipboard reference remains useful by itself and
does not include a page-wide DOM dump or screenshot.

Chrome uses its Attune DevTools session and can run in an isolated profile next
to a normal Chrome session. Safari works as a component source without an
extension; enable Safari's `Develop > Allow JavaScript from Apple Events` once
so Attune can install the picker and relay compact DOM commands. In both
browsers, the live picture comes from the selected native window through
ScreenCaptureKit rather than repeated browser screenshots. Safari destinations
are not yet supported.

## Scripts

- `npm run dev` starts Vite and Electron.
- `npm run build` type-checks and builds the renderer and Electron main process.
- `npm start` builds and opens the production Electron bundle locally.
