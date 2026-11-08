/* ============================================================
   NEXUS AI — interactive proposal + command center
   Plain browser JavaScript. No external data, no trackers.
   ============================================================ */
(() => {
  "use strict";

  /* ---------------- small helpers ---------------- */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const TAU = Math.PI * 2;
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

  /* ---------------- seeded randomness ----------------
     A single PRNG drives every simulated random choice so the same
     seed + scenario always produces the same run on any device. */

  const SEED_LIMIT = 4294967296;
  let rngState = 0x9e3779b9;

  const normalizeSeed = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return ((Math.floor(Math.abs(n)) % SEED_LIMIT) >>> 0);
  };

  function setSeed(seed) {
    const normalized = normalizeSeed(seed);
    rngState = normalized === null ? 0x9e3779b9 : normalized;
  }

  function nextRandom() {
    rngState = (rngState + 0x6d2b79f5) >>> 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / SEED_LIMIT;
  }

  function makeSeed() {
    if (window.crypto && window.crypto.getRandomValues) {
      const buf = new Uint32Array(1);
      window.crypto.getRandomValues(buf);
      return buf[0] % 1000000000;
    }
    return Math.floor(Math.random() * 1000000000);
  }

  const rand = (min, max) => min + nextRandom() * (max - min);
  const pick = (arr) => arr[Math.floor(nextRandom() * arr.length)];
  const pairKey = (a, b) => (a < b ? a + "|" + b : b + "|" + a);
  const fmtClock = (t) => {
    const s = Math.max(0, Math.floor(t));
    const m = Math.floor(s / 60);
    return "T+" + String(m).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  };
  const fmtNum = (n) => Math.round(n).toLocaleString("en-US");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const C = {
    cyan: "#22d3ee",
    cyan2: "#67e8f9",
    teal: "#2dd4bf",
    blue: "#38bdf8",
    amber: "#fbbf24",
    red: "#fb7185",
    green: "#34d399",
    violet: "#a78bfa",
    ink: "#e8f3fa",
    muted: "#7c98ac",
    faint: "#557084"
  };

  const CFG = {
    count: 12,
    droneRange: 8.4,
    mainRange: 11.5,
    backupRange: 10.8,
    handover: 2.5,
    networkStep: 0.16,
    maxSevered: 7,
    recordStep: 3.2,
    sensorRange: 7.4,
    mapSyncStep: 2.5,
    maxLog: 42
  };

  const MAIN_POS = { x: 0, y: 7.8, z: 0 };
  const BKUP_POS = { x: -6.2, y: 5.0, z: -6.2 };
  const ZONE_POS = { x: -7.2, z: 5.4 };
  const ZONE_R = 4.6;
  const STORM_X = 2.4;

  const CAM_PRESETS = {
    overview: { yaw: -0.65, pitch: 0.52, dist: 38, target: [0, 2.4, 0], auto: false },
    top: { yaw: 0, pitch: 1.47, dist: 42, target: [0, 0.6, 0], auto: false },
    front: { yaw: -1.48, pitch: 0.24, dist: 35, target: [0, 2.6, 0], auto: false },
    orbit: { yaw: -0.65, pitch: 0.44, dist: 38, target: [0, 2.4, 0], auto: true }
  };

  const SCENARIOS = {
    mesh: {
      id: "mesh",
      label: "Cut the mesh",
      toast: "Scenario: eastern mesh cut. A local group should form."
    },
    main: {
      id: "main",
      label: "Fail the Main AI",
      toast: "Scenario: Main AI down. Failover starts after a 2.5s health check."
    },
    drone: {
      id: "drone",
      label: "Lose a drone",
      toast: "Scenario: D07 lost. Its last observation is retained as stale."
    }
  };

  /* ---------------- shared environmental map ----------------
     Each map is a monitored area with its own terrain and feature set.
     Features are refreshed when a connected drone has them in sensor
     range; otherwise their record ages and is clearly marked stale. */

  const FEATURE_TYPES = {
    fire: { label: "Fire", color: "#fb7185", rgba: "251, 113, 133", glyph: "flame" },
    hotspot: { label: "Hotspot", color: "#fbbf24", rgba: "251, 191, 36", glyph: "diamond" },
    survivor: { label: "Survivor", color: "#34d399", rgba: "52, 211, 153", glyph: "plus" },
    vehicle: { label: "Vehicle", color: "#38bdf8", rgba: "56, 189, 248", glyph: "square" },
    flood: { label: "Flood water", color: "#60a5fa", rgba: "96, 165, 250", glyph: "wave" },
    smoke: { label: "Smoke", color: "#94a3b8", rgba: "148, 163, 184", glyph: "circle" },
    structure: { label: "Structure", color: "#a78bfa", rgba: "167, 139, 250", glyph: "hex" },
    hazard: { label: "Hazard", color: "#fb923c", rgba: "251, 146, 60", glyph: "alert" }
  };

  const MAPS = {
    wildfire: {
      id: "wildfire",
      label: "Wildfire",
      place: "Sector 04 · Ridge line",
      hint: "Fire fronts, hotspots and smoke. Watch for wind-driven spread.",
      palette: {
        ground: "rgba(120, 53, 15, 0.14)",
        edge: "rgba(251, 146, 60, 0.28)",
        line: "rgba(251, 146, 60, 0.12)"
      },
      decor: [
        { kind: "ellipse", x: -5, z: 3, rx: 11, rz: 7, color: "rgba(251, 146, 60, 0.055)" },
        { kind: "ellipse", x: 6, z: -4, rx: 8, rz: 5, color: "rgba(251, 113, 133, 0.05)" },
        { kind: "ellipse", x: 0, z: 0, rx: 18, rz: 14, color: "rgba(251, 191, 36, 0.025)" }
      ],
      features: [
        { id: "F1", type: "fire", label: "Fire 1", x: -8.4, z: 4.6, r: 3.4 },
        { id: "F2", type: "fire", label: "Fire 2", x: 6.8, z: -5.2, r: 2.7 },
        { id: "S1", type: "survivor", label: "Survivor 1", x: 9.4, z: 6.4, r: 1.1 },
        { id: "V1", type: "vehicle", label: "Vehicle 1", x: -4.6, z: -8.8, r: 1.3 },
        { id: "H1", type: "hotspot", label: "Hotspot 1", x: 1.2, z: 9.2, r: 2.2 },
        { id: "M1", type: "smoke", label: "Smoke 1", x: -11.2, z: -2.4, r: 3.8 }
      ]
    },
    flood: {
      id: "flood",
      label: "Flood",
      place: "Lower basin · River district",
      hint: "Rising water, stranded people and damaged structures.",
      palette: {
        ground: "rgba(30, 64, 120, 0.2)",
        edge: "rgba(96, 165, 250, 0.34)",
        line: "rgba(96, 165, 250, 0.13)"
      },
      decor: [
        {
          kind: "poly",
          points: [[-20, -7], [-9, -9], [1, -4], [10, -6], [20, -2], [20, 6], [8, 4], [-2, 8], [-13, 5], [-20, 8]],
          color: "rgba(37, 99, 235, 0.16)"
        },
        {
          kind: "poly",
          points: [[-20, 9], [-10, 11], [2, 9], [12, 13], [20, 11], [20, 20], [-20, 20]],
          color: "rgba(56, 189, 248, 0.07)"
        },
        { kind: "rect", x1: -16, z1: -16, x2: 16, z2: -13, color: "rgba(148, 163, 184, 0.08)" }
      ],
      features: [
        { id: "W1", type: "flood", label: "Flood 1", x: -7.2, z: 4.2, r: 4.6 },
        { id: "W2", type: "flood", label: "Flood 2", x: 5.6, z: 5.8, r: 3.6 },
        { id: "S1", type: "survivor", label: "Survivor 1", x: 8.6, z: -6.4, r: 1.1 },
        { id: "V1", type: "vehicle", label: "Vehicle 1", x: -2.4, z: -9.2, r: 1.3 },
        { id: "B1", type: "structure", label: "Bridge 1", x: -10.8, z: -5.6, r: 2.4 },
        { id: "H1", type: "hazard", label: "Hazard 1", x: 2.8, z: 9.4, r: 1.8 }
      ]
    },
    sar: {
      id: "sar",
      label: "Search & rescue",
      place: "North forest · Trail network",
      hint: "Two survivors, a support vehicle and an active fire edge.",
      palette: {
        ground: "rgba(6, 78, 59, 0.18)",
        edge: "rgba(52, 211, 153, 0.28)",
        line: "rgba(52, 211, 153, 0.11)"
      },
      decor: [
        { kind: "ellipse", x: -6, z: -2, rx: 13, rz: 10, color: "rgba(16, 185, 129, 0.06)" },
        { kind: "ellipse", x: 7, z: 5, rx: 9, rz: 7, color: "rgba(16, 185, 129, 0.05)" },
        { kind: "rect", x1: -18, z1: -1, x2: 18, z2: 0.2, color: "rgba(148, 163, 184, 0.09)" },
        { kind: "rect", x1: 0, z1: -18, x2: 1.2, z2: 18, color: "rgba(148, 163, 184, 0.09)" }
      ],
      features: [
        { id: "S1", type: "survivor", label: "Survivor 1", x: -6.8, z: 5.6, r: 1.1 },
        { id: "S2", type: "survivor", label: "Survivor 2", x: 7.4, z: -5.2, r: 1.1 },
        { id: "V1", type: "vehicle", label: "Vehicle 1", x: -3.2, z: -8.6, r: 1.3 },
        { id: "F1", type: "fire", label: "Fire 1", x: 9.2, z: 6.8, r: 2.4 },
        { id: "B1", type: "structure", label: "Cabin 1", x: -10.4, z: -4.2, r: 2.2 },
        { id: "H1", type: "hotspot", label: "Hotspot 1", x: 1.6, z: 9.4, r: 1.6 }
      ]
    },
    industrial: {
      id: "industrial",
      label: "Industrial",
      place: "Zone 7 · Plant perimeter",
      hint: "Chemical hazards, a fire and workers inside a dense site.",
      palette: {
        ground: "rgba(76, 29, 149, 0.14)",
        edge: "rgba(167, 139, 250, 0.3)",
        line: "rgba(167, 139, 250, 0.11)"
      },
      decor: [
        { kind: "rect", x1: -15, z1: -12, x2: -5, z2: -2, color: "rgba(148, 163, 184, 0.07)" },
        { kind: "rect", x1: 1, z1: -14, x2: 13, z2: -5, color: "rgba(148, 163, 184, 0.07)" },
        { kind: "rect", x1: -12, z1: 3, x2: -2, z2: 12, color: "rgba(148, 163, 184, 0.07)" },
        { kind: "rect", x1: 4, z1: 4, x2: 15, z2: 13, color: "rgba(148, 163, 184, 0.07)" },
        { kind: "rect", x1: -1, z1: -2, x2: 0.4, z2: 3, color: "rgba(251, 191, 36, 0.1)" }
      ],
      features: [
        { id: "H1", type: "hazard", label: "Hazard 1", x: -7.8, z: 4.8, r: 3.0 },
        { id: "H2", type: "hazard", label: "Hazard 2", x: 5.6, z: -5.8, r: 2.6 },
        { id: "F1", type: "fire", label: "Fire 1", x: 7.8, z: 6.2, r: 2.2 },
        { id: "B1", type: "structure", label: "Plant 1", x: -4.2, z: -8.6, r: 2.0 },
        { id: "V1", type: "vehicle", label: "Vehicle 1", x: 1.4, z: 8.8, r: 1.2 },
        { id: "S1", type: "survivor", label: "Worker 1", x: -10.6, z: -2.8, r: 1.1 }
      ]
    },
    urban: {
      id: "urban",
      label: "Urban",
      place: "Downtown grid · Block survey",
      hint: "Dense blocks, roads and vehicles. Watch cover between buildings.",
      palette: {
        ground: "rgba(30, 41, 59, 0.2)",
        edge: "rgba(103, 232, 249, 0.3)",
        line: "rgba(103, 232, 249, 0.12)"
      },
      decor: [
        { kind: "rect", x1: -15, z1: -15, x2: 15, z2: -15.5, color: "rgba(148, 163, 184, 0.08)" },
        { kind: "rect", x1: -15, z1: 15, x2: 15, z2: 15.5, color: "rgba(148, 163, 184, 0.08)" }
      ],
      features: [
        { id: "S1", type: "survivor", label: "Survivor 1", x: -8.2, z: -8.4, r: 1.1 },
        { id: "S2", type: "survivor", label: "Survivor 2", x: 9.2, z: 7.4, r: 1.1 },
        { id: "V1", type: "vehicle", label: "Vehicle 1", x: 3.2, z: -9.4, r: 1.3 },
        { id: "H1", type: "hazard", label: "Collapse 1", x: 7.2, z: -3.2, r: 2.4 },
        { id: "B1", type: "structure", label: "Office 1", x: -11.2, z: 9.2, r: 2.2 },
        { id: "F1", type: "fire", label: "Fire 1", x: 11.4, z: -9.8, r: 2.2 }
      ]
    },
    mountain: {
      id: "mountain",
      label: "Mountain",
      place: "High ridge · Summit trails",
      hint: "High ground and thin trails. Survivors above the treeline.",
      palette: {
        ground: "rgba(100, 116, 139, 0.15)",
        edge: "rgba(148, 163, 184, 0.3)",
        line: "rgba(148, 163, 184, 0.12)"
      },
      decor: [
        { kind: "ellipse", x: 5, z: 8, rx: 12, rz: 9, color: "rgba(148, 163, 184, 0.07)" },
        { kind: "ellipse", x: -8, z: -8, rx: 10, rz: 8, color: "rgba(148, 163, 184, 0.06)" }
      ],
      features: [
        { id: "S1", type: "survivor", label: "Survivor 1", x: -6.0, z: 8.2, r: 1.1 },
        { id: "S2", type: "survivor", label: "Survivor 2", x: 10.2, z: -11.4, r: 1.1 },
        { id: "F1", type: "fire", label: "Fire 1", x: 7.4, z: 6.2, r: 2.4 },
        { id: "H1", type: "hotspot", label: "Hotspot 1", x: -11.4, z: 2.2, r: 1.9 },
        { id: "B1", type: "structure", label: "Hut 1", x: -9.4, z: -8.4, r: 2.0 },
        { id: "V1", type: "vehicle", label: "Vehicle 1", x: 2.2, z: -13.2, r: 1.3 }
      ]
    },
    coast: {
      id: "coast",
      label: "Coast",
      place: "Harbor mouth · Beach line",
      hint: "Shoreline, boats and stranded people. Watch the waterline.",
      palette: {
        ground: "rgba(8, 47, 73, 0.2)",
        edge: "rgba(56, 189, 248, 0.32)",
        line: "rgba(56, 189, 248, 0.13)"
      },
      decor: [
        {
          kind: "poly",
          points: [[-20, 2], [-8, 4], [4, 3], [14, 5], [20, 3], [20, 20], [-20, 20]],
          color: "rgba(14, 116, 144, 0.18)"
        },
        { kind: "rect", x1: -19, z1: -3, x2: 19, z2: -1.2, color: "rgba(217, 196, 147, 0.1)" }
      ],
      features: [
        { id: "W1", type: "flood", label: "Tide 1", x: 0.4, z: 6.4, r: 4.2 },
        { id: "S1", type: "survivor", label: "Survivor 1", x: -8.4, z: -2.2, r: 1.1 },
        { id: "S2", type: "survivor", label: "Survivor 2", x: 9.4, z: -3.4, r: 1.1 },
        { id: "V1", type: "vehicle", label: "Boat 1", x: 5.2, z: 8.6, r: 1.4 },
        { id: "B1", type: "structure", label: "Harbor 1", x: -11.2, z: 7.4, r: 2.2 },
        { id: "H1", type: "hazard", label: "Rocks 1", x: 2.4, z: -9.4, r: 1.9 }
      ]
    },
    battlefield: {
      id: "battlefield",
      label: "Battlefield",
      place: "Training field · Cratered plain",
      hint: "Craters, trenches and cover in a full battlefield scene. Watch the open ground.",
      palette: {
        ground: "rgba(120, 53, 15, 0.16)",
        edge: "rgba(251, 163, 74, 0.3)",
        line: "rgba(251, 163, 74, 0.12)"
      },
      decor: [
        { kind: "ellipse", x: -7, z: 5, rx: 7, rz: 6, color: "rgba(120, 53, 15, 0.12)" },
        { kind: "ellipse", x: 6, z: -6, rx: 7, rz: 6, color: "rgba(120, 53, 15, 0.12)" },
        { kind: "ellipse", x: 9, z: 7, rx: 6, rz: 5, color: "rgba(251, 113, 133, 0.08)" }
      ],
      features: [
        { id: "H1", type: "hazard", label: "Crater 1", x: -7.2, z: 5.2, r: 3.0 },
        { id: "H2", type: "hazard", label: "Trench 1", x: 6.2, z: -6.4, r: 2.4 },
        { id: "F1", type: "fire", label: "Fire 1", x: 9.2, z: 7.4, r: 2.4 },
        { id: "S1", type: "survivor", label: "Survivor 1", x: -3.2, z: -9.2, r: 1.1 },
        { id: "V1", type: "vehicle", label: "Vehicle 1", x: 2.4, z: 10.2, r: 1.3 },
        { id: "B1", type: "structure", label: "Bunker 1", x: -11.2, z: -4.2, r: 2.2 }
      ]
    }
  };

  const SITUATIONS = {
    routine: {
      id: "routine",
      label: "Routine watch",
      hint: "Normal patrol. Features refresh whenever a drone has them in range.",
      sensor: 1,
      liveFor: 8,
      staleFor: 18,
      sync: 1
    },
    spread: {
      id: "spread",
      label: "Rapid spread",
      hint: "Hazards expand continuously; unobserved ones spread much faster.",
      sensor: 1,
      liveFor: 8,
      staleFor: 18,
      sync: 1,
      spread: 0.055
    },
    night: {
      id: "night",
      label: "Night search",
      hint: "Shorter sensor range in the dark. Unobserved records age faster.",
      sensor: 0.64,
      liveFor: 6,
      staleFor: 14,
      sync: 0.8,
      drift: true,
      night: true
    },
    blackout: {
      id: "blackout",
      label: "Comms blackout",
      hint: "Degraded uplink. The shared map syncs slowly and freshness decays.",
      sensor: 0.78,
      liveFor: 5,
      staleFor: 12,
      sync: 0.32
    }
  };

  const currentMap = () => MAPS[state.mapId] || MAPS.wildfire;
  const currentSituation = () => SITUATIONS[state.situation] || SITUATIONS.routine;

  /* ---------------- battlefield terrain (arena-inspired) ----------------
     Each map gets a full battlefield look: heightfield hills, water,
     forest cones, rocks, buildings and roads. The height function mirrors
     the reference's smoothed noise hillfield, scaled from 240x240 arena
     units into the 39x39 simulator world. Layout is deterministic per map
     so every run shows the same battlefield. */

  const MAP_TERRAIN = {
    wildfire: {
      heightScale: 0.115, heightBase: 0.15, waterLevel: 0.25,
      low: [0.09, 0.07, 0.04], mid: [0.08, 0.16, 0.10], high: [0.22, 0.30, 0.20],
      water: [0.10, 0.45, 0.75],
      treeCount: 150, treeHue: [0.24, 0.31], rockCount: 28,
      forestZones: [
        { x: -10, z: 8, rx: 12, rz: 9 }, { x: 10, z: -10, rx: 11, rz: 8 }, { x: -4, z: -12, rx: 10, rz: 7 }
      ],
      sparse: 0.15,
      roads: [[[-19, 10], [-8, 4], [4, -2], [19, -8]]],
      buildings: [
        { x: -12.5, z: 11.5, w: 2.0, d: 1.6, h: 0.8, type: "cabin" },
        { x: 11.0, z: 11.0, w: 2.4, d: 1.8, h: 1.1, type: "cabin" },
        { x: 0.0, z: -13.5, w: 1.6, d: 1.6, h: 2.2, type: "tower" }
      ]
    },
    flood: {
      heightScale: 0.075, heightBase: 0.05, waterLevel: 0.85,
      low: [0.03, 0.10, 0.18], mid: [0.05, 0.20, 0.26], high: [0.16, 0.32, 0.36],
      water: [0.09, 0.38, 0.68],
      treeCount: 70, treeHue: [0.32, 0.42], rockCount: 18,
      forestZones: [
        { x: -12, z: -10, rx: 10, rz: 8 }, { x: 12, z: 10, rx: 9, rz: 8 }
      ],
      sparse: 0.08,
      roads: [[[-19, -12], [0, -8], [19, -4]]],
      buildings: [
        { x: -13.5, z: -12.0, w: 2.2, d: 1.8, h: 0.9, type: "house" },
        { x: 13.5, z: -12.5, w: 2.4, d: 1.8, h: 1.0, type: "house" },
        { x: -11.0, z: -4.5, w: 5.5, d: 1.2, h: 0.5, type: "bridge" },
        { x: 0.0, z: -6.0, w: 2.0, d: 1.6, h: 0.9, type: "house" }
      ]
    },
    sar: {
      heightScale: 0.105, heightBase: 0.10, waterLevel: 0.30,
      low: [0.03, 0.12, 0.10], mid: [0.05, 0.24, 0.17], high: [0.18, 0.38, 0.30],
      water: [0.10, 0.45, 0.75],
      treeCount: 230, treeHue: [0.33, 0.44], rockCount: 36,
      forestZones: [
        { x: -10, z: 6, rx: 13, rz: 10 }, { x: 9, z: -8, rx: 12, rz: 9 }, { x: 0, z: 0, rx: 14, rz: 12 }
      ],
      sparse: 0.35,
      roads: [[[-19, 0], [19, 0]], [[0, -19], [0, 19]]],
      buildings: [
        { x: -10.4, z: -4.2, w: 2.6, d: 2.0, h: 0.8, type: "cabin" },
        { x: 6.0, z: 12.5, w: 2.0, d: 1.6, h: 0.7, type: "cabin" }
      ]
    },
    industrial: {
      heightScale: 0.055, heightBase: 0.18, waterLevel: 0.20,
      low: [0.06, 0.06, 0.07], mid: [0.12, 0.12, 0.13], high: [0.26, 0.26, 0.27],
      water: [0.08, 0.30, 0.42],
      treeCount: 28, treeHue: [0.25, 0.35], rockCount: 22,
      forestZones: [
        { x: -14, z: 14, rx: 8, rz: 6 }, { x: 14, z: -14, rx: 8, rz: 6 }
      ],
      sparse: 0.03,
      roads: [[[-19, -6], [19, -6]], [[-6, 19], [-6, -19]]],
      buildings: [
        { x: -10, z: -7, w: 3.2, d: 2.4, h: 1.5, type: "plant" },
        { x: 7, z: -9.5, w: 3.6, d: 2.6, h: 1.8, type: "plant" },
        { x: -7, z: 7.5, w: 3.0, d: 2.2, h: 1.3, type: "plant" },
        { x: 9.5, z: 9.0, w: 3.4, d: 2.4, h: 1.6, type: "plant" },
        { x: 0.0, z: 0.0, w: 1.2, d: 1.2, h: 2.4, type: "tower" },
        { x: -14.5, z: 0.0, w: 2.0, d: 1.6, h: 1.1, type: "tank" },
        { x: 14.5, z: 0.0, w: 2.0, d: 1.6, h: 1.1, type: "tank" }
      ]
    },
    urban: {
      heightScale: 0.03, heightBase: 0.18, waterLevel: 0.15,
      low: [0.08, 0.10, 0.13], mid: [0.14, 0.17, 0.21], high: [0.30, 0.34, 0.40],
      water: [0.15, 0.35, 0.55],
      treeCount: 15, treeHue: [0.28, 0.36], rockCount: 8,
      forestZones: [
        { x: -15, z: -15, rx: 5, rz: 5 }, { x: 15, z: 15, rx: 5, rz: 5 }
      ],
      sparse: 0.02,
      roads: [[[-19, -6], [19, -6]], [[-19, 6], [19, 6]], [[-6, -19], [-6, 19]], [[6, -19], [6, 19]]],
      buildings: [
        { x: -12, z: -12, w: 3.4, d: 3.2, h: 2.4, type: "plant" },
        { x: -12, z: 0, w: 3.4, d: 3.2, h: 3.0, type: "plant" },
        { x: -12, z: 12, w: 3.4, d: 3.2, h: 2.6, type: "plant" },
        { x: 0, z: -12, w: 3.4, d: 3.2, h: 2.2, type: "plant" },
        { x: 0, z: 12, w: 3.4, d: 3.2, h: 2.8, type: "plant" },
        { x: 12, z: -12, w: 3.4, d: 3.2, h: 3.0, type: "plant" },
        { x: 12, z: 0, w: 3.4, d: 3.2, h: 2.4, type: "plant" },
        { x: 12, z: 12, w: 3.4, d: 3.2, h: 2.6, type: "plant" },
        { x: -11.2, z: 9.2, w: 2.8, d: 2.6, h: 1.6, type: "house" }
      ]
    },
    mountain: {
      heightScale: 0.16, heightBase: 0.3, waterLevel: 0.2,
      low: [0.05, 0.08, 0.10], mid: [0.10, 0.16, 0.18], high: [0.28, 0.32, 0.34],
      water: [0.10, 0.35, 0.55],
      treeCount: 180, treeHue: [0.28, 0.36], rockCount: 50,
      forestZones: [
        { x: -10, z: 8, rx: 12, rz: 10 }, { x: 5, z: -4, rx: 12, rz: 10 }
      ],
      sparse: 0.2,
      roads: [[[-15, -15], [-5, -5], [5, 0], [15, 8]]],
      buildings: [
        { x: -9, z: -8, w: 2.4, d: 2.0, h: 0.8, type: "cabin" },
        { x: 0, z: 14, w: 1.6, d: 1.6, h: 2.2, type: "tower" },
        { x: 12, z: -6, w: 2.0, d: 1.6, h: 0.7, type: "house" }
      ]
    },
    coast: {
      heightScale: 0.09, heightBase: 0.0, waterLevel: 1.15,
      low: [0.04, 0.10, 0.18], mid: [0.32, 0.28, 0.16], high: [0.14, 0.24, 0.18],
      water: [0.12, 0.45, 0.75],
      treeCount: 60, treeHue: [0.30, 0.40], rockCount: 24,
      forestZones: [
        { x: -10, z: -10, rx: 10, rz: 8 }, { x: 10, z: -12, rx: 10, rz: 8 }
      ],
      sparse: 0.1,
      roads: [[[-19, -2], [19, -2]]],
      buildings: [
        { x: -12, z: 8, w: 2.4, d: 2.0, h: 0.9, type: "house" },
        { x: 12, z: 8, w: 2.4, d: 2.0, h: 0.9, type: "house" },
        { x: -11.2, z: 7.4, w: 2.6, d: 2.2, h: 0.8, type: "cabin" }
      ]
    },
    battlefield: {
      heightScale: 0.14, heightBase: 0.12, waterLevel: 0.3,
      low: [0.11, 0.08, 0.05], mid: [0.16, 0.12, 0.07], high: [0.24, 0.20, 0.12],
      water: [0.12, 0.25, 0.30],
      treeCount: 90, treeHue: [0.22, 0.30], rockCount: 60,
      forestZones: [
        { x: -12, z: -12, rx: 9, rz: 8 }, { x: 12, z: 12, rx: 9, rz: 8 }
      ],
      sparse: 0.12,
      roads: [[[-19, 0], [19, 0]], [[0, -19], [0, 19]]],
      buildings: [
        { x: -11.2, z: -4.2, w: 2.6, d: 2.2, h: 0.7, type: "plant" },
        { x: 8, z: -8, w: 2.4, d: 2.0, h: 0.6, type: "plant" },
        { x: -10, z: 9, w: 2.4, d: 2.0, h: 0.6, type: "plant" },
        { x: 0, z: -13.5, w: 1.6, d: 1.6, h: 2.2, type: "tower" }
      ]
    }
  };

  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function sstep(a, b, x) {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function terrainHeightFor(mapId, x, z) {
    const terr = MAP_TERRAIN[mapId] || MAP_TERRAIN.wildfire;
    const X = x * 6, Z = z * 6;
    let n = 12
      + 9 * Math.sin(X * 0.035 + 1.3) * Math.cos(Z * 0.03)
      + 5 * Math.sin(X * 0.07 + Z * 0.05)
      + 2.5 * Math.sin(X * 0.15 - Z * 0.11)
      + 3 * Math.cos(Z * 0.09 + X * 0.02);
    n -= 17 * Math.exp(-((X - 52) * (X - 52) + (Z - 58) * (Z - 58)) / 650);
    // Flatten pads at the Main and Backup AI so the bases sit level.
    const flats = [{ x: 0, z: 0 }, { x: -37.2, z: -37.2 }];
    for (const f of flats) {
      const l = Math.hypot(X - f.x, Z - f.z);
      const c = 1 - sstep(14, 32, l);
      n = n * (1 - c) + 12 * c;
    }
    let h = (n - 3) * terr.heightScale + terr.heightBase;
    if (mapId === "industrial") h += 0.12 * Math.sin(x * 1.7) * Math.cos(z * 1.5);
    if (mapId === "flood") h += 0.15 * Math.sin(x * 0.6 + z * 0.4);
    if (mapId === "urban") h += 0.06 * Math.sin(x * 1.9) * Math.cos(z * 1.7);
    if (mapId === "coast") h -= z * 0.035;
    if (mapId === "battlefield") {
      h -= 0.55 * Math.exp(-((x + 7) * (x + 7) + (z - 5) * (z - 5)) / 18);
      h -= 0.5 * Math.exp(-((x - 6) * (x - 6) + (z + 6) * (z + 6)) / 16);
      h -= 0.4 * Math.exp(-((x - 9) * (x - 9) + (z - 7) * (z - 7)) / 14);
    }
    return clamp(h, -0.7, 3.9);
  }

  function heightAt(x, z) {
    const cache = state.terrain;
    if (!cache || cache.mapId !== state.mapId) return terrainHeightFor(state.mapId, x, z);
    const N = cache.gridN, extent = cache.extent, step = cache.step;
    const gx = clamp((x + extent) / step, 0, N - 0.001);
    const gz = clamp((z + extent) / step, 0, N - 0.001);
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const W = N + 1;
    const h00 = cache.heights[j * W + i];
    const h10 = cache.heights[j * W + i + 1];
    const h01 = cache.heights[(j + 1) * W + i];
    const h11 = cache.heights[(j + 1) * W + i + 1];
    return h00 + (h10 - h00) * fx + (h01 - h00) * fz + (h00 - h10 - h01 + h11) * fx * fz;
  }

  function buildTerrain(mapId) {
    const terr = MAP_TERRAIN[mapId] || MAP_TERRAIN.wildfire;
    const map = MAPS[mapId] || MAPS.wildfire;
    const N = 30, extent = 19.5, step = (extent * 2) / N;
    const heights = new Float32Array((N + 1) * (N + 1));
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const x = -extent + i * step, z = -extent + j * step;
        heights[j * (N + 1) + i] = terrainHeightFor(mapId, x, z);
      }
    }
    const hazardTypes = { fire: true, hotspot: true, hazard: true, flood: true };
    const scorch = new Float32Array((N + 1) * (N + 1));
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const x = -extent + i * step, z = -extent + j * step;
        let s = 0;
        for (const f of map.features) {
          if (!hazardTypes[f.type]) continue;
          const s2 = clamp(1 - Math.hypot(x - f.x, z - f.z) / (f.r * 2.4), 0, 1);
          if (s2 > s) s = s2;
        }
        scorch[j * (N + 1) + i] = s;
      }
    }
    const rng = mulberry32(hashString("nexus-" + mapId + "-terrain"));
    const features = map.features;
    const trees = [];
    let attempts = 0;
    while (trees.length < terr.treeCount && attempts < 9000) {
      attempts++;
      const x = (rng() * 2 - 1) * 19, z = (rng() * 2 - 1) * 19;
      const h = terrainHeightFor(mapId, x, z);
      if (h < terr.waterLevel + 0.28 || h > 3.4) continue;
      if (Math.hypot(x, z) < 3.4 || Math.hypot(x + 6.2, z + 6.2) < 3.4) continue;
      let bad = false;
      for (const f of features) {
        if (Math.hypot(x - f.x, z - f.z) < f.r + 0.7) { bad = true; break; }
      }
      if (bad) continue;
      let inside = false;
      for (const zone of terr.forestZones) {
        const dx = (x - zone.x) / zone.rx, dz = (z - zone.z) / zone.rz;
        if (dx * dx + dz * dz < 1) { inside = true; break; }
      }
      if (rng() > (inside ? 1 : terr.sparse)) continue;
      trees.push({
        x, z,
        scale: 0.7 + rng() * 0.9,
        hue: terr.treeHue[0] + rng() * (terr.treeHue[1] - terr.treeHue[0]),
        sat: 0.45 + rng() * 0.2,
        light: 0.14 + rng() * 0.12
      });
    }
    const rocks = [];
    let rockAttempts = 0;
    while (rocks.length < terr.rockCount && rockAttempts < 3000) {
      rockAttempts++;
      const x = (rng() * 2 - 1) * 19, z = (rng() * 2 - 1) * 19;
      const h = terrainHeightFor(mapId, x, z);
      if (h < terr.waterLevel + 0.05 || h > 3.6) continue;
      if (Math.hypot(x, z) < 3.0) continue;
      rocks.push({ x, z, scale: 0.3 + rng() * 0.55, shade: 0.3 + rng() * 0.4 });
    }
    const buildings = terr.buildings.map((b) => ({
      x: b.x + (rng() - 0.5) * 0.4, z: b.z + (rng() - 0.5) * 0.4,
      w: b.w, d: b.d, h: b.h, type: b.type
    }));
    state.terrain = {
      mapId, gridN: N, extent, step, heights, scorch, trees, rocks, buildings,
      roads: terr.roads, waterLevel: terr.waterLevel
    };
    state.terrainSignature = mapId;
    if (state.three && state.three.ready) buildThreeMap(mapId);
  }

  function mixRGB(a, b, t) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  }



  /* ---------------- state ---------------- */

  const state = {
    time: 0,
    paused: false,
    speed: 1,
    seed: 0,
    scenario: null,
    mapId: "wildfire",
    situation: "routine",
    features: [],
    featureSignature: "",
    mapSyncAcc: 0,
    highlightFeature: null,
    highlightUntil: 0,
    drillActive: false,
    drillTimers: [],
    log: [],
    stats: { packets: 0, failovers: 0, reconciliations: 0 },
    uiClock: 0,
    view: "command",
    layers: {
      links: true,
      packets: true,
      coverage: false,
      observations: true,
      features: true,
      labels: true,
      grid: true
    },
    selected: null,
    hover: null,
    main: { active: true },
    backup: { active: true },
    acting: "MAIN",
    handoverTimer: 0,
    handoverTotal: CFG.handover,
    replicaAge: 0.2,
    storm: false,
    interference: false,
    severed: [],
    failedDrones: [],
    groups: [],
    groupSince: new Map(),
    edges: [],
    nodes: [],
    hops: new Map(),
    parent: new Map(),
    treeKeys: new Set(),
    activeDrones: [],
    records: 179,
    buffered: 0,
    recordAcc: 0,
    packets: [],
    packetAcc: 0,
    recall: false,
    recallStart: 0,
    recallUntil: 0,
    connectedCount: 12,
    avgHops: 1.5,
    freshest: 1,
    groupMembers: 0,
    drones: [],
    terrain: null,
    terrainSignature: "",
    three: null,
    canvas3d: null,
    camera: { yaw: -0.65, pitch: 0.52, dist: 38, target: [0, 2.4, 0], auto: false },
    camGoal: { yaw: -0.65, pitch: 0.52, dist: 38, target: [0, 2.4, 0], auto: false },
    dragging: false,
    dragMoved: 0,
    pinch: null,
    screenNodes: [],
    canvas: null,
    ctx: null,
    W: 0,
    H: 0,
    DPR: 1,
    toastTimer: null,
    uiSignature: "",
    inspectorSignature: ""
  };

  /* ---------------- drone setup ---------------- */

  function makeDrones() {
    const drones = [];
    for (let i = 0; i < CFG.count; i++) {
      const outer = i % 2 === 0;
      const baseRadius = outer ? 12.1 : 7.8;
      const baseAngle = (i / CFG.count) * TAU + (outer ? 0.16 : 0);
      const baseY = outer ? 5.1 + (i % 3) * 0.55 : 4.4 + (i % 4) * 0.5;
      drones.push({
        id: "D" + String(i + 1).padStart(2, "0"),
        idx: i,
        baseAngle,
        baseRadius,
        baseY,
        angle: baseAngle,
        radius: baseRadius,
        y: baseY,
        recallMix: 0,
        battery: Math.round(rand(72, 97)),
        phase: rand(0, TAU),
        failed: false,
        failedAt: 0,
        hops: null,
        connected: false,
        group: null,
        leader: false,
        status: "connected",
        obsAge: 1,
        pos: {
          x: Math.cos(baseAngle) * baseRadius,
          y: baseY,
          z: Math.sin(baseAngle) * baseRadius
        }
      });
    }
    state.drones = drones;
  }

  function updateDronePositions(dt) {
    const targetMix = state.recall ? 1 : 0;
    for (const d of state.drones) {
      d.recallMix = lerp(d.recallMix, targetMix, clamp(dt * 2.2, 0, 1));
      d.angle = d.baseAngle + state.time * 0.012;
      d.radius = lerp(d.baseRadius, 4.1, d.recallMix);
      d.y = lerp(d.baseY, 2.4, d.recallMix);
      d.pos.x = Math.cos(d.angle) * d.radius;
      d.pos.z = Math.sin(d.angle) * d.radius;
      const bob = Math.sin(state.time * 0.9 + d.phase) * 0.22;
      d.pos.y = Math.max(d.y + bob, heightAt(d.pos.x, d.pos.z) + 1.35);
      if (!d.failed) d.battery = Math.max(18, d.battery - dt * 0.018);
    }
  }

  /* ---------------- shared environmental map model ---------------- */

  function makeFeatures() {
    const map = currentMap();
    state.features = map.features.map((def, index) => ({
      id: def.id,
      type: def.type,
      label: def.label,
      homeX: def.x,
      homeZ: def.z,
      x: def.x,
      z: def.z,
      baseR: def.r,
      r: def.r,
      phase: index * 1.73,
      observedAt: 0,
      age: 0,
      confidence: 96,
      observers: 0,
      liveState: "live"
    }));
    state.featureSignature = "";
    // Build terrain AFTER features so the 3D feature markers match this map.
    buildTerrain(state.mapId);
  }

  function updateMapFeatures(dt) {
    const sit = currentSituation();
    const range = CFG.sensorRange * sit.sensor;
    const hazardTypes = { fire: true, flood: true, hotspot: true, hazard: true };

    /* Uplink sync gate: records only refresh on a shared-map sync tick. A slow
       uplink therefore makes the whole map visibly age between updates. */
    state.mapSyncAcc += dt * (sit.sync || 1);
    let syncTick = false;
    if (state.mapSyncAcc >= CFG.mapSyncStep) {
      state.mapSyncAcc -= CFG.mapSyncStep;
      syncTick = true;
    }

    for (const f of state.features) {
      if (sit.drift && (f.type === "survivor" || f.type === "vehicle")) {
        const wave = state.time * 0.11 + f.phase;
        f.x = f.homeX + Math.cos(wave) * 1.25;
        f.z = f.homeZ + Math.sin(wave * 0.8) * 1.25;
      } else {
        f.x = f.homeX;
        f.z = f.homeZ;
      }

      let observers = 0;
      for (const d of state.activeDrones) {
        if (!d.connected) continue;
        if (Math.hypot(d.pos.x - f.x, d.pos.z - f.z) <= range + f.r * 0.25) observers++;
      }
      if (observers && syncTick) f.observedAt = state.time;
      f.observers = observers;
      f.age = Math.max(0, state.time - f.observedAt);
      f.confidence = Math.round(clamp(99 - f.age * 3.2, 42, 99));
      f.liveState = f.age <= sit.liveFor ? "live" : f.age <= sit.staleFor ? "stale" : "lost";

      if (sit.spread && hazardTypes[f.type]) {
        const grow = f.liveState === "live" ? 0.022 : sit.spread;
        f.r = Math.min(f.baseR * 2.2, f.r + grow * Math.max(dt, 0));
      } else {
        f.r = f.baseR;
      }
    }
  }

  /* ---------------- network model ---------------- */

  function isBlocked(a, b, idA, idB) {
    if (state.storm) {
      const sa = a.x - STORM_X;
      const sb = b.x - STORM_X;
      if (sa * sb < 0) return "storm";
    }
    if (state.interference) {
      const inA = Math.hypot(a.x - ZONE_POS.x, a.z - ZONE_POS.z) < ZONE_R;
      const inB = Math.hypot(b.x - ZONE_POS.x, b.z - ZONE_POS.z) < ZONE_R;
      if (inA !== inB) return "interference";
    }
    if (state.severed.length) {
      const key = pairKey(idA, idB);
      for (const s of state.severed) {
        if (pairKey(s.a, s.b) === key) return "severed";
      }
    }
    return null;
  }

  function computeNetwork() {
    const pos = new Map();
    pos.set("MAIN", MAIN_POS);
    pos.set("BKUP", BKUP_POS);

    const activeDrones = state.drones.filter((d) => !d.failed);
    activeDrones.forEach((d) => pos.set(d.id, d.pos));

    const nodes = [];
    if (state.main.active) nodes.push({ id: "MAIN", kind: "main", pos: MAIN_POS });
    if (state.backup.active) nodes.push({ id: "BKUP", kind: "backup", pos: BKUP_POS });
    activeDrones.forEach((d) => nodes.push({ id: d.id, kind: "drone", drone: d, pos: d.pos }));

    const edges = [];
    const pushEdge = (a, b, kind) => {
      if (isBlocked(pos.get(a), pos.get(b), a, b)) return;
      edges.push({ a, b, kind });
    };

    for (let i = 0; i < activeDrones.length; i++) {
      for (let j = i + 1; j < activeDrones.length; j++) {
        const a = activeDrones[i];
        const b = activeDrones[j];
        if (dist3(a.pos, b.pos) <= CFG.droneRange) pushEdge(a.id, b.id, "mesh");
      }
    }

    if (state.main.active) {
      for (const d of activeDrones) {
        if (dist3(MAIN_POS, d.pos) <= CFG.mainRange) pushEdge("MAIN", d.id, "main");
      }
    }
    if (state.backup.active) {
      for (const d of activeDrones) {
        if (dist3(BKUP_POS, d.pos) <= CFG.backupRange) pushEdge("BKUP", d.id, "backup");
      }
    }

    const adj = new Map();
    nodes.forEach((n) => adj.set(n.id, []));
    for (const e of edges) {
      adj.get(e.a).push(e.b);
      adj.get(e.b).push(e.a);
    }

    const hops = new Map();
    const parent = new Map();
    const actingValid =
      state.acting === "MAIN"
        ? state.main.active
        : state.acting === "BKUP"
          ? state.backup.active
          : false;

    if (actingValid) {
      const start = state.acting;
      hops.set(start, 0);
      const queue = [start];
      for (let qi = 0; qi < queue.length; qi++) {
        const cur = queue[qi];
        for (const nb of adj.get(cur) || []) {
          if (!hops.has(nb)) {
            hops.set(nb, hops.get(cur) + 1);
            parent.set(nb, cur);
            queue.push(nb);
          }
        }
      }
    }

    state.drones.forEach((d) => {
      d.hops = hops.has(d.id) ? hops.get(d.id) : null;
      d.connected = hops.has(d.id);
      d.group = null;
      d.leader = false;
    });

    // Connected components among drones, using drone-to-drone links only.
    const seen = new Set();
    const components = [];
    for (const d of activeDrones) {
      if (seen.has(d.id)) continue;
      const stack = [d.id];
      seen.add(d.id);
      const members = [];
      while (stack.length) {
        const id = stack.pop();
        members.push(id);
        for (const nb of adj.get(id) || []) {
          if (nb === "MAIN" || nb === "BKUP") continue;
          if (seen.has(nb)) continue;
          seen.add(nb);
          stack.push(nb);
        }
      }
      components.push(members);
    }

    const groups = [];
    const liveKeys = new Set();
    for (const members of components) {
      if (members.every((id) => hops.has(id))) continue;
      const key = members.slice().sort().join(",");
      liveKeys.add(key);
      if (!state.groupSince.has(key)) state.groupSince.set(key, state.time);
      const sorted = members
        .map((id) => state.drones.find((d) => d.id === id))
        .sort((a, b) => b.battery - a.battery || a.idx - b.idx);
      groups.push({
        id: groups.length + 1,
        members: members.slice().sort(),
        leader: sorted[0].id,
        since: state.groupSince.get(key)
      });
    }
    for (const key of Array.from(state.groupSince.keys())) {
      if (!liveKeys.has(key)) state.groupSince.delete(key);
    }

    groups.forEach((g, gi) => {
      for (const id of g.members) {
        const d = state.drones.find((x) => x.id === id);
        if (!d) continue;
        d.group = gi + 1;
        d.leader = id === g.leader;
      }
    });

    const treeKeys = new Set();
    for (const [child, p] of parent.entries()) treeKeys.add(pairKey(child, p));

    for (const e of edges) {
      const da = state.drones.find((d) => d.id === e.a);
      const db = state.drones.find((d) => d.id === e.b);
      e.tree = treeKeys.has(pairKey(e.a, e.b));
      e.local = !!(da && db && da.group && da.group === db.group);
      e.hops = Math.max(
        hops.has(e.a) ? hops.get(e.a) : 0,
        hops.has(e.b) ? hops.get(e.b) : 0
      );
    }

    let connectedCount = 0;
    let hopSum = 0;
    let freshest = Infinity;
    let groupMembers = 0;

    for (const d of state.drones) {
      const g = d.group ? groups[d.group - 1] : null;
      if (d.failed) {
        d.status = "failed";
        d.obsAge = Math.max(0, state.time - d.failedAt);
      } else if (d.connected) {
        connectedCount++;
        hopSum += d.hops;
        d.status = "connected";
        d.obsAge = 0.8 + d.hops * 0.45 + (d.idx % 3) * 0.16;
        freshest = Math.min(freshest, d.obsAge);
      } else if (g) {
        d.status = "delayed";
        d.obsAge = 5 + (state.time - g.since) * 0.55;
        groupMembers++;
        freshest = Math.min(freshest, d.obsAge);
      } else {
        d.status = "isolated";
        d.obsAge = 5;
        freshest = Math.min(freshest, d.obsAge);
      }
    }

    state.edges = edges;
    state.nodes = nodes;
    state.hops = hops;
    state.parent = parent;
    state.treeKeys = treeKeys;
    state.activeDrones = activeDrones;
    state.groups = groups;
    state.groupMembers = groupMembers;
    state.connectedCount = connectedCount;
    state.avgHops = connectedCount ? hopSum / connectedCount : 0;
    state.freshest = isFinite(freshest) ? freshest : 0;
  }

  function nodeById(id) {
    if (id === "MAIN") return { id, kind: "main", pos: MAIN_POS, active: state.main.active };
    if (id === "BKUP") return { id, kind: "backup", pos: BKUP_POS, active: state.backup.active };
    return state.drones.find((d) => d.id === id) || null;
  }

  // Expose state lookup used by renderer / UI later in this file.
  const UI = {};


  /* ============================================================
     UI references, fleet list, inspector, event log
     ============================================================ */

  const el = {
    simClock: $("#sim-clock"),
    simState: $("#sim-state"),
    simPause: $("#sim-pause"),
    simReset: $("#sim-reset"),
    fleetList: $("#fleet-list"),
    fleetCount: $("#fleet-count"),
    coordStatus: $("#coord-status"),
    mainCoord: $("#main-coord"),
    mainCoordSub: $("#main-coord-sub"),
    mainCoordDot: $("#main-coord-dot"),
    backupCoord: $("#backup-coord"),
    backupCoordSub: $("#backup-coord-sub"),
    backupCoordDot: $("#backup-coord-dot"),
    mConnected: $("#m-connected"),
    mHops: $("#m-hops"),
    mGroups: $("#m-groups"),
    mFailed: $("#m-failed"),
    mShared: $("#m-shared"),
    mFresh: $("#m-fresh"),
    runSeed: $("#run-seed"),
    runScenario: $("#run-scenario"),
    runClear: $("#run-clear"),
    runClock: $("#run-clock"),
    runCopy: $("#run-copy"),
    runExport: $("#run-export"),
    runCsv: $("#run-csv"),
    mapOptions: $("#map-options"),
    situationOptions: $("#situation-options"),
    featureChips: $("#feature-chips"),
    featureSummary: $("#feature-summary"),
    runDrill: $("#run-drill"),
    inspector: $("#inspector"),
    inspectorMode: $("#inspector-mode"),
    eventLog: $("#event-log"),
    stageToast: $("#stage-toast"),
    canvasHint: $("#canvas-hint"),
    camPresets: $("#camera-presets"),
    stage: $("#ops")
  };

  const fleetRows = new Map();

  function buildFleet() {
    el.fleetList.innerHTML = "";
    fleetRows.clear();
    for (const d of state.drones) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "fleet-row";
      row.dataset.node = d.id;
      row.title = "Inspect drone " + d.id;
      row.innerHTML =
        '<span class="fleet-dot ok"></span>' +
        '<span class="fleet-id">' + d.id + "</span>" +
        '<span class="fleet-bat"><i style="width:80%"></i></span>' +
        '<span class="fleet-state">linked</span>';
      row.addEventListener("click", () => selectNode(d.id, false));
      el.fleetList.appendChild(row);
      fleetRows.set(d.id, {
        row,
        dot: row.querySelector(".fleet-dot"),
        bat: row.querySelector(".fleet-bat i"),
        state: row.querySelector(".fleet-state")
      });
    }
  }

  function updateFleet() {
    let active = 0;
    for (const d of state.drones) {
      const refs = fleetRows.get(d.id);
      if (!refs) continue;
      if (!d.failed) active++;
      const dotClass =
        d.status === "failed"
          ? "bad"
          : d.status === "delayed" || d.status === "isolated"
            ? "warn"
            : "ok";
      refs.dot.className = "fleet-dot " + dotClass;
      refs.row.classList.toggle("is-failed", d.failed);
      refs.row.classList.toggle("is-leader", d.leader);
      refs.row.classList.toggle("is-selected", state.selected === d.id);
      refs.bat.style.width = Math.max(2, Math.round(d.battery)) + "%";
      refs.bat.classList.toggle("low", d.battery < 32);
      let label;
      let stateClass = "fleet-state";
      if (d.failed) {
        label = "offline";
        stateClass += " failed";
      } else if (d.leader) {
        label = "leader · G" + d.group;
        stateClass += " leader";
      } else if (d.group) {
        label = "G" + d.group + " · delayed";
      } else if (d.connected) {
        label = d.hops + (d.hops === 1 ? " hop" : " hops");
      } else {
        label = "no route";
      }
      refs.state.className = stateClass;
      refs.state.textContent = label;
    }
    el.fleetCount.textContent = active + " units";
  }

  /* ---------------- map & situation controls ---------------- */

  function buildEnvControls() {
    if (el.mapOptions) {
      el.mapOptions.innerHTML = "";
      for (const map of Object.values(MAPS)) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "env-button";
        btn.dataset.map = map.id;
        btn.textContent = map.label;
        btn.title = map.place + " — " + map.hint;
        btn.addEventListener("click", () => setMap(map.id));
        el.mapOptions.appendChild(btn);
      }
    }
    if (el.situationOptions) {
      el.situationOptions.innerHTML = "";
      for (const sit of Object.values(SITUATIONS)) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "env-button";
        btn.dataset.situation = sit.id;
        btn.textContent = sit.label;
        btn.title = sit.hint;
        btn.addEventListener("click", () => setSituation(sit.id));
        el.situationOptions.appendChild(btn);
      }
    }
    updateEnvControls();
    updateDrillButton();
  }

  function updateEnvControls() {
    $$("#map-options [data-map]").forEach((btn) => {
      const active = btn.dataset.map === state.mapId;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
    $$("#situation-options [data-situation]").forEach((btn) => {
      const active = btn.dataset.situation === state.situation;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  }

  function highlightFeature(id) {
    const f = state.features.find((x) => x.id === id);
    if (!f) return;
    state.highlightFeature = id;
    state.highlightUntil = performance.now() / 1000 + 3.2;
    const type = FEATURE_TYPES[f.type] || FEATURE_TYPES.hotspot;
    toast(
      f.label + " · " + type.label + " · " + f.liveState + " · " + Math.round(f.age) + "s old",
      f.liveState === "live" ? "ok" : "warn"
    );
  }

  function updateFeatureRail(force) {
    if (!el.featureChips) return;
    const sig =
      state.mapId +
      "|" +
      state.situation +
      "|" +
      state.features.map((f) => f.id + f.liveState + Math.round(f.age)).join(",");
    if (!force && sig === state.featureSignature) return;
    state.featureSignature = sig;

    const counts = { live: 0, stale: 0, lost: 0 };
    const frag = document.createDocumentFragment();
    for (const f of state.features) {
      if (counts[f.liveState] !== undefined) counts[f.liveState]++;
      const type = FEATURE_TYPES[f.type] || FEATURE_TYPES.hotspot;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "feature-chip " + f.liveState;
      btn.dataset.feature = f.id;
      btn.title = type.label + " — " + f.liveState + ", " + Math.round(f.age) + "s old";
      btn.innerHTML =
        '<span class="chip-dot" style="--dot:' + type.color + '"></span>' +
        '<span class="chip-name">' + f.label + "</span>" +
        '<span class="chip-state">' +
        (f.liveState === "live" ? "live " + Math.max(0, Math.round(f.age)) + "s" : Math.round(f.age) + "s ago") +
        "</span>";
      btn.addEventListener("click", () => highlightFeature(f.id));
      frag.appendChild(btn);
    }
    el.featureChips.innerHTML = "";
    el.featureChips.appendChild(frag);
    if (el.featureSummary) {
      el.featureSummary.textContent =
        counts.live +
        " live" +
        (counts.stale ? " · " + counts.stale + " stale" : "") +
        (counts.lost ? " · " + counts.lost + " lost" : "");
      el.featureSummary.className = "rail-note" + (counts.lost ? " bad" : counts.stale ? " warn" : "");
    }
  }

  function selectNode(id, focusCanvas = false) {
    state.selected = id;
    updateUI(true);
    if (focusCanvas) {
      const wrap = $(".canvas-wrap");
      if (wrap && state.view === "command") {
        // Keep the point of interaction inside the viewport without jarring jumps.
        const rect = wrap.getBoundingClientRect();
        if (rect.top < 70 || rect.bottom > window.innerHeight) {
          wrap.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
        }
      }
    }
  }

  function updateInspector(force) {
    if (!el.inspector) return;
    const sig = [
      state.selected || "fleet",
      state.acting,
      state.connectedCount,
      state.groups.length,
      state.buffered | 0,
      state.records | 0,
      state.selected ? inspectorNodeSignature(state.selected) : ""
    ].join("~");
    if (!force && sig === state.inspectorSignature) return;
    state.inspectorSignature = sig;

    el.inspectorMode.textContent = state.selected
      ? state.selected === "MAIN"
        ? "main coordinator"
        : state.selected === "BKUP"
          ? "backup coordinator"
          : "drone " + state.selected
      : "fleet overview";

    if (!state.selected) {
      el.inspector.innerHTML =
        '<div class="inspector-empty">' +
        "<p>Select any drone, the Main AI or the Backup AI to inspect route, freshness and link health. Click empty space to return here.</p>" +
        '<p class="hint">' +
        state.connectedCount +
        " CONNECTED · " +
        state.groups.length +
        " LOCAL GROUPS · " +
        Math.round(state.buffered) +
        " BUFFERED</p>" +
        "</div>";
      return;
    }

    if (state.selected === "MAIN" || state.selected === "BKUP") {
      const isMain = state.selected === "MAIN";
      const active = isMain ? state.main.active : state.backup.active;
      const acting = state.acting === state.selected;
      const dot = active ? (acting ? "ok" : "") : "bad";
      const tag = !active ? "OFFLINE" : acting ? "ACTING PRIMARY" : "STANDBY";
      el.inspector.innerHTML =
        '<div class="inspector-ident">' +
        '<span class="status-dot ' + dot + '"></span>' +
        "<div><strong>" + (isMain ? "Main AI" : "Backup AI") + "</strong>" +
        "<small>" + (isMain ? "central coordinator" : "state replica") + "</small></div>" +
        '<span class="inspector-tag ' + (!active ? "failed" : "") + '">' + tag + "</span>" +
        "</div>" +
        '<dl class="inspector-rows">' +
        row("Authority", active ? (acting ? "primary" : "standby") : "unavailable", active ? (acting ? "ok" : "") : "bad") +
        row("Replica age", state.replicaAge.toFixed(1) + "s", state.replicaAge > 4 ? "warn" : "ok") +
        row("Connected drones", state.connectedCount + " / " + CFG.count, state.connectedCount < CFG.count ? "warn" : "ok") +
        row("Local groups", String(state.groups.length), state.groups.length ? "warn" : "") +
        row("Shared records", fmtNum(state.records), "") +
        row("Buffered records", fmtNum(state.buffered), state.buffered > 0 ? "warn" : "") +
        "</dl>" +
        '<div class="inspector-neighbors"><span class="mono">COORDINATION</span>' +
        '<div class="neighbor-chips">' +
        chip(isMain ? "backup replica" : "health mirror", "route") +
        chip(state.groups.length ? "local coordinators active" : "no local groups", state.groups.length ? "route" : "none") +
        "</div></div>";
      return;
    }

    const d = state.drones.find((x) => x.id === state.selected);
    if (!d) {
      state.selected = null;
      updateInspector(true);
      return;
    }

    const g = d.group ? state.groups[d.group - 1] : null;
    const neighbors = d.failed && d.lastNeighbors
      ? d.lastNeighbors
      : state.edges
          .filter((e) => e.a === d.id || e.b === d.id)
          .map((e) => (e.a === d.id ? e.b : e.a))
          .filter((id) => id !== "MAIN" && id !== "BKUP");
    const hasCoordLink = d.failed && typeof d.lastCoordLink === "boolean"
      ? d.lastCoordLink
      : state.edges.some(
          (e) =>
            (e.a === d.id && (e.b === "MAIN" || e.b === "BKUP")) ||
            (e.b === d.id && (e.a === "MAIN" || e.a === "BKUP"))
        );
    const parent = state.parent.get(d.id);
    const obsTone = d.failed ? "bad" : d.connected ? "ok" : "warn";
    const obsLabel = d.failed ? "stale" : d.connected ? "live" : "delayed";

    el.inspector.innerHTML =
      '<div class="inspector-ident">' +
      '<span class="status-dot ' + (d.failed ? "bad" : d.connected ? "ok" : "warn") + '"></span>' +
      "<div><strong>" + d.id + "</strong><small>" +
      (d.failed ? "lost node" : d.leader ? "local coordinator" : "edge node") +
      (g ? " · group " + g.id : "") +
      "</small></div>" +
      '<span class="inspector-tag ' + (d.failed ? "failed" : d.leader ? "leader" : "") + '">' +
      (d.failed ? "OFFLINE" : d.leader ? "LEADER" : d.connected ? "MESHED" : "DELAYED") +
      "</span></div>" +
      '<dl class="inspector-rows">' +
      row("Status", d.failed ? "unresponsive" : d.connected ? "connected" : "local group", d.failed ? "bad" : d.connected ? "ok" : "warn") +
      row("Hops", d.hops != null ? String(d.hops) : "no route", d.hops != null && d.hops > 3 ? "warn" : "") +
      row("Uplink", parent || (d.connected ? state.acting : d.leader ? "local lead" : "buffered"), "") +
      row("Observation", d.failed || !d.connected ? obsLabel : "live", obsTone) +
      row("Freshness", Math.round(d.obsAge) + "s", d.obsAge > 20 ? "bad" : d.obsAge > 6 ? "warn" : "ok") +
      row("Last sync", d.failed ? "before loss" : d.connected ? "continuous" : "when linked", "") +
      "</dl>" +
      '<div class="inspector-battery"><span>Battery <b>' + (d.failed ? "0%" : Math.round(d.battery) + "%") + "</b></span>" +
      '<i><b class="' + (d.battery < 32 ? "low" : "") + '" style="width:' + (d.failed ? 0 : Math.round(d.battery)) + '%"></b></i></div>' +
      '<div class="inspector-neighbors"><span class="mono">' +
      (d.failed ? "LAST KNOWN LINKS" : "ACTIVE LINKS") +
      "</span><div class=\"neighbor-chips\">";
    let chipsHtml = "";
    if (neighbors.length) {
      neighbors.slice(0, 10).forEach((id) => {
        const nb = state.drones.find((x) => x.id === id);
        const route = nb && nb.connected === d.connected && nb.group === d.group;
        chipsHtml += chip(id, route ? "route" : "");
      });
    } else {
      chipsHtml += chip("no active mesh links", "none");
    }
    if (hasCoordLink) chipsHtml += chip("coordinator link", "route");
    el.inspector.innerHTML += chipsHtml + "</div></div>";
  }

  function inspectorNodeSignature(id) {
    if (id === "MAIN" || id === "BKUP") {
      return [state.main.active, state.backup.active, state.acting, state.replicaAge.toFixed(0), state.records | 0, state.buffered | 0].join(",");
    }
    const d = state.drones.find((x) => x.id === id);
    if (!d) return "missing";
    return [d.failed, d.connected, d.hops, d.group, d.leader, Math.round(d.battery), Math.round(d.obsAge)].join(",");
  }

  function row(label, value, tone) {
    return (
      "<div><dt>" + label + "</dt><dd" + (tone ? ' class="' + tone + '"' : "") + ">" + value + "</dd></div>"
    );
  }

  function chip(text, tone) {
    return '<span class="neighbor-chip' + (tone ? " " + tone : "") + '">' + text + "</span>";
  }

  /* ---------------- event log & toast ---------------- */

  function logEvent(message, tone) {
    state.log.push({
      at: Math.round(state.time * 10) / 10,
      clock: fmtClock(state.time),
      tone: tone || "",
      text: message
    });
    if (state.log.length > 500) state.log.shift();
    if (!el.eventLog) return;
    const li = document.createElement("li");
    if (tone) li.className = tone;
    const time = document.createElement("span");
    time.className = "ev-time";
    time.textContent = fmtClock(state.time);
    const text = document.createElement("span");
    text.className = "ev-text";
    text.textContent = message;
    li.append(time, text);
    el.eventLog.prepend(li);
    while (el.eventLog.children.length > CFG.maxLog) {
      el.eventLog.lastElementChild.remove();
    }
  }

  function toast(message, tone) {
    if (!el.stageToast) return;
    el.stageToast.textContent = message;
    el.stageToast.className = "stage-toast is-visible" + (tone ? " " + tone : "");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      el.stageToast.classList.remove("is-visible");
    }, 3800);
  }

  function initLogs() {
    state.log.length = 0;
    if (!el.eventLog) return;
    el.eventLog.innerHTML = "";
    logEvent("Simulation online — 12 drones authenticated", "ok");
    logEvent("Backup AI replica in sync with Main AI", "");
    logEvent("Shared map loaded — 179 validated records", "");
  }

  /* ============================================================
     Faults, scenarios, restore
     ============================================================ */

  function markFailedDroneList() {
    state.failedDrones = state.drones.filter((d) => d.failed).map((d) => d.id);
  }

  function failMain(quiet) {
    if (!state.main.active) return;
    state.main.active = false;
    state.acting = null;
    state.handoverTimer = CFG.handover;
    state.handoverTotal = CFG.handover;
    logEvent("Main AI unresponsive — health check started (2.5s)", "bad");
    if (!quiet) {
      toast("Main AI lost. The Backup AI is running a health check before taking authority.", "warn");
    }
    computeNetwork();
    updateUI(true);
  }

  function restoreMain(quiet) {
    state.main.active = true;
    state.handoverTimer = 0;
    state.acting = "MAIN";
    state.replicaAge = 0.2;
    if (!quiet) {
      logEvent("Main AI restored — primary authority resumed", "ok");
      toast("Main AI is back. Backup returned to standby.", "ok");
    }
    computeNetwork();
    updateUI(true);
  }

  function failBackup() {
    if (!state.backup.active) return;
    state.backup.active = false;
    if (state.acting === "BKUP") state.acting = null;
    logEvent("Backup AI offline — central redundancy lost", "warn");
    toast("Backup AI is offline. Redundancy is reduced.", "warn");
    computeNetwork();
    updateUI(true);
  }

  function restoreBackup() {
    if (state.backup.active) return;
    state.backup.active = true;
    logEvent("Backup AI restored — replica resynchronising", "ok");
    if (!state.main.active && !state.acting && state.handoverTimer === 0) {
      state.handoverTimer = CFG.handover;
      state.handoverTotal = CFG.handover;
      logEvent("Backup AI online — health check before taking authority (2.5s)", "warn");
    }
    toast("Backup AI restored and resynchronising.", "ok");
    computeNetwork();
    updateUI(true);
  }

  function toggleMain() {
    if (state.main.active) failMain();
    else restoreMain(false);
  }

  function toggleBackup() {
    if (state.backup.active) failBackup();
    else restoreBackup();
  }

  function failDrone(preferredId, quiet) {
    const candidates = state.drones.filter((d) => !d.failed);
    if (!candidates.length) {
      if (!quiet) toast("Every drone is already offline. Restore the fleet first.", "warn");
      return;
    }
    let d = null;
    if (preferredId) d = candidates.find((x) => x.id === preferredId);
    if (!d && state.selected && state.selected.startsWith("D")) {
      d = candidates.find((x) => x.id === state.selected);
    }
    if (!d) d = pick(candidates);
    // Preserve the last healthy topology so the inspector can explain the loss.
    d.lastNeighbors = state.edges
      .filter((e) => e.a === d.id || e.b === d.id)
      .map((e) => (e.a === d.id ? e.b : e.a))
      .filter((id) => id !== "MAIN" && id !== "BKUP");
    d.lastCoordLink = state.edges.some(
      (e) =>
        (e.a === d.id && (e.b === "MAIN" || e.b === "BKUP")) ||
        (e.b === d.id && (e.a === "MAIN" || e.a === "BKUP"))
    );
    d.failed = true;
    d.failedAt = state.time;
    d.battery = 0;
    d.status = "failed";
    d.connected = false;
    d.hops = null;
    markFailedDroneList();
    state.selected = d.id;
    logEvent("Drone " + d.id + " lost — last known position retained as stale", "bad");
    if (!quiet) {
      toast(d.id + " lost. Its last observation is clearly marked stale.", "warn");
    }
    computeNetwork();
    updateUI(true);
  }

  function severLink() {
    computeNetwork();
    if (!state.edges.length) {
      toast("No active mesh links to sever.", "warn");
      return;
    }
    let candidates = state.edges.filter((e) => e.kind === "mesh");
    if (state.selected && state.selected.startsWith("D")) {
      const local = candidates.filter((e) => e.a === state.selected || e.b === state.selected);
      if (local.length) candidates = local;
    }
    if (!candidates.length) {
      toast("Every remaining path is a coordinator link.", "warn");
      return;
    }
    const e = pick(candidates);
    state.severed.push({ a: e.a, b: e.b, born: state.time });
    if (state.severed.length > CFG.maxSevered) state.severed.shift();
    logEvent("Link " + e.a + " ↔ " + e.b + " severed — searching for an alternate route", "warn");
    toast("Link " + e.a + " ↔ " + e.b + " cut. The mesh is rerouting.", "warn");
    computeNetwork();
    updateUI(true);
  }

  function toggleInterference() {
    state.interference = !state.interference;
    if (state.interference) {
      logEvent("Interference zone active — south-west links delayed", "warn");
      toast("Interference zone raised. Affected observations become delayed.", "warn");
    } else {
      logEvent("Interference cleared — delayed links recovering", "ok");
      toast("Interference cleared. Buffered records are reconciling.", "ok");
    }
    computeNetwork();
    updateUI(true);
  }

  function toggleStorm() {
    state.storm = !state.storm;
    if (state.storm) {
      logEvent("Storm partition raised — eastern corridor separated", "warn");
      toast("Eastern group cut off. Watch its local coordinator take over.", "warn");
    } else {
      logEvent("Storm cleared — separated group rejoining the core mesh", "ok");
      toast("Partition closed. The separated group is rejoining.", "ok");
    }
    computeNetwork();
    updateUI(true);
  }

  function runRecall() {
    if (state.recall) {
      toast("Fleet is already returning to base.", "warn");
      return;
    }
    state.recall = true;
    state.recallStart = state.time;
    state.recallUntil = state.time + 6;
    logEvent("Safe recall ordered — fleet returning to base holding pattern", "warn");
    toast("Safe recall ordered. All drones returning to base.", "");
    computeNetwork();
    updateUI(true);
  }

  function clearFaults() {
    state.main.active = true;
    state.backup.active = true;
    state.acting = "MAIN";
    state.handoverTimer = 0;
    state.storm = false;
    state.interference = false;
    state.severed = [];
    state.recall = false;
    for (const d of state.drones) {
      if (d.failed) {
        d.failed = false;
        d.battery = Math.max(86, d.battery);
      }
      d.failedAt = 0;
    }
    markFailedDroneList();
  }

  function restoreAll() {
    const hadBuffer = state.buffered > 0;
    clearFaults();
    for (const f of state.features) f.observedAt = state.time;
    state.mapSyncAcc = 0;
    computeNetwork();
    state.selected = null;
    logEvent("Restore accepted — links re-established, records reconciling", "ok");
    toast(
      hadBuffer
        ? "Network restored. Watch buffered records reconcile into the shared map."
        : "Network restored. All links and coordinators are nominal.",
      "ok"
    );
    updateUI(true);
  }

  function applyScenarioFaults(name) {
    if (name === "mesh") {
      state.storm = true;
      logEvent("Scenario · storm partition raised over the eastern corridor", "warn");
    } else if (name === "main") {
      computeNetwork();
      failMain(true);
    } else if (name === "drone") {
      computeNetwork();
      failDrone("D07", true);
      setView("command", true);
    }
  }

  function runScenario(name, silent) {
    if (!name || !SCENARIOS[name]) return;
    state.scenario = name;
    resetSim({ scenario: name, silent: true });
    if (!silent) toast(SCENARIOS[name].toast, "warn");
    updateRunMeta();
    syncURL();
  }

  function setMap(id) {
    if (!MAPS[id] || id === state.mapId) return;
    resetSim({ map: id, silent: true });
    const map = currentMap();
    logEvent("Map loaded · " + map.label + " — " + map.place, "ok");
    toast("Map: " + map.label + ". " + map.hint, "");
    updateRunMeta();
    syncURL();
  }

  function setSituation(id) {
    if (!SITUATIONS[id] || id === state.situation) return;
    resetSim({ situation: id, silent: true });
    const sit = currentSituation();
    logEvent("Situation set · " + sit.label, sit.id === "routine" ? "ok" : "warn");
    toast("Situation: " + sit.label + ". " + sit.hint, sit.id === "routine" ? "ok" : "warn");
    updateRunMeta();
    syncURL();
  }

  function resetSim(options) {
    const opts = options || {};
    clearDrill();
    if (opts.seed !== undefined) {
      const next = normalizeSeed(opts.seed);
      if (next !== null) state.seed = next;
    }
    if (opts.scenario !== undefined) {
      state.scenario = opts.scenario && SCENARIOS[opts.scenario] ? opts.scenario : null;
    }
    if (opts.map !== undefined) {
      state.mapId = MAPS[opts.map] ? opts.map : state.mapId;
    }
    if (opts.situation !== undefined) {
      state.situation = SITUATIONS[opts.situation] ? opts.situation : state.situation;
    }
    setSeed(state.seed);
    state.time = 0;
    state.paused = false;
    state.speed = 1;
    state.records = 179;
    state.buffered = 0;
    state.recordAcc = 0;
    state.netAcc = 0;
    state.mapSyncAcc = 0;
    state.packets = [];
    state.packetAcc = 0;
    state.replicaAge = 0.2;
    state.groupSince.clear();
    state.selected = null;
    state.view = "command";
    state.recall = false;
    state.stats = { packets: 0, failovers: 0, reconciliations: 0 };
    state.highlightFeature = null;
    state.highlightUntil = 0;
    clearFaults();
    makeStars();
    for (const d of state.drones) {
      d.hops = null;
      d.connected = true;
      d.group = null;
      d.leader = false;
      d.obsAge = 1;
      d.battery = Math.round(rand(72, 97));
      d.phase = rand(0, TAU);
    }
    makeFeatures();
    setCamera("overview");
    setView("command", true);
    updatePauseButton();
    updateSpeedButtons();
    computeNetwork();
    updateMapFeatures(0);
    initLogs();
    if (state.scenario) applyScenarioFaults(state.scenario);
    logEvent("Simulation reset — 12 drones re-registered · seed " + state.seed, "ok");
    logEvent(
      "Shared map · " + currentMap().label + " — " +
        state.features.length + " monitored features · " + currentSituation().label,
      "ok"
    );
    updateUI(true);
    updateRunMeta();
    syncURL();
    if (!opts.silent) {
      toast(
        state.scenario
          ? "Replaying “" + SCENARIOS[state.scenario].label + "” from seed " + state.seed + "."
          : "Simulation reset to T+00:00 · seed " + state.seed + ".",
        state.scenario ? "warn" : "ok"
      );
    }
  }

  function updateDrillButton() {
    if (!el.runDrill) return;
    el.runDrill.classList.toggle("is-active", state.drillActive);
    el.runDrill.setAttribute("aria-pressed", String(state.drillActive));
    const label = el.runDrill.querySelector("span");
    if (label) label.textContent = state.drillActive ? "Drill running" : "Run drill";
  }

  function clearDrill() {
    if (state.drillTimers && state.drillTimers.length) {
      for (const id of state.drillTimers) clearTimeout(id);
      state.drillTimers = [];
    }
    state.drillActive = false;
    updateDrillButton();
  }

  function scheduleDrill(fn, ms) {
    const id = setTimeout(() => {
      if (!state.drillActive) return;
      fn();
    }, ms);
    state.drillTimers.push(id);
  }

  function runDrill() {
    clearDrill();
    state.drillActive = true;
    updateDrillButton();
    setView("command", true);
    logEvent("Automated failure drill started — link partition, then drone loss, then recovery", "warn");
    toast("Automated drill started. Watch the shared map age, then recover.", "warn");

    scheduleDrill(() => {
      state.storm = true;
      computeNetwork();
      logEvent("Drill · eastern corridor partitioned by storm", "warn");
      toast("Drill: mesh partitioned. Local coordination engaged.", "warn");
      updateUI(true);
    }, 900);

    scheduleDrill(() => {
      computeNetwork();
      failDrone(null, true);
      setView("command", true);
      logEvent("Drill · drone lost — its coverage area will go stale", "bad");
      toast("Drill: a drone is down. Its map coverage is now aging.", "warn");
    }, 2800);

    scheduleDrill(() => {
      restoreAll();
      clearDrill();
      logEvent("Automated failure drill complete — all records reconciled", "ok");
      toast("Drill complete. Links restored and the shared map reconciled.", "ok");
      updateUI(true);
    }, 7000);
  }

  function runAction(action) {
    if (state.drillActive) clearDrill();
    switch (action) {
      case "severLink":
        severLink();
        break;
      case "interference":
        toggleInterference();
        break;
      case "storm":
        toggleStorm();
        break;
      case "main":
        toggleMain();
        break;
      case "backup":
        toggleBackup();
        break;
      case "failDrone":
        failDrone();
        break;
      case "recall":
        runRecall();
        break;
      case "restore":
        restoreAll();
        break;
      default:
        break;
    }
  }

  /* ============================================================
     UI refresh
     ============================================================ */

  function opsState() {
    if (state.handoverTimer > 0) return { label: "handover", tone: "warn" };
    if (!state.acting) return { label: "partitioned", tone: "bad" };
    if (state.groups.length) return { label: "degraded", tone: "warn" };
    if (!state.main.active || !state.backup.active) return { label: "degraded", tone: "warn" };
    if (state.storm || state.interference || state.severed.length || state.failedDrones.length || state.recall) {
      return { label: "degraded", tone: "warn" };
    }
    return { label: "nominal", tone: "" };
  }

  function setTag(node, text, tone) {
    node.textContent = text;
    node.className = "status-tag" + (tone ? " " + tone : "");
  }

  function updateUI(force) {
    if (!el.simClock) return;

    el.simClock.textContent = fmtClock(state.time);
    if (el.runClock) el.runClock.textContent = fmtClock(state.time);
    const ops = opsState();
    el.simState.textContent = ops.label;
    el.simState.className = "ops-state" + (ops.tone ? " " + ops.tone : "");

    el.mConnected.textContent = state.connectedCount + "/" + CFG.count;
    el.mConnected.className = state.connectedCount < CFG.count ? "warn" : "";
    el.mHops.textContent = state.connectedCount ? state.avgHops.toFixed(1) : "—";
    el.mHops.className = state.avgHops > 2.6 ? "warn" : "";
    el.mGroups.textContent = String(state.groups.length);
    el.mGroups.className = state.groups.length ? "warn" : "";
    const down =
      state.failedDrones.length + (state.main.active ? 0 : 1) + (state.backup.active ? 0 : 1);
    el.mFailed.textContent = String(down);
    el.mFailed.className = down ? "bad" : "";
    el.mShared.textContent = fmtNum(state.records);
    el.mFresh.textContent = state.freshest ? Math.round(state.freshest) + "s" : "—";
    el.mFresh.className = state.freshest > 20 ? "bad" : state.freshest > 6 ? "warn" : "";

    const coordLabel =
      state.handoverTimer > 0
        ? "Handover"
        : !state.acting
          ? "Partitioned"
          : state.groups.length
            ? "Degraded"
            : ops.label === "nominal"
              ? "Nominal"
              : "Degraded";
    const coordTone =
      coordLabel === "Nominal" ? "ok" : coordLabel === "Partitioned" ? "bad" : "warn";
    setTag(el.coordStatus, coordLabel, coordTone);

    el.mainCoord.classList.toggle("is-failing", !state.main.active);
    el.mainCoord.classList.toggle("is-acting", state.acting === "MAIN");
    el.mainCoordDot.className = "status-dot " + (state.main.active ? "ok" : "bad");
    el.mainCoordSub.textContent = state.main.active
      ? state.acting === "MAIN"
        ? "Shared state · primary"
        : "Online · standby"
      : state.handoverTimer > 0
        ? "Unresponsive · health check " + state.handoverTimer.toFixed(1) + "s"
        : "Unresponsive · offline";

    el.backupCoord.classList.toggle("is-failing", !state.backup.active);
    el.backupCoord.classList.toggle("is-acting", state.acting === "BKUP");
    el.backupCoordDot.className =
      "status-dot " + (!state.backup.active ? "bad" : state.acting === "BKUP" ? "ok" : "");
    el.backupCoordSub.textContent = !state.backup.active
      ? "Unresponsive · offline"
      : state.handoverTimer > 0
        ? "Health check · " + state.handoverTimer.toFixed(1) + "s"
        : state.acting === "BKUP"
          ? "Acting primary · replica " + state.replicaAge.toFixed(1) + "s"
          : "Replica age " + state.replicaAge.toFixed(1) + "s · standby";

    $$(".fault-button[data-action]").forEach((btn) => {
      const a = btn.dataset.action;
      const active =
        (a === "storm" && state.storm) ||
        (a === "interference" && state.interference) ||
        (a === "main" && !state.main.active) ||
        (a === "backup" && !state.backup.active);
      btn.classList.toggle("is-active", active);
      if (a === "storm" || a === "interference" || a === "main" || a === "backup") {
        btn.setAttribute("aria-pressed", String(active));
      }
    });

    $$("[data-scenario]").forEach((chip) => {
      const s = chip.dataset.scenario;
      const running =
        (s === "mesh" && state.storm) ||
        (s === "main" && !state.main.active) ||
        (s === "drone" && state.failedDrones.length > 0);
      chip.classList.toggle("is-running", running);
    });

    $$("[data-view]").forEach((btn) => {
      const active = btn.dataset.view === state.view;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", String(active));
    });

    updateFleet();
    updateEnvControls();
    updateFeatureRail(force);
    updateInspector(force);
    if (state.view === "topology") {
      $$("[data-camera]").forEach((b) => {
        b.disabled = true;
        b.classList.remove("is-active");
      });
    } else {
      $$("[data-camera]").forEach((b) => {
        b.disabled = false;
      });
    }
  }

  function updatePauseButton() {
    if (!el.simPause) return;
    el.simPause.setAttribute("aria-pressed", String(state.paused));
    const label = el.simPause.querySelector("span");
    if (label) label.textContent = state.paused ? "Resume" : "Pause";
    el.simPause.title = (state.paused ? "Resume" : "Pause") + " simulation (Space)";
  }

  function updateSpeedButtons() {
    $$("[data-speed]").forEach((btn) => {
      const on = Number(btn.dataset.speed) === state.speed;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", String(on));
    });
  }

  /* ============================================================
     Reproducible runs, share links & export
     ============================================================ */

  function scenarioLabel() {
    return state.scenario && SCENARIOS[state.scenario] ? SCENARIOS[state.scenario].label : "Free run";
  }

  function updateRunMeta() {
    if (el.runSeed) el.runSeed.textContent = String(state.seed);
    if (el.runScenario) el.runScenario.textContent = scenarioLabel();
    if (el.runClock) el.runClock.textContent = fmtClock(state.time);
    if (el.runClear) el.runClear.hidden = !state.scenario;
  }

  function clearScenario() {
    state.scenario = null;
    resetSim({ scenario: null, silent: true });
    toast("Free run — scenario cleared · seed " + state.seed + ".", "ok");
    updateRunMeta();
    syncURL();
  }

  function buildShareURL(anchor) {
    const url = new URL(window.location.href);
    url.searchParams.set("seed", String(state.seed));
    if (state.scenario) url.searchParams.set("scenario", state.scenario);
    else url.searchParams.delete("scenario");
    url.searchParams.set("map", state.mapId);
    url.searchParams.set("situation", state.situation);
    if (anchor && !url.hash) url.hash = "simulator";
    return url.toString();
  }

  function syncURL() {
    try {
      window.history.replaceState(null, "", buildShareURL(false));
    } catch (e) {
      /* file:// or older browsers may reject history updates */
    }
  }

  function readRunURL() {
    const params = new URLSearchParams(window.location.search);
    const seedParam = params.get("seed");
    const parsed = seedParam !== null ? normalizeSeed(seedParam) : null;
    state.seed = parsed !== null ? parsed : makeSeed();
    const scenarioParam = (params.get("scenario") || "").toLowerCase();
    state.scenario = SCENARIOS[scenarioParam] ? scenarioParam : null;
    const mapParam = (params.get("map") || "").toLowerCase();
    state.mapId = MAPS[mapParam] ? mapParam : "wildfire";
    const situationParam = (params.get("situation") || "").toLowerCase();
    state.situation = SITUATIONS[situationParam] ? situationParam : "routine";
  }

  async function copyRunLink() {
    const link = buildShareURL(true);
    let copied = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(link);
        copied = true;
      }
    } catch (e) {
      copied = false;
    }
    if (!copied) {
      try {
        const ta = document.createElement("textarea");
        ta.value = link;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "-1000px";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        copied = document.execCommand("copy");
        ta.remove();
      } catch (e) {
        copied = false;
      }
    }
    toast(
      copied
        ? "Run link copied — seed " + state.seed + " · " + scenarioLabel() + "."
        : "Copy blocked by the browser. The run URL is in the address bar.",
      copied ? "ok" : "warn"
    );
  }

  function buildRunSummary() {
    const ops = opsState();
    return {
      app: "NEXUS AI",
      kind: "simulation-run",
      version: "1.0.0",
      generatedAt: new Date().toISOString(),
      seed: state.seed,
      scenario: state.scenario
        ? { id: state.scenario, label: scenarioLabel() }
        : null,
      clock: {
        seconds: Math.round(state.time * 10) / 10,
        label: fmtClock(state.time)
      },
      state: ops.label,
      notes:
        "Same seed + scenario reproduce the same random sequence. Real time and frame rate may differ.",
      nodes: {
        drones: CFG.count,
        coordinators: 2,
        connected: state.connectedCount,
        failedDrones: state.failedDrones.slice(),
        localGroups: state.groups.length,
        avgHops: Number(state.avgHops.toFixed(2))
      },
      coordinators: {
        mainActive: state.main.active,
        backupActive: state.backup.active,
        acting: state.acting || null,
        handoverSeconds: Number(state.handoverTimer.toFixed(2)),
        replicaAgeSeconds: Number(state.replicaAge.toFixed(2))
      },
      map: {
        id: state.mapId,
        label: currentMap().label,
        place: currentMap().place,
        situation: {
          id: state.situation,
          label: currentSituation().label
        },
        features: state.features.map((f) => ({
          id: f.id,
          type: f.type,
          label: f.label,
          state: f.liveState,
          ageSeconds: Math.round(f.age * 10) / 10,
          confidence: f.confidence,
          observers: f.observers,
          radius: Math.round(f.r * 10) / 10
        })),
        records: Math.round(state.records),
        buffered: Math.round(state.buffered),
        freshestSeconds: state.freshest ? Math.round(state.freshest) : null
      },
      links: {
        total: state.edges.length,
        mesh: state.edges.filter((e) => e.kind === "mesh").length,
        tree: state.edges.filter((e) => e.tree).length
      },
      faults: {
        storm: state.storm,
        interference: state.interference,
        recall: state.recall,
        severedLinks: state.severed.map((s) => ({
          a: s.a,
          b: s.b,
          atSeconds: Math.round(s.born * 10) / 10
        })),
        failedDrones: state.failedDrones.slice()
      },
      counters: {
        packetsSpawned: state.stats.packets,
        failovers: state.stats.failovers,
        reconciliations: state.stats.reconciliations
      },
      events: state.log.slice(-200).map((e) => ({
        atSeconds: e.at,
        clock: e.clock,
        tone: e.tone,
        text: e.text
      }))
    };
  }

  function csvCell(value) {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function downloadText(name, mime, text) {
    const blob = new Blob([text], { type: mime + ";charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function runFileName(extension) {
    return (
      "nexus-run-" +
      state.seed +
      "-" +
      (state.scenario || "free") +
      "." +
      extension
    );
  }

  function exportRunJSON() {
    downloadText(runFileName("json"), "application/json", JSON.stringify(buildRunSummary(), null, 2));
    toast("Run exported as JSON — seed " + state.seed + " · " + scenarioLabel() + ".", "ok");
  }

  function exportRunCSV() {
    const s = buildRunSummary();
    const rows = [
      ["metric", "value"],
      ["app", s.app],
      ["generated_at", s.generatedAt],
      ["seed", s.seed],
      ["scenario", s.scenario ? s.scenario.id : "free"],
      ["scenario_label", s.scenario ? s.scenario.label : "Free run"],
      ["map_id", s.map.id],
      ["map_label", s.map.label],
      ["situation_id", s.map.situation.id],
      ["situation_label", s.map.situation.label],
      ["features_live", s.map.features.filter((f) => f.state === "live").length],
      ["features_stale", s.map.features.filter((f) => f.state === "stale").length],
      ["features_lost", s.map.features.filter((f) => f.state === "lost").length],
      ["clock_seconds", s.clock.seconds],
      ["clock_label", s.clock.label],
      ["state", s.state],
      ["drones_total", s.nodes.drones],
      ["drones_connected", s.nodes.connected],
      ["drones_failed", s.nodes.failedDrones.join(" ")],
      ["local_groups", s.nodes.localGroups],
      ["avg_hops", s.nodes.avgHops],
      ["main_active", s.coordinators.mainActive],
      ["backup_active", s.coordinators.backupActive],
      ["acting_coordinator", s.coordinators.acting || "none"],
      ["handover_seconds", s.coordinators.handoverSeconds],
      ["replica_age_seconds", s.coordinators.replicaAgeSeconds],
      ["records", s.map.records],
      ["buffered", s.map.buffered],
      ["freshest_seconds", s.map.freshestSeconds],
      ["links_total", s.links.total],
      ["links_mesh", s.links.mesh],
      ["links_tree", s.links.tree],
      ["packets_spawned", s.counters.packetsSpawned],
      ["failovers", s.counters.failovers],
      ["reconciliations", s.counters.reconciliations],
      ["storm", s.faults.storm],
      ["interference", s.faults.interference],
      ["recall", s.faults.recall],
      ["severed_links", s.faults.severedLinks.map((l) => l.a + "-" + l.b).join(" ")]
    ];
    const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
    downloadText(runFileName("csv"), "text/csv", csv);
    toast("Run exported as CSV — seed " + state.seed + ".", "ok");
  }

  function rerollSeed() {
    resetSim({ seed: makeSeed() });
    syncURL();
  }

  function setView(view, silent) {
    state.view = view === "topology" ? "topology" : "command";
    updateCanvasMode();
    updateUI(true);
    if (el.canvasHint) {
      el.canvasHint.textContent =
        state.view === "topology"
          ? "Click a node to inspect it · drag the map to pan"
          : "Drag up for top-down · drag to orbit · scroll to zoom · right-drag to pan";
      el.canvasHint.classList.remove("is-hidden");
    }
    if (!silent) {
      toast(
        state.view === "topology"
          ? "Network topology — rings show distance in hops from the active coordinator."
          : "Command center — drag to orbit, scroll to zoom, click a node.",
        ""
      );
    }
  }

  function setCamera(name) {
    const preset = CAM_PRESETS[name] || CAM_PRESETS.overview;
    if (state.view !== "command") setView("command", true);
    state.camGoal.yaw = preset.yaw;
    state.camGoal.pitch = preset.pitch;
    state.camGoal.dist = preset.dist;
    state.camGoal.target = preset.target.slice();
    state.camGoal.auto = !!preset.auto;
    state.camera.auto = !!preset.auto;
    $$("[data-camera]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.camera === name);
    });
    if (name === "orbit") {
      toast("Orbit camera engaged — drag or pick a preset to stop.", "");
    }
  }

  /* ============================================================
     Simulation step
     ============================================================ */

  function updateSim(dt) {
    state.time += dt;
    updateDronePositions(dt);
    updateMapFeatures(dt);

    if (state.handoverTimer > 0) {
      state.handoverTimer = Math.max(0, state.handoverTimer - dt);
      if (state.handoverTimer === 0) {
        if (state.backup.active) {
          state.acting = "BKUP";
          state.stats.failovers++;
          logEvent("Backup AI promoted to primary after a clean health check", "ok");
          toast("Backup AI is now primary. Shared state was preserved.", "ok");
        } else {
          state.acting = null;
          logEvent("No backup available — local coordinators keeping the network alive", "bad");
          toast("No central coordinator. Local groups are buffering safely.", "warn");
        }
      }
    }

    if (state.main.active && state.backup.active) {
      state.replicaAge = 0.2 + (state.time * 0.7) % 0.5;
    } else {
      state.replicaAge = Math.min(99, state.replicaAge + dt);
    }

    if (state.recall && state.time >= state.recallUntil) {
      state.recall = false;
      logEvent("Recall complete — fleet resumed patrol pattern", "ok");
      toast("Fleet resumed patrol. All holding records were kept.", "ok");
    }

    state.netAcc = (state.netAcc || 0) + dt;
    if (state.netAcc >= CFG.networkStep) {
      state.netAcc = 0;
      computeNetwork();
    }

    state.recordAcc += dt;
    if (state.recordAcc >= CFG.recordStep) {
      state.recordAcc -= CFG.recordStep;
      const syncRate = currentSituation().sync || 1;
      if (state.acting) state.records += state.connectedCount * syncRate;
      state.buffered += state.groupMembers;
      if (state.groupMembers > 0) {
        // Keep the buffered figure readable during long partitions.
        state.buffered = Math.min(state.buffered, 9999);
      }
    }

    if (state.buffered > 0 && state.groups.length === 0 && state.acting) {
      const drain = Math.min(state.buffered, dt * 24);
      state.buffered -= drain;
      state.records += drain;
      if (state.buffered < 0.4) {
        state.buffered = 0;
        state.stats.reconciliations++;
        logEvent("Reconciliation complete — buffered records merged into the shared map", "ok");
        toast("Buffered records reconciled. The shared map is consistent again.", "ok");
      }
    }

    state.packetAcc += dt;
    if (state.packetAcc >= 0.3) {
      state.packetAcc -= 0.3;
      spawnPacket();
    }

    for (let i = state.packets.length - 1; i >= 0; i--) {
      const p = state.packets[i];
      if (state.time - p.born > p.dur) state.packets.splice(i, 1);
    }

    state.uiClock += dt;
    if (state.uiClock >= 0.16) {
      state.uiClock = 0;
      updateUI(false);
    }
  }

  function spawnPacket() {
    if (!state.layers.packets) return;
    const pool = state.edges.filter((e) => e.tree && e.kind === "mesh");
    const fallback = state.edges.filter((e) => e.kind === "mesh");
    const list = pool.length ? pool : fallback;
    if (!list.length) return;
    const e = pick(list);
    state.stats.packets++;
    state.packets.push({
      a: e.a,
      b: e.b,
      dir: nextRandom() > 0.5,
      born: state.time,
      dur: rand(1.2, 2.4),
      size: rand(1.6, 2.8)
    });
    if (state.packets.length > 90) state.packets.shift();
  }


  /* ============================================================
     Canvas setup & projection
     ============================================================ */

  let stars = [];

  function makeStars() {
    stars = Array.from({ length: 80 }, () => ({
      x: nextRandom(),
      y: nextRandom(),
      r: rand(0.3, 1.2),
      a: rand(0.08, 0.4)
    }));
  }

  function setupCanvas() {
    state.canvas = $("#ops-canvas");
    if (!state.canvas) return;
    state.ctx = state.canvas.getContext("2d");
    state.canvas3d = $("#ops-canvas-3d");
    resizeCanvas();
    initThree();
    updateCanvasMode();
    if ("ResizeObserver" in window) {
      const ro = new ResizeObserver(() => resizeCanvas());
      ro.observe(state.canvas.parentElement);
    } else {
      window.addEventListener("resize", resizeCanvas);
    }
  }

  function resizeCanvas() {
    const c = state.canvas;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.DPR = dpr;
    state.W = rect.width;
    state.H = rect.height;
    const pw = Math.round(rect.width * dpr);
    const ph = Math.round(rect.height * dpr);
    if (c.width !== pw || c.height !== ph) {
      c.width = pw;
      c.height = ph;
    }
    resizeThree();
  }

  function updateCanvasMode() {
    const use3d = state.view === "command" && !!(state.three && state.three.ready);
    if (state.canvas3d) state.canvas3d.style.display = use3d ? "block" : "none";
    if (state.canvas) {
      state.canvas.style.pointerEvents = use3d ? "none" : "auto";
      state.canvas.style.cursor = use3d ? "" : "";
    }
  }

  function projectPoint(p) {
    const cam = state.camera;
    const dx = p.x - cam.target[0];
    const dy = p.y - cam.target[1];
    const dz = p.z - cam.target[2];
    const cy = Math.cos(cam.yaw);
    const sy = Math.sin(cam.yaw);
    const x1 = dx * cy + dz * sy;
    const z1 = -dx * sy + dz * cy;
    const cp = Math.cos(cam.pitch);
    const sp = Math.sin(cam.pitch);
    const y2 = dy * cp - z1 * sp;
    const z2 = dy * sp + z1 * cp;
    const zc = z2 + cam.dist;
    if (zc < 2) return null;
    const focal = Math.min(state.W, state.H) * 1.05;
    const scale = focal / zc;
    return {
      x: state.W / 2 + x1 * scale,
      y: state.H / 2 - y2 * scale,
      z: zc,
      scale
    };
  }

  function polyline(points, close) {
    let started = false;
    for (const pt of points) {
      const p = projectPoint(pt);
      if (!p) {
        started = false;
        continue;
      }
      if (!started) {
        state.ctx.moveTo(p.x, p.y);
        started = true;
      } else {
        state.ctx.lineTo(p.x, p.y);
      }
    }
    if (close) state.ctx.closePath();
  }

  /* ============================================================
     Shared pieces
     ============================================================ */

  function drawBackdrop(t) {
    const ctx = state.ctx;
    const W = state.W;
    const H = state.H;
    const bg = ctx.createRadialGradient(W * 0.5, H * 0.34, 0, W * 0.5, H * 0.34, Math.max(W, H) * 0.82);
    bg.addColorStop(0, "#0a2233");
    bg.addColorStop(0.45, "#071520");
    bg.addColorStop(1, "#040b12");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    for (const s of stars) {
      ctx.globalAlpha = s.a;
      ctx.fillStyle = "#9fe8ff";
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.78);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    const sit = currentSituation();
    if (sit.night) {
      ctx.fillStyle = "rgba(3, 7, 18, 0.32)";
      ctx.fillRect(0, 0, W, H);
    } else if (sit.id === "blackout") {
      ctx.fillStyle = "rgba(8, 4, 20, 0.16)";
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* ---------------- environmental map rendering ---------------- */

  function drawGroundShape(points, y, fill, stroke) {
    const ctx = state.ctx;
    const projected = points.map((p) => projectPoint({ x: p[0], y: y, z: p[1] }));
    if (!projected.every(Boolean)) return;
    ctx.beginPath();
    ctx.moveTo(projected[0].x, projected[0].y);
    for (let i = 1; i < projected.length; i++) ctx.lineTo(projected[i].x, projected[i].y);
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function ellipsePoints(cx, cz, rx, rz, segments) {
    const pts = [];
    const n = segments || 48;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      pts.push([cx + Math.cos(a) * rx, cz + Math.sin(a) * rz]);
    }
    return pts;
  }

  function terrainColorFor(h, shade, scorchVal, terr, sx, sz) {
    const t = clamp((h + 0.3) / 3.6, 0, 1);
    let c = t < 0.5 ? mixRGB(terr.low, terr.mid, t * 2) : mixRGB(terr.mid, terr.high, (t - 0.5) * 2);
    const k = 0.45 + 0.8 * shade;
    c = [c[0] * k, c[1] * k, c[2] * k];
    if (scorchVal > 0.01) c = mixRGB(c, [0.07, 0.05, 0.03], scorchVal * 0.6);
    const r = Math.max(Math.abs(sx), Math.abs(sz));
    const fade = sstep(15.5, 19.5, r);
    if (fade > 0) c = mixRGB(c, [0.012, 0.04, 0.07], fade * 0.6);
    return "rgb(" + Math.round(c[0] * 255) + "," + Math.round(c[1] * 255) + "," + Math.round(c[2] * 255) + ")";
  }

  function drawTerrainMesh(t) {
    const terr = MAP_TERRAIN[state.mapId] || MAP_TERRAIN.wildfire;
    const cache = state.terrain;
    if (!cache || cache.mapId !== state.mapId) buildTerrain(state.mapId);
    if (!state.terrain) return;
    const c = state.terrain;
    const ctx = state.ctx;
    const N = c.gridN, step = c.step, extent = c.extent, W = N + 1;
    const pts = new Array(W * W);
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const x = -extent + i * step, z = -extent + j * step;
        const h = c.heights[j * W + i];
        pts[j * W + i] = projectPoint({ x, y: h + 0.02, z });
      }
    }
    const cells = [];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = pts[j * W + i], b = pts[j * W + i + 1];
        const d = pts[(j + 1) * W + i], e = pts[(j + 1) * W + i + 1];
        if (!a || !b || !d || !e) continue;
        cells.push({ i, j, a, b, d, e, z: (a.z + b.z + d.z + e.z) / 4 });
      }
    }
    cells.sort((p, q) => q.z - p.z);
    const water = terr.water;
    const wl = c.waterLevel;
    for (const cell of cells) {
      const { i, j } = cell;
      const hAvg = (c.heights[j * W + i] + c.heights[j * W + i + 1] + c.heights[(j + 1) * W + i] + c.heights[(j + 1) * W + i + 1]) / 4;
      // hillshade from grid gradient
      const hL = c.heights[j * W + Math.max(0, i - 1)], hR = c.heights[j * W + Math.min(N, i + 1)];
      const hT = c.heights[Math.max(0, j - 1) * W + i], hB = c.heights[Math.min(N, j + 1) * W + i];
      const dhdx = (hR - hL) / (2 * step), dhdz = (hB - hT) / (2 * step);
      const inv = 1 / Math.sqrt(dhdx * dhdx + 1 + dhdz * dhdz);
      const nx = -dhdx * inv, ny = inv, nz = -dhdz * inv;
      const diff = clamp(nx * 0.45 + ny * 0.8 + nz * 0.35, 0, 1);
      const sc = (c.scorch[j * W + i] + c.scorch[j * W + i + 1] + c.scorch[(j + 1) * W + i] + c.scorch[(j + 1) * W + i + 1]) / 4;
      const sx = -extent + (i + 0.5) * step, sz = -extent + (j + 0.5) * step;
      ctx.beginPath();
      ctx.moveTo(cell.a.x, cell.a.y);
      ctx.lineTo(cell.b.x, cell.b.y);
      ctx.lineTo(cell.e.x, cell.e.y);
      ctx.lineTo(cell.d.x, cell.d.y);
      ctx.closePath();
      ctx.fillStyle = terrainColorFor(hAvg, diff, sc, terr, sx, sz);
      ctx.fill();
      if (hAvg < wl) {
        // water ripple quad pinned to the water level
        const x0 = -extent + i * step, x1 = x0 + step;
        const z0 = -extent + j * step, z1 = z0 + step;
        const w0 = projectPoint({ x: x0, y: wl + 0.05, z: z0 });
        const w1 = projectPoint({ x: x1, y: wl + 0.05, z: z0 });
        const w2 = projectPoint({ x: x1, y: wl + 0.05, z: z1 });
        const w3 = projectPoint({ x: x0, y: wl + 0.05, z: z1 });
        if (w0 && w1 && w2 && w3) {
          const ripple = 0.5 + 0.5 * Math.sin(sx * 1.4 + t * 1.6) * Math.sin(sz * 1.2 - t * 1.1);
          const alpha = 0.50 + ripple * 0.16;
          ctx.beginPath();
          ctx.moveTo(w0.x, w0.y);
          ctx.lineTo(w1.x, w1.y);
          ctx.lineTo(w2.x, w2.y);
          ctx.lineTo(w3.x, w3.y);
          ctx.closePath();
          ctx.fillStyle = "rgba(" + Math.round(water[0] * 255) + "," + Math.round(water[1] * 255) + "," + Math.round(water[2] * 255) + "," + alpha.toFixed(3) + ")";
          ctx.fill();
        }
      }
    }
  }

  function drawRoads() {
    const cache = state.terrain;
    if (!cache) return;
    const ctx = state.ctx;
    for (const road of cache.roads) {
      // sample each segment so the road follows the terrain
      const sampled = [];
      for (let s = 0; s < road.length - 1; s++) {
        const a = road[s], b = road[s + 1];
        const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const steps = Math.max(1, Math.ceil(dist / 0.8));
        for (let k = 0; k < steps; k++) {
          const f = k / steps;
          const x = lerp(a[0], b[0], f), z = lerp(a[1], b[1], f);
          sampled.push({ x, y: heightAt(x, z) + 0.06, z });
        }
      }
      sampled.push({ x: road[road.length - 1][0], y: heightAt(road[road.length - 1][0], road[road.length - 1][1]) + 0.06, z: road[road.length - 1][1] });
      const projected = sampled.map((p) => projectPoint(p));
      if (projected.length < 2) continue;
      for (const pass of [0, 1]) {
        ctx.beginPath();
        let started = false;
        for (const p of projected) {
          if (!p) { started = false; continue; }
          if (!started) { ctx.moveTo(p.x, p.y); started = true; }
          else ctx.lineTo(p.x, p.y);
        }
        if (pass === 0) {
          ctx.strokeStyle = "rgba(8, 16, 24, 0.55)";
          ctx.lineWidth = 3.2;
        } else {
          ctx.strokeStyle = "rgba(190, 220, 235, 0.28)";
          ctx.lineWidth = 1;
          ctx.setLineDash([5, 7]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  function drawBuildingBox(b) {
    const ctx = state.ctx;
    const gh = heightAt(b.x, b.z);
    const hw = b.w / 2, hd = b.d / 2;
    const corners = [
      [-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]
    ];
    const ground = corners.map(([ox, oz]) => projectPoint({ x: b.x + ox, y: heightAt(b.x + ox, b.z + oz) + 0.05, z: b.z + oz }));
    const top = corners.map(([ox, oz]) => projectPoint({ x: b.x + ox, y: heightAt(b.x + ox, b.z + oz) + b.h, z: b.z + oz }));
    if (ground.some((p) => !p) || top.some((p) => !p)) return;
    const sideCol = b.type === "tower" ? "rgba(103,232,249,0.35)" : "rgba(120,150,175,0.55)";
    const topCol = b.type === "tower" ? "rgba(103,232,249,0.22)" : "rgba(180,205,225,0.5)";
    // sides 0-1 (back), 1-2 (right), 2-3 (front), 3-0 (left) sorted far-first by depth
    const sides = [
      [ground[0], ground[1], top[1], top[0]],
      [ground[1], ground[2], top[2], top[1]],
      [ground[2], ground[3], top[3], top[2]],
      [ground[3], ground[0], top[0], top[3]]
    ];
    const sideDepths = sides.map((s) => (s[0].z + s[1].z + s[2].z + s[3].z) / 4);
    const order = [0, 1, 2, 3].sort((p, q) => sideDepths[q] - sideDepths[p]);
    for (const idx of order) {
      const s = sides[idx];
      ctx.beginPath();
      ctx.moveTo(s[0].x, s[0].y);
      ctx.lineTo(s[1].x, s[1].y);
      ctx.lineTo(s[2].x, s[2].y);
      ctx.lineTo(s[3].x, s[3].y);
      ctx.closePath();
      ctx.fillStyle = idx === 2 || idx === 3 ? sideCol : "rgba(60,80,100,0.5)";
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(top[0].x, top[0].y);
    for (let k = 1; k < 4; k++) ctx.lineTo(top[k].x, top[k].y);
    ctx.closePath();
    ctx.fillStyle = topCol;
    ctx.fill();
    ctx.strokeStyle = "rgba(200,230,240,0.35)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    if (b.type === "tower") {
      const apex = projectPoint({ x: b.x, y: gh + b.h + 0.9, z: b.z });
      const mid = projectPoint({ x: b.x, y: gh + b.h, z: b.z });
      if (apex && mid) {
        ctx.strokeStyle = "rgba(103,232,249,0.8)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(mid.x, mid.y);
        ctx.lineTo(apex.x, apex.y);
        ctx.stroke();
      }
    }
  }

  function drawBattleProps(t) {
    const cache = state.terrain;
    if (!cache) return;
    const ctx = state.ctx;
    const items = [];
    for (const tree of cache.trees) {
      const p = projectPoint({ x: tree.x, y: heightAt(tree.x, tree.z) + 0.02, z: tree.z });
      if (p) items.push({ kind: "tree", z: p.z, ref: tree, p });
    }
    for (const rock of cache.rocks) {
      const p = projectPoint({ x: rock.x, y: heightAt(rock.x, rock.z) + 0.02, z: rock.z });
      if (p) items.push({ kind: "rock", z: p.z, ref: rock, p });
    }
    for (const b of cache.buildings) {
      const p = projectPoint({ x: b.x, y: heightAt(b.x, b.z) + 0.02, z: b.z });
      if (p) items.push({ kind: "bld", z: p.z, ref: b, p });
    }
    items.sort((a, b2) => b2.z - a.z);
    for (const item of items) {
      const p = item.p;
      if (item.kind === "tree") {
        const tree = item.ref;
        const topH = tree.scale * 1.5;
        const top = projectPoint({ x: tree.x, y: heightAt(tree.x, tree.z) + topH, z: tree.z });
        if (!top) continue;
        const halfW = clamp(p.scale * 0.34 * tree.scale, 1.2, 12);
        // ground shadow
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, halfW * 1.15, halfW * 0.4, 0, 0, TAU);
        ctx.fill();
        // trunk
        ctx.strokeStyle = "rgba(80,55,30,0.85)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x, p.y - (p.y - top.y) * 0.28);
        ctx.stroke();
        // canopy: two-tone cone
        const light = "hsl(" + (tree.hue * 360).toFixed(0) + "," + (tree.sat * 100).toFixed(0) + "%," + (tree.light * 100).toFixed(0) + "%)";
        const dark = "hsl(" + (tree.hue * 360).toFixed(0) + "," + (tree.sat * 100).toFixed(0) + "%," + (tree.light * 55).toFixed(0) + "%)";
        ctx.beginPath();
        ctx.moveTo(top.x, top.y);
        ctx.lineTo(p.x - halfW, p.y);
        ctx.lineTo(p.x + halfW, p.y);
        ctx.closePath();
        ctx.fillStyle = light;
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(top.x, top.y);
        ctx.lineTo(p.x, p.y);
        ctx.lineTo(p.x + halfW, p.y);
        ctx.closePath();
        ctx.fillStyle = dark;
        ctx.globalAlpha = 0.55;
        ctx.fill();
        ctx.globalAlpha = 1;
      } else if (item.kind === "rock") {
        const rock = item.ref;
        const w = clamp(p.scale * 0.22 * rock.scale, 1, 7);
        const h = w * 0.62;
        const g = Math.round(120 + rock.shade * 110);
        ctx.fillStyle = "rgb(" + g + "," + g + "," + (g + 6) + ")";
        ctx.beginPath();
        ctx.moveTo(p.x - w, p.y);
        ctx.lineTo(p.x, p.y - h);
        ctx.lineTo(p.x + w, p.y);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.14)";
        ctx.beginPath();
        ctx.moveTo(p.x - w * 0.3, p.y - h * 0.25);
        ctx.lineTo(p.x, p.y - h);
        ctx.lineTo(p.x + w * 0.35, p.y - h * 0.2);
        ctx.closePath();
        ctx.fill();
      } else {
        drawBuildingBox(item.ref);
      }
    }
    // coordinator bases: hex pads + towers + cores (arena buildBases)
    const bases = [
      { x: 0, z: 0, r: 2.2, main: true },
      { x: -6.2, z: -6.2, r: 1.6, main: false }
    ];
    for (const base of bases) {
      const gh = heightAt(base.x, base.z);
      const pts = [];
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU + Math.PI / 6;
        pts.push({ x: base.x + Math.cos(a) * base.r, y: gh + 0.06, z: base.z + Math.sin(a) * base.r });
      }
      ctx.beginPath();
      polyline(pts, true);
      ctx.fillStyle = "rgba(120,150,170,0.35)";
      ctx.fill();
      ctx.strokeStyle = base.main ? "rgba(34,211,238,0.6)" : "rgba(167,139,250,0.6)";
      ctx.lineWidth = 1.1;
      ctx.stroke();
      const coreBase = projectPoint({ x: base.x, y: gh + 0.1, z: base.z });
      const coreTop = projectPoint({ x: base.x, y: gh + 2.6, z: base.z });
      if (coreBase && coreTop) {
        ctx.strokeStyle = base.main ? "rgba(103,232,249,0.55)" : "rgba(196,181,253,0.55)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(coreBase.x, coreBase.y);
        ctx.lineTo(coreTop.x, coreTop.y);
        ctx.stroke();
        const pulse = 0.5 + 0.5 * Math.sin(t * 1.8 + (base.main ? 0 : 2));
        const R = clamp(coreBase.scale * 0.42, 4, 14) * (1 + pulse * 0.12);
        ctx.save();
        ctx.translate(coreTop.x, coreTop.y);
        ctx.rotate(t * 0.8 + (base.main ? 0 : 1.2));
        ctx.strokeStyle = base.main ? "rgba(103,232,249,0.95)" : "rgba(196,181,253,0.95)";
        ctx.fillStyle = base.main ? "rgba(34,211,238,0.22)" : "rgba(167,139,250,0.22)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(0, -R);
        ctx.lineTo(R * 0.7, 0);
        ctx.lineTo(0, R);
        ctx.lineTo(-R * 0.7, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-R * 0.7, 0);
        ctx.lineTo(R * 0.7, 0);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawMapGround(t) {
    if (!state.terrain || state.terrain.mapId !== state.mapId) buildTerrain(state.mapId);
    drawTerrainMesh(t);
    drawRoads();
    drawBattleProps(t);
    // Night / blackout ambience over the opaque terrain (markers and drones
    // draw later and stay bright, like the reference command view).
    const sit = currentSituation();
    if (sit.night) {
      state.ctx.fillStyle = "rgba(3, 7, 18, 0.38)";
      state.ctx.fillRect(0, 0, state.W, state.H);
    } else if (sit.id === "blackout") {
      state.ctx.fillStyle = "rgba(8, 4, 20, 0.22)";
      state.ctx.fillRect(0, 0, state.W, state.H);
    }
    const map = currentMap();
    const corner = projectPoint({ x: -19.5, y: heightAt(-19.5, -19.5) + 0.02, z: -19.5 });
    if (corner && state.layers.labels) {
      const ctx = state.ctx;
      ctx.fillStyle = map.palette.edge;
      ctx.font = "8px 'JetBrains Mono', monospace";
      ctx.textAlign = "left";
      ctx.fillText(map.place.toUpperCase(), corner.x + 6, corner.y - 6);
    }
  }

  /* ============================================================
     Three.js battlefield map (Arena-style true 3D)
     Reuses the same sim state, terrain cache and camera goal as the
     2D fallback, but renders real WebGL geometry: hillfield terrain,
     water, instanced forests/rocks, buildings, roads, bases, drones,
     links, packets, feature truth + shared-map markers. Falls back
     to the 2D canvas automatically if THREE/WebGL is unavailable.
     ============================================================ */

  function threeAvailable() {
    return typeof THREE !== "undefined" && !!(state.canvas3d && state.three && state.three.ready);
  }

  function disposeGroup(group) {
    if (!group) return;
    group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (m.map) m.map.dispose();
          m.dispose();
        }
      }
    });
  }

  function makeLabelTexture(text, color) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 96;
    const ctx = canvas.getContext("2d");
    drawLabelCanvas(ctx, text, color);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    return { canvas, ctx, tex, text, color };
  }

  function drawLabelCanvas(ctx, text, color) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.font = "600 38px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const padX = 22, padY = 14;
    const tw = ctx.measureText(text).width;
    const bw = Math.min(W - 8, tw + padX * 2);
    const bh = 58;
    const bx = (W - bw) / 2, by = (H - bh) / 2;
    ctx.fillStyle = "rgba(4, 12, 20, 0.78)";
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const r = 12;
    ctx.moveTo(bx + r, by);
    ctx.lineTo(bx + bw - r, by);
    ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
    ctx.lineTo(bx + bw, by + bh - r);
    ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
    ctx.lineTo(bx + r, by + bh);
    ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
    ctx.lineTo(bx, by + r);
    ctx.quadraticCurveTo(bx, by, bx + r, by);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(text, W / 2, H / 2 + 1);
  }

  function makeLabelSprite() {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 96;
    const ctx = canvas.getContext("2d");
    drawLabelCanvas(ctx, "…", "#67e8f9");
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(7.5, 1.4, 1);
    sprite.renderOrder = 999;
    return { sprite, canvas, ctx, tex, text: "…", color: "#67e8f9" };
  }

  function setLabelSprite(label, text, color) {
    if (label.text === text && label.color === color) return;
    label.text = text;
    label.color = color;
    drawLabelCanvas(label.ctx, text, color);
    label.tex.needsUpdate = true;
  }

  function makeGlowTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.25, "rgba(255,255,255,0.55)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }

  function initThree() {
    state.three = { ready: false, mapId: "" };
    const canvas = state.canvas3d;
    if (!canvas || typeof THREE === "undefined") return;
    try {
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x050b13);
      const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
      const ambient = new THREE.AmbientLight(0x8ab4d8, 0.75);
      const sun = new THREE.DirectionalLight(0xffffff, 0.9);
      sun.position.set(30, 50, 22);
      scene.add(ambient);
      scene.add(sun);
      const env = new THREE.Group();
      scene.add(env);
      const T = { ready: true, renderer, scene, camera, ambient, sun, env };
      scene.userData.three = T;
      state.three = T;
      buildThreeMap(state.mapId);
      resizeThree();
    } catch (e) {
      state.three = { ready: false, mapId: "" };
    }
  }

  function resizeThree() {
    const T = state.three;
    if (!T || !T.ready || !state.W || !state.H) return;
    T.renderer.setSize(state.W, state.H, false);
    T.camera.aspect = state.W / state.H;
    T.camera.updateProjectionMatrix();
  }

  function buildThreeMap(mapId) {
    const T = state.three;
    if (!T || !T.ready) return state.three ? true : false;
    if (!state.terrain || state.terrain.mapId !== mapId) buildTerrain(mapId);
    if (!state.terrain) return false;
    if (T.mapId === mapId && T.env && T.env.children.length) return true;
    // Clear previous map
    if (T.env) {
      disposeGroup(T.env);
      T.scene.remove(T.env);
    }
    const env = new THREE.Group();
    T.scene.add(env);
    T.env = env;
    T.mapId = mapId;
    const terr = MAP_TERRAIN[mapId] || MAP_TERRAIN.wildfire;
    const cache = state.terrain;
    const map = MAPS[mapId] || MAPS.wildfire;
    const wl = cache.waterLevel;
    // --- terrain ---
    const SEG = 90;
    const tGeo = new THREE.PlaneGeometry(39, 39, SEG, SEG);
    tGeo.rotateX(-Math.PI / 2);
    const tPos = tGeo.attributes.position;
    const tCol = new Float32Array(tPos.count * 3);
    const tColor = new THREE.Color();
    const tC2 = new THREE.Color();
    for (let i = 0; i < tPos.count; i++) {
      const x = tPos.getX(i), z = tPos.getZ(i);
      const h = terrainHeightFor(mapId, x, z);
      tPos.setY(i, h);
      const hL = terrainHeightFor(mapId, x - 1.3, z), hR = terrainHeightFor(mapId, x + 1.3, z);
      const hT = terrainHeightFor(mapId, x, z - 1.3), hB = terrainHeightFor(mapId, x, z + 1.3);
      const dhdx = (hR - hL) / 2.6, dhdz = (hB - hT) / 2.6;
      const inv = 1 / Math.sqrt(dhdx * dhdx + 1 + dhdz * dhdz);
      const diff = clamp((-dhdx * inv) * 0.45 + inv * 0.8 + (-dhdz * inv) * 0.35, 0, 1);
      let sc = 0;
      for (const f of map.features) {
        if (!{ fire: true, hotspot: true, hazard: true, flood: true }[f.type]) continue;
        const s2 = clamp(1 - Math.hypot(x - f.x, z - f.z) / (f.r * 2.4), 0, 1);
        if (s2 > sc) sc = s2;
      }
      const tt = clamp((h + 0.3) / 3.6, 0, 1);
      let cArr = tt < 0.5 ? mixRGB(terr.low, terr.mid, tt * 2) : mixRGB(terr.mid, terr.high, (tt - 0.5) * 2);
      const k = 0.45 + 0.8 * diff;
      cArr = [cArr[0] * k, cArr[1] * k, cArr[2] * k];
      if (sc > 0.01) cArr = mixRGB(cArr, [0.07, 0.05, 0.03], sc * 0.6);
      const r = Math.max(Math.abs(x), Math.abs(z));
      const fade = sstep(15.5, 19.5, r);
      if (fade > 0) cArr = mixRGB(cArr, [0.012, 0.04, 0.07], fade * 0.6);
      tColor.setRGB(cArr[0], cArr[1], cArr[2]);
      tCol[i * 3] = tColor.r; tCol[i * 3 + 1] = tColor.g; tCol[i * 3 + 2] = tColor.b;
    }
    tGeo.setAttribute("color", new THREE.BufferAttribute(tCol, 3));
    tGeo.computeVertexNormals();
    const terrainMesh = new THREE.Mesh(tGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    env.add(terrainMesh);
    // --- water ---
    const waterGeo = new THREE.PlaneGeometry(39, 39);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(terr.water[0], terr.water[1], terr.water[2]),
      transparent: true, opacity: 0.55, depthWrite: false
    });
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.position.y = wl + 0.03;
    env.add(waterMesh);
    // --- trees ---
    const treeGroup = new THREE.Group();
    env.add(treeGroup);
    if (cache.trees.length) {
      const treeGeo = new THREE.ConeGeometry(0.42, 1.5, 6);
      treeGeo.translate(0, 0.75, 0);
      const treeMat = new THREE.MeshLambertMaterial({ flatShading: true });
      const inst = new THREE.InstancedMesh(treeGeo, treeMat, cache.trees.length);
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const eul = new THREE.Euler();
      const sv = new THREE.Vector3();
      const pv = new THREE.Vector3();
      const cc = new THREE.Color();
      cache.trees.forEach((tree, i) => {
        const h = heightAt(tree.x, tree.z);
        pv.set(tree.x, h + 0.02, tree.z);
        eul.set(0, tree.scale * 7.3, 0);
        q.setFromEuler(eul);
        sv.set(tree.scale, tree.scale * (0.9 + (i % 5) * 0.08), tree.scale);
        m4.compose(pv, q, sv);
        inst.setMatrixAt(i, m4);
        cc.setHSL(tree.hue, tree.sat, tree.light);
        inst.setColorAt(i, cc);
      });
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      treeGroup.add(inst);
    }
    // --- rocks ---
    if (cache.rocks.length) {
      const rockGeo = new THREE.TetrahedronGeometry(0.32);
      const rockMat = new THREE.MeshLambertMaterial({ flatShading: true, color: 0x8a9aa8 });
      const instR = new THREE.InstancedMesh(rockGeo, rockMat, cache.rocks.length);
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const sv = new THREE.Vector3();
      const pv = new THREE.Vector3();
      const cc = new THREE.Color();
      cache.rocks.forEach((rock, i) => {
        pv.set(rock.x, heightAt(rock.x, rock.z) + 0.08, rock.z);
        sv.set(rock.scale, rock.scale * 0.7, rock.scale);
        m4.compose(pv, q, sv);
        instR.setMatrixAt(i, m4);
        const g = 0.45 + rock.shade * 0.35;
        cc.setRGB(g, g, g + 0.02);
        instR.setColorAt(i, cc);
      });
      instR.instanceMatrix.needsUpdate = true;
      if (instR.instanceColor) instR.instanceColor.needsUpdate = true;
      treeGroup.add(instR);
    }
    // --- buildings ---
    const bGroup = new THREE.Group();
    env.add(bGroup);
    for (const b of cache.buildings) {
      const gh = heightAt(b.x, b.z);
      const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
      const mat = new THREE.MeshLambertMaterial({ color: b.type === "tower" ? 0x2a4a5a : 0x6b7f92 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(b.x, gh + b.h / 2, b.z);
      bGroup.add(mesh);
      if (b.type === "tower") {
        const apex = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 6), new THREE.MeshBasicMaterial({ color: 0x67e8f9 }));
        apex.position.set(b.x, gh + b.h + 0.4, b.z);
        bGroup.add(apex);
      }
    }
    // --- roads ---
    const roadGroup = new THREE.Group();
    env.add(roadGroup);
    for (const road of cache.roads) {
      const sampled = [];
      for (let s = 0; s < road.length - 1; s++) {
        const a = road[s], b = road[s + 1];
        const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const steps = Math.max(1, Math.ceil(dist / 0.8));
        for (let k2 = 0; k2 <= steps; k2++) {
          const f = k2 / steps;
          const x = lerp(a[0], b[0], f), z = lerp(a[1], b[1], f);
          sampled.push(new THREE.Vector3(x, heightAt(x, z) + 0.06, z));
        }
      }
      if (sampled.length > 1) {
        const g = new THREE.BufferGeometry().setFromPoints(sampled);
        const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xbddcf0, transparent: true, opacity: 0.28 }));
        roadGroup.add(line);
      }
    }
    // --- grid overlay ---
    const gridGroup = new THREE.Group();
    env.add(gridGroup);
    {
      const pts = [];
      const span = 19.5, stepG = 3.25;
      for (let v = -span; v <= span + 0.001; v += stepG) {
        for (let z = -span; z < span - 0.001; z += 1.5) pts.push(v, heightAt(v, z) + 0.04, z, v, heightAt(v, z + 1.5) + 0.04, z + 1.5);
        for (let x = -span; x < span - 0.001; x += 1.5) pts.push(x, heightAt(x, v) + 0.04, v, x + 1.5, heightAt(x + 1.5, v) + 0.04, v);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x58a0be, transparent: true, opacity: 0.12 }));
      gridGroup.add(lines);
      for (const radius of [6, 12, 18]) {
        const rp = [];
        for (let i = 0; i <= 72; i++) {
          const a = (i / 72) * TAU;
          const px = Math.cos(a) * radius, pz = Math.sin(a) * radius;
          rp.push(px, heightAt(px, pz) + 0.04, pz);
        }
        const rg = new THREE.BufferGeometry();
        rg.setAttribute("position", new THREE.Float32BufferAttribute(rp, 3));
        gridGroup.add(new THREE.Line(rg, new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.14 })));
      }
    }
    // --- coordinator bases ---
    const baseGroup = new THREE.Group();
    env.add(baseGroup);
    const baseCores = [];
    for (const base of [{ x: 0, z: 0, r: 2.2, main: true }, { x: -6.2, z: -6.2, r: 1.6, main: false }]) {
      const gh = heightAt(base.x, base.z);
      const plat = new THREE.Mesh(
        new THREE.CylinderGeometry(base.r, base.r, 0.14, 6),
        new THREE.MeshLambertMaterial({ color: 0x546e7e })
      );
      plat.position.set(base.x, gh + 0.07, base.z);
      baseGroup.add(plat);
      const edge = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(
          Array.from({ length: 6 }, (_, k) => {
            const a = (k / 6) * TAU + Math.PI / 6;
            return new THREE.Vector3(base.x + Math.cos(a) * base.r, gh + 0.15, base.z + Math.sin(a) * base.r);
          })
        ),
        new THREE.LineBasicMaterial({ color: base.main ? 0x22d3ee : 0xa78bfa, transparent: true, opacity: 0.7 })
      );
      baseGroup.add(edge);
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.6, 6), new THREE.MeshLambertMaterial({ color: 0x3a5470 }));
      tower.position.set(base.x, gh + 1.3, base.z);
      baseGroup.add(tower);
      const coreMat = new THREE.MeshBasicMaterial({ color: base.main ? 0x22d3ee : 0xa78bfa });
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.42), coreMat);
      core.position.set(base.x, gh + 2.7, base.z);
      baseGroup.add(core);
      baseCores.push({ core, main: base.main });
    }
    // --- feature truth + markers ---
    const featureGroup = new THREE.Group();
    env.add(featureGroup);
    const featureViews = [];
    T.glowTex = T.glowTex || makeGlowTexture();
    for (const f of state.features) {
      const type = FEATURE_TYPES[f.type] || FEATURE_TYPES.hotspot;
      const hex = parseInt(type.color.slice(1), 16);
      const gh0 = Math.max(heightAt(f.x, f.z), wl * 0.9);
      const truth = new THREE.Group();
      truth.position.set(f.x, gh0 + 0.05, f.z);
      // truth body by type
      if (f.type === "fire" || f.type === "hotspot") {
        const disc = new THREE.Mesh(new THREE.CircleGeometry(Math.max(0.8, f.r * 0.7), 28), new THREE.MeshBasicMaterial({ color: 0xff5a3c, transparent: true, opacity: 0.45, depthWrite: false }));
        disc.rotation.x = -Math.PI / 2;
        disc.position.y = 0.06;
        truth.add(disc);
        const COUNT = 70;
        const posArr = new Float32Array(COUNT * 3);
        const colArr = new Float32Array(COUNT * 3);
        const parts = [];
        for (let i = 0; i < COUNT; i++) parts.push({ a: Math.random() * TAU, r0: Math.random(), o: i / COUNT });
        const pg = new THREE.BufferGeometry();
        pg.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
        pg.setAttribute("color", new THREE.BufferAttribute(colArr, 3));
        const points = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.35, map: T.glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        points.frustumCulled = false;
        truth.add(points);
        truth.userData.fire = { points, posArr, colArr, parts, COUNT };
      } else if (f.type === "survivor") {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.1, 8), new THREE.MeshLambertMaterial({ color: 0x34d399, emissive: 0x0d5c3f }));
        cone.position.y = 0.55;
        truth.add(cone);
        const ringM = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.5, 28), new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
        ringM.rotation.x = -Math.PI / 2;
        ringM.position.y = 0.08;
        truth.add(ringM);
        truth.userData.ring = ringM;
      } else if (f.type === "vehicle") {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 0.55), new THREE.MeshLambertMaterial({ color: 0x2b6ea8 }));
        box.position.y = 0.2;
        truth.add(box);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glowTex, color: 0x38bdf8, transparent: true, opacity: 0.7, depthWrite: false }));
        glow.scale.set(2.2, 2.2, 1);
        glow.position.y = 0.5;
        truth.add(glow);
      } else if (f.type === "flood") {
        const disc = new THREE.Mesh(new THREE.CircleGeometry(Math.max(1.2, f.r), 32), new THREE.MeshBasicMaterial({ color: 0x3a86d8, transparent: true, opacity: 0.5, depthWrite: false }));
        disc.rotation.x = -Math.PI / 2;
        disc.position.y = 0.1;
        truth.add(disc);
      } else if (f.type === "structure") {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.8), new THREE.MeshLambertMaterial({ color: 0x8b7ab8 }));
        box.position.y = 0.35;
        truth.add(box);
      } else if (f.type === "smoke") {
        const s = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.5, f.r * 0.4), 12, 10), new THREE.MeshBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.35, depthWrite: false }));
        s.position.y = 0.8;
        truth.add(s);
      } else {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.9, 6), new THREE.MeshLambertMaterial({ color: hex }));
        cone.position.y = 0.45;
        truth.add(cone);
      }
      featureGroup.add(truth);
      // marker
      const marker = new THREE.Group();
      marker.position.set(f.x, gh0 + 0.07, f.z);
      const ringMat = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });
      const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.4, f.r * 0.85), Math.max(0.5, f.r * 1.0), 36), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;
      marker.add(ring);
      const beamMat = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.35, depthWrite: false });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 5, 6), beamMat);
      beam.position.y = 2.5;
      marker.add(beam);
      const diaMat = new THREE.MeshBasicMaterial({ color: hex, wireframe: true, transparent: true, opacity: 0.95 });
      const dia = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), diaMat);
      dia.position.y = 5.0;
      marker.add(dia);
      const label = makeLabelSprite();
      label.sprite.position.y = 5.9;
      marker.add(label.sprite);
      featureGroup.add(marker);
      featureViews.push({ f, truth, marker, ringMat, ring, beamMat, diaMat, dia, label, hex, type });
    }
    // --- drones + coords ---
    const droneViews = [];
    const droneGroup = new THREE.Group();
    env.add(droneGroup);
    const hitList = [];
    for (const d of state.drones) {
      const grp = new THREE.Group();
      const bodyMat = new THREE.MeshLambertMaterial({ color: 0x9fcfe0, emissive: 0x0a4a5a });
      const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.34), bodyMat);
      grp.add(body);
      const armMat = new THREE.MeshBasicMaterial({ color: 0xa5f3fc, transparent: true, opacity: 0.6 });
      const armGeo = new THREE.BoxGeometry(0.9, 0.05, 0.08);
      const arm1 = new THREE.Mesh(armGeo, armMat);
      const arm2 = new THREE.Mesh(armGeo, armMat);
      arm2.rotation.y = Math.PI / 2;
      grp.add(arm1); grp.add(arm2);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glowTex, color: 0x22d3ee, transparent: true, opacity: 0.8, depthWrite: false }));
      glow.scale.set(1.4, 1.4, 1);
      grp.add(glow);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.65, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -0.2;
      grp.add(ring);
      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
      hit.userData.droneId = d.id;
      grp.add(hit);
      droneGroup.add(grp);
      hitList.push(hit);
      droneViews.push({ d, grp, bodyMat, glow, ring, hit });
    }
    const coordViews = [];
    for (const [id, posZ, colHex] of [["MAIN", MAIN_POS, 0x22d3ee], ["BKUP", BKUP_POS, 0xa78bfa]]) {
      const grp = new THREE.Group();
      const coreMat = new THREE.MeshBasicMaterial({ color: colHex });
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.75), coreMat);
      grp.add(core);
      const halo = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.15, 36), new THREE.MeshBasicMaterial({ color: colHex, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = -0.3;
      grp.add(halo);
      const hit = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
      hit.userData.droneId = id;
      grp.add(hit);
      grp.position.set(posZ.x, posZ.y, posZ.z);
      env.add(grp);
      hitList.push(hit);
      coordViews.push({ id, grp, coreMat, core, halo });
    }
    // --- dynamic overlays: links, packets, zones, coverage ---
    const MAX_LINKS = 120;
    const linkPos = new Float32Array(MAX_LINKS * 2 * 3);
    const linkCol = new Float32Array(MAX_LINKS * 2 * 3);
    const linkGeo = new THREE.BufferGeometry();
    linkGeo.setAttribute("position", new THREE.BufferAttribute(linkPos, 3));
    linkGeo.setAttribute("color", new THREE.BufferAttribute(linkCol, 3));
    const linkLines = new THREE.LineSegments(linkGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
    linkLines.frustumCulled = false;
    env.add(linkLines);
    const MAX_PKT = 90;
    const pktPos = new Float32Array(MAX_PKT * 3);
    const pktCol = new Float32Array(MAX_PKT * 3);
    const pktGeo = new THREE.BufferGeometry();
    pktGeo.setAttribute("position", new THREE.BufferAttribute(pktPos, 3));
    pktGeo.setAttribute("color", new THREE.BufferAttribute(pktCol, 3));
    const pktPts = new THREE.Points(pktGeo, new THREE.PointsMaterial({ size: 0.4, map: T.glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    pktPts.frustumCulled = false;
    env.add(pktPts);
    // storm + interference
    const stormMesh = new THREE.Mesh(new THREE.BoxGeometry(19.5 - STORM_X, 11.5, 34), new THREE.MeshBasicMaterial({ color: 0xfb7185, transparent: true, opacity: 0.08, depthWrite: false }));
    stormMesh.position.set((STORM_X + 19.5) / 2, 5.75, 0);
    stormMesh.visible = false;
    env.add(stormMesh);
    const stormEdge = new THREE.LineSegments(new THREE.EdgesGeometry(stormMesh.geometry), new THREE.LineBasicMaterial({ color: 0xfb7185, transparent: true, opacity: 0.3 }));
    stormEdge.position.copy(stormMesh.position);
    stormEdge.visible = false;
    env.add(stormEdge);
    const interMesh = new THREE.Mesh(new THREE.CylinderGeometry(ZONE_R, ZONE_R, 2.6, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }));
    interMesh.position.set(ZONE_POS.x, heightAt(ZONE_POS.x, ZONE_POS.z) + 1.3, ZONE_POS.z);
    interMesh.visible = false;
    env.add(interMesh);
    const coverageGroup = new THREE.Group();
    for (const d of state.drones) {
      const c = new THREE.Mesh(new THREE.CircleGeometry(3.4, 28), new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.06, depthWrite: false }));
      c.rotation.x = -Math.PI / 2;
      coverageGroup.add(c);
    }
    coverageGroup.visible = false;
    env.add(coverageGroup);
    T.mapGroup = env;
    T.waterMat = waterMat;
    T.baseCores = baseCores;
    T.featureViews = featureViews;
    T.droneViews = droneViews;
    T.coordViews = coordViews;
    T.hitList = hitList;
    T.linkLines = linkLines; T.linkPos = linkPos; T.linkCol = linkCol;
    T.pktPts = pktPts; T.pktPos = pktPos; T.pktCol = pktCol;
    T.stormMesh = stormMesh; T.stormEdge = stormEdge; T.interMesh = interMesh;
    T.gridGroup = gridGroup; T.coverageGroup = coverageGroup; T.treeGroup = treeGroup;
    T.roadGroup = roadGroup;
    T.raycaster = T.raycaster || new THREE.Raycaster();
  }

  function syncThreeDynamic(t) {
    const T = state.three;
    if (!T || !T.ready) return;
    const cam = state.camera;
    // camera from spherical goal
    const yaw = cam.yaw, pitch = cam.pitch, dist = cam.dist;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    T.camera.position.set(
      cam.target[0] + dist * Math.sin(yaw) * cp,
      cam.target[1] + dist * sp,
      cam.target[2] + dist * Math.cos(yaw) * cp
    );
    T.camera.lookAt(cam.target[0], cam.target[1], cam.target[2]);
    // ambience by situation
    const sit = currentSituation();
    if (sit.night) {
      T.scene.background.setHex(0x02050d);
      T.ambient.intensity = 0.45; T.sun.intensity = 0.5;
    } else if (sit.id === "blackout") {
      T.scene.background.setHex(0x080420);
      T.ambient.intensity = 0.6; T.sun.intensity = 0.65;
    } else {
      T.scene.background.setHex(0x050b13);
      T.ambient.intensity = 0.75; T.sun.intensity = 0.9;
    }
    // water pulse
    if (T.waterMat) T.waterMat.opacity = 0.5 + 0.1 * Math.sin(t * 1.4);
    // base cores spin/pulse
    for (const b of (T.baseCores || [])) {
      b.core.rotation.y += 0.02;
      b.core.rotation.x += 0.008;
    }
    // features
    const now = performance.now() / 1000;
    for (const view of (T.featureViews || [])) {
      const f = view.f;
      const gh = Math.max(heightAt(f.x, f.z), (state.terrain ? state.terrain.waterLevel : 0) * 0.9);
      view.truth.position.set(f.x, gh + 0.05, f.z);
      view.marker.position.set(f.x, gh + 0.07, f.z);
      if (view.truth.userData.fire) {
        const fire = view.truth.userData.fire;
        const baseR = Math.max(0.8, f.r * 0.7);
        for (let i = 0; i < fire.COUNT; i++) {
          const p = fire.parts[i];
          const k = (t * 0.55 + p.o) % 1;
          const rr = baseR * 0.9 * p.r0 * (1 - k * 0.5);
          fire.posArr[i * 3] = Math.cos(p.a + t * 0.3) * rr;
          fire.posArr[i * 3 + 1] = 0.12 + k * baseR * 1.15;
          fire.posArr[i * 3 + 2] = Math.sin(p.a + t * 0.3) * rr;
          const heat = 1 - k;
          fire.colArr[i * 3] = heat;
          fire.colArr[i * 3 + 1] = heat * 0.35;
          fire.colArr[i * 3 + 2] = 0.1;
        }
        fire.points.geometry.attributes.position.needsUpdate = true;
        fire.points.geometry.attributes.color.needsUpdate = true;
      }
      if (view.truth.userData.ring) {
        const k = (t * 0.7) % 1;
        view.truth.userData.ring.scale.setScalar(1 + k * 3);
        view.truth.userData.ring.material.opacity = 0.6 * (1 - k);
      }
      const live = f.liveState === "live";
      const stale = f.liveState === "stale";
      const highlighted = state.highlightFeature === f.id && now < state.highlightUntil;
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.6 + f.phase);
      const scale = 1 + (live ? pulse * 0.08 : 0) + (highlighted ? 0.15 : 0);
      view.ring.scale.setScalar(scale);
      view.ringMat.opacity = live ? 0.95 : stale ? 0.6 : 0.35;
      view.beamMat.opacity = live ? 0.35 : stale ? 0.15 : 0.07;
      view.dia.rotation.y = t * 1.5 + f.phase;
      view.dia.scale.setScalar(1 + (live ? pulse * 0.15 : 0));
      if (!live) view.diaMat.opacity = 0.5; else view.diaMat.opacity = 0.95;
      view.marker.visible = state.layers.features;
      // label
      const stateLabel = live ? "LIVE" : stale ? "STALE" : "LOST";
      const labelText = f.label.toUpperCase() + " · " + stateLabel + " · " + f.confidence + "%";
      const labelColor = live ? view.type.color : stale ? "#fbbf24" : "#fb7185";
      setLabelSprite(view.label, labelText, labelColor);
      view.label.sprite.visible = state.layers.labels && state.layers.features;
    }
    // drones
    for (const view of (T.droneViews || [])) {
      const d = view.d;
      view.grp.position.set(d.pos.x, d.pos.y, d.pos.z);
      view.grp.rotation.y = -state.time * 0.35 - d.idx * 0.7;
      if (d.failed) {
        view.bodyMat.color.setHex(0xfb7185);
        view.bodyMat.emissive.setHex(0x3a0a12);
        view.glow.material.color.setHex(0xfb7185);
        view.glow.material.opacity = 0.4;
      } else if (d.leader) {
        view.bodyMat.color.setHex(0xfbbf24);
        view.bodyMat.emissive.setHex(0x5a3a00);
        view.glow.material.color.setHex(0xfbbf24);
        view.glow.material.opacity = 0.9;
      } else if (d.connected) {
        view.bodyMat.color.setHex(0x9fcfe0);
        view.bodyMat.emissive.setHex(0x0a4a5a);
        view.glow.material.color.setHex(0x22d3ee);
        view.glow.material.opacity = 0.8;
      } else {
        view.bodyMat.color.setHex(0xd9a441);
        view.bodyMat.emissive.setHex(0x4a3000);
        view.glow.material.color.setHex(0xfbbf24);
        view.glow.material.opacity = 0.6;
      }
      const selected = state.selected === d.id;
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.2 + d.idx);
      view.ring.material.opacity = selected ? 0.9 : 0;
      view.ring.scale.setScalar(1 + (selected ? pulse * 0.2 : 0));
      view.glow.visible = !d.failed;
    }
    // coordinators
    for (const view of (T.coordViews || [])) {
      const isMain = view.id === "MAIN";
      const active = isMain ? state.main.active : state.backup.active;
      view.core.rotation.y = t * 0.8;
      view.core.rotation.x = t * 0.3;
      view.grp.visible = true;
      view.coreMat.color.setHex(!active ? 0xfb7185 : isMain ? 0x22d3ee : 0xa78bfa);
      view.halo.material.opacity = active ? 0.5 : 0.2;
      view.grp.scale.setScalar(active ? 1 : 0.7);
    }
    // links
    if (T.linkLines) {
      let idx = 0;
      const cTree = [0.4, 0.91, 0.98], cLocal = [0.98, 0.75, 0.14], cBase = [0.27, 0.59, 0.72];
      for (const e of state.edges) {
        if (idx >= 120) break;
        const na = nodeById(e.a), nb = nodeById(e.b);
        if (!na || !nb) continue;
        const pa = na.pos, pb = nb.pos;
        T.linkPos[idx * 6] = pa.x; T.linkPos[idx * 6 + 1] = pa.y; T.linkPos[idx * 6 + 2] = pa.z;
        T.linkPos[idx * 6 + 3] = pb.x; T.linkPos[idx * 6 + 4] = pb.y; T.linkPos[idx * 6 + 5] = pb.z;
        const col = e.tree ? cTree : e.local ? cLocal : cBase;
        T.linkCol[idx * 6] = col[0]; T.linkCol[idx * 6 + 1] = col[1]; T.linkCol[idx * 6 + 2] = col[2];
        T.linkCol[idx * 6 + 3] = col[0]; T.linkCol[idx * 6 + 4] = col[1]; T.linkCol[idx * 6 + 5] = col[2];
        idx++;
      }
      T.linkLines.geometry.setDrawRange(0, idx * 2);
      T.linkLines.geometry.attributes.position.needsUpdate = true;
      T.linkLines.geometry.attributes.color.needsUpdate = true;
      T.linkLines.visible = state.layers.links;
    }
    // packets
    if (T.pktPts) {
      let n = 0;
      const cAmber = [0.98, 0.75, 0.14], cCyan = [0.4, 0.91, 0.98];
      for (const p of state.packets) {
        if (n >= 90) break;
        const na = nodeById(p.a), nb = nodeById(p.b);
        if (!na || !nb) continue;
        let k = clamp((state.time - p.born) / p.dur, 0, 1);
        k = k * k * (3 - 2 * k);
        if (p.dir) k = 1 - k;
        T.pktPos[n * 3] = lerp(na.pos.x, nb.pos.x, k);
        T.pktPos[n * 3 + 1] = lerp(na.pos.y, nb.pos.y, k);
        T.pktPos[n * 3 + 2] = lerp(na.pos.z, nb.pos.z, k);
        const local = state.drones.find((d) => d.id === p.a || d.id === p.b);
        const col = local && local.group ? cAmber : cCyan;
        T.pktCol[n * 3] = col[0]; T.pktCol[n * 3 + 1] = col[1]; T.pktCol[n * 3 + 2] = col[2];
        n++;
      }
      T.pktPts.geometry.setDrawRange(0, n);
      T.pktPts.geometry.attributes.position.needsUpdate = true;
      T.pktPts.geometry.attributes.color.needsUpdate = true;
      T.pktPts.visible = state.layers.packets;
    }
    // zones / grid / coverage
    if (T.stormMesh) {
      T.stormMesh.visible = state.storm;
      T.stormEdge.visible = state.storm;
      T.interMesh.visible = state.interference;
      T.interMesh.position.y = heightAt(ZONE_POS.x, ZONE_POS.z) + 1.3;
      T.gridGroup.visible = state.layers.grid;
      T.coverageGroup.visible = state.layers.coverage;
      if (T.coverageGroup.visible) {
        T.coverageGroup.children.forEach((cMesh, i) => {
          const d = state.drones[i];
          if (!d || d.failed) { cMesh.visible = false; return; }
          cMesh.visible = true;
          cMesh.position.set(d.pos.x, heightAt(d.pos.x, d.pos.z) + 0.05, d.pos.z);
          cMesh.material.color.setHex(d.group ? 0xfbbf24 : 0x22d3ee);
        });
      }
    }
  }

  function renderCommand3D(t) {
    syncThreeDynamic(t);
    if (state.three && state.three.ready) state.three.renderer.render(state.three.scene, state.three.camera);
    // HUD-only 2D overlay (corners + map name) on transparent canvas
    const ctx = state.ctx;
    if (ctx) {
      ctx.save();
      drawStageHud(t);
      ctx.restore();
    }
  }

  function pickAtThree(clientX, clientY) {
    const T = state.three;
    if (!T || !T.ready || !state.canvas3d) return null;
    const rect = state.canvas3d.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    T.raycaster.setFromCamera({ x: nx, y: ny }, T.camera);
    const hits = T.raycaster.intersectObjects(T.hitList || [], false);
    if (hits.length) return hits[0].object.userData.droneId || null;
    return null;
  }

  function drawFeatureGlyph(x, y, size, type, liveState, t, phase) {
    const ctx = state.ctx;
    const glyph = type.glyph;
    const alpha = liveState === "live" ? 1 : liveState === "stale" ? 0.72 : 0.46;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = type.color;
    ctx.fillStyle = type.color;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = type.color;
    ctx.shadowBlur = liveState === "live" ? 10 : 3;

    if (glyph === "flame") {
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.quadraticCurveTo(size * 0.85, -size * 0.2, size * 0.4, size * 0.75);
      ctx.quadraticCurveTo(0, size * 0.3, -size * 0.4, size * 0.75);
      ctx.quadraticCurveTo(-size * 0.85, -size * 0.2, 0, -size);
      ctx.fill();
    } else if (glyph === "plus") {
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-size * 0.75, 0);
      ctx.lineTo(size * 0.75, 0);
      ctx.moveTo(0, -size * 0.75);
      ctx.lineTo(0, size * 0.75);
      ctx.stroke();
    } else if (glyph === "square") {
      ctx.beginPath();
      ctx.rect(-size * 0.65, -size * 0.65, size * 1.3, size * 1.3);
      ctx.fill();
    } else if (glyph === "wave") {
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.72, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-size * 0.25, 0, size * 0.36, -Math.PI / 2, Math.PI / 2);
      ctx.arc(size * 0.25, 0, size * 0.36, Math.PI / 2, -Math.PI / 2);
      ctx.stroke();
    } else if (glyph === "circle") {
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.68, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = alpha * 0.4;
      ctx.beginPath();
      ctx.arc(0, 0, size * (1.1 + 0.15 * Math.sin(t * 1.4 + phase)), 0, TAU);
      ctx.stroke();
    } else if (glyph === "hex") {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i / 6) * TAU;
        const px = Math.cos(a) * size * 0.8;
        const py = Math.sin(a) * size * 0.8;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    } else if (glyph === "alert") {
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.lineTo(size * 0.9, size * 0.75);
      ctx.lineTo(-size * 0.9, size * 0.75);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#08131f";
      ctx.shadowBlur = 0;
      ctx.font = "bold " + Math.max(8, size * 1.25) + "px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("!", 0, size * 0.1);
    } else {
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.85);
      ctx.lineTo(size * 0.85, 0);
      ctx.lineTo(0, size * 0.85);
      ctx.lineTo(-size * 0.85, 0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawFeatures(t) {
    if (!state.layers.features) return;
    const ctx = state.ctx;
    const now = performance.now() / 1000;
    const items = [];
    for (const f of state.features) {
      const gh = Math.max(heightAt(f.x, f.z), (state.terrain ? state.terrain.waterLevel : 0) * 0.9);
      const ground = projectPoint({ x: f.x, y: gh + 0.05, z: f.z });
      if (!ground) continue;
      items.push({ f, ground, z: ground.z, gh });
    }
    items.sort((a, b) => b.z - a.z);

    for (const { f, ground, gh } of items) {
      const type = FEATURE_TYPES[f.type] || FEATURE_TYPES.hotspot;
      const live = f.liveState === "live";
      const stale = f.liveState === "stale";
      const highlighted = state.highlightFeature === f.id && now < state.highlightUntil;
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.6 + f.phase);

      const ring = f.r * (1 + (live ? pulse * 0.025 : 0));
      const ptsForRing = ellipsePoints(f.x, f.z, ring, ring, 44);
      const projected = ptsForRing.map((p) => projectPoint({ x: p[0], y: heightAt(p[0], p[1]) + 0.05, z: p[1] }));
      if (projected.every(Boolean)) {
        ctx.beginPath();
        ctx.moveTo(projected[0].x, projected[0].y);
        for (let i = 1; i < projected.length; i++) ctx.lineTo(projected[i].x, projected[i].y);
        ctx.closePath();
        ctx.fillStyle = "rgba(" + type.rgba + ", " + (live ? 0.09 : stale ? 0.045 : 0.025) + ")";
        ctx.fill();
        ctx.strokeStyle = "rgba(" + type.rgba + ", " + (live ? 0.5 : stale ? 0.28 : 0.14) + ")";
        ctx.lineWidth = live ? 1.2 : 1;
        if (!live) ctx.setLineDash([4, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
        if (live) {
          ctx.strokeStyle = "rgba(" + type.rgba + ", " + (0.12 + pulse * 0.16) + ")";
          ctx.beginPath();
          ctx.arc(ground.x, ground.y, f.r * ground.scale * 0.72 + pulse * 14, 0, TAU);
          ctx.stroke();
        }
      }

      const top = projectPoint({ x: f.x, y: gh + 5.0 + (live ? pulse * 0.3 : 0), z: f.z });
      if (!top) continue;
      const beacon = ctx.createLinearGradient(ground.x, ground.y, top.x, top.y);
      beacon.addColorStop(0, "rgba(" + type.rgba + ", " + (live ? 0.32 : 0.1) + ")");
      beacon.addColorStop(1, "rgba(" + type.rgba + ", " + (live ? 0.05 : 0.02) + ")");
      ctx.strokeStyle = beacon;
      ctx.lineWidth = 1;
      ctx.setLineDash(stale || !live ? [3, 4] : []);
      ctx.beginPath();
      ctx.moveTo(ground.x, ground.y);
      ctx.lineTo(top.x, top.y);
      ctx.stroke();
      ctx.setLineDash([]);

      if (highlighted) {
        ctx.strokeStyle = "rgba(" + type.rgba + ", 0.85)";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(top.x, top.y, 16 + pulse * 6, 0, TAU);
        ctx.stroke();
      }

      const size = clamp(top.scale * 0.11, 4.4, 9);
      drawFeatureGlyph(top.x, top.y, size, type, f.liveState, t, f.phase);

      if (state.layers.labels) {
        const stateLabel = live ? "LIVE" : stale ? "STALE" : "LOST";
        const label = f.label.toUpperCase() + " · " + stateLabel + " · " + f.confidence + "%";
        ctx.font = "8px 'JetBrains Mono', monospace";
        ctx.textAlign = "center";
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(4, 12, 20, 0.62)";
        ctx.fillRect(top.x - tw / 2 - 4, top.y - 22, tw + 8, 12);
        ctx.fillStyle = live
          ? "rgba(" + type.rgba + ", 0.95)"
          : stale
            ? "rgba(251, 191, 36, 0.85)"
            : "rgba(251, 113, 133, 0.8)";
        ctx.fillText(label, top.x, top.y - 13);
      }
    }
  }


  function drawGrid() {
    if (!state.layers.grid) return;
    const ctx = state.ctx;
    const span = 19.5;
    const step = 3.25;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(88, 160, 190, 0.12)";
    for (let v = -span; v <= span + 0.001; v += step) {
      // terrain-following grid lines (arena battlefield look)
      let line = [];
      for (let z = -span; z <= span + 0.001; z += 1.5) line.push({ x: v, y: heightAt(v, z) + 0.04, z });
      ctx.beginPath();
      polyline(line, false);
      ctx.stroke();
      line = [];
      for (let x = -span; x <= span + 0.001; x += 1.5) line.push({ x, y: heightAt(x, v) + 0.04, z: v });
      ctx.beginPath();
      polyline(line, false);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(34, 211, 238, 0.14)";
    ctx.lineWidth = 1;
    for (const radius of [6, 12, 18]) {
      const pts = [];
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * TAU;
        const px = Math.cos(a) * radius, pz = Math.sin(a) * radius;
        pts.push({ x: px, y: heightAt(px, pz) + 0.04, z: pz });
      }
      ctx.beginPath();
      polyline(pts, false);
      ctx.stroke();
    }

    const origin = projectPoint({ x: 0, y: heightAt(0, 0) + 0.04, z: 0 });
    if (origin && state.layers.labels) {
      ctx.fillStyle = "rgba(85, 112, 132, 0.8)";
      ctx.font = "9px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText("SECTOR 04 · BASE GRID", origin.x, origin.y + 26);
    }
  }

  function drawZones(t) {
    const ctx = state.ctx;

    if (state.storm) {
      const x = STORM_X;
      const corners = [
        projectPoint({ x, y: 0, z: -17 }),
        projectPoint({ x, y: 11.5, z: -17 }),
        projectPoint({ x, y: 11.5, z: 17 }),
        projectPoint({ x, y: 0, z: 17 })
      ];
      if (corners.every(Boolean)) {
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();
        ctx.fillStyle = "rgba(251, 113, 133, 0.035)";
        ctx.fill();
        ctx.strokeStyle = "rgba(251, 113, 133, 0.28)";
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 7]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(251, 113, 133, 0.12)";
        for (let y = 2.5; y < 11; y += 2.6) {
          ctx.beginPath();
          const a = projectPoint({ x, y, z: -17 });
          const b = projectPoint({ x, y, z: 17 });
          if (a && b) {
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
          }
          ctx.stroke();
        }
        const lp = projectPoint({ x, y: 12.4, z: 0 });
        if (lp && state.layers.labels) {
          ctx.fillStyle = "rgba(251, 113, 133, 0.8)";
          ctx.font = "10px 'JetBrains Mono', monospace";
          ctx.textAlign = "center";
          ctx.fillText("STORM PARTITION", lp.x, lp.y);
        }
      }
    }

    if (state.interference) {
      const pts = [];
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * TAU;
        const px = ZONE_POS.x + Math.cos(a) * ZONE_R, pz = ZONE_POS.z + Math.sin(a) * ZONE_R;
        pts.push({ x: px, y: heightAt(px, pz) + 0.08, z: pz });
      }
      ctx.beginPath();
      polyline(pts, true);
      ctx.fillStyle = "rgba(251, 191, 36, 0.055)";
      ctx.fill();
      ctx.strokeStyle = "rgba(251, 191, 36, 0.4)";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
      const zgh = heightAt(ZONE_POS.x, ZONE_POS.z);
      const c = projectPoint({ x: ZONE_POS.x, y: zgh + 0.1, z: ZONE_POS.z });
      const top = projectPoint({ x: ZONE_POS.x, y: zgh + 2.6, z: ZONE_POS.z });
      if (c && top) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
        ctx.strokeStyle = "rgba(251, 191, 36, " + (0.15 + pulse * 0.2) + ")";
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(top.x, top.y);
        ctx.stroke();
        ctx.fillStyle = "rgba(251, 191, 36, 0.12)";
        ctx.beginPath();
        ctx.arc(top.x, top.y, 6 + pulse * 4, 0, TAU);
        ctx.fill();
        if (state.layers.labels) {
          ctx.fillStyle = "rgba(251, 191, 36, 0.85)";
          ctx.font = "9px 'JetBrains Mono', monospace";
          ctx.textAlign = "center";
          ctx.fillText("INTERFERENCE", c.x, c.y + 16);
        }
      }
    }
  }

  function drawBeam() {
    if (!state.main.active) return;
    const ctx = state.ctx;
    const a = projectPoint({ x: 0, y: heightAt(0, 0) + 0.1, z: 0 });
    const b = projectPoint(MAIN_POS);
    if (!a || !b) return;
    const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    g.addColorStop(0, "rgba(34, 211, 238, 0.02)");
    g.addColorStop(0.6, "rgba(34, 211, 238, 0.16)");
    g.addColorStop(1, "rgba(103, 232, 249, 0.4)");
    ctx.strokeStyle = g;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const ang = (i / 40) * TAU;
      const px = Math.cos(ang) * 2.7, pz = Math.sin(ang) * 2.7;
      pts.push({ x: px, y: heightAt(px, pz) + 0.06, z: pz });
    }
    ctx.beginPath();
    polyline(pts, true);
    ctx.strokeStyle = "rgba(103, 232, 249, 0.18)";
    ctx.setLineDash([3, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawCoverage() {
    if (!state.layers.coverage) return;
    const ctx = state.ctx;
    for (const d of state.activeDrones) {
      const pts = [];
      for (let i = 0; i <= 28; i++) {
        const a = (i / 28) * TAU;
        const px = d.pos.x + Math.cos(a) * 3.4, pz = d.pos.z + Math.sin(a) * 3.4;
        pts.push({ x: px, y: heightAt(px, pz) + 0.05, z: pz });
      }
      ctx.beginPath();
      polyline(pts, true);
      ctx.fillStyle = d.group ? "rgba(251, 191, 36, 0.025)" : "rgba(34, 211, 238, 0.025)";
      ctx.fill();
      ctx.strokeStyle = d.group ? "rgba(251, 191, 36, 0.13)" : "rgba(34, 211, 238, 0.13)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function drawLinks() {
    if (!state.layers.links) return;
    const ctx = state.ctx;
    const base = [];
    const local = [];
    const tree = [];

    for (const e of state.edges) {
      const a = projectPoint(nodeById(e.a).pos);
      const b = projectPoint(nodeById(e.b).pos);
      if (!a || !b) continue;
      if (e.kind === "main" || e.kind === "backup") {
        base.push([a, b, e]);
      } else if (e.tree) {
        tree.push([a, b, e]);
      } else if (e.local) {
        local.push([a, b, e]);
      } else {
        base.push([a, b, e]);
      }
    }

    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(70, 150, 183, 0.16)";
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (const [a, b] of base) {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();

    ctx.strokeStyle = "rgba(251, 191, 36, 0.26)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [a, b] of local) {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();

    ctx.save();
    ctx.shadowColor = "rgba(34, 211, 238, 0.65)";
    ctx.shadowBlur = 5;
    ctx.strokeStyle = "rgba(103, 232, 249, 0.48)";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    for (const [a, b] of tree) {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.restore();

    // Severed links remain visible as broken, dashed red traces.
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = "rgba(251, 113, 133, 0.32)";
    ctx.lineWidth = 1.1;
    for (const s of state.severed) {
      const na = nodeById(s.a);
      const nb = nodeById(s.b);
      if (!na || !nb) continue;
      const a = projectPoint(na.pos);
      const b = projectPoint(nb.pos);
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(251, 113, 133, 0.75)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(mx - 3, my - 3);
      ctx.lineTo(mx + 3, my + 3);
      ctx.moveTo(mx + 3, my - 3);
      ctx.lineTo(mx - 3, my + 3);
      ctx.stroke();
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = "rgba(251, 113, 133, 0.32)";
      ctx.lineWidth = 1.1;
    }
    ctx.restore();
  }

  function drawGroupHalos() {
    if (!state.groups.length) return;
    const ctx = state.ctx;
    for (const g of state.groups) {
      const pts = g.members
        .map((id) => projectPoint(state.drones.find((d) => d.id === id).pos))
        .filter(Boolean);
      if (pts.length < 2) continue;
      let cx = 0;
      let cy = 0;
      for (const p of pts) {
        cx += p.x;
        cy += p.y;
      }
      cx /= pts.length;
      cy /= pts.length;
      let maxR = 0;
      for (const p of pts) maxR = Math.max(maxR, Math.hypot(p.x - cx, p.y - cy));
      const pulse = 0.5 + 0.5 * Math.sin(state.time * 1.6 + g.id);
      ctx.save();
      ctx.strokeStyle = "rgba(251, 191, 36, " + (0.1 + pulse * 0.1) + ")";
      ctx.setLineDash([4, 8]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, maxR + 18, 0, TAU);
      ctx.stroke();
      ctx.restore();
      if (state.layers.labels) {
        ctx.fillStyle = "rgba(251, 191, 36, 0.65)";
        ctx.font = "8px 'JetBrains Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText("LOCAL GROUP " + g.id, cx, cy - maxR - 24);
      }
    }
  }

  function drawPacket(p, t) {
    const na = nodeById(p.a);
    const nb = nodeById(p.b);
    if (!na || !nb) return;
    const pa = projectPoint(na.pos);
    const pb = projectPoint(nb.pos);
    if (!pa || !pb) return;
    let k = clamp((state.time - p.born) / p.dur, 0, 1);
    k = k * k * (3 - 2 * k);
    if (p.dir) k = 1 - k;
    const x = lerp(pa.x, pb.x, k);
    const y = lerp(pa.y, pb.y, k);
    const ctx = state.ctx;
    const local = state.drones.find((d) => d.id === p.a || d.id === p.b);
    const color = local && local.group ? C.amber : C.cyan2;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const back = clamp(k - 0.06, 0, 1);
    ctx.lineTo(lerp(pa.x, pb.x, p.dir ? 1 - back : back), lerp(pa.y, pb.y, p.dir ? 1 - back : back));
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 9;
    ctx.beginPath();
    ctx.arc(x, y, p.size, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawObservations(t) {
    if (!state.layers.observations) return;
    const ctx = state.ctx;
    for (const d of state.activeDrones) {
      const p = projectPoint({ x: d.pos.x, y: d.pos.y + 0.95, z: d.pos.z });
      if (!p) continue;
      const color = d.status === "connected" ? C.green : d.status === "delayed" ? C.amber : C.red;
      const pulse = (t * 0.55 + d.idx * 0.37) % 1;
      ctx.save();
      ctx.globalAlpha = (1 - pulse) * 0.4;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4 + pulse * 12, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 3.4);
      ctx.lineTo(p.x + 3.4, p.y);
      ctx.lineTo(p.x, p.y + 3.4);
      ctx.lineTo(p.x - 3.4, p.y);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  /* ============================================================
     Node rendering
     ============================================================ */

  function drawDrone(d, t) {
    const ctx = state.ctx;
    const p = projectPoint(d.pos);
    if (!p) return;
    const halo = clamp(p.scale * 0.9, 7, 30);
    state.screenNodes.push({ id: d.id, x: p.x, y: p.y, r: Math.max(11, halo), kind: "drone" });

    if (d.failed) {
      ctx.save();
      ctx.strokeStyle = "rgba(251, 113, 133, 0.25)";
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, halo, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(251, 113, 133, 0.85)";
      ctx.lineWidth = 1.6;
      const s = Math.max(4, halo * 0.32);
      ctx.beginPath();
      ctx.moveTo(p.x - s, p.y - s);
      ctx.lineTo(p.x + s, p.y + s);
      ctx.moveTo(p.x + s, p.y - s);
      ctx.lineTo(p.x - s, p.y + s);
      ctx.stroke();
      if (state.layers.labels) {
        ctx.fillStyle = "rgba(251, 113, 133, 0.75)";
        ctx.font = "9px 'JetBrains Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText(d.id + " · LOST", p.x, p.y + halo + 13);
      }
      ctx.restore();
      return;
    }

    const color = d.leader ? C.amber : d.connected ? C.cyan2 : C.amber;
    const selected = state.selected === d.id;
    const hovered = state.hover === d.id;

    ctx.save();
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, halo * 1.2);
    glow.addColorStop(0, d.leader ? "rgba(251,191,36,0.3)" : "rgba(34,211,238,0.24)");
    glow.addColorStop(0.55, d.leader ? "rgba(251,191,36,0.06)" : "rgba(34,211,238,0.05)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, halo * 1.2, 0, TAU);
    ctx.fill();

    if (selected || hovered) {
      ctx.strokeStyle = selected ? "rgba(103, 232, 249, 0.9)" : "rgba(103, 232, 249, 0.35)";
      ctx.lineWidth = 1.2;
      ctx.setLineDash(selected ? [4, 4] : []);
      ctx.lineDashOffset = selected ? -t * 12 : 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, halo + 4, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      if (selected) {
        const tick = halo + 10;
        ctx.strokeStyle = "rgba(103, 232, 249, 0.65)";
        ctx.beginPath();
        for (let k = 0; k < 4; k++) {
          const ang = (k / 4) * TAU + Math.PI / 4;
          const sx = p.x + Math.cos(ang) * tick;
          const sy = p.y + Math.sin(ang) * tick;
          ctx.moveTo(sx, sy);
          ctx.lineTo(p.x + Math.cos(ang) * (tick + 4), p.y + Math.sin(ang) * (tick + 4));
        }
        ctx.stroke();
      }
    }

    const rot = t * 0.35 + d.idx * 0.7;
    const arm = halo * 0.72;
    ctx.strokeStyle = d.leader ? "rgba(253, 230, 138, 0.75)" : "rgba(165, 243, 252, 0.65)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const a = rot + (k / 4) * TAU + Math.PI / 4;
      const ex = p.x + Math.cos(a) * arm;
      const ey = p.y + Math.sin(a) * arm;
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(ex, ey);
    }
    ctx.stroke();

    ctx.fillStyle = "rgba(103, 232, 249, 0.16)";
    for (let k = 0; k < 4; k++) {
      const a = rot + (k / 4) * TAU + Math.PI / 4;
      ctx.beginPath();
      ctx.arc(p.x + Math.cos(a) * arm, p.y + Math.sin(a) * arm, Math.max(1.6, halo * 0.16), 0, TAU);
      ctx.fill();
    }

    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(2.6, halo * 0.3), 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;

    if (d.leader) {
      ctx.strokeStyle = "rgba(251, 191, 36, 0.75)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, halo + 9, 0, TAU);
      ctx.stroke();
    }

    if (state.layers.labels) {
      ctx.textAlign = "center";
      ctx.font = "9px 'JetBrains Mono', monospace";
      ctx.fillStyle = d.leader ? "rgba(253, 230, 138, 0.95)" : d.connected ? "rgba(200, 240, 250, 0.82)" : "rgba(251, 191, 36, 0.85)";
      ctx.fillText(d.id, p.x, p.y + halo + 14);
      if (d.leader) {
        ctx.font = "7px 'JetBrains Mono', monospace";
        ctx.fillStyle = "rgba(251, 191, 36, 0.7)";
        ctx.fillText("LOCAL LEAD", p.x, p.y - halo - 9);
      }
    }
    ctx.restore();
  }

  function drawCoordinator(id, t) {
    const ctx = state.ctx;
    const isMain = id === "MAIN";
    const active = isMain ? state.main.active : state.backup.active;
    const pos = isMain ? MAIN_POS : BKUP_POS;
    const p = projectPoint(pos);
    if (!p) return;
    const R = clamp(p.scale * (isMain ? 1.05 : 0.8), 9, 46);
    state.screenNodes.push({ id, x: p.x, y: p.y, r: Math.max(14, R * 1.1), kind: "coordinator" });

    ctx.save();
    if (!active) {
      ctx.strokeStyle = "rgba(251, 113, 133, 0.5)";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      polygonPath(p.x, p.y, R * 0.8, 6, Math.PI / 6);
      ctx.stroke();
      ctx.setLineDash([]);
      const s = Math.max(5, R * 0.35);
      ctx.strokeStyle = "rgba(251, 113, 133, 0.9)";
      ctx.beginPath();
      ctx.moveTo(p.x - s, p.y - s);
      ctx.lineTo(p.x + s, p.y + s);
      ctx.moveTo(p.x + s, p.y - s);
      ctx.lineTo(p.x - s, p.y + s);
      ctx.stroke();
      if (state.layers.labels) {
        ctx.fillStyle = "rgba(251, 113, 133, 0.85)";
        ctx.font = "9px 'JetBrains Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText(isMain ? "MAIN AI · OFFLINE" : "BACKUP · OFFLINE", p.x, p.y + R + 15);
      }
      if (isMain && state.handoverTimer > 0) {
        ctx.fillStyle = "rgba(251, 191, 36, 0.9)";
        ctx.font = "8px 'JetBrains Mono', monospace";
        ctx.fillText("FAILOVER IN " + state.handoverTimer.toFixed(1) + "s", p.x, p.y + R + 28);
      }
      ctx.restore();
      return;
    }

    const color = isMain ? C.cyan : C.violet;
    const rgba = isMain ? "34, 211, 238" : "167, 139, 250";
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R * 2.4);
    glow.addColorStop(0, "rgba(" + rgba + ", 0.32)");
    glow.addColorStop(0.5, "rgba(" + rgba + ", 0.07)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, R * 2.4, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = "rgba(" + rgba + ", 0.28)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 6]);
    ctx.lineDashOffset = t * 8;
    ctx.beginPath();
    ctx.arc(p.x, p.y, R * 1.55, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = "rgba(" + rgba + ", 0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    polygonPath(p.x, p.y, R * 0.92, 6, Math.PI / 6);
    ctx.stroke();
    ctx.fillStyle = isMain ? "rgba(7, 30, 44, 0.92)" : "rgba(20, 17, 38, 0.92)";
    ctx.fill();

    ctx.fillStyle = "rgba(" + rgba + ", 0.16)";
    ctx.beginPath();
    polygonPath(p.x, p.y, R * 0.62, 6, Math.PI / 6);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    polygonPath(p.x, p.y, R * 0.62, 6, Math.PI / 6);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(2, R * 0.13), 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;

    for (let k = 0; k < 3; k++) {
      const a = t * 0.8 + (k / 3) * TAU;
      const ox = p.x + Math.cos(a) * R * 1.55;
      const oy = p.y + Math.sin(a) * R * 1.55;
      ctx.fillStyle = "rgba(" + rgba + ", 0.7)";
      ctx.beginPath();
      ctx.arc(ox, oy, Math.max(1.2, R * 0.07), 0, TAU);
      ctx.fill();
    }

    if (state.layers.labels) {
      ctx.textAlign = "center";
      ctx.font = "9px 'JetBrains Mono', monospace";
      ctx.fillStyle = isMain ? "rgba(165, 243, 252, 0.9)" : "rgba(196, 181, 253, 0.9)";
      ctx.fillText(isMain ? "MAIN AI" : "BACKUP AI", p.x, p.y + R + 17);
      if (state.acting === id) {
        ctx.font = "7px 'JetBrains Mono', monospace";
        ctx.fillStyle = isMain ? "rgba(52, 211, 153, 0.9)" : "rgba(52, 211, 153, 0.9)";
        ctx.fillText("ACTING COORDINATOR", p.x, p.y - R - 14);
      }
    }
    ctx.restore();
  }

  function polygonPath(cx, cy, radius, sides, rotation) {
    for (let i = 0; i < sides; i++) {
      const a = rotation + (i / sides) * TAU;
      const x = cx + Math.cos(a) * radius;
      const y = cy + Math.sin(a) * radius;
      if (i === 0) state.ctx.moveTo(x, y);
      else state.ctx.lineTo(x, y);
    }
    state.ctx.closePath();
  }

  /* ============================================================
     Command view
     ============================================================ */

  function renderCommand(t) {
    drawBackdrop(t);
    drawMapGround(t);
    drawGrid();
    drawBeam();
    drawCoverage();
    drawZones(t);
    if (state.layers.links) drawLinks();

    if (state.layers.packets) {
      for (const packet of state.packets) drawPacket(packet, t);
    }

    drawFeatures(t);
    drawGroupHalos();
    drawObservations(t);

    state.screenNodes = [];
    const drawable = [];
    const pm = projectPoint(MAIN_POS);
    if (pm) drawable.push({ kind: "main", z: pm.z });
    const pb = projectPoint(BKUP_POS);
    if (pb) drawable.push({ kind: "backup", z: pb.z });
    for (const d of state.drones) {
      const p = projectPoint(d.pos);
      if (p) drawable.push({ kind: "drone", d, z: p.z });
    }
    drawable.sort((a, b) => b.z - a.z);
    for (const item of drawable) {
      if (item.kind === "drone") drawDrone(item.d, t);
      else drawCoordinator(item.kind === "main" ? "MAIN" : "BKUP", t);
    }

    drawStageHud(t);
  }

  function drawStageHud(t) {
    const ctx = state.ctx;
    const W = state.W;
    const H = state.H;
    ctx.save();
    ctx.strokeStyle = "rgba(103, 232, 249, 0.16)";
    ctx.lineWidth = 1;
    const m = 12;
    const len = 16;
    ctx.beginPath();
    ctx.moveTo(m, m + len);
    ctx.lineTo(m, m);
    ctx.lineTo(m + len, m);
    ctx.moveTo(W - m - len, m);
    ctx.lineTo(W - m, m);
    ctx.lineTo(W - m, m + len);
    ctx.moveTo(m, H - m - len);
    ctx.lineTo(m, H - m);
    ctx.lineTo(m + len, H - m);
    ctx.moveTo(W - m - len, H - m);
    ctx.lineTo(W - m, H - m);
    ctx.lineTo(W - m, H - m - len);
    ctx.stroke();

    const map = currentMap();
    const sit = currentSituation();
    ctx.textAlign = "right";
    ctx.font = "8px 'JetBrains Mono', monospace";
    ctx.fillStyle = map.palette.edge;
    ctx.fillText(map.label.toUpperCase() + " · " + sit.label.toUpperCase(), W - 18, 21);

    if (state.layers.grid) {
      ctx.fillStyle = "rgba(85, 112, 132, 0.65)";
      ctx.font = "8px 'JetBrains Mono', monospace";
      ctx.textAlign = "right";
      ctx.fillText(map.place.toUpperCase(), W - 18, H - 20);
      ctx.textAlign = "left";
      ctx.fillText("SIMULATED / SOFTWARE ONLY", 18, H - 20);
    }
    ctx.restore();
  }


  /* ============================================================
     Network topology view
     ============================================================ */

  function renderTopology(t) {
    const ctx = state.ctx;
    const W = state.W;
    const H = state.H;
    drawBackdrop(t);

    // subtle background dot grid
    ctx.fillStyle = "rgba(103, 232, 249, 0.06)";
    for (let x = 20; x < W; x += 26) {
      for (let y = 20; y < H; y += 26) {
        ctx.fillRect(x, y, 1, 1);
      }
    }

    const cx = W / 2;
    const cy = H / 2;
    const layout = new Map();
    const activeId = state.acting;
    const centerId = activeId || (state.backup.active ? "BKUP" : state.main.active ? "MAIN" : null);

    if (centerId) layout.set(centerId, { x: cx, y: cy });
    const other = centerId === "MAIN" ? "BKUP" : centerId === "BKUP" ? "MAIN" : null;
    if (other && (other === "MAIN" ? state.main.active : state.backup.active)) {
      layout.set(other, {
        x: cx - Math.min(88, W * 0.13),
        y: cy - Math.min(92, H * 0.2)
      });
    }

    const active = state.activeDrones;
    const buckets = new Map();
    for (const d of active) {
      if (d.connected && d.hops != null && d.hops > 0) {
        if (!buckets.has(d.hops)) buckets.set(d.hops, []);
        buckets.get(d.hops).push(d);
      }
    }
    const hopLevels = Array.from(buckets.keys()).sort((a, b) => a - b);
    const maxR = Math.min(W * 0.43, H * 0.38);
    const baseR = Math.min(94, maxR * 0.42);
    const span = Math.max(1, hopLevels.length);
    hopLevels.forEach((hop, hi) => {
      const radius = Math.min(maxR, baseR + (hi + 1) * Math.max(50, (maxR - baseR) / span));
      const list = buckets.get(hop).slice().sort((a, b) => a.idx - b.idx);
      list.forEach((d, i) => {
        const angle = -Math.PI / 2 + ((i + 0.5) / list.length) * TAU + hop * 0.33;
        layout.set(d.id, {
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius
        });
      });
    });

    const outer = Math.min(Math.max(maxR + 34, 150), Math.min(W, H) / 2 - 24);
    if (state.groups.length) {
      state.groups.forEach((g, gi) => {
        const base = -Math.PI / 2 + ((gi + 0.5) / state.groups.length) * TAU;
        const arc = TAU * 0.78;
        const step = Math.min(0.45, arc / Math.max(3, g.members.length));
        g.members.forEach((id, mi) => {
          const angle = base + (mi - (g.members.length - 1) / 2) * step;
          layout.set(id, {
            x: cx + Math.cos(angle) * outer,
            y: cy + Math.sin(angle) * outer
          });
        });
      });
    }

    const failed = state.drones.filter((d) => d.failed);
    failed.forEach((d, i) => {
      const angle = Math.PI * 0.62 + (i - (failed.length - 1) / 2) * 0.22;
      layout.set(d.id, {
        x: cx + Math.cos(angle) * (outer - 4),
        y: cy + Math.sin(angle) * (outer - 4)
      });
    });

    // Ensure every active drone has a visible coordinate.
    for (const d of active) {
      if (!layout.has(d.id)) {
        const angle = (d.idx / CFG.count) * TAU - Math.PI / 2;
        layout.set(d.id, {
          x: cx + Math.cos(angle) * outer,
          y: cy + Math.sin(angle) * outer
        });
      }
    }

    // Hop rings
    ctx.save();
    hopLevels.forEach((hop, hi) => {
      const radius = Math.min(maxR, baseR + (hi + 1) * Math.max(50, (maxR - baseR) / span));
      ctx.strokeStyle = "rgba(103, 232, 249, 0.11)";
      ctx.setLineDash([3, 6]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      const a = -Math.PI / 2 + 0.55 + hi * 0.2;
      ctx.fillStyle = "rgba(85, 112, 132, 0.8)";
      ctx.font = "8px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText("HOP " + hop, cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    });

    // Coordinator centre marker
    if (!centerId) {
      ctx.fillStyle = "rgba(251, 113, 133, 0.14)";
      ctx.strokeStyle = "rgba(251, 113, 133, 0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, 28, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(251, 113, 133, 0.85)";
      ctx.font = "8px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText("NO CENTRAL", cx, cy - 2);
      ctx.fillText("COORDINATOR", cx, cy + 8);
    }
    ctx.restore();

    // Links
    const drawTopoEdge = (a, b, color, width, dash, glow) => {
      ctx.save();
      if (dash) ctx.setLineDash(dash);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      if (glow) {
        ctx.shadowColor = color;
        ctx.shadowBlur = glow;
      }
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
    };

    if (state.layers.links) {
      for (const e of state.edges) {
        const a = layout.get(e.a);
        const b = layout.get(e.b);
        if (!a || !b) continue;
        if (e.tree) drawTopoEdge(a, b, "rgba(103, 232, 249, 0.55)", 1.4, null, 5);
        else if (e.local) drawTopoEdge(a, b, "rgba(251, 191, 36, 0.3)", 1.1, null, 0);
        else drawTopoEdge(a, b, "rgba(70, 150, 183, 0.18)", 1, null, 0);
      }
      for (const s of state.severed) {
        const a = layout.get(s.a);
        const b = layout.get(s.b);
        if (a && b) drawTopoEdge(a, b, "rgba(251, 113, 133, 0.45)", 1.1, [5, 5], 0);
      }
    }

    // Packets
    if (state.layers.packets) {
      for (const p of state.packets) {
        const a = layout.get(p.a);
        const b = layout.get(p.b);
        if (!a || !b) continue;
        let k = clamp((state.time - p.born) / p.dur, 0, 1);
        k = k * k * (3 - 2 * k);
        if (p.dir) k = 1 - k;
        const x = lerp(a.x, b.x, k);
        const y = lerp(a.y, b.y, k);
        const node = state.drones.find((d) => d.id === p.a || d.id === p.b);
        const color = node && node.group ? C.amber : C.cyan2;
        ctx.save();
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }

    // Nodes
    state.screenNodes = [];
    const dronePositions = [];
    for (const d of active) {
      const p = layout.get(d.id);
      if (!p) continue;
      dronePositions.push({ d, p });
    }
    // Failed drones first so live nodes sit on top.
    for (const d of failed) {
      const p = layout.get(d.id);
      if (!p) continue;
      ctx.save();
      ctx.strokeStyle = "rgba(251, 113, 133, 0.45)";
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 13, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(251, 113, 133, 0.9)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.x - 5, p.y - 5);
      ctx.lineTo(p.x + 5, p.y + 5);
      ctx.moveTo(p.x + 5, p.y - 5);
      ctx.lineTo(p.x - 5, p.y + 5);
      ctx.stroke();
      ctx.fillStyle = "rgba(251, 113, 133, 0.8)";
      ctx.font = "8px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText(d.id + " · LOST", p.x, p.y + 27);
      ctx.restore();
      state.screenNodes.push({ id: d.id, x: p.x, y: p.y, r: 16, kind: "drone" });
    }

    for (const { d, p } of dronePositions) {
      const selected = state.selected === d.id;
      const hovered = state.hover === d.id;
      const color = d.connected ? C.cyan2 : C.amber;
      ctx.save();
      const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 27);
      glow.addColorStop(0, (d.leader ? "rgba(251,191,36,0.25)" : "rgba(34,211,238,0.2)"));
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 27, 0, TAU);
      ctx.fill();

      ctx.fillStyle = "#071a26";
      ctx.strokeStyle = d.leader ? C.amber : color;
      ctx.lineWidth = selected ? 2 : 1.3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 14, 0, TAU);
      ctx.fill();
      ctx.stroke();

      // battery arc
      const battery = clamp(d.battery / 100, 0, 1);
      ctx.strokeStyle = battery < 0.32 ? C.amber : "rgba(45, 212, 191, 0.7)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 18, -Math.PI / 2, -Math.PI / 2 + TAU * battery);
      ctx.stroke();

      ctx.fillStyle = d.connected ? "#d9fbff" : "#fde68a";
      ctx.font = "600 8px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(d.id, p.x, p.y + 0.5);

      ctx.textBaseline = "alphabetic";
      ctx.font = "7px 'JetBrains Mono', monospace";
      ctx.fillStyle = d.leader ? "rgba(253, 230, 138, 0.9)" : "rgba(124, 152, 172, 0.85)";
      ctx.fillText(
        d.leader ? "LOCAL LEAD" : d.connected ? d.hops + " HOP" + (d.hops === 1 ? "" : "S") : "DELAYED",
        p.x,
        p.y + 31
      );

      if (selected || hovered) {
        ctx.strokeStyle = selected ? "rgba(103, 232, 249, 0.9)" : "rgba(103, 232, 249, 0.35)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = selected ? -t * 10 : 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 23, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
      state.screenNodes.push({ id: d.id, x: p.x, y: p.y, r: 18, kind: "drone" });
    }

    for (const id of ["MAIN", "BKUP"]) {
      const p = layout.get(id);
      if (!p) continue;
      const isMain = id === "MAIN";
      const active = isMain ? state.main.active : state.backup.active;
      if (!active) continue;
      const acting = state.acting === id;
      const color = isMain ? C.cyan : C.violet;
      const rgba = isMain ? "34, 211, 238" : "167, 139, 250";
      ctx.save();
      const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 50);
      glow.addColorStop(0, "rgba(" + rgba + ", 0.28)");
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 50, 0, TAU);
      ctx.fill();

      ctx.fillStyle = "#06141f";
      ctx.strokeStyle = "rgba(" + rgba + ", 0.9)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 24, 0, TAU);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = "rgba(" + rgba + ", 0.45)";
      ctx.setLineDash([2, 5]);
      ctx.lineDashOffset = t * 6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 31, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = color;
      ctx.font = "600 7px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(isMain ? "MAIN" : "BKUP", p.x, p.y);
      ctx.textBaseline = "alphabetic";
      ctx.font = "7px 'JetBrains Mono', monospace";
      ctx.fillStyle = "rgba(" + rgba + ", 0.9)";
      ctx.fillText(acting ? "ACTING COORDINATOR" : "STANDBY REPLICA", p.x, p.y + 44);
      if (selectedFor(state.selected, id)) {
        ctx.strokeStyle = "rgba(103, 232, 249, 0.9)";
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 37, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
      state.screenNodes.push({ id, x: p.x, y: p.y, r: 28, kind: "coordinator" });
    }

    // HUD
    ctx.save();
    ctx.fillStyle = "rgba(85, 112, 132, 0.75)";
    ctx.font = "8px 'JetBrains Mono', monospace";
    ctx.textAlign = "left";
    ctx.fillText("RINGS = DISTANCE IN HOPS FROM ACTIVE COORDINATOR", 18, H - 20);
    ctx.textAlign = "right";
    ctx.fillText(
      active.length + " ACTIVE NODES · " + state.edges.length + " LINKS",
      W - 18,
      H - 20
    );
    ctx.restore();
  }

  function selectedFor(selected, id) {
    return selected === id;
  }


  /* ============================================================
     Camera, pointer interaction, input
     ============================================================ */

  function angleLerp(a, b, t) {
    const d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
    return a + d * t;
  }

  function updateCamera(dt) {
    const cam = state.camera;
    const goal = state.camGoal;
    if (goal.auto && !state.dragging) goal.yaw += dt * 0.45;
    // Self-heal sessions parked at the old flat horizon: never stay below 0.22.
    goal.pitch = clamp(goal.pitch, 0.22, 1.52);
    const k = Math.min(1, dt * 8);
    cam.yaw = angleLerp(cam.yaw, goal.yaw, k);
    cam.pitch = lerp(cam.pitch, goal.pitch, k);
    cam.dist = lerp(cam.dist, goal.dist, k);
    for (let i = 0; i < 3; i++) cam.target[i] = lerp(cam.target[i], goal.target[i], k);
  }

  function cancelAuto() {
    state.camGoal.auto = false;
    state.camera.auto = false;
    $$("[data-camera]").forEach((b) => b.classList.remove("is-active"));
  }

  function orbitCamera(dx, dy) {
    // ~0.011 rad/px: a single drag across the canvas (~570 px) covers a
    // full 360° orbit without re-grabbing.
    state.camGoal.yaw += dx * 0.011;
    // Drag up (negative dy) lifts the camera toward top-down.
    // Two guards keep sideways 360° drags usable: mostly-vertical drags
    // change pitch, mostly-horizontal drags hold it — and the low end is
    // clamped at 0.22 rad so the camera never drops to the flat horizon
    // where the battlefield disappears edge-on.
    const vertical = Math.abs(dx) > Math.abs(dy) * 3 ? 0 : dy;
    state.camGoal.pitch = clamp(state.camGoal.pitch - vertical * 0.004, 0.22, 1.52);
    state.camera.yaw = state.camGoal.yaw;
    state.camera.pitch = state.camGoal.pitch;
  }

  function panCamera(dx, dy) {
    const k = state.camGoal.dist / 540;
    const cy = Math.cos(state.camGoal.yaw);
    const sy = Math.sin(state.camGoal.yaw);
    const wx = cy * dx - sy * dy;
    const wz = sy * dx + cy * dy;
    state.camGoal.target[0] -= wx * k;
    state.camGoal.target[2] -= wz * k;
    state.camera.target[0] = state.camGoal.target[0];
    state.camera.target[2] = state.camGoal.target[2];
  }

  function pickAt(clientX, clientY) {
    if (state.view === "command" && threeAvailable()) {
      const hit = pickAtThree(clientX, clientY);
      if (hit) return hit;
    }
    const canvas = state.canvas;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best = null;
    for (const n of state.screenNodes) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d <= n.r + 6 && (!best || d < best.d)) best = { id: n.id, d };
    }
    return best ? best.id : null;
  }

  function updateHover(e) {
    if (state.dragging) return;
    const id = pickAt(e.clientX, e.clientY);
    if (state.hover !== id) state.hover = id;
    const active = state.view === "command" && threeAvailable() ? state.canvas3d : state.canvas;
    if (active) active.style.cursor = id ? "pointer" : "";
    else if (state.canvas) state.canvas.style.cursor = id ? "pointer" : "";
  }

  function hideCanvasHint() {
    if (el.canvasHint) el.canvasHint.classList.add("is-hidden");
  }

  function bindCanvasInput() {
    for (const c of [state.canvas, state.canvas3d]) {
      if (c) attachCanvasInput(c);
    }
  }

  function attachCanvasInput(canvas) {
    if (!canvas) return;
    const pointers = new Map();
    let dragButton = 0;

    canvas.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 2) return;
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dragButton = e.button;
      state.dragging = true;
      state.dragMoved = 0;
      cancelAuto();
      hideCanvasHint();
      canvas.classList.add("is-dragging");
      if (pointers.size === 2) {
        const arr = Array.from(pointers.values());
        state.pinch = {
          dist: Math.max(1, Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y)),
          start: state.camGoal.dist
        };
      }
    });

    canvas.addEventListener("pointermove", (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) {
        updateHover(e);
        return;
      }
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size >= 2 && state.pinch) {
        const arr = Array.from(pointers.values());
        const d = Math.max(1, Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y));
        state.camGoal.dist = clamp((state.pinch.start * state.pinch.dist) / d, 16, 74);
        state.dragMoved += Math.abs(dx) + Math.abs(dy);
        return;
      }

      if (!state.dragging) return;
      state.dragMoved += Math.abs(dx) + Math.abs(dy);
      const pan = dragButton === 2 || e.shiftKey;
      if (pan) panCamera(dx, dy);
      else orbitCamera(dx, dy);
    });

    const endPointer = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) state.pinch = null;
      if (pointers.size > 0) return;
      canvas.classList.remove("is-dragging");
      const wasDrag = state.dragMoved > 6;
      state.dragging = false;
      if (!wasDrag && dragButton === 0) {
        const id = pickAt(e.clientX, e.clientY);
        if (id) {
          selectNode(id);
        } else if (state.selected) {
          state.selected = null;
          updateUI(true);
        }
      }
    };

    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);
    canvas.addEventListener("pointerleave", () => {
      if (!state.dragging) state.hover = null;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      hideCanvasHint();
      cancelAuto();
      const factor = Math.exp(e.deltaY * 0.0011);
      state.camGoal.dist = clamp(state.camGoal.dist * factor, 16, 74);
    }, { passive: false });
    canvas.addEventListener("dblclick", () => setCamera("overview"));
  }

  /* ============================================================
     Page interactions
     ============================================================ */

  function scrollToSim() {
    const sim = $("#simulator");
    if (sim) sim.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  }

  function togglePause() {
    state.paused = !state.paused;
    updatePauseButton();
    toast(state.paused ? "Simulation paused. Camera still moves." : "Simulation resumed.", "");
  }

  function setupLayerTabs() {
    const tabs = $$(".layer-stack .layer-item");
    const panels = $$(".layer-panel");
    if (!tabs.length) return;
    const activate = (n, focus) => {
      tabs.forEach((tab, i) => {
        const on = i === n;
        tab.classList.toggle("is-active", on);
        tab.setAttribute("aria-selected", String(on));
        tab.tabIndex = on ? 0 : -1;
        if (on && focus) tab.focus();
      });
      panels.forEach((panel, i) => {
        const on = i === n;
        panel.hidden = !on;
        panel.classList.toggle("is-active", on);
      });
    };
    tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => activate(i, false));
      tab.addEventListener("keydown", (e) => {
        let next = i;
        if (e.key === "ArrowDown" || e.key === "ArrowRight") next = (i + 1) % tabs.length;
        else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = tabs.length - 1;
        else return;
        e.preventDefault();
        activate(next, true);
      });
    });
  }

  function setupNav() {
    const header = $("#site-header");
    const menuToggle = $("#menu-toggle");
    const mobile = $("#mobile-nav");
    const navLinks = $$(".primary-nav a, .mobile-nav a");
    const sections = $$("main section[id]");

    const closeMenu = () => {
      if (!menuToggle || !mobile) return;
      menuToggle.setAttribute("aria-expanded", "false");
      menuToggle.setAttribute("aria-label", "Open menu");
      mobile.classList.remove("is-open");
    };

    if (menuToggle && mobile) {
      menuToggle.addEventListener("click", () => {
        const open = menuToggle.getAttribute("aria-expanded") !== "true";
        menuToggle.setAttribute("aria-expanded", String(open));
        menuToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
        mobile.classList.toggle("is-open", open);
      });
      $$("#mobile-nav a").forEach((a) => a.addEventListener("click", closeMenu));
    }

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (header) header.classList.toggle("is-scrolled", window.scrollY > 10);
        const y = window.scrollY + 150;
        let current = "";
        for (const section of sections) {
          if (section.offsetTop <= y) current = "#" + section.id;
        }
        navLinks.forEach((a) => {
          a.classList.toggle("is-current", a.getAttribute("href") === current);
        });
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMenu();
    });
  }

  function setupReveal() {
    document.documentElement.classList.add("js-anim");
    const nodes = $$(".reveal");
    if (!nodes.length) return;
    if (!("IntersectionObserver" in window) || reducedMotion) {
      nodes.forEach((n) => n.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -34px 0px" }
    );
    nodes.forEach((node) => {
      const siblings = Array.from(node.parentElement.children).filter((c) => c.classList.contains("reveal"));
      const index = siblings.indexOf(node);
      node.style.setProperty("--reveal-delay", Math.min(index, 5) * 55 + "ms");
      io.observe(node);
    });
  }

  function setupCounters() {
    const nodes = $$("[data-count]");
    if (!nodes.length || reducedMotion) return;
    nodes.forEach((node) => {
      const target = parseInt(node.dataset.count, 10) || 0;
      node.textContent = "0";
      let started = null;
      const step = (ts) => {
        if (started === null) started = ts;
        const p = clamp((ts - started) / 1100, 0, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        node.textContent = String(Math.round(target * eased));
        if (p < 1) requestAnimationFrame(step);
        else node.textContent = String(target);
      };
      setTimeout(() => requestAnimationFrame(step), 420);
    });
  }

  function bindUI() {
    if (el.simPause) el.simPause.addEventListener("click", togglePause);
    if (el.simReset) el.simReset.addEventListener("click", () => resetSim());
    if (el.runSeed) el.runSeed.addEventListener("click", rerollSeed);
    if (el.runClear) el.runClear.addEventListener("click", clearScenario);
    if (el.runCopy) el.runCopy.addEventListener("click", copyRunLink);
    if (el.runExport) el.runExport.addEventListener("click", exportRunJSON);
    if (el.runCsv) el.runCsv.addEventListener("click", exportRunCSV);
    if (el.runDrill) el.runDrill.addEventListener("click", runDrill);
    updatePauseButton();
    updateSpeedButtons();

    $$("[data-speed]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.speed = Number(btn.dataset.speed) || 1;
        updateSpeedButtons();
      });
    });

    $$("[data-view]").forEach((btn) => {
      btn.addEventListener("click", () => setView(btn.dataset.view));
    });

    $$("[data-camera]").forEach((btn) => {
      btn.addEventListener("click", () => setCamera(btn.dataset.camera));
    });

    $$("[data-scenario]").forEach((btn) => {
      btn.addEventListener("click", () => runScenario(btn.dataset.scenario));
    });

    $$(".layer-toggle input[data-layer]").forEach((input) => {
      input.addEventListener("change", () => {
        state.layers[input.dataset.layer] = input.checked;
      });
    });

    $$("[data-print]").forEach((btn) => {
      btn.addEventListener("click", () => window.print());
    });

    const inspectCoordinator = (card, id) => {
      if (!card) return;
      card.addEventListener("click", () => selectNode(id));
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " " || e.code === "Space") {
          e.preventDefault();
          selectNode(id);
        }
      });
    };
    inspectCoordinator(el.mainCoord, "MAIN");
    inspectCoordinator(el.backupCoord, "BKUP");

    document.addEventListener("click", (e) => {
      const actionBtn = e.target.closest("[data-action]");
      if (actionBtn) {
        const action = actionBtn.dataset.action;
        runAction(action);
        if (!actionBtn.closest("#ops")) scrollToSim();
        return;
      }
      const commandBtn = e.target.closest("[data-open-command]");
      if (commandBtn) {
        setView("command", true);
        scrollToSim();
        toast("Command center opened. Try cutting a link or failing the Main AI.", "");
      }
    });

    document.addEventListener("keydown", (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable) return;
      // Let focused buttons and links handle Space themselves.
      if (e.code === "Space" && e.target.closest && e.target.closest("button, a, [role='button']")) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePause();
      } else if (e.key === "r" || e.key === "R") {
        resetSim();
      } else if (e.key === "1" || e.key === "2" || e.key === "3" || e.key === "4") {
        const names = ["overview", "top", "front", "orbit"];
        setCamera(names[Number(e.key) - 1]);
      } else if (e.key === "Escape") {
        if (state.selected) {
          state.selected = null;
          updateUI(true);
        }
      }
    });

    bindCanvasInput();
    setupLayerTabs();
    setupNav();
    setupReveal();
    setupCounters();
  }

  /* ============================================================
     Render loop & boot
     ============================================================ */

  function render(t) {
    if (!state.ctx) return;
    if (!state.W || !state.H) resizeCanvas();
    if (state.W < 20 || state.H < 20) return;
    const ctx = state.ctx;
    ctx.setTransform(state.DPR, 0, 0, state.DPR, 0, 0);
    ctx.clearRect(0, 0, state.W, state.H);
    if (state.view === "topology") renderTopology(t);
    else if (threeAvailable()) renderCommand3D(t);
    else renderCommand(t);
  }

  let lastFrame = performance.now();

  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    if (!state.paused) updateSim(dt * state.speed);
    updateCamera(dt);
    render(now / 1000);
    requestAnimationFrame(frame);
  }

  function boot() {
    readRunURL();
    setSeed(state.seed);
    makeStars();
    makeDrones();
    makeFeatures();
    setupCanvas();
    buildFleet();
    buildEnvControls();
    bindUI();
    initLogs();
    computeNetwork();
    updateMapFeatures(0);
    if (state.scenario) applyScenarioFaults(state.scenario);
    setCamera("overview");
    updatePauseButton();
    updateSpeedButtons();
    updateUI(true);
    updateRunMeta();
    syncURL();
    logEvent(
      "Shared map online · " + currentMap().label + " — " +
        state.features.length + " monitored features · " + currentSituation().label,
      "ok"
    );
    if (state.scenario) {
      logEvent("Run loaded from link · seed " + state.seed + " · " + SCENARIOS[state.scenario].label, "ok");
      toast(SCENARIOS[state.scenario].toast, "warn");
    }
    requestAnimationFrame(frame);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

