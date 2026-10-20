(() => {
  const SIM_DEFAULTS = {
    robots: 4,
    tasksPerRobot: 3,
    humans: 4,
    robotSpeed: 0.8,
    // m/s
    humanSpeed: 1.2,
    // m/s
    liftPolicy: "fcfs",
    // 'fcfs' | 'nearest'
    liftCapacity: 1,
    liftSpeed: 1,
    // m/s
    liftDoorTime: 3,
    // s
    stairSpeedFactor: 0.4,
    // legged robots on stairs
    stairsAsLifts: false,
    detectRadius: 2,
    // m
    safetyRadius: 0.8,
    // m
    slowFactor: 0.35,
    deadlockTime: 6,
    // s of waiting before a robot is let through
    maxTime: 3600,
    // s
    seed: 7
  };
  const ROBOT_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
  const ROBOT_COLORS_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = a + 1831565813 >>> 0;
      let t = a;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function createSimulation(ctx, scenario = {}) {
    const sc = { ...SIM_DEFAULTS, ...scenario };
    const robotProfile = sc.robot || DEFAULT_ROBOT_PROFILE;
    const rng = mulberry32(sc.seed);
    const { building } = ctx;
    const nav = applyRobot(ctx.navMap, building, robotProfile, { blocked: sc.blocked, obstacles: sc.obstacles, stairsAsLifts: sc.stairsAsLifts });
    const humanNav = sc.humans > 0 ? applyRobot(ctx.navMap, building, { name: "Person", width: 0.45, height: 1.8, clearance: 0.05, canUseStairs: true, canUseLifts: false }, { blocked: sc.blocked, obstacles: sc.obstacles }) : null;
    const robotRadius = nav.radius;
    const rooms = [];
    building.spaces.forEach((s) => {
      const lv = nav.levels.get(s.levelId);
      if (!lv) return;
      const cell = nearestFreeCell(lv, s.position[0], s.position[2], 2.5);
      if (cell < 0) return;
      const c = cellCenter(lv.grid, cell);
      rooms.push({ id: s.id, name: s.name, levelId: s.levelId, point: c });
    });
    const events = [];
    const snapPlace = (pt, name, id) => {
      const lv = pt && nav.levels.get(pt.levelId);
      if (!lv) return null;
      const cell = nearestFreeCell(lv, pt.x, pt.z, 3);
      return cell < 0 ? null : { id, name, levelId: pt.levelId, point: cellCenter(lv.grid, cell) };
    };
    const missions = (sc.missions || []).slice(0, 8).map((m, i) => ({
      index: i,
      start: snapPlace(m.start, `Mission ${i + 1} start`, `m${i}s`),
      goal: snapPlace(m.goal, `Mission ${i + 1} goal`, `m${i}g`)
    }));
    const levelY = new Map([...nav.levels.values()].map((lv) => [lv.grid.levelId, lv.grid.floorY]));
    const levelName = (id) => nav.levels.get(id) ? nav.levels.get(id).grid.levelName : "\u2014";
    const lifts = /* @__PURE__ */ new Map();
    nav.transitions.filter((t) => t.kind === "lift" && t.usable).forEach((t) => {
      if (!lifts.has(t.verticalId)) {
        const v = building.verticals.get(t.verticalId);
        lifts.set(t.verticalId, {
          id: t.verticalId,
          name: t.virtualLift ? `${v ? v.name : "Stair core"} (as lift)` : v ? v.name : "Lift",
          virtual: !!t.virtualLift,
          shaft: t.shaft,
          landings: /* @__PURE__ */ new Map(),
          levels: [],
          carY: null,
          carLevel: null,
          state: "idle",
          doorTimer: 0,
          target: null,
          riders: [],
          requests: [],
          stats: { trips: 0, served: 0, waitTotal: 0, maxQueue: 0, busyT: 0 }
        });
      }
      const L = lifts.get(t.verticalId);
      L.landings.set(t.a.levelId, cellCenter(nav.levels.get(t.a.levelId).grid, t.a.cell));
      L.landings.set(t.b.levelId, cellCenter(nav.levels.get(t.b.levelId).grid, t.b.cell));
    });
    lifts.forEach((L) => {
      L.levels = [...L.landings.keys()].sort((a, b) => levelY.get(a) - levelY.get(b));
      L.carLevel = L.levels[0];
      L.carY = levelY.get(L.carLevel);
    });
    const heat = /* @__PURE__ */ new Map();
    nav.levels.forEach((lv) => heat.set(lv.grid.levelId, new Float32Array(lv.grid.w * lv.grid.h)));
    const toPlan = (route) => {
      const legs = [];
      route.legs.forEach((l) => {
        const prev = legs[legs.length - 1];
        if (l.type === "lift" && prev && prev.type === "lift" && prev.liftId === l.transition.verticalId) {
          prev.to = l.toLevelId;
          return;
        }
        if (l.type === "walk") legs.push({ type: "walk", levelId: l.levelId, points: l.points.map((p) => p.slice()) });
        else if (l.type === "lift") legs.push({ type: "lift", liftId: l.transition.verticalId, from: l.fromLevelId, to: l.toLevelId });
        else legs.push({ type: "stairs", transition: l.transition, from: l.fromLevelId, to: l.toLevelId });
      });
      return legs.filter((l, i) => !(l.type === "walk" && l.points.length < 2 && i > 0 && i < legs.length - 1));
    };
    const plan = (state, a, b) => planGridRoute(state, { levelId: a.levelId, x: a.point[0], z: a.point[2] }, { levelId: b.levelId, x: b.point[0], z: b.point[2] });
    const log = (kind, text, agent, extra) => {
      events.push({ t: time, kind, text, robotId: agent ? agent.id : null, levelId: agent ? agent.levelId : null, pos: agent ? agent.pos.slice() : null, ...extra });
      if (events.length > 600) events.shift();
    };
    const robots = [];
    const shuffled = rooms.slice().sort(() => rng() - 0.5);
    const fleetSize = missions.length ? missions.length : Math.min(sc.robots, 8);
    for (let i = 0; i < fleetSize; i++) {
      const mission = missions.length ? missions[i] : null;
      const start = mission ? mission.start : shuffled[i % Math.max(1, shuffled.length)];
      if (!start) {
        if (mission) events.push({ t: 0, kind: "unreachable", text: `Mission ${i + 1} starts outside the free floor; it was skipped`, robotId: null, levelId: null, pos: null });
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
        state: "idle",
        waitRun: 0,
        ghost: 0,
        factor: 1,
        tasksLeft: sc.tasksPerRobot,
        mission,
        missionStep: 0,
        task: null,
        lift: null,
        stair: null,
        stats: { dist: 0, moveT: 0, waitT: 0, liftWaitT: 0, rideT: 0, stairT: 0, slowT: 0, stopT: 0, tasks: 0, taskTimes: [], unreachable: 0 }
      });
    }
    const nextTask = (r) => {
      if (r.tasksLeft <= 0) {
        r.state = "done";
        r.doneAt = time;
        r.legs = [];
        log("done", `${r.name} finished its tasks`, r);
        return;
      }
      if (r.mission) {
        const goal = r.missionStep % 2 === 0 ? r.mission.goal : r.mission.start;
        r.missionStep++;
        const route = goal ? plan(nav, { levelId: r.levelId, point: r.pos }, goal) : null;
        if (!route) {
          r.stats.unreachable += r.tasksLeft;
          r.tasksLeft = 0;
          log("unreachable", `${r.name} has no path to ${goal ? goal.name : "its mission goal"}`, r);
          r.state = "done";
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
      log("unreachable", `${r.name} could not reach another room from ${r.room.name}`, r);
      nextTask(r);
    };
    const startLeg = (r) => {
      const leg = r.legs[r.legIdx];
      if (!leg) {
        finishTask(r);
        return;
      }
      if (leg.type === "walk") {
        r.state = "moving";
        r.ptIdx = 0;
      } else if (leg.type === "lift") {
        const L = lifts.get(leg.liftId);
        r.state = "lift-wait";
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
        r.state = "stairs";
        r.stair = { p0, p1, t: 0, dur, to: leg.to };
      }
    };
    const advance = (r) => {
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
        log("task", `${r.name} delivered to ${r.task.to.name} in ${dt.toFixed(0)} s`, r);
        r.task = null;
      }
      nextTask(r);
    };
    const spotInRoom = (room, state) => {
      const s = building.spaces.get(room.id);
      const lv = state.levels.get(room.levelId);
      for (let k = 0; k < 24 && s && lv; k++) {
        const x = s.bbox.min[0] + rng() * (s.bbox.max[0] - s.bbox.min[0]);
        const z = s.bbox.min[2] + rng() * (s.bbox.max[2] - s.bbox.min[2]);
        const idx = cellIndex(lv.grid, x, z);
        if (idx >= 0 && lv.state[idx] === CELL.FREE) return cellCenter(lv.grid, idx);
      }
      return room.point.slice();
    };
    const humans = [];
    if (humanNav) {
      const humanRooms = rooms.filter((rm) => humanNav.levels.has(rm.levelId));
      for (let i = 0; i < sc.humans && humanRooms.length; i++) {
        let start = null, pos = null;
        for (let k = 0; k < 20; k++) {
          start = humanRooms[Math.floor(rng() * humanRooms.length)];
          pos = spotInRoom(start, humanNav);
          if (!robots.some((r) => r.levelId === start.levelId && Math.hypot(r.pos[0] - pos[0], r.pos[2] - pos[2]) < 2)) break;
        }
        humans.push({ id: i + 1, name: `Person ${i + 1}`, levelId: start.levelId, pos, room: start, points: null, ptIdx: 0, pause: rng() * 3, heading: 0, waitRun: 0 });
      }
    }
    const humanNext = (h) => {
      const options = rooms.filter((rm) => rm.levelId === h.levelId && rm.id !== h.room.id);
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
    let time = 0;
    const hri = { encounters: 0, nearMisses: 0, minSeparation: Infinity, pairs: /* @__PURE__ */ new Map() };
    let deadlocks = 0;
    robots.forEach((r) => nextTask(r));
    const openDoors = (L) => {
      L.state = "doors";
      L.doorTimer = sc.liftDoorTime;
      L.riders = L.riders.filter((rr) => {
        if (rr.to !== L.carLevel) return true;
        const r = rr.robot;
        r.levelId = L.carLevel;
        r.pos = L.landings.get(L.carLevel).slice();
        L.stats.served++;
        advance(r);
        return false;
      });
      const boarding = L.requests.filter((q) => q.from === L.carLevel);
      for (const q of boarding) {
        if (L.riders.length >= sc.liftCapacity) break;
        L.requests.splice(L.requests.indexOf(q), 1);
        L.riders.push(q);
        L.stats.waitTotal += time - q.t;
        q.robot.state = "riding";
        log("lift", `${q.robot.name} boarded ${L.name} at ${levelName(L.carLevel)}`, q.robot);
      }
    };
    const liftTick = (L, dt) => {
      if (L.state === "doors") {
        L.doorTimer -= dt;
        L.stats.busyT += dt;
        if (L.doorTimer > 0) return;
        L.state = "idle";
      }
      if (L.state === "idle") {
        let dest = null;
        if (L.riders.length) {
          dest = sc.liftPolicy === "nearest" ? L.riders.reduce((best, q) => best == null || Math.abs(levelY.get(q.to) - L.carY) < Math.abs(levelY.get(best) - L.carY) ? q.to : best, null) : L.riders[0].to;
        } else if (L.requests.length) {
          dest = sc.liftPolicy === "nearest" ? L.requests.reduce((best, q) => best == null || Math.abs(levelY.get(q.from) - L.carY) < Math.abs(levelY.get(best) - L.carY) ? q.from : best, null) : L.requests[0].from;
        }
        if (dest == null) return;
        if (dest === L.carLevel) {
          openDoors(L);
          return;
        }
        L.state = "moving";
        L.target = dest;
        L.stats.trips++;
      }
      if (L.state === "moving") {
        L.stats.busyT += dt;
        const ty = levelY.get(L.target);
        const dir = Math.sign(ty - L.carY);
        let ny = L.carY + dir * sc.liftSpeed * dt;
        if (sc.liftPolicy === "nearest" && L.riders.length < sc.liftCapacity) {
          for (const lvl of L.levels) {
            const y = levelY.get(lvl);
            const passing = dir > 0 ? y > L.carY + 1e-3 && y <= ny : y < L.carY - 1e-3 && y >= ny;
            if (passing && L.requests.some((q) => q.from === lvl)) {
              L.target = lvl;
              ny = y;
              break;
            }
          }
        }
        const arrived = dir >= 0 ? ny >= levelY.get(L.target) : ny <= levelY.get(L.target);
        L.carY = arrived ? levelY.get(L.target) : ny;
        L.riders.forEach((q) => {
          q.robot.pos = [L.shaft[0], L.carY, L.shaft[1]];
        });
        if (arrived) {
          L.carLevel = L.target;
          openDoors(L);
        }
      }
    };
    const conflictWith = (r, nx, nz) => {
      const minD = robotRadius * 2;
      for (const o of robots) {
        if (o === r || o.levelId !== r.levelId || o.state === "riding" || o.state === "stairs" || o.state === "done") continue;
        const d0 = Math.hypot(o.pos[0] - r.pos[0], o.pos[2] - r.pos[2]);
        const d1 = Math.hypot(o.pos[0] - nx, o.pos[2] - nz);
        if (d1 < minD && d1 < d0) return o;
      }
      return null;
    };
    const detour = (r) => {
      const leg = r.legs[r.legIdx];
      if (!leg || leg.type !== "walk") return false;
      const end = leg.points[leg.points.length - 1];
      const others = robots.filter((o) => o !== r && o.levelId === r.levelId && o.state !== "riding" && o.state !== "done" && o.state !== "stairs");
      if (!others.length) return false;
      const lv = nav.levels.get(r.levelId);
      const avoid = robotRadius * 2.2;
      const route = planGridRoute(nav, { levelId: r.levelId, x: r.pos[0], z: r.pos[2] }, { levelId: r.levelId, x: end[0], z: end[2] }, {
        maxExpand: 6e4,
        extraCost: (levelId, cell) => {
          if (levelId !== r.levelId) return 0;
          const c = cellCenter(lv.grid, cell);
          for (const o of others) if (Math.hypot(c[0] - o.pos[0], c[2] - o.pos[2]) < avoid) return 50;
          return 0;
        }
      });
      if (!route || route.legs.length !== 1) return false;
      leg.points = route.legs[0].points.map((q) => q.slice());
      r.ptIdx = 0;
      return true;
    };
    const humanEffect = (r) => {
      let factor = 1;
      const careful = r.careful > 0;
      const stopRadius = r.squeeze > 0 ? 0 : careful ? 0.45 : sc.safetyRadius;
      for (const h of humans) {
        if (h.levelId !== r.levelId) continue;
        const d = Math.hypot(h.pos[0] - r.pos[0], h.pos[2] - r.pos[2]);
        hri.minSeparation = Math.min(hri.minSeparation, d);
        const key = `${r.id}:${h.id}`;
        const pair = hri.pairs.get(key) || { detect: false, near: false };
        if (d < sc.detectRadius && !pair.detect) {
          pair.detect = true;
          hri.encounters++;
        }
        if (d > sc.detectRadius * 1.25) pair.detect = false;
        if (d < sc.safetyRadius && !pair.near) {
          pair.near = true;
          hri.nearMisses++;
          log("near-miss", `${r.name} stopped for ${h.name} at ${d.toFixed(2)} m`, r);
        }
        if (d > sc.safetyRadius * 1.5) pair.near = false;
        hri.pairs.set(key, pair);
        if (d < stopRadius) factor = 0;
        else if (d < sc.detectRadius) factor = Math.min(factor, r.squeeze > 0 ? 0.1 : careful ? 0.2 : sc.slowFactor);
      }
      return factor;
    };
    const sidestep = (r) => {
      let near = null, nd = Infinity;
      humans.forEach((h) => {
        if (h.levelId !== r.levelId) return;
        const d = Math.hypot(h.pos[0] - r.pos[0], h.pos[2] - r.pos[2]);
        if (d < nd) {
          nd = d;
          near = h;
        }
      });
      if (!near || !humanNav) return;
      const lv = humanNav.levels.get(near.levelId);
      const base = r.heading + Math.PI / 2;
      for (const dist of [0.7, 1.1, 1.6]) {
        for (const turn of [0, Math.PI, Math.PI / 4, -Math.PI / 4, 3 * Math.PI / 4, -3 * Math.PI / 4, Math.PI / 2, -Math.PI / 2]) {
          const a = base + turn;
          const x = near.pos[0] + Math.cos(a) * dist, z = near.pos[2] + Math.sin(a) * dist;
          const idx = lv ? cellIndex(lv.grid, x, z) : -1;
          if (idx >= 0 && lv.state[idx] === CELL.FREE && Math.hypot(x - r.pos[0], z - r.pos[2]) > sc.safetyRadius) {
            near.pos[0] = x;
            near.pos[2] = z;
            near.points = null;
            near.pause = 2;
            log("hri-yield", `${near.name} stepped aside for ${r.name}`, r);
            return;
          }
        }
      }
      r.squeeze = 4;
      hri.closePasses = (hri.closePasses || 0) + 1;
      log("close-pass", `${r.name} squeezed past ${near.name} in a tight space`, r);
    };
    const robotTick = (r, dt) => {
      switch (r.state) {
        case "done":
        case "idle":
          return;
        case "lift-wait":
          r.stats.liftWaitT += dt;
          return;
        case "riding":
          r.stats.rideT += dt;
          return;
        case "stairs": {
          const s = r.stair;
          s.t += dt;
          r.stats.stairT += dt;
          const k = Math.min(1, s.t / s.dur);
          r.pos = [s.p0[0] + (s.p1[0] - s.p0[0]) * k, s.p0[1] + (s.p1[1] - s.p0[1]) * k, s.p0[2] + (s.p1[2] - s.p0[2]) * k];
          if (k >= 1) {
            r.levelId = s.to;
            r.stair = null;
            advance(r);
          }
          return;
        }
        default:
          break;
      }
      const leg = r.legs[r.legIdx];
      let target = leg.points[r.ptIdx];
      let dx = target[0] - r.pos[0], dz = target[2] - r.pos[2];
      let d = Math.hypot(dx, dz);
      while (d < 0.03) {
        r.ptIdx++;
        if (r.ptIdx >= leg.points.length) {
          advance(r);
          return;
        }
        target = leg.points[r.ptIdx];
        dx = target[0] - r.pos[0];
        dz = target[2] - r.pos[2];
        d = Math.hypot(dx, dz);
      }
      const ux = dx / d, uz = dz / d;
      r.heading = Math.atan2(uz, ux);
      const factor = humanEffect(r);
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
              log("hri-pass", `${r.name} edged past a person after waiting 3 s`, r);
            }
          }
          if (r.stopRun > 8) {
            r.stopRun = 0;
            sidestep(r);
          }
        } else {
          r.stats.waitT += dt;
          const lv = nav.levels.get(r.levelId);
          const idx = lv ? cellIndex(lv.grid, r.pos[0], r.pos[2]) : -1;
          if (idx >= 0) heat.get(r.levelId)[idx] += dt;
          if (r.waitRun > 1.5 && !r.triedDetour && (blocker.state !== "moving" || r.id < blocker.id)) {
            r.triedDetour = true;
            if (detour(r)) {
              r.waitRun = 0;
              log("detour", `${r.name} re-planned around ${blocker.name}`, r);
            }
          }
          if (r.waitRun > sc.deadlockTime) {
            deadlocks++;
            r.triedDetour = false;
            r.ghost = 2.5;
            r.waitRun = 0;
            log("deadlock", `${r.name} and ${blocker.name} blocked each other; ${r.name} was let through`, r);
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
      if (h.pause > 0) {
        h.pause -= dt;
        if (h.pause <= 0) humanNext(h);
        return;
      }
      if (!h.points) {
        humanNext(h);
        return;
      }
      const target = h.points[h.ptIdx];
      const dx = target[0] - h.pos[0], dz = target[2] - h.pos[2];
      const d = Math.hypot(dx, dz);
      if (d < 0.05) {
        h.ptIdx++;
        if (h.ptIdx >= h.points.length) {
          h.points = null;
          h.pause = 2 + rng() * 4;
        }
        return;
      }
      const ux = dx / d, uz = dz / d;
      const inFront = robots.some((r) => {
        if (r.levelId !== h.levelId || r.state === "riding" || r.state === "done") return false;
        const rx = r.pos[0] - h.pos[0], rz = r.pos[2] - h.pos[2];
        const ahead = rx * ux + rz * uz;
        return ahead > 0 && ahead < sc.safetyRadius + 0.2 && Math.abs(rx * uz - rz * ux) < robotRadius + 0.3;
      });
      if (inFront) {
        h.waitRun += dt;
        if (h.waitRun > 4) {
          h.waitRun = 0;
          humanNext(h);
        }
        return;
      }
      h.waitRun = 0;
      const step = Math.min(d, sc.humanSpeed * dt);
      h.heading = Math.atan2(dz, dx);
      h.pos[0] += dx / d * step;
      h.pos[2] += dz / d * step;
    };
    const tick = (dt) => {
      time += dt;
      humans.forEach((h) => humanTick(h, dt));
      lifts.forEach((L) => liftTick(L, dt));
      robots.forEach((r) => robotTick(r, dt));
      if (robots.every((r) => r.state === "done") || time >= sc.maxTime) sim.done = true;
    };
    const sim = {
      scenario: sc,
      nav,
      robots,
      humans,
      lifts,
      heat,
      events,
      rooms,
      done: robots.length === 0,
      get time() {
        return time;
      },
      step(dt) {
        let remaining = dt;
        while (remaining > 1e-6 && !sim.done) {
          const h = Math.min(0.1, remaining);
          tick(h);
          remaining -= h;
        }
      },
      runToEnd(maxSteps = 2e5) {
        let n = 0;
        while (!sim.done && n++ < maxSteps) tick(0.1);
      },
      summary() {
        const allTimes = robots.flatMap((r) => r.stats.taskTimes);
        const tasksDone = allTimes.length;
        const planned = robots.length * sc.tasksPerRobot;
        const sum = (f) => robots.reduce((a, r) => a + f(r), 0);
        return {
          time,
          done: sim.done,
          timedOut: time >= sc.maxTime,
          robots: robots.map((r) => ({ id: r.id, name: r.name, color: r.color, colorIndex: r.colorIndex, state: r.state, levelName: levelName(r.levelId), leg: r.legs[r.legIdx] ? r.legs[r.legIdx].type : null, tasksLeft: r.tasksLeft, ...r.stats, taskTimes: void 0, meanTask: r.stats.taskTimes.length ? r.stats.taskTimes.reduce((a, b) => a + b, 0) / r.stats.taskTimes.length : null })),
          totals: {
            tasksDone,
            tasksPlanned: planned,
            unreachable: sum((r) => r.stats.unreachable),
            makespan: sim.done ? Math.max(0, ...robots.map((r) => r.doneAt || 0)) : time,
            throughputPerHour: time > 0 ? tasksDone / time * 3600 : 0,
            meanTaskTime: tasksDone ? allTimes.reduce((a, b) => a + b, 0) / tasksDone : null,
            distance: sum((r) => r.stats.dist),
            congestionWait: sum((r) => r.stats.waitT),
            liftWait: sum((r) => r.stats.liftWaitT),
            stopForPeople: sum((r) => r.stats.stopT),
            slowForPeople: sum((r) => r.stats.slowT),
            encounters: hri.encounters,
            nearMisses: hri.nearMisses,
            minSeparation: Number.isFinite(hri.minSeparation) ? hri.minSeparation : null,
            deadlocks,
            closePasses: hri.closePasses || 0
          },
          lifts: [...lifts.values()].map((L) => ({ id: L.id, name: L.name, virtual: L.virtual, served: L.stats.served, trips: L.stats.trips, meanWait: L.stats.served ? L.stats.waitTotal / L.stats.served : null, maxQueue: L.stats.maxQueue, utilisation: time > 0 ? L.stats.busyT / time : 0, queue: L.requests.length, level: levelName(L.carLevel) })),
          hotspots: hotspots()
        };
      }
    };
    function hotspots() {
      const bins = [];
      heat.forEach((arr, levelId) => {
        const g = nav.levels.get(levelId).grid;
        const per = Math.max(1, Math.round(1 / g.res));
        const map = /* @__PURE__ */ new Map();
        for (let k = 0; k < arr.length; k++) {
          if (!arr[k]) continue;
          const i = k % g.w, j = (k - i) / g.w;
          const key = `${i / per | 0},${j / per | 0}`;
          const b = map.get(key) || { wait: 0, x: 0, z: 0 };
          const c = cellCenter(g, k);
          b.wait += arr[k];
          b.x += c[0] * arr[k];
          b.z += c[2] * arr[k];
          map.set(key, b);
        }
        map.forEach((b) => bins.push({ levelId, levelName: g.levelName, wait: b.wait, x: b.x / b.wait, z: b.z / b.wait, y: g.floorY }));
      });
      bins.sort((a, b) => b.wait - a.wait);
      return bins.slice(0, 6).map((b) => {
        let room = null;
        building.spaces.forEach((s) => {
          if (s.levelId !== b.levelId) return;
          if (b.x >= s.bbox.min[0] && b.x <= s.bbox.max[0] && b.z >= s.bbox.min[2] && b.z <= s.bbox.max[2]) room = s.name;
        });
        return { ...b, room };
      });
    }
    return sim;
  }
  Object.assign(window, { SIM_DEFAULTS, ROBOT_COLORS, ROBOT_COLORS_DARK, createSimulation });
})();
