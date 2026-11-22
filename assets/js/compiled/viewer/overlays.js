(() => {
  const NAV_COLORS = {
    light: { signal: 14702095, route: 14702095, edge: 14254635, blocked: 12988218, space: 2056127, door: 14702095, landing: 8015825, opening: 3120783, start: 2056127, goal: 14702095 },
    dark: { signal: 16747069, route: 16747069, edge: 16753248, blocked: 16734820, space: 6990079, door: 16747069, landing: 11768831, opening: 5231037, start: 6990079, goal: 16747069 }
  };
  function overlayMaterial(color, opts = {}) {
    return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opts.opacity != null ? opts.opacity : 1, depthTest: false, depthWrite: false });
  }
  function buildTopologyOverlay(graph, opts = {}) {
    const colors = NAV_COLORS[opts.theme === "dark" ? "dark" : "light"];
    const blocked = opts.blocked || /* @__PURE__ */ new Set();
    const robot = opts.robot || DEFAULT_ROBOT_PROFILE;
    const levelFilter = opts.levelId != null && opts.levelId !== "all" ? Number(opts.levelId) : null;
    const lift = 0.06;
    const group = new THREE.Group();
    const onLevel = (n) => levelFilter == null || n.levelId === levelFilter;
    const ok = [];
    const bad = [];
    graph.edges.forEach((e) => {
      const a = graph.nodes.get(e.a);
      const b = graph.nodes.get(e.b);
      if (!a || !b || !onLevel(a) && !onLevel(b)) return;
      const usable = edgeUsableForOverlay(e, graph, robot, blocked);
      (usable ? ok : bad).push(a.position[0], a.position[1] + lift, a.position[2], b.position[0], b.position[1] + lift, b.position[2]);
    });
    const lines = (arr, color, opacity) => {
      if (!arr.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false }));
      l.renderOrder = 30;
      group.add(l);
    };
    lines(ok, colors.edge, 0.85);
    lines(bad, colors.blocked, 0.6);
    const geos = {
      space: new THREE.CylinderGeometry(0.26, 0.26, 0.05, 28),
      door: new THREE.BoxGeometry(0.22, 0.22, 0.22),
      opening: new THREE.CylinderGeometry(0.15, 0.15, 0.05, 20),
      landing: new THREE.OctahedronGeometry(0.22)
    };
    graph.nodes.forEach((n) => {
      if (!onLevel(n)) return;
      let color = colors[n.kind] || colors.signal;
      const isBlocked = blocked.has(n.elementId);
      if (n.kind === "door" && (isBlocked || !doorPassable(graph.doors.get(n.elementId), robot))) color = colors.blocked;
      if (n.kind === "opening" && isBlocked) color = colors.blocked;
      const mesh = new THREE.Mesh(geos[n.kind], overlayMaterial(color, { opacity: 0.95 }));
      mesh.position.set(n.position[0], n.position[1] + lift, n.position[2]);
      if (n.kind === "door") mesh.rotation.y = Math.PI / 4;
      mesh.renderOrder = 31;
      mesh.userData.pick = n.kind === "opening" ? n.elementIds[0] : n.elementId;
      mesh.userData.overlayKey = n.key;
      group.add(mesh);
    });
    return group;
  }
  function edgeUsableForOverlay(e, graph, robot, blocked) {
    if (blocked.has(e.elementId)) return false;
    if (e.kind === "portal") return doorPassable(graph.doors.get(e.elementId), robot);
    if (e.kind === "open") return doorPassable(graph.openings.get(e.elementId), robot);
    if (e.kind === "stair" || e.kind === "escalator") return !!robot.canUseStairs;
    if (e.kind === "lift") return !!robot.canUseLifts;
    return true;
  }
  function buildRouteOverlay(route, opts = {}) {
    const colors = NAV_COLORS[opts.theme === "dark" ? "dark" : "light"];
    const group = new THREE.Group();
    if (!route || route.points.length < 2) return group;
    const lift = 0.12;
    const pts = route.points.map((p) => new THREE.Vector3(p[0], p[1] + lift, p[2]));
    const path = new THREE.CurvePath();
    for (let i = 0; i + 1 < pts.length; i++) {
      if (pts[i].distanceTo(pts[i + 1]) > 1e-4) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
    }
    if (path.curves.length) {
      const tube = new THREE.Mesh(new THREE.TubeGeometry(path, Math.max(8, path.curves.length * 12), 0.07, 8, false), overlayMaterial(colors.route));
      tube.renderOrder = 33;
      group.add(tube);
    }
    const ring = (p, color) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 10, 36), overlayMaterial(color));
      m.rotation.x = Math.PI / 2;
      m.position.copy(p);
      m.renderOrder = 34;
      group.add(m);
    };
    ring(pts[0], colors.start);
    ring(pts[pts.length - 1], colors.goal);
    return group;
  }
  const GRID_RGBA = {
    light: [[0, 0, 0, 0], [47, 158, 143, 46], [198, 47, 58, 215], [224, 86, 15, 92], [47, 158, 143, 200], [224, 86, 15, 245], [120, 16, 28, 235], [150, 40, 150, 190]],
    dark: [[0, 0, 0, 0], [79, 209, 189, 46], [255, 107, 116, 215], [255, 138, 61, 92], [79, 209, 189, 200], [255, 138, 61, 245], [190, 40, 55, 235], [214, 112, 214, 190]]
  };
  const SLOW_RGBA = { light: [201, 133, 0, 120], dark: [237, 161, 0, 120] };
  function planeForGrid(g, canvas, lift) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    const W = g.w * g.res, H = g.h * g.res;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(g.x0 + W / 2, g.floorY + lift, g.z0 + H / 2);
    plane.renderOrder = 25;
    plane.userData.gridLevel = g.levelId;
    return plane;
  }
  function buildGridOverlay(navState, opts = {}) {
    const palette = GRID_RGBA[opts.theme === "dark" ? "dark" : "light"];
    const slowC = SLOW_RGBA[opts.theme === "dark" ? "dark" : "light"];
    const group = new THREE.Group();
    const only = opts.levelId != null && opts.levelId !== "all" ? Number(opts.levelId) : null;
    navState.levels.forEach((lv) => {
      const g = lv.grid;
      if (only != null && g.levelId !== only) return;
      if (only == null && !lv.freeCells) return;
      const canvas = document.createElement("canvas");
      canvas.width = g.w;
      canvas.height = g.h;
      const ctx = canvas.getContext("2d");
      const img = ctx.createImageData(g.w, g.h);
      for (let k = 0; k < lv.state.length; k++) {
        const st = lv.state[k];
        const c = lv.slow && lv.slow[k] < 1 && (st === CELL.FREE || st === CELL.DOOR || st === CELL.INFLATED) ? slowC : palette[st];
        img.data[k * 4] = c[0];
        img.data[k * 4 + 1] = c[1];
        img.data[k * 4 + 2] = c[2];
        img.data[k * 4 + 3] = c[3];
      }
      ctx.putImageData(img, 0, 0);
      group.add(planeForGrid(g, canvas, 0.03));
    });
    return group;
  }
  function buildHeatOverlay(sim, opts = {}) {
    const group = new THREE.Group();
    let max = 0;
    sim.heat.forEach((arr) => {
      for (let k = 0; k < arr.length; k++) if (arr[k] > max) max = arr[k];
    });
    if (max <= 0) return group;
    const only = opts.levelId != null && opts.levelId !== "all" ? Number(opts.levelId) : null;
    sim.heat.forEach((arr, levelId) => {
      if (only != null && levelId !== only) return;
      const g = sim.nav.levels.get(levelId).grid;
      const canvas = document.createElement("canvas");
      canvas.width = g.w;
      canvas.height = g.h;
      const ctx = canvas.getContext("2d");
      const img = ctx.createImageData(g.w, g.h);
      const blurred = new Float32Array(arr.length);
      for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
        const v = arr[j * g.w + i];
        if (!v) continue;
        for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= g.w || nj >= g.h) continue;
          blurred[nj * g.w + ni] += v * Math.exp(-(di * di + dj * dj) / 5);
        }
      }
      let bmax = 0;
      for (let k = 0; k < blurred.length; k++) if (blurred[k] > bmax) bmax = blurred[k];
      for (let k = 0; k < blurred.length; k++) {
        const t = bmax ? Math.sqrt(blurred[k] / bmax) : 0;
        if (t < 0.03) continue;
        img.data[k * 4] = 255;
        img.data[k * 4 + 1] = Math.round(190 - 110 * t);
        img.data[k * 4 + 2] = Math.round(70 - 60 * t);
        img.data[k * 4 + 3] = Math.round(40 + 190 * t);
      }
      ctx.putImageData(img, 0, 0);
      group.add(planeForGrid(g, canvas, 0.05));
    });
    return group;
  }
  function buildGridRouteOverlay(route, opts = {}) {
    const pts = [];
    route.legs.forEach((l) => {
      if (l.points) l.points.forEach((p) => pts.push(p));
    });
    return buildRouteOverlay({ points: pts }, opts);
  }
  function buildMarkersOverlay({ building, theme, start, goal, missions = [], missionPaths = [], pending }) {
    const colors = NAV_COLORS[theme === "dark" ? "dark" : "light"];
    const palette = theme === "dark" ? ROBOT_COLORS_DARK : ROBOT_COLORS;
    const group = new THREE.Group();
    const floorY = (lid) => {
      const l = building.levels.find((x) => x.id === lid);
      return l && l.floorY != null ? l.floorY : 0;
    };
    const pin = (pt, color, square) => {
      if (!pt) return null;
      const y = floorY(pt.levelId);
      const g = new THREE.Group();
      const base = new THREE.Mesh(square ? new THREE.BoxGeometry(0.5, 0.04, 0.5) : new THREE.CylinderGeometry(0.28, 0.28, 0.04, 28), overlayMaterial(color));
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.4, 8), overlayMaterial(color));
      mast.position.y = 0.7;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), overlayMaterial(color));
      head.position.y = 1.45;
      g.add(base, mast, head);
      g.position.set(pt.x, y + 0.03, pt.z);
      g.traverse((o) => {
        o.renderOrder = 36;
      });
      group.add(g);
      return g;
    };
    pin(start, colors.start);
    pin(goal, colors.goal);
    missions.forEach((m, i) => {
      const c = palette[i % palette.length];
      pin(m.start, c, false);
      pin(m.goal, c, true);
      (missionPaths[i] || []).forEach((leg) => {
        const y = floorY(leg.levelId) + 0.08;
        const geo = new THREE.BufferGeometry().setFromPoints(leg.points.map((q) => new THREE.Vector3(q[0], y, q[2])));
        const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: c, dashSize: 0.3, gapSize: 0.2, depthTest: false, transparent: true }));
        line.computeLineDistances();
        line.renderOrder = 35;
        group.add(line);
      });
    });
    if (pending) pin(pending, colors.start, false);
    return group;
  }
  function robotKindOf(robot) {
    if (!robot) return "wheeled";
    if (["wheeled", "compact", "legged", "wide"].includes(robot.id)) return robot.id;
    if (robot.canUseStairs) return "legged";
    if (robot.width < 0.5) return "compact";
    if (robot.width > 0.8) return "wide";
    return "wheeled";
  }
  function buildRobotModel(kind, width, accentColor) {
    const g = new THREE.Group();
    const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.05, ...extra });
    const accent = std(accentColor, { roughness: 0.4 });
    const glow = std(accentColor, { emissive: accentColor, emissiveIntensity: 0.8 });
    const white = std(15988215, { roughness: 0.35 });
    const light = std(13225684, { roughness: 0.4 });
    const dark = std(2764598, { roughness: 0.6 });
    const black = std(1118999, { roughness: 0.3, metalness: 0.2 });
    const steel = std(13620699, { roughness: 0.28, metalness: 0.65 });
    const add = (geo, mat, x = 0, y = 0, z = 0, parent = g) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };
    const cyl = (rt, rb, h, seg = 40) => new THREE.CylinderGeometry(rt, rb, h, seg);
    const wheels = [], spinners = [], legs = [];
    const wheel = (r, w, x, z) => {
      const m = add(cyl(r, r, w, 22), black, x, r, z);
      m.rotation.x = Math.PI / 2;
      const hub = add(new THREE.BoxGeometry(r * 1.3, w * 1.05, r * 0.25), light, 0, 0, 0, m);
      hub.rotation.y = 0;
      wheels.push({ mesh: m, r });
    };
    if (kind === "compact") {
      const R = width / 2;
      add(cyl(R, R, 0.09), dark, 0, 0.065, 0);
      const bump = add(new THREE.TorusGeometry(R, 0.012, 8, 48), accent, 0, 0.06, 0);
      bump.rotation.x = Math.PI / 2;
      wheel(0.035, 0.025, 0, R + 0.01);
      wheel(0.035, 0.025, 0, -R - 0.01);
      [[0.13, black], [0.26, accent], [0.38, black]].forEach(([y, mat]) => add(cyl(R * 0.94, R * 0.94, y === 0.26 ? 0.03 : 0.012), mat, 0, y, 0));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(cyl(8e-3, 8e-3, 0.26, 8), steel, sx * R * 0.55, 0.255, sz * R * 0.55);
      const ring = add(new THREE.TorusGeometry(R * 0.94, 6e-3, 6, 48), glow, 0, 0.137, 0);
      ring.rotation.x = Math.PI / 2;
      add(cyl(0.045, 0.05, 0.04, 24), black, 0, 0.405, 0);
      const top = add(cyl(0.04, 0.04, 0.03, 24), dark, 0, 0.44, 0);
      add(new THREE.BoxGeometry(0.02, 0.012, 0.03), glow, 0.035, 0, 0, top);
      spinners.push(top);
      add(new THREE.BoxGeometry(0.035, 0.035, 0.1), black, R * 0.72, 0.41, 0);
    } else if (kind === "legged") {
      const L = width * 2, BW = width * 0.72, BH = 0.16, hipY = 0.53;
      add(new THREE.BoxGeometry(L, BH, BW), accent, 0, hipY + 0.06, 0);
      add(new THREE.BoxGeometry(L * 0.82, 0.035, BW * 0.82), dark, 0, hipY + 0.06 + BH / 2 + 0.015, 0);
      add(new THREE.BoxGeometry(0.12, 0.11, BW * 0.85), black, L / 2 + 0.04, hipY + 0.05, 0);
      for (const z of [-0.06, 0.06]) add(new THREE.SphereGeometry(0.018, 12, 8), glow, L / 2 + 0.1, hipY + 0.06, z);
      add(new THREE.BoxGeometry(0.1, 0.09, BW * 0.7), black, -L / 2 - 0.03, hipY + 0.05, 0);
      const thighGeo = new THREE.BoxGeometry(0.065, 0.28, 0.065);
      thighGeo.translate(0, -0.14, 0);
      const shinGeo = new THREE.BoxGeometry(0.04, 0.3, 0.04);
      shinGeo.translate(0, -0.15, 0);
      const corners = [[1, 1, 0], [1, -1, Math.PI], [-1, 1, Math.PI], [-1, -1, 0]];
      corners.forEach(([sx, sz, off]) => {
        const hip = new THREE.Group();
        hip.position.set(sx * (L / 2 - 0.1), hipY, sz * (BW / 2 + 0.045));
        g.add(hip);
        add(new THREE.SphereGeometry(0.055, 14, 10), black, 0, 0, 0, hip);
        const thigh = add(thighGeo, dark, 0, 0, 0, hip);
        const knee = new THREE.Group();
        knee.position.y = -0.28;
        thigh.add(knee);
        add(new THREE.SphereGeometry(0.035, 12, 8), black, 0, 0, 0, knee);
        const shin = add(shinGeo, light, 0, 0, 0, knee);
        add(new THREE.SphereGeometry(0.03, 12, 8), black, 0, -0.3, 0, shin);
        legs.push({ thigh, shin, off });
      });
    } else if (kind === "wide") {
      const L = Math.max(0.9, width), W = width;
      add(new THREE.BoxGeometry(L, 0.2, W), dark, 0, 0.13, 0);
      add(new THREE.BoxGeometry(L + 0.02, 0.045, W + 0.02), accent, 0, 0.1, 0);
      add(new THREE.BoxGeometry(0.02, 0.05, W * 0.7), black, L / 2 + 0.012, 0.19, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheel(0.05, 0.04, sx * L * 0.33, sz * (W / 2 + 5e-3));
      add(new THREE.BoxGeometry(L * 0.92, 1.12, W * 0.92), steel, 0, 0.24 + 0.56, 0);
      for (const sz of [-1, 1]) add(new THREE.BoxGeometry(L * 0.88, 0.9, 8e-3), accent, 0, 0.82, sz * (W * 0.46 + 2e-3));
      for (const y of [0.52, 0.82, 1.1]) for (const sz of [-1, 1]) add(new THREE.BoxGeometry(L * 0.84, 0.012, 6e-3), dark, 0, y, sz * (W * 0.46 + 3e-3));
      add(new THREE.BoxGeometry(L * 0.92, 0.035, W * 0.92), glow, 0, 1.375, 0);
      add(new THREE.BoxGeometry(0.02, 0.2, 0.32), black, L * 0.46 + 0.011, 1.12, 0);
      add(new THREE.BoxGeometry(0.04, 0.04, W * 0.8), light, -L * 0.46 - 0.05, 1.05, 0);
    } else {
      const R = width / 2;
      add(cyl(R, R * 1.02, 0.22), dark, 0, 0.13, 0);
      const bump = add(new THREE.TorusGeometry(R * 1.01, 0.022, 8, 48), accent, 0, 0.1, 0);
      bump.rotation.x = Math.PI / 2;
      wheel(0.07, 0.04, 0, R * 0.98);
      wheel(0.07, 0.04, 0, -R * 0.98);
      add(cyl(R * 0.97, R * 0.97, 0.05), black, 0, 0.265, 0);
      add(cyl(R * 0.78, R * 0.9, 0.72), accent, 0, 0.29 + 0.36, 0);
      [0.58, 0.86].forEach((y) => add(cyl(R * 0.98, R * 0.98, 0.025), white, 0, y, 0));
      add(cyl(R * 0.64, R * 0.72, 0.26), white, 0, 1.14, 0);
      add(new THREE.BoxGeometry(0.02, 0.15, R * 0.95), black, R * 0.66, 1.14, 0);
      for (const z of [-0.055, 0.055]) add(new THREE.SphereGeometry(0.02, 12, 8), glow, R * 0.675, 1.16, z);
      const top = add(new THREE.TorusGeometry(R * 0.5, 0.012, 6, 40), glow, 0, 1.272, 0);
      top.rotation.x = Math.PI / 2;
    }
    return { group: g, wheels, spinners, legs, kind };
  }
  function animateRobotModel(model, dist, moving, t) {
    model.wheels.forEach((w) => {
      w.mesh.rotation.y -= dist / w.r;
    });
    model.spinners.forEach((s) => {
      s.rotation.y = t * 9;
    });
    if (model.legs.length) {
      model.phase = (model.phase || 0) + dist * (2 * Math.PI / 0.55);
      const amp = moving ? 1 : 0;
      model.legs.forEach(({ thigh, shin, off }) => {
        const p = model.phase + off;
        thigh.rotation.z = -0.55 + amp * 0.32 * Math.sin(p);
        shin.rotation.z = 1.05 + amp * 0.4 * Math.max(0, Math.cos(p));
      });
    }
  }
  function buildAgentsOverlay(sim, opts = {}) {
    const group = new THREE.Group();
    group.userData.noClip = true;
    const personGeo = new THREE.CapsuleGeometry(0.19, 1, 6, 14);
    const headGeo = new THREE.SphereGeometry(0.13, 16, 12);
    const palette = opts.theme === "dark" ? ROBOT_COLORS_DARK : ROBOT_COLORS;
    const profile = sim.scenario.robot || null;
    const kind = robotKindOf(profile);
    const width = profile && profile.width ? profile.width : 0.6;
    const depthReset = new THREE.Mesh(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3)), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }));
    depthReset.frustumCulled = false;
    depthReset.renderOrder = 39;
    depthReset.onBeforeRender = (renderer) => renderer.clearDepth();
    group.add(depthReset);
    const robots = sim.robots.map((rb) => {
      const g = new THREE.Group();
      const color = palette[rb.colorIndex] || rb.color;
      const model = buildRobotModel(kind, width, new THREE.Color(color));
      g.add(model.group);
      const ring = new THREE.Mesh(new THREE.RingGeometry(sim.scenario.safetyRadius - 0.03, sim.scenario.safetyRadius, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;
      g.add(ring);
      group.add(g);
      return { g, rb, model, last: null };
    });
    const personMat = new THREE.MeshStandardMaterial({ color: opts.theme === "dark" ? 14082800 : 3425882, roughness: 0.7 });
    const humans = sim.humans.map((h) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(personGeo, personMat);
      body.position.y = 0.72;
      const head = new THREE.Mesh(headGeo, personMat);
      head.position.y = 1.58;
      g.add(body, head);
      group.add(g);
      return { g, h };
    });
    const lifts = [...sim.lifts.values()].map((L) => {
      const car = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.1, 1.1), new THREE.MeshLambertMaterial({ color: 8015825, transparent: true, opacity: 0.35, depthWrite: false }));
      group.add(car);
      return { car, L };
    });
    const shown = (lid) => opts.isShown ? opts.isShown(lid) : true;
    const update = () => {
      const t = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1e3;
      robots.forEach((item) => {
        const { g, rb, model } = item;
        g.visible = shown(rb.levelId);
        let dist = 0;
        if (item.last && item.last.levelId === rb.levelId) dist = Math.hypot(rb.pos[0] - item.last.x, rb.pos[2] - item.last.z);
        if (dist > 2) dist = 0;
        item.last = { x: rb.pos[0], z: rb.pos[2], levelId: rb.levelId };
        g.position.set(rb.pos[0], rb.pos[1], rb.pos[2]);
        g.rotation.y = -rb.heading;
        animateRobotModel(model, dist, dist > 1e-4 || rb.state === "moving", t);
        const parked = rb.state === "done";
        if (g.userData.parked !== parked) {
          g.userData.parked = parked;
          g.traverse((o) => {
            if (!o.material || o === depthReset) return;
            if (o.userData.baseOpacity == null) o.userData.baseOpacity = o.material.opacity;
            o.material.opacity = o.userData.baseOpacity * (parked ? 0.35 : 1);
          });
        }
      });
      humans.forEach(({ g, h }) => {
        g.visible = shown(h.levelId);
        g.position.set(h.pos[0], h.pos[1], h.pos[2]);
      });
      lifts.forEach(({ car, L }) => car.position.set(L.shaft[0], L.carY + 1.05, L.shaft[1]));
    };
    group.traverse((o) => {
      if (!o.material || o === depthReset) return;
      o.material.transparent = true;
      o.renderOrder = 40;
    });
    update();
    return { group, update };
  }
  const LIDAR_RED = "#e0241b";
  const LIDAR_RED_DARK = "#ff5147";
  function lidarColor(colorIndex, fleetSize, theme) {
    const dark = theme === "dark";
    if (fleetSize <= 1) return dark ? LIDAR_RED_DARK : LIDAR_RED;
    const pal = dark ? ROBOT_COLORS_DARK : ROBOT_COLORS;
    return pal[colorIndex % pal.length] || (dark ? LIDAR_RED_DARK : LIDAR_RED);
  }
  function buildLidarOverlay(opts = {}) {
    const group = new THREE.Group();
    group.userData.noClip = true;
    const max = 1440;
    const layers = /* @__PURE__ */ new Map();
    const makeLayer = (color) => {
      const ptsGeo = new THREE.BufferGeometry();
      ptsGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(max * 3), 3));
      const points = new THREE.Points(ptsGeo, new THREE.PointsMaterial({ color, size: 5, sizeAttenuation: false, depthTest: false, transparent: true }));
      const rayGeo = new THREE.BufferGeometry();
      rayGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(max * 6), 3));
      const rays = new THREE.LineSegments(rayGeo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.22, depthTest: false }));
      points.renderOrder = 42;
      rays.renderOrder = 41;
      points.frustumCulled = false;
      rays.frustumCulled = false;
      group.add(rays, points);
      return { points, rays, ptsGeo, rayGeo, color };
    };
    const clear = (L) => {
      L.ptsGeo.setDrawRange(0, 0);
      L.rayGeo.setDrawRange(0, 0);
    };
    const update = (scans, fleetSize = 1) => {
      const seen = /* @__PURE__ */ new Set();
      (scans || []).forEach((scan) => {
        const id = scan.robotId != null ? scan.robotId : 0;
        seen.add(id);
        const color = lidarColor(scan.colorIndex || 0, fleetSize, opts.theme);
        let L = layers.get(id);
        if (L && L.color !== color) {
          L.points.material.color.set(color);
          L.rays.material.color.set(color);
          L.color = color;
        }
        if (!L) {
          L = makeLayer(color);
          layers.set(id, L);
        }
        const n = Math.min(max, scan.ranges.length);
        const y = scan.y || 0;
        const p = L.ptsGeo.attributes.position.array, r = L.rayGeo.attributes.position.array;
        let m = 0;
        for (let b = 0; b < n; b++) {
          const hx = scan.hits[b * 2], hz = scan.hits[b * 2 + 1];
          r[b * 6] = scan.pose.x;
          r[b * 6 + 1] = y;
          r[b * 6 + 2] = scan.pose.z;
          r[b * 6 + 3] = hx;
          r[b * 6 + 4] = y;
          r[b * 6 + 5] = hz;
          if (scan.ranges[b] < scan.cfg.range) {
            p[m * 3] = hx;
            p[m * 3 + 1] = y;
            p[m * 3 + 2] = hz;
            m++;
          }
        }
        L.ptsGeo.attributes.position.needsUpdate = true;
        L.rayGeo.attributes.position.needsUpdate = true;
        L.ptsGeo.setDrawRange(0, m);
        L.rayGeo.setDrawRange(0, n * 2);
      });
      layers.forEach((L, id) => {
        if (!seen.has(id)) clear(L);
      });
    };
    return { group, update };
  }
  Object.assign(window, { NAV_COLORS, buildMarkersOverlay, buildTopologyOverlay, buildRouteOverlay, buildGridOverlay, buildHeatOverlay, buildGridRouteOverlay, buildAgentsOverlay, buildRobotModel, animateRobotModel, robotKindOf, buildLidarOverlay, lidarColor, LIDAR_RED, LIDAR_RED_DARK });
})();
