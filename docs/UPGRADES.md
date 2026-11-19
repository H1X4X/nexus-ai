# NEXUS AI v2 upgrade notes

This document records the v2 upgrade applied to the original single-page prototype, plus the v3 3D-map visual overhaul. The app remains dependency-free at runtime: plain JavaScript, local fonts and a locally vendored Three.js r128.

## v3 — full 3D map overhaul

The WebGL scene was rebuilt for believable materials, depth and situation-driven atmosphere. Everything still shares one deterministic terrain cache, so seeds and map switching behave exactly as before. All surface textures are generated procedurally into canvases at startup — still no image requests or runtime dependencies.

- **Materials** — colour maps, normal maps, roughness/metalness values and a generated environment cube replace flat Lambert colours. Ground, water, bark, foliage, grass, brick, stucco, concrete, wood, shingles, corrugated metal and asphalt are all synthesised locally.
- **Lighting & sky** — warm key light, cool fill light and hemisphere bounce, soft shadows, ACES tone mapping, sRGB output, a gradient sky dome and a sun sprite. Exponential fog and light temperature shift with the situation (blue-grey rain, violet night/blackout).
- **Terrain** — 120×120 hillfield (up from 90×90) with a repeating detail map, normal-mapped surface relief and a solid skirt so the map no longer floats. The terrain now receives shadows.
- **Water** — segmented surface with scrolling ripple normals, specular highlights and environment reflections; rain adds a higher water level and larger waves.
- **Forest & rocks** — trees use textured bark trunks and crossed, alpha-cut foliage cards (needle conifers and broadleaf clusters) with individual rotation and tint, plus grass tufts and soft contact shadows. Rocks are irregular normal-mapped stone.
- **Buildings** — distinct silhouettes per type with textured surfaces and real architectural detail: gabled houses/cabins with framed glass windows, doors and chimneys; towers with observation decks and antennas; tanks with domes, bands and ladders; bridges with asphalt decks and rails; plants with roof vents and pipework.
- **Drones** — each drone is now a quadcopter: flattened fuselage with glossy canopy, carbon spars, four motors, spinning props with soft rotor discs, landing skids, gimballed camera, antenna and status LEDs. Airframes bank into movement, props stop when a drone fails, and colours reflect connected/leader/unrouted/lost state. Every small drone also projects a rotating sensor cone and ground footprint so its scanned area is visible.
- **Roads** — UV-mapped asphalt ribbons with worn centre lines and soft shoulders follow the terrain instead of thin floating lines.
- **Coordinators** — MAIN and BKUP are now larger, conventional quadcopters hovering above the map with camera pods, avionics decks, status LEDs and identity labels, instead of static ground platforms. They hold station near their logical positions while the simulation keeps using the same deterministic link ranges.
- **Rain scenario** — 700 animated streaks drift across the scene, fog closes in, and lighting flattens.
- All new materials and geometries are disposed on map change; the shared texture atlas (glow, sky and procedural maps) is deliberately preserved.

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
