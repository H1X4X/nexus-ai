# NEXUS AI v2 upgrade notes

This document records the v2 upgrade applied to the original single-page prototype. The app remains dependency-free at runtime: plain JavaScript, local fonts and a locally vendored Three.js r128.

## New simulator features

### 0.5× speed and single-step

- Added a **0.5×** preset beside the existing 1× / 2× / 4× controls.
- Added a **Step** button and `.` keyboard shortcut. It pauses the run (if needed) and advances exactly one frame, which makes fault timing easier to inspect.

### Comms blackout scenario

- Fourth guided scenario, available as a chip above the run bar and via `?scenario=blackout`.
- Stacks interference, a storm partition, a severed link and the loss of D05 so recovery and reconciliation are visible together.
- Included in the JSON/CSV exports and shareable URLs like the other scenarios.

### Telemetry history

- A rolling buffer records one sample every 0.5 simulated seconds and keeps the last 120 samples (60 seconds at 1×).
- The new panel plots connected drones, buffered records and packet rate on independent scales, with a legend and live endpoint dots.
- Samples are appended to `telemetry` in the JSON export. The app version in exports is now `2.0.0`.

### PNG snapshot

- **PNG** in the run bar exports the current command/topology view with a captioned header containing seed, clock, map, scenario and health state.
- WebGL canvases now use `preserveDrawingBuffer` so the 3D view can be captured reliably.

## Visual and mobile polish

- **Focus mode** (`F` or the Focus button) hides the proposal sections and expands the simulator to a near full-screen console. The same button becomes **Exit focus**.
- Focus-mode layout reflows both canvases after the transition so WebGL and 2D rendering stay sharp.
- Small-screen improvements: full-width top bar at narrow widths, centered icon buttons, horizontally efficient scenario chips, taller fault buttons for touch, and a shorter telemetry chart on phones.
- New local SVG symbols (`focus`, `step`, `chart`); no external icons or fonts were introduced.

## Code quality and testing

- Added `package.json` with `check`, `test`, `verify` and `serve` scripts.
- Added `scripts/serve.mjs`, a dependency-free static server with path-traversal protection and correct MIME types.
- Added a Node test suite (no npm install required):
  - `tests/wiring.test.mjs` checks that every DOM id, `data-action`, `data-scenario`, `data-camera` and map-layer hook referenced in JS actually exists in the HTML, plus self-contained-asset and CI smoke invariants.
  - `tests/simulation.test.mjs` runs the app's private helpers in a small browser-like VM sandbox to verify PRNG determinism, seed normalization, clock formatting, catalogue completeness, telemetry sampling/capping and export formatting. Production code is unchanged by the tests.
- CI now runs `npm test` and `npm run check` instead of an inline Python smoke script.

## Verification checklist

```bash
npm run check
npm test
npm run serve   # then open http://localhost:8080/
```

In the browser: run each of the four scenarios, toggle focus mode, drag the new telemetry panel into view on a phone-sized window, step a paused run, and export JSON, CSV and PNG.
