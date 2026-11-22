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
  function buildAgentsOverlay(sim, opts = {}) {
    const group = new THREE.Group();
    const robotGeo = new THREE.CylinderGeometry(1, 1, 1, 24);
    const noseGeo = new THREE.ConeGeometry(0.5, 1, 12);
    const personGeo = new THREE.CylinderGeometry(0.2, 0.2, 1.45, 14);
    const headGeo = new THREE.SphereGeometry(0.16, 14, 10);
    const r = sim.nav.radius;
    const palette = opts.theme === "dark" ? ROBOT_COLORS_DARK : ROBOT_COLORS;
    const robots = sim.robots.map((rb) => {
      const g = new THREE.Group();
      const color = palette[rb.colorIndex] || rb.color;
      const mat = new THREE.MeshLambertMaterial({ color });
      const rad = Math.max(r * 0.9, 0.3);
      const body = new THREE.Mesh(robotGeo, mat);
      body.scale.set(rad, 0.6, rad);
      body.position.y = 0.32;
      const nose = new THREE.Mesh(noseGeo, new THREE.MeshLambertMaterial({ color: 16777215 }));
      nose.scale.set(rad * 0.45, rad * 0.7, rad * 0.45);
      nose.rotation.z = -Math.PI / 2;
      nose.position.set(rad * 0.85, 0.45, 0);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 8), mat);
      mast.position.y = 1.15;
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), new THREE.MeshBasicMaterial({ color }));
      beacon.position.y = 1.85;
      g.add(mast, beacon);
      const ring = new THREE.Mesh(new THREE.RingGeometry(sim.scenario.safetyRadius - 0.03, sim.scenario.safetyRadius, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.04;
      g.add(body, nose, ring);
      group.add(g);
      return { g, rb };
    });
    const personMat = new THREE.MeshLambertMaterial({ color: opts.theme === "dark" ? 14082800 : 2832970 });
    const humans = sim.humans.map((h) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(personGeo, personMat);
      body.position.y = 0.73;
      const head = new THREE.Mesh(headGeo, personMat);
      head.position.y = 1.62;
      g.add(body, head);
      group.add(g);
      return { g, h };
    });
    const lifts = [...sim.lifts.values()].map((L) => {
      const car = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.1, 1.1), new THREE.MeshLambertMaterial({ color: 8015825, transparent: true, opacity: 0.55, depthWrite: false }));
      group.add(car);
      return { car, L };
    });
    const update = () => {
      robots.forEach(({ g, rb }) => {
        g.position.set(rb.pos[0], rb.pos[1], rb.pos[2]);
        g.rotation.y = -rb.heading;
        const parked = rb.state === "done";
        if (g.userData.parked !== parked) {
          g.userData.parked = parked;
          g.traverse((o) => {
            if (!o.material) return;
            if (o.userData.baseOpacity == null) o.userData.baseOpacity = o.material.opacity;
            o.material.opacity = o.userData.baseOpacity * (parked ? 0.35 : 1);
          });
        }
      });
      humans.forEach(({ g, h }) => {
        g.position.set(h.pos[0], h.pos[1], h.pos[2]);
      });
      lifts.forEach(({ car, L }) => car.position.set(L.shaft[0], L.carY + 1.05, L.shaft[1]));
    };
    group.traverse((o) => {
      if (o.material) {
        o.material.depthTest = false;
        o.material.transparent = true;
        o.renderOrder = 40;
      }
    });
    update();
    return { group, update };
  }
  function buildLidarOverlay(opts = {}) {
    const group = new THREE.Group();
    const max = 1440;
    const ptsGeo = new THREE.BufferGeometry();
    ptsGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    const color = opts.theme === "dark" ? 5231037 : 1018488;
    const points = new THREE.Points(ptsGeo, new THREE.PointsMaterial({ color, size: 5, sizeAttenuation: false, depthTest: false, transparent: true }));
    const rayGeo = new THREE.BufferGeometry();
    rayGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(max * 6), 3));
    const rays = new THREE.LineSegments(rayGeo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.18, depthTest: false }));
    points.renderOrder = 42;
    rays.renderOrder = 41;
    points.frustumCulled = false;
    rays.frustumCulled = false;
    group.add(rays, points);
    const update = (scan, y) => {
      if (!scan) {
        ptsGeo.setDrawRange(0, 0);
        rayGeo.setDrawRange(0, 0);
        return;
      }
      const n = Math.min(max, scan.ranges.length);
      const p = ptsGeo.attributes.position.array, r = rayGeo.attributes.position.array;
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
      ptsGeo.attributes.position.needsUpdate = true;
      rayGeo.attributes.position.needsUpdate = true;
      ptsGeo.setDrawRange(0, m);
      rayGeo.setDrawRange(0, n * 2);
    };
    update(null);
    return { group, update };
  }
  Object.assign(window, { NAV_COLORS, buildMarkersOverlay, buildTopologyOverlay, buildRouteOverlay, buildGridOverlay, buildHeatOverlay, buildGridRouteOverlay, buildAgentsOverlay, buildLidarOverlay });
})();
