# NEXUS AI upgrade notes

This document records the v2 upgrade applied to the original single-page prototype, the v3 3D-map visual overhaul, and the v4 distributed-architecture upgrade. The app remains dependency-free at runtime: plain JavaScript, local fonts and a locally vendored Three.js r128.

The full engineering interpretation of the v4 work is in [`ARCHITECTURE.md`](ARCHITECTURE.md). The live simulator exposes its core state in the **Distributed architecture** strip below the metrics.

## v4 — distributed architecture made explicit

The v4 upgrade turns the proposal into a set of visible, testable simulation rules without changing the deterministic seeds, eight maps or six situations.

- **AI responsibility levels** — drone, group, network and human levels are defined in `docs/ARCHITECTURE.md`, surfaced in the live strip and inspector, and included in JSON export. Local drone safety remains independent of any coordinator.
- **Split-brain-safe failover** — coordinator state now tracks heartbeats, a leader lease, term, epoch, quorum witnesses, command sequence and stale-command rejections. The Backup promotes only after the lease expires and a quorum is visible. An ambiguous heartbeat under interference arms the split-brain guard and blocks promotion; packets from an old epoch are dropped in flight.
- **Three communication channels** — safety/control, telemetry/coordination and bulk data carry separate load, latency and delivery counters. Packets are coloured by channel in 3D, command and topology views, so bulk traffic is visibly distinct from safety traffic.
- **Richer observations and sensor fusion** — every generated record has an ID, source drone, timestamp, position, confidence, data type, status and expiration. Two or more independent observers raise confidence. The inspector and exports expose the fields.
- **Independent safety layer** — drones show a local safety posture (nominal, isolated hold, battery-reserve RTL, lost-link RTL or emergency landing). Geofence, battery reserve, manual overrides and isolation counts are exported.
- **Zero trust** — each drone has a unique identity. A new **Isolate selected drone** fault revokes trust and removes the node's links while leaving its local safety active. Administrative actions, heartbeats, promotions and reclaims are written to a tamper-evident audit stream shown in the live strip and exported as JSON.
- **Privacy by design** — onboard processing, minimal payloads and a retention window are explicit state and export fields; the architecture document explains the operating rule.
- **Measured targets and roadmap** — proposed prototype targets (5 initial drones, 1–2 s status, sub-5 s failover, reconnection sync) are defined in code and documentation. The architecture roadmap is staged from simulation to a controlled hardware prototype.
- **Documentation** — the static architecture tabs now describe leases, epochs, sensor fusion, three channels, independent safety, zero trust and privacy. The run notes explain epoch-guarded failover.

The export version remains `2.0.0` so existing run tooling keeps working; new data is additive under `architecture`, `map.observations` and `audit`.

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
- **Coordinators** — MAIN and BKUP are fixed operator outposts at opposite ends of the map: a concrete pad, console, operator figure, sweeping comms dish and status beacon. MAIN sits at the map start (`-15, 15`), BACKUP at the far end (`15, -15`), and their heights follow the terrain. The simulation still uses the same deterministic endpoints and link ranges.
- **Command links** — post-to-drone traffic now uses its own animated dashed amber 3D channel instead of sharing the solid mesh-link line. The topology and 2D views use the same dashed style, so commands read as a separate connection type at a glance.
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
