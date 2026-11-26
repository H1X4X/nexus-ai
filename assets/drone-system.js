/* ============================================================
   NEXUS AI — reusable drone system
   Dependency-free browser/Node module. No DOM, no network, no
   external libraries. The command center and the tests both use
   this implementation as the single source of drone behaviour.
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NexusDroneSystem = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = "6.0.0";
  const TAU = Math.PI * 2;

  const AUTONOMY_MODES = [
    { id: "takeoff", label: "Takeoff / climb" },
    { id: "route", label: "Mission route" },
    { id: "survey", label: "Sensor survey" },
    { id: "rtl", label: "Return to outpost" },
    { id: "landing", label: "Landing" },
    { id: "hold", label: "Ground hold" },
    { id: "failed", label: "Emergency landing" }
  ];

  // Relay aircraft are spaced around the whole post-to-post corridor. Mixed
  // parity keeps the short approach legs to both posts occupied as the group
  // rotates, instead of letting every relay drift to one end.
  const RELAY_PHASES = [0, 1, 2, 6, 7, 10];

  const DEFAULT_CONFIG = {
    count: 12,
    droneRange: 28,
    mainRange: 24,
    backupRange: 24,
    handover: 2.5,
    networkStep: 0.16,
    maxSevered: 9,
    recordStep: 3.2,
    sensorRange: 8.6,
    mapSyncStep: 2.5,
    cruiseSpeed: 2.35,
    climbRate: 1.25,
    descentRate: 1.05,
    sensorFov: 110,
    obstacleMargin: 1,
    takeoffSeconds: 2.4,
    landingSeconds: 2.2,
    surveySeconds: 1.6,
    windDrift: 0.32,
    enduranceDrain: 0.052,
    pendingTtl: 45,
    maxPending: 90,
    maxLocalQueue: 14,
    batteryReserve: 25,
    observationTtl: 30,
    maxObservations: 60
  };

  const DEFAULT_WORLD = { scale: 2, halfExtent: 39 };
  const DEFAULT_POSTS = {
    main: { x: -30, y: 0.4, z: 30 },
    backup: { x: 30, y: 0.4, z: -30 }
  };

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const angleBetween = (a, b) => Math.abs(((a - b + Math.PI * 3) % TAU) - Math.PI);
  const defaultRandom = () => Math.random();

  function ensureArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function ensureState(state) {
    return state || {};
  }

  class DroneSystem {
    constructor(options = {}) {
      this.version = VERSION;
      this.config = Object.assign({}, DEFAULT_CONFIG, options.config || {});
      this.world = Object.assign({}, DEFAULT_WORLD, options.world || {});
      const posts = Object.assign({}, DEFAULT_POSTS, options.posts || {});
      this.main = posts.main || DEFAULT_POSTS.main;
      this.backup = posts.backup || DEFAULT_POSTS.backup;

      this.random = options.random || defaultRandom;
      this.heightAt = options.heightAt || (() => 0);
      this.buildings = options.buildings || (() => []);
      this.waterLevel = options.waterLevel || (() => 0);
      this.situation = options.situation || (() => ({}));
      this.dataTypeFor = options.dataTypeFor || (() => "terrain");
      this.log = options.log || options.logEvent || (() => {});
      this.audit = options.audit || (() => {});
      this.state = options.state || null;

      this.taskSeq = 0;
    }

    get cfg() {
      return this.config;
    }

    get posts() {
      return { main: this.main, backup: this.backup };
    }

    clampToArena(v) {
      const extent = Math.max(1, (this.world.halfExtent || 39) - 2);
      return clamp(v, -extent, extent);
    }

    corridor() {
      const dx = this.backup.x - this.main.x;
      const dz = this.backup.z - this.main.z;
      const len = Math.hypot(dx, dz) || 1;
      const px = -dz / len;
      const pz = dx / len;
      return {
        dx, dz, len, px, pz,
        point(t, lane = 0) {
          return {
            x: clamp(this.mainX + dx * t + px * lane, this.minX, this.maxX),
            z: clamp(this.mainZ + dz * t + pz * lane, this.minZ, this.maxZ)
          };
        },
        tFor(x, z) {
          return ((x - this.mainX) * dx + (z - this.mainZ) * dz) / (len * len);
        },
        mainX: this.main.x,
        mainZ: this.main.z,
        minX: -(this.world.halfExtent - 2),
        maxX: this.world.halfExtent - 2,
        minZ: -(this.world.halfExtent - 2),
        maxZ: this.world.halfExtent - 2
      };
    }

    relayLane(i) {
      return ((i % 3) - 1) * 1.3;
    }

    createTask(type, options = {}) {
      return Object.assign({
        id: "T" + String(++this.taskSeq).padStart(4, "0"),
        type: type || "waypoint",
        status: "queued",
        hold: 0
      }, options);
    }

    enqueueTask(d, task) {
      if (!d) return null;
      const item = task && task.id ? task : this.createTask(task && task.type, task);
      d.taskQueue = ensureArray(d.taskQueue);
      d.taskQueue.push(item);
      d.waypoints = ensureArray(d.waypoints);
      d.waypoints.push({
        x: item.x,
        z: item.z,
        type: item.type,
        hold: item.hold || 0,
        featureId: item.featureId || null,
        taskId: item.id
      });
      return item;
    }

    nextTask(d) {
      if (!d || !d.taskQueue || !d.taskQueue.length) return null;
      return d.taskQueue[d.wpIndex % d.taskQueue.length] || null;
    }

    clearTasks(d) {
      if (!d) return;
      d.taskQueue = [];
      d.waypoints = [];
      d.wpIndex = 0;
      d.waypointTime = 0;
    }

    setMission(d, mission, waypoints, startIndex = 0) {
      if (!d) return;
      d.mission = mission || "unassigned";
      d.waypoints = ensureArray(waypoints).slice();
      d.wpIndex = startIndex % Math.max(1, d.waypoints.length);
      d.waypointTime = 0;
      d.taskQueue = d.waypoints.map((wp, index) => this.createTask(wp.type || "waypoint", {
        x: wp.x,
        z: wp.z,
        hold: wp.hold || 0,
        featureId: wp.featureId || null,
        routeIndex: index
      }));
      d.lastSurveyFeature = null;
      d.rtlNotified = false;
    }

    missionPlanFor(i, features = [], count = this.config.count) {
      const corridor = this.corridor();
      const relayCount = Math.ceil(count / 2);

      if (i % 2 === 0) {
        const stops = Array.from({ length: relayCount + 1 }, (_, k) => k / relayCount);
        const sequence = stops.concat(stops.slice(1, -1).reverse());
        const waypoints = sequence.map((t, k) => Object.assign(
          corridor.point(t, this.relayLane(k)),
          { type: "relay", hold: k === 0 || k === relayCount ? 4.5 : 0 }
        ));
        return {
          mission: "relay corridor",
          waypoints,
          startIndex: RELAY_PHASES[(i / 2) % RELAY_PHASES.length]
        };
      }

      const source = ensureArray(features);
      const featureList = source.length ? source.slice() : [
        { id: "P1", x: this.main.x, z: this.main.z, r: 1 },
        { id: "P2", x: this.backup.x, z: this.backup.z, r: 1 }
      ];
      featureList.sort((a, b) => corridor.tFor(a.x, a.z) - corridor.tFor(b.x, b.z));

      const anchor = Object.assign(
        corridor.point((i + 0.5) / count, this.relayLane(i)),
        { type: "relay", hold: 2 + (i - 1) / 2 * 0.4 }
      );
      const slot = (i - 1) / 2;
      const targets = [
        featureList[slot % featureList.length],
        featureList[(slot + 3) % featureList.length]
      ];
      const waypoints = [anchor];
      for (const f of targets) {
        if (!f) continue;
        waypoints.push({
          x: this.clampToArena((anchor.x + f.x) / 2),
          z: this.clampToArena((anchor.z + f.z) / 2),
          type: "staging"
        });
        waypoints.push({ x: f.x, z: f.z, type: "survey", featureId: f.id });
        waypoints.push(Object.assign({}, anchor));
      }
      return { mission: "feature survey", waypoints, startIndex: 0 };
    }

    assignMissions(drones = [], features = [], state = this.state) {
      const ctx = ensureState(state);
      const count = drones.length || this.config.count;
      for (const d of drones) {
        const plan = this.missionPlanFor(d.idx, features, count);
        this.setMission(d, plan.mission, plan.waypoints, plan.startIndex);
        const start = d.waypoints[d.wpIndex] || d.waypoints[0] || this.main;
        const next = d.waypoints[(d.wpIndex + 1) % d.waypoints.length] || this.main;
        const gh = this.heightAt(start.x, start.z);
        d.pos = d.pos || { x: 0, y: 1, z: 0 };
        d.pos.x = start.x;
        d.pos.z = start.z;
        d.pos.y = gh + 0.15;
        d.cruiseAlt = gh + 5.2 + (d.idx % 4) * 0.7;
        d.heading = Math.atan2(next.z - start.z, next.x - start.x);
        d.autonomyMode = "takeoff";
        d.modeTime = d.idx * 0.18;
        d.flightTime = 0;
        d.windOffset = { x: 0, z: 0 };
        d.localQueue = [];
        d.deliveryDelay = 0;
        d.bufferedObservations = 0;
        d.obsAge = 1;
        d.obstacleState = "clear";
        if (!ctx.recall && !d.failed) d.status = d.status || "connected";
      }
    }

    resetMissionState(drones = [], features = [], state = this.state) {
      const ctx = ensureState(state);
      ctx.pendingObservations = [];
      for (const d of drones) d.localQueue = [];
      this.assignMissions(drones, features, ctx);
    }

    createDrones(count = this.config.count, features = [], state = this.state) {
      const drones = [];
      for (let i = 0; i < count; i++) {
        drones.push({
          id: "D" + String(i + 1).padStart(2, "0"),
          identity: "NEXUS-D" + String(i + 1).padStart(3, "0"),
          trusted: true,
          safetyMode: "nominal",
          idx: i,
          mission: "feature survey",
          waypoints: [],
          taskQueue: [],
          wpIndex: 0,
          waypointTime: 0,
          lastSurveyFeature: null,
          autonomyMode: "takeoff",
          modeTime: 0,
          flightTime: 0,
          heading: 0,
          cruiseAlt: 5.4,
          rtlNotified: false,
          localQueue: [],
          deliveryDelay: 0,
          bufferedObservations: 0,
          obstacleState: "clear",
          windOffset: { x: 0, z: 0 },
          battery: Math.round(this.random() * 25 + 72),
          phase: this.random() * TAU,
          failed: false,
          failedAt: 0,
          hops: null,
          connected: false,
          group: null,
          leader: false,
          status: "connected",
          obsAge: 1,
          pos: { x: 0, y: 1, z: 0 }
        });
      }
      const ctx = ensureState(state);
      this.assignMissions(drones, features, ctx);
      if (ctx && Array.isArray(ctx.drones)) ctx.drones = drones;
      return drones;
    }

    setAutonomyMode(d, mode) {
      if (!d || d.autonomyMode === mode) return;
      d.autonomyMode = mode;
      d.modeTime = 0;
    }

    nearestPost(d) {
      if (!d) return this.main;
      const mainDist = Math.hypot(d.pos.x - this.main.x, d.pos.z - this.main.z);
      const backupDist = Math.hypot(d.pos.x - this.backup.x, d.pos.z - this.backup.z);
      return mainDist <= backupDist ? this.main : this.backup;
    }

    steerAroundObstacles(d, dx, dz) {
      const margin = this.config.obstacleMargin;
      const pos = d.pos;
      for (const b of this.buildings()) {
        const gh = this.heightAt(b.x, b.z);
        if (pos.y > gh + b.h + margin) continue;
        const testX = pos.x + dx * 1.6;
        const testZ = pos.z + dz * 1.6;
        if (Math.abs(testX - b.x) < b.w / 2 + margin &&
            Math.abs(testZ - b.z) < b.d / 2 + margin) {
          const sign = d.idx % 2 ? 1 : -1;
          return { x: -dz * sign, z: dx * sign };
        }
      }
      return { x: dx, z: dz };
    }

    lineOfSightBlocked(d, f, state = this.state) {
      if (!d || !f) return true;
      const ctx = ensureState(state);
      const wl = ctx.terrain ? ctx.terrain.waterLevel : this.waterLevel();
      const groundY = Math.max(this.heightAt(f.x, f.z), wl * 0.9);
      const steps = 6;
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const x = d.pos.x + (f.x - d.pos.x) * t;
        const z = d.pos.z + (f.z - d.pos.z) * t;
        const rayY = d.pos.y + (groundY + 0.35 - d.pos.y) * t;
        if (this.heightAt(x, z) > rayY - 0.2) return true;
        for (const b of ctx.terrain ? ensureArray(ctx.terrain.buildings) : this.buildings()) {
          if (Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2 &&
              rayY < this.heightAt(b.x, b.z) + b.h + 0.25) return true;
        }
      }
      return false;
    }

    canObserve(d, f, range, fov, state = this.state) {
      if (!d || !f || d.failed || !d.trusted) return false;
      if (d.autonomyMode === "hold" || d.autonomyMode === "landing" || d.autonomyMode === "failed") return false;
      const fRadius = f.r || 0;
      if (Math.hypot(d.pos.x - f.x, d.pos.z - f.z) > range + fRadius * 0.35) return false;
      const bearing = Math.atan2(f.z - d.pos.z, f.x - d.pos.x);
      const halfFov = (fov * Math.PI / 180) / 2;
      if (angleBetween(bearing, d.heading) > halfFov) return false;
      return !this.lineOfSightBlocked(d, f, state);
    }

    observationChannel(d) {
      return d && d.idx % 5 === 0 ? "bulk" : "telemetry";
    }

    queueObservation(record, source, state = this.state) {
      if (!record || !source) return null;
      const ctx = ensureState(state);
      const channels = ctx.channels || {};
      const ch = channels[record.channel] || channels.telemetry || { latency: 0 };
      const hops = source.hops === null || source.hops === undefined ? 4 : source.hops;
      const delay = this.config.mapSyncStep * 0.7 +
        ch.latency * 4 * (1 + hops * 0.5) + (source.idx % 3) * 0.12;
      const queued = Object.assign({}, record, { deliverAt: ctx.time + delay });
      ctx.pendingObservations = ensureArray(ctx.pendingObservations);
      ctx.pendingObservations.push(queued);
      if (ctx.pendingObservations.length > this.config.maxPending) ctx.pendingObservations.shift();
      source.deliveryDelay = delay;
      return queued;
    }

    applyObservation(record, state = this.state) {
      const ctx = ensureState(state);
      const features = ensureArray(ctx.features);
      const f = features.find((x) => x.id === record.featureId);
      ctx.stats = ctx.stats || {};
      if (!f || record.expiresAt <= ctx.time) {
        ctx.stats.expiredObservations = (ctx.stats.expiredObservations || 0) + 1;
        return false;
      }
      const epoch = ctx.coordination ? ctx.coordination.epoch : 1;
      if (record.epoch !== epoch) {
        ctx.stats.staleRejected = (ctx.stats.staleRejected || 0) + 1;
        return false;
      }
      f.observedAt = record.at;
      f.observers = record.observers.length;
      f.confidence = record.confidence;
      f.fused = record.observers.length >= 2;
      f.sourceDrone = record.source;
      f.observationId = record.id;
      f.dataType = record.dataType;
      ctx.observations = ensureArray(ctx.observations);
      ctx.observations.push(record);
      if (ctx.observations.length > this.config.maxObservations) ctx.observations.shift();
      return true;
    }

    updateMapFeatures(dt, state = this.state) {
      const ctx = ensureState(state);
      const sit = this.situation();
      const hazardTypes = { fire: true, flood: true, hotspot: true, hazard: true };
      const now = ctx.time || 0;

      // Physical feature motion is continuous; shared-map truth is refreshed
      // only when a routed observation is actually delivered.
      for (const f of ensureArray(ctx.features)) {
        if (sit.wind && (f.type === "smoke" || f.type === "fire" || f.type === "hotspot")) {
          const k = Math.min(6, now * 0.05);
          f.x = this.clampToArena(f.homeX + sit.wind.x * k);
          f.z = this.clampToArena(f.homeZ + sit.wind.z * k);
        } else if (sit.drift && (f.type === "survivor" || f.type === "vehicle")) {
          const wave = now * 0.11 + f.phase;
          f.x = this.clampToArena(f.homeX + Math.cos(wave) * 2.5);
          f.z = this.clampToArena(f.homeZ + Math.sin(wave * 0.8) * 2.5);
        } else {
          f.x = f.homeX;
          f.z = f.homeZ;
        }
      }

      ctx.mapSyncAcc = (ctx.mapSyncAcc || 0) + dt * (sit.sync || 1);
      let syncTick = false;
      if (ctx.mapSyncAcc >= this.config.mapSyncStep) {
        ctx.mapSyncAcc -= this.config.mapSyncStep;
        syncTick = true;
      }

      if (syncTick) {
        const range = this.config.sensorRange * sit.sensor * (sit.night ? 0.86 : 1);
        const fov = this.config.sensorFov * (sit.night ? 0.82 : 1);
        const active = ensureArray(ctx.activeDrones.length ? ctx.activeDrones : ctx.drones);
        const allDrones = ensureArray(ctx.drones);

        for (const f of ensureArray(ctx.features)) {
          const observerIds = [];
          for (const d of active) {
            if (this.canObserve(d, f, range, fov, ctx)) observerIds.push(d.id);
          }
          if (!observerIds.length) continue;

          const source = allDrones.find((d) => d.id === observerIds[0]);
          if (!source) continue;
          const channel = this.observationChannel(source);
          const confidence = Math.round(clamp(
            76 + observerIds.length * 7 + (sit.sensor - 0.6) * 18 + Math.sin(f.phase) * 3,
            55, 99
          ));
          const at = Math.round(now * 10) / 10;
          ctx.obsSeq = (ctx.obsSeq || 0) + 1;
          const record = {
            id: "O" + String(ctx.obsSeq).padStart(4, "0"),
            featureId: f.id,
            source: source.id,
            observers: observerIds.slice(),
            at,
            x: Math.round(f.x * 10) / 10,
            z: Math.round(f.z * 10) / 10,
            confidence,
            dataType: this.dataTypeFor(f.type),
            status: observerIds.length >= 2 ? "confirmed" : "provisional",
            expiresAt: Math.round((now + this.config.observationTtl) * 10) / 10,
            channel,
            epoch: ctx.coordination ? ctx.coordination.epoch : 1
          };
          ctx.stats = ctx.stats || {};
          ctx.stats.observations = (ctx.stats.observations || 0) + 1;
          if (source.connected && source.hops !== null) {
            this.queueObservation(record, source, ctx);
          } else {
            source.localQueue = ensureArray(source.localQueue);
            source.localQueue.push(record);
            if (source.localQueue.length > this.config.maxLocalQueue) source.localQueue.shift();
            source.bufferedObservations = source.localQueue.length;
          }
        }

        // A restored route flushes the onboard buffer, but records still pay
        // the channel delay so reconnection is visible, not instantaneous.
        for (const d of active) {
          if (!d.connected || !ensureArray(d.localQueue).length) continue;
          const held = d.localQueue.splice(0, d.localQueue.length);
          d.bufferedObservations = 0;
          for (const record of held) this.queueObservation(record, d, ctx);
        }

        ctx.pendingObservations = ensureArray(ctx.pendingObservations);
        for (let i = ctx.pendingObservations.length - 1; i >= 0; i--) {
          const record = ctx.pendingObservations[i];
          if (now < record.deliverAt) continue;
          ctx.pendingObservations.splice(i, 1);
          this.applyObservation(record, ctx);
        }
      }

      for (const f of ensureArray(ctx.features)) {
        f.age = Math.max(0, now - f.observedAt);
        f.liveState = f.age <= sit.liveFor ? "live" : f.age <= sit.staleFor ? "stale" : "lost";
        f.confidence = Math.round(clamp(
          f.confidence - Math.max(0, f.age - sit.liveFor) * 1.1, 42, 99
        ));
        f.expiresAt = f.observedAt + this.config.observationTtl;
        if (sit.spread && hazardTypes[f.type]) {
          const grow = f.liveState === "live" ? 0.022 : sit.spread;
          f.r = Math.min(f.baseR * 2.2, f.r + grow * Math.max(dt, 0));
        } else {
          f.r = f.baseR;
        }
      }
    }

    updateAutonomy(dt, state = this.state) {
      const ctx = ensureState(state);
      const sit = this.situation();
      const reserveLimit = ctx.safety && ctx.safety.reserve !== undefined
        ? ctx.safety.reserve
        : this.config.batteryReserve;

      for (const d of ensureArray(ctx.drones)) {
        const gh = this.heightAt(d.pos.x, d.pos.z);
        d.obstacleState = "clear";

        // Local safety always outranks mission intent and higher layers.
        if (d.failed) {
          this.setAutonomyMode(d, "failed");
          d.pos.y = Math.max(gh + 0.08, d.pos.y - dt * this.config.descentRate);
          continue;
        }
        if (!d.trusted) {
          this.setAutonomyMode(d, "hold");
          d.pos.y = Math.max(d.pos.y, gh + 2.2);
          continue;
        }

        const reserve = d.battery <= reserveLimit;
        if ((reserve || ctx.recall || (!d.connected && !d.group)) &&
            (d.autonomyMode === "route" || d.autonomyMode === "survey" || d.autonomyMode === "takeoff")) {
          this.setAutonomyMode(d, "rtl");
          if (!d.rtlNotified) {
            d.rtlNotified = true;
            const reason = reserve ? "Battery reserve reached" : ctx.recall ? "Safe recall received" : "Lost link";
            this.log(reason + " · " + d.id + " returning to the nearest outpost", "warn");
            this.audit("DRONE", "rtl", d.id + " · " + (reserve ? "reserve" : ctx.recall ? "manual recall" : "lost link"));
            if (ctx.stats) ctx.stats.rtlEvents = (ctx.stats.rtlEvents || 0) + 1;
          }
        }

        d.modeTime += dt;
        const flying = d.autonomyMode !== "hold" && d.autonomyMode !== "landing" && d.autonomyMode !== "failed";
        if (flying) d.flightTime = (d.flightTime || 0) + dt;

        if (d.autonomyMode === "takeoff") {
          const k = clamp(d.modeTime / this.config.takeoffSeconds, 0, 1);
          d.pos.y = lerp(gh + 0.15, d.cruiseAlt, k);
          if (k >= 1) this.setAutonomyMode(d, "route");
        } else if (d.autonomyMode === "route" || d.autonomyMode === "survey") {
          if (d.autonomyMode === "survey") {
            d.heading += dt * 0.42;
            if (d.modeTime >= this.config.surveySeconds) {
              d.wpIndex = (d.wpIndex + 1) % Math.max(1, d.waypoints.length);
              d.waypointTime = 0;
              this.setAutonomyMode(d, "route");
            }
          } else {
            const wp = d.waypoints[d.wpIndex % Math.max(1, d.waypoints.length)];
            let dx = wp.x - d.pos.x;
            let dz = wp.z - d.pos.z;
            const dist = Math.hypot(dx, dz);
            if (dist < 0.9 && wp.hold) {
              d.waypointTime += dt;
              d.heading += dt * 0.12;
              if (d.waypointTime >= wp.hold) {
                d.wpIndex = (d.wpIndex + 1) % d.waypoints.length;
                d.waypointTime = 0;
              }
            } else if (dist < 0.9) {
              d.waypointTime = 0;
              if (wp.type === "survey") {
                d.lastSurveyFeature = wp.featureId || null;
                this.setAutonomyMode(d, "survey");
              } else {
                d.wpIndex = (d.wpIndex + 1) % d.waypoints.length;
              }
            } else {
              const desired = { x: dx / dist, z: dz / dist };
              const steered = this.steerAroundObstacles(d, desired.x, desired.z);
              d.obstacleState = steered.x !== desired.x || steered.z !== desired.z
                ? "avoiding structure"
                : d.pos.y - gh < 1.4 ? "terrain clearance" : "clear";
              const sl = Math.hypot(steered.x, steered.z) || 1;
              dx = steered.x / sl;
              dz = steered.z / sl;
              const speed = this.config.cruiseSpeed * (d.battery < reserveLimit + 10 ? 0.78 : 1);
              const wind = sit.wind
                ? { x: sit.wind.x * this.config.windDrift, z: sit.wind.z * this.config.windDrift }
                : { x: 0, z: 0 };
              d.pos.x = this.clampToArena(d.pos.x + (dx * speed + wind.x) * dt);
              d.pos.z = this.clampToArena(d.pos.z + (dz * speed + wind.z) * dt);
              d.windOffset.x += (wind.x - d.windOffset.x) * clamp(dt * 1.2, 0, 1);
              d.windOffset.z += (wind.z - d.windOffset.z) * clamp(dt * 1.2, 0, 1);
              d.heading = Math.atan2(dz, dx);
              d.pos.y = lerp(d.pos.y, Math.max(d.cruiseAlt, gh + 2.2), clamp(dt * 0.8, 0, 1));
            }
          }
        } else if (d.autonomyMode === "rtl" || d.autonomyMode === "landing") {
          const post = this.nearestPost(d);
          const tx = post.x + ((d.idx % 3) - 1) * 1.8;
          const tz = post.z + ((d.idx % 2) ? 1.8 : -1.8);
          const dx = tx - d.pos.x;
          const dz = tz - d.pos.z;
          const dist = Math.hypot(dx, dz);
          if (dist > 0.8 && d.autonomyMode === "rtl") {
            const speed = this.config.cruiseSpeed * 1.15;
            d.pos.x += (dx / dist) * speed * dt;
            d.pos.z += (dz / dist) * speed * dt;
            d.heading = Math.atan2(dz, dx);
            d.pos.y = lerp(d.pos.y, Math.max(gh + 2, d.cruiseAlt * 0.55), clamp(dt, 0, 1));
          } else {
            this.setAutonomyMode(d, "landing");
            const g = this.heightAt(d.pos.x, d.pos.z);
            d.pos.y = Math.max(g + 0.12, d.pos.y - dt * this.config.descentRate);
            if (d.pos.y <= g + 0.13 && d.modeTime > this.config.landingSeconds * 0.4) {
              this.setAutonomyMode(d, "hold");
              if (!ctx.recall && !reserve) d.rtlNotified = false;
            }
          }
        }

        d.pos.y = Math.max(d.pos.y, this.heightAt(d.pos.x, d.pos.z) + 0.12);
        if (d.autonomyMode !== "landing" && d.autonomyMode !== "hold") {
          d.battery = Math.max(14, d.battery - dt * this.config.enduranceDrain);
        }
        d.obsAge = ctx.time ? Math.max(0, ctx.time - (d.lastObservationAt || 0)) : d.obsAge || 1;
      }
    }

    failDrone(d, state = this.state, time = 0) {
      if (!d) return;
      d.failed = true;
      d.failedAt = time || 0;
      d.trusted = true;
      d.localQueue = [];
      this.setAutonomyMode(d, "failed");
      this.audit("DRONE", "fail", d.id + " emergency landing");
    }

    restoreDrone(d) {
      if (!d) return;
      d.failed = false;
      d.failedAt = 0;
      d.localQueue = [];
      d.bufferedObservations = 0;
      d.rtlNotified = false;
      this.setAutonomyMode(d, "takeoff");
    }

    isolateDrone(d) {
      if (!d) return;
      d.trusted = false;
      d.localQueue = [];
      this.setAutonomyMode(d, "hold");
    }

    trustDrone(d) {
      if (!d) return;
      d.trusted = true;
      this.setAutonomyMode(d, "route");
    }

    recallAll(state = this.state) {
      const ctx = ensureState(state);
      ctx.recall = true;
      ctx.recallStart = ctx.time || 0;
    }

    releaseRecall(state = this.state) {
      const ctx = ensureState(state);
      ctx.recall = false;
      for (const d of ensureArray(ctx.drones)) d.rtlNotified = false;
    }

    radioLineBlocked(a, b, idA, idB, state = this.state) {
      const ctx = ensureState(state);
      if (!ctx.terrain) return false;
      const postA = idA === "MAIN" || idA === "BKUP";
      const postB = idB === "MAIN" || idB === "BKUP";
      if (!postA && a.y < this.heightAt(a.x, a.z) + 1.5) return false;
      if (!postB && b.y < this.heightAt(b.x, b.z) + 1.5) return false;
      const ay = a.y + (postA ? 3.2 : 0.8);
      const by = b.y + (postB ? 3.2 : 0.8);
      const steps = 8;
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const x = lerp(a.x, b.x, t);
        const z = lerp(a.z, b.z, t);
        const rayY = lerp(ay, by, t);
        if (this.heightAt(x, z) > rayY - 0.4) return true;
        for (const building of ensureArray(ctx.terrain.buildings)) {
          if (Math.abs(x - building.x) < building.w / 2 + 0.3 &&
              Math.abs(z - building.z) < building.d / 2 + 0.3 &&
              rayY < this.heightAt(building.x, building.z) + building.h + 0.3) return true;
        }
      }
      return false;
    }

    buildFleetSummary(drones = []) {
      return drones.map((d) => ({
        id: d.id,
        identity: d.identity,
        mission: d.mission,
        mode: d.autonomyMode,
        battery: Math.round(d.battery),
        waypointCount: ensureArray(d.waypoints).length,
        currentWaypoint: d.wpIndex,
        flightTime: Math.round((d.flightTime || 0) * 10) / 10,
        obstacleState: d.obstacleState,
        buffered: ensureArray(d.localQueue).length,
        connected: !!d.connected,
        trusted: !!d.trusted,
        failed: !!d.failed
      }));
    }
  }

  function createDroneSystem(options) {
    return new DroneSystem(options);
  }

  return {
    VERSION,
    AUTONOMY_MODES,
    RELAY_PHASES,
    DEFAULT_CONFIG,
    DEFAULT_WORLD,
    DEFAULT_POSTS,
    clamp,
    lerp,
    angleBetween,
    DroneSystem,
    createDroneSystem
  };
});
