# AGENTS.md

## Project

Browser-based 3D figure editor built from simple shapes (parts, masks, Bezier paths, link parts, sketches, normal-map relief, face/hand/foot generator).

- Everything lives in `index.html` (HTML, CSS, and one `<script type="module">`). There is no build step and no bundler.
- Three.js 0.180.0 and `manifold-3d` 3.5.4 are loaded from the jsDelivr CDN through the import map, so `npm install` is not required (keep the CDN versions in sync with `package.json`).
- `samples/` holds model files (`.json`) that can be loaded or imported from the editor's File menu. `references/` holds reference images.

## Running

```bash
npm start   # serves the repo at http://localhost:8765/
```

Open http://localhost:8765/ in a browser. The editor is ready when the `#loading` overlay disappears.

## Checking changes

- Syntax-check the module script by extracting the contents of `<script type="module">` from `index.html` into a `.mjs` file and running `node --check` on it. A syntax error leaves the page stuck on 「エディターを準備しています…」.
- `let`/`const` state that `applyState`, `commit`, or other startup-time code touches must be declared before that code first runs (near the other mode state such as `reliefTarget`), or startup fails with a TDZ error.
- Verify UI changes in a browser: load the page, exercise the feature in the central viewport, and confirm nothing is thrown in the console.

## Conventions

- UI text, status messages, and the help modal (`#help-modal`) are written in Japanese. When adding a user-facing feature, add or update a paragraph in the help modal.
- Match the surrounding code style: plain functions, `camelCase`, no comments unless they state a non-obvious constraint.
- Document state is saved only on explicit save (Ctrl+S / File menu). `commit()` pushes an undo history entry; `packState`/`applyState` implement undo/redo; `liveSignature` drives the unsaved-changes check. New persistent data must be included in all three plus serialization.
- Modes such as mask editing (`maskTarget`), relief editing (`reliefTarget`), face/hand/foot editing (`featureTarget`), sketch drawing (`sketchDrawing`), and path drawing (`pathDraw`) are mutually exclusive; starting one should end or block the others.
- Respond to the user in Japanese.
