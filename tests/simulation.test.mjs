import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import vm from "node:vm";

const root = fileURLToPath(new URL("..", import.meta.url));
let source = readFileSync(join(root, "assets/app.js"), "utf8");

/* The app is an IIFE that boots against the DOM. For tests we replace the
   boot call with an export of its private helpers, then run it in a tiny
   browser-like sandbox. Production code is untouched. */
const exportLine = `
  globalThis.__NEXUS_TEST__ = {
    state, CFG, SCENARIOS, MAPS, SITUATIONS, AI_LEVELS, COMM_CHANNELS, PERF_TARGETS,
    setSeed, nextRandom, normalizeSeed, fmtClock,
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
  assert.equal(summary.version, "2.0.0");
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
