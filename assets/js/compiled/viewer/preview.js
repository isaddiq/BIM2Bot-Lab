(() => {
  function previewDecode(b64, Type) {
    const bin = atob(b64);
    const buf = new ArrayBuffer(bin.length);
    const u8 = new Uint8Array(buf);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Type(buf);
  }
  function mountSimPreview(host, traj, level, opts = {}) {
    const theme = opts.theme === "dark" ? "dark" : "light";
    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.localClippingEnabled = true;
    renderer.setClearColor(0, 0);
    const canvas = renderer.domElement;
    canvas.className = "preview-canvas";
    host.appendChild(canvas);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(15922939, theme === "dark" ? 2897990 : 8226966, 1.6));
    const key = new THREE.DirectionalLight(16777215, 1.5);
    key.position.set(0.6, 1, 0.35);
    scene.add(key);
    const fill = new THREE.DirectionalLight(14674431, 0.55);
    fill.position.set(-0.7, 0.4, -0.5);
    scene.add(fill);
    const cut = new THREE.Plane(new THREE.Vector3(0, -1, 0), level.cut);
    const disposables = [];
    level.groups.forEach((g) => {
      const p16 = previewDecode(g.p, Int16Array);
      const pos = new Float32Array(p16.length);
      for (let i = 0; i < p16.length; i++) pos[i] = p16[i] / 1e3;
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geom.setIndex(new THREE.BufferAttribute(previewDecode(g.i, Uint16Array), 1));
      geom.computeVertexNormals();
      const [r, gg, b, a] = g.c;
      const color = new THREE.Color().setRGB(r, gg, b, THREE.SRGBColorSpace);
      const glass = a < 0.99;
      const mat = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, clippingPlanes: [cut], transparent: glass, opacity: glass ? Math.max(0.3, a) : 1, depthWrite: !glass });
      scene.add(new THREE.Mesh(geom, mat));
      disposables.push(geom, mat);
    });
    const palette = theme === "dark" ? ROBOT_COLORS_DARK : ROBOT_COLORS;
    const R = traj.robots, P = traj.people;
    const rp = previewDecode(traj.rp, Int16Array);
    const pp = previewDecode(traj.pp, Int16Array);
    const lid = previewDecode(traj.lid, Int16Array);
    const robots = traj.colors.map((ci) => {
      const color = palette[ci % palette.length];
      const model = buildRobotModel(traj.kind, traj.width, new THREE.Color(color));
      const g = new THREE.Group();
      g.add(model.group);
      const ring = new THREE.Mesh(new THREE.RingGeometry(traj.safety - 0.03, traj.safety, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;
      g.add(ring);
      scene.add(g);
      return { g, model, last: null };
    });
    const personMat = new THREE.MeshStandardMaterial({ color: theme === "dark" ? 14082800 : 3425882, roughness: 0.7 });
    const personGeo = new THREE.CapsuleGeometry(0.19, 1, 6, 14);
    const headGeo = new THREE.SphereGeometry(0.13, 16, 12);
    disposables.push(personMat, personGeo, headGeo);
    const people = Array.from({ length: P }, () => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(personGeo, personMat);
      body.position.y = 0.72;
      const head = new THREE.Mesh(headGeo, personMat);
      head.position.y = 1.58;
      g.add(body, head);
      scene.add(g);
      return g;
    });
    const beams = traj.beams;
    const lidarLayers = traj.colors.map((ci) => {
      const color = lidarColor(ci, R, theme);
      const rayGeo = new THREE.BufferGeometry();
      rayGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(beams * 6), 3));
      const ptsGeo = new THREE.BufferGeometry();
      ptsGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(beams * 3), 3));
      const rays = new THREE.LineSegments(rayGeo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false }));
      const pts = new THREE.Points(ptsGeo, new THREE.PointsMaterial({ color, size: 4, sizeAttenuation: false }));
      rays.frustumCulled = pts.frustumCulled = false;
      scene.add(rays, pts);
      disposables.push(rayGeo, ptsGeo, rays.material, pts.material);
      return { rayGeo, ptsGeo, lastFrame: -1 };
    });
    let needsRender = true;
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 500);
    const ctl = new OrbitController(camera, canvas, () => {
      needsRender = true;
    });
    const span = Math.max(level.size[0], level.size[1]);
    ctl.target.set(0, 0.4, 0);
    ctl.spherical.set(span * 1.32, 0.86, Math.PI * 0.2);
    ctl.minRadius = span * 0.35;
    ctl.maxRadius = span * 2.5;
    ctl.apply();
    canvas.removeEventListener("wheel", ctl.onWheel);
    const onWheel = (e) => {
      if (e.ctrlKey) ctl.onWheel(e);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    const onContext = (e) => e.preventDefault();
    canvas.addEventListener("contextmenu", onContext);
    let interacted = false;
    const onFirst = () => {
      if (!interacted) {
        interacted = true;
        opts.onInteract && opts.onInteract();
      }
    };
    canvas.addEventListener("pointerdown", onFirst);
    const F = traj.frames;
    const duration = F * traj.dt;
    const hold = 1.2;
    const lerpAngle = (a, b, t) => {
      let d = b - a;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      return a + d * t;
    };
    const SENT = -32768;
    const pose = (frame, i) => {
      const o = (frame * R + i) * 5;
      return [rp[o] / 1e3, rp[o + 1] / 1e3, rp[o + 2] / 1e3, rp[o + 3] / 1e4, rp[o + 4]];
    };
    const setFrame = (time) => {
      const f = Math.min(F - 1, time / traj.dt);
      const f0 = Math.floor(f), f1 = Math.min(F - 1, f0 + 1), t = f - f0;
      robots.forEach((rb, i) => {
        const a = pose(f0, i), b = pose(f1, i);
        const vis = a[4] && b[4];
        rb.g.visible = !!vis;
        const x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t;
        rb.g.position.set(x, 0, z);
        rb.g.rotation.y = -lerpAngle(a[3], b[3], t);
        let dist = rb.last ? Math.hypot(x - rb.last[0], z - rb.last[1]) : 0;
        if (dist > 1.5) dist = 0;
        rb.last = [x, z];
        animateRobotModel(rb.model, dist, dist > 1e-4, performance.now() / 1e3);
      });
      people.forEach((g, i) => {
        const o0 = (f0 * P + i) * 4, o1 = (f1 * P + i) * 4;
        g.visible = !!(pp[o0 + 3] && pp[o1 + 3]);
        g.position.set((pp[o0] + (pp[o1] - pp[o0]) * t) / 1e3, 0, (pp[o0 + 2] + (pp[o1 + 2] - pp[o0 + 2]) * t) / 1e3);
      });
      const lf = Math.floor(f0 / traj.lidarEvery);
      const per = 2 + 2 * beams;
      const y = traj.lidarY;
      const range2 = (traj.lidarRange - 0.02) ** 2;
      lidarLayers.forEach((L, i) => {
        if (L.lastFrame === lf) return;
        L.lastFrame = lf;
        const o = (lf * R + i) * per;
        const ray = L.rayGeo.attributes.position.array, pt = L.ptsGeo.attributes.position.array;
        if (o + per > lid.length || lid[o] === SENT || !robots[i].g.visible) {
          L.rayGeo.setDrawRange(0, 0);
          L.ptsGeo.setDrawRange(0, 0);
          return;
        }
        const sx = lid[o] / 1e3, sz = lid[o + 1] / 1e3;
        let m = 0;
        for (let k = 0; k < beams; k++) {
          const hx = lid[o + 2 + k * 2] / 1e3, hz = lid[o + 3 + k * 2] / 1e3;
          ray[k * 6] = sx;
          ray[k * 6 + 1] = y;
          ray[k * 6 + 2] = sz;
          ray[k * 6 + 3] = hx;
          ray[k * 6 + 4] = y;
          ray[k * 6 + 5] = hz;
          if ((hx - sx) ** 2 + (hz - sz) ** 2 < range2) {
            pt[m * 3] = hx;
            pt[m * 3 + 1] = y;
            pt[m * 3 + 2] = hz;
            m++;
          }
        }
        L.rayGeo.attributes.position.needsUpdate = true;
        L.ptsGeo.attributes.position.needsUpdate = true;
        L.rayGeo.setDrawRange(0, beams * 2);
        L.ptsGeo.setDrawRange(0, m);
      });
    };
    let onScreen = false, raf = 0, last = performance.now(), clock = 0;
    const size = () => {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      needsRender = true;
    };
    const ro = new ResizeObserver(size);
    ro.observe(host);
    size();
    const loop = (now) => {
      raf = 0;
      if (!onScreen || document.hidden) return;
      const dt = Math.min(0.1, (now - last) / 1e3);
      last = now;
      ctl.update(now);
      if (!reduceMotion) {
        clock = (clock + dt) % (duration + hold);
        setFrame(Math.min(clock, duration));
        needsRender = true;
      }
      if (needsRender) {
        renderer.render(scene, camera);
        needsRender = false;
      }
      raf = requestAnimationFrame(loop);
    };
    const kick = () => {
      if (!raf && onScreen && !document.hidden) {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };
    const io = new IntersectionObserver((entries) => {
      onScreen = entries.some((e) => e.isIntersecting);
      kick();
    }, { threshold: 0.05 });
    io.observe(host);
    const onVis = () => kick();
    document.addEventListener("visibilitychange", onVis);
    setFrame(reduceMotion ? duration * 0.4 : 0);
    renderer.render(scene, camera);
    return {
      dispose() {
        if (raf) cancelAnimationFrame(raf);
        io.disconnect();
        ro.disconnect();
        document.removeEventListener("visibilitychange", onVis);
        canvas.removeEventListener("wheel", onWheel);
        canvas.removeEventListener("contextmenu", onContext);
        canvas.removeEventListener("pointerdown", onFirst);
        ctl.dispose();
        scene.traverse((o) => {
          if (o.isMesh && o.geometry) o.geometry.dispose();
        });
        disposables.forEach((d) => d.dispose && d.dispose());
        renderer.dispose();
        canvas.remove();
      }
    };
  }
  Object.assign(window, { mountSimPreview });
})();
