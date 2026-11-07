# NEXUS AI

An interactive engineering proposal and live 3D command center for a self-healing, distributed drone network.

The site combines the full proposal with a working browser-based simulation: 12 drones, a Main AI, a Backup AI, mesh routing, coordinator failover, link and drone failures, buffered records, and a shared map that distinguishes live data from stale data.

## What is inside

- **Engineering proposal** — architecture, operating process, self-healing behavior, shared map, storage, human supervision, security, applications, challenges, roadmap, and vision.
- **Live command center** — an interactive 3D mesh simulator with topology view, camera presets, layer controls, node inspector, event log, scenarios, and keyboard shortcuts.
- **14 simulated nodes** — 12 drones plus Main AI and Backup AI.
- **Self-contained assets** — no external fonts, trackers, or runtime data requests.

## Run locally

Open `index.html` directly in a browser, or serve this folder with any static file server. The page uses plain non-module JavaScript and relative asset paths, so no build step is required.

## Simulator controls

- **Space** — pause or resume the simulation
- **R** — reset
- **1–4** — switch camera presets
- **Esc** — clear the current selection

Use the fault buttons to sever links, create interference or a storm partition, fail a drone, or take down the Main or Backup AI. Use **Restore everything** to watch the mesh and buffered records reconcile.

## Project structure

```text
index.html
favicon.svg
assets/
  styles.css
  app.js
  fonts/
    fonts.css
    *.woff2
```

## Notes

This is a concept and simulation, not a flight-control system. All behavior runs locally in the browser and is intended for explaining the architecture and testing failure scenarios.
