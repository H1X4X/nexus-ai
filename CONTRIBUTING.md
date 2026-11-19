# Contributing to NEXUS AI

Thanks for improving the project. The runtime is intentionally dependency-free, so please keep it that way.

## Ground rules

- No external scripts, stylesheets, trackers or runtime data requests. Vendor assets locally.
- Keep the simulation deterministic: every random choice must go through the seeded PRNG in `assets/app.js`.
- If you add a UI hook (`data-action`, `data-scenario`, `data-camera`, `data-layer`, or a `#id` used by JS), wire it in both `index.html` and `assets/app.js`. The wiring tests will catch mismatches.
- Prefer plain JavaScript and relative asset paths; there is no build step.

## Local workflow

```bash
npm run serve     # http://localhost:8080
npm run verify    # syntax check + all tests
```

Or open `index.html` directly in a browser.

## Adding a scenario

1. Add an entry to `SCENARIOS` in `assets/app.js`.
2. Handle it in `applyScenarioFaults()` so share links reproduce it.
3. Add a `data-scenario` chip in `index.html` and a note in the scenario notes grid.
4. Update `README.md` and `docs/UPGRADES.md`.
5. Run `npm run verify`.

## Adding a fault or metric

- Fault actions belong in `runAction()` and need a `data-action` button in `index.html`.
- Metrics shown in the strip should also be added to `buildRunSummary()` and the CSV export.
- Keep `README.md` in sync with new controls and keyboard shortcuts.

## Tests

`npm test` uses Node's built-in test runner. It reads the source files, checks HTML/JS wiring, and executes the app's helpers in a sandboxed DOM stub. No network access or npm install is required.
