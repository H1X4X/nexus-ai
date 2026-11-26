# NEXUS AI — distributed architecture

This document defines the stronger engineering interpretation of NEXUS AI. The live browser simulation illustrates these ideas; it is not a flight-control system.

## Project definition

> NEXUS AI is a distributed autonomous drone network in which each drone operates as an independent intelligent node while contributing to a shared environmental understanding.
>
> The system combines onboard edge intelligence, resilient wireless communication, distributed coordination, fault-tolerant information synchronization and human-supervised mission management.
>
> Rather than relying on a single central intelligence, NEXUS AI distributes responsibilities across individual drones, regional coordination groups and a central administrative layer. The architecture is designed to maintain safe local operation, preserve synchronized information and recover from communication or system failures.
>
> The long-term objective is a scalable, reliable platform for civilian environmental monitoring, disaster management, agriculture and search-and-rescue support.

## 1. AI responsibility levels

The Main and Backup posts are fixed ground stations at opposite ends of the monitored area; they are places an operator can stand, not airborne command drones. The coordinating service does not control every detail of every drone. It provides high-level mission intent while individual drones make their own local decisions.

| Level | Responsibility | Failure behavior |
| --- | --- | --- |
| **Drone AI** | Local perception, navigation safety, sensor processing, collision avoidance | Continues safe local operation if every other layer is unavailable |
| **Group AI** | Coordinates a small group, relays local observations, elects a temporary local coordinator | Group can reform without the network coordinator |
| **Network AI** | Maintains the overall environmental picture and distributes mission intent | Backup can assume coordination only through a valid leadership transition |
| **Human administrator** | Approves missions, supervises alerts, authorizes sensitive actions | Can override autonomy and isolate unhealthy or untrusted nodes |

## 1a. Physical world and mission execution

The live simulator models a 78×78-unit area, twice the earlier arena, while keeping the same twelve aircraft. Terrain, roads, buildings, vegetation, feature positions and the two operator posts all derive from one world descriptor, so the 2D view, 3D view, radio ranges and mission routes agree. Industrial yards and warehouse clusters and urban apartment blocks use dedicated building facades; the shared world descriptor keeps those archetypes consistent across 2D, 3D, radio and mission layers.

Drones are no longer placed on circular orbits. Each receives a deterministic mission:

- **Relay corridor** — a staggered, back-and-forth patrol along the line between the Main and Backup posts. Waypoints near each post include a short station-keeping interval so the ground stations always have an airborne relay.
- **Feature survey** — staged waypoints from the corridor to real monitored features, an on-site sensor sweep, then a return to the corridor before the next target. Staging keeps each branch within radio range and prevents instant long-haul observations.

Flight modes are `takeoff`, `route`, `survey`, `rtl`, `landing`, `hold` and `failed`. Navigation follows waypoints with a reported heading, a forward sensor field of view, terrain clearance, building avoidance and wind drift correction. Battery reserve, manual recall and lost-link states override mission progress and trigger return-to-nearest-post. Failed drones perform an emergency descent; untrusted drones hold locally.

Radio links use elevated post antennas and airborne relay altitudes; the mesh checks terrain and building obstruction instead of treating every node within nominal range as connected. Launch and landing fall back to the short-range control link. Interference, storms and manually severed links remain separate failure modes.

This is a physical simulation, not a flight controller: speeds, climb rates, sensor geometry and endurance are simplified but consistent across the map.

All drone behaviour lives in the standalone `assets/drone-system.js` module. It owns mission/task queues, waypoint navigation, battery-aware autonomy transitions, local obstacle and line-of-sight sensing, delayed observation routing, fault helpers and export-ready fleet summaries. `assets/app.js` supplies world callbacks and delegates to the same implementation used by `tests/drone-system.test.mjs`. The complete API and state contract are documented in [`docs/DRONE_SYSTEM.md`](DRONE_SYSTEM.md).

## 2. Coordinator failover without split-brain

A backup must not take control simply because one heartbeat was missed. The Main AI could still be healthy while its link to the backup is interrupted.

NEXUS AI uses:

- **Heartbeats** to observe coordinator liveness.
- **Leader leases** with a fixed validity window.
- **Terms / epochs** so old commands can be distinguished from current commands.
- **Quorum evidence** from enough reachable drones before leadership changes.
- **Command sequencing** so a stale coordinator cannot issue conflicting instructions.
- **Independent drone safety**, which never depends on either coordinator.

The backup maintains essential network state, but promotes itself only when the main lease expires *and* a quorum confirms the loss. Drones reject commands with an old epoch.

## 3. Three communication channels

Communication is logically separated so bulk data cannot delay safety traffic.

| Channel | Carries | Priority |
| --- | --- | --- |
| **Safety / control** | Emergency status, authorized commands, fail-safe actions | Highest |
| **Telemetry / coordination** | Position, battery, health, connectivity, observations, heartbeats | Medium |
| **Bulk data** | Images, video, maps, historical sensor recordings | Lowest |

A **store-and-forward** mechanism lets a disconnected drone buffer observations locally and forward them after reconnection. Delivery is not instantaneous: every record waits for a map-sync tick and pays a delay derived from channel latency and route hops, so the shared map visibly ages. Records from a superseded coordinator epoch are rejected at the receiver.

## 4. Shared environmental map and sensor fusion

Every observation is a structured record rather than a bare map marker.

| Field | Purpose |
| --- | --- |
| Observation ID | Unique identification |
| Source drone | Which drone collected it |
| Timestamp | When it was observed |
| Position | Where it was observed |
| Confidence | How reliable the observation is |
| Data type | Image, temperature, terrain, sound, etc. |
| Expiration | When the information becomes stale |
| Channel | Which communication lane carried the record |
| Coordinator epoch | Whether the record belongs to the current leadership term |

A drone only creates a record when the feature is inside sensor range, inside the aircraft's forward field of view and not blocked by terrain or a building. The map distinguishes **provisional**, **confirmed**, **historical** and **unobserved** areas.

If Drone 4 detects smoke and Drone 2 independently reports the same area, NEXUS AI fuses the observations and raises confidence. Conflicting reports reduce confidence and are preserved for human review. Drones are not forced to use the same model: nodes with more processing power or battery may contribute richer observations.

## 5. Independent safety architecture

Safety is a separate layer that the general AI cannot override.

Each drone has:

- Geofencing and authorized operating boundaries.
- Battery reserve requirements.
- Emergency landing procedures.
- Takeoff, cruise, survey, return-to-nearest-post and landing states.
- Terrain clearance and building avoidance during navigation.
- Collision avoidance and separation safeguards.
- A defined response to lost communication.
- A manual override mechanism.

**Safety principle:** when the system becomes uncertain or loses essential communication, it prioritizes safe operation over mission completion.

## 6. Zero-trust security

Joining the network does not make a drone trusted.

- Every drone has a unique cryptographic identity.
- All communication is authenticated and encrypted.
- Administrator commands require authorization.
- Software updates are signed and verified.
- Compromised drones can be isolated.
- Important events are recorded in tamper-resistant audit logs.

False sensor data is also a security concern. A compromised or malfunctioning drone must not be able to corrupt the shared map simply by sending incorrect observations.

## 7. Privacy by design

Because drones may use cameras and monitor large areas:

- Process video locally whenever possible.
- Transmit only the information needed for the mission.
- Avoid collecting personal information unnecessarily.
- Apply retention limits to recorded data.
- Restrict access to sensitive observations.
- Make the monitoring purpose clear.

## 8. Development roadmap

1. **Network simulation** — 3–5 simulated drones with identities, battery states and sensor observations.
2. **Communication** — message exchange, heartbeat monitoring, connection loss and reconnection.
3. **Distributed coordination** — group coordinators, backup coordination and safe leadership transitions.
4. **Shared map** — fuse observations from multiple drones into one environmental picture.
5. **Command center** — dashboard for positions, links, health and alerts.
6. **Failure testing** — drone failures, communication outages, delayed messages and coordinator failures.
7. **Controlled hardware prototype** — small civilian monitoring prototype in a permitted environment.

Relevant technologies to research: **ROS 2, PX4, Gazebo and Python**. Hardware is not required to begin testing the architecture.

## 9. Measurable prototype targets

These are proposed development targets, not guaranteed performance.

| Metric | Prototype target |
| --- | --- |
| Simulated drones | 5 initially, scale to 50+ |
| Drone status updates | 1–2 seconds |
| Coordinator failover | Under 5 seconds in simulation |
| Data synchronization | Recover after network reconnection |
| Drone identity | Unique authenticated identity |
| Shared map | Display source and timestamp |
| Failure testing | Test individual and multiple failures |

Additional measurements: message delivery rate, average communication delay, CPU/memory usage, battery consumption, map accuracy and recovery time after failure.

## 10. Final architecture

```text
Remote Command Center
Human supervision · monitoring · mission approval

Distributed Coordination Layer
Main coordinator · Backup coordinator · leadership management
heartbeats · leases · epochs · quorum

Regional Coordination Groups
Local coordination · information synchronization · temporary connectivity

Drone AI 1        Drone AI 2        Drone AI 3
Local intelligence / local safety / local sensing

All drones retain independent safety systems.
Communication and coordination are distributed;
flight safety does not depend on the Main AI.
```

## 11. Honest assessment

The difficult parts are not simply connecting AI models to drones. They are reliable distributed coordination, communication under unreliable conditions, accurate shared mapping, safe operation when autonomy or communication fails, and testing at increasing scale.

The first strong prototype demonstrates **five simulated drones, a shared map, distributed communication and backup coordination** working together. The live NEXUS AI command center extends that foundation to twelve mission-driven drone nodes in a doubled physical arena, eight environmental maps, six situations and scripted failure scenarios.
