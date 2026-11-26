import test from "node:test";
import assert from "node:assert/strict";

await import("../assets/drone-system.js");
const DS = globalThis.NexusDroneSystem;

function makeSystem(overrides = {}) {
  return DS.createDroneSystem(Object.assign({
    config: Object.assign({}, DS.DEFAULT_CONFIG, { count: 4 }),
    world: DS.DEFAULT_WORLD,
    posts: DS.DEFAULT_POSTS,
    random: () => 0.5,
    heightAt: () => 0,
    situation: () => ({ sensor: 1, liveFor: 7, staleFor: 16, sync: 1 }),
    log: () => {},
    audit: () => {}
  }, overrides));
}

function makeState(overrides = {}) {
  return Object.assign({
    time: 0,
    recall: false,
    features: [],
    drones: [],
    activeDrones: [],
    observations: [],
    pendingObservations: [],
    obsSeq: 0,
    mapSyncAcc: 0,
    stats: { observations: 0, expiredObservations: 0, staleRejected: 0 },
    coordination: { epoch: 1 },
    channels: {
      telemetry: { latency: 0.08 },
      bulk: { latency: 0.24 }
    },
    safety: { reserve: 25 },
    terrain: null
  }, overrides);
}

const features = [
  { id: "F1", type: "fire", x: -8, z: 2, r: 1 },
  { id: "F2", type: "survivor", x: 9, z: -3, r: 1 }
];

test("drone system exposes a complete public API", () => {
  assert.equal(DS.VERSION, "6.0.0");
  assert.equal(DS.AUTONOMY_MODES.length, 7);
  assert.deepEqual(DS.RELAY_PHASES, [0, 1, 2, 6, 7, 10]);
  assert.equal(typeof DS.DroneSystem, "function");
  assert.equal(typeof DS.createDroneSystem, "function");
  assert.equal(typeof DS.angleBetween, "function");
});

test("mission planner produces waypoint routes and matching task queues", () => {
  const sys = makeSystem();
  const state = makeState();
  const drones = sys.createDrones(4, features, state);
  assert.equal(drones.length, 4);
  assert.equal(state.drones, drones);
  for (const d of drones) {
    assert.ok(d.mission);
    assert.ok(d.waypoints.length >= 2);
    assert.equal(d.taskQueue.length, d.waypoints.length);
    assert.ok(Number.isFinite(d.heading));
    assert.equal(d.autonomyMode, "takeoff");
  }
  assert.ok(drones.some((d) => d.mission === "relay corridor"));
  assert.ok(drones.some((d) => d.mission === "feature survey"));
});

test("explicit task queue helpers add, read and clear tasks", () => {
  const sys = makeSystem();
  const state = makeState();
  const [d] = sys.createDrones(1, features, state);
  sys.clearTasks(d);
  assert.equal(d.waypoints.length, 0);
  const task = sys.enqueueTask(d, sys.createTask("waypoint", { x: 4, z: -2, hold: 1 }));
  assert.equal(sys.nextTask(d).id, task.id);
  assert.equal(d.waypoints.length, 1);
  sys.setMission(d, "test route", [{ x: 1, z: 1 }, { x: 2, z: 2 }]);
  assert.equal(d.mission, "test route");
  assert.equal(d.taskQueue.length, 2);
});

test("autonomy state machine flies missions and respects local safety", () => {
  const sys = makeSystem();
  const state = makeState();
  const drones = sys.createDrones(4, features, state);
  for (const d of drones) d.connected = true;
  for (let i = 0; i < 60; i++) {
    state.time += 0.1;
    sys.updateAutonomy(0.1, state);
  }
  assert.ok(drones.some((d) => d.autonomyMode === "route" || d.autonomyMode === "survey"));
  assert.ok(drones.every((d) => d.flightTime > 0));

  const [failed, held, reserve] = drones;
  failed.failed = true;
  held.trusted = false;
  reserve.battery = 5;
  for (const d of drones) {
    d.connected = true;
    d.autonomyMode = "route";
  }
  sys.updateAutonomy(0.1, state);
  assert.equal(failed.autonomyMode, "failed");
  assert.equal(held.autonomyMode, "hold");
  assert.equal(reserve.autonomyMode, "rtl");
});

test("observations are routed with delay, heading and line-of-sight checks", () => {
  const sys = makeSystem({ config: Object.assign({}, DS.DEFAULT_CONFIG, { count: 1 }) });
  const f = {
    id: "F1", type: "fire", label: "Test fire", homeX: 0, homeZ: 0, x: 0, z: 0,
    baseR: 1, r: 1, phase: 0, observedAt: 0, age: 0, confidence: 50,
    observers: 0, liveState: "live", sourceDrone: null, dataType: "thermal",
    fused: false, expiresAt: 30, observationId: null
  };
  const state = makeState({ features: [f] });
  const [d] = sys.createDrones(1, [f], state);
  d.pos = { x: -5, y: 4, z: 0 };
  d.heading = 0;
  d.autonomyMode = "route";
  d.connected = true;
  d.hops = 0;
  state.activeDrones = [d];

  sys.updateMapFeatures(2.6, state);
  assert.equal(state.pendingObservations.length, 1);
  assert.equal(state.observations.length, 0);

  state.time = 10;
  sys.updateMapFeatures(2.6, state);
  assert.equal(state.observations.length, 1);
  assert.equal(state.stats.observations, 2);

  state.observations = [];
  state.pendingObservations = [];
  state.mapSyncAcc = 0;
  state.time = 20;
  state.activeDrones = [d];
  d.heading = Math.PI;
  sys.updateMapFeatures(2.6, state);
  assert.equal(state.pendingObservations.length, 0);
});

test("fault helpers isolate, recall, fail and restore aircraft", () => {
  const sys = makeSystem();
  const state = makeState();
  const [d] = sys.createDrones(1, features, state);
  d.connected = true;

  sys.isolateDrone(d);
  assert.equal(d.trusted, false);
  assert.equal(d.autonomyMode, "hold");
  sys.trustDrone(d);
  assert.equal(d.trusted, true);
  assert.equal(d.autonomyMode, "route");

  sys.recallAll(state);
  sys.updateAutonomy(0.1, state);
  assert.equal(d.autonomyMode, "rtl");
  sys.releaseRecall(state);
  assert.equal(state.recall, false);

  sys.failDrone(d, state, 5);
  assert.equal(d.failed, true);
  assert.equal(d.failedAt, 5);
  sys.restoreDrone(d);
  assert.equal(d.failed, false);
  assert.equal(d.autonomyMode, "takeoff");
});

test("radio line of sight is blocked by terrain and structures", () => {
  const sys = makeSystem({
    heightAt: () => 0,
    buildings: () => [{ x: 0, z: 0, w: 2, d: 2, h: 5 }]
  });
  const state = makeState({ terrain: { buildings: [{ x: 0, z: 0, w: 2, d: 2, h: 5 }], waterLevel: 0 } });
  assert.equal(sys.radioLineBlocked({ x: -5, y: 4, z: 0 }, { x: 5, y: 4, z: 0 }, "D1", "D2", state), true);
  assert.equal(sys.radioLineBlocked({ x: -5, y: 10, z: 0 }, { x: 5, y: 10, z: 0 }, "D1", "D2", state), false);
});

test("fleet summary reports mission and flight state", () => {
  const sys = makeSystem();
  const state = makeState();
  const drones = sys.createDrones(4, features, state);
  const summary = sys.buildFleetSummary(drones);
  assert.equal(summary.length, 4);
  assert.ok(summary.every((d) => d.waypointCount >= 2));
  assert.ok(summary.every((d) => Number.isFinite(d.battery)));
  assert.ok(summary.every((d) => typeof d.mode === "string"));
});
