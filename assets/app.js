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

  /* Shared visual identity for every structure type. Numeric colours are
     used by the WebGL renderer; the *2 strings are the 2D fallback. */
  const BUILDING_STYLES = {
    cabin: {
      wall: 0x715a43, roof: 0x3b2f2a, win: 0xffc56b, trim: 0xc0a684,
      wall2: "rgba(113,90,67,0.92)", roof2: "rgba(59,47,42,0.96)", win2: "rgba(255,197,107,0.95)"
    },
    house: {
      wall: 0x8899a8, roof: 0x43596b, win: 0x8ce8ff, trim: 0xd0e2ec,
      wall2: "rgba(136,153,168,0.92)", roof2: "rgba(67,89,107,0.96)", win2: "rgba(140,232,255,0.95)"
    },
    plant: {
      wall: 0x52616e, roof: 0x36424c, win: 0x67e8f9, trim: 0x9fb8c8,
      wall2: "rgba(82,97,110,0.94)", roof2: "rgba(54,66,76,0.97)", win2: "rgba(103,232,249,0.95)"
    },
    tower: {
      wall: 0x2f4a5c, roof: 0x3e6479, win: 0x67e8f9, trim: 0x9fe8ff,
      wall2: "rgba(47,74,92,0.96)", roof2: "rgba(62,100,121,0.97)", win2: "rgba(103,232,249,0.95)"
    },
    tank: {
      wall: 0x5b6b74, roof: 0x8799a4, win: 0x9fe8ff, trim: 0xb9cbd6,
      wall2: "rgba(91,107,116,0.94)", roof2: "rgba(135,153,164,0.96)", win2: "rgba(159,232,255,0.85)"
    },
    bridge: {
      wall: 0x5d7180, roof: 0x405565, win: 0x9fe8ff, trim: 0xb9d4e4,
      wall2: "rgba(93,113,128,0.94)", roof2: "rgba(64,85,101,0.96)", win2: "rgba(159,232,255,0.85)"
    }
  };
  const styleFor = (type) => BUILDING_STYLES[type] || BUILDING_STYLES.house;

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

  // Fixed ground command posts: MAIN at the map start, BKUP at the far end.
  // y is refreshed from the terrain height whenever a map is rebuilt.
  const MAIN_POS = { x: -15, y: 0.4, z: 15 };
  const BKUP_POS = { x: 15, y: 0.4, z: -15 };
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
    },
    blackout: {
      id: "blackout",
      label: "Comms blackout",
      toast: "Scenario: interference, storm partition and a lost drone. Watch the telemetry dip."
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
    },
    wind: {
      id: "wind",
      label: "Wind",
      hint: "Crosswind pushes fire and smoke downwind. Hazards drift east.",
      sensor: 0.9,
      liveFor: 7,
      staleFor: 15,
      sync: 0.9,
      spread: 0.03,
      wind: { x: 0.55, z: 0.25 }
    },
    rain: {
      id: "rain",
      label: "Rain",
      hint: "Rain cuts visibility and swells flood water.",
      sensor: 0.8,
      liveFor: 7,
      staleFor: 16,
      sync: 0.75,
      spread: 0.04,
      rain: true,
      fog: true
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
      if (Math.hypot(x - MAIN_POS.x, z - MAIN_POS.z) < 3.4 ||
          Math.hypot(x - BKUP_POS.x, z - BKUP_POS.z) < 3.4) continue;
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
      if (Math.hypot(x - MAIN_POS.x, z - MAIN_POS.z) < 3.0 ||
          Math.hypot(x - BKUP_POS.x, z - BKUP_POS.z) < 3.0) continue;
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
    // command posts sit on the ground, with link endpoints just above the pad
    MAIN_POS.y = heightAt(MAIN_POS.x, MAIN_POS.z) + 0.45;
    BKUP_POS.y = heightAt(BKUP_POS.x, BKUP_POS.z) + 0.45;
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
    history: [],
    historyAcc: 0,
    historyPackets: 0,
    focus: false,
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
      if (sit.wind && (f.type === "smoke" || f.type === "fire" || f.type === "hotspot")) {
        // Crosswind advects airborne hazards downwind (capped so the
        // feature stays inside the map and home stays recoverable).
        const k = Math.min(3, state.time * 0.05);
        f.x = f.homeX + sit.wind.x * k;
        f.z = f.homeZ + sit.wind.z * k;
      } else if (sit.drift && (f.type === "survivor" || f.type === "vehicle")) {
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
    simStep: $("#sim-step"),
    simReset: $("#sim-reset"),
    simFocus: $("#sim-focus"),
    metricsChart: $("#metrics-chart"),
    runSnapshot: $("#run-snapshot"),
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
    camCompass: $("#cam-compass"),
    compassYaw: $("#compass-yaw"),
    compassPitch: $("#compass-pitch"),
    compassNeedle: $("#compass-needle"),
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
    if (hasCoordLink) chipsHtml += chip("command link", "route");
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
    } else if (name === "blackout") {
      computeNetwork();
      toggleInterference();
      toggleStorm();
      severLink();
      failDrone("D05", true);
      setView("command", true);
      logEvent("Scenario · comms blackout — interference, partition and D05 lost", "bad");
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
    state.history = [];
    state.historyAcc = 0;
    state.historyPackets = 0;
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
    drawTelemetryChart();
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
        (s === "drone" && state.failedDrones.length > 0) ||
        (s === "blackout" && state.interference && state.storm);
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
    drawTelemetryChart();
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
      version: "2.0.0",
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
      telemetry: {
        intervalSeconds: 0.5,
        samples: state.history.map((s) => ({
          atSeconds: Math.round(s.t * 10) / 10,
          connected: s.connected,
          buffered: s.buffered,
          packetsPerSecond: s.packetRate,
          localGroups: s.groups
        }))
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

  /* ---------------- PNG snapshot & view controls ---------------- */

  function downloadBlob(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportSnapshot() {
    const use3d = state.view === "command" && threeAvailable();
    const base = use3d ? state.canvas3d : state.canvas;
    if (!base || !base.width || !base.height) return;
    try {
      // Draw first so paused or throttled canvases are captured in sync.
      render(performance.now() / 1000);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const header = Math.round(72 * dpr);
      const out = document.createElement("canvas");
      out.width = base.width;
      out.height = base.height + header;
      const ctx = out.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#050b13";
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(base, 0, header, base.width, base.height);
      // In 3D mode the HUD is a transparent 2D canvas layered on top.
      if (use3d && state.canvas && state.canvas !== base) {
        ctx.drawImage(state.canvas, 0, header, state.canvas.width, state.canvas.height);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = base.width / dpr;
      ctx.fillStyle = "#22d3ee";
      ctx.font = "700 14px 'Space Grotesk', sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("NEXUS AI", 18, 28);
      ctx.fillStyle = "#7c98ac";
      ctx.font = "500 11px 'JetBrains Mono', monospace";
      ctx.fillText("LIVE OPS · " + currentMap().label.toUpperCase(), 18, 48);
      ctx.textAlign = "right";
      ctx.fillStyle = "#e8f3fa";
      ctx.fillText("seed " + state.seed + " · " + fmtClock(state.time), w - 18, 28);
      ctx.fillStyle = "#7c98ac";
      ctx.fillText(scenarioLabel() + " · " + opsState().label, w - 18, 48);
      ctx.strokeStyle = "rgba(34, 211, 238, 0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, header - 0.5);
      ctx.lineTo(w, header - 0.5);
      ctx.stroke();
      out.toBlob((blob) => {
        if (!blob) return;
        downloadBlob(runFileName("png"), blob);
        toast("Snapshot saved as PNG — " + fmtClock(state.time) + ".", "ok");
      }, "image/png");
    } catch (e) {
      toast("Snapshot could not be created in this browser.", "warn");
    }
  }

  function stepSimulation() {
    if (!state.paused) {
      state.paused = true;
      updatePauseButton();
    }
    updateSim(1 / 30);
    render(performance.now() / 1000);
    updateUI(true);
  }

  function toggleFocus() {
    state.focus = !state.focus;
    document.body.classList.toggle("focus-mode", state.focus);
    if (el.simFocus) {
      el.simFocus.setAttribute("aria-pressed", String(state.focus));
      const label = el.simFocus.querySelector("span");
      if (label) label.textContent = state.focus ? "Exit focus" : "Focus";
      el.simFocus.title = state.focus ? "Exit focus mode (F)" : "Focus mode — hide the proposal and expand the simulator (F)";
    }
    if (state.focus) scrollToSim();
    const reflow = () => {
      resizeCanvas();
      resizeThree();
      drawTelemetryChart();
    };
    requestAnimationFrame(reflow);
    setTimeout(reflow, 320);
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

    sampleTelemetry(dt);

    state.uiClock += dt;
    if (state.uiClock >= 0.16) {
      state.uiClock = 0;
      updateUI(false);
    }
  }

  /* ---------------- telemetry history ----------------
     A small ring buffer powers the sparkline panel. It records one
     sample every 0.5 simulated seconds and keeps the last 120 samples
     (60 simulated seconds at 1x), independent of frame rate. */
  function sampleTelemetry(dt) {
    state.historyAcc += dt;
    if (state.historyAcc < 0.5) return;
    const elapsed = state.historyAcc;
    state.historyAcc = 0;
    const sent = state.stats.packets - state.historyPackets;
    state.historyPackets = state.stats.packets;
    state.history.push({
      t: state.time,
      connected: state.connectedCount,
      buffered: Math.round(state.buffered),
      packetRate: Math.round((sent / elapsed) * 10) / 10,
      groups: state.groups.length
    });
    if (state.history.length > 120) state.history.shift();
  }

  function drawTelemetryChart() {
    const canvas = el.metricsChart;
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pad = { l: 4, r: 4, t: 8, b: 12 };
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;
    ctx.strokeStyle = "rgba(120, 190, 220, 0.12)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = Math.round(pad.t + (ih / 3) * i) + 0.5;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + iw, y);
      ctx.stroke();
    }

    const samples = state.history;
    if (samples.length < 2) {
      ctx.fillStyle = C.faint;
      ctx.font = "500 10px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText("collecting telemetry…", w / 2, h / 2 + 3);
      return;
    }

    const maxBuffered = Math.max(12, ...samples.map((s) => s.buffered));
    const maxRate = Math.max(4, ...samples.map((s) => s.packetRate));
    const series = [
      { key: "connected", color: C.cyan, max: CFG.count },
      { key: "buffered", color: C.amber, max: maxBuffered },
      { key: "packetRate", color: C.violet, max: maxRate }
    ];
    const xAt = (i) => pad.l + (i / (samples.length - 1)) * iw;

    for (const s of series) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      samples.forEach((sample, i) => {
        const v = clamp(sample[s.key] / s.max, 0, 1);
        const x = xAt(i);
        const y = pad.t + ih - v * ih;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      const last = samples[samples.length - 1][s.key];
      const ly = pad.t + ih - clamp(last / s.max, 0, 1) * ih;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(pad.l + iw, ly, 2.3, 0, TAU);
      ctx.fill();
    }

    ctx.fillStyle = C.faint;
    ctx.font = "500 9px 'JetBrains Mono', monospace";
    ctx.textAlign = "left";
    ctx.fillText("−60s", pad.l, h - 2);
    ctx.textAlign = "right";
    ctx.fillText("now", pad.l + iw, h - 2);
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
    if (el.camCompass) el.camCompass.style.display = state.view === "command" ? "inline-flex" : "none";
  }

  function updateCompass() {
    if (!el.camCompass || state.view !== "command") return;
    const cam = state.camera;
    const yawDeg = Math.round((((cam.yaw * 180) / Math.PI) % 360 + 360) % 360);
    const cardinals = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const cardinal = cardinals[Math.round(yawDeg / 45) % 8];
    const pitchDeg = Math.round((cam.pitch * 180) / Math.PI);
    // Cache the formatted string to avoid DOM churn every frame.
    const label = yawDeg + "° " + cardinal;
    const pitchLabel = "PITCH " + pitchDeg + "° · DIST " + Math.round(cam.dist);
    if (el.compassYaw && el.compassYaw.textContent !== label) el.compassYaw.textContent = label;
    if (el.compassPitch && el.compassPitch.textContent !== pitchLabel) el.compassPitch.textContent = pitchLabel;
    if (el.compassNeedle) el.compassNeedle.style.transform = "rotate(" + yawDeg + "deg)";
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
    const T = state.three;
    const shared = new Set();
    if (T && T.glowTex) shared.add(T.glowTex);
    if (T && T.skyTex) shared.add(T.skyTex);
    if (T && T.sunGlow) shared.add(T.sunGlow);
    if (T && T.envCube) shared.add(T.envCube);
    if (T && T.tex) for (const t of Object.values(T.tex)) shared.add(t);
    group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (m.map && !shared.has(m.map)) m.map.dispose();
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

  function makeSkyTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "#01040c");
    g.addColorStop(0.42, "#071a2b");
    g.addColorStop(0.72, "#123c50");
    g.addColorStop(0.9, "#0a2230");
    g.addColorStop(1, "#050b13");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 16, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }

  /* ---------------- procedural surface textures ----------------
     Everything is generated into canvases at startup: no image requests,
     no external assets. Colour maps are tagged sRGB; data maps are not. */

  function hashNoise(x, y, seed) {
    const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
    return n - Math.floor(n);
  }

  function valueNoise(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(
      lerp(hashNoise(xi, yi, seed), hashNoise(xi + 1, yi, seed), u),
      lerp(hashNoise(xi, yi + 1, seed), hashNoise(xi + 1, yi + 1, seed), u),
      v
    );
  }

  function tileNoise(x, y, seed, period) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const wrap = (n) => ((n % period) + period) % period;
    return lerp(
      lerp(hashNoise(wrap(xi), wrap(yi), seed), hashNoise(wrap(xi + 1), wrap(yi), seed), u),
      lerp(hashNoise(wrap(xi), wrap(yi + 1), seed), hashNoise(wrap(xi + 1), wrap(yi + 1), seed), u),
      v
    );
  }

  function fbm(x, y, seed, octaves) {
    let sum = 0, amp = 0.5, f = 1, total = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * valueNoise(x * f, y * f, seed + o * 17);
      total += amp; f *= 2; amp *= 0.5;
    }
    return sum / total;
  }

  function fbmTile(x, y, seed, octaves, period) {
    let sum = 0, amp = 0.5, f = 1, total = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * tileNoise(x * f, y * f, seed + o * 17, period * f);
      total += amp; f *= 2; amp *= 0.5;
    }
    return sum / total;
  }

  function canvasTexture(size, draw, repeat, srgb) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    draw(c.getContext("2d"), size);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (repeat) t.repeat.set(repeat, repeat);
    if (srgb && THREE.sRGBEncoding !== undefined) t.encoding = THREE.sRGBEncoding;
    return t;
  }

  function putGrayscale(img, x, y, S, v, mul) {
    const i = (y * S + x) * 4;
    img.data[i] = clamp(v * (mul ? mul[0] : 1), 0, 255);
    img.data[i + 1] = clamp(v * (mul ? mul[1] : 1), 0, 255);
    img.data[i + 2] = clamp(v * (mul ? mul[2] : 1), 0, 255);
    img.data[i + 3] = 255;
  }

  function makeGroundDetailTexture() {
    return canvasTexture(256, (ctx, S) => {
      const img = ctx.createImageData(S, S);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const n = fbmTile(x / S * 8, y / S * 8, 3, 4, 8);
        const grit = hashNoise(x, y, 19) > 0.94 ? -26 : 0;
        putGrayscale(img, x, y, S, 198 + n * 56 + grit);
      }
      ctx.putImageData(img, 0, 0);
    }, 12, true);
  }

  function makeGroundNormalTexture() {
    return canvasTexture(256, (ctx, S) => {
      const img = ctx.createImageData(S, S);
      const h = (x, y) => fbmTile(x / S * 8, y / S * 8, 7, 4, 8);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const dx = h((x + 1) % S, y) - h((x - 1 + S) % S, y);
        const dy = h(x, (y + 1) % S) - h(x, (y - 1 + S) % S);
        let nx = -dx * 3.2, ny = -dy * 3.2, nz = 1;
        const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
        const i = (y * S + x) * 4;
        img.data[i] = (nx * 0.5 + 0.5) * 255;
        img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
        img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }, 12, false);
  }

  function makeWaterNormalTexture() {
    return canvasTexture(256, (ctx, S) => {
      const img = ctx.createImageData(S, S);
      const h = (x, y) => {
        const u = x / S * TAU, v = y / S * TAU;
        return Math.sin(u * 3 + Math.cos(v * 2)) * 0.34 +
          Math.sin(v * 5 - u * 2) * 0.22 +
          fbmTile(x / S * 6, y / S * 6, 23, 3, 6) * 0.44;
      };
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const dx = h((x + 1) % S, y) - h((x - 1 + S) % S, y);
        const dy = h(x, (y + 1) % S) - h(x, (y - 1 + S) % S);
        let nx = -dx * 2.6, ny = -dy * 2.6, nz = 1;
        const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
        const i = (y * S + x) * 4;
        img.data[i] = (nx * 0.5 + 0.5) * 255;
        img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
        img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }, 4, false);
  }

  function makeBarkTexture() {
    return canvasTexture(128, (ctx, S) => {
      const img = ctx.createImageData(S, S);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const n = fbm(x / S * 22, y / S * 6, 41, 4);
        const crack = hashNoise(Math.floor(x * 1.7), Math.floor(y / 6), 9) > 0.76 ? -48 : 0;
        putGrayscale(img, x, y, S, 104 + n * 78 + crack, [1.06, 0.8, 0.58]);
      }
      ctx.putImageData(img, 0, 0);
    }, 1, true);
  }

  function makeConiferTexture() {
    return canvasTexture(256, (ctx, S) => {
      const rng = mulberry32(9137);
      const cx = S / 2;
      ctx.fillStyle = "rgba(58,44,32,0.96)";
      ctx.fillRect(cx - 5, 196, 10, 56);
      for (let i = 0; i < 4600; i++) {
        const t = rng();
        const y = 12 + t * 190;
        const w = (0.05 + t * 0.95) * (S * 0.43);
        const x = cx + (rng() * 2 - 1) * w;
        const shade = 0.32 + 0.5 * (1 - t) + rng() * 0.3;
        const r = Math.round(20 + shade * 48);
        const g = Math.round(44 + shade * 82);
        const b = Math.round(22 + shade * 38);
        ctx.strokeStyle = `rgba(${r},${g},${b},${0.5 + rng() * 0.4})`;
        ctx.lineWidth = 0.7 + rng() * 1.1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (x - cx) * 0.1 + (rng() - 0.5) * 5, y - 3 - rng() * 6);
        ctx.stroke();
      }
    }, 1, true);
  }

  function makeBroadleafTexture() {
    return canvasTexture(256, (ctx, S) => {
      const rng = mulberry32(4421);
      ctx.fillStyle = "rgba(64,50,36,0.96)";
      ctx.fillRect(S / 2 - 5, 168, 10, 84);
      for (let i = 0; i < 280; i++) {
        const a = rng() * TAU, rad = Math.sqrt(rng()) * 90;
        const x = S / 2 + Math.cos(a) * rad;
        const y = 116 + Math.sin(a) * rad * 0.86;
        const rr = 8 + rng() * 17;
        const shade = rng();
        const g = ctx.createRadialGradient(x - rr * 0.3, y - rr * 0.3, 1, x, y, rr);
        g.addColorStop(0, `rgba(${Math.round(92 + shade * 70)},${Math.round(132 + shade * 78)},${Math.round(50 + shade * 42)},0.96)`);
        g.addColorStop(1, `rgba(${Math.round(26 + shade * 30)},${Math.round(60 + shade * 42)},${Math.round(22 + shade * 22)},0.96)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.fill();
      }
    }, 1, true);
  }

  function makeGrassTexture() {
    return canvasTexture(128, (ctx, S) => {
      const rng = mulberry32(771);
      for (let i = 0; i < 200; i++) {
        const x = rng() * S, h = 16 + rng() * 44, shade = rng();
        ctx.strokeStyle = `rgba(${Math.round(38 + shade * 62)},${Math.round(82 + shade * 82)},${Math.round(30 + shade * 38)},0.9)`;
        ctx.lineWidth = 0.8 + rng() * 1.5;
        ctx.beginPath();
        ctx.moveTo(x, S);
        ctx.quadraticCurveTo(x + (rng() - 0.5) * 12, S - h * 0.5, x + (rng() - 0.5) * 18, S - h);
        ctx.stroke();
      }
    }, 1, true);
  }

  function makeRotorTexture() {
    return canvasTexture(128, (ctx, S) => {
      const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.07, S / 2, S / 2, S * 0.5);
      g.addColorStop(0, "rgba(210,232,244,0)");
      g.addColorStop(0.35, "rgba(198,222,238,0.28)");
      g.addColorStop(0.72, "rgba(176,204,222,0.2)");
      g.addColorStop(1, "rgba(150,180,200,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
      ctx.strokeStyle = "rgba(226,242,252,0.13)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * TAU;
        ctx.beginPath();
        ctx.moveTo(S / 2 + Math.cos(a) * S * 0.12, S / 2 + Math.sin(a) * S * 0.12);
        ctx.lineTo(S / 2 + Math.cos(a) * S * 0.47, S / 2 + Math.sin(a) * S * 0.47);
        ctx.stroke();
      }
    }, 1, false);
  }

  function makeWallTexture(kind) {
    return canvasTexture(128, (ctx, S) => {
      const img = ctx.createImageData(S, S);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const n = fbm(x / S * 12, y / S * 12, 57 + kind.length, 4);
        let v, mul;
        if (kind === "wood") {
          const grain = Math.sin(y * 0.5 + fbm(x / S * 4, y / S * 4, 12, 2) * 8) * 11;
          v = 148 + n * 58 + grain; mul = [1.06, 0.8, 0.58];
        } else if (kind === "concrete") {
          v = 138 + n * 58; mul = [0.97, 1, 1.04];
        } else if (kind === "brick") {
          const row = Math.floor(y / 18), col = Math.floor((x + (row % 2) * 16) / 32);
          const brick = hashNoise(col, row, 71) * 26 - 13;
          v = 128 + n * 38 + brick; mul = [1.16, 0.72, 0.6];
        } else {
          v = 188 + n * 48; mul = [1, 0.99, 0.94];
        }
        putGrayscale(img, x, y, S, v, mul);
      }
      ctx.putImageData(img, 0, 0);
      if (kind === "brick") {
        ctx.strokeStyle = "rgba(72,68,64,0.4)";
        ctx.lineWidth = 2;
        for (let y = 0; y <= S; y += 18) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y); ctx.stroke();
          for (let x = ((y / 18) % 2) * 16; x <= S; x += 32) {
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 18); ctx.stroke();
          }
        }
      } else if (kind === "wood") {
        ctx.strokeStyle = "rgba(56,38,24,0.28)";
        ctx.lineWidth = 1;
        for (let x = 0; x <= S; x += 16) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, S); ctx.stroke();
        }
      }
    }, 1, true);
  }

  function makeRoofTexture(kind) {
    return canvasTexture(128, (ctx, S) => {
      if (kind === "metal") {
        for (let x = 0; x < S; x += 8) {
          const g = ctx.createLinearGradient(x, 0, x + 8, 0);
          g.addColorStop(0, "#6d7c86"); g.addColorStop(0.5, "#a8b8c2"); g.addColorStop(1, "#5d6b75");
          ctx.fillStyle = g; ctx.fillRect(x, 0, 8, S);
        }
      } else {
        ctx.fillStyle = "#3e4a55"; ctx.fillRect(0, 0, S, S);
        for (let row = 0; row < S; row += 14) {
          const off = ((row / 14) % 2) * 14;
          for (let x = -off; x < S; x += 28) {
            const v = 74 + hashNoise(x, row, 31) * 34;
            ctx.fillStyle = `rgb(${v},${v * 1.08},${v * 1.16})`;
            ctx.fillRect(x + 1, row + 1, 26, 12);
            ctx.strokeStyle = "rgba(0,0,0,0.3)";
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 1, row + 1, 26, 12);
          }
        }
      }
      const img = ctx.getImageData(0, 0, S, S);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (hashNoise(i, i >> 8, 5) - 0.5) * 16;
        img.data[i] = clamp(img.data[i] + n, 0, 255);
        img.data[i + 1] = clamp(img.data[i + 1] + n, 0, 255);
        img.data[i + 2] = clamp(img.data[i + 2] + n, 0, 255);
      }
      ctx.putImageData(img, 0, 0);
    }, 1, true);
  }

  function makeAsphaltTexture() {
    return canvasTexture(128, (ctx, S) => {
      const img = ctx.createImageData(S, S);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const n = fbm(x / S * 14, y / S * 14, 83, 4);
        const speck = hashNoise(x, y, 27) > 0.9 ? 26 : 0;
        putGrayscale(img, x, y, S, 48 + n * 42 + speck, [0.94, 0.99, 1.05]);
      }
      ctx.putImageData(img, 0, 0);
    }, 1, true);
  }

  function makeEnvCube() {
    const faces = [];
    for (let i = 0; i < 6; i++) {
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const ctx = c.getContext("2d");
      const g = ctx.createLinearGradient(0, 0, 0, 64);
      if (i === 2) {
        g.addColorStop(0, "#c4e0f2"); g.addColorStop(1, "#9cc2d8");
      } else if (i === 3) {
        g.addColorStop(0, "#34423a"); g.addColorStop(1, "#1e2a24");
      } else {
        g.addColorStop(0, "#adcbe0"); g.addColorStop(0.48, "#779bb2"); g.addColorStop(1, "#2f3e36");
      }
      ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
      faces.push(c);
    }
    const t = new THREE.CubeTexture(faces);
    t.needsUpdate = true;
    if (THREE.sRGBEncoding !== undefined) t.encoding = THREE.sRGBEncoding;
    return t;
  }

  function makeRain() {
    const COUNT = 700;
    const pos = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = (Math.random() * 2 - 1) * 30;
      pos[i * 3 + 1] = Math.random() * 26;
      pos[i * 3 + 2] = (Math.random() * 2 - 1) * 30;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x9fd8f0, size: 0.075, transparent: true, opacity: 0.5,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.visible = false;
    return { pts, pos };
  }

  function initThree() {
    state.three = { ready: false, mapId: "" };
    const canvas = state.canvas3d;
    if (!canvas || typeof THREE === "undefined") return;
    try {
      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        powerPreference: "high-performance",
        // Required so PNG snapshots can read the WebGL drawing buffer.
        preserveDrawingBuffer: true
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      if (THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
      if (THREE.ACESFilmicToneMapping !== undefined) {
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
      }
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x050b13);
      scene.fog = new THREE.FogExp2(0x0a1a26, 0.0075);
      const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
      const ambient = new THREE.AmbientLight(0x8ab4d8, 0.26);
      const hemi = new THREE.HemisphereLight(0xbcdcf5, 0x26332c, 0.62);
      const sun = new THREE.DirectionalLight(0xffedcf, 1.32);
      sun.position.set(34, 52, 24);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1536, 1536);
      sun.shadow.camera.left = -22;
      sun.shadow.camera.right = 22;
      sun.shadow.camera.top = 22;
      sun.shadow.camera.bottom = -22;
      sun.shadow.camera.near = 1;
      sun.shadow.camera.far = 130;
      sun.shadow.bias = -0.0007;
      sun.shadow.normalBias = 0.02;
      const fill = new THREE.DirectionalLight(0x6fa8cc, 0.32);
      fill.position.set(-30, 20, -26);
      scene.add(ambient, hemi, sun, fill);
      const tex = {
        ground: makeGroundDetailTexture(),
        groundNormal: makeGroundNormalTexture(),
        waterNormal: makeWaterNormalTexture(),
        bark: makeBarkTexture(),
        conifer: makeConiferTexture(),
        broadleaf: makeBroadleafTexture(),
        grass: makeGrassTexture(),
        rotor: makeRotorTexture(),
        wood: makeWallTexture("wood"),
        brick: makeWallTexture("brick"),
        concrete: makeWallTexture("concrete"),
        stucco: makeWallTexture("stucco"),
        shingle: makeRoofTexture("shingle"),
        metal: makeRoofTexture("metal"),
        asphalt: makeAsphaltTexture()
      };
      const envCube = makeEnvCube();
      const skyTex = makeSkyTexture();
      const sky = new THREE.Mesh(
        new THREE.SphereGeometry(170, 32, 20),
        new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false })
      );
      scene.add(sky);
      const sunGlow = makeGlowTexture();
      const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: sunGlow, color: 0xffd9a0, transparent: true, opacity: 0.72,
        depthWrite: false, fog: false, blending: THREE.AdditiveBlending
      }));
      sunSprite.scale.set(20, 20, 1);
      sunSprite.position.set(95, 62, -95);
      scene.add(sunSprite);
      const rain = makeRain();
      scene.add(rain.pts);
      const env = new THREE.Group();
      scene.add(env);
      const T = { ready: true, renderer, scene, camera, ambient, hemi, sun, fill, tex, envCube, sky, rain, skyTex, sunGlow, sunSprite, env };
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
    // --- terrain: textured hillfield with surface detail and a solid skirt ---
    const SEG = 120;
    const tGeo = new THREE.PlaneGeometry(39, 39, SEG, SEG);
    tGeo.rotateX(-Math.PI / 2);
    const tPos = tGeo.attributes.position;
    const tCol = new Float32Array(tPos.count * 3);
    const tColor = new THREE.Color();
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
      const k = 0.58 + 0.62 * diff;
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
    const terrainMesh = new THREE.Mesh(tGeo, new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: T.tex.ground,
      normalMap: T.tex.groundNormal,
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughness: 0.96,
      metalness: 0
    }));
    terrainMesh.receiveShadow = true;
    env.add(terrainMesh);
    const skirt = new THREE.Mesh(
      new THREE.BoxGeometry(39.2, 1.8, 39.2),
      new THREE.MeshStandardMaterial({ map: T.tex.concrete, color: 0x2b3840, roughness: 0.95 })
    );
    skirt.position.y = -0.92;
    env.add(skirt);
    // --- water: reflective surface with animated ripple normals ---
    const waterGeo = new THREE.PlaneGeometry(39, 39, 56, 56);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshPhongMaterial({
      color: new THREE.Color(terr.water[0], terr.water[1], terr.water[2]),
      specular: 0xf2fbff, shininess: 130,
      normalMap: T.tex.waterNormal,
      normalScale: new THREE.Vector2(0.55, 0.55),
      envMap: T.envCube, reflectivity: 0.55,
      transparent: true, opacity: 0.78, depthWrite: false, side: THREE.DoubleSide
    });
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.position.y = wl + 0.03;
    env.add(waterMesh);
    // --- vegetation: bark trunks, photographic-style foliage cards, ground cover ---
    const treeGroup = new THREE.Group();
    env.add(treeGroup);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eul = new THREE.Euler();
    const sv = new THREE.Vector3();
    const pv = new THREE.Vector3();
    const cc = new THREE.Color();
    if (cache.trees.length) {
      const nTrees = cache.trees.length;
      const conifers = [], broadleaf = [];
      cache.trees.forEach((tree, i) => (i % 5 === 0 ? broadleaf : conifers).push({ tree, i }));

      const trunkGeo = new THREE.CylinderGeometry(0.055, 0.105, 0.64, 7);
      trunkGeo.translate(0, 0.32, 0);
      const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({
        map: T.tex.bark, roughness: 1, metalness: 0
      }), nTrees);
      trunks.castShadow = true;
      const shadowGeo = new THREE.CircleGeometry(0.6, 12);
      shadowGeo.rotateX(-Math.PI / 2);
      const shadows = new THREE.InstancedMesh(shadowGeo, new THREE.MeshBasicMaterial({
        color: 0x0a0f0a, transparent: true, opacity: 0.22, depthWrite: false
      }), nTrees);
      cache.trees.forEach((tree, i) => {
        const h = heightAt(tree.x, tree.z);
        const seed = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
        const r = seed - Math.floor(seed);
        const s = tree.scale;
        pv.set(tree.x, h + 0.01, tree.z);
        eul.set((r - 0.5) * 0.035, r * TAU, Math.sin(i * 4.1) * 0.025);
        q.setFromEuler(eul);
        sv.set(s, s * (0.95 + r * 0.18), s);
        m4.compose(pv, q, sv);
        trunks.setMatrixAt(i, m4);
        cc.setHSL(0.08, 0.18, 0.78 + r * 0.14);
        trunks.setColorAt(i, cc);
        eul.set(0, r * TAU, 0); q.setFromEuler(eul);
        pv.set(tree.x, h + 0.012, tree.z);
        sv.set(s * 1.1, 1, s * 1.1);
        m4.compose(pv, q, sv);
        shadows.setMatrixAt(i, m4);
      });

      const makeFoliage = (list, size, texture) => {
        const plane = new THREE.PlaneGeometry(size[0], size[1]);
        plane.translate(0, size[1] / 2 * 0.96, 0);
        const mat = new THREE.MeshStandardMaterial({
          map: texture, alphaTest: 0.38, side: THREE.DoubleSide,
          transparent: false, depthWrite: true, roughness: 0.94, metalness: 0
        });
        const mesh = new THREE.InstancedMesh(plane, mat, list.length * 2);
        mesh.castShadow = true;
        let k = 0;
        for (const { tree, i } of list) {
          const h = heightAt(tree.x, tree.z);
          const seed = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
          const r = seed - Math.floor(seed);
          const s = tree.scale * (0.92 + (i % 4) * 0.05);
          for (let c = 0; c < 2; c++) {
            eul.set((r - 0.5) * 0.045, r * TAU + c * Math.PI / 2, Math.sin(i * 4.1) * 0.03);
            q.setFromEuler(eul);
            pv.set(tree.x, h + 0.01, tree.z);
            sv.set(s, s * (0.96 + (i % 3) * 0.05), s);
            m4.compose(pv, q, sv);
            mesh.setMatrixAt(k, m4);
            cc.setHSL(tree.hue, 0.12 + tree.sat * 0.08, 0.74 + r * 0.16);
            mesh.setColorAt(k, cc);
            k++;
          }
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        return mesh;
      };

      const foliage = [];
      if (conifers.length) foliage.push(makeFoliage(conifers, [1.55, 2.15], T.tex.conifer));
      if (broadleaf.length) foliage.push(makeFoliage(broadleaf, [1.75, 1.75], T.tex.broadleaf));
      for (const mesh of [shadows, trunks, ...foliage]) treeGroup.add(mesh);
    }
    // --- rocks: irregular stone with a rough mineral surface ---
    if (cache.rocks.length) {
      const rockGeo = new THREE.IcosahedronGeometry(0.32, 1);
      const rockMat = new THREE.MeshStandardMaterial({
        map: T.tex.concrete, normalMap: T.tex.groundNormal,
        normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.95, metalness: 0
      });
      const instR = new THREE.InstancedMesh(rockGeo, rockMat, cache.rocks.length);
      instR.castShadow = true;
      cache.rocks.forEach((rock, i) => {
        const seed = Math.sin(i * 31.7 + 11.3) * 43758.5453;
        const r = seed - Math.floor(seed);
        eul.set(r * 0.5, r * TAU, (1 - r) * 0.35);
        q.setFromEuler(eul);
        pv.set(rock.x, heightAt(rock.x, rock.z) + 0.09, rock.z);
        sv.set(rock.scale, rock.scale * (0.6 + r * 0.3), rock.scale);
        m4.compose(pv, q, sv);
        instR.setMatrixAt(i, m4);
        const g = 0.62 + rock.shade * 0.3;
        cc.setRGB(g, g * 0.99, g * 0.96);
        instR.setColorAt(i, cc);
      });
      instR.instanceMatrix.needsUpdate = true;
      if (instR.instanceColor) instR.instanceColor.needsUpdate = true;
      treeGroup.add(instR);
    }
    // --- ground cover: crossed grass tufts clustered around the treeline ---
    if (cache.trees.length) {
      const rngGrass = mulberry32(hashString("nexus-" + mapId + "-grass"));
      const count = Math.min(320, 120 + cache.trees.length * 2);
      const grassGeo = new THREE.PlaneGeometry(0.38, 0.52);
      grassGeo.translate(0, 0.25, 0);
      const grass = new THREE.InstancedMesh(grassGeo, new THREE.MeshStandardMaterial({
        map: T.tex.grass, alphaTest: 0.35, side: THREE.DoubleSide,
        transparent: false, depthWrite: true, roughness: 1
      }), count * 2);
      let k = 0;
      for (let i = 0; i < count; i++) {
        const anchor = cache.trees[Math.floor(rngGrass() * cache.trees.length)];
        const x = clamp(anchor.x + (rngGrass() * 2 - 1) * 2.1, -18.8, 18.8);
        const z = clamp(anchor.z + (rngGrass() * 2 - 1) * 2.1, -18.8, 18.8);
        const gy = heightAt(x, z);
        if (gy < wl + 0.08) continue;
        const r = rngGrass() * TAU;
        const s = 0.7 + rngGrass() * 0.75;
        for (let c = 0; c < 2; c++) {
          eul.set(0, r + c * Math.PI / 2, 0);
          q.setFromEuler(eul);
          pv.set(x, gy + 0.01, z);
          sv.set(s, s * (0.8 + rngGrass() * 0.5), s);
          m4.compose(pv, q, sv);
          grass.setMatrixAt(k, m4);
          cc.setHSL(0.25 + rngGrass() * 0.05, 0.16, 0.8 + rngGrass() * 0.16);
          grass.setColorAt(k, cc);
          k++;
        }
      }
      grass.count = k;
      grass.instanceMatrix.needsUpdate = true;
      if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
      treeGroup.add(grass);
    }
    // --- buildings: PBR surfaces with architectural detail, no wireframe look ---
    const bGroup = new THREE.Group();
    env.add(bGroup);
    const std = (opts) => new THREE.MeshStandardMaterial(opts);
    const walls = {
      cabin: std({ map: T.tex.wood, color: 0xb49370, roughness: 0.92 }),
      house: std({ map: T.tex.stucco, color: 0xcfd6d8, roughness: 0.9 }),
      plant: std({ map: T.tex.concrete, color: 0xa9b4bb, roughness: 0.88 }),
      tower: std({ map: T.tex.metal, color: 0x8fa6b3, roughness: 0.58, metalness: 0.3 }),
      tank: std({ map: T.tex.metal, color: 0xbcc8cf, roughness: 0.48, metalness: 0.42 }),
      bridge: std({ map: T.tex.concrete, color: 0xa4b0b7, roughness: 0.9 })
    };
    const roofMat = std({ map: T.tex.shingle, color: 0x9aa7b2, roughness: 0.84 });
    const metalMat = std({ map: T.tex.metal, color: 0xa6b7c2, roughness: 0.5, metalness: 0.4 });
    const brickMat = std({ map: T.tex.brick, color: 0xb9a49c, roughness: 0.9 });
    const concreteMat = std({ map: T.tex.concrete, color: 0x4a565e, roughness: 0.92 });
    const darkMat = std({ map: T.tex.concrete, color: 0x333e46, roughness: 0.9 });
    const glassMat = new THREE.MeshPhongMaterial({
      color: 0x8fc6dc, specular: 0xffffff, shininess: 140,
      envMap: T.envCube, reflectivity: 0.7,
      transparent: true, opacity: 0.62, depthWrite: false
    });
    const glowCache = new Map();
    const glowFor = (hex) => {
      if (!glowCache.has(hex)) glowCache.set(hex, std({
        color: hex, emissive: hex, emissiveIntensity: 1.6, roughness: 0.4
      }));
      return glowCache.get(hex);
    };
    const addPart = (parent, geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = !mat.transparent && !(mat.emissive && mat.emissiveIntensity > 0);
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const addWindow = (g, x, y, z, w, h, glow) => {
      addPart(g, new THREE.BoxGeometry(w + 0.09, h + 0.09, 0.05), darkMat, x, y, z - 0.015);
      addPart(g, new THREE.BoxGeometry(w, h, 0.03), glassMat, x, y, z + 0.02);
      if (glow) addPart(g, new THREE.BoxGeometry(w * 0.82, h * 0.72, 0.02), glowFor(glow), x, y, z + 0.045);
    };
    for (const b of cache.buildings) {
      const gh = heightAt(b.x, b.z);
      const p = styleFor(b.type);
      const g = new THREE.Group();
      g.position.set(b.x, gh, b.z);
      bGroup.add(g);
      addPart(g, new THREE.BoxGeometry(b.w + 0.34, 0.16, b.d + 0.34), concreteMat, 0, 0.08, 0);

      if (b.type === "tower") {
        addPart(g, new THREE.CylinderGeometry(0.44, 0.64, b.h, 12), walls.tower, 0, b.h / 2 + 0.15, 0);
        for (const yy of [b.h * 0.28, b.h * 0.62]) {
          const band = addPart(g, new THREE.TorusGeometry(0.55 - yy * 0.06, 0.035, 5, 16), metalMat, 0, yy + 0.15, 0);
          band.rotation.x = Math.PI / 2;
        }
        addPart(g, new THREE.CylinderGeometry(0.95, 0.95, 0.16, 12), metalMat, 0, b.h + 0.23, 0);
        addPart(g, new THREE.CylinderGeometry(0.82, 0.82, 0.34, 12, 1, true), glassMat, 0, b.h + 0.48, 0);
        const cap = addPart(g, new THREE.CylinderGeometry(0.92, 0.92, 0.07, 12), darkMat, 0, b.h + 0.69, 0);
        cap.castShadow = true;
        addPart(g, new THREE.CylinderGeometry(0.03, 0.06, 0.85, 6), metalMat, 0, b.h + 1.15, 0);
        addPart(g, new THREE.SphereGeometry(0.12, 10, 8), glowFor(p.win), 0, b.h + 1.62, 0);
        for (let k = 0; k < 3; k++) {
          addWindow(g, 0, b.h * (0.4 + k * 0.17), 0.52, 0.2, 0.11, p.win);
        }
      } else if (b.type === "tank") {
        const r = Math.min(b.w, b.d) / 2;
        addPart(g, new THREE.CylinderGeometry(r, r, b.h, 20), walls.tank, 0, b.h / 2 + 0.15, 0);
        addPart(g, new THREE.SphereGeometry(r, 20, 10, 0, TAU, 0, Math.PI / 2), metalMat, 0, b.h + 0.15, 0);
        for (const yy of [b.h * 0.32, b.h * 0.74]) {
          const band = addPart(g, new THREE.TorusGeometry(r + 0.012, 0.045, 5, 24), metalMat, 0, yy + 0.15, 0);
          band.rotation.x = Math.PI / 2;
        }
        for (let k = 0; k < 5; k++) {
          addPart(g, new THREE.BoxGeometry(0.04, 0.3, 0.04), metalMat, r * 0.72, 0.35 + k * 0.42, r * 0.72);
        }
        addPart(g, new THREE.CylinderGeometry(0.045, 0.045, b.h * 0.9, 6), metalMat, r * 0.72, b.h * 0.55, r * 0.72);
        addPart(g, new THREE.CylinderGeometry(0.08, 0.08, 0.12, 8), darkMat, 0, b.h + r + 0.2, 0);
      } else if (b.type === "bridge") {
        addPart(g, new THREE.BoxGeometry(b.w, 0.26, b.d), walls.bridge, 0, b.h + 0.15, 0);
        addPart(g, new THREE.BoxGeometry(b.w - 0.1, 0.03, b.d - 0.1), std({ map: T.tex.asphalt, roughness: 0.95 }), 0, b.h + 0.3, 0);
        for (const zz of [-b.d / 2 + 0.09, b.d / 2 - 0.09]) {
          addPart(g, new THREE.BoxGeometry(b.w, 0.2, 0.09), concreteMat, 0, b.h + 0.47, zz);
        }
        for (const xx of [-b.w / 2 + 0.3, b.w / 2 - 0.3]) {
          addPart(g, new THREE.BoxGeometry(0.34, b.h, 0.34), concreteMat, xx, b.h / 2, 0);
        }
      } else if (b.type === "plant") {
        addPart(g, new THREE.BoxGeometry(b.w, b.h, b.d), walls.plant, 0, b.h / 2 + 0.15, 0);
        addPart(g, new THREE.BoxGeometry(b.w + 0.2, 0.16, b.d + 0.2), metalMat, 0, b.h + 0.23, 0);
        for (let k = 0; k < 3; k++) {
          const vx = -b.w / 2 + 0.55 + k * (b.w - 1.1) / 2;
          addPart(g, new THREE.CylinderGeometry(0.17, 0.21, 0.36, 10), metalMat, vx, b.h + 0.49, -b.d / 4);
          addPart(g, new THREE.CylinderGeometry(0.21, 0.21, 0.05, 10), darkMat, vx, b.h + 0.69, -b.d / 4);
        }
        addWindow(g, 0, b.h * 0.6, b.d / 2 + 0.02, b.w * 0.7, 0.14, p.win);
        for (let k = 0; k < 3; k++) {
          const wx = -b.w / 2 + 0.45 + k * (b.w - 0.9) / 2;
          addWindow(g, wx, b.h * 0.3, b.d / 2 + 0.02, 0.2, 0.2, p.win);
        }
        addPart(g, new THREE.CylinderGeometry(0.09, 0.09, 1.3, 8), metalMat, -b.w * 0.3, b.h + 0.85, -b.d * 0.28);
      } else {
        const wallMat = b.type === "cabin" ? walls.cabin : walls.house;
        addPart(g, new THREE.BoxGeometry(b.w, b.h, b.d), wallMat, 0, b.h / 2 + 0.15, 0);
        const roofH = Math.min(0.62, b.w * 0.26);
        const half = b.w / 2 + 0.14;
        const slope = Math.hypot(half, roofH);
        const angle = Math.atan2(roofH, half);
        for (const sign of [-1, 1]) {
          const panel = addPart(g, new THREE.BoxGeometry(slope, 0.11, b.d + 0.34), roofMat,
            sign * half / 2, b.h + 0.15 + roofH / 2, 0);
          panel.rotation.z = -sign * angle;
        }
        addPart(g, new THREE.BoxGeometry(0.13, 0.13, b.d + 0.38), metalMat, 0, b.h + 0.15 + roofH, 0);
        for (const wx of [-b.w * 0.26, b.w * 0.26]) {
          addWindow(g, wx, b.h * 0.58, b.d / 2 + 0.03, Math.min(0.36, b.w * 0.17), 0.28, p.win);
        }
        addPart(g, new THREE.BoxGeometry(0.34, 0.52, 0.05), darkMat, 0, b.h * 0.28, b.d / 2 + 0.04);
        addPart(g, new THREE.SphereGeometry(0.035, 6, 5), glowFor(p.win), 0.11, b.h * 0.28, b.d / 2 + 0.08);
        if (b.type === "house") {
          addPart(g, new THREE.BoxGeometry(0.22, 0.52, 0.22), brickMat, b.w * 0.26, b.h + roofH * 0.9, -b.d * 0.2);
          addPart(g, new THREE.BoxGeometry(0.3, 0.06, 0.3), darkMat, b.w * 0.26, b.h + roofH * 0.9 + 0.28, -b.d * 0.2);
        }
      }
      const ring = addPart(g, new THREE.RingGeometry(Math.max(b.w, b.d) * 0.62, Math.max(b.w, b.d) * 0.68, 20),
        new THREE.MeshBasicMaterial({ color: p.win, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }),
        0, 0.02, 0);
      ring.rotation.x = -Math.PI / 2;
    }
    // --- roads: textured asphalt ribbons with soft shoulders and worn centre line ---
    const roadGroup = new THREE.Group();
    env.add(roadGroup);
    const roadMat = std({ map: T.tex.asphalt, color: 0x8e989e, roughness: 0.94, side: THREE.DoubleSide });
    for (const road of cache.roads) {
      const sampled = [];
      for (let s = 0; s < road.length - 1; s++) {
        const a = road[s], b = road[s + 1];
        const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const steps = Math.max(1, Math.ceil(dist / 0.8));
        for (let k2 = 0; k2 <= steps; k2++) {
          const f = k2 / steps;
          sampled.push({ x: lerp(a[0], b[0], f), z: lerp(a[1], b[1], f) });
        }
      }
      if (sampled.length < 2) continue;
      const verts = [], uvs = [], idx = [], edges = [], dashes = [];
      const half = 0.29;
      let travelled = 0;
      for (let i = 0; i < sampled.length; i++) {
        const prev = sampled[Math.max(0, i - 1)], next = sampled[Math.min(sampled.length - 1, i + 1)];
        if (i > 0) travelled += Math.hypot(sampled[i].x - prev.x, sampled[i].z - prev.z);
        let tx = next.x - prev.x, tz = next.z - prev.z;
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl; tz /= tl;
        const nx = -tz, nz = tx;
        const p = sampled[i];
        const lx = p.x + nx * half, lz = p.z + nz * half;
        const rx = p.x - nx * half, rz = p.z - nz * half;
        verts.push(lx, heightAt(lx, lz) + 0.06, lz, rx, heightAt(rx, rz) + 0.06, rz);
        uvs.push(travelled / 2.4, 0, travelled / 2.4, 1);
        if (i > 0) {
          const a = (i - 1) * 2, b = i * 2;
          idx.push(a, a + 1, b, a + 1, b + 1, b);
        }
        edges.push(lx, heightAt(lx, lz) + 0.075, lz, rx, heightAt(rx, rz) + 0.075, rz);
        if (i > 0 && i % 3 !== 0) {
          dashes.push(p.x, heightAt(p.x, p.z) + 0.085, p.z,
            next.x, heightAt(next.x, next.z) + 0.085, next.z);
        }
      }
      const rg = new THREE.BufferGeometry();
      rg.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      rg.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      rg.setIndex(idx);
      rg.computeVertexNormals();
      const ribbon = new THREE.Mesh(rg, roadMat);
      ribbon.receiveShadow = true;
      roadGroup.add(ribbon);
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(edges, 3));
      roadGroup.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
        color: 0x9a9c96, transparent: true, opacity: 0.3, depthWrite: false
      })));
      if (dashes.length) {
        const dg = new THREE.BufferGeometry();
        dg.setAttribute("position", new THREE.Float32BufferAttribute(dashes, 3));
        roadGroup.add(new THREE.LineSegments(dg, new THREE.LineBasicMaterial({
          color: 0xd8cfae, transparent: true, opacity: 0.5, depthWrite: false
        })));
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
    // The coordinators are airborne command drones now, built with the fleet below.
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
    // --- aircraft: the sensor fleet (commanders are ground outposts now) ---
    const droneViews = [];
    const coordViews = [];
    const droneGroup = new THREE.Group();
    const scanGroup = new THREE.Group();
    env.add(droneGroup, scanGroup);
    const hitList = [];
    const carbonMat = std({ map: T.tex.metal, color: 0x27323a, roughness: 0.58, metalness: 0.45 });
    const motorMat = std({ map: T.tex.metal, color: 0x8397a4, roughness: 0.45, metalness: 0.6 });
    const bladeMat = std({ color: 0x1b2329, roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide });
    const canopyMat = new THREE.MeshPhongMaterial({
      color: 0x16232d, specular: 0xffffff, shininess: 120,
      envMap: T.envCube, reflectivity: 0.85, transparent: true, opacity: 0.92
    });
    const lensMat = new THREE.MeshPhongMaterial({
      color: 0x08121c, specular: 0xbfe4ff, shininess: 150, envMap: T.envCube, reflectivity: 0.9
    });
    const blurMat = new THREE.MeshBasicMaterial({
      map: T.tex.rotor, transparent: true, opacity: 0.34, side: THREE.DoubleSide, depthWrite: false
    });
    const skidMat = std({ map: T.tex.metal, color: 0x556670, roughness: 0.6, metalness: 0.5 });

    function makeAirframe(scale, armCount, accent, heavy) {
      const grp = new THREE.Group();
      const bodyMat = std({
        color: heavy ? 0x9aabb5 : 0xb8c9d2, roughness: 0.42, metalness: 0.35,
        emissive: 0x0a4a5a, emissiveIntensity: heavy ? 0.32 : 0.55
      });
      const statusMat = new THREE.MeshBasicMaterial({ color: accent });
      const shell = new THREE.Mesh(new THREE.SphereGeometry(heavy ? 0.4 : 0.34, heavy ? 20 : 16, heavy ? 14 : 12), bodyMat);
      shell.scale.set(heavy ? 1.14 : 1.12, heavy ? 0.42 : 0.46, heavy ? 1.1 : 0.92);
      shell.castShadow = true;
      grp.add(shell);
      const canopy = new THREE.Mesh(new THREE.SphereGeometry(heavy ? 0.3 : 0.27, 14, 10), canopyMat);
      canopy.scale.set(heavy ? 1.04 : 1, heavy ? 0.46 : 0.52, heavy ? 1.02 : 0.85);
      canopy.position.set(0, heavy ? 0.085 : 0.075, heavy ? -0.08 : -0.02);
      grp.add(canopy);
      // gimballed camera under the nose
      const gimbalY = heavy ? -0.21 : -0.16;
      const gimbalZ = heavy ? 0.38 : 0.26;
      const gimbal = new THREE.Mesh(new THREE.SphereGeometry(heavy ? 0.17 : 0.11, 10, 8), carbonMat);
      gimbal.position.set(0, gimbalY, gimbalZ);
      grp.add(gimbal);
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(heavy ? 0.11 : 0.072, heavy ? 0.11 : 0.072, heavy ? 0.08 : 0.055, 12), lensMat);
      lens.rotation.x = Math.PI / 2;
      lens.position.set(0, gimbalY, gimbalZ + (heavy ? 0.15 : 0.09));
      grp.add(lens);
      const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, heavy ? 0.44 : 0.3, 6), carbonMat);
      antenna.position.set(0, heavy ? 0.26 : 0.2, heavy ? -0.28 : -0.2);
      antenna.rotation.x = -0.24;
      grp.add(antenna);
      if (heavy) {
        // larger command quadcopters carry a flat avionics deck and tool pods
        const deck = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.1, 0.66), motorMat);
        deck.position.y = 0.19;
        deck.castShadow = true;
        grp.add(deck);
        for (const sx of [-0.46, 0.46]) {
          const pod = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.48), carbonMat);
          pod.position.set(sx, -0.04, -0.08);
          pod.castShadow = true;
          grp.add(pod);
          const strip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.36), statusMat);
          strip.position.set(sx + Math.sign(sx) * 0.12, 0.04, -0.08);
          grp.add(strip);
        }
        const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.32, 5), carbonMat);
        whip.position.set(0, 0.29, -0.32);
        grp.add(whip);
      }
      // landing skids
      const skidX = heavy ? 0.42 : 0.22;
      for (const sx of [-skidX, skidX]) {
        const skid = new THREE.Mesh(new THREE.BoxGeometry(heavy ? 0.07 : 0.045, 0.04, heavy ? 0.82 : 0.56), skidMat);
        skid.position.set(sx, heavy ? -0.3 : -0.24, 0);
        grp.add(skid);
        for (const sz of heavy ? [-0.26, 0.26] : [-0.17, 0.17]) {
          const strut = new THREE.Mesh(new THREE.BoxGeometry(0.035, heavy ? 0.24 : 0.18, 0.035), skidMat);
          strut.position.set(sx, heavy ? -0.19 : -0.15, sz);
          strut.rotation.z = sx > 0 ? 0.2 : -0.2;
          grp.add(strut);
        }
      }
      const armReach = heavy ? 0.85 : 0.7;
      const rotors = [], blurs = [];
      for (let k = 0; k < armCount; k++) {
        const arm = new THREE.Group();
        arm.rotation.y = (k / armCount) * TAU + (armCount === 4 ? Math.PI / 4 : Math.PI / armCount);
        grp.add(arm);
        const spar = new THREE.Mesh(new THREE.BoxGeometry(armReach * 0.94, heavy ? 0.075 : 0.055, heavy ? 0.11 : 0.085), carbonMat);
        spar.position.set(armReach * 0.54, 0, 0);
        spar.castShadow = true;
        arm.add(spar);
        const motor = new THREE.Mesh(new THREE.CylinderGeometry(heavy ? 0.12 : 0.085, heavy ? 0.13 : 0.095, heavy ? 0.18 : 0.13, 12), motorMat);
        motor.position.set(armReach, heavy ? 0.06 : 0.045, 0);
        motor.castShadow = true;
        arm.add(motor);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.05, 10), carbonMat);
        hub.position.set(armReach, heavy ? 0.17 : 0.13, 0);
        arm.add(hub);
        const dir = k % 2 ? -1 : 1;
        for (const bladeAngle of [0, Math.PI / 2]) {
          const blade = new THREE.Mesh(new THREE.BoxGeometry(heavy ? 0.78 : 0.68, 0.012, heavy ? 0.07 : 0.06), bladeMat);
          blade.position.set(armReach, heavy ? 0.195 : 0.155, 0);
          blade.rotation.y = bladeAngle;
          blade.rotation.x = 0.06;
          arm.add(blade);
          rotors.push({ mesh: blade, dir });
        }
        const blur = new THREE.Mesh(new THREE.PlaneGeometry(heavy ? 1.04 : 0.78, heavy ? 1.04 : 0.78), blurMat);
        blur.rotation.x = -Math.PI / 2;
        blur.position.set(armReach, heavy ? 0.21 : 0.17, 0);
        arm.add(blur);
        blurs.push({ mesh: blur, dir });
        const led = new THREE.Mesh(new THREE.SphereGeometry(heavy ? 0.045 : 0.038, 8, 6), statusMat);
        led.position.set(armReach + (heavy ? 0.13 : 0.12), 0.02, 0);
        arm.add(led);
      }
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: T.glowTex, color: accent, transparent: true, opacity: 0.5, depthWrite: false
      }));
      glow.scale.set(heavy ? 1.3 : 1.1, heavy ? 1.3 : 1.1, 1);
      grp.add(glow);
      const ring = new THREE.Mesh(new THREE.RingGeometry(heavy ? 0.75 : 0.62, heavy ? 0.86 : 0.7, 32),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = heavy ? -0.35 : -0.32;
      grp.add(ring);
      const hit = new THREE.Mesh(new THREE.SphereGeometry(heavy ? 1.45 : 1.15, 8, 6),
        new THREE.MeshBasicMaterial({ visible: false }));
      grp.scale.setScalar(scale);
      return { grp, bodyMat, statusMat, glow, ring, hit, rotors, blurs };
    }

    // --- sensor sweep: each small drone projects a rotating scan cone to the ground ---
    const scanConeGeo = new THREE.ConeGeometry(1, 1, 24, 1, true);
    scanConeGeo.translate(0, -0.5, 0);
    const scanFootGeo = new THREE.RingGeometry(0.9, 1, 32);
    const scanLineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.9, -1, 0)
    ]);
    for (const d of state.drones) {
      const air = makeAirframe(1, 4, 0x22d3ee, false);
      air.hit.userData.droneId = d.id;
      droneGroup.add(air.grp);
      hitList.push(air.hit);
      const cone = new THREE.Mesh(scanConeGeo, new THREE.MeshBasicMaterial({
        color: 0x67e8f9, transparent: true, opacity: 0.055, side: THREE.DoubleSide, depthWrite: false
      }));
      cone.frustumCulled = false;
      const foot = new THREE.Mesh(scanFootGeo, new THREE.MeshBasicMaterial({
        color: 0x67e8f9, transparent: true, opacity: 0.24, side: THREE.DoubleSide, depthWrite: false
      }));
      foot.rotation.x = -Math.PI / 2;
      const sweep = new THREE.Line(scanLineGeo, new THREE.LineBasicMaterial({
        color: 0xa5f3fc, transparent: true, opacity: 0.5, depthWrite: false
      }));
      scanGroup.add(cone, foot, sweep);
      droneViews.push({
        d, grp: air.grp, bodyMat: air.bodyMat, statusMat: air.statusMat, glow: air.glow,
        ring: air.ring, hit: air.hit, rotors: air.rotors, blurs: air.blurs,
        cone, foot, sweep, bankX: 0, bankZ: 0, prevX: d.pos.x, prevZ: d.pos.z, scanPhase: d.idx * 1.3
      });
    }

    // --- coordinator outposts: fixed operator stations at opposite map ends ---
    for (const spec of [
      { id: "MAIN", pos: MAIN_POS, col: 0x22d3ee, css: "#67e8f9", name: "MAIN · START POST" },
      { id: "BKUP", pos: BKUP_POS, col: 0xa78bfa, css: "#c4b5fd", name: "BACKUP · END POST" }
    ]) {
      const g = new THREE.Group();
      g.position.set(spec.pos.x, heightAt(spec.pos.x, spec.pos.z), spec.pos.z);
      env.add(g);

      const pad = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.2, 0.18, 24), concreteMat);
      pad.position.y = 0.09;
      pad.receiveShadow = true;
      g.add(pad);
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.55, 1.72, 40),
        new THREE.MeshBasicMaterial({ color: spec.col, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.19;
      g.add(ring);

      // operator console and the spot a user would stand
      const consoleBody = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.55, 0.62), darkMat);
      consoleBody.position.set(0, 0.48, 0.25);
      consoleBody.castShadow = true;
      g.add(consoleBody);
      const screenMat = std({ color: spec.col, emissive: spec.col, emissiveIntensity: 0.8, roughness: 0.35 });
      const screen = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.48, 0.04), screenMat);
      screen.position.set(0, 0.93, 0.08);
      screen.rotation.x = -0.22;
      g.add(screen);
      const suitMat = std({ color: 0xd2dade, roughness: 0.85 });
      const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.58, 10), suitMat);
      torso.position.set(0, 0.72, -0.58);
      torso.castShadow = true;
      g.add(torso);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), suitMat);
      head.position.set(0, 1.13, -0.58);
      g.add(head);
      const chair = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.1, 0.5), darkMat);
      chair.position.set(0, 0.46, -0.6);
      g.add(chair);
      const chairBack = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.5, 0.08), darkMat);
      chairBack.position.set(0, 0.72, -0.84);
      g.add(chairBack);

      // comms mast with a slowly sweeping dish and a status beacon
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.08, 1.8, 8), metalMat);
      mast.position.set(-1.42, 1.0, -1.0);
      mast.castShadow = true;
      g.add(mast);
      const dish = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.16, 14, 1, true), metalMat);
      dish.position.set(-1.42, 1.96, -1.0);
      dish.rotation.x = -0.6;
      g.add(dish);
      const beaconMat = new THREE.MeshBasicMaterial({ color: spec.col });
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), beaconMat);
      beacon.position.set(-1.42, 2.06, -1.0);
      g.add(beacon);

      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: T.glowTex, color: spec.col, transparent: true, opacity: 0.32, depthWrite: false
      }));
      glow.scale.set(2.6, 2.6, 1);
      glow.position.set(0, 1.1, 0);
      g.add(glow);
      const label = makeLabelSprite();
      setLabelSprite(label, spec.name, spec.css);
      label.sprite.scale.set(6, 1.12, 1);
      label.sprite.position.set(0, 2.6, 0);
      g.add(label.sprite);
      const hit = new THREE.Mesh(new THREE.SphereGeometry(1.9, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.y = 0.9;
      hit.userData.droneId = spec.id;
      g.add(hit);
      hitList.push(hit);
      coordViews.push({
        id: spec.id, grp: g, glow, ring, screenMat, beaconMat, dish, label, hit,
        accent: spec.col, base: spec.pos, phase: spec.id === "MAIN" ? 0 : 1.7
      });
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
    // command links are a separate dashed, amber channel from the posts to drones
    const MAX_CMD = 40;
    const cmdPos = new Float32Array(MAX_CMD * 2 * 3);
    const cmdGeo = new THREE.BufferGeometry();
    cmdGeo.setAttribute("position", new THREE.BufferAttribute(cmdPos, 3));
    const cmdLines = new THREE.LineSegments(cmdGeo, new THREE.LineDashedMaterial({
      color: 0xffd166, dashSize: 0.5, gapSize: 0.32, transparent: true, opacity: 0.92, depthWrite: false
    }));
    cmdLines.frustumCulled = false;
    env.add(cmdLines);
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
    T.waterMesh = waterMesh;
    T.waterWave = (() => {
      const a = waterGeo.attributes.position;
      const xz = new Float32Array(a.count * 2);
      for (let i = 0; i < a.count; i++) { xz[i * 2] = a.getX(i); xz[i * 2 + 1] = a.getZ(i); }
      return { attr: a, xz };
    })();
    T.featureViews = featureViews;
    T.droneViews = droneViews;
    T.coordViews = coordViews;
    T.hitList = hitList;
    T.linkLines = linkLines; T.linkPos = linkPos; T.linkCol = linkCol;
    T.cmdLines = cmdLines; T.cmdPos = cmdPos;
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
    // ambience by situation — exponential haze, light temperature and sky tint
    const sit = currentSituation();
    const fog = T.scene.fog;
    if (sit.id === "rain") {
      T.scene.background.setHex(0x101d24);
      fog.color.setHex(0x122028); fog.density = 0.028;
      T.ambient.intensity = 0.42; T.sun.intensity = 0.5;
      if (T.hemi) T.hemi.intensity = 0.72;
      if (T.fill) T.fill.intensity = 0.22;
      if (T.sky) T.sky.material.color.setHex(0x8aa6b8);
      if (T.sunSprite) { T.sunSprite.visible = false; }
    } else if (sit.night) {
      T.scene.background.setHex(0x03060f);
      fog.color.setHex(0x07101c); fog.density = 0.013;
      T.ambient.intensity = 0.2; T.sun.intensity = 0.36;
      if (T.hemi) T.hemi.intensity = 0.3;
      if (T.fill) T.fill.intensity = 0.3;
      if (T.sky) T.sky.material.color.setHex(0x6a62a8);
      if (T.sunSprite) T.sunSprite.visible = false;
    } else if (sit.id === "blackout") {
      T.scene.background.setHex(0x09051c);
      fog.color.setHex(0x0d0a20); fog.density = 0.015;
      T.ambient.intensity = 0.3; T.sun.intensity = 0.5;
      if (T.hemi) T.hemi.intensity = 0.38;
      if (T.fill) T.fill.intensity = 0.24;
      if (T.sky) T.sky.material.color.setHex(0x8b7ad0);
      if (T.sunSprite) T.sunSprite.visible = false;
    } else {
      T.scene.background.setHex(0x07101a);
      fog.color.setHex(0x122635); fog.density = sit.wind ? 0.009 : 0.0075;
      T.ambient.intensity = 0.26; T.sun.intensity = 1.32;
      if (T.hemi) T.hemi.intensity = 0.62;
      if (T.fill) T.fill.intensity = 0.32;
      if (T.sky) T.sky.material.color.setHex(0xffffff);
      if (T.sunSprite) { T.sunSprite.visible = true; T.sunSprite.material.opacity = 0.72; }
    }
    // rain: falling streaks that follow the wind scenario
    if (T.rain) {
      const rainOn = !!sit.rain;
      T.rain.pts.visible = rainOn;
      if (rainOn) {
        const p = T.rain.pos;
        const drift = sit.wind ? sit.wind.x * 0.12 : 0.025;
        for (let i = 0; i < p.length; i += 3) {
          p[i + 1] -= 0.26 + (i % 9) * 0.02;
          if (p[i + 1] < 0) p[i + 1] = 26;
          p[i] += drift;
          if (p[i] > 30) p[i] = -30;
        }
        T.rain.pts.geometry.attributes.position.needsUpdate = true;
      }
    }
    // water: scrolling ripple normals + gentle vertex swell
    if (T.waterMat) T.waterMat.opacity = 0.72 + 0.05 * Math.sin(t * 1.4);
    if (T.tex && T.tex.waterNormal) {
      T.tex.waterNormal.offset.x = (t * 0.014) % 1;
      T.tex.waterNormal.offset.y = (t * 0.009) % 1;
    }
    if (T.waterMesh) {
      const baseWl = state.terrain ? state.terrain.waterLevel : 0.3;
      T.waterMesh.position.y = baseWl + 0.03 + (sit.id === "rain" ? 0.25 : 0);
    }
    if (T.waterWave) {
      const w = T.waterWave, a = w.attr, amp = sit.id === "rain" ? 2.2 : 1;
      for (let i = 0; i < a.count; i++) {
        const x = w.xz[i * 2], z = w.xz[i * 2 + 1];
        a.setY(i, (Math.sin(x * 0.55 + t * 1.1) * 0.045 + Math.cos(z * 0.7 - t * 0.9) * 0.035) * amp);
      }
      a.needsUpdate = true;
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
    // drones + their ground-scanning sensor sweeps
    for (const view of (T.droneViews || [])) {
      const d = view.d;
      view.grp.position.set(d.pos.x, d.pos.y, d.pos.z);
      view.grp.rotation.y = Math.sin(state.time * 0.24 + d.idx * 1.7) * 0.28 + d.idx * 0.5;
      // bank into movement so the airframe reads as flying, not sliding
      const dx = d.pos.x - view.prevX, dz = d.pos.z - view.prevZ;
      view.prevX = d.pos.x; view.prevZ = d.pos.z;
      view.bankZ = lerp(view.bankZ, clamp(-dx * 2.4, -0.24, 0.24), 0.12);
      view.bankX = lerp(view.bankX, clamp(dz * 2.4, -0.24, 0.24), 0.12);
      view.grp.rotation.z = view.bankZ;
      view.grp.rotation.x = view.bankX;
      if (d.failed) {
        view.bodyMat.color.setHex(0x8e6a70);
        view.bodyMat.emissive.setHex(0x26080c);
        view.statusMat.color.setHex(0xfb7185);
        view.glow.material.color.setHex(0xfb7185);
        view.glow.material.opacity = 0.25;
      } else if (d.leader) {
        view.bodyMat.color.setHex(0xd9b26a);
        view.bodyMat.emissive.setHex(0x4a3200);
        view.statusMat.color.setHex(0xfbbf24);
        view.glow.material.color.setHex(0xfbbf24);
        view.glow.material.opacity = 0.7;
      } else if (d.connected) {
        view.bodyMat.color.setHex(0xb8c9d2);
        view.bodyMat.emissive.setHex(0x0a4a5a);
        view.statusMat.color.setHex(0x22d3ee);
        view.glow.material.color.setHex(0x22d3ee);
        view.glow.material.opacity = 0.5;
      } else {
        view.bodyMat.color.setHex(0xbfa477);
        view.bodyMat.emissive.setHex(0x3a2600);
        view.statusMat.color.setHex(0xf59e0b);
        view.glow.material.color.setHex(0xfbbf24);
        view.glow.material.opacity = 0.38;
      }
      // spinning props and a soft rotor disc; a lost drone's props stop
      if (!d.failed) {
        for (const r of view.rotors) r.mesh.rotation.y += 0.48 * r.dir;
        for (const b of view.blurs) b.mesh.rotation.z += 0.012 * b.dir;
      }
      // the sensor cone stays vertical while the airframe banks
      const apexY = d.pos.y - 0.28;
      const groundY = Math.max(heightAt(d.pos.x, d.pos.z), (state.terrain ? state.terrain.waterLevel : 0) * 0.9);
      const scanH = Math.max(0.55, apexY - groundY - 0.04);
      const scanR = 0.95 + scanH * 0.15;
      view.scanPhase += 0.018;
      view.cone.visible = !d.failed;
      view.cone.position.set(d.pos.x, apexY, d.pos.z);
      view.cone.scale.set(scanR, scanH, scanR);
      view.cone.material.opacity = 0.045 + 0.018 * Math.sin(t * 2.6 + d.idx);
      view.foot.visible = !d.failed;
      view.foot.position.set(d.pos.x, groundY + 0.06, d.pos.z);
      view.foot.scale.set(scanR, scanR, 1);
      view.foot.material.opacity = 0.2 + 0.08 * Math.sin(t * 3 + d.idx);
      view.sweep.visible = !d.failed;
      view.sweep.position.set(d.pos.x, apexY, d.pos.z);
      view.sweep.scale.set(scanR, scanH, scanR);
      view.sweep.rotation.y = view.scanPhase;
      const selected = state.selected === d.id;
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.2 + d.idx);
      view.ring.material.opacity = selected ? 0.7 : 0;
      view.ring.scale.setScalar(1 + (selected ? pulse * 0.16 : 0));
      view.glow.visible = !d.failed;
    }
    // coordinator outposts: beacon, console screen and dish activity
    for (const view of (T.coordViews || [])) {
      const active = view.id === "MAIN" ? state.main.active : state.backup.active;
      const blink = 0.55 + 0.45 * Math.sin(t * 2.4 + view.phase);
      const col = active ? view.accent : 0xfb7185;
      view.beaconMat.color.setHex(col).multiplyScalar(active ? 0.4 + blink * 0.6 : 0.55);
      view.glow.material.color.setHex(col);
      view.glow.material.opacity = active ? 0.24 + blink * 0.12 : 0.1;
      view.ring.material.opacity = active ? 0.28 + blink * 0.16 : 0.12;
      view.screenMat.emissiveIntensity = active ? 0.55 + blink * 0.4 : 0.08;
      view.dish.rotation.y = Math.sin(t * 0.5 + view.phase) * 0.6;
      view.label.sprite.visible = state.layers.labels;
    }
    // links: mesh traffic stays solid; coordinator commands use a dashed amber channel
    if (T.linkLines) {
      let idx = 0, cmd = 0;
      const cTree = [0.4, 0.91, 0.98], cLocal = [0.98, 0.75, 0.14], cBase = [0.27, 0.59, 0.72];
      for (const e of state.edges) {
        const na = nodeById(e.a), nb = nodeById(e.b);
        if (!na || !nb) continue;
        const pa = na.pos, pb = nb.pos;
        if ((e.kind === "main" || e.kind === "backup") && T.cmdLines) {
          if (cmd >= 40) continue;
          T.cmdPos[cmd * 6] = pa.x; T.cmdPos[cmd * 6 + 1] = pa.y; T.cmdPos[cmd * 6 + 2] = pa.z;
          T.cmdPos[cmd * 6 + 3] = pb.x; T.cmdPos[cmd * 6 + 4] = pb.y; T.cmdPos[cmd * 6 + 5] = pb.z;
          cmd++;
          continue;
        }
        if (idx >= 120) continue;
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
      if (T.cmdLines) {
        T.cmdLines.geometry.setDrawRange(0, cmd * 2);
        T.cmdLines.geometry.attributes.position.needsUpdate = true;
        T.cmdLines.computeLineDistances();
        T.cmdLines.visible = state.layers.links;
      }
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
    const command = [];

    for (const e of state.edges) {
      const a = projectPoint(nodeById(e.a).pos);
      const b = projectPoint(nodeById(e.b).pos);
      if (!a || !b) continue;
      if (e.kind === "main" || e.kind === "backup") {
        command.push([a, b, e]);
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

    // Coordinator commands use a distinct dashed amber channel.
    if (command.length) {
      ctx.save();
      ctx.setLineDash([7, 4]);
      ctx.lineDashOffset = -((state.time * 8) % 11);
      ctx.strokeStyle = "rgba(255, 209, 102, 0.72)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const [a, b] of command) {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
      ctx.restore();
    }

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
        ctx.fillText(isMain ? "MAIN POST · OFFLINE" : "BACKUP POST · OFFLINE", p.x, p.y + R + 15);
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
      ctx.fillText(isMain ? "MAIN · START" : "BACKUP · END", p.x, p.y + R + 17);
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
        if (e.kind === "main" || e.kind === "backup") drawTopoEdge(a, b, "rgba(255, 209, 102, 0.7)", 1.5, [6, 4], 0);
        else if (e.tree) drawTopoEdge(a, b, "rgba(103, 232, 249, 0.55)", 1.4, null, 5);
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
    if (el.runSnapshot) el.runSnapshot.addEventListener("click", exportSnapshot);
    if (el.simStep) el.simStep.addEventListener("click", stepSimulation);
    if (el.simFocus) el.simFocus.addEventListener("click", toggleFocus);
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
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleFocus();
      } else if (e.key === "." || e.key === ">") {
        e.preventDefault();
        stepSimulation();
      } else if (e.key === "1" || e.key === "2" || e.key === "3" || e.key === "4") {
        const names = ["overview", "top", "front", "orbit"];
        setCamera(names[Number(e.key) - 1]);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "+" || e.key === "=" || e.key === "-" || e.key === "_" || e.key === "0") {
        // Keyboard camera: only steer while the simulator is on screen so
        // proposal scrolling keeps working elsewhere on the page.
        const sim = $("#simulator");
        let inView = false;
        if (sim) {
          const r = sim.getBoundingClientRect();
          inView = r.top < window.innerHeight && r.bottom > 0;
        }
        if (!inView) return;
        if (state.view !== "command") return;
        e.preventDefault();
        cancelAuto();
        if (e.key === "ArrowLeft") orbitCamera(-14, 0);
        else if (e.key === "ArrowRight") orbitCamera(14, 0);
        else if (e.key === "ArrowUp") orbitCamera(0, -30);
        else if (e.key === "ArrowDown") orbitCamera(0, 30);
        else if (e.key === "+" || e.key === "=") state.camGoal.dist = clamp(state.camGoal.dist * 0.85, 16, 74);
        else if (e.key === "-" || e.key === "_") state.camGoal.dist = clamp(state.camGoal.dist * 1.18, 16, 74);
        else if (e.key === "0") setCamera("overview");
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
    updateCompass();
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
    drawTelemetryChart();
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

