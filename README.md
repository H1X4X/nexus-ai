# NEXUS AI

An interactive engineering proposal and live 3D command center for a self-healing, distributed drone network.

**Live site:** https://h1x4x.github.io/nexus-ai/

The site combines the full proposal with a working browser-based simulation: a 78×78 physical arena, 12 mission-driven drones, fixed Main and Backup operator outposts at opposite ends, mesh routing, split-brain-safe coordinator failover, three communication channels, link and drone failures, buffered records, and a shared map that distinguishes live data from stale data.

## What is inside

- **Engineering proposal** — architecture, operating process, self-healing behavior, shared map, storage, human supervision, security, applications, challenges, roadmap, and vision.
- **Live command center** — an interactive 3D mesh simulator with topology view, camera presets, layer controls, node inspector, event log, four scenarios, a telemetry history chart, and keyboard shortcuts.
- **Focus mode** — hide the proposal and expand the simulator to a near full-screen command console, with one button or the `F` key.
- **Reproducible runs** — seeded scenarios with shareable links, JSON/CSV export and a captioned PNG snapshot of the current view.
- **Shared environmental map** — 8 doubled battlefield maps with terrain, water, forests, warehouse and apartment buildings, roads, 4 situations, and live/stale/lost feature freshness.
- **Mission-driven fleet** — waypoint routes, heading- and line-of-sight-aware sensing, obstacle avoidance, wind drift, takeoff/cruise/survey/RTL/landing modes and battery-aware decisions.
- **Reusable drone system** — [`assets/drone-system.js`](assets/drone-system.js) is the complete dependency-free drone codebase: task queues, mission planning, navigation, autonomy state machine, sensing, observation routing, faults and fleet summaries. The live command center delegates to this module.
- **14 simulated nodes** — 12 drones plus two fixed operator outposts, MAIN at the map start and BACKUP at the far end.
- **Distributed architecture state** — live heartbeats, lease, term/epoch, quorum, split-brain guard, channel load, safety posture, identity/trust and signed audit events.
- **Telemetry history** — a rolling 60-second sparkline of connected drones, buffered records and packet rate; included in exported runs.
- **Battery-friendly rendering** — the 3D scene stops drawing while the simulator is scrolled out of view, and the Orbit camera stays still for visitors who prefer reduced motion.
- **Detailed battlefield models** — trees are real instanced 3D geometry (layered conifer cones, clustered broadleaf crowns, understory scrub) instead of crossed cards; buildings get tiled wall textures, all-round instanced glazing, parapets, balconies, roller doors, rooftop plant and contact shadows; drones carry hull seams, a gimballed camera with bezel and IR sensor, battery trays, propeller guards, navigation lights and a blinking tail strobe. Industrial yards and urban blocks add service aprons, loading canopies, rooftop plant, kerbed sidewalks, street lights, parked vehicles and container stacks, all batched into instanced draws.
- **Self-contained assets** — no external fonts, trackers, or runtime data requests. The 3D map vendors Three.js r128 locally under `assets/vendor/` (loaded as a classic script, no CDN).

The stronger engineering interpretation of the project — AI responsibility levels, split-brain-safe coordination, three communication channels, observation records and sensor fusion, independent safety, zero-trust security, privacy by design, measurable targets and a staged roadmap — is documented in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). The simulator now exposes the main ideas as a live **Architecture** panel with heartbeats, leases, epochs, quorum, channel health, safety posture, identity/trust and audit events.

## Run locally

Open `index.html` directly in a browser, or serve this folder with any static file server. The page uses plain non-module JavaScript and relative asset paths, so no build step is required.

A dependency-free dev server is included:

```bash
npm run serve          # http://localhost:8080 (PORT=3000 npm run serve to override)
```

Run the checks (Node 20 or newer):

```bash
npm run verify         # syntax check + static wiring tests + simulation tests
```

Individual commands are `npm run check` (syntax) and `npm test` (Node's built-in test runner; no dependencies to install).

## Drone system module

`assets/drone-system.js` can be used on its own in any browser or Node project. It is a classic script/UMD module with no DOM, network or library dependencies. In a browser it exposes `window.NexusDroneSystem`; in Node, `require()`/`import` plus `globalThis.NexusDroneSystem` both work.

```js
const system = NexusDroneSystem.createDroneSystem({
  config: NexusDroneSystem.DEFAULT_CONFIG,
  posts: NexusDroneSystem.DEFAULT_POSTS,
  random: () => 0.42,
  heightAt: () => 0,
  situation: () => ({ sensor: 1, liveFor: 7, staleFor: 16 }),
  log: console.log,
  audit: console.log
});

const state = { time: 0, drones: [], features: [], activeDrones: [] };
const drones = system.createDrones(12, features, state);

// Each frame:
state.time += dt;
system.updateAutonomy(dt, state);
system.updateMapFeatures(dt, state);
```

The full API is documented in [`docs/DRONE_SYSTEM.md`](docs/DRONE_SYSTEM.md). Tests for the standalone module live in `tests/drone-system.test.mjs`.

## Simulator controls

- **Space** — pause or resume the simulation
- **.** — single-step one frame while paused (pauses automatically if running)
- **R** — reset
- **F** — toggle focus mode (hide the proposal, expand the simulator)
- **1–4** — switch camera presets (`1` Overview, `2` Top-down, `3` East front, `4` Orbit)
- **Arrow keys** — orbit (←→ yaw, ↑ top-down / ↓ horizon), **+ / −** zoom, **0** back to Overview (active while the simulator is on screen)
- **Esc** — clear the current selection
- Speed presets: **0.5× / 1× / 2× / 4×** in the ops top bar
- **Drag up** — lift the camera to top-down; drag sideways for a full **360° orbit** at a stable height, scroll to zoom, right-drag (or Shift-drag) to pan. The camera never drops to the flat horizon where the terrain vanishes. Camera preset buttons stay visible on small screens, so **Top-down** is one tap and **Orbit** (`4`) auto-rotates a full turn in about 14 seconds (grab the canvas to take over). A compass HUD (top-left) shows live heading, pitch and distance.

Use the fault buttons to sever links, create interference or a storm partition, fail a drone, or take down the Main or Backup AI. Use **Restore everything** to watch the mesh and buffered records reconcile.

Four guided scenarios are available above the run bar: **Cut the mesh**, **Fail the Main AI**, **Lose a drone** and **Comms blackout**. The last one stacks interference, a storm partition, a severed link and a lost drone so the telemetry history chart shows a pronounced connectivity dip and buffered-record climb.

The shared environmental map is the other half of the simulation. Pick a **map** (wildfire, flood, search & rescue, industrial, urban, mountain, coast, or battlefield) and a **situation** (routine watch, rapid spread, night search, comms blackout, wind, or rain) from the bar above the canvas. Each map is a true 3D battlefield at twice the original scale, with procedurally textured, PBR-style surfaces — dense hillfield terrain at finer detail, an animated reflective water plane, layered instanced forest trees with grass cover, varied stone, warehouse and apartment building facades with roofs, windows, loading bays and flat roofs, and asphalt road ribbons — rendered with Three.js WebGL and situation-driven lighting, fog, sky and rain. Small drones are detailed quadcopters with spinning rotors, cameras and status lights that bank into their movement and project rotating scan cones over the ground. They now fly assigned missions rather than circles: relay corridors between the two posts or survey approaches over actual map features. MAIN and BACKUP are fixed operator outposts at opposite map ends — MAIN at the start, BACKUP at the far end — where a user could stand, with consoles, comms dishes and status beacons. Drone mesh traffic uses solid links, while post-to-drone commands use a distinct animated dashed amber channel in both the 3D and topology views. Packets and features (ground truth + shared-map rings, beams, diamonds and labels) stay synced from the same simulation state. The 2D canvas remains as a topology view and as an automatic fallback if WebGL is unavailable. A drone only detects a feature when it is within sensor range, inside its forward field of view and has line of sight. The observation is buffered onboard, then routed through the active channel with a hop- and latency-dependent delay before it appears on the shared map; otherwise the record ages through **stale** and **lost**. **Run drill** plays an automated sequence — a storm partition at 0.9 s, a lost drone at 2.8 s, and a full restore at 7 s — so the freshness behavior can be watched without manual fault injection.

## Reproducible runs

Every simulated random choice comes from one seeded generator. The current run is encoded in the address bar:

```text
?seed=42&map=flood&situation=spread&scenario=main
```

- `seed` — integer seed; the same seed reproduces the same terrain layout, mission waypoints, battery levels, packet choices, and fault picks.
- `scenario` — `mesh`, `main`, `drone`, or omit for a free run.
- `map` — monitored area: `wildfire`, `flood`, `sar`, `industrial`, `urban`, `mountain`, `coast`, or `battlefield`.
- `situation` — `routine`, `spread`, `night`, `blackout`, `wind`, or `rain`.

Use the run bar above the simulator to:

- **Seed** — click the seed value to generate a new seed and replay the current scenario from T+00:00.
- **Copy link** — copy a URL that reproduces the exact run.
- **Export JSON** — download a run summary with world geometry, per-drone missions and flight modes, coordinator state, faults, counters, the event log, and the full monitored-feature state.
- **CSV** — download the same summary as a flat metric table.
- **×** — clear the scenario and return to a free run.

Reset keeps the current seed, scenario, map, and situation, so a run can be replayed from the beginning. Changing the map or situation resets to T+00:00 while preserving the seed and scenario. Frame rate and elapsed real time can differ between devices, but the simulated random sequence is identical.

## Project structure

```text
index.html
favicon.svg
LICENSE
robots.txt
sitemap.xml
.github/
  workflows/ci.yml
assets/
  styles.css
  app.js
  vendor/
    three.min.js (Three.js r128, MIT — vendored locally)
  fonts/
    fonts.css
    *.woff2
```

## Notes

This is a concept and simulation, not a flight-control system. All behavior runs locally in the browser and is intended for explaining the architecture and testing failure scenarios.
