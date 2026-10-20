/**
 * Building semantic graph — the bridge from IFC data to robot navigation.
 *
 * buildBuildingGraph(model) derives, with provenance for every result:
 *   S1 levels      IfcBuildingStorey + the floor height measured from walkable geometry
 *   S2 regions     IfcSpace → room nodes (floor area and centroid from the space's floor faces)
 *   S3 portals     IfcDoor → links between rooms (IfcRelSpaceBoundary, else geometric inference)
 *   S4 verticals   stairs / ramps / lifts → links between levels
 *   S5 topology    a weighted graph the route planner (and later the V2 grid planner) consumes
 *
 * analyzeReadiness(graph, robot) reports what blocks robot navigation, and
 * findRoute(graph, from, to, opts) plans a room-level route with what-if blocking.
 * Nothing here touches the DOM or Three.js, so it can run in a worker or in tests.
 */

const PIPELINE_STEPS = {
  S1: 'S1 · Level extraction',
  S2: 'S2 · Region extraction',
  S3: 'S3 · Portal linking',
  S4: 'S4 · Vertical linking',
  S5: 'S5 · Topology analysis',
};

const DEFAULT_ROBOT_PROFILE = {
  name: 'Wheeled indoor robot',
  width: 0.6,       // m, body width
  height: 1.4,      // m, used for the obstacle height band in V2
  clearance: 0.05,  // m, required on each side when passing a door
  canUseStairs: false,
  canUseLifts: true,
};

const DOOR_FRAME_ALLOWANCE = 0.08; // m, overall width → clear width

function bboxCenter(b) {
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
}

// Horizontal (XZ) distance between two boxes; 0 when they overlap.
function bboxGapXZ(a, b) {
  const dx = Math.max(0, a.min[0] - b.max[0], b.min[0] - a.max[0]);
  const dz = Math.max(0, a.min[2] - b.max[2], b.min[2] - a.max[2]);
  return Math.hypot(dx, dz);
}

function overlapY(a, b, tol = 0) {
  return a.min[1] - tol <= b.max[1] && b.min[1] - tol <= a.max[1];
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function distance3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// Floor area and centroid from the downward-facing triangles of a space volume.
function spaceFootprint(el) {
  const g = el.geometry;
  if (!g || !g.positions || !g.indices) return null;
  const p = g.positions;
  const idx = g.indices;
  let area = 0, cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len === 0 || ny / len > -0.9) continue;
    const triArea = len / 2;
    area += triArea;
    cx += triArea * (p[a] + p[b] + p[c]) / 3;
    cy += triArea * (p[a + 1] + p[b + 1] + p[c + 1]) / 3;
    cz += triArea * (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
  }
  if (area <= 1e-6) return null;
  return { area, centroid: [cx / area, cy / area, cz / area] };
}

function displayName(el) {
  if (!el) return '—';
  const n = (el.name || '').trim();
  const ln = (el.longName || '').trim();
  if (n && ln && n !== ln) return `${n} ${ln}`;
  return n || ln || `${el.ifcClass.replace(/^Ifc/, '')} #${el.expressId}`;
}

function verticalKind(el) {
  const c = el.ifcClass;
  const pt = String(el.predefinedType || '').toUpperCase();
  if (/^IfcRamp/.test(c)) return 'ramp';
  if (c === 'IfcTransportElement') {
    if (pt.includes('ESCALATOR')) return 'escalator';
    if (pt.includes('MOVINGWALKWAY')) return 'walkway';
    return 'lift';
  }
  return 'stair';
}

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------
function buildBuildingGraph(model) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const scale = (model.lengthUnit && model.lengthUnit.scale) || 1;
  const instances = model.elements.filter(e => !e.isType);

  // ---- S1 levels ------------------------------------------------------------------
  const levels = model.storeys.map(st => {
    const members = instances.filter(e => e.storey === st);
    const geo = members.filter(e => e.bbox);
    const walkTops = geo.filter(e => navRoleOf(e) === 'walkable').map(e => e.bbox.max[1]);
    let floorY = null;
    let floorSource = null;
    if (walkTops.length) {
      floorY = median(walkTops);
      floorSource = `median top of ${walkTops.length} walkable slab${walkTops.length === 1 ? '' : 's'}`;
    } else if (geo.length) {
      floorY = Math.min(...geo.map(e => e.bbox.min[1]));
      floorSource = 'lowest contained geometry';
    }
    return {
      id: st.expressId,
      storeyId: st.expressId,
      name: st.name || st.longName || `Storey #${st.expressId}`,
      elevationAttr: st.elevation != null ? Number(st.elevation) * scale : null,
      floorY,
      floorSource,
      elementIds: members.map(e => e.expressId),
      geometryCount: geo.length,
      spaceIds: [],
      doorIds: [],
      verticalIds: [],
    };
  });
  levels.sort((a, b) => {
    if (a.floorY != null && b.floorY != null) return a.floorY - b.floorY;
    return (a.elevationAttr || 0) - (b.elevationAttr || 0);
  });
  // Express measured floors as elevations: align to the IFC Elevation of the best-measured storey.
  const reference = levels
    .filter(l => l.floorY != null && l.elevationAttr != null && l.floorSource && l.floorSource.startsWith('median'))
    .sort((a, b) => Math.abs(a.elevationAttr) - Math.abs(b.elevationAttr))[0];
  const lowest = levels.find(l => l.floorY != null);
  const elevationOffset = reference ? reference.elevationAttr - reference.floorY : (lowest ? -lowest.floorY : 0);
  const elevationReference = reference ? `the IFC elevation of ${reference.name}` : 'the lowest level';
  levels.forEach((lv, i) => {
    lv.elevation = lv.floorY != null ? lv.floorY + elevationOffset : null;
    const next = levels.slice(i + 1).find(n => n.floorY != null);
    lv.index = i;
    lv.heightToNext = next && lv.floorY != null ? next.floorY - lv.floorY : null;
  });
  const levelById = new Map(levels.map(l => [l.id, l]));
  const levelByY = (y) => {
    let best = null;
    levels.forEach(l => {
      if (l.floorY == null) return;
      if (l.floorY <= y + 0.3 && (!best || l.floorY > best.floorY)) best = l;
    });
    return best || levels.find(l => l.floorY != null) || null;
  };
  const levelOf = (el) => {
    if (el.storey && levelById.has(el.storey.expressId)) return levelById.get(el.storey.expressId);
    return el.bbox ? levelByY(el.bbox.min[1]) : null;
  };

  // ---- S2 regions -----------------------------------------------------------------
  const spaces = new Map();
  const spacesWithoutGeometry = [];
  (model.byClass.get('IfcSpace') || []).forEach(id => {
    const el = model.byId.get(id);
    if (!el.bbox) { spacesWithoutGeometry.push(id); return; }
    const level = levelOf(el);
    const fp = spaceFootprint(el);
    const c = bboxCenter(el.bbox);
    const floorY = level && level.floorY != null ? Math.max(level.floorY, el.bbox.min[1]) : el.bbox.min[1];
    const centroid = fp ? [fp.centroid[0], floorY, fp.centroid[2]] : [c[0], floorY, c[2]];
    spaces.set(id, {
      id,
      name: displayName(el),
      named: !!((el.name || '').trim() || (el.longName || '').trim()),
      levelId: level ? level.id : null,
      levelFromStorey: !!(el.storey && levelById.has(el.storey.expressId)),
      bbox: el.bbox,
      area: fp ? fp.area : (el.bbox.max[0] - el.bbox.min[0]) * (el.bbox.max[2] - el.bbox.min[2]),
      areaSource: fp ? 'floor faces' : 'bounding box',
      position: centroid,
      doorIds: [],
    });
    if (level) level.spaceIds.push(id);
  });

  // ---- S3 portals -----------------------------------------------------------------
  const doors = new Map();
  const doorIds = [];
  model.byClass.forEach((ids, cls) => { if (/^IfcDoor/.test(cls)) doorIds.push(...ids); });
  const openingToDoor = new Map();
  const doorToHost = new Map();
  const nr = model.navRelations || { spaceBoundaries: new Map(), virtualBoundaries: new Map(), fills: new Map(), voids: new Map() };
  nr.fills.forEach((fillers, openingId) => fillers.forEach(f => openingToDoor.set(openingId, f)));
  nr.voids.forEach((openings, hostId) => openings.forEach(o => {
    const d = openingToDoor.get(o);
    if (d != null) doorToHost.set(d, hostId);
  }));

  doorIds.forEach(id => {
    const el = model.byId.get(id);
    if (!el || !el.bbox) return;
    const level = levelOf(el);
    const b = el.bbox;
    const dx = b.max[0] - b.min[0];
    const dz = b.max[2] - b.min[2];
    const attrWidth = el.overallWidth != null ? Number(el.overallWidth) * scale : null;
    const width = attrWidth || Math.max(dx, dz);
    const c = bboxCenter(b);
    doors.set(id, {
      id,
      name: displayName(el),
      levelId: level ? level.id : null,
      bbox: b,
      position: [c[0], b.min[1], c[2]],
      normalAxis: dx < dz ? 0 : 2,           // the thin horizontal axis points through the door
      width,
      widthSource: attrWidth ? 'OverallWidth attribute' : 'bounding box',
      clearWidth: Math.max(0, width - DOOR_FRAME_ALLOWANCE),
      hostId: doorToHost.get(id) || null,
      spaceIds: [],
      linkSource: null,
    });
    if (level) level.doorIds.push(id);
  });

  // Source 1 — explicit space boundaries.
  nr.spaceBoundaries.forEach((elementIds, spaceId) => {
    if (!spaces.has(spaceId)) return;
    elementIds.forEach(eid => {
      const d = doors.get(eid);
      if (!d || d.spaceIds.includes(spaceId)) return;
      d.spaceIds.push(spaceId);
      d.linkSource = 'IfcRelSpaceBoundary';
    });
  });

  // Source 2 — geometric inference for doors still missing a side.
  const GAP_TOL = 0.45;
  doors.forEach(d => {
    if (d.spaceIds.length >= 2) return;
    const axis = d.normalAxis;
    const center = bboxCenter(d.bbox);
    const sides = { neg: null, pos: null };
    spaces.forEach(s => {
      if (d.spaceIds.includes(s.id)) return;
      if (!overlapY(d.bbox, s.bbox, 0.3)) return;
      const gap = bboxGapXZ(d.bbox, s.bbox);
      if (gap > GAP_TOL) return;
      const side = s.position[axis] < center[axis] ? 'neg' : 'pos';
      if (!sides[side] || gap < sides[side].gap) sides[side] = { id: s.id, gap };
    });
    // Respect an explicit side already known from space boundaries.
    const known = d.spaceIds[0] ? spaces.get(d.spaceIds[0]) : null;
    const knownSide = known ? (known.position[axis] < center[axis] ? 'neg' : 'pos') : null;
    ['neg', 'pos'].forEach(side => {
      if (side === knownSide || !sides[side] || d.spaceIds.length >= 2) return;
      d.spaceIds.push(sides[side].id);
      d.linkSource = d.linkSource ? `${d.linkSource} + geometry` : 'geometry';
    });
  });
  doors.forEach(d => d.spaceIds.forEach(sid => spaces.get(sid).doorIds.push(d.id)));

  // Open connections — rooms that touch with no wall between them (open-plan areas).
  // When the model declares VIRTUAL space boundaries, both rooms must carry one.
  const openings = new Map();
  const hasVirtualInfo = nr.virtualBoundaries && nr.virtualBoundaries.size > 0;
  const spaceList = [...spaces.values()];
  for (let i = 0; i < spaceList.length; i++) {
    for (let j = i + 1; j < spaceList.length; j++) {
      const a = spaceList[i], b = spaceList[j];
      if (a.levelId == null || a.levelId !== b.levelId) continue;
      if (hasVirtualInfo && !(nr.virtualBoundaries.get(a.id) && nr.virtualBoundaries.get(b.id))) continue;
      if (bboxGapXZ(a.bbox, b.bbox) > 0.05) continue;
      const lo = [Math.max(a.bbox.min[0], b.bbox.min[0]), Math.max(a.bbox.min[2], b.bbox.min[2])];
      const hi = [Math.min(a.bbox.max[0], b.bbox.max[0]), Math.min(a.bbox.max[2], b.bbox.max[2])];
      const contact = Math.max(hi[0] - lo[0], hi[1] - lo[1]);
      if (contact < 0.6) continue;
      const key = `o:${a.id}-${b.id}`;
      const y = Math.max(a.position[1], b.position[1]);
      openings.set(key, {
        id: key,
        name: `Open connection ${a.name} / ${b.name}`,
        levelId: a.levelId,
        spaceIds: [a.id, b.id],
        position: [(lo[0] + hi[0]) / 2, y, (lo[1] + hi[1]) / 2],
        width: contact,
        clearWidth: contact,
        linkSource: hasVirtualInfo ? 'IfcRelSpaceBoundary (VIRTUAL) + geometry' : 'geometry (touching rooms)',
      });
      a.openingIds = (a.openingIds || []).concat(key);
      b.openingIds = (b.openingIds || []).concat(key);
    }
  }

  // ---- S4 verticals ----------------------------------------------------------------
  const verticalRoots = new Map();
  instances.forEach(el => {
    if (navRoleOf(el) !== 'vertical' || !el.bbox) return;
    let root = el;
    let cur = el;
    while (cur.parentExpressId != null) {
      const p = model.byId.get(cur.parentExpressId);
      if (!p || navRoleOf(p) !== 'vertical') break;
      root = p;
      cur = p;
    }
    if (!verticalRoots.has(root.expressId)) {
      verticalRoots.set(root.expressId, { id: root.expressId, name: displayName(root), kind: verticalKind(root), memberIds: [], bbox: { min: [...el.bbox.min], max: [...el.bbox.max] } });
    }
    const v = verticalRoots.get(root.expressId);
    v.memberIds.push(el.expressId);
    for (let a = 0; a < 3; a++) {
      v.bbox.min[a] = Math.min(v.bbox.min[a], el.bbox.min[a]);
      v.bbox.max[a] = Math.max(v.bbox.max[a], el.bbox.max[a]);
    }
  });
  const verticals = new Map();
  verticalRoots.forEach(v => {
    const served = levels.filter(l => l.floorY != null && l.floorY >= v.bbox.min[1] - 0.6 && l.floorY <= v.bbox.max[1] + 0.6);
    v.levelIds = served.map(l => l.id);
    served.forEach(l => l.verticalIds.push(v.id));
    verticals.set(v.id, v);
  });

  // ---- S5 topology ----------------------------------------------------------------
  const nodes = new Map();
  const edges = [];
  const addNode = (n) => { nodes.set(n.key, n); return n; };
  const addEdge = (a, b, cost, kind, elementId, source) => edges.push({ a, b, cost, kind, elementId, source });

  spaces.forEach(s => addNode({ key: `s:${s.id}`, kind: 'space', elementId: s.id, levelId: s.levelId, position: s.position, label: s.name }));
  doors.forEach(d => {
    addNode({ key: `d:${d.id}`, kind: 'door', elementId: d.id, levelId: d.levelId, position: d.position, label: d.name });
    d.spaceIds.forEach(sid => {
      const s = spaces.get(sid);
      addEdge(`s:${sid}`, `d:${d.id}`, distance3(s.position, d.position), 'portal', d.id, d.linkSource);
    });
  });
  openings.forEach(o => {
    addNode({ key: o.id, kind: 'opening', elementId: o.id, elementIds: o.spaceIds, levelId: o.levelId, position: o.position, label: o.name });
    o.spaceIds.forEach(sid => {
      const s = spaces.get(sid);
      addEdge(`s:${sid}`, o.id, distance3(s.position, o.position), 'open', o.id, o.linkSource);
    });
  });
  verticals.forEach(v => {
    const c = bboxCenter(v.bbox);
    const landings = v.levelIds.map(lid => levelById.get(lid));
    landings.forEach(l => {
      const key = `v:${v.id}:${l.id}`;
      const pos = [c[0], l.floorY, c[2]];
      addNode({ key, kind: 'landing', elementId: v.id, levelId: l.id, position: pos, label: `${v.name} at ${l.name}` });
      // Link the landing to the nearest room(s) on that level.
      let best = null;
      spaces.forEach(s => {
        if (s.levelId !== l.id) return;
        const gap = bboxGapXZ(v.bbox, s.bbox);
        if (gap > 1.0) return;
        const dist = Math.hypot(s.position[0] - pos[0], s.position[2] - pos[2]);
        if (!best || gap < best.gap || (gap === best.gap && dist < best.dist)) best = { s, gap, dist };
      });
      if (best) addEdge(key, `s:${best.s.id}`, best.dist, 'landing', v.id, 'geometry');
    });
    for (let i = 0; i + 1 < landings.length; i++) {
      const dy = Math.abs(landings[i + 1].floorY - landings[i].floorY);
      const travel = v.kind === 'lift' ? dy : dy * 1.8;
      addEdge(`v:${v.id}:${landings[i].id}`, `v:${v.id}:${landings[i + 1].id}`, travel, v.kind, v.id, 'geometry');
    }
  });

  const elementToNodes = new Map();
  nodes.forEach(n => {
    if (!elementToNodes.has(n.elementId)) elementToNodes.set(n.elementId, []);
    elementToNodes.get(n.elementId).push(n.key);
  });

  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    levels,
    elevationOffset,
    elevationReference,
    spaces,
    doors,
    openings,
    verticals,
    nodes,
    edges,
    elementToNodes,
    spacesWithoutGeometry,
    unassignedGeometry: instances.filter(e => e.bbox && !e.storey && navRoleOf(e) !== 'container').map(e => e.expressId),
    buildMs: t1 - t0,
  };
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------
function doorPassable(door, robot) {
  return door.clearWidth >= robot.width + 2 * robot.clearance;
}

function edgeUsable(edge, graph, opts) {
  const robot = opts.robot || DEFAULT_ROBOT_PROFILE;
  const blocked = opts.blocked || new Set();
  if (blocked.has(edge.elementId)) return false;
  if (edge.kind === 'portal') return doorPassable(graph.doors.get(edge.elementId), robot);
  if (edge.kind === 'open') return doorPassable(graph.openings.get(edge.elementId), robot);
  if (edge.kind === 'stair' || edge.kind === 'escalator') return !!robot.canUseStairs;
  if (edge.kind === 'ramp' || edge.kind === 'walkway') return true;
  if (edge.kind === 'lift') return !!robot.canUseLifts;
  return true;
}

function adjacency(graph, opts) {
  const adj = new Map();
  graph.nodes.forEach((_, k) => adj.set(k, []));
  graph.edges.forEach(e => {
    if (!edgeUsable(e, graph, opts)) return;
    adj.get(e.a).push({ to: e.b, edge: e });
    adj.get(e.b).push({ to: e.a, edge: e });
  });
  return adj;
}

/** Dijkstra between two room ids. Returns null when unreachable. */
function findRoute(graph, fromSpaceId, toSpaceId, opts = {}) {
  const start = `s:${fromSpaceId}`;
  const goal = `s:${toSpaceId}`;
  if (!graph.nodes.has(start) || !graph.nodes.has(goal)) return null;
  const adj = adjacency(graph, opts);
  const dist = new Map([[start, 0]]);
  const prev = new Map();
  const done = new Set();
  const queue = [[0, start]];
  while (queue.length) {
    let bi = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i][0] < queue[bi][0]) bi = i;
    const [d, u] = queue.splice(bi, 1)[0];
    if (done.has(u)) continue;
    done.add(u);
    if (u === goal) break;
    for (const { to, edge } of adj.get(u)) {
      const nd = d + edge.cost;
      if (nd < (dist.has(to) ? dist.get(to) : Infinity)) {
        dist.set(to, nd);
        prev.set(to, { from: u, edge });
        queue.push([nd, to]);
      }
    }
  }
  if (!done.has(goal)) return null;
  const keys = [goal];
  const usedEdges = [];
  let k = goal;
  while (prev.has(k)) {
    const p = prev.get(k);
    usedEdges.unshift(p.edge);
    k = p.from;
    keys.unshift(k);
  }
  const steps = keys.map(key => graph.nodes.get(key));
  return {
    keys,
    steps,
    edges: usedEdges,
    length: dist.get(goal),
    points: steps.map(s => s.position),
    doorCount: steps.filter(s => s.kind === 'door').length,
    levelChanges: usedEdges.filter(e => !['portal', 'open', 'landing'].includes(e.kind)).length,
  };
}

/** Connected components over room nodes, honouring blocked elements and robot limits. */
function roomComponents(graph, opts = {}) {
  const adj = adjacency(graph, opts);
  const seen = new Set();
  const comps = [];
  graph.nodes.forEach((n, key) => {
    if (n.kind !== 'space' || seen.has(key)) return;
    const comp = [];
    const stack = [key];
    seen.add(key);
    while (stack.length) {
      const u = stack.pop();
      const node = graph.nodes.get(u);
      if (node.kind === 'space') comp.push(node.elementId);
      for (const { to } of adj.get(u)) {
        if (!seen.has(to)) { seen.add(to); stack.push(to); }
      }
    }
    comps.push(comp);
  });
  comps.sort((a, b) => b.length - a.length);
  return comps;
}

// ---------------------------------------------------------------------------
// Readiness — what stops this model from driving a robot?
// ---------------------------------------------------------------------------
function analyzeReadiness(graph, model, opts = {}) {
  const robot = opts.robot || DEFAULT_ROBOT_PROFILE;
  const checks = [];
  const add = (c) => checks.push({ elementIds: [], ...c });
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const spaces = [...graph.spaces.values()];
  const doors = [...graph.doors.values()];

  // S1
  if (!graph.levels.length) {
    add({ id: 'levels', step: 'S1', status: 'fail', title: 'No building storeys', detail: 'The model has no IfcBuildingStorey, so elements cannot be grouped into navigation levels.' });
  } else {
    const empty = graph.levels.filter(l => l.floorY == null);
    add({
      id: 'levels', step: 'S1', status: empty.length ? 'warn' : 'pass',
      title: `${plural(graph.levels.length, 'level')} detected`,
      detail: empty.length ? `${plural(empty.length, 'storey')} contain no geometry, so no floor height could be measured.` : 'Every storey has geometry to measure its floor height from.',
      elementIds: empty.map(l => l.storeyId),
    });
  }

  // S2
  const totalSpaces = spaces.length + graph.spacesWithoutGeometry.length;
  if (!totalSpaces) {
    add({ id: 'spaces', step: 'S2', status: 'fail', title: 'No rooms (IfcSpace)', detail: 'Room-level routing needs IfcSpace elements. Grid-based navigation in Version 2 can still work from walls and slabs.' });
  } else {
    add({
      id: 'spaces', step: 'S2', status: graph.spacesWithoutGeometry.length ? 'warn' : 'pass',
      title: `${plural(spaces.length, 'room')} with geometry`,
      detail: graph.spacesWithoutGeometry.length ? `${plural(graph.spacesWithoutGeometry.length, 'space')} have no body geometry and are left out of the graph.` : 'Every IfcSpace has a body shape to place a room node.',
      elementIds: graph.spacesWithoutGeometry,
    });
    const unnamed = spaces.filter(s => !s.named);
    if (unnamed.length) add({ id: 'space-names', step: 'S2', status: 'warn', title: `${plural(unnamed.length, 'room')} without a name`, detail: 'Route instructions read better when every IfcSpace has a Name or LongName.', elementIds: unnamed.map(s => s.id) });
    const noLevel = spaces.filter(s => !s.levelFromStorey);
    if (noLevel.length) add({ id: 'space-levels', step: 'S2', status: 'warn', title: `${plural(noLevel.length, 'room')} not assigned to a storey`, detail: 'Their level was inferred from height. Aggregate each IfcSpace under its IfcBuildingStorey.', elementIds: noLevel.map(s => s.id) });
  }

  // S3
  if (spaces.length > 1 && !doors.length) {
    add({ id: 'doors', step: 'S3', status: 'fail', title: 'No doors', detail: 'Rooms exist but no IfcDoor connects them, so every room is isolated.' });
  } else if (doors.length) {
    const two = doors.filter(d => d.spaceIds.length >= 2);
    const one = doors.filter(d => d.spaceIds.length === 1);
    const none = doors.filter(d => d.spaceIds.length === 0);
    add({
      id: 'door-links', step: 'S3', status: none.length ? 'warn' : 'pass',
      title: `${two.length} of ${plural(doors.length, 'door')} link two rooms`,
      detail: [one.length ? `${one.length} reach one room only, so they are exterior doors or a room is missing.` : null, none.length ? `${none.length} touch no room.` : null].filter(Boolean).join(' ') || 'Every door connects two rooms.',
      elementIds: [...none, ...one].map(d => d.id),
    });
    const inferred = doors.filter(d => d.linkSource && d.linkSource.includes('geometry'));
    if (inferred.length) add({ id: 'door-provenance', step: 'S3', status: 'info', title: `${plural(inferred.length, 'door link')} inferred from geometry`, detail: 'These doors have no IfcRelSpaceBoundary to a room on at least one side. Links were inferred from bounding-box proximity.', elementIds: inferred.map(d => d.id) });
    const need = robot.width + 2 * robot.clearance;
    const narrow = doors.filter(d => !doorPassable(d, robot));
    add({
      id: 'door-width', step: 'S3', status: narrow.length ? 'warn' : 'pass',
      title: narrow.length ? `${plural(narrow.length, 'door')} too narrow for the robot` : 'All doors fit the robot',
      detail: `${robot.name} needs ${need.toFixed(2)} m clear width (body ${robot.width.toFixed(2)} m + ${robot.clearance.toFixed(2)} m each side).`,
      elementIds: narrow.map(d => d.id),
    });
  }

  if (graph.openings.size) {
    add({ id: 'openings', step: 'S3', status: 'info', title: `${plural(graph.openings.size, 'open connection')} between rooms`, detail: `Rooms that touch without a wall are linked directly (${[...graph.openings.values()][0].linkSource}).`, elementIds: [...new Set([...graph.openings.values()].flatMap(o => o.spaceIds))] });
  }

  // S4
  const usedLevels = graph.levels.filter(l => l.spaceIds.length);
  if (usedLevels.length > 1) {
    const usable = (v) => (v.kind === 'lift' && robot.canUseLifts) || ((v.kind === 'stair' || v.kind === 'escalator') && robot.canUseStairs) || v.kind === 'ramp' || v.kind === 'walkway';
    const linked = new Set();
    graph.verticals.forEach(v => { if (usable(v) && v.levelIds.length > 1) v.levelIds.forEach(id => linked.add(id)); });
    const cut = usedLevels.filter(l => !linked.has(l.id));
    const kinds = [...graph.verticals.values()].reduce((m, v) => { m[v.kind] = (m[v.kind] || 0) + 1; return m; }, {});
    const kindText = Object.entries(kinds).map(([k, n]) => plural(n, k)).join(', ') || 'no stairs, ramps or lifts';
    add({
      id: 'verticals', step: 'S4', status: cut.length ? 'warn' : 'pass',
      title: cut.length ? `${plural(cut.length, 'level')} unreachable by this robot` : 'Every level is reachable',
      detail: `Found ${kindText}. ${robot.canUseStairs ? 'The robot can climb stairs.' : 'The robot cannot use stairs.'}`,
      elementIds: cut.map(l => l.storeyId),
    });
  }

  // S5
  if (spaces.length) {
    const comps = roomComponents(graph, { robot, blocked: opts.blocked });
    const reachable = comps[0] ? comps[0].length : 0;
    const isolated = spaces.filter(s => !s.doorIds.length && !(s.openingIds || []).length && !graph.edges.some(e => e.kind === 'landing' && e.b === `s:${s.id}`));
    add({
      id: 'components', step: 'S5', status: comps.length > 1 ? 'warn' : 'pass',
      title: comps.length > 1 ? `Rooms split into ${comps.length} disconnected groups` : 'All rooms are connected',
      detail: `${reachable} of ${plural(spaces.length, 'room')} share the largest connected group.`,
      elementIds: comps.slice(1).flat(),
    });
    if (isolated.length) add({ id: 'isolated', step: 'S5', status: 'warn', title: `${plural(isolated.length, 'room')} with no way in`, detail: 'No door, open connection or stair landing links these rooms to the rest of the building.', elementIds: isolated.map(s => s.id) });
  }

  if (graph.unassignedGeometry.length) {
    add({ id: 'unassigned', step: 'S1', status: 'info', title: `${plural(graph.unassignedGeometry.length, 'element')} outside any storey`, detail: 'Geometry not contained in an IfcBuildingStorey is not assigned to a navigation level.', elementIds: graph.unassignedGeometry });
  }

  const comps = spaces.length ? roomComponents(graph, { robot, blocked: opts.blocked }) : [];
  return {
    checks,
    summary: {
      levels: graph.levels.length,
      rooms: spaces.length,
      doors: doors.length,
      openings: graph.openings.size,
      verticals: graph.verticals.size,
      accessibleRooms: comps[0] ? comps[0].length : 0,
      accessibleShare: spaces.length ? (comps[0] ? comps[0].length : 0) / spaces.length : null,
      components: comps.length,
      warnings: checks.filter(c => c.status === 'warn' || c.status === 'fail').length,
    },
  };
}

Object.assign(window, {
  PIPELINE_STEPS,
  DEFAULT_ROBOT_PROFILE,
  buildBuildingGraph,
  analyzeReadiness,
  findRoute,
  roomComponents,
  doorPassable,
  spaceDisplayName: displayName,
});
