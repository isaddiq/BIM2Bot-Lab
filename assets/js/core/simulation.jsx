/**
 * Multi-robot simulation (Version 3).
 *
 * A deterministic, fixed-step simulation on the occupancy grids from core/navmap.jsx:
 *   - robot fleets execute delivery tasks between rooms, re-planned on the grid for each task
 *   - lifts are resources with a car, door dwell time, capacity and a scheduling policy
 *     (first come first served, or nearest car with collective stops)
 *   - corridor congestion: robots yield to robots ahead of them, wait time is accumulated per
 *     grid cell (heatmap) and long mutual waits are counted as deadlocks
 *   - human–robot interaction: people walk between rooms; robots slow inside the detection
 *     radius and stop inside the safety radius; encounters, near misses and the minimum
 *     separation are recorded with time and place
 *   - safety zones (optional, scenario.applyZones): no-go zones are hard cells, slow zones cap speed
 *   - door schedule: doors close and reopen at set times; robots learn of a closure from the fleet
 *     manager at once, or on arrival when the closed door is within doorSenseRange ahead, and re-plan
 * No DOM or Three.js here: the same engine runs in the UI, in a worker or in tests.
 */

const SIM_DEFAULTS = {
  robots: 4,
  tasksPerRobot: 3,
  humans: 4,
  robotSpeed: 0.8,       // m/s
  humanSpeed: 1.2,       // m/s
  liftPolicy: 'fcfs',    // 'fcfs' | 'nearest'
  liftCapacity: 1,
  liftSpeed: 1.0,        // m/s
  liftDoorTime: 3,       // s
  stairSpeedFactor: 0.4, // legged robots on stairs
  stairsAsLifts: false,
  detectRadius: 2.0,     // m
  safetyRadius: 0.8,     // m
  slowFactor: 0.35,
  deadlockTime: 6,       // s of mutual waiting before one robot pulls over for the other
  maxTime: 3600,         // s
  seed: 7,
  applyZones: false,     // safety zones from Navigate are optional in the simulation
  doorEvents: [],        // [{ doorId, closeAt, openAt|null }] in simulated seconds
  doorInfo: 'fleet',     // 'fleet': robots know at once | 'onboard': robots notice within doorSenseRange
  doorSenseRange: 3,     // m along the path
  retryInterval: 5,      // s between re-plan attempts while no route exists
  turnRate: 1.5,         // rad/s: robots turn in place (differential drive) before driving a new segment
};
const TURN_DRIVE_LIMIT = 0.35; // rad: above this heading error the robot turns on the spot instead of driving

// Validated categorical palette (fixed order; CVD-checked against the light and dark surfaces).
const ROBOT_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const ROBOT_COLORS_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createSimulation(ctx, scenario = {}) {
  const sc = { ...SIM_DEFAULTS, ...scenario };
  const robotProfile = sc.robot || DEFAULT_ROBOT_PROFILE;
  const rng = mulberry32(sc.seed);
  const { building } = ctx;
  const baseBlocked = sc.blocked || new Set();
  const zones = sc.applyZones ? (sc.zones || []) : [];
  // Robot maps per set of closed doors. ctx.navCache and ctx.closureCache (optional, bounded to four
  // maps each) share them between the runs of a batch; a single run keeps its own.
  const localCache = new Map();
  const navFor = (closed) => {
    const blocked = closed && closed.size ? new Set([...baseBlocked, ...closed]) : baseBlocked;
    const key = JSON.stringify([robotProfile, !!sc.stairsAsLifts, [...blocked].sort((a, b) => a - b), sc.obstacles || [], zones]);
    const shared = closed && closed.size ? ctx.closureCache : ctx.navCache;
    const cache = shared || localCache;
    if (cache.has(key)) return cache.get(key);
    const st = applyRobot(ctx.navMap, building, robotProfile, { blocked, obstacles: sc.obstacles, zones, stairsAsLifts: sc.stairsAsLifts });
    if (shared && cache.size >= 4) cache.delete(cache.keys().next().value);
    cache.set(key, st);
    return st;
  };
  let nav = navFor(null);
  // People open doors and ignore robot safety zones: their map only has the static what-if changes.
  const humanKey = JSON.stringify(['person', [...baseBlocked].sort((a, b) => a - b), sc.obstacles || []]);
  let humanNav = null;
  if (sc.humans > 0) {
    humanNav = ctx.navCache && ctx.navCache.get(humanKey);
    if (!humanNav) {
      humanNav = applyRobot(ctx.navMap, building, { name: 'Person', width: 0.45, height: 1.8, clearance: 0.05, canUseStairs: true, canUseLifts: false }, { blocked: sc.blocked, obstacles: sc.obstacles });
      if (ctx.navCache) { if (ctx.navCache.size >= 4) ctx.navCache.delete(ctx.navCache.keys().next().value); ctx.navCache.set(humanKey, humanNav); }
    }
  }
  const robotRadius = nav.radius;
  const footprint = nav.footprint || robotFootprint(robotProfile);
  const turnRate = robotProfile.turnRate || sc.turnRate;

  // Rooms a robot can start from or deliver to (centroid snaps to a free cell).
  const rooms = [];
  building.spaces.forEach(s => {
    const lv = nav.levels.get(s.levelId);
    if (!lv) return;
    const cell = nearestFreeCell(lv, s.position[0], s.position[2], 2.5);
    if (cell < 0) return;
    const c = cellCenter(lv.grid, cell);
    rooms.push({ id: s.id, name: s.name, levelId: s.levelId, point: c });
  });

  const events = [];
  // Custom missions: points picked on the plan or in 3D, snapped to free cells.
  const snapPlace = (pt, name, id) => {
    const lv = pt && nav.levels.get(pt.levelId);
    if (!lv) return null;
    const cell = nearestFreeCell(lv, pt.x, pt.z, 3);
    return cell < 0 ? null : { id, name, levelId: pt.levelId, point: cellCenter(lv.grid, cell) };
  };
  const missions = (sc.missions || []).slice(0, 8).map((m, i) => ({
    index: i,
    start: snapPlace(m.start, `Mission ${i + 1} start`, `m${i}s`),
    goal: snapPlace(m.goal, `Mission ${i + 1} goal`, `m${i}g`),
  }));

  const levelY = new Map([...nav.levels.values()].map(lv => [lv.grid.levelId, lv.grid.floorY]));
  const levelName = (id) => (nav.levels.get(id) ? nav.levels.get(id).grid.levelName : '—');

  // ---- Lifts -----------------------------------------------------------------
  const lifts = new Map();
  nav.transitions.filter(t => t.kind === 'lift' && t.usable).forEach(t => {
    if (!lifts.has(t.verticalId)) {
      const v = building.verticals.get(t.verticalId);
      lifts.set(t.verticalId, {
        id: t.verticalId,
        name: t.virtualLift ? `${v ? v.name : 'Stair core'} (as lift)` : (v ? v.name : 'Lift'),
        virtual: !!t.virtualLift,
        shaft: t.shaft,
        landings: new Map(),
        levels: [],
        carY: null,
        carLevel: null,
        state: 'idle',
        doorTimer: 0,
        target: null,
        riders: [],
        requests: [],
        stats: { trips: 0, served: 0, waitTotal: 0, maxQueue: 0, busyT: 0 },
      });
    }
    const L = lifts.get(t.verticalId);
    L.landings.set(t.a.levelId, cellCenter(nav.levels.get(t.a.levelId).grid, t.a.cell));
    L.landings.set(t.b.levelId, cellCenter(nav.levels.get(t.b.levelId).grid, t.b.cell));
  });
  lifts.forEach(L => {
    L.levels = [...L.landings.keys()].sort((a, b) => levelY.get(a) - levelY.get(b));
    L.carLevel = L.levels[0];
    L.carY = levelY.get(L.carLevel);
  });

  // ---- Heatmaps ----------------------------------------------------------------
  const heat = new Map();
  nav.levels.forEach(lv => heat.set(lv.grid.levelId, new Float32Array(lv.grid.w * lv.grid.h)));

  // ---- Planning helpers ----------------------------------------------------------
  const toPlan = (route) => {
    // Merge consecutive lift legs on the same shaft into one ride.
    const legs = [];
    route.legs.forEach(l => {
      const prev = legs[legs.length - 1];
      if (l.type === 'lift' && prev && prev.type === 'lift' && prev.liftId === l.transition.verticalId) {
        prev.to = l.toLevelId;
        return;
      }
      if (l.type === 'walk') legs.push({ type: 'walk', levelId: l.levelId, points: l.points.map(p => p.slice()) });
      else if (l.type === 'lift') legs.push({ type: 'lift', liftId: l.transition.verticalId, from: l.fromLevelId, to: l.toLevelId });
      else legs.push({ type: 'stairs', transition: l.transition, from: l.fromLevelId, to: l.toLevelId });
    });
    // Drop zero-length walk legs between transitions.
    return legs.filter((l, i) => !(l.type === 'walk' && l.points.length < 2 && i > 0 && i < legs.length - 1));
  };
  const plan = (state, a, b) => planGridRoute(state, { levelId: a.levelId, x: a.point[0], z: a.point[2] }, { levelId: b.levelId, x: b.point[0], z: b.point[2] });

  const log = (kind, text, agent, extra) => {
    events.push({ t: time, kind, text, robotId: agent ? agent.id : null, levelId: agent ? agent.levelId : null, pos: agent ? agent.pos.slice() : null, ...extra });
    if (events.length > 600) events.shift();
  };

  // ---- Robots ---------------------------------------------------------------------
  const robots = [];
  const shuffled = rooms.slice().sort(() => rng() - 0.5);
  const fleetSize = missions.length ? missions.length : Math.min(sc.robots, 8);
  for (let i = 0; i < fleetSize; i++) {
    const mission = missions.length ? missions[i] : null;
    const start = mission ? mission.start : shuffled[i % Math.max(1, shuffled.length)];
    if (!start) {
      if (mission) events.push({ t: 0, kind: 'unreachable', text: `Mission ${i + 1} starts outside the free floor; it was skipped`, robotId: null, levelId: null, pos: null });
      continue;
    }
    robots.push({
      id: i + 1,
      name: `Robot ${i + 1}`,
      color: ROBOT_COLORS[i % ROBOT_COLORS.length],
      colorIndex: i % ROBOT_COLORS.length,
      levelId: start.levelId,
      pos: start.point.slice(),
      heading: 0,
      doneAt: null,
      room: start,
      legs: [],
      legIdx: 0,
      ptIdx: 0,
      state: 'idle',
      waitRun: 0,
      ghost: 0,
      factor: 1,
      tasksLeft: sc.tasksPerRobot,
      mission,
      missionStep: 0,
      task: null,
      lift: null,
      stair: null,
      stats: { dist: 0, moveT: 0, waitT: 0, liftWaitT: 0, rideT: 0, stairT: 0, slowT: 0, stopT: 0, zoneSlowT: 0, blockedT: 0, turnT: 0, replans: 0, tasks: 0, taskTimes: [], unreachable: 0 },
    });
  }

  const nextTask = (r) => {
    if (r.tasksLeft <= 0) { r.state = 'done'; r.doneAt = time; r.legs = []; log('done', `${r.name} finished its tasks`, r); return; }
    if (r.mission) {
      // Shuttle between the mission's start and goal.
      const goal = r.missionStep % 2 === 0 ? r.mission.goal : r.mission.start;
      r.missionStep++;
      const route = goal ? plan(nav, { levelId: r.levelId, point: r.pos }, goal) : null;
      if (!route && goal && closedDoors.size) {
        // Cut off by a scheduled closure: keep the trip and wait for the door to reopen.
        r.task = { from: r.room, to: goal, startT: time, length: 0 };
        r.legs = [];
        r.legIdx = 0;
        r.tasksLeft--;
        r.state = 'blocked';
        r.lastTry = time;
        log('blocked', `${r.name} has no route to ${goal.name} (closed door); waiting`, r);
        return;
      }
      if (!route) {
        r.stats.unreachable += r.tasksLeft;
        r.tasksLeft = 0;
        log('unreachable', `${r.name} has no path to ${goal ? goal.name : 'its mission goal'}`, r);
        r.state = 'done';
        r.doneAt = time;
        return;
      }
      r.task = { from: r.room, to: goal, startT: time, length: route.length };
      r.legs = toPlan(route);
      r.legIdx = 0;
      r.ptIdx = 0;
      r.tasksLeft--;
      startLeg(r);
      return;
    }
    for (let attempt = 0; attempt < 14; attempt++) {
      const goal = rooms[Math.floor(rng() * rooms.length)];
      if (!goal || goal.id === r.room.id) continue;
      const route = plan(nav, { levelId: r.levelId, point: r.pos }, goal);
      if (!route) continue;
      r.task = { from: r.room, to: goal, startT: time, length: route.length };
      r.legs = toPlan(route);
      r.legIdx = 0;
      r.ptIdx = 0;
      r.tasksLeft--;
      startLeg(r);
      return;
    }
    r.stats.unreachable++;
    r.tasksLeft--;
    log('unreachable', `${r.name} could not reach another room from ${r.room.name}`, r);
    nextTask(r);
  };

  const startLeg = (r) => {
    const leg = r.legs[r.legIdx];
    if (!leg) { finishTask(r); return; }
    if (leg.type === 'walk') {
      r.state = 'moving';
      r.ptIdx = 0;
      // Robots start out facing their first segment rather than turning on the spot at t = 0.
      if (time === 0 && leg.points.length > 1) {
        const a = leg.points[0], b = leg.points[leg.points.length > 2 && Math.hypot(leg.points[1][0] - a[0], leg.points[1][2] - a[2]) < 0.05 ? 2 : 1];
        r.heading = Math.atan2(b[2] - a[2], b[0] - a[0]);
      }
      // A leg planned before a closure (e.g. before a lift ride) is checked when it starts.
      if (closedDoors.size && sc.doorInfo === 'fleet' && closedDoorAhead(r, Infinity)) replan(r, 'closed door');
    } else if (leg.type === 'lift') {
      const L = lifts.get(leg.liftId);
      r.state = 'lift-wait';
      r.lift = { leg, requestedAt: time };
      L.requests.push({ robot: r, from: leg.from, to: leg.to, t: time });
      L.stats.maxQueue = Math.max(L.stats.maxQueue, L.requests.length);
    } else {
      const tr = leg.transition;
      const up = levelY.get(leg.to) > levelY.get(leg.from);
      const aCell = up ? tr.a : tr.b;
      const bCell = up ? tr.b : tr.a;
      const p0 = cellCenter(nav.levels.get(aCell.levelId).grid, aCell.cell);
      const p1 = cellCenter(nav.levels.get(bCell.levelId).grid, bCell.cell);
      const dur = (Math.abs(tr.dy) * 1.8 + Math.hypot(p1[0] - p0[0], p1[2] - p0[2])) / (sc.robotSpeed * sc.stairSpeedFactor);
      r.state = 'stairs';
      r.stair = { p0, p1, t: 0, dur, to: leg.to };
    }
  };

  const advance = (r) => {
    r.yieldStreak = 0;
    r.legIdx++;
    if (r.legIdx >= r.legs.length) finishTask(r);
    else startLeg(r);
  };

  const finishTask = (r) => {
    if (r.task) {
      const dt = time - r.task.startT;
      r.stats.tasks++;
      r.stats.taskTimes.push(dt);
      r.room = r.task.to;
      log('task', `${r.name} delivered to ${r.task.to.name} in ${dt.toFixed(0)} s`, r);
      r.task = null;
    }
    nextTask(r);
  };

  // ---- Humans ---------------------------------------------------------------------
  // A random free spot inside a room (people do not all stand on the room centre).
  const spotInRoom = (room, state) => {
    const s = building.spaces.get(room.id);
    const lv = state.levels.get(room.levelId);
    for (let k = 0; k < 24 && s && lv; k++) {
      const x = s.bbox.min[0] + rng() * (s.bbox.max[0] - s.bbox.min[0]);
      const z = s.bbox.min[2] + rng() * (s.bbox.max[2] - s.bbox.min[2]);
      const idx = cellIndex(lv.grid, x, z);
      if (idx >= 0 && (lv.state[idx] === CELL.FREE)) return cellCenter(lv.grid, idx);
    }
    return room.point.slice();
  };
  const humans = [];
  if (humanNav) {
    const humanRooms = rooms.filter(rm => humanNav.levels.has(rm.levelId));
    for (let i = 0; i < sc.humans && humanRooms.length; i++) {
      let start = null, pos = null;
      for (let k = 0; k < 20; k++) {
        start = humanRooms[Math.floor(rng() * humanRooms.length)];
        pos = spotInRoom(start, humanNav);
        if (!robots.some(r => r.levelId === start.levelId && Math.hypot(r.pos[0] - pos[0], r.pos[2] - pos[2]) < 2)) break;
      }
      humans.push({ id: i + 1, name: `Person ${i + 1}`, levelId: start.levelId, pos, room: start, points: null, ptIdx: 0, pause: rng() * 3, heading: 0, waitRun: 0 });
    }
  }
  const humanNext = (h) => {
    const options = rooms.filter(rm => rm.levelId === h.levelId && rm.id !== h.room.id);
    for (let attempt = 0; attempt < 8 && options.length; attempt++) {
      const goal = options[Math.floor(rng() * options.length)];
      const route = plan(humanNav, { levelId: h.levelId, point: h.pos }, { ...goal, point: spotInRoom(goal, humanNav) });
      if (!route || route.legs.length !== 1) continue;
      h.points = route.legs[0].points;
      h.ptIdx = 0;
      h.room = goal;
      return;
    }
    h.pause = 5;
  };

  // ---- Door schedule and re-planning ------------------------------------------------
  const closedDoors = new Set();
  const doorName = (id) => { const d = building.doors.get(id); return d ? d.name : `Door ${id}`; };
  const doorQueue = [];
  (sc.doorEvents || []).forEach(ev => {
    if (!building.doors.has(ev.doorId) || !(ev.closeAt >= 0)) return;
    doorQueue.push({ t: ev.closeAt, doorId: ev.doorId, close: true });
    if (ev.openAt != null && ev.openAt > ev.closeAt) doorQueue.push({ t: ev.openAt, doorId: ev.doorId, close: false });
  });
  doorQueue.sort((a, b) => a.t - b.t || (a.close ? 1 : -1));
  let doorChanges = 0;

  // Is a closed door on the robot's remaining path, within `range` metres (Infinity: whole task)?
  const closedDoorAhead = (r, range) => {
    let left = range;
    let pos = r.pos;
    for (let li = r.legIdx; li < r.legs.length; li++) {
      const leg = r.legs[li];
      if (leg.type !== 'walk') { if (range !== Infinity) return null; continue; }
      const lv = nav.levels.get(leg.levelId);
      if (!lv) continue;
      const start = li === r.legIdx ? r.ptIdx : 0;
      if (li !== r.legIdx) pos = leg.points[0];
      for (let k = start; k < leg.points.length; k++) {
        const q = leg.points[k];
        const len = Math.hypot(q[0] - pos[0], q[2] - pos[2]);
        const n = Math.max(1, Math.ceil(len / (lv.grid.res * 0.5)));
        for (let s = 1; s <= n; s++) {
          const d = (len * s) / n;
          if (d > left) return null;
          const idx = cellIndex(lv.grid, pos[0] + ((q[0] - pos[0]) * s) / n, pos[2] + ((q[2] - pos[2]) * s) / n);
          if (idx >= 0 && lv.state[idx] === CELL.BLOCKED && closedDoors.has(lv.cause[idx])) return lv.cause[idx];
        }
        left -= len;
        pos = q;
      }
      if (range !== Infinity) return null; // onboard sensing only sees the current level
    }
    return null;
  };

  // New route from where the robot is to its current task goal, on the current map.
  const replan = (r, why, quiet) => {
    const goal = r.task ? r.task.to : null;
    if (!goal) return false;
    const route = plan(nav, { levelId: r.levelId, point: r.pos }, goal);
    if (!route) {
      if (r.state !== 'blocked') {
        r.state = 'blocked';
        r.lastTry = time;
        log('blocked', `${r.name} has no route to ${goal.name} (${why}); waiting`, r);
      } else r.lastTry = time;
      return false;
    }
    r.legs = toPlan(route);
    r.legIdx = 0;
    r.ptIdx = 0;
    r.stats.replans++;
    r.waitRun = 0;
    r.triedDetour = false;
    if (!quiet) log('replan', `${r.name} re-planned to ${goal.name} around a ${why}`, r);
    // Start the new first leg without re-checking it (it was planned on the current map).
    const leg = r.legs[0];
    if (!leg) { finishTask(r); return true; }
    if (leg.type === 'walk') { r.state = 'moving'; r.ptIdx = 0; } else startLeg(r);
    return true;
  };

  const applyDoorEvent = (ev) => {
    if (ev.close) closedDoors.add(ev.doorId); else closedDoors.delete(ev.doorId);
    nav = navFor(closedDoors);
    doorChanges++;
    events.push({ t: time, kind: ev.close ? 'door-closed' : 'door-opened', text: `${doorName(ev.doorId)} ${ev.close ? 'closed' : 'reopened'}`, robotId: null, levelId: building.doors.get(ev.doorId).levelId, pos: building.doors.get(ev.doorId).position.slice(), doorId: ev.doorId });
    robots.forEach(r => {
      if (r.state === 'blocked') { replan(r, 'closed door', false); return; }
      if (ev.close && sc.doorInfo === 'fleet' && (r.state === 'moving') && closedDoorAhead(r, Infinity) != null) replan(r, `closed door (${doorName(ev.doorId)})`);
    });
  };

  // ---- State ----------------------------------------------------------------------
  let time = 0;
  const hri = { encounters: 0, nearMisses: 0, minSeparation: Infinity, pairs: new Map() };
  let deadlocks = 0;
  let yields = 0;   // deadlocks resolved by one robot pulling over
  let contacts = 0; // deadlocks resolved by letting bodies overlap (no room to pull over)

  robots.forEach(r => nextTask(r));

  // ---- Lift controller --------------------------------------------------------------
  const openDoors = (L) => {
    L.state = 'doors';
    L.doorTimer = sc.liftDoorTime;
    // Unload.
    L.riders = L.riders.filter(rr => {
      if (rr.to !== L.carLevel) return true;
      const r = rr.robot;
      r.levelId = L.carLevel;
      r.pos = L.landings.get(L.carLevel).slice();
      L.stats.served++;
      advance(r);
      return false;
    });
    // Board, in arrival order.
    const boarding = L.requests.filter(q => q.from === L.carLevel);
    for (const q of boarding) {
      if (L.riders.length >= sc.liftCapacity) break;
      L.requests.splice(L.requests.indexOf(q), 1);
      L.riders.push(q);
      L.stats.waitTotal += time - q.t;
      q.robot.state = 'riding';
      log('lift', `${q.robot.name} boarded ${L.name} at ${levelName(L.carLevel)}`, q.robot);
    }
  };

  const liftTick = (L, dt) => {
    if (L.state === 'doors') {
      L.doorTimer -= dt;
      L.stats.busyT += dt;
      if (L.doorTimer > 0) return;
      L.state = 'idle';
    }
    if (L.state === 'idle') {
      let dest = null;
      if (L.riders.length) {
        dest = sc.liftPolicy === 'nearest'
          ? L.riders.reduce((best, q) => (best == null || Math.abs(levelY.get(q.to) - L.carY) < Math.abs(levelY.get(best) - L.carY) ? q.to : best), null)
          : L.riders[0].to;
      } else if (L.requests.length) {
        dest = sc.liftPolicy === 'nearest'
          ? L.requests.reduce((best, q) => (best == null || Math.abs(levelY.get(q.from) - L.carY) < Math.abs(levelY.get(best) - L.carY) ? q.from : best), null)
          : L.requests[0].from;
      }
      if (dest == null) return;
      if (dest === L.carLevel) { openDoors(L); return; }
      L.state = 'moving';
      L.target = dest;
      L.stats.trips++;
    }
    if (L.state === 'moving') {
      L.stats.busyT += dt;
      const ty = levelY.get(L.target);
      const dir = Math.sign(ty - L.carY);
      let ny = L.carY + dir * sc.liftSpeed * dt;
      // Collective stops: nearest-car policy picks up waiting robots on the way.
      if (sc.liftPolicy === 'nearest' && L.riders.length < sc.liftCapacity) {
        for (const lvl of L.levels) {
          const y = levelY.get(lvl);
          const passing = dir > 0 ? (y > L.carY + 1e-3 && y <= ny) : (y < L.carY - 1e-3 && y >= ny);
          if (passing && L.requests.some(q => q.from === lvl)) { L.target = lvl; ny = y; break; }
        }
      }
      const arrived = dir >= 0 ? ny >= levelY.get(L.target) : ny <= levelY.get(L.target);
      L.carY = arrived ? levelY.get(L.target) : ny;
      L.riders.forEach(q => { q.robot.pos = [L.shaft[0], L.carY, L.shaft[1]]; });
      if (arrived) {
        L.carLevel = L.target;
        openDoors(L);
      }
    }
  };

  // ---- Robot motion ------------------------------------------------------------------
  // Rigid bodies: a robot never moves closer to another than their footprints allow at any
  // heading (twice the inflation radius for round robots, the corner-to-corner span for boxes).
  const minSep = Math.max(robotRadius * 2, 2 * (footprint.outer - footprint.clearance));
  const conflictWith = (r, nx, nz) => {
    const minD = minSep;
    for (const o of robots) {
      // Riding, climbing or finished (docked) robots are not on the floor.
      if (o === r || o.levelId !== r.levelId || o.state === 'riding' || o.state === 'stairs' || o.state === 'done') continue;
      const d0 = Math.hypot(o.pos[0] - r.pos[0], o.pos[2] - r.pos[2]);
      const d1 = Math.hypot(o.pos[0] - nx, o.pos[2] - nz);
      if (d1 < minD && d1 < d0) return o;
    }
    return null;
  };

  // Re-plan the rest of the current walk leg around the other robots on this level.
  const detour = (r) => {
    const leg = r.legs[r.legIdx];
    if (!leg || leg.type !== 'walk') return false;
    const end = leg.points[leg.points.length - 1];
    const others = robots.filter(o => o !== r && o.levelId === r.levelId && o.state !== 'riding' && o.state !== 'done' && o.state !== 'stairs');
    if (!others.length) return false;
    const lv = nav.levels.get(r.levelId);
    const avoid = robotRadius * 2.2;
    const route = planGridRoute(nav, { levelId: r.levelId, x: r.pos[0], z: r.pos[2] }, { levelId: r.levelId, x: end[0], z: end[2] }, {
      maxExpand: 60000,
      extraCost: (levelId, cell) => {
        if (levelId !== r.levelId) return 0;
        const c = cellCenter(lv.grid, cell);
        for (const o of others) if (Math.hypot(c[0] - o.pos[0], c[2] - o.pos[2]) < avoid) return 50;
        return 0;
      },
    });
    if (!route || route.legs.length !== 1) return false;
    leg.points = route.legs[0].points.map(q => q.slice());
    r.ptIdx = 0;
    return true;
  };

  // Rigid bodies cannot pass through each other. When two robots block each other, one pulls
  // over: it drives to the nearest free spot clear of the other's remaining path, waits there
  // until the other has gone by, then re-plans the rest of its leg.
  const pullOver = (y, p) => {
    const leg = y.legs[y.legIdx];
    if (!leg || leg.type !== 'walk' || y.state !== 'moving') return false;
    const lv = nav.levels.get(y.levelId);
    if (!lv) return false;
    const g = lv.grid;
    const others = robots.filter(o => o !== y && o.levelId === y.levelId && o.state !== 'riding' && o.state !== 'stairs' && o.state !== 'done');
    const paths = others.map(o => {
      const oLeg = o.legs[o.legIdx];
      const path = [o.pos];
      const parked = o.hold && o.hold.parked;
      if (!parked && o.state === 'moving' && oLeg && oLeg.type === 'walk' && oLeg.points) for (let k = o.ptIdx; k < oLeg.points.length; k++) path.push(oLeg.points[k]);
      return path;
    });
    const segDist = (x, z, a, b) => {
      const vx = b[0] - a[0], vz = b[2] - a[2];
      const L2 = vx * vx + vz * vz;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[2]) * vz) / L2)) : 0;
      return Math.hypot(x - (a[0] + vx * t), z - (a[2] + vz * t));
    };
    const margin = minSep + 0.15;
    const clearOf = (c) => {
      for (const o of others) if (Math.hypot(c[0] - o.pos[0], c[2] - o.pos[2]) < margin) return false;
      for (const path of paths) for (let k = 1; k < path.length; k++) if (segDist(c[0], c[2], path[k - 1], path[k]) < margin) return false;
      return true;
    };
    const ok = (k) => passable(lv.state[k]) && (!lv.fits || lv.fits[k] !== 0);
    const start = cellIndex(g, y.pos[0], y.pos[2]);
    if (start < 0) return false;
    // Breadth-first search outward over free floor, not through the other robot's body.
    const maxR = Math.ceil(6 / g.res);
    const si = start % g.w, sj = (start / g.w) | 0;
    const seen = new Uint8Array(g.w * g.h);
    const queue = [start];
    seen[start] = 1;
    let target = -1;
    for (let q = 0; q < queue.length; q++) {
      const k = queue[q];
      const c = cellCenter(g, k);
      if (k !== start && (!lv.fits || lv.fits[k] === 15) && clearOf(c)) { target = k; break; }
      const i = k % g.w, j = (k / g.w) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= g.w || nj >= g.h || Math.abs(ni - si) > maxR || Math.abs(nj - sj) > maxR) continue;
        const nk = nj * g.w + ni;
        if (seen[nk] || !ok(nk)) continue;
        seen[nk] = 1;
        const nc = cellCenter(g, nk);
        if (Math.hypot(nc[0] - p.pos[0], nc[2] - p.pos[2]) < minSep && p.levelId === y.levelId) continue;
        queue.push(nk);
      }
    }
    if (target < 0) return false;
    const tc = cellCenter(g, target);
    const route = planGridRoute(nav, { levelId: y.levelId, x: y.pos[0], z: y.pos[2] }, { levelId: y.levelId, x: tc[0], z: tc[2] }, {
      maxExpand: 80000,
      extraCost: (levelId, cell) => {
        const q = cellCenter(g, cell);
        return Math.hypot(q[0] - p.pos[0], q[2] - p.pos[2]) < minSep ? 1000 : 0;
      },
    });
    if (!route || route.legs.length !== 1 || !route.legs[0].points) return false;
    const end = y.hold && y.hold.leg === leg ? y.hold.end : leg.points[leg.points.length - 1].slice();
    leg.points = route.legs[0].points.map(q => q.slice());
    y.ptIdx = 0;
    y.hold = { leg, end, passerId: p.id, passerDist0: p.stats.dist, until: time + 40, parked: false };
    yields++;
    return true;
  };

  // A robot parked for another carries on once that robot has gone by (or after a time-out).
  const resumeFromHold = (r) => {
    const h = r.hold;
    const p = robots.find(o => o.id === h.passerId);
    const gone = !p || p.state === 'done' || p.levelId !== r.levelId
      || (Math.hypot(p.pos[0] - r.pos[0], p.pos[2] - r.pos[2]) > minSep + 1 && p.stats.dist - h.passerDist0 > 1);
    if (!gone && time < h.until) return false;
    r.hold = null;
    const leg = r.legs[r.legIdx];
    const route = planGridRoute(nav, { levelId: r.levelId, x: r.pos[0], z: r.pos[2] }, { levelId: r.levelId, x: h.end[0], z: h.end[2] }, { maxExpand: 200000 });
    if (route && route.legs.length === 1 && route.legs[0].points) {
      leg.points = route.legs[0].points.map(q => q.slice());
      r.ptIdx = 0;
      return true;
    }
    replan(r, 'pull-over', true);
    return r.state === 'moving';
  };

  const humanEffect = (r) => {
    let factor = 1;
    // After waiting a while for a person, the robot edges past slowly with a tighter stop radius.
    const careful = r.careful > 0;
    const stopRadius = r.squeeze > 0 ? 0 : careful ? 0.45 : sc.safetyRadius;
    for (const h of humans) {
      if (h.levelId !== r.levelId) continue;
      const d = Math.hypot(h.pos[0] - r.pos[0], h.pos[2] - r.pos[2]);
      hri.minSeparation = Math.min(hri.minSeparation, d);
      const key = `${r.id}:${h.id}`;
      const pair = hri.pairs.get(key) || { detect: false, near: false };
      if (d < sc.detectRadius && !pair.detect) { pair.detect = true; hri.encounters++; }
      if (d > sc.detectRadius * 1.25) pair.detect = false;
      if (d < sc.safetyRadius && !pair.near) {
        pair.near = true;
        hri.nearMisses++;
        log('near-miss', `${r.name} stopped for ${h.name} at ${d.toFixed(2)} m`, r);
      }
      if (d > sc.safetyRadius * 1.5) pair.near = false;
      hri.pairs.set(key, pair);
      if (d < stopRadius) factor = 0;
      else if (d < sc.detectRadius) factor = Math.min(factor, r.squeeze > 0 ? 0.1 : careful ? 0.2 : sc.slowFactor);
    }
    return factor;
  };

  // The nearest person steps aside onto free floor so a stalled robot can pass.
  const sidestep = (r) => {
    let near = null, nd = Infinity;
    humans.forEach(h => {
      if (h.levelId !== r.levelId) return;
      const d = Math.hypot(h.pos[0] - r.pos[0], h.pos[2] - r.pos[2]);
      if (d < nd) { nd = d; near = h; }
    });
    if (!near || !humanNav) return;
    const lv = humanNav.levels.get(near.levelId);
    // Prefer stepping sideways, then any direction, a little further each time.
    const base = r.heading + Math.PI / 2;
    for (const dist of [0.7, 1.1, 1.6]) {
      for (const turn of [0, Math.PI, Math.PI / 4, -Math.PI / 4, 3 * Math.PI / 4, -3 * Math.PI / 4, Math.PI / 2, -Math.PI / 2]) {
        const a = base + turn;
        const x = near.pos[0] + Math.cos(a) * dist, z = near.pos[2] + Math.sin(a) * dist;
        const idx = lv ? cellIndex(lv.grid, x, z) : -1;
        if (idx >= 0 && lv.state[idx] === CELL.FREE && Math.hypot(x - r.pos[0], z - r.pos[2]) > sc.safetyRadius) {
          near.pos[0] = x; near.pos[2] = z;
          near.points = null;
          near.pause = 2;
          log('hri-yield', `${near.name} stepped aside for ${r.name}`, r);
          return;
        }
      }
    }
    // No room to step aside: the robot squeezes past at crawl speed.
    r.squeeze = 4;
    hri.closePasses = (hri.closePasses || 0) + 1;
    log('close-pass', `${r.name} squeezed past ${near.name} in a tight space`, r);
  };

  const robotTick = (r, dt) => {
    switch (r.state) {
      case 'done':
      case 'idle':
        return;
      case 'lift-wait':
        r.stats.liftWaitT += dt;
        return;
      case 'riding':
        r.stats.rideT += dt;
        return;
      case 'blocked':
        r.stats.blockedT += dt;
        if (time - (r.lastTry || 0) >= sc.retryInterval) replan(r, 'closed door');
        return;
      case 'stairs': {
        const s = r.stair;
        s.t += dt;
        r.stats.stairT += dt;
        const k = Math.min(1, s.t / s.dur);
        r.pos = [s.p0[0] + (s.p1[0] - s.p0[0]) * k, s.p0[1] + (s.p1[1] - s.p0[1]) * k, s.p0[2] + (s.p1[2] - s.p0[2]) * k];
        if (k >= 1) { r.levelId = s.to; r.stair = null; advance(r); }
        return;
      }
      default: break;
    }
    // Onboard sensing: a closed door within sensing range on the current path triggers a re-plan.
    if (closedDoors.size && sc.doorInfo === 'onboard') {
      const d = closedDoorAhead(r, sc.doorSenseRange);
      if (d != null) { replan(r, `closed door (${doorName(d)}) seen ahead`); if (r.state !== 'moving') return; }
    }
    const leg = r.legs[r.legIdx];
    if (r.hold) {
      if (r.hold.leg !== leg) r.hold = null; // the leg was re-planned meanwhile
      else if (r.hold.parked) {
        if (!resumeFromHold(r)) { r.stats.waitT += dt; return; }
        if (r.state !== 'moving') return;
      }
    }
    let target = leg.points[r.ptIdx];
    let dx = target[0] - r.pos[0], dz = target[2] - r.pos[2];
    let d = Math.hypot(dx, dz);
    while (d < 0.03) {
      r.ptIdx++;
      if (r.ptIdx >= leg.points.length) {
        if (r.hold && r.hold.leg === leg) { r.hold.parked = true; r.ptIdx = leg.points.length - 1; return; }
        advance(r);
        return;
      }
      target = leg.points[r.ptIdx];
      dx = target[0] - r.pos[0]; dz = target[2] - r.pos[2];
      d = Math.hypot(dx, dz);
    }
    const ux = dx / d, uz = dz / d;
    // Differential-drive kinematics: turn towards the next segment at a limited rate, on the
    // spot when the heading error is large, so the body never swings sideways off the path.
    const want = Math.atan2(uz, ux);
    const dh = Math.atan2(Math.sin(want - r.heading), Math.cos(want - r.heading));
    const maxTurn = turnRate * dt;
    if (Math.abs(dh) > maxTurn) {
      r.heading = Math.atan2(Math.sin(r.heading + Math.sign(dh) * maxTurn), Math.cos(r.heading + Math.sign(dh) * maxTurn));
      if (Math.abs(dh) - maxTurn > TURN_DRIVE_LIMIT) { r.stats.turnT += dt; r.stats.moveT += dt; return; }
    } else r.heading = want;
    let factor = humanEffect(r);
    if (zones.length) {
      const lvz = nav.levels.get(r.levelId);
      const zf = lvz ? slowFactorAt(lvz, cellIndex(lvz.grid, r.pos[0], r.pos[2])) : 1;
      if (zf < 1) { r.stats.zoneSlowT += dt; if (factor > 0) factor = Math.min(factor, zf); }
    }
    r.factor = factor;
    const stepLen = Math.min(d, sc.robotSpeed * Math.max(factor, 0.05) * dt);
    const blocker = r.ghost > 0 ? null : conflictWith(r, r.pos[0] + ux * stepLen, r.pos[2] + uz * stepLen);
    if (r.ghost > 0) r.ghost -= dt;
    if (r.careful > 0) r.careful -= dt;
    if (r.squeeze > 0) r.squeeze -= dt;
    if (blocker || factor === 0) {
      r.waitRun += dt;
      if (factor === 0) {
        r.stats.stopT += dt;
        r.humanWait = (r.humanWait || 0) + dt;
        r.stopRun = (r.stopRun || 0) + dt;
        if (r.humanWait > 3 && !(r.careful > 0)) {
          r.careful = 5;
          r.humanWait = 0;
          if (!(time - (r.lastPassLog || -1e9) < 15)) {
            r.lastPassLog = time;
            log('hri-pass', `${r.name} edged past a person after waiting 3 s`, r);
          }
        }
        if (r.stopRun > 8) {
          r.stopRun = 0;
          sidestep(r);
        }
      }
      else {
        r.stats.waitT += dt;
        const lv = nav.levels.get(r.levelId);
        const idx = lv ? cellIndex(lv.grid, r.pos[0], r.pos[2]) : -1;
        if (idx >= 0) heat.get(r.levelId)[idx] += dt;
        // The robot with right of way tries a local detour first.
        if (r.waitRun > 1.5 && !r.triedDetour && (blocker.state !== 'moving' || r.id < blocker.id)) {
          r.triedDetour = true;
          if (detour(r)) { r.waitRun = 0; log('detour', `${r.name} re-planned around ${blocker.name}`, r); }
        }
        if (r.waitRun > sc.deadlockTime) {
          deadlocks++;
          r.triedDetour = false;
          r.waitRun = 0;
          // The robot with the higher number gives way first. One that has pulled over three
          // times without finishing its leg is not asked again, so a gridlock cannot last.
          const stuck = (x) => (x.yieldStreak || 0) >= 3;
          const order = r.id > blocker.id ? [[r, blocker], [blocker, r]] : [[blocker, r], [r, blocker]];
          const pair = order.find(([y, p]) => y.state === 'moving' && !stuck(y) && pullOver(y, p));
          if (pair) {
            const [y, p] = pair;
            y.waitRun = 0;
            y.yieldStreak = (y.yieldStreak || 0) + 1;
            log('yield', `${y.name} pulled over to let ${p.name} pass`, y);
          } else {
            // No free floor to pull over into: the last resort lets one robot through, and the
            // overlap of the two bodies is counted so results do not hide it.
            r.ghost = 2.5;
            contacts++;
            log('deadlock', `${r.name} and ${blocker.name} blocked each other with no room to pull over; ${r.name} was let through (bodies overlap)`, r);
          }
        }
      }
      return;
    }
    r.waitRun = 0;
    r.humanWait = 0;
    r.stopRun = 0;
    r.triedDetour = false;
    if (factor < 1) r.stats.slowT += dt;
    const step = Math.min(d, sc.robotSpeed * factor * dt);
    r.pos[0] += ux * step;
    r.pos[2] += uz * step;
    r.pos[1] = levelY.get(r.levelId);
    r.stats.dist += step;
    r.stats.moveT += dt;
  };

  const humanTick = (h, dt) => {
    if (h.pause > 0) { h.pause -= dt; if (h.pause <= 0) humanNext(h); return; }
    if (!h.points) { humanNext(h); return; }
    const target = h.points[h.ptIdx];
    const dx = target[0] - h.pos[0], dz = target[2] - h.pos[2];
    const d = Math.hypot(dx, dz);
    if (d < 0.05) {
      h.ptIdx++;
      if (h.ptIdx >= h.points.length) { h.points = null; h.pause = 2 + rng() * 4; }
      return;
    }
    // People give way to a robot right in front of them; after a while they pick another destination.
    const ux = dx / d, uz = dz / d;
    const inFront = robots.some(r => {
      if (r.levelId !== h.levelId || r.state === 'riding' || r.state === 'done') return false;
      const rx = r.pos[0] - h.pos[0], rz = r.pos[2] - h.pos[2];
      const ahead = rx * ux + rz * uz;
      return ahead > 0 && ahead < sc.safetyRadius + 0.2 && Math.abs(rx * uz - rz * ux) < robotRadius + 0.3;
    });
    if (inFront) {
      h.waitRun += dt;
      if (h.waitRun > 4) { h.waitRun = 0; humanNext(h); }
      return;
    }
    h.waitRun = 0;
    const step = Math.min(d, sc.humanSpeed * dt);
    h.heading = Math.atan2(dz, dx);
    h.pos[0] += (dx / d) * step;
    h.pos[2] += (dz / d) * step;
  };

  const tick = (dt) => {
    time += dt;
    while (doorQueue.length && doorQueue[0].t <= time) applyDoorEvent(doorQueue.shift());
    humans.forEach(h => humanTick(h, dt));
    lifts.forEach(L => liftTick(L, dt));
    robots.forEach(r => robotTick(r, dt));
    if (robots.every(r => r.state === 'done') || time >= sc.maxTime) sim.done = true;
  };

  const sim = {
    scenario: sc,
    get nav() { return nav; },
    closedDoors,
    robots,
    humans,
    lifts,
    heat,
    events,
    rooms,
    done: robots.length === 0,
    get time() { return time; },
    step(dt) {
      let remaining = dt;
      while (remaining > 1e-6 && !sim.done) {
        const h = Math.min(0.1, remaining);
        tick(h);
        remaining -= h;
      }
    },
    runToEnd(maxSteps = 200000) {
      let n = 0;
      while (!sim.done && n++ < maxSteps) tick(0.1);
    },
    summary() {
      const allTimes = robots.flatMap(r => r.stats.taskTimes);
      const tasksDone = allTimes.length;
      const planned = robots.length * sc.tasksPerRobot;
      const sum = (f) => robots.reduce((a, r) => a + f(r), 0);
      return {
        time,
        done: sim.done,
        timedOut: time >= sc.maxTime,
        robots: robots.map(r => ({ id: r.id, name: r.name, color: r.color, colorIndex: r.colorIndex, state: r.state, levelName: levelName(r.levelId), leg: r.legs[r.legIdx] ? r.legs[r.legIdx].type : null, tasksLeft: r.tasksLeft, ...r.stats, taskTimes: undefined, meanTask: r.stats.taskTimes.length ? r.stats.taskTimes.reduce((a, b) => a + b, 0) / r.stats.taskTimes.length : null })),
        totals: {
          tasksDone,
          tasksPlanned: planned,
          unreachable: sum(r => r.stats.unreachable),
          makespan: sim.done ? Math.max(0, ...robots.map(r => r.doneAt || 0)) : time,
          throughputPerHour: time > 0 ? (tasksDone / time) * 3600 : 0,
          meanTaskTime: tasksDone ? allTimes.reduce((a, b) => a + b, 0) / tasksDone : null,
          distance: sum(r => r.stats.dist),
          congestionWait: sum(r => r.stats.waitT),
          liftWait: sum(r => r.stats.liftWaitT),
          stopForPeople: sum(r => r.stats.stopT),
          slowForPeople: sum(r => r.stats.slowT),
          encounters: hri.encounters,
          nearMisses: hri.nearMisses,
          minSeparation: Number.isFinite(hri.minSeparation) ? hri.minSeparation : null,
          deadlocks,
          yields,
          contacts,
          closePasses: hri.closePasses || 0,
          replans: sum(r => r.stats.replans),
          blockedTime: sum(r => r.stats.blockedT),
          zoneSlowTime: sum(r => r.stats.zoneSlowT),
          doorChanges,
          zonesApplied: zones.length,
        },
        lifts: [...lifts.values()].map(L => ({ id: L.id, name: L.name, virtual: L.virtual, served: L.stats.served, trips: L.stats.trips, meanWait: L.stats.served ? L.stats.waitTotal / L.stats.served : null, maxQueue: L.stats.maxQueue, utilisation: time > 0 ? L.stats.busyT / time : 0, queue: L.requests.length, level: levelName(L.carLevel) })),
        hotspots: hotspots(),
      };
    },
  };

  // Congestion hotspots: wait time in 1 m bins, top six.
  function hotspots() {
    const bins = [];
    heat.forEach((arr, levelId) => {
      const g = nav.levels.get(levelId).grid;
      const per = Math.max(1, Math.round(1 / g.res));
      const map = new Map();
      for (let k = 0; k < arr.length; k++) {
        if (!arr[k]) continue;
        const i = k % g.w, j = (k - i) / g.w;
        const key = `${(i / per) | 0},${(j / per) | 0}`;
        const b = map.get(key) || { wait: 0, x: 0, z: 0 };
        const c = cellCenter(g, k);
        b.wait += arr[k];
        b.x += c[0] * arr[k];
        b.z += c[2] * arr[k];
        map.set(key, b);
      }
      map.forEach(b => bins.push({ levelId, levelName: g.levelName, wait: b.wait, x: b.x / b.wait, z: b.z / b.wait, y: g.floorY }));
    });
    bins.sort((a, b) => b.wait - a.wait);
    return bins.slice(0, 6).map(b => {
      let room = null;
      building.spaces.forEach(s => {
        if (s.levelId !== b.levelId) return;
        if (b.x >= s.bbox.min[0] && b.x <= s.bbox.max[0] && b.z >= s.bbox.min[2] && b.z <= s.bbox.max[2]) room = s.name;
      });
      return { ...b, room };
    });
  }

  return sim;
}

Object.assign(window, { SIM_DEFAULTS, ROBOT_COLORS, ROBOT_COLORS_DARK, createSimulation });
