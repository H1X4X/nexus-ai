# NEXUS AI drone system

`assets/drone-system.js` is the complete, reusable drone codebase for NEXUS AI. It is dependency-free, DOM-free and network-free. The browser command center loads it before `assets/app.js`; the simulator supplies terrain/world callbacks and delegates all drone behaviour to this module.

## Loading

Browser:

```html
<script src="assets/drone-system.js"></script>
<script src="assets/app.js"></script>
```

Node:

```js
await import("../assets/drone-system.js");
const DS = globalThis.NexusDroneSystem;
```

The module exposes:

- `VERSION`
- `AUTONOMY_MODES`
- `RELAY_PHASES`
- `DEFAULT_CONFIG`, `DEFAULT_WORLD`, `DEFAULT_POSTS`
- `clamp`, `lerp`, `angleBetween`
- `DroneSystem`
- `createDroneSystem(options)`

## Creating a system

```js
const system = DS.createDroneSystem({
  config: DS.DEFAULT_CONFIG,
  world: DS.DEFAULT_WORLD,
  posts: DS.DEFAULT_POSTS,
  random: () => 0.42,
  heightAt: (x, z) => 0,
  buildings: () => [],
  waterLevel: () => 0,
  situation: () => ({ sensor: 1, liveFor: 7, staleFor: 16, sync: 1 }),
  dataTypeFor: (type) => "terrain",
  log: (message, tone) => console.log(message, tone),
  audit: (actor, action, result) => console.log(actor, action, result),
  state: null
});
```

### Constructor options

| Option | Purpose |
| --- | --- |
| `config` | Flight, sensor, battery and queue constants. Defaults to `DEFAULT_CONFIG`. |
| `world` | `halfExtent` used to clamp every waypoint and position. |
| `posts` | `{ main, backup }` fixed ground operator positions. |
| `random` | Deterministic `() => [0,1)` generator. Pass the seeded generator in NEXUS AI. |
| `heightAt` | Terrain height callback `(x, z) => number`. |
| `buildings` | Callback returning building footprints `{ x, z, w, d, h }` for obstacle and LOS checks. |
| `waterLevel` | Callback or value for the water surface. |
| `situation` | Callback returning the active situation: `sensor`, `sync`, `liveFor`, `staleFor`, `wind`, `drift`, `night`, `spread`. |
| `dataTypeFor` | Maps feature type to `thermal`, `depth`, `optical` or `terrain`. |
| `log` / `logEvent` | Event-log sink. |
| `audit` | Audit sink `(actor, action, result)`. |
| `state` | Optional default simulation state passed to methods that omit `state`. |

## State contract

Methods accept a plain mutable `state` object. The command center passes its existing state, so rendering and exports stay in sync.

```js
const state = {
  time: 0,
  paused: false,
  recall: false,
  drones: [],
  activeDrones: [],
  features: [],
  observations: [],
  pendingObservations: [],
  obsSeq: 0,
  mapSyncAcc: 0,
  channels: {
    telemetry: { latency: 0.08 },
    bulk: { latency: 0.24 }
  },
  coordination: { epoch: 1 },
  safety: { reserve: 25 },
  stats: { observations: 0, expiredObservations: 0, staleRejected: 0 },
  terrain: { buildings: [], waterLevel: 0 }
};
```

## Drone record

`createDrones()` creates twelve equivalent records by default. Important fields:

- `id`, `identity`, `idx`
- `mission`, `waypoints`, `taskQueue`, `wpIndex`, `waypointTime`
- `autonomyMode`, `modeTime`, `flightTime`
- `pos`, `heading`, `cruiseAlt`, `windOffset`
- `battery`, `enduranceDrain` via config
- `connected`, `group`, `hops`, `trusted`, `failed`
- `localQueue`, `deliveryDelay`, `bufferedObservations`, `obsAge`
- `obstacleState`, `lastSurveyFeature`, `rtlNotified`

## Mission planning and task queues

Even-indexed drones fly a back-and-forth **relay corridor** between MAIN and BACKUP, staggered by `RELAY_PHASES`. Odd-indexed drones fly **feature survey** missions: corridor anchor → staging point → feature survey → anchor, repeated for two features.

```js
const plan = system.missionPlanFor(i, features, count);
// { mission, waypoints, startIndex }

const d = drones[0];
system.setMission(d, "custom", [{ x: 1, z: 2 }, { x: 5, z: 6 }], 0);
system.enqueueTask(d, system.createTask("waypoint", { x: 9, z: 3, hold: 2 }));
const current = system.nextTask(d);
system.clearTasks(d);
```

Every waypoint has a matching task in `d.taskQueue`, so mission state is explicit and exportable.

## Autonomy state machine

`updateAutonomy(dt, state)` advances each aircraft:

1. `failed` — emergency descent when the airframe is lost.
2. `hold` — untrusted aircraft stay grounded and out of mission control.
3. `rtl` — battery reserve, recall or lost-link triggers return to the nearest fixed post.
4. `takeoff` — climb from ground to cruise altitude.
5. `route` — follow the task queue with obstacle/terrain avoidance and wind drift.
6. `survey` — station-keeping sensor sweep at a survey waypoint.
7. `landing` — descend at the post, then `hold` until released.

Local safety outranks mission intent and all higher coordination layers.

## Sensing and observations

`updateMapFeatures(dt, state)`:

- moves physical features with wind/drift;
- samples on `mapSyncStep` using `sensorRange`, `sensorFov` and `canObserve()`;
- requires range, forward field of view and terrain/building line of sight;
- records observations with confidence, channel, epoch and TTL;
- stores records onboard when disconnected and flushes them after restore;
- applies channel- and hop-dependent delay through `queueObservation()`;
- rejects expired or wrong-epoch records in `applyObservation()`;
- ages shared-map features through `live`, `stale` and `lost`.

The shared map is therefore never instantly updated by a drone that cannot see the feature or cannot route the record.

## Fault helpers

```js
system.failDrone(d, state, state.time);
system.restoreDrone(d);
system.isolateDrone(d);
system.trustDrone(d);
system.recallAll(state);
system.releaseRecall(state);
```

These helpers mutate only drone/state fields; the command center remains responsible for network topology, UI and audit presentation.

## Radio line of sight

`radioLineBlocked(a, b, idA, idB, state)` samples terrain and buildings along a link. Post IDs `MAIN`/`BKUP` get an elevated antenna; drones only use the radio path above minimum altitude. Storm, interference and severed links remain separate network-layer blockers.

## Fleet summary

`buildFleetSummary(drones)` returns export-ready records with mission, mode, battery, waypoint count, current waypoint, flight time, obstacle state, buffer size and connectivity/trust/failure flags.
