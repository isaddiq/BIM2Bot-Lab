/**
 * Robot interoperability and analysis on top of the occupancy grids (core/navmap.jsx).
 *
 *   exportRosMaps(navState, opts)    ROS 2 map_server files per level: a binary PGM (P5) plus its YAML,
 *                                    optional route waypoints, packed into one zip (stored, no compression)
 *   compareRoutes(navState, a, b, p) alternative grid routes (recommended, fewest level changes, no lifts,
 *                                    no stairs) with distance, time and an energy estimate
 *   lidarScan(navState, pose, cfg)   simulated 2D LiDAR: rays marched cell by cell through the grid,
 *                                    plus circles for people and other robots
 *
 * Frames. Model coordinates are three.js (y up). web-ifc maps IFC (X, Y, Z) to (x, z, y) = (X, Z, −Y),
 * so the ROS map frame is x_map = x, y_map = −z, which is the IFC plan frame after web-ifc moves the
 * model near the origin (COORDINATE_TO_ORIGIN). Angles flip sign for the same reason.
 * No DOM or Three.js here.
 */

// ---------------------------------------------------------------------------
// Zip (store only) — enough for a handful of map files, no dependency.
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** files: [{ name, data: Uint8Array | string }] → Uint8Array of a zip archive. */
function makeZip(files) {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals = [];
  const centrals = [];
  let offset = 0;
  files.forEach(f => {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // UTF-8 names
    lh.setUint16(8, 0, true);      // stored
    lh.setUint16(10, dosTime, true);
    lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    locals.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime, true);
    ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    centrals.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  });
  const cdSize = centrals.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
  let p = 0;
  parts.forEach(b => { out.set(b, p); p += b.length; });
  return out;
}

// ---------------------------------------------------------------------------
// ROS 2 maps
// ---------------------------------------------------------------------------
const ROS_OCCUPIED = 0;
const ROS_FREE = 254;
const ROS_UNKNOWN = 205;

function slugify(s) {
  return String(s || 'level').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s-]+/g, '_').toLowerCase().slice(0, 40) || 'level';
}

const num = (v, d = 4) => {
  const s = Number(v).toFixed(d);
  return s === '-0.0000' ? '0.0000' : s;
};

/** Model (x, z) → ROS map (x, y). */
function toMapXY(x, z) { return [x, -z]; }

/**
 * Occupancy value of one cell for ROS. Robot-specific height (G2) and what-if changes (G5) apply;
 * inflation (G4) does not, because Nav2 inflates its own costmap around occupied cells.
 */
function rosCellValue(lv, k, robot, opts) {
  const g = lv.grid;
  const st = lv.state[k];
  if (st === CELL.USER || st === CELL.BLOCKED) return ROS_OCCUPIED;
  if (st === CELL.ZONE && opts.includeZones) return ROS_OCCUPIED;
  if (g.door[k] >= 0) return ROS_FREE;
  if (!g.floor[k]) return opts.voidAs === 'unknown' ? ROS_UNKNOWN : ROS_OCCUPIED;
  if (g.obsLow[k] < robot.height) return ROS_OCCUPIED;
  return ROS_FREE;
}

/**
 * Build the files for every mapped level. Returns { files, levels } where files are
 * [{ name, data }] ready for makeZip.
 * opts: { includeZones = true, voidAs = 'occupied' | 'unknown', route, modelName }
 */
function exportRosMaps(navState, opts = {}) {
  const o = { includeZones: true, voidAs: 'occupied', ...opts };
  const robot = navState.robot;
  const files = [];
  const levels = [];
  const used = new Set();
  [...navState.levels.values()].sort((a, b) => a.grid.floorY - b.grid.floorY).forEach((lv, n) => {
    const g = lv.grid;
    let base = `level_${n}_${slugify(g.levelName)}`;
    while (used.has(base)) base += '_';
    used.add(base);
    const enc = new TextEncoder();
    // ASCII-only header (comments are allowed by the PGM spec and read by GraphicsMagick).
    const header = enc.encode(`P5\n# BIM2Bot Lab: ${String(g.levelName).replace(/[^\x20-\x7e]/g, '?')}\n${g.w} ${g.h}\n255\n`);
    const pgm = new Uint8Array(header.length + g.w * g.h);
    pgm.set(header, 0);
    let occ = 0, free = 0, unk = 0;
    // PGM row 0 is the top of the image (largest map y = −z0), which is grid row j = 0.
    for (let k = 0; k < g.w * g.h; k++) {
      const v = rosCellValue(lv, k, robot, o);
      pgm[header.length + k] = v;
      if (v === ROS_OCCUPIED) occ++; else if (v === ROS_FREE) free++; else unk++;
    }
    const origin = toMapXY(g.x0, g.z0 + g.h * g.res); // pose of the lower-left pixel
    const yaml = [
      `# ${g.levelName}: floor at ${num(g.floorY, 3)} m (model height), ${g.w} x ${g.h} cells`,
      `# Exported by BIM2Bot Lab for robot "${robot.name}" (height ${robot.height} m). Not inflated: Nav2 inflates its own costmap.`,
      `image: ${base}.pgm`,
      'mode: trinary',
      `resolution: ${num(g.res, 4)}`,
      `origin: [${num(origin[0])}, ${num(origin[1])}, 0.0]`,
      'negate: 0',
      'occupied_thresh: 0.65',
      // 0.196 (as written by map_saver) keeps 205 unknown: occ = (255 − 205) / 255 = 0.19608 is not < 0.196.
      'free_thresh: 0.196',
      '',
    ].join('\n');
    files.push({ name: `${base}.pgm`, data: pgm }, { name: `${base}.yaml`, data: yaml });
    levels.push({ levelId: g.levelId, name: g.levelName, base, w: g.w, h: g.h, occupied: occ, free, unknown: unk });
  });

  let goals = [];
  if (o.route) {
    files.push({ name: 'route_waypoints.yaml', data: routeWaypointsYaml(navState, o.route, levels) });
    goals = followWaypointGoals(o.route, levels);
    goals.forEach(gl => files.push({ name: gl.name, data: gl.data }));
  }
  files.push({ name: 'README.txt', data: rosReadme(navState, levels, o, goals) });
  return { files, levels, goals };
}

/** Map-frame poses with yaw along the path for one drive leg. */
function legPoses(points) {
  const pts = points.map(p => toMapXY(p[0], p[2]));
  let yaw = 0;
  return pts.map((p, i) => {
    const nx = pts[i + 1];
    if (nx && (nx[0] !== p[0] || nx[1] !== p[1])) yaw = Math.atan2(nx[1] - p[1], nx[0] - p[0]);
    return { x: p[0], y: p[1], yaw };
  });
}

/**
 * One nav2_msgs/action/FollowWaypoints goal per drive leg, in the YAML form `ros2 action send_goal`
 * accepts directly. The first pose (where the robot already is) is dropped.
 */
function followWaypointGoals(route, levels) {
  const out = [];
  let n = 0;
  route.legs.forEach(l => {
    if (l.type !== 'walk' || !l.points || l.points.length < 2) return;
    const poses = legPoses(l.points).slice(1);
    const base = (levels.find(v => v.levelId === l.levelId) || {}).base || `level_${l.levelId}`;
    const name = `route_leg_${n}_${base}_follow_waypoints.yaml`;
    const lines = [
      `# nav2_msgs/action/FollowWaypoints goal for drive leg ${n} on ${base}.yaml (map frame).`,
      `# ros2 action send_goal /follow_waypoints nav2_msgs/action/FollowWaypoints "$(cat ${name})"`,
      'poses:',
    ];
    poses.forEach(p => {
      lines.push(
        '  - header: {frame_id: map}',
        `    pose: {position: {x: ${num(p.x, 3)}, y: ${num(p.y, 3)}, z: 0.0}, orientation: {x: 0.0, y: 0.0, z: ${num(Math.sin(p.yaw / 2), 6)}, w: ${num(Math.cos(p.yaw / 2), 6)}}}`,
      );
    });
    lines.push('');
    out.push({ name, data: lines.join('\n'), map: `${base}.yaml`, levelId: l.levelId, poses: poses.length });
    n++;
  });
  return out;
}

/** Waypoints in the map frame, one block per leg; yaw points along the path. */
function routeWaypointsYaml(navState, route, levels) {
  const baseOf = (id) => (levels.find(l => l.levelId === id) || {}).base;
  const nameOf = (id) => (navState.levels.get(id) ? navState.levels.get(id).grid.levelName : String(id));
  const q = (s) => JSON.stringify(String(s));
  const lines = ['# Route from BIM2Bot Lab, ROS map frame (x right, y up, yaw counter-clockwise in radians).', 'frame_id: map', 'legs:'];
  route.legs.forEach(l => {
    if (l.type !== 'walk') {
      lines.push(`  - type: ${l.type}`, `    from_level: ${q(nameOf(l.fromLevelId))}`, `    to_level: ${q(nameOf(l.toLevelId))}`);
      return;
    }
    lines.push('  - type: drive', `    level: ${q(nameOf(l.levelId))}`, `    map: ${baseOf(l.levelId)}.yaml`, '    poses:');
    legPoses(l.points).forEach(p => lines.push(`      - {x: ${num(p.x, 3)}, y: ${num(p.y, 3)}, yaw: ${num(p.yaw, 4)}}`));
  });
  lines.push('');
  return lines.join('\n');
}

function rosReadme(navState, levels, o, goals = []) {
  const m = navState.navMap.model;
  const first = levels[0] ? levels[0].base : 'level_0';
  return [
    'BIM2Bot Lab: ROS 2 occupancy maps',
    '==================================',
    '',
    `Model: ${m ? m.fileName : 'unknown'}`,
    `Robot: ${navState.robot.name} (width ${navState.robot.width} m, height ${navState.robot.height} m)`,
    `Cell size: ${navState.navMap.res} m`,
    '',
    'These are standard map_server files (binary PGM + YAML, trinary mode), the same format',
    'map_saver writes. They load as they are; no conversion is needed. One map per level.',
    '',
    'With Nav2 bringup (localization or full navigation):',
    `  ros2 launch nav2_bringup bringup_launch.py map:=$PWD/${first}.yaml`,
    '',
    'Or the map server on its own (it is a lifecycle node):',
    `  ros2 run nav2_map_server map_server --ros-args -p yaml_filename:=$PWD/${first}.yaml`,
    '  ros2 lifecycle set /map_server configure',
    '  ros2 lifecycle set /map_server activate',
    '',
    'Switch level at runtime:',
    `  ros2 service call /map_server/load_map nav2_msgs/srv/LoadMap "{map_url: $PWD/${levels[1] ? levels[1].base : first}.yaml}"`,
    '',
    ...(goals.length ? [
      'Route: route_waypoints.yaml lists every leg (drive legs as map-frame poses, lift and stair legs',
      'as level changes). Each drive leg is also a ready FollowWaypoints goal:',
      ...goals.map(gl => `  ${gl.name}  (${gl.poses} poses on ${gl.map})\n    ros2 action send_goal /follow_waypoints nav2_msgs/action/FollowWaypoints "$(cat ${gl.name})"`),
      'Load the matching level map before sending a leg. Lifts and stairs are not driven by Nav2.',
      '',
    ] : []),
    'Cells:',
    '  0   (black)  occupied: geometry lower than the robot height, what-if obstacles, blocked doors' + (o.includeZones ? ', no-go zones' : ''),
    '  254 (white)  free floor and door openings',
    `  205 (grey)   unknown${o.voidAs === 'unknown' ? ': cells without a floor' : ' (not used; cells without a floor are exported as occupied)'}`,
    '',
    'The map is not inflated. Robot clearance is left to the Nav2 inflation layer.',
    'Slow zones are not part of an occupancy map and are not exported.',
    '',
    'Frame: x_map = IFC X and y_map = IFC Y after web-ifc moves the model near the origin.',
    'To align with a site survey, add the model offset from the IFC site placement (IfcSite / IfcMapConversion).',
    '',
    levels.map(l => `${l.base}: ${l.name}, ${l.w} x ${l.h} cells (${l.occupied} occupied, ${l.free} free, ${l.unknown} unknown)`).join('\n'),
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Route comparison
// ---------------------------------------------------------------------------
const ENERGY_DEFAULTS = { driveWhPerM: 0.05, climbWhPerM: 0.5, idleW: 20 };
const TIME_DEFAULTS = { speed: 0.8, liftSpeed: 1.0, liftDoorTime: 3, stairSpeedFactor: 0.4 };

/** Drive time along a polyline, honouring slow zones (sampled every 0.1 m). */
function legDriveTime(lv, points, speed) {
  let t = 0;
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1], b = points[k];
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const n = Math.max(1, Math.ceil(len / 0.1));
    for (let s = 0; s < n; s++) {
      const u = (s + 0.5) / n;
      const f = slowFactorAt(lv, cellIndex(lv.grid, a[0] + (b[0] - a[0]) * u, a[2] + (b[2] - a[2]) * u));
      t += (len / n) / (speed * f);
    }
  }
  return t;
}

/** Distance, time and energy for one grid route. */
function routeMetrics(navState, route, params = {}) {
  const p = { ...TIME_DEFAULTS, ...ENERGY_DEFAULTS, ...params };
  let drive = 0, driveT = 0, liftT = 0, stairT = 0, climb = 0, lifts = 0, stairs = 0, changes = 0;
  route.legs.forEach(l => {
    if (l.type === 'walk') {
      const lv = navState.levels.get(l.levelId);
      for (let k = 1; k < l.points.length; k++) drive += Math.hypot(l.points[k][0] - l.points[k - 1][0], l.points[k][2] - l.points[k - 1][2]);
      driveT += legDriveTime(lv, l.points, p.speed);
      return;
    }
    changes++;
    const tr = l.transition;
    const dy = Math.abs(tr.dy);
    if (l.type === 'lift') {
      lifts++;
      liftT += dy / p.liftSpeed + 2 * p.liftDoorTime; // ride plus doors at both ends; queueing not included
    } else {
      stairs++;
      climb += dy;
      const a = cellCenter(navState.levels.get(tr.a.levelId).grid, tr.a.cell);
      const b = cellCenter(navState.levels.get(tr.b.levelId).grid, tr.b.cell);
      stairT += (dy * 1.8 + Math.hypot(b[0] - a[0], b[2] - a[2])) / (p.speed * p.stairSpeedFactor); // same model as the simulator
    }
  });
  const time = driveT + liftT + stairT;
  const energyWh = drive * p.driveWhPerM + climb * p.climbWhPerM + (time * p.idleW) / 3600;
  return { drive, time, driveT, liftT, stairT, climb, lifts, stairs, changes, energyWh };
}

const ROUTE_VARIANTS = [
  { id: 'default', label: 'Recommended', note: 'The planner’s own choice: shortest in time, keeping clear of walls' },
  { id: 'fewest', label: 'Fewest level changes', note: 'Each level change costs as much as 200 m of driving', opts: { transitionPenalty: 200 } },
  { id: 'nolift', label: 'No lifts', note: 'Lifts are left out', opts: { avoid: new Set(['lift']) }, needs: 'lift' },
  { id: 'nostairs', label: 'No stairs', note: 'Stairs and escalators are left out', opts: { avoid: new Set(['stair']) }, needs: 'stair' },
];

function routeSignature(route) {
  return route.legs.map(l => (l.type === 'walk' ? `w${l.levelId}:${l.points.length}:${l.points[l.points.length - 1].map(v => v.toFixed(1)).join(',')}` : `${l.type}:${l.transition.id}`)).join('|') + `|${route.length.toFixed(2)}`;
}

/** Plan each variant; variants that give the same path as an earlier one are flagged sameAs. */
function compareRoutes(navState, from, to, params = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const usable = new Set(navState.transitions.filter(t => t.usable && !t.blocked).map(t => (t.kind === 'lift' ? 'lift' : t.kind === 'stair' || t.kind === 'escalator' ? 'stair' : t.kind)));
  const out = [];
  const seen = new Map();
  ROUTE_VARIANTS.forEach(v => {
    if (v.needs && !usable.has(v.needs)) return;
    const route = planGridRoute(navState, from, to, v.opts || {});
    if (!route) { out.push({ ...v, route: null, metrics: null, sameAs: null }); return; }
    const sig = routeSignature(route);
    const sameAs = seen.has(sig) ? seen.get(sig) : null;
    if (!sameAs) seen.set(sig, v.label);
    out.push({ ...v, route, metrics: routeMetrics(navState, route, params), sameAs });
  });
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { variants: out, ms: t1 - t0 };
}

// ---------------------------------------------------------------------------
// Simulated 2D LiDAR
// ---------------------------------------------------------------------------
const LIDAR_DEFAULTS = { beams: 360, fov: 360, range: 10, rangeMin: 0.05, mountHeight: 0.3, noise: 0 };

function lidarRng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Does a grid cell stop a horizontal beam at height h above the floor? */
function lidarBlocks(lv, k, h) {
  const st = lv.state[k];
  if (st === CELL.BLOCKED || st === CELL.USER) return true; // closed doors and placed obstacles
  const g = lv.grid;
  if (g.door[k] >= 0) return false;                         // open door leaf
  return g.obsLow[k] <= h && g.obsHigh[k] >= h;
}

/**
 * pose: { levelId, x, z, heading } (heading in model radians, atan2(dz, dx)).
 * dynamic: [{ x, z, r }] circles (people, other robots) on the same level.
 * Returns { ranges, anglesMap, hitsModel, cfg } with angles in the ROS sensor frame
 * (counter-clockwise from the robot's forward axis) and hit points in model coordinates.
 */
function lidarScan(navState, pose, cfg = {}, dynamic = [], seed = 1) {
  const c = { ...LIDAR_DEFAULTS, ...cfg };
  const lv = navState.levels.get(pose.levelId);
  const n = Math.max(1, Math.round(c.beams));
  const ranges = new Float32Array(n);
  const angles = new Float32Array(n);
  const hits = new Float32Array(n * 2);
  const fov = Math.min(360, Math.max(1, c.fov)) * Math.PI / 180;
  const inc = c.fov >= 360 ? fov / n : (n > 1 ? fov / (n - 1) : 0);
  const amin = c.fov >= 360 ? -Math.PI : -fov / 2;
  const rng = c.noise > 0 ? lidarRng(seed) : null;
  const gauss = () => { const u = Math.max(1e-12, rng()), v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  for (let b = 0; b < n; b++) {
    const phi = amin + b * inc;          // ROS sensor angle (counter-clockwise, seen from above)
    const a = pose.heading - phi;        // model angle: y_map = −z flips the rotation sense
    const dx = Math.cos(a), dz = Math.sin(a);
    let r = lv ? marchGrid(lv, pose.x, pose.z, dx, dz, c.range, c.mountHeight) : c.range;
    for (const o of dynamic) {
      const t = rayCircle(pose.x, pose.z, dx, dz, o.x, o.z, o.r);
      if (t != null && t < r) r = t;
    }
    if (rng && r < c.range) r = Math.min(c.range, Math.max(c.rangeMin, r + gauss() * c.noise));
    ranges[b] = r;
    angles[b] = phi;
    hits[b * 2] = pose.x + dx * r;
    hits[b * 2 + 1] = pose.z + dz * r;
  }
  return { ranges, angles, hits, cfg: c, angleMin: amin, angleIncrement: inc, pose: { ...pose } };
}

/** Amanatides–Woo traversal; distance to the first blocking cell boundary, or maxR. */
function marchGrid(lv, x, z, dx, dz, maxR, h) {
  const g = lv.grid;
  let i = Math.floor((x - g.x0) / g.res);
  let j = Math.floor((z - g.z0) / g.res);
  const stepI = dx > 0 ? 1 : -1, stepJ = dz > 0 ? 1 : -1;
  const tDeltaI = dx !== 0 ? Math.abs(g.res / dx) : Infinity;
  const tDeltaJ = dz !== 0 ? Math.abs(g.res / dz) : Infinity;
  const nextI = g.x0 + (i + (dx > 0 ? 1 : 0)) * g.res;
  const nextJ = g.z0 + (j + (dz > 0 ? 1 : 0)) * g.res;
  let tMaxI = dx !== 0 ? (nextI - x) / dx : Infinity;
  let tMaxJ = dz !== 0 ? (nextJ - z) / dz : Infinity;
  let t = 0;
  // The cell the sensor sits in never blocks its own beam.
  while (t <= maxR) {
    if (tMaxI < tMaxJ) { t = tMaxI; tMaxI += tDeltaI; i += stepI; }
    else { t = tMaxJ; tMaxJ += tDeltaJ; j += stepJ; }
    if (t > maxR) break;
    if (i < 0 || j < 0 || i >= g.w || j >= g.h) return maxR;
    if (lidarBlocks(lv, j * g.w + i, h)) return t;
  }
  return maxR;
}

function rayCircle(px, pz, dx, dz, cx, cz, r) {
  const ox = px - cx, oz = pz - cz;
  const b = ox * dx + oz * dz;
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t1 = -b - s;
  if (t1 > 1e-4) return t1;
  const t2 = -b + s;
  return c < 0 ? null : (t2 > 1e-4 ? t2 : null); // inside the circle: ignore
}

/** A sensor_msgs/LaserScan-shaped JSON document for one scan. */
function lidarScanJson(scan, meta = {}) {
  const c = scan.cfg;
  return {
    header: { frame_id: meta.frame || 'base_scan', stamp_s: meta.time != null ? Number(meta.time.toFixed(3)) : 0 },
    angle_min: Number(scan.angleMin.toFixed(6)),
    angle_max: Number((scan.angleMin + scan.angleIncrement * (scan.ranges.length - 1)).toFixed(6)),
    angle_increment: Number(scan.angleIncrement.toFixed(6)),
    range_min: c.rangeMin,
    range_max: c.range,
    ranges: Array.from(scan.ranges, r => (r >= c.range ? null : Number(r.toFixed(4)))),
    simulated: true,
    sensor: { mount_height_m: c.mountHeight, noise_sigma_m: c.noise, beams: scan.ranges.length, fov_deg: c.fov },
    pose_map: (() => { const [x, y] = toMapXY(scan.pose.x, scan.pose.z); return { x: Number(x.toFixed(3)), y: Number(y.toFixed(3)), yaw: Number((-scan.pose.heading).toFixed(4)) }; })(),
    note: 'Simulated from the IFC-derived occupancy grid: beams stop at the first cell whose geometry spans the sensor height. Ranges at or beyond range_max are null. Not live sensor data.',
    ...meta.extra,
  };
}

Object.assign(window, {
  makeZip, crc32, exportRosMaps, ROS_OCCUPIED, ROS_FREE, ROS_UNKNOWN,
  compareRoutes, routeMetrics, ROUTE_VARIANTS, ENERGY_DEFAULTS, TIME_DEFAULTS,
  lidarScan, lidarScanJson, LIDAR_DEFAULTS,
});
