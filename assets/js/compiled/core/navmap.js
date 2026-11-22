(() => {
  const GRID_STEPS = {
    G1: "G1 \xB7 Floor extraction",
    G2: "G2 \xB7 Obstacle rasterisation",
    G3: "G3 \xB7 Door carving",
    G4: "G4 \xB7 Robot inflation",
    G5: "G5 \xB7 What-if obstacles",
    G6: "G6 \xB7 Path search"
  };
  const CELL = { VOID: 0, FREE: 1, OBSTACLE: 2, INFLATED: 3, DOOR: 4, USER: 5, BLOCKED: 6, ZONE: 7 };
  const CELL_LABEL = ["No floor", "Free", "Obstacle", "Too close to an obstacle", "Door opening", "What-if obstacle", "Blocked door", "No-go zone"];
  const CELL_STATES = CELL_LABEL.length;
  const BAND_LOW = 0.1;
  const BAND_HIGH = 2.2;
  const FLOOR_TOL = 0.35;
  function makeGrid(level, bounds, res) {
    const w = Math.max(1, Math.ceil((bounds.max[0] - bounds.min[0]) / res));
    const h = Math.max(1, Math.ceil((bounds.max[2] - bounds.min[2]) / res));
    const n = w * h;
    return {
      levelId: level.id,
      levelName: level.name,
      floorY: level.floorY,
      x0: bounds.min[0],
      z0: bounds.min[2],
      res,
      w,
      h,
      floor: new Uint8Array(n),
      floorSrc: new Int32Array(n).fill(-1),
      obsLow: new Float32Array(n).fill(Infinity),
      obsHigh: new Float32Array(n).fill(-Infinity),
      obsSrc: new Int32Array(n).fill(-1),
      door: new Int32Array(n).fill(-1)
    };
  }
  function cellIndex(g, x, z) {
    const i = Math.floor((x - g.x0) / g.res);
    const j = Math.floor((z - g.z0) / g.res);
    if (i < 0 || j < 0 || i >= g.w || j >= g.h) return -1;
    return j * g.w + i;
  }
  function cellCenter(g, idx) {
    const i = idx % g.w;
    const j = (idx - i) / g.w;
    return [g.x0 + (i + 0.5) * g.res, g.floorY, g.z0 + (j + 0.5) * g.res];
  }
  function rasterTriangle(g, ax, az, bx, bz, cx, cz, visit) {
    const res = g.res;
    const minI = Math.max(0, Math.floor((Math.min(ax, bx, cx) - g.x0) / res));
    const maxI = Math.min(g.w - 1, Math.floor((Math.max(ax, bx, cx) - g.x0) / res));
    const minJ = Math.max(0, Math.floor((Math.min(az, bz, cz) - g.z0) / res));
    const maxJ = Math.min(g.h - 1, Math.floor((Math.max(az, bz, cz) - g.z0) / res));
    if (minI > maxI || minJ > maxJ) return;
    const area = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    if (Math.abs(area) > 1e-9) {
      for (let j = minJ; j <= maxJ; j++) {
        const pz = g.z0 + (j + 0.5) * res;
        for (let i = minI; i <= maxI; i++) {
          const px = g.x0 + (i + 0.5) * res;
          const w0 = (bx - ax) * (pz - az) - (bz - az) * (px - ax);
          const w1 = (cx - bx) * (pz - bz) - (cz - bz) * (px - bx);
          const w2 = (ax - cx) * (pz - cz) - (az - cz) * (px - cx);
          if (w0 >= 0 && w1 >= 0 && w2 >= 0 || w0 <= 0 && w1 <= 0 && w2 <= 0) visit(j * g.w + i);
        }
      }
    }
    rasterSegment(g, ax, az, bx, bz, visit);
    rasterSegment(g, bx, bz, cx, cz, visit);
    rasterSegment(g, cx, cz, ax, az, visit);
  }
  function rasterSegment(g, x1, z1, x2, z2, visit) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const steps = Math.max(1, Math.ceil(len / (g.res * 0.5)));
    let last = -2;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const idx = cellIndex(g, x1 + (x2 - x1) * t, z1 + (z2 - z1) * t);
      if (idx >= 0 && idx !== last) {
        visit(idx);
        last = idx;
      }
    }
  }
  function clipTriangleY(p, lo, hi) {
    let poly = [[p[0], p[1], p[2]], [p[3], p[4], p[5]], [p[6], p[7], p[8]]];
    const clip = (keepAbove, yv) => {
      const out = [];
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k];
        const b = poly[(k + 1) % poly.length];
        const ina = keepAbove ? a[1] >= yv : a[1] <= yv;
        const inb = keepAbove ? b[1] >= yv : b[1] <= yv;
        if (ina) out.push(a);
        if (ina !== inb) {
          const t = (yv - a[1]) / (b[1] - a[1]);
          out.push([a[0] + (b[0] - a[0]) * t, yv, a[2] + (b[2] - a[2]) * t]);
        }
      }
      poly = out;
    };
    clip(true, lo);
    if (poly.length < 3) return poly.length ? poly : null;
    clip(false, hi);
    return poly.length ? poly : null;
  }
  function navRoleForGrid(el) {
    const role = navRoleOf(el);
    if (["portal", "region", "walkable", "void", "container"].includes(role)) return null;
    if (role === "none" && !el.geometry) return null;
    if (/^Ifc(VirtualElement|Opening|Annotation)/.test(el.ifcClass)) return null;
    return role;
  }
  function buildNavMap(model, building, opts = {}) {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const levels = building.levels.filter((l) => l.floorY != null);
    const geoEls = model.elements.filter((e) => !e.isType && e.geometry && e.bbox);
    const grids = [];
    const warnings = [];
    let span = 0;
    levels.forEach((l) => {
      const b = levelBounds(l, geoEls, building);
      if (b) span = Math.max(span, b.max[0] - b.min[0], b.max[2] - b.min[2]);
    });
    const res = opts.resolution || Math.max(0.1, Math.ceil(span / 700 * 100) / 100);
    levels.forEach((level) => {
      const bounds = levelBounds(level, geoEls, building);
      if (!bounds) return;
      const g = makeGrid(level, bounds, res);
      const fy = level.floorY;
      let floorCells = 0;
      geoEls.forEach((el) => {
        const role = navRoleOf(el);
        const isRoom = el.ifcClass === "IfcSpace";
        if (role !== "walkable" && !isRoom) return;
        if (el.bbox.min[1] > fy + FLOOR_TOL || el.bbox.max[1] < fy - FLOOR_TOL) return;
        forEachTriangle(el, (p) => {
          const ny = triNormalY(p);
          if (Math.abs(ny) < 0.7) return;
          const yAvg = (p[1] + p[4] + p[7]) / 3;
          if (Math.abs(yAvg - fy) > FLOOR_TOL) return;
          rasterTriangle(g, p[0], p[2], p[3], p[5], p[6], p[8], (idx) => {
            if (!g.floor[idx]) floorCells++;
            g.floor[idx] = 1;
            if (g.floorSrc[idx] < 0 || !isRoom) g.floorSrc[idx] = el.expressId;
          });
        });
      });
      g.floorFallback = floorCells === 0;
      if (g.floorFallback) {
        if (!level.spaceIds.length && !level.doorIds.length) {
          warnings.push(`${level.name}: no walkable faces, rooms or doors, so it is left out of the map.`);
          return;
        }
        g.floor.fill(1);
        warnings.push(`${level.name}: no walkable faces found, so the whole level footprint is treated as floor.`);
      }
      const lo = fy + BAND_LOW;
      const hi = fy + BAND_HIGH;
      geoEls.forEach((el) => {
        if (!navRoleForGrid(el)) return;
        if (el.bbox.min[1] > hi || el.bbox.max[1] < lo) return;
        if (el.bbox.max[0] < g.x0 || el.bbox.min[0] > g.x0 + g.w * res || el.bbox.max[2] < g.z0 || el.bbox.min[2] > g.z0 + g.h * res) return;
        forEachTriangle(el, (p) => {
          const poly = clipTriangleY(p, lo, hi);
          if (!poly) return;
          let low = Infinity, high = -Infinity;
          poly.forEach((v) => {
            if (v[1] < low) low = v[1];
            if (v[1] > high) high = v[1];
          });
          const height = low - fy;
          const top = high - fy;
          const mark = (idx) => {
            if (height < g.obsLow[idx]) {
              g.obsLow[idx] = height;
              g.obsSrc[idx] = el.expressId;
            }
            if (top > g.obsHigh[idx]) g.obsHigh[idx] = top;
          };
          if (poly.length === 1) {
            const idx = cellIndex(g, poly[0][0], poly[0][2]);
            if (idx >= 0) mark(idx);
            return;
          }
          if (poly.length === 2) {
            rasterSegment(g, poly[0][0], poly[0][2], poly[1][0], poly[1][2], mark);
            return;
          }
          for (let k = 1; k + 1 < poly.length; k++) {
            rasterTriangle(g, poly[0][0], poly[0][2], poly[k][0], poly[k][2], poly[k + 1][0], poly[k + 1][2], mark);
          }
        });
      });
      level.doorIds.forEach((did) => {
        const d = building.doors.get(did);
        if (!d) return;
        const b = d.bbox;
        const i0 = Math.max(0, Math.floor((b.min[0] - g.x0) / res)), i1 = Math.min(g.w - 1, Math.floor((b.max[0] - g.x0) / res));
        const j0 = Math.max(0, Math.floor((b.min[2] - g.z0) / res)), j1 = Math.min(g.h - 1, Math.floor((b.max[2] - g.z0) / res));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const idx = j * g.w + i;
          g.door[idx] = did;
          g.floor[idx] = 1;
          if (g.floorSrc[idx] < 0) g.floorSrc[idx] = did;
        }
      });
      grids.push(g);
    });
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    return { model, res, grids, byLevel: new Map(grids.map((g) => [g.levelId, g])), warnings, buildMs: t1 - t0, cells: grids.reduce((a, g) => a + g.w * g.h, 0) };
  }
  function levelBounds(level, geoEls, building) {
    const min = [Infinity, 0, Infinity];
    const max = [-Infinity, 0, -Infinity];
    const fy = level.floorY;
    let n = 0;
    geoEls.forEach((el) => {
      const onLevel = el.storey && el.storey.expressId === level.storeyId;
      const crosses = el.bbox.min[1] <= fy + BAND_HIGH && el.bbox.max[1] >= fy - FLOOR_TOL;
      if (!onLevel && !(crosses && (navRoleOf(el) === "walkable" || el.ifcClass === "IfcSpace"))) return;
      if (!crosses) return;
      min[0] = Math.min(min[0], el.bbox.min[0]);
      min[2] = Math.min(min[2], el.bbox.min[2]);
      max[0] = Math.max(max[0], el.bbox.max[0]);
      max[2] = Math.max(max[2], el.bbox.max[2]);
      n++;
    });
    if (!n) return null;
    const pad = 0.5;
    return { min: [min[0] - pad, 0, min[2] - pad], max: [max[0] + pad, 0, max[2] + pad] };
  }
  function forEachTriangle(el, fn) {
    const p = el.geometry.positions;
    const idx = el.geometry.indices;
    const tri = new Float32Array(9);
    for (let k = 0; k < idx.length; k += 3) {
      for (let v = 0; v < 3; v++) {
        const o = idx[k + v] * 3;
        tri[v * 3] = p[o];
        tri[v * 3 + 1] = p[o + 1];
        tri[v * 3 + 2] = p[o + 2];
      }
      fn(tri);
    }
  }
  function triNormalY(p) {
    const ux = p[3] - p[0], uy = p[4] - p[1], uz = p[5] - p[2];
    const vx = p[6] - p[0], vy = p[7] - p[1], vz = p[8] - p[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    return len ? ny / len : 0;
  }
  function applyRobot(navMap, building, robot, opts = {}) {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const radius = robot.width / 2 + robot.clearance;
    const blocked = opts.blocked || /* @__PURE__ */ new Set();
    const userObstacles = opts.obstacles || [];
    const zones = opts.zones || [];
    const levels = /* @__PURE__ */ new Map();
    navMap.grids.forEach((g) => {
      const n = g.w * g.h;
      const state2 = new Uint8Array(n);
      const cause = new Int32Array(n).fill(-1);
      const dist = new Float32Array(n).fill(Infinity);
      const near = new Int32Array(n).fill(-1);
      const hard = new Uint8Array(n);
      for (let k = 0; k < n; k++) {
        if (g.door[k] >= 0) {
          if (blocked.has(g.door[k])) {
            state2[k] = CELL.BLOCKED;
            cause[k] = g.door[k];
            hard[k] = 1;
          } else {
            state2[k] = CELL.DOOR;
            cause[k] = g.door[k];
          }
        } else if (!g.floor[k]) {
          state2[k] = CELL.VOID;
          hard[k] = 1;
        } else if (g.obsLow[k] < robot.height) {
          state2[k] = CELL.OBSTACLE;
          cause[k] = g.obsSrc[k];
          hard[k] = 1;
        } else {
          state2[k] = CELL.FREE;
          cause[k] = g.floorSrc[k];
        }
      }
      userObstacles.filter((o) => o.levelId === g.levelId).forEach((o) => {
        const half = o.size / 2;
        for (let z = o.z - half; z <= o.z + half; z += g.res * 0.5) {
          for (let x = o.x - half; x <= o.x + half; x += g.res * 0.5) {
            const idx = cellIndex(g, x, z);
            if (idx >= 0) {
              state2[idx] = CELL.USER;
              cause[idx] = -2;
              hard[idx] = 1;
            }
          }
        }
      });
      let slow = null;
      zones.filter((z) => z.levelId === g.levelId).forEach((z) => {
        forEachZoneCell(g, z, (idx) => {
          if (z.kind === "nogo") {
            if (state2[idx] === CELL.VOID) return;
            state2[idx] = CELL.ZONE;
            cause[idx] = -3;
            hard[idx] = 1;
          } else {
            if (!slow) slow = new Float32Array(n).fill(1);
            slow[idx] = Math.min(slow[idx], Math.max(0.05, Math.min(1, z.factor || 0.5)));
          }
        });
      });
      for (let k = 0; k < n; k++) if (hard[k]) {
        near[k] = k;
        dist[k] = 0;
      }
      const w = g.w, h = g.h, res = g.res;
      const relax = (k, nk) => {
        const src = near[nk];
        if (src < 0) return;
        const dx = k % w - src % w;
        const dz = (k / w | 0) - (src / w | 0);
        const d = Math.sqrt(dx * dx + dz * dz) * res;
        if (d < dist[k]) {
          dist[k] = d;
          near[k] = src;
        }
      };
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const k = j * w + i;
        if (i > 0) relax(k, k - 1);
        if (j > 0) {
          relax(k, k - w);
          if (i > 0) relax(k, k - w - 1);
          if (i < w - 1) relax(k, k - w + 1);
        }
      }
      for (let j = h - 1; j >= 0; j--) for (let i = w - 1; i >= 0; i--) {
        const k = j * w + i;
        if (i < w - 1) relax(k, k + 1);
        if (j < h - 1) {
          relax(k, k + w);
          if (i < w - 1) relax(k, k + w + 1);
          if (i > 0) relax(k, k + w - 1);
        }
      }
      for (let k = 0; k < n; k++) {
        if (hard[k] || near[k] < 0) continue;
        if (dist[k] - res * 0.5 < radius) {
          state2[k] = CELL.INFLATED;
          cause[k] = near[k];
        }
      }
      let free = 0;
      for (let k = 0; k < n; k++) if (state2[k] === CELL.FREE || state2[k] === CELL.DOOR) free++;
      levels.set(g.levelId, { grid: g, state: state2, cause, dist, near, slow, freeCells: free });
    });
    const state = { navMap, building, robot, radius, levels, blocked, obstacles: userObstacles, zones, stairsAsLifts: !!opts.stairsAsLifts };
    state.transitions = buildTransitions(state);
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    state.buildMs = t1 - t0;
    return state;
  }
  function passable(st) {
    return st === CELL.FREE || st === CELL.DOOR;
  }
  function forEachZoneCell(g, z, visit) {
    const xa = Math.min(z.x0, z.x1), xb = Math.max(z.x0, z.x1);
    const za = Math.min(z.z0, z.z1), zb = Math.max(z.z0, z.z1);
    const i0 = Math.max(0, Math.ceil((xa - g.x0) / g.res - 0.5)), i1 = Math.min(g.w - 1, Math.floor((xb - g.x0) / g.res - 0.5));
    const j0 = Math.max(0, Math.ceil((za - g.z0) / g.res - 0.5)), j1 = Math.min(g.h - 1, Math.floor((zb - g.z0) / g.res - 0.5));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) visit(j * g.w + i);
  }
  function slowFactorAt(lv, idx) {
    return lv.slow && idx >= 0 ? lv.slow[idx] : 1;
  }
  function nearestFreeCell(lv, x, z, maxDist = 3) {
    const g = lv.grid;
    let start = cellIndex(g, x, z);
    if (start < 0) {
      const i = Math.min(g.w - 1, Math.max(0, Math.floor((x - g.x0) / g.res)));
      const j = Math.min(g.h - 1, Math.max(0, Math.floor((z - g.z0) / g.res)));
      start = j * g.w + i;
    }
    if (passable(lv.state[start])) return start;
    const maxR = Math.ceil(maxDist / g.res);
    const si = start % g.w, sj = start / g.w | 0;
    for (let r = 1; r <= maxR; r++) {
      let best = -1, bestD = Infinity;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = si + di, j = sj + dj;
        if (i < 0 || j < 0 || i >= g.w || j >= g.h) continue;
        const k = j * g.w + i;
        if (!passable(lv.state[k])) continue;
        const d = di * di + dj * dj;
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }
  function buildTransitions(state) {
    const { building, robot, levels } = state;
    const out = [];
    const asLift = state.stairsAsLifts;
    building.verticals.forEach((v) => {
      const kind = asLift && v.kind === "stair" ? "lift" : v.kind;
      const usable = kind === "lift" && robot.canUseLifts || (kind === "stair" || kind === "escalator") && robot.canUseStairs || kind === "ramp" || kind === "walkway";
      const served = v.levelIds.map((id) => building.levels.find((l) => l.id === id)).filter((l) => l && levels.has(l.id)).sort((a, b) => a.floorY - b.floorY);
      for (let k = 0; k + 1 < served.length; k++) {
        const lower = served[k], upper = served[k + 1];
        const pts = landingPoints(v, lower, upper, kind, state);
        const a = nearestFreeCell(levels.get(lower.id), pts.lower[0], pts.lower[1], 4);
        const b = nearestFreeCell(levels.get(upper.id), pts.upper[0], pts.upper[1], 4);
        if (a < 0 || b < 0) continue;
        const dy = upper.floorY - lower.floorY;
        out.push({
          id: `${v.id}:${lower.id}-${upper.id}`,
          verticalId: v.id,
          kind,
          virtualLift: asLift && v.kind === "stair",
          usable,
          blocked: state.blocked.has(v.id),
          a: { levelId: lower.id, cell: a },
          b: { levelId: upper.id, cell: b },
          shaft: [(v.bbox.min[0] + v.bbox.max[0]) / 2, (v.bbox.min[2] + v.bbox.max[2]) / 2],
          cost: kind === "lift" ? dy + 8 : dy * 1.8,
          dy
        });
      }
    });
    return out;
  }
  function landingPoints(v, lower, upper, kind, state) {
    const c = [(v.bbox.min[0] + v.bbox.max[0]) / 2, (v.bbox.min[2] + v.bbox.max[2]) / 2];
    if (kind === "lift") return { lower: c, upper: c };
    const model = state.navMap.model;
    let low = null, high = null;
    if (model) {
      const ptsLow = [], ptsHigh = [];
      v.memberIds.forEach((id) => {
        const el = model.byId.get(id);
        if (!el || !el.geometry) return;
        const p = el.geometry.positions;
        for (let k = 0; k < p.length; k += 3) {
          if (p[k + 1] < lower.floorY + 0.35) ptsLow.push([p[k], p[k + 2]]);
          if (p[k + 1] > upper.floorY - 0.35) ptsHigh.push([p[k], p[k + 2]]);
        }
      });
      const avg = (arr) => arr.length ? [arr.reduce((a, q) => a + q[0], 0) / arr.length, arr.reduce((a, q) => a + q[1], 0) / arr.length] : null;
      low = avg(ptsLow);
      high = avg(ptsHigh);
    }
    return { lower: low || c, upper: high || c };
  }
  class MinHeap {
    constructor() {
      this.k = [];
      this.v = [];
    }
    get size() {
      return this.k.length;
    }
    push(key, val) {
      const k = this.k, v = this.v;
      let i = k.length;
      k.push(key);
      v.push(val);
      while (i > 0) {
        const p = i - 1 >> 1;
        if (k[p] <= key) break;
        k[i] = k[p];
        v[i] = v[p];
        i = p;
      }
      k[i] = key;
      v[i] = val;
    }
    pop() {
      const k = this.k, v = this.v;
      const top = v[0];
      const lk = k.pop(), lv = v.pop();
      if (k.length) {
        let i = 0;
        const n = k.length;
        while (true) {
          let c = 2 * i + 1;
          if (c >= n) break;
          if (c + 1 < n && k[c + 1] < k[c]) c++;
          if (k[c] >= lk) break;
          k[i] = k[c];
          v[i] = v[c];
          i = c;
        }
        k[i] = lk;
        v[i] = lv;
      }
      return top;
    }
  }
  function planGridRoute(state, from, to, opts = {}) {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const lvFrom = state.levels.get(from.levelId);
    const lvTo = state.levels.get(to.levelId);
    if (!lvFrom || !lvTo) return null;
    const s = nearestFreeCell(lvFrom, from.x, from.z, opts.snap || 3);
    const t = nearestFreeCell(lvTo, to.x, to.z, opts.snap || 3);
    if (s < 0 || t < 0) return null;
    const levelList = [...state.levels.values()];
    const offset = /* @__PURE__ */ new Map();
    let total = 0;
    levelList.forEach((lv) => {
      offset.set(lv.grid.levelId, total);
      total += lv.grid.w * lv.grid.h;
    });
    const levelOfNode = (node) => {
      for (let i = levelList.length - 1; i >= 0; i--) if (node >= offset.get(levelList[i].grid.levelId)) return levelList[i];
      return levelList[0];
    };
    const avoid = opts.avoid || null;
    const penalty = opts.transitionPenalty || 0;
    const trans = /* @__PURE__ */ new Map();
    state.transitions.forEach((tr) => {
      if (!tr.usable || tr.blocked) return;
      if (avoid && avoid.has(tr.kind === "lift" ? "lift" : tr.kind === "stair" || tr.kind === "escalator" ? "stair" : tr.kind)) return;
      const na = offset.get(tr.a.levelId) + tr.a.cell;
      const nb = offset.get(tr.b.levelId) + tr.b.cell;
      if (!trans.has(na)) trans.set(na, []);
      if (!trans.has(nb)) trans.set(nb, []);
      trans.get(na).push({ to: nb, tr, up: true });
      trans.get(nb).push({ to: na, tr, up: false });
    });
    const extra = opts.extraCost || null;
    const goalNode = offset.get(lvTo.grid.levelId) + t;
    const goalC = cellCenter(lvTo.grid, t);
    const gScore = new Float32Array(total).fill(Infinity);
    const came = new Int32Array(total).fill(-1);
    const viaTrans = /* @__PURE__ */ new Map();
    const closed = new Uint8Array(total);
    const heap = new MinHeap();
    const startNode = offset.get(lvFrom.grid.levelId) + s;
    gScore[startNode] = 0;
    const h = (lv, cell) => {
      const c = cellCenter(lv.grid, cell);
      const dx = Math.abs(c[0] - goalC[0]), dz = Math.abs(c[2] - goalC[2]);
      return Math.max(dx, dz) + 0.41421356 * Math.min(dx, dz) + Math.abs(lv.grid.floorY - lvTo.grid.floorY);
    };
    heap.push(h(lvFrom, s), startNode);
    const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    let expanded = 0;
    const maxExpand = opts.maxExpand || 4e6;
    while (heap.size) {
      const node = heap.pop();
      if (closed[node]) continue;
      closed[node] = 1;
      if (node === goalNode) break;
      if (++expanded > maxExpand) break;
      const lv = levelOfNode(node);
      const g = lv.grid;
      const base = offset.get(g.levelId);
      const cell = node - base;
      const i = cell % g.w, j = (cell - i) / g.w;
      const gc = gScore[node];
      for (const [di, dj, m] of DIRS) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= g.w || nj >= g.h) continue;
        const nc = nj * g.w + ni;
        if (!passable(lv.state[nc])) continue;
        if (di && dj && (!passable(lv.state[j * g.w + ni]) || !passable(lv.state[nj * g.w + i]))) continue;
        const margin = lv.dist[nc] - state.radius;
        const comfort = margin < 0.4 ? 1 + (0.4 - Math.max(0, margin)) * 0.75 : 1;
        let cost = m * g.res * comfort;
        if (lv.slow) cost /= lv.slow[nc];
        if (extra) cost += extra(g.levelId, nc);
        const nn = base + nc;
        const ng = gc + cost;
        if (ng < gScore[nn]) {
          gScore[nn] = ng;
          came[nn] = node;
          heap.push(ng + h(lv, nc), nn);
        }
      }
      const tl = trans.get(node);
      if (tl) {
        for (const { to: nn, tr } of tl) {
          const ng = gc + tr.cost + penalty;
          if (ng < gScore[nn]) {
            gScore[nn] = ng;
            came[nn] = node;
            viaTrans.set(nn, tr);
            heap.push(ng + h(levelOfNode(nn), nn - offset.get(levelOfNode(nn).grid.levelId)), nn);
          }
        }
      }
    }
    if (!closed[goalNode]) return null;
    const nodes = [];
    for (let n = goalNode; n >= 0; n = came[n]) {
      nodes.push(n);
      if (n === startNode) break;
    }
    nodes.reverse();
    const legs = [];
    let cur = null;
    nodes.forEach((n, k) => {
      const lv = levelOfNode(n);
      const cell = n - offset.get(lv.grid.levelId);
      const tr = viaTrans.get(n);
      if (tr && k > 0 && levelOfNode(nodes[k - 1]) !== lv) {
        legs.push({ type: tr.kind, transition: tr, fromLevelId: levelOfNode(nodes[k - 1]).grid.levelId, toLevelId: lv.grid.levelId });
        cur = null;
      }
      if (!cur) {
        cur = { type: "walk", levelId: lv.grid.levelId, cells: [] };
        legs.push(cur);
      }
      cur.cells.push(cell);
    });
    let length = 0;
    legs.forEach((leg) => {
      if (leg.type !== "walk") {
        length += leg.transition.dy;
        return;
      }
      const lv = state.levels.get(leg.levelId);
      const kept = smoothCells(lv, leg.cells);
      leg.points = kept.map((c) => cellCenter(lv.grid, c));
      if (leg.points.length === 1) leg.points.push(leg.points[0].slice());
      for (let k = 1; k < leg.points.length; k++) length += Math.hypot(leg.points[k][0] - leg.points[k - 1][0], leg.points[k][2] - leg.points[k - 1][2]);
      delete leg.cells;
    });
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    return { legs, length, expanded, ms: t1 - t0, startCell: s, goalCell: t };
  }
  function smoothCells(lv, cells) {
    if (cells.length <= 2) return cells.slice();
    const out = [cells[0]];
    let anchor = 0;
    while (anchor < cells.length - 1) {
      let far = anchor + 1;
      for (let k = cells.length - 1; k > anchor + 1; k--) {
        if (lineOfSight(lv, cells[anchor], cells[k])) {
          far = k;
          break;
        }
      }
      out.push(cells[far]);
      anchor = far;
    }
    return out;
  }
  function lineOfSight(lv, a, b) {
    const g = lv.grid;
    let x0 = a % g.w, y0 = a / g.w | 0;
    const x1 = b % g.w, y1 = b / g.w | 0;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
      if (!passable(lv.state[y0 * g.w + x0])) return false;
      if (x0 === x1 && y0 === y1) return true;
      const e2 = 2 * err;
      if (e2 > -dy && e2 < dx) {
        if (!passable(lv.state[y0 * g.w + x0 + sx]) || !passable(lv.state[(y0 + sy) * g.w + x0])) return false;
      }
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
  }
  function explainCell(state, levelId, x, z) {
    const lv = state.levels.get(levelId);
    if (!lv) return null;
    const g = lv.grid;
    const idx = cellIndex(g, x, z);
    if (idx < 0) return null;
    const st = lv.state[idx];
    const i = idx % g.w, j = (idx - i) / g.w;
    const base = { levelId, levelName: g.levelName, cell: [i, j], idx, center: cellCenter(g, idx), state: st, label: CELL_LABEL[st], clearance: Number.isFinite(lv.dist[idx]) ? lv.dist[idx] : null };
    const r = state.robot;
    switch (st) {
      case CELL.VOID:
        return { ...base, step: "G1", elementId: null, detail: "No walkable surface was found within " + FLOOR_TOL + " m of the floor height here." };
      case CELL.OBSTACLE:
        return { ...base, step: "G2", elementId: lv.cause[idx], detail: `Geometry reaches down to ${g.obsLow[idx].toFixed(2)} m above the floor, below the robot height of ${r.height.toFixed(2)} m.` };
      case CELL.INFLATED: {
        const src = lv.cause[idx];
        const srcState = src >= 0 ? lv.state[src] : -1;
        const srcEl = srcState === CELL.OBSTACLE || srcState === CELL.BLOCKED ? lv.cause[src] : null;
        const why = srcState === CELL.VOID ? "the edge of the floor" : srcState === CELL.USER ? "a what-if obstacle" : srcState === CELL.BLOCKED ? "a blocked door" : srcState === CELL.ZONE ? "a no-go zone" : "an obstacle";
        return { ...base, step: "G4", elementId: srcEl, sourceCell: src, detail: `Within ${state.radius.toFixed(2)} m (robot half-width plus clearance) of ${why}; nearest is ${lv.dist[idx].toFixed(2)} m away.` };
      }
      case CELL.DOOR:
        return { ...base, step: "G3", elementId: lv.cause[idx], detail: "Door footprint opened for passage." };
      case CELL.BLOCKED:
        return { ...base, step: "G5", elementId: lv.cause[idx], detail: "This door is blocked in the what-if scenario." };
      case CELL.USER:
        return { ...base, step: "G5", elementId: null, detail: "A what-if obstacle placed in the view." };
      case CELL.ZONE:
        return { ...base, step: "G5", elementId: null, detail: "Inside a no-go safety zone: robots may not enter." };
      default: {
        const f = slowFactorAt(lv, idx);
        const slowNote = f < 1 ? ` Inside a slow zone: robots drive at ${Math.round(f * 100)}% speed.` : "";
        return { ...base, step: f < 1 ? "G5" : st === CELL.DOOR ? "G3" : "G1", elementId: g.floorSrc[idx] >= 0 ? g.floorSrc[idx] : null, detail: `Free floor with ${lv.dist[idx].toFixed(2)} m to the nearest obstruction.${slowNote}` };
      }
    }
  }
  function levelAtHeight(state, y) {
    let best = null;
    state.levels.forEach((lv) => {
      const fy = lv.grid.floorY;
      if (fy <= y + 0.5 && (!best || fy > best.grid.floorY)) best = lv;
    });
    return best || [...state.levels.values()][0] || null;
  }
  function gridReachability(state, building) {
    const labels = /* @__PURE__ */ new Map();
    const parent = [];
    const find = (a) => {
      while (parent[a] !== a) {
        parent[a] = parent[parent[a]];
        a = parent[a];
      }
      return a;
    };
    const union = (a, b) => {
      a = find(a);
      b = find(b);
      if (a !== b) parent[b] = a;
    };
    state.levels.forEach((lv) => {
      const g = lv.grid;
      const lab = new Int32Array(g.w * g.h).fill(-1);
      const stack = [];
      for (let k = 0; k < lab.length; k++) {
        if (lab[k] >= 0 || !passable(lv.state[k])) continue;
        const id = parent.length;
        parent.push(id);
        lab[k] = id;
        stack.push(k);
        while (stack.length) {
          const c = stack.pop();
          const i = c % g.w, j = (c - i) / g.w;
          const nb = [i > 0 ? c - 1 : -1, i < g.w - 1 ? c + 1 : -1, j > 0 ? c - g.w : -1, j < g.h - 1 ? c + g.w : -1];
          for (const n of nb) if (n >= 0 && lab[n] < 0 && passable(lv.state[n])) {
            lab[n] = id;
            stack.push(n);
          }
        }
      }
      labels.set(g.levelId, lab);
    });
    state.transitions.forEach((t) => {
      if (!t.usable || t.blocked) return;
      const a = labels.get(t.a.levelId)[t.a.cell], b = labels.get(t.b.levelId)[t.b.cell];
      if (a >= 0 && b >= 0) union(a, b);
    });
    const groups = /* @__PURE__ */ new Map();
    const unreachable = [];
    building.spaces.forEach((s) => {
      const lv = state.levels.get(s.levelId);
      const cell = lv ? nearestFreeCell(lv, s.position[0], s.position[2], 2.5) : -1;
      if (cell < 0) {
        unreachable.push(s.id);
        return;
      }
      const root = find(labels.get(s.levelId)[cell]);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(s.id);
    });
    const comps = [...groups.values()].sort((a, b) => b.length - a.length);
    const total = building.spaces.size;
    return {
      components: comps,
      noFreeSpace: unreachable,
      largest: comps[0] ? comps[0].length : 0,
      share: total ? (comps[0] ? comps[0].length : 0) / total : null,
      outside: [...comps.slice(1).flat(), ...unreachable]
    };
  }
  function navMapSummary(state) {
    const out = { levels: [], free: 0, total: 0 };
    state.levels.forEach((lv) => {
      const counts = new Array(CELL_STATES).fill(0);
      for (let k = 0; k < lv.state.length; k++) counts[lv.state[k]]++;
      const floorCells = lv.state.length - counts[CELL.VOID];
      out.levels.push({ levelId: lv.grid.levelId, name: lv.grid.levelName, w: lv.grid.w, h: lv.grid.h, counts, free: counts[CELL.FREE] + counts[CELL.DOOR], floorCells, fallback: lv.grid.floorFallback });
      out.free += counts[CELL.FREE] + counts[CELL.DOOR];
      out.total += floorCells;
    });
    return out;
  }
  Object.assign(window, {
    GRID_STEPS,
    CELL,
    CELL_LABEL,
    CELL_STATES,
    buildNavMap,
    applyRobot,
    planGridRoute,
    explainCell,
    nearestFreeCell,
    levelAtHeight,
    navMapSummary,
    gridReachability,
    cellIndex,
    cellCenter,
    passable,
    forEachZoneCell,
    slowFactorAt,
    lineOfSight
  });
})();
