(() => {
  const PLAN_TOOLS = [
    { id: "select", label: "Select", icon: "Focus", title: "Select IFC elements on the plan" },
    { id: "start", label: "Start", icon: "Route", title: "Click to place the route start" },
    { id: "goal", label: "Goal", icon: "Pin", title: "Click to place the route goal" },
    { id: "obstacle", label: "Obstacle", icon: "Ban", title: "Click to place or remove a what-if obstacle" },
    { id: "inspect", label: "Inspect", icon: "Info", title: "Click a cell to trace its state to an IFC element" }
  ];
  const GRID_PLAN_RGBA = {
    light: [[0, 0, 0, 0], [47, 158, 143, 34], [198, 47, 58, 150], [224, 86, 15, 60], [47, 158, 143, 170], [224, 86, 15, 230], [120, 16, 28, 220], [150, 40, 150, 120]],
    dark: [[0, 0, 0, 0], [79, 209, 189, 34], [255, 107, 116, 150], [255, 138, 61, 60], [79, 209, 189, 170], [255, 138, 61, 230], [190, 40, 55, 220], [214, 112, 214, 120]]
  };
  const ZONE_STYLE = {
    nogo: { light: ["rgba(150,40,150,0.95)", "rgba(150,40,150,0.10)"], dark: ["rgba(214,112,214,0.95)", "rgba(214,112,214,0.12)"] },
    slow: { light: ["rgba(176,116,0,0.95)", "rgba(201,133,0,0.12)"], dark: ["rgba(237,161,0,0.95)", "rgba(237,161,0,0.12)"] }
  };
  function fitLabel(ctx, name, area, bw, bh) {
    const words = name.split(/\s+/);
    const wrap = () => {
      if (words.length < 2) return null;
      let best = null;
      for (let k = 1; k < words.length; k++) {
        const a = words.slice(0, k).join(" "), b = words.slice(k).join(" ");
        const w = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
        if (!best || w < best.w) best = { w, lines: [a, b] };
      }
      return best;
    };
    for (const size of [13, 12, 11, 10, 9]) {
      ctx.font = `500 ${size}px "IBM Plex Sans", system-ui, sans-serif`;
      const lineH = size * 1.22;
      const one = ctx.measureText(name).width;
      const areaW = (() => {
        ctx.font = `400 ${Math.max(9, size - 2)}px "IBM Plex Sans", system-ui, sans-serif`;
        const w = ctx.measureText(area).width;
        ctx.font = `500 ${size}px "IBM Plex Sans", system-ui, sans-serif`;
        return w;
      })();
      if (one <= bw) {
        if (2 * lineH <= bh && areaW <= bw) return { size, lineH, lines: [name], showArea: true };
        if (lineH <= bh) return { size, lineH, lines: [name], showArea: false };
      }
      const two = wrap();
      if (two && two.w <= bw) {
        if (3 * lineH <= bh && areaW <= bw) return { size, lineH, lines: two.lines, showArea: true };
        if (2 * lineH <= bh) return { size, lineH, lines: two.lines, showArea: false };
      }
    }
    ctx.font = '500 9px "IBM Plex Sans", system-ui, sans-serif';
    if (bh < 11) return null;
    let t = name;
    while (t.length > 1 && ctx.measureText(t + "\u2026").width > bw) t = t.slice(0, -1);
    return t.length >= 2 ? { size: 9, lineH: 11, lines: [t + "\u2026"], showArea: false } : null;
  }
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function PlanView(props) {
    const { model, building, navState, levelId, onLevelChange, theme, tool, setTool, tools, onMapPick, onSelectElement, layoutSwitch, workspace } = props;
    const wrapRef = useRef(null);
    const canvasRef = useRef(null);
    const propsRef = useRef(props);
    propsRef.current = props;
    const view = useRef({ cx: 0, cz: 0, scale: 20, fitted: null });
    const [layers, setLayers] = useState({ grid: true, rooms: true, labels: true, furniture: true, heat: true });
    const layersRef = useRef(layers);
    layersRef.current = layers;
    const [hover, setHover] = useState(null);
    const hoverRef = useRef(null);
    hoverRef.current = hover;
    const [layersOpen, setLayersOpen] = useState(false);
    const cache = useRef({ building: null, plans: /* @__PURE__ */ new Map(), grids: /* @__PURE__ */ new Map(), heat: null, heatAt: 0 });
    const levels = building ? building.levels.filter((l) => l.floorY != null) : [];
    const level = levels.find((l) => l.id === Number(levelId)) || levels[0] || null;
    const planFor = (lv) => {
      const c = cache.current;
      if (c.building !== building) {
        c.building = building;
        c.plans = /* @__PURE__ */ new Map();
        c.grids = /* @__PURE__ */ new Map();
      }
      if (!c.plans.has(lv.id)) c.plans.set(lv.id, buildLevelPlan(model, building, lv));
      return c.plans.get(lv.id);
    };
    const plan = level && building ? planFor(level) : null;
    const fit = () => {
      const el = canvasRef.current;
      if (!plan || !el) return;
      const b = plan.bounds;
      if (!b) return;
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      const sx = b.max[0] - b.min[0] || 1, sz = b.max[1] - b.min[1] || 1;
      view.current = { cx: (b.min[0] + b.max[0]) / 2, cz: (b.min[1] + b.max[1]) / 2, scale: Math.min(w / sx, h / sz) * 0.88, fitted: plan.levelId };
      draw();
    };
    const toScreen = (x, z) => {
      const el = canvasRef.current;
      const v = view.current;
      return [(x - v.cx) * v.scale + el.clientWidth / 2, (z - v.cz) * v.scale + el.clientHeight / 2];
    };
    const toWorld = (sx, sy) => {
      const el = canvasRef.current;
      const v = view.current;
      return [(sx - el.clientWidth / 2) / v.scale + v.cx, (sy - el.clientHeight / 2) / v.scale + v.cz];
    };
    const gridImage = (lv) => {
      const p = propsRef.current;
      if (!p.navState) return null;
      const st = p.navState.levels.get(lv.id);
      if (!st) return null;
      const key = `${lv.id}:${p.theme}`;
      const c = cache.current;
      const hit = c.grids.get(key);
      if (hit && hit.state === st.state) return hit;
      const g = st.grid;
      const cv = document.createElement("canvas");
      cv.width = g.w;
      cv.height = g.h;
      const ctx = cv.getContext("2d");
      const img = ctx.createImageData(g.w, g.h);
      const pal = GRID_PLAN_RGBA[p.theme === "dark" ? "dark" : "light"];
      const slowCol = p.theme === "dark" ? [237, 161, 0, 70] : [201, 133, 0, 70];
      for (let k = 0; k < st.state.length; k++) {
        const s = st.state[k];
        const col = st.slow && st.slow[k] < 1 && (s === CELL.FREE || s === CELL.DOOR || s === CELL.INFLATED) ? slowCol : pal[s];
        img.data[k * 4] = col[0];
        img.data[k * 4 + 1] = col[1];
        img.data[k * 4 + 2] = col[2];
        img.data[k * 4 + 3] = col[3];
      }
      ctx.putImageData(img, 0, 0);
      const out = { canvas: cv, grid: g, state: st.state };
      c.grids.set(key, out);
      return out;
    };
    const heatImage = (lv, sim) => {
      const arr = sim && sim.heat.get(lv.id);
      if (!arr) return null;
      const c = cache.current;
      const now = performance.now();
      if (c.heat && c.heat.sim === sim && c.heat.levelId === lv.id && now - c.heatAt < 1e3) return c.heat;
      let max = 0;
      for (let k = 0; k < arr.length; k++) if (arr[k] > max) max = arr[k];
      if (!max) return null;
      const g = sim.nav.levels.get(lv.id).grid;
      const cv = document.createElement("canvas");
      cv.width = g.w;
      cv.height = g.h;
      const ctx = cv.getContext("2d");
      const img = ctx.createImageData(g.w, g.h);
      for (let k = 0; k < arr.length; k++) {
        if (!arr[k]) continue;
        const t = Math.sqrt(arr[k] / max);
        img.data[k * 4] = 255;
        img.data[k * 4 + 1] = Math.round(190 - 110 * t);
        img.data[k * 4 + 2] = Math.round(70 - 60 * t);
        img.data[k * 4 + 3] = Math.round(90 + 165 * t);
      }
      ctx.putImageData(img, 0, 0);
      c.heat = { sim, levelId: lv.id, canvas: cv, grid: g };
      c.heatAt = now;
      return c.heat;
    };
    const draw = () => {
      const el = canvasRef.current;
      const p = propsRef.current;
      if (!el || !plan) return;
      const L = layersRef.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = el.clientWidth, H = el.clientHeight;
      if (el.width !== Math.round(W * dpr) || el.height !== Math.round(H * dpr)) {
        el.width = Math.round(W * dpr);
        el.height = Math.round(H * dpr);
      }
      const ctx = el.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const col = {
        bg: cssVar("--surface"),
        ink: cssVar("--ink"),
        ink3: cssVar("--ink-3"),
        line: cssVar("--line-strong"),
        accent: cssVar("--accent"),
        signal: cssVar("--signal-bright"),
        teal: cssVar("--teal"),
        violet: cssVar("--violet"),
        danger: cssVar("--danger")
      };
      ctx.fillStyle = col.bg;
      ctx.fillRect(0, 0, W, H);
      const v = view.current;
      const sc = v.scale;
      const hover2 = hoverRef.current;
      const theme2 = p.theme;
      if (L.rooms) {
        plan.rooms.forEach((r, i) => {
          ctx.beginPath();
          for (let k = 0; k < r.tris.length; k += 6) {
            const a = toScreen(r.tris[k], r.tris[k + 1]), b = toScreen(r.tris[k + 2], r.tris[k + 3]), c = toScreen(r.tris[k + 4], r.tris[k + 5]);
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(b[0], b[1]);
            ctx.lineTo(c[0], c[1]);
            ctx.closePath();
          }
          ctx.fillStyle = hover2 && hover2.roomId === r.id ? "rgba(31,95,191,0.16)" : i % 2 ? "rgba(120,140,160,0.08)" : "rgba(120,140,160,0.13)";
          ctx.fill();
        });
      }
      if (L.grid) {
        const gi = gridImage(level);
        if (gi) {
          const g = gi.grid;
          const [x0, y0] = toScreen(g.x0, g.z0);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(gi.canvas, x0, y0, g.w * g.res * sc, g.h * g.res * sc);
        }
      }
      plan.verticals.forEach((vt) => {
        const [x0, y0] = toScreen(vt.rect[0], vt.rect[1]);
        const [x1, y1] = toScreen(vt.rect[2], vt.rect[3]);
        ctx.strokeStyle = col.violet;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        ctx.setLineDash([]);
        if (vt.kind === "lift") {
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.moveTo(x1, y0);
          ctx.lineTo(x0, y1);
          ctx.stroke();
        }
      });
      const drawSegs = (layer, styleFor) => {
        const s = layer.segs;
        for (let k = 0, n = 0; k < s.length; k += 4, n++) {
          const st = styleFor(layer.styles[n], layer.ids[n]);
          if (!st) continue;
          const a = toScreen(s[k], s[k + 1]), b = toScreen(s[k + 2], s[k + 3]);
          ctx.strokeStyle = st.color;
          ctx.lineWidth = st.width;
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
          ctx.stroke();
        }
      };
      const hl = hover2 && hover2.elementId;
      const sel = p.selectedIds || /* @__PURE__ */ new Set();
      if (L.furniture) drawSegs(plan.below, (style, id) => ({ color: sel.has(id) || hl === id ? col.accent : col.ink3, width: sel.has(id) ? 2 : 0.8 }));
      drawSegs(plan.cut, (style, id) => {
        const on = sel.has(id) || hl === id;
        if (style === "window") return { color: on ? col.accent : "#5aa9d1", width: on ? 2.5 : 1.4 };
        if (style === "door") return { color: on ? col.accent : col.teal, width: on ? 2.5 : 1.4 };
        if (style === "stair" || style === "rail") return { color: on ? col.accent : col.violet, width: 1.1 };
        if (style === "object") return { color: on ? col.accent : col.ink3, width: 1 };
        return { color: on ? col.accent : col.ink, width: on ? 2.8 : 1.8 };
      });
      plan.doors.forEach((d) => {
        if (!(p.blocked && p.blocked.has(d.id))) return;
        const [x0, y0] = toScreen(d.rect[0], d.rect[1]);
        const [x1, y1] = toScreen(d.rect[2], d.rect[3]);
        ctx.strokeStyle = col.danger;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.moveTo(x1, y0);
        ctx.lineTo(x0, y1);
        ctx.stroke();
      });
      if (L.labels) {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        plan.rooms.forEach((r) => {
          const box = r.label;
          if (!box) return;
          const bw = box.w * sc - 6, bh = box.h * sc - 4;
          if (bw < 18 || bh < 9) return;
          const area = `${r.area.toFixed(1)} m\xB2`;
          const fit2 = fitLabel(ctx, r.name, area, bw, bh);
          if (!fit2) return;
          const [cx, cy] = toScreen(box.x, box.z);
          ctx.save();
          ctx.beginPath();
          for (let k = 0; k < r.tris.length; k += 6) {
            const a = toScreen(r.tris[k], r.tris[k + 1]), b = toScreen(r.tris[k + 2], r.tris[k + 3]), c = toScreen(r.tris[k + 4], r.tris[k + 5]);
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(b[0], b[1]);
            ctx.lineTo(c[0], c[1]);
            ctx.closePath();
          }
          ctx.clip();
          const lines = fit2.lines.length + (fit2.showArea ? 1 : 0);
          let y = cy - (lines - 1) * fit2.lineH / 2;
          ctx.font = `500 ${fit2.size}px "IBM Plex Sans", system-ui, sans-serif`;
          ctx.lineJoin = "round";
          ctx.lineWidth = 3;
          ctx.strokeStyle = col.bg;
          ctx.fillStyle = col.ink;
          fit2.lines.forEach((t) => {
            ctx.strokeText(t, cx, y);
            ctx.fillText(t, cx, y);
            y += fit2.lineH;
          });
          if (fit2.showArea) {
            ctx.font = `400 ${Math.max(9, fit2.size - 2)}px "IBM Plex Sans", system-ui, sans-serif`;
            ctx.fillStyle = col.ink3;
            ctx.strokeText(area, cx, y);
            ctx.fillText(area, cx, y);
          }
          ctx.restore();
        });
      }
      const sim = p.sim;
      if (L.heat && sim) {
        const hi = heatImage(level, sim);
        if (hi) {
          const g = hi.grid;
          const [x0, y0] = toScreen(g.x0, g.z0);
          ctx.imageSmoothingEnabled = true;
          ctx.globalAlpha = 0.85;
          ctx.drawImage(hi.canvas, x0, y0, g.w * g.res * sc, g.h * g.res * sc);
          ctx.globalAlpha = 1;
        }
      }
      (p.zones || []).forEach((zn) => {
        if (zn.levelId !== level.id) return;
        const [xa, ya] = toScreen(Math.min(zn.x0, zn.x1), Math.min(zn.z0, zn.z1));
        const [xb, yb] = toScreen(Math.max(zn.x0, zn.x1), Math.max(zn.z0, zn.z1));
        const [stroke, fill] = ZONE_STYLE[zn.kind === "nogo" ? "nogo" : "slow"][theme2 === "dark" ? "dark" : "light"];
        ctx.fillStyle = fill;
        ctx.fillRect(xa, ya, xb - xa, yb - ya);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.setLineDash(zn.kind === "nogo" ? [] : [6, 4]);
        ctx.strokeRect(xa, ya, xb - xa, yb - ya);
        ctx.setLineDash([]);
        if (xb - xa > 40 && yb - ya > 16) {
          ctx.font = '600 11px "IBM Plex Sans", sans-serif';
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          ctx.fillStyle = stroke;
          ctx.fillText(zn.kind === "nogo" ? "No-go" : `Slow ${Math.round((zn.factor || 0.5) * 100)}%`, xa + 5, ya + 4);
        }
      });
      if (p.pendingZone && p.pendingZone.levelId === level.id) {
        const [x, y] = toScreen(p.pendingZone.x, p.pendingZone.z);
        ctx.strokeStyle = col.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 8, y);
        ctx.lineTo(x + 8, y);
        ctx.moveTo(x, y - 8);
        ctx.lineTo(x, y + 8);
        ctx.stroke();
        if (hover2) {
          const [hx, hy] = toScreen(hover2.x, hover2.z);
          ctx.setLineDash([4, 4]);
          ctx.strokeRect(Math.min(x, hx), Math.min(y, hy), Math.abs(hx - x), Math.abs(hy - y));
          ctx.setLineDash([]);
        }
      }
      (p.obstacles || []).forEach((o) => {
        if (o.levelId !== level.id) return;
        const [x0, y0] = toScreen(o.x - o.size / 2, o.z - o.size / 2);
        ctx.fillStyle = "rgba(224,86,15,0.85)";
        ctx.fillRect(x0, y0, o.size * sc, o.size * sc);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.strokeRect(x0, y0, o.size * sc, o.size * sc);
      });
      const routePts = (p.routeLegs || []).filter((l) => l.points && l.levelId === level.id).map((l) => l.points);
      routePts.forEach((pts) => {
        ctx.strokeStyle = col.signal;
        ctx.lineWidth = 4;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        pts.forEach((q, i) => {
          const s = toScreen(q[0], q[2]);
          i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]);
        });
        ctx.stroke();
      });
      (p.routeTransitions || []).forEach((t) => {
        if (t.levelId !== level.id) return;
        const [x, y] = toScreen(t.x, t.z);
        ctx.fillStyle = col.violet;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = '600 10px "IBM Plex Sans", sans-serif';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(t.up ? "\u2191" : "\u2193", x, y + 0.5);
      });
      (p.missions || []).forEach((m, i) => {
        const ends = [m.start, m.goal].filter(Boolean);
        const color = (theme2 === "dark" ? ROBOT_COLORS_DARK : ROBOT_COLORS)[i % 8];
        const legs = (p.missionPaths || [])[i];
        if (legs) {
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.lineJoin = "round";
          ctx.setLineDash([6, 4]);
          legs.filter((l) => l.levelId === level.id).forEach((l) => {
            ctx.beginPath();
            l.points.forEach((q, k) => {
              const s2 = toScreen(q[0], q[2]);
              k ? ctx.lineTo(s2[0], s2[1]) : ctx.moveTo(s2[0], s2[1]);
            });
            ctx.stroke();
          });
          ctx.setLineDash([]);
        }
        ends.forEach((pt, k) => {
          if (pt.levelId !== level.id) return;
          const [x, y] = toScreen(pt.x, pt.z);
          ctx.fillStyle = color;
          ctx.beginPath();
          if (k === 0) ctx.arc(x, y, 8, 0, Math.PI * 2);
          else ctx.rect(x - 7, y - 7, 14, 14);
          ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.font = '600 10px "IBM Plex Sans", sans-serif';
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(i + 1), x, y + 0.5);
        });
      });
      if (p.pendingMission && p.pendingMission.levelId === level.id) {
        const [x, y] = toScreen(p.pendingMission.x, p.pendingMission.z);
        ctx.strokeStyle = col.accent;
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(x, y, 11, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const marker = (pt, color, label) => {
        if (!pt || pt.levelId !== level.id) return;
        const [x, y] = toScreen(pt.x, pt.z);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.font = '600 12px "IBM Plex Sans", sans-serif';
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 3;
        ctx.strokeStyle = col.bg;
        ctx.strokeText(label, x + 13, y);
        ctx.fillStyle = col.ink;
        ctx.fillText(label, x + 13, y);
      };
      marker(p.start, col.accent, "Start");
      marker(p.goal, col.signal, "Goal");
      const cell = p.cellInfo;
      if (cell && cell.levelId === level.id && p.navState) {
        const g = p.navState.levels.get(level.id).grid;
        const [x0, y0] = toScreen(g.x0 + cell.cell[0] * g.res, g.z0 + cell.cell[1] * g.res);
        ctx.strokeStyle = col.accent;
        ctx.lineWidth = 2;
        const s = Math.max(6, g.res * sc);
        ctx.strokeRect(x0 - (s - g.res * sc) / 2, y0 - (s - g.res * sc) / 2, s, s);
      }
      const scans = sim ? sim.lidarScans || (sim.lidar ? [sim.lidar] : []) : [];
      scans.forEach((scan) => {
        if (scan.pose.levelId !== level.id) return;
        const color = lidarColor(scan.colorIndex || 0, sim.robots.length, theme2);
        const [ox, oy] = toScreen(scan.pose.x, scan.pose.z);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.2;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let b = 0; b < scan.ranges.length; b++) {
          const [hx, hy] = toScreen(scan.hits[b * 2], scan.hits[b * 2 + 1]);
          ctx.moveTo(ox, oy);
          ctx.lineTo(hx, hy);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        for (let b = 0; b < scan.ranges.length; b++) {
          if (scan.ranges[b] >= scan.cfg.range) continue;
          const [hx, hy] = toScreen(scan.hits[b * 2], scan.hits[b * 2 + 1]);
          ctx.fillRect(hx - 1.5, hy - 1.5, 3, 3);
        }
      });
      if (sim) {
        const pal = theme2 === "dark" ? ROBOT_COLORS_DARK : ROBOT_COLORS;
        const r = sim.nav.radius;
        sim.humans.forEach((h) => {
          if (h.levelId !== level.id) return;
          const [x, y] = toScreen(h.pos[0], h.pos[2]);
          ctx.fillStyle = col.ink;
          ctx.beginPath();
          ctx.arc(x, y, Math.max(4, 0.22 * sc), 0, Math.PI * 2);
          ctx.fill();
        });
        sim.lifts.forEach((Lf) => {
          if (!Lf.landings.has(level.id)) return;
          const [x, y] = toScreen(Lf.shaft[0], Lf.shaft[1]);
          const here = Lf.carLevel === level.id && Lf.state !== "moving";
          ctx.fillStyle = here ? col.violet : "transparent";
          ctx.strokeStyle = col.violet;
          ctx.lineWidth = 2;
          ctx.fillRect(x - 8, y - 8, 16, 16);
          ctx.strokeRect(x - 8, y - 8, 16, 16);
          if (Lf.requests.some((q) => q.from === level.id)) {
            ctx.fillStyle = col.violet;
            ctx.font = '600 10px "IBM Plex Sans", sans-serif';
            ctx.textAlign = "left";
            ctx.fillText(`${Lf.requests.filter((q) => q.from === level.id).length} waiting`, x + 11, y);
          }
        });
        sim.robots.forEach((rb) => {
          const leg = rb.legs && rb.legs[rb.legIdx];
          if (rb.state === "moving" && leg && leg.type === "walk" && rb.levelId === level.id && leg.points) {
            ctx.strokeStyle = pal[rb.colorIndex] || rb.color;
            ctx.globalAlpha = 0.8;
            ctx.lineWidth = 2.5;
            ctx.lineJoin = "round";
            ctx.beginPath();
            const s0 = toScreen(rb.pos[0], rb.pos[2]);
            ctx.moveTo(s0[0], s0[1]);
            for (let k = rb.ptIdx; k < leg.points.length; k++) {
              const s2 = toScreen(leg.points[k][0], leg.points[k][2]);
              ctx.lineTo(s2[0], s2[1]);
            }
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        });
        sim.robots.forEach((rb) => {
          if (rb.levelId !== level.id || rb.state === "riding") return;
          const [x, y] = toScreen(rb.pos[0], rb.pos[2]);
          ctx.globalAlpha = rb.state === "done" ? 0.4 : 1;
          const rad = Math.max(5, r * sc);
          ctx.fillStyle = pal[rb.colorIndex] || rb.color;
          ctx.beginPath();
          ctx.arc(x, y, rad, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(rb.heading) * rad, y + Math.sin(rb.heading) * rad);
          ctx.stroke();
          if (sc > 14) {
            ctx.strokeStyle = pal[rb.colorIndex] || rb.color;
            ctx.globalAlpha = 0.35;
            ctx.beginPath();
            ctx.arc(x, y, sim.scenario.safetyRadius * sc, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
          ctx.globalAlpha = 1;
        });
      }
      const target = 110 / sc;
      const nice = [0.5, 1, 2, 5, 10, 20, 50, 100].find((n) => n >= target * 0.6) || 100;
      const px = nice * sc;
      ctx.strokeStyle = col.ink;
      ctx.fillStyle = col.ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(16, H - 18);
      ctx.lineTo(16 + px, H - 18);
      ctx.moveTo(16, H - 23);
      ctx.lineTo(16, H - 13);
      ctx.moveTo(16 + px, H - 23);
      ctx.lineTo(16 + px, H - 13);
      ctx.stroke();
      ctx.font = '500 11px "IBM Plex Mono", monospace';
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(`${nice} m`, 20, H - 24);
    };
    useEffect(() => {
      draw();
    });
    useEffect(() => {
      window.__planView = { toScreen, toWorld, levelId: level ? level.id : null, canvas: canvasRef.current };
      return () => {
        if (window.__planView && window.__planView.canvas === canvasRef.current) window.__planView = null;
      };
    });
    useEffect(() => {
      if (plan && view.current.fitted !== plan.levelId) fit();
    }, [plan]);
    useEffect(() => {
      const ro = new ResizeObserver(() => draw());
      if (wrapRef.current) ro.observe(wrapRef.current);
      return () => ro.disconnect();
    }, [plan]);
    useEffect(() => {
      if (!props.simRunning) return;
      let raf;
      const loop = () => {
        draw();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(raf);
    }, [props.simRunning, plan]);
    const drag = useRef(null);
    const onPointerDown = (e) => {
      var _a, _b;
      (_b = (_a = canvasRef.current).setPointerCapture) == null ? void 0 : _b.call(_a, e.pointerId);
      drag.current = { x: e.clientX, y: e.clientY, moved: 0, button: e.button, cx: view.current.cx, cz: view.current.cz };
    };
    const onPointerMove = (e) => {
      const r = canvasRef.current.getBoundingClientRect();
      const d = drag.current;
      if (d) {
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        d.moved = Math.max(d.moved, Math.abs(dx) + Math.abs(dy));
        if (d.moved > 3) {
          view.current.cx = d.cx - dx / view.current.scale;
          view.current.cz = d.cz - dy / view.current.scale;
          draw();
        }
        return;
      }
      if (!plan) return;
      const [x, z] = toWorld(e.clientX - r.left, e.clientY - r.top);
      const seg = segmentAtPoint(plan, x, z, 6 / view.current.scale);
      const room = roomAtPoint(plan, x, z);
      const next = { sx: e.clientX - r.left, sy: e.clientY - r.top, x, z, elementId: seg ? seg.id : null, roomId: room ? room.id : null };
      setHover((h) => h && h.elementId === next.elementId && h.roomId === next.roomId && Math.abs(h.sx - next.sx) < 2 && Math.abs(h.sy - next.sy) < 2 ? h : next);
    };
    const onPointerUp = (e) => {
      const d = drag.current;
      drag.current = null;
      if (!d || d.moved > 3 || d.button !== 0 || !plan) return;
      const r = canvasRef.current.getBoundingClientRect();
      const [x, z] = toWorld(e.clientX - r.left, e.clientY - r.top);
      if (tool === "select") {
        const seg = segmentAtPoint(plan, x, z, 6 / view.current.scale);
        if (seg) {
          onSelectElement(seg.id, e);
          return;
        }
        const room = roomAtPoint(plan, x, z);
        if (room) onSelectElement(room.id, e);
        else onSelectElement(null, e);
        return;
      }
      onMapPick({ levelId: level.id, x, z, source: "plan" });
    };
    const onWheel = (e) => {
      e.preventDefault();
      const r = canvasRef.current.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const [wx, wz] = toWorld(sx, sy);
      const f = Math.exp(-Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 18e-4);
      const v = view.current;
      v.scale = Math.min(400, Math.max(1, v.scale * f));
      v.cx = wx - (sx - r.width / 2) / v.scale;
      v.cz = wz - (sy - r.height / 2) / v.scale;
      draw();
    };
    useEffect(() => {
      const el = canvasRef.current;
      if (!el) return;
      el.addEventListener("wheel", onWheel, { passive: false });
      return () => el.removeEventListener("wheel", onWheel);
    });
    if (!building) {
      return /* @__PURE__ */ React.createElement("div", { className: "plan-view" }, /* @__PURE__ */ React.createElement(EmptyState, { icon: Icons.Layers, title: "Preparing floor plans" }, "Reading levels and rooms\u2026"));
    }
    const hoverEl = hover && (hover.elementId != null ? model.byId.get(hover.elementId) : hover.roomId != null ? model.byId.get(hover.roomId) : null);
    const toolList = tools || PLAN_TOOLS;
    return /* @__PURE__ */ React.createElement("div", { className: "plan-view", "data-tool": tool }, /* @__PURE__ */ React.createElement("div", { className: "plan-bar", role: "toolbar", "aria-label": "Floor plan" }, /* @__PURE__ */ React.createElement("label", { className: "quick-select" }, /* @__PURE__ */ React.createElement(Icons.Layers, { size: 15 }), /* @__PURE__ */ React.createElement("select", { "aria-label": "Plan level", value: level ? level.id : "", onChange: (e) => onLevelChange(e.target.value) }, levels.map((l) => /* @__PURE__ */ React.createElement("option", { key: l.id, value: l.id }, l.name)))), /* @__PURE__ */ React.createElement("div", { className: "seg tool-seg", role: "group", "aria-label": "Plan tool" }, toolList.map((t) => {
      const I = Icons[t.icon];
      return /* @__PURE__ */ React.createElement("button", { key: t.id, type: "button", "aria-pressed": tool === t.id, title: t.title, onClick: () => setTool(t.id) }, /* @__PURE__ */ React.createElement(I, { size: 14 }), /* @__PURE__ */ React.createElement("span", null, t.label));
    })), /* @__PURE__ */ React.createElement("span", { className: "plan-bar-spacer" }), /* @__PURE__ */ React.createElement("div", { className: "menu-anchor" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "chip-btn", "aria-expanded": layersOpen, onClick: () => setLayersOpen((o) => !o) }, /* @__PURE__ */ React.createElement(Icons.Layers, { size: 15 }), " Layers"), layersOpen && /* @__PURE__ */ React.createElement("div", { className: "menu layers-menu", role: "menu", onMouseLeave: () => setLayersOpen(false) }, [["grid", "Occupancy grid"], ["rooms", "Room fills"], ["labels", "Room labels"], ["furniture", "Furniture"], ["heat", "Congestion heatmap"]].map(([k, label]) => /* @__PURE__ */ React.createElement("label", { key: k, className: "check-field menu-check" }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: layers[k], onChange: (e) => setLayers((s) => ({ ...s, [k]: e.target.checked })) }), " ", label)))), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Home, label: "Fit plan", size: 15, onClick: fit }), layoutSwitch), /* @__PURE__ */ React.createElement("div", { className: "plan-canvas-wrap", ref: wrapRef }, /* @__PURE__ */ React.createElement(
      "canvas",
      {
        ref: canvasRef,
        className: "plan-canvas",
        "aria-label": `Floor plan of ${level ? level.name : "the model"}`,
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerLeave: () => setHover(null),
        onDoubleClick: fit,
        onContextMenu: (e) => e.preventDefault()
      }
    ), hoverEl && hover && /* @__PURE__ */ React.createElement("div", { className: "hover-tip", style: { left: hover.sx + 14, top: hover.sy + 14 } }, /* @__PURE__ */ React.createElement("span", { className: "mono tip-class" }, hoverEl.ifcClass), /* @__PURE__ */ React.createElement("span", { className: "tip-name" }, elementLabel(hoverEl))), /* @__PURE__ */ React.createElement("div", { className: "plan-legend" }, "Cut at ", PLAN_CUT, " m above the floor", tool !== "select" ? ` \xB7 ${(toolList.find((t) => t.id === tool) || {}).title || ""}` : " \xB7 drag to pan, wheel to zoom")));
  }
  Object.assign(window, { PLAN_TOOLS, PlanView });
})();
