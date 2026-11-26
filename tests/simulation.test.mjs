import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import vm from "node:vm";

const root = fileURLToPath(new URL("..", import.meta.url));
let source = readFileSync(join(root, "assets/app.js"), "utf8");
const droneSystemSource = readFileSync(join(root, "assets/drone-system.js"), "utf8");

/* The app is an IIFE that boots against the DOM. For tests we replace the
   boot call with an export of its private helpers, then run it in a tiny
   browser-like sandbox. Production code is untouched. */
const exportLine = `
  globalThis.__NEXUS_TEST__ = {
    state, CFG, WORLD, SCENARIOS, MAPS, SITUATIONS, AI_LEVELS, AUTONOMY_MODES,
    COMM_CHANNELS, PERF_TARGETS, MAIN_POS, BKUP_POS, RELAY_PHASES,
    setSeed, nextRandom, normalizeSeed, fmtClock,
    makeDrones, assignMissions, resetMissionState, updateAutonomy, updateMapFeatures,
    buildTerrain, canObserve, angleBetween, radioLineBlocked, computeNetwork,
    sampleTelemetry, buildRunSummary, runFileName, csvCell
  };
`;
const end = source.lastIndexOf("})();");
assert.ok(end > 0, "could not find IIFE terminator in app.js");
source = source.slice(0, end) + exportLine + source.slice(end);

function loadApp() {
  const noop = () => {};
  const sandbox = {
    console,
    Math,
    Map,
    Set,
    URL,
    Blob,
    Date,
    JSON,
    Number,
    String,
    Array,
    Object,
    performance: { now: () => 0 },
    requestAnimationFrame: noop,
    setTimeout: noop,
    clearTimeout: noop,
    navigator: { clipboard: null },
    document: {
      readyState: "loading",
      addEventListener: noop,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({
        style: {},
        setAttribute: noop,
        appendChild: noop,
        click: noop,
        remove: noop,
        getContext: () => null
      }),
      body: { appendChild: noop, classList: { toggle: noop } }
    },
    window: {
      matchMedia: () => ({ matches: false }),
      crypto: { getRandomValues: (buf) => { buf[0] = 123456; return buf; } },
      location: { href: "https://example.test/", search: "", hash: "" },
      history: { replaceState: noop },
      devicePixelRatio: 1,
      innerHeight: 900,
      addEventListener: noop
    }
  };
  vm.runInNewContext(droneSystemSource, sandbox, { filename: "drone-system.js" });
  sandbox.window.NexusDroneSystem = sandbox.NexusDroneSystem;
  vm.runInNewContext(source, sandbox, { filename: "app.js" });
  return sandbox.__NEXUS_TEST__;
}

const app = loadApp();

test("seeded randomness is deterministic", () => {
  app.setSeed(42);
  const a = Array.from({ length: 8 }, () => app.nextRandom());
  app.setSeed(42);
  const b = Array.from({ length: 8 }, () => app.nextRandom());
  assert.deepEqual(a, b, "same seed produced different random sequences");
  assert.ok(a.every((n) => n >= 0 && n < 1), "PRNG produced an out-of-range value");
});

test("seed normalization handles negatives, decimals and junk", () => {
  assert.equal(app.normalizeSeed("-42"), 42);
  assert.equal(app.normalizeSeed(42.9), 42);
  assert.equal(app.normalizeSeed("not-a-number"), null);
  assert.equal(app.normalizeSeed(2 ** 32 + 7), 7);
});

test("clock formatting is stable", () => {
  assert.equal(app.fmtClock(0), "T+00:00");
  assert.equal(app.fmtClock(65), "T+01:05");
  assert.equal(app.fmtClock(-5), "T+00:00");
});

test("scenario, map and situation catalogues are complete", () => {
  assert.deepEqual(Object.keys(app.SCENARIOS).sort(), ["blackout", "drone", "main", "mesh"]);
  assert.equal(Object.keys(app.MAPS).length, 8);
  assert.equal(app.CFG.count, 12);
  for (const key of Object.keys(app.SCENARIOS)) {
    assert.ok(app.SCENARIOS[key].label, `scenario ${key} has no label`);
    assert.ok(app.SCENARIOS[key].toast, `scenario ${key} has no toast`);
  }
});

test("distributed architecture constants and state are coherent", () => {
  assert.equal(app.AI_LEVELS.map((level) => level.id).join(","), "drone,group,network,human");
  assert.equal(app.COMM_CHANNELS.map((ch) => ch.id).join(","), "safety,telemetry,bulk");
  assert.deepEqual(Object.keys(app.state.channels), ["safety", "telemetry", "bulk"]);
  assert.ok(app.CFG.leaseSeconds > 0);
  assert.ok(app.CFG.quorumNeeded > 0);
  assert.ok(app.PERF_TARGETS.failoverSeconds <= 5);
  assert.ok(app.state.coordination.epoch >= 1);
  assert.ok(Array.isArray(app.state.observations));
  assert.ok(Array.isArray(app.state.audit));
  const summary = app.buildRunSummary();
  assert.equal(summary.architecture.aiLevels.length, 4);
  assert.equal(summary.architecture.channels.length, 3);
  assert.ok(summary.architecture.performanceTargets.failoverSeconds <= 5);
});

test("world descriptor drives a doubled arena and opposite ground posts", () => {
  assert.equal(app.WORLD.scale, 2);
  assert.equal(app.WORLD.halfExtent, 39);
  assert.ok(Math.abs(app.MAIN_POS.x + app.BKUP_POS.x) < 0.001);
  assert.ok(Math.abs(app.MAIN_POS.z + app.BKUP_POS.z) < 0.001);
  const span = Math.hypot(app.BKUP_POS.x - app.MAIN_POS.x, app.BKUP_POS.z - app.MAIN_POS.z);
  assert.ok(span > 80, "posts should sit at opposite ends of the enlarged map");
  const summary = app.buildRunSummary();
  assert.equal(summary.world.width, 78);
  assert.equal(summary.world.posts.main.x, app.MAIN_POS.x);
});

test("industrial and urban building archetypes are physical", () => {
  for (const [mapId, expected] of [["industrial", "warehouse"], ["urban", "apartment"]]) {
    app.state.mapId = mapId;
    app.state.time = 0;
    app.state.recall = false;
    app.setSeed(42);
    app.buildTerrain(mapId);
    const types = app.state.terrain.buildings.map((b) => b.type);
    assert.ok(types.includes(expected), `${mapId} should use ${expected} buildings, got ${types.join(",")}`);
  }
});

test("drones receive real waypoint missions and fly them with flight modes", () => {
  app.state.recall = false;
  app.state.time = 0;
  app.makeDrones();
  for (const d of app.state.drones) d.connected = true;
  const start = app.state.drones.map((d) => ({ x: d.pos.x, z: d.pos.z }));
  assert.equal(app.state.drones.length, 12);
  for (const d of app.state.drones) {
    assert.ok(d.mission, "drone has no mission");
    assert.ok(d.waypoints.length >= 2, "mission has no route");
    assert.equal(d.autonomyMode, "takeoff");
    assert.ok(Number.isFinite(d.heading));
    assert.ok(Math.abs(d.pos.x) <= app.WORLD.halfExtent);
  }
  for (let i = 0; i < 60; i++) {
    app.state.time += 0.1;
    app.updateAutonomy(0.1);
  }
  const moved = app.state.drones.filter((d, i) =>
    Math.hypot(d.pos.x - start[i].x, d.pos.z - start[i].z) > 0.2
  );
  assert.ok(moved.length >= 6, "mission routes should move most of the fleet");
  assert.ok(app.state.drones.every((d) => Number.isFinite(d.pos.y)));
  assert.ok(app.state.drones.some((d) => d.autonomyMode === "route" || d.autonomyMode === "survey"));
  const summary = app.buildRunSummary();
  assert.equal(summary.fleet.length, 12);
  assert.ok(summary.fleet.every((d) => d.waypointCount >= 2));
});

test("staggered relay patrol keeps the doubled mesh connected", () => {
  assert.equal(new Set(app.RELAY_PHASES).size, 6);
  assert.ok(app.RELAY_PHASES.some((phase) => phase % 2 === 0));
  assert.ok(app.RELAY_PHASES.some((phase) => phase % 2 === 1));
  for (const mapId of Object.keys(app.MAPS)) {
    app.state.mapId = mapId;
    app.state.situation = "routine";
    app.state.time = 0;
    app.state.recall = false;
    app.setSeed(42);
    app.buildTerrain(mapId);
    app.makeDrones();
    app.computeNetwork();
    assert.equal(app.state.connectedCount, 12, `${mapId} started partitioned`);
    for (let step = 0; step < 200; step++) {
      app.state.time += 0.1;
      app.updateAutonomy(0.1);
      if (step % 10 === 9) app.computeNetwork();
    }
    assert.equal(app.state.connectedCount, 12, `${mapId} relay patrol lost the mesh`);
  }
});

test("safety precedence overrides mission flight modes", () => {
  app.state.recall = false;
  app.makeDrones();
  const [failed, held, reserve] = app.state.drones;
  failed.failed = true;
  held.trusted = false;
  reserve.battery = 5;
  for (const d of app.state.drones) {
    d.connected = true;
    d.autonomyMode = "route";
  }
  app.updateAutonomy(0.1);
  assert.equal(failed.autonomyMode, "failed");
  assert.equal(held.autonomyMode, "hold");
  assert.equal(reserve.autonomyMode, "rtl");
});

test("observations are delayed by routing and require heading and line of sight", () => {
  app.state.time = 0;
  app.state.mapSyncAcc = 0;
  app.state.observations = [];
  app.state.pendingObservations = [];
  app.state.stats.observations = 0;
  app.state.coordination.epoch = 1;
  app.state.features = [{
    id: "F1", type: "fire", label: "Test fire", homeX: 0, homeZ: 0, x: 0, z: 0,
    baseR: 1, r: 1, phase: 0, observedAt: 0, age: 0, confidence: 50,
    observers: 0, liveState: "live", sourceDrone: null, dataType: "thermal",
    fused: false, expiresAt: 30, observationId: null
  }];
  app.makeDrones();
  const d = app.state.drones[0];
  d.pos = { x: -5, y: 4, z: 0 };
  d.heading = 0;
  d.autonomyMode = "route";
  d.trusted = true;
  d.failed = false;
  d.connected = true;
  d.hops = 0;
  app.state.activeDrones = app.state.drones;

  app.updateMapFeatures(2.6);
  assert.equal(app.state.pendingObservations.length, 1, "observation should be queued, not injected");
  assert.equal(app.state.observations.length, 0, "shared map must not update instantly");
  app.state.time = 10;
  app.updateMapFeatures(2.6);
  assert.ok(app.state.observations.length >= 1, "routed observation should be delivered later");
  assert.equal(app.state.observations.length, 1, "only the first queued record should be delivered");
  assert.equal(app.state.stats.observations, 2, "the second sync tick queues a fresh record");

  app.state.observations = [];
  app.state.pendingObservations = [];
  app.state.mapSyncAcc = 0;
  app.state.time = 20;
  app.state.activeDrones = [d];
  d.heading = Math.PI;
  app.updateMapFeatures(2.6);
  assert.equal(app.state.pendingObservations.length, 0, "feature behind the aircraft must not be observed");
});

test("telemetry history is sampled on simulated time and capped", () => {
  app.state.history = [];
  app.state.historyAcc = 0;
  app.state.historyPackets = 0;
  app.state.stats.packets = 0;
  for (let i = 0; i < 250; i++) {
    app.state.stats.packets += 3;
    app.sampleTelemetry(0.5);
  }
  assert.equal(app.state.history.length, 120, "history should keep 120 samples");
  assert.equal(app.state.history[0].packetRate, 6, "packet rate should be per second");
  const summary = app.buildRunSummary();
  assert.equal(summary.version, "6.0.0");
  assert.equal(summary.telemetry.intervalSeconds, 0.5);
  assert.equal(summary.telemetry.samples.length, 120);
});

test("export filenames and CSV quoting are safe", () => {
  app.state.seed = 7;
  app.state.scenario = "blackout";
  assert.equal(app.runFileName("png"), "nexus-run-7-blackout.png");
  assert.equal(app.csvCell('a,"b"'), '"a,""b"""');
  assert.equal(app.csvCell(null), "");
});
