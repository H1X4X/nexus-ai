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
  const rand = (min, max) => min + Math.random() * (max - min);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
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
    maxLog: 42
  };

  const MAIN_POS = { x: 0, y: 7.8, z: 0 };
  const BKUP_POS = { x: -6.2, y: 5.0, z: -6.2 };
  const ZONE_POS = { x: -7.2, z: 5.4 };
  const ZONE_R = 4.6;
  const STORM_X = 2.4;

  const CAM_PRESETS = {
    overview: { yaw: -0.65, pitch: 0.5, dist: 37, target: [0, 4.4, 0], auto: false },
    top: { yaw: 0, pitch: 1.47, dist: 42, target: [0, 1.2, 0], auto: false },
    front: { yaw: -1.48, pitch: 0.2, dist: 35, target: [0, 5.0, 0], auto: false },
    orbit: { yaw: -0.65, pitch: 0.42, dist: 37, target: [0, 4.4, 0], auto: true }
  };

  /* ---------------- state ---------------- */

  const state = {
    time: 0,
    paused: false,
    speed: 1,
    uiClock: 0,
    view: "command",
    layers: {
      links: true,
      packets: true,
      coverage: false,
      observations: true,
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
    camera: { yaw: -0.65, pitch: 0.5, dist: 37, target: [0, 4.4, 0], auto: false },
    camGoal: { yaw: -0.65, pitch: 0.5, dist: 37, target: [0, 4.4, 0], auto: false },
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
      d.pos.y = d.y + Math.sin(state.time * 0.9 + d.phase) * 0.22;
      if (!d.failed) d.battery = Math.max(18, d.battery - dt * 0.018);
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

  function failMain() {
    if (!state.main.active) return;
    state.main.active = false;
    state.acting = null;
    state.handoverTimer = CFG.handover;
    state.handoverTotal = CFG.handover;
    logEvent("Main AI unresponsive — health check started (2.5s)", "bad");
    toast("Main AI lost. The Backup AI is running a health check before taking authority.", "warn");
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

  function failDrone(preferredId) {
    const candidates = state.drones.filter((d) => !d.failed);
    if (!candidates.length) {
      toast("Every drone is already offline. Restore the fleet first.", "warn");
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
    toast(d.id + " lost. Its last observation is clearly marked stale.", "warn");
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

  function runScenario(name) {
    if (name === "mesh") {
      clearFaults();
      state.storm = true;
      logEvent("Scenario · storm partition raised over the eastern corridor", "warn");
      toast("Scenario: eastern mesh cut. A local group should form.", "warn");
    } else if (name === "main") {
      clearFaults();
      computeNetwork();
      failMain();
      toast("Scenario: Main AI down. Failover starts after a 2.5s health check.", "warn");
    } else if (name === "drone") {
      clearFaults();
      computeNetwork();
      failDrone("D07");
      setView("command", true);
    }
    computeNetwork();
    updateUI(true);
  }

  function resetSim() {
    state.time = 0;
    state.paused = false;
    state.speed = 1;
    state.records = 179;
    state.buffered = 0;
    state.recordAcc = 0;
    state.netAcc = 0;
    state.packets = [];
    state.packetAcc = 0;
    state.replicaAge = 0.2;
    state.groupSince.clear();
    state.selected = null;
    state.view = "command";
    state.recall = false;
    clearFaults();
    for (const d of state.drones) {
      d.hops = null;
      d.connected = true;
      d.group = null;
      d.leader = false;
      d.obsAge = 1;
      d.battery = Math.round(rand(72, 97));
    }
    setCamera("overview");
    setView("command", true);
    updatePauseButton();
    updateSpeedButtons();
    computeNetwork();
    initLogs();
    logEvent("Simulation reset — 12 drones re-registered", "ok");
    toast("Simulation reset to T+00:00.", "ok");
    updateUI(true);
  }

  function runAction(action) {
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

  function setView(view, silent) {
    state.view = view === "topology" ? "topology" : "command";
    updateUI(true);
    if (el.canvasHint) {
      el.canvasHint.textContent =
        state.view === "topology"
          ? "Click a node to inspect it · drag the map to pan"
          : "Drag to orbit · scroll to zoom · right-drag to pan · click a node";
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

    if (state.handoverTimer > 0) {
      state.handoverTimer = Math.max(0, state.handoverTimer - dt);
      if (state.handoverTimer === 0) {
        if (state.backup.active) {
          state.acting = "BKUP";
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
      if (state.acting) state.records += state.connectedCount;
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
    state.packets.push({
      a: e.a,
      b: e.b,
      dir: Math.random() > 0.5,
      born: state.time,
      dur: rand(1.2, 2.4),
      size: rand(1.6, 2.8)
    });
    if (state.packets.length > 90) state.packets.shift();
  }


  /* ============================================================
     Canvas setup & projection
     ============================================================ */

  const stars = Array.from({ length: 80 }, () => ({
    x: Math.random(),
    y: Math.random(),
    r: rand(0.3, 1.2),
    a: rand(0.08, 0.4)
  }));

  function setupCanvas() {
    state.canvas = $("#ops-canvas");
    if (!state.canvas) return;
    state.ctx = state.canvas.getContext("2d");
    resizeCanvas();
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
  }

  function drawGrid() {
    if (!state.layers.grid) return;
    const ctx = state.ctx;
    const span = 26;
    const step = 4;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(88, 160, 190, 0.1)";
    ctx.beginPath();
    for (let v = -span; v <= span; v += step) {
      polyline([{ x: v, y: 0, z: -span }, { x: v, y: 0, z: span }], false);
      polyline([{ x: -span, y: 0, z: v }, { x: span, y: 0, z: v }], false);
    }
    ctx.stroke();

    ctx.strokeStyle = "rgba(34, 211, 238, 0.14)";
    ctx.lineWidth = 1;
    for (const radius of [6, 12, 18]) {
      const pts = [];
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * TAU;
        pts.push({ x: Math.cos(a) * radius, y: 0.02, z: Math.sin(a) * radius });
      }
      ctx.beginPath();
      polyline(pts, false);
      ctx.stroke();
    }

    const origin = projectPoint({ x: 0, y: 0, z: 0 });
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
        pts.push({ x: ZONE_POS.x + Math.cos(a) * ZONE_R, y: 0.08, z: ZONE_POS.z + Math.sin(a) * ZONE_R });
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
      const c = projectPoint({ x: ZONE_POS.x, y: 0.1, z: ZONE_POS.z });
      const top = projectPoint({ x: ZONE_POS.x, y: 2.6, z: ZONE_POS.z });
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
    const a = projectPoint({ x: 0, y: 0.1, z: 0 });
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
      pts.push({ x: Math.cos(ang) * 2.7, y: 0.06, z: Math.sin(ang) * 2.7 });
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
        pts.push({ x: d.pos.x + Math.cos(a) * 3.4, y: 0.05, z: d.pos.z + Math.sin(a) * 3.4 });
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
    drawGrid();
    drawBeam();
    drawCoverage();
    drawZones(t);
    if (state.layers.links) drawLinks();

    if (state.layers.packets) {
      for (const packet of state.packets) drawPacket(packet, t);
    }

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

    if (state.layers.grid) {
      ctx.fillStyle = "rgba(85, 112, 132, 0.65)";
      ctx.font = "8px 'JetBrains Mono', monospace";
      ctx.textAlign = "right";
      ctx.fillText("LAT 34.12 N · LON 118.24 W", W - 18, H - 20);
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
    if (goal.auto && !state.dragging) goal.yaw += dt * 0.14;
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
    state.camGoal.yaw += dx * 0.006;
    state.camGoal.pitch = clamp(state.camGoal.pitch + dy * 0.005, 0.06, 1.52);
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
    if (state.canvas) state.canvas.style.cursor = id ? "pointer" : "";
  }

  function hideCanvasHint() {
    if (el.canvasHint) el.canvasHint.classList.add("is-hidden");
  }

  function bindCanvasInput() {
    const canvas = state.canvas;
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
    if (el.simReset) el.simReset.addEventListener("click", resetSim);
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
    makeDrones();
    setupCanvas();
    buildFleet();
    bindUI();
    initLogs();
    computeNetwork();
    setCamera("overview");
    updatePauseButton();
    updateSpeedButtons();
    updateUI(true);
    requestAnimationFrame(frame);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

