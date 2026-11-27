# NEXUS AI upgrade notes

This document records the v2 upgrade applied to the original single-page prototype, the v3 3D-map visual overhaul, the v4 distributed-architecture upgrade, the v5 physical-world/mission-AI upgrade, the v6 reusable drone-system extraction, the v6.1 performance/accessibility pass, the v6.2 scene-realism pass and the v6.3 street-and-block pass. The app remains dependency-free at runtime: plain JavaScript, local fonts and a locally vendored Three.js r128.

The full engineering interpretation of the distributed work is in [`ARCHITECTURE.md`](ARCHITECTURE.md). The live simulator exposes its core state in the **Distributed architecture** strip below the metrics.

## v6.3 – street and block detail pass

A focused pass on the two hand-built environments. Seeds, maps, situations, scenarios, fleet behaviour and the drone-system API are unchanged; only the 3D dressing of industrial warehouses and urban apartment blocks changes.

- **Warehouses are worksites** – a muted masonry plinth, a canopied loading dock with support posts, a yard-side personnel door, skylights, an HVAC plant and roof vents. Each site gets a compatible service apron, stackable containers, pallets, drums, a fence, a street light, a small parking bay and an occasional delivery truck.
- **Apartments are city blocks** – rooftop water tanks, antenna masts and stair bulkheads, plus a sidewalk with kerbs and paving joints, a street light, a bus shelter, planters, a hydrant and parked cars. Overlapping aprons use a tiny deterministic height offset so neighbouring slabs cannot z-fight.
- **Placement respects the map** – sampled clearance tests keep yards, parking bays, street furniture and parked vehicles off the asphalt ribbons and out of neighbouring footprints. A deterministic per-map generator makes the prop mix repeatable for the same seed.
- **Detail stays cheap** – every box and cylinder prop is accumulated into material-keyed instanced batches and flushed once after the building pass. A fully dressed street costs a handful of draw calls instead of hundreds of individual meshes.
- **Verification** – `tests/wiring.test.mjs` fails if the yard/frontage helpers or their instanced batches are removed. The eight-map browser sweep still reports zero console errors or warnings.

## v6.2 — scene realism pass

A modelling pass on the 3D battlefield: seeds, maps, scenarios and simulation rules are unchanged, and the extra detail is batched into instanced meshes so the frame cost stays close to v6.1.

- **Trees are real geometry** — crossed alpha cards are replaced by merged, flat-shaded 3D models: four overlapping cone tiers on a tapered trunk for conifers, a clustered faceted crown for broadleaf trees. Each tree is one instance with baked vertex shading and per-instance hue, plus instanced understory scrub. A dense forest is two or three draw calls instead of hundreds of billboard planes.
- **Buildings read as structures** — wall boxes rescale their box UVs so brick, siding, stucco and concrete keep a constant real-world size on every footprint. Windows now wrap all four facades and are collected into three instanced batches (dark frame, reflective glass, lit pane), so glazing is cheaper than the old single-face boxes. Apartments gain parapets, balconies with railings, rooftop HVAC and entrance canopies; warehouses gain roller doors with ribs, hazard trim, dock bumpers, wall-pack lights and roof vents; cabins and houses gain gutters, downspouts and porch canopies; towers gain a guard-railed observation deck, a dish and a base lamp; tanks gain a catwalk and riser; bridges gain guard rails and lamps. Every building also gets a soft contact-shadow decal.
- **Drones gained airframe detail** — a moulded hull seam, canopy, gimballed camera with bezel and side IR sensor, GPS puck, underslung battery tray with heatsink fins, arm fairings, motor bells, propeller guard rings, red/green navigation lights and a white tail strobe that blinks in flight and dims when the link is lost. Static detail is merged into one mesh per material and only the structural parts cast shadows, so the extra modelling costs fewer draw calls than the old airframe. The invisible pick sphere is now parented to the airframe, so 3D selection follows the drone instead of sitting at the world origin. On the industrial map at 900×700 the average animation-frame callback is **10.3 ms**, down from **14.0 ms** before the pass.
- **Tests** — `tests/wiring.test.mjs` fails if the instanced geometry, facade window pass or strobe wiring is removed.

## v6.1 — performance and accessibility pass

A pass on the command center itself; seeds, maps, scenarios, simulation rules and the drone-system API are unchanged.

- **Off-screen rendering gate** — an `IntersectionObserver` on the canvas stage switches camera updates and drawing off while the simulator is scrolled out of view, then catches the view up on return. The simulation keeps running, so the clock and telemetry stay continuous. Measured in Chromium, the average animation-frame callback while reading the proposal fell from **8.8 ms to 0.26 ms**; the simulator view itself is unchanged at roughly 10 ms per frame.
- **Reduced motion** — the **Orbit** camera preset no longer auto-rotates when the system asks for reduced motion. The preset still frames the orbit view, and its toast explains why it stays still.
- **Keyboard navigation** — a **Skip to the proposal** link is the first tab stop and only appears on focus.
- **Screen-reader labelling** — the 2D fallback/topology canvas is announced as a network map instead of a 3D view.
- **Link previews** — Open Graph image width, height and alt text plus a Twitter summary card, so shared links unfurl correctly.
- **Tests** — `tests/wiring.test.mjs` now fails if the render gate, the reduced-motion guard or the skip link is removed.

## v6 — complete reusable drone system

The v6 upgrade extracts all drone behaviour into `assets/drone-system.js`, a standalone dependency-free module with a documented API (`docs/DRONE_SYSTEM.md`). The command center now delegates to this module instead of carrying a second copy of the logic.

- **Mission and task queues** — `missionPlanFor()`, `setMission()`, `enqueueTask()`, `nextTask()` and `clearTasks()` expose explicit routes and tasks. Every waypoint has a matching task record.
- **Autonomy state machine** — `updateAutonomy()` owns takeoff, route, survey, RTL, landing, hold and failed modes with battery, recall, lost-link and trust precedence.
- **Physical sensing** — `canObserve()`, `lineOfSightBlocked()` and `updateMapFeatures()` own range/FOV/LOS checks, onboard buffering, delayed routed delivery, stale/expired records and epoch rejection.
- **Radio geometry** — `radioLineBlocked()` shares terrain and building obstruction rules with the rest of the system.
- **Fault and export helpers** — `failDrone()`, `restoreDrone()`, `isolateDrone()`, `trustDrone()`, `recallAll()`, `releaseRecall()` and `buildFleetSummary()` are reusable outside the UI.
- **Verification** — `tests/drone-system.test.mjs` covers the standalone module; wiring tests confirm the live simulator loads and delegates to it. Export version advances to `6.0.0`.

## v5 — doubled world and mission-driven autonomy

The v5 upgrade makes the simulated world and the drones behave like a physical system rather than a moving diagram. Seeds, the eight maps, six situations, four scenarios and the twelve-aircraft fleet are unchanged.

- **One world descriptor** — `WORLD` defines the 2× scale, 78×78 extent, grid resolution, terrain segments, scatter density, camera distances/zoom clamps, fog, shadows, sky and rain coverage. Map feature tables stay authored in sector coordinates and are scaled once at load, preserving deterministic layouts.
- **Ground posts at the ends** — MAIN moves to `(-30, 30)` and BACKUP to `(30, -30)`. Terrain flattening, 2D pads, the 3D outpost installations, the corridor beam and radio ranges all use those same fixed positions. Post-to-drone links remain a distinct dashed connection type.
- **Consistent terrain and visuals** — 3D terrain is now 160×160 segments with tiled detail/normal maps; grid, rings, water, skirt, storm volume and 2D projection follow the shared extent. Buildings keep their authored footprints but gain scale-aware placement; vegetation density rises to fill the larger arena. Lighting uses a warmer key light, cooler bounce, wider shadow frustum, adjusted fog and denser rain. Industrial maps now use warehouse facades and urban maps use apartment blocks, with dedicated roofs, window grids, loading bays and flat roofs instead of generic low-profile boxes.
- **Mission routes instead of circles** — drones receive deterministic relay-corridor or feature-survey waypoint routes. They fly with a reported heading, cruise/climb/descent rates, wind drift correction, terrain clearance and building avoidance. Modes are takeoff, route, survey, rtl, landing, hold and failed.
- **Physical sensing** — feature detection now requires range, forward field of view and line of sight. Observations are buffered onboard when the route is down, then delivered after a sync tick plus latency/hop delay. Epoch-mismatched records are rejected; confidence and freshness come from the delivered record.
- **Safety precedence** — emergency landing, isolated hold, battery/lost-link/manual RTL always override mission progress. Reset, fault clearing and restore rebuild mission state and pending queues together.
- **Inspector, exports and tests** — the inspector shows mission, flight mode, waypoint, heading/FOV, obstacle state, delivery delay and onboard buffer. JSON/CSV exports include world geometry, per-drone flight data, observation counters and channel/epoch fields. Wiring and simulation tests cover the new tokens and behaviour; export version is now `5.0.0`.

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

At the time of v4, the export version remained `2.0.0`; new data was additive under `architecture`, `map.observations` and `audit`. v5 advances the version to `5.0.0` while keeping those fields and adding `world` and `fleet`. v6 advances it to `6.0.0` to mark the reusable drone-system extraction.

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
- **Coordinators** — MAIN and BKUP are fixed operator outposts at opposite ends of the map: a concrete pad, console, operator figure, sweeping comms dish and status beacon. MAIN sits at the map start and BACKUP at the far end; their coordinates were scaled in v5 to `(-30, 30)` and `(30, -30)`, and their heights follow the terrain. The simulation still uses the same deterministic endpoints and link ranges.
- **Command links** — post-to-drone traffic now uses its own animated dashed amber 3D channel instead of sharing the solid mesh-link line. The topology and 2D views use the same dashed style, so commands read as a separate connection type at a glance.
- **Rain scenario** — animated streaks drift across the scene, fog closes in, and lighting flattens; v5 expands coverage to 1,100 streaks across the larger arena.
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
