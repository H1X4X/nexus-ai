import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(root, rel), "utf8");

const html = read("index.html");
const js = read("assets/app.js");
const css = read("assets/styles.css");
const readme = read("README.md");
const architecture = read("docs/ARCHITECTURE.md");
const ci = read(".github/workflows/ci.yml");

const valuesFor = (source, attr) =>
  Array.from(source.matchAll(new RegExp(`data-${attr}="([^"]+)"`, "g")), (m) => m[1]);

test("required files exist", () => {
  const required = [
    "index.html",
    "favicon.svg",
    "LICENSE",
    "robots.txt",
    "sitemap.xml",
    "README.md",
    "docs/ARCHITECTURE.md",
    "docs/DRONE_SYSTEM.md",
    "docs/UPGRADES.md",
    "package.json",
    "assets/app.js",
    "assets/drone-system.js",
    "assets/styles.css",
    "assets/vendor/three.min.js",
    "assets/fonts/fonts.css",
    "scripts/serve.mjs",
    ".github/workflows/ci.yml"
  ];
  for (const file of required) {
    assert.ok(existsSync(join(root, file)), `missing ${file}`);
  }
});

test("no external runtime scripts or stylesheets", () => {
  // Metadata URLs (canonical / og:image) are fine; only fetches are not.
  const remoteScript = /<script[^>]*src="https?:\/\//i;
  const remoteStyle = /<link[^>]*rel="stylesheet"[^>]*href="https?:\/\//i;
  assert.equal(remoteScript.test(html), false, "index.html loads a remote script");
  assert.equal(remoteStyle.test(html), false, "index.html loads a remote stylesheet");
  assert.equal(/https?:\/\/[^"'\s]+\.js/.test(js), false, "app.js references a remote script");
  assert.equal(/@import\s+url\(https?:/i.test(css), false, "styles.css imports a remote stylesheet");
});

test("every #id selector used by app.js exists in index.html", () => {
  const ids = new Set(Array.from(js.matchAll(/\$\("#([A-Za-z0-9_-]+)"\)/g), (m) => m[1]));
  assert.ok(ids.size > 20, "expected the app to reference many DOM ids");
  for (const id of ids) {
    assert.ok(html.includes(`id="${id}"`), `#${id} is referenced in JS but missing from HTML`);
  }
});

test("data-action hooks are handled by runAction", () => {
  const actions = new Set(valuesFor(html, "action"));
  assert.ok(actions.size >= 8);
  for (const action of actions) {
    assert.ok(js.includes(`case "${action}":`), `data-action="${action}" has no handler`);
  }
});

test("data-scenario hooks exist in SCENARIOS", () => {
  const scenarios = new Set(valuesFor(html, "scenario"));
  assert.deepEqual([...scenarios].sort(), ["blackout", "drone", "main", "mesh"]);
  for (const scenario of scenarios) {
    assert.ok(
      new RegExp(`id:\\s*"${scenario}"`).test(js),
      `data-scenario="${scenario}" is not defined in SCENARIOS`
    );
  }
});

test("data-camera hooks exist in CAM_PRESETS", () => {
  const cameras = new Set(valuesFor(html, "camera"));
  assert.deepEqual([...cameras].sort(), ["front", "orbit", "overview", "top"]);
  for (const camera of cameras) {
    assert.ok(
      new RegExp(`\\b${camera}:\\s*\\{ yaw`).test(js),
      `data-camera="${camera}" is not defined in CAM_PRESETS`
    );
  }
});

test("data-layer hooks exist in state.layers", () => {
  // Only the map-layer checkboxes use data-layer as a state key; the
  // architecture tabs reuse the attribute for numeric panel ids.
  const layers = new Set(
    Array.from(html.matchAll(/<input[^>]*data-layer="([^"]+)"/g), (m) => m[1])
  );
  assert.equal(layers.size, 7);
  for (const layer of layers) {
    assert.ok(
      new RegExp(`\\b${layer}:\\s*(?:true|false)`).test(js),
      `data-layer="${layer}" is not defined in state.layers`
    );
  }
});

test("speed presets include the v2 slow-motion option", () => {
  const speeds = valuesFor(html, "speed").map(Number);
  assert.deepEqual(speeds, [0.5, 1, 2, 4]);
  assert.ok(speeds.every((n) => Number.isFinite(n) && n > 0));
});

test("v2 UI, logic and styles are all present", () => {
  for (const id of ["run-snapshot", "sim-step", "sim-focus", "metrics-chart"]) {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  }
  for (const fn of [
    "exportSnapshot",
    "stepSimulation",
    "toggleFocus",
    "sampleTelemetry",
    "drawTelemetryChart"
  ]) {
    assert.ok(new RegExp(`function ${fn}\\(`).test(js), `missing ${fn}()`);
  }
  assert.ok(css.includes(".metrics-chart"), "missing chart styles");
  assert.ok(css.includes("body.focus-mode"), "missing focus-mode styles");
});

test("v4 distributed architecture hooks are present", () => {
  for (const id of [
    "arch-status", "arch-levels", "arch-authority", "arch-heartbeats",
    "arch-lease", "arch-guard", "arch-channels", "arch-safety",
    "arch-trust", "arch-audit"
  ]) {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  }
  assert.ok(html.includes('data-action="isolate"'), "missing isolate action");
  assert.ok(js.includes('case "isolate":'), "isolate action has no handler");
  assert.ok(css.includes(".arch-strip"), "missing architecture strip styles");
  for (const token of [
    "AI_LEVELS", "COMM_CHANNELS", "PERF_TARGETS", "auditEvent",
    "splitBrainRisk", "quorum", "epoch", "dataType", "expiresAt"
  ]) {
    assert.ok(js.includes(token), `app.js missing ${token}`);
  }
  for (const phrase of ["Heartbeats", "Leader leases", "Three communication channels", "Zero-trust security", "Privacy by design", "Measurable prototype targets"]) {
    assert.ok(architecture.includes(phrase), `ARCHITECTURE.md missing: ${phrase}`);
  }
});

test("v5 physical world and mission hooks are present", () => {
  for (const token of [
    "const WORLD =", "AUTONOMY_MODES", "missionPlanFor", "assignMissions",
    "updateAutonomy", "lineOfSightBlocked", "radioLineBlocked", "queueObservation", "pendingObservations",
    "obstacleState", "sensorFov", "cruiseSpeed", "windDrift", "warehouse", "apartment"
  ]) {
    assert.ok(js.includes(token), `app.js missing v5 token ${token}`);
  }
  for (const phrase of [
    "1a. Physical world and mission execution",
    "store-and-forward",
    "return-to-nearest-post",
    "78×78"
  ]) {
    assert.ok(architecture.includes(phrase), `ARCHITECTURE.md missing: ${phrase}`);
  }
  const upgrades = read("docs/UPGRADES.md");
  for (const phrase of ["v5 — doubled world", "One world descriptor", "Mission routes instead of circles", "5.0.0"]) {
    assert.ok(upgrades.includes(phrase), `UPGRADES.md missing: ${phrase}`);
  }
  assert.ok(readme.includes("Mission-driven fleet"), "README is missing mission fleet summary");
});

test("reusable drone system is loaded and drives the simulator", () => {
  assert.ok(html.includes('src="assets/drone-system.js"'), "index.html does not load drone-system.js");
  assert.ok(js.includes("NexusDroneSystem"), "app.js does not reference the drone system");
  assert.ok(js.includes("droneSystem.updateAutonomy"), "app.js does not delegate autonomy");
  assert.ok(js.includes("droneSystem.updateMapFeatures"), "app.js does not delegate observations");
  const droneJs = read("assets/drone-system.js");
  for (const token of [
    "class DroneSystem", "createDroneSystem", "missionPlanFor", "enqueueTask",
    "updateAutonomy", "updateMapFeatures", "radioLineBlocked", "buildFleetSummary",
    "6.0.0"
  ]) {
    assert.ok(droneJs.includes(token), `drone-system.js missing token ${token}`);
  }
});

test("docs and CI describe the v2 workflow", () => {
  for (const phrase of ["Focus mode", "Telemetry history", "PNG", "Comms blackout", "npm test"]) {
    assert.ok(readme.includes(phrase), `README is missing: ${phrase}`);
  }
  assert.ok(ci.includes("npm test"), "CI does not run npm test");
  assert.ok(ci.includes("npm run check"), "CI does not run npm run check");
});

test("CI smoke tokens still exist", () => {
  for (const token of [
    "ops-canvas-3d",
    "map-options",
    "situation-options",
    "feature-chips",
    "assets/vendor/three.min.js",
    "assets/app.js"
  ]) {
    assert.ok(html.includes(token), `HTML missing smoke token ${token}`);
  }
  for (const token of ["SITUATIONS", "MAPS", "wind", "rain", "compass", "threeAvailable"]) {
    assert.ok(js.includes(token), `JS missing smoke token ${token}`);
  }
});
