(() => {
  const SIM_SPEEDS = [1, 2, 5, 10, 30];
  function fmtClock(t) {
    const s = Math.floor(t);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }
  function fmtSec(t) {
    if (t == null) return "\u2014";
    return t >= 90 ? `${(t / 60).toFixed(1)} min` : `${t.toFixed(1)} s`;
  }
  function useSimulation({ viewerRef, model, building, navMap, theme, levelId, active }) {
    const simRef = useRef(null);
    const agentsRef = useRef(null);
    const unsubRef = useRef(null);
    const statusRef = useRef("idle");
    const speedRef = useRef(5);
    const heatRef = useRef(true);
    const lastUi = useRef(0);
    const lastHeat = useRef(0);
    const [status, setStatusState] = useState("idle");
    const [snapshot, setSnapshot] = useState(null);
    const [speed, setSpeedState] = useState(5);
    const [showHeat, setShowHeatState] = useState(true);
    const lidarRef = useRef({ enabled: false, robotId: 1, ...LIDAR_DEFAULTS });
    const lidarOverlayRef = useRef(null);
    const [lidar, setLidarState] = useState(lidarRef.current);
    const computeLidar = () => {
      const sim = simRef.current;
      if (!sim) return;
      const cfg = lidarRef.current;
      const rb = cfg.enabled ? sim.robots.find((r) => r.id === cfg.robotId) || sim.robots[0] : null;
      if (!rb || rb.state === "riding" || rb.state === "stairs") {
        sim.lidar = null;
        if (lidarOverlayRef.current) lidarOverlayRef.current.update(null);
        return;
      }
      const body = (sim.scenario.robot ? sim.scenario.robot.width : 0.6) / 2;
      const dynamic = [];
      sim.humans.forEach((h) => {
        if (h.levelId === rb.levelId) dynamic.push({ x: h.pos[0], z: h.pos[2], r: 0.22 });
      });
      sim.robots.forEach((o) => {
        if (o !== rb && o.levelId === rb.levelId && o.state !== "riding" && o.state !== "stairs") dynamic.push({ x: o.pos[0], z: o.pos[2], r: body });
      });
      const pose = { levelId: rb.levelId, x: rb.pos[0], z: rb.pos[2], heading: rb.heading };
      sim.lidar = lidarScan(sim.nav, pose, cfg, dynamic, Math.round(sim.time * 10) + 1);
      sim.lidar.robotName = rb.name;
      const lv = sim.nav.levels.get(rb.levelId);
      if (lidarOverlayRef.current && lv) lidarOverlayRef.current.update(sim.lidar, lv.grid.floorY + cfg.mountHeight);
    };
    const attachLidar = () => {
      const v = viewerRef.current;
      if (!v) return;
      if (lidarRef.current.enabled && simRef.current) {
        lidarOverlayRef.current = buildLidarOverlay({ theme });
        v.setOverlay("sim-lidar", lidarOverlayRef.current.group);
        computeLidar();
      } else {
        v.removeOverlay("sim-lidar");
        lidarOverlayRef.current = null;
        if (simRef.current) simRef.current.lidar = null;
      }
    };
    const setLidar = (patch) => {
      var _a;
      lidarRef.current = { ...lidarRef.current, ...patch };
      setLidarState(lidarRef.current);
      attachLidar();
      if (simRef.current) setSnapshot(simRef.current.summary());
      (_a = viewerRef.current) == null ? void 0 : _a.invalidate();
    };
    const setStatus = (s) => {
      statusRef.current = s;
      setStatusState(s);
    };
    const setSpeed = (s) => {
      speedRef.current = s;
      setSpeedState(s);
    };
    const drawHeat = () => {
      const v = viewerRef.current;
      if (!v) return;
      if (simRef.current && heatRef.current) v.setOverlay("sim-heat", buildHeatOverlay(simRef.current, { levelId }));
      else v.removeOverlay("sim-heat");
    };
    const setShowHeat = (on) => {
      heatRef.current = on;
      setShowHeatState(on);
      drawHeat();
    };
    const stopLoop = () => {
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
    const startLoop = () => {
      stopLoop();
      const v = viewerRef.current;
      if (!v || !simRef.current) return;
      unsubRef.current = v.onFrame((dt) => {
        const sim = simRef.current;
        if (!sim) return;
        if (statusRef.current === "running") sim.step(dt * speedRef.current);
        agentsRef.current && agentsRef.current.update();
        if (lidarRef.current.enabled && statusRef.current === "running") computeLidar();
        const now = performance.now();
        if (now - lastUi.current > 250) {
          lastUi.current = now;
          setSnapshot(sim.summary());
        }
        if (heatRef.current && now - lastHeat.current > 1500) {
          lastHeat.current = now;
          drawHeat();
        }
        if (sim.done && statusRef.current === "running") {
          setStatus("done");
          setSnapshot(sim.summary());
          drawHeat();
          stopLoop();
        }
      });
    };
    const detachOverlays = () => {
      const v = viewerRef.current;
      if (!v) return;
      v.removeOverlay("sim-agents");
      v.removeOverlay("sim-heat");
      v.removeOverlay("sim-lidar");
      lidarOverlayRef.current = null;
    };
    const attachOverlays = () => {
      const v = viewerRef.current;
      if (!v || !simRef.current) return;
      agentsRef.current = buildAgentsOverlay(simRef.current, { theme });
      v.setOverlay("sim-agents", agentsRef.current.group);
      drawHeat();
      attachLidar();
    };
    const start = (scenario) => {
      var _a;
      stopLoop();
      detachOverlays();
      simRef.current = createSimulation({ model, building, navMap }, scenario);
      attachOverlays();
      setSnapshot(simRef.current.summary());
      setStatus(simRef.current.done ? "done" : "running");
      startLoop();
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      simRef.current.rooms.forEach((rm) => {
        const s = building.spaces.get(rm.id);
        if (!s) return;
        for (let a = 0; a < 3; a++) {
          min[a] = Math.min(min[a], s.bbox.min[a]);
          max[a] = Math.max(max[a], s.bbox.max[a]);
        }
      });
      if (Number.isFinite(min[0])) (_a = viewerRef.current) == null ? void 0 : _a.frameModelBox({ min, max });
      return simRef.current;
    };
    const pause = () => {
      setStatus("paused");
      stopLoop();
    };
    const resume = () => {
      if (!simRef.current || simRef.current.done) return;
      setStatus("running");
      startLoop();
    };
    const runToEnd = () => {
      var _a;
      const sim = simRef.current;
      if (!sim) return;
      stopLoop();
      sim.runToEnd();
      agentsRef.current && agentsRef.current.update();
      computeLidar();
      setSnapshot(sim.summary());
      setStatus("done");
      drawHeat();
      (_a = viewerRef.current) == null ? void 0 : _a.invalidate();
    };
    const reset = () => {
      stopLoop();
      detachOverlays();
      simRef.current = null;
      agentsRef.current = null;
      setSnapshot(null);
      setStatus("idle");
    };
    useEffect(() => {
      if (!simRef.current) return;
      if (active) {
        attachOverlays();
        if (statusRef.current === "running") startLoop();
      } else {
        stopLoop();
        if (statusRef.current === "running") setStatus("paused");
        detachOverlays();
      }
    }, [active]);
    useEffect(() => {
      if (simRef.current && active) attachOverlays();
    }, [theme]);
    useEffect(() => {
      if (simRef.current && active) drawHeat();
    }, [levelId]);
    useEffect(() => () => {
      stopLoop();
    }, []);
    useEffect(() => {
      reset();
    }, [model, navMap]);
    return { sim: simRef, status, snapshot, speed, setSpeed, showHeat, setShowHeat, start, pause, resume, runToEnd, reset, lidar, setLidar };
  }
  function SimulatePanel({ model, building, navMap, nav, simApi, onSelectIds, onFrameAt, missions = [], removeMission, clearMissions, pendingMission, pickingMission, onPickMission, theme, simRequest, onRequestHandled }) {
    const [sc, setSc] = useState(() => ({
      robots: 4,
      tasksPerRobot: 4,
      humans: 4,
      robotPreset: "wheeled",
      robotSpeed: 0.8,
      liftPolicy: "fcfs",
      liftCapacity: 1,
      stairsAsLifts: nav ? nav.stairsAsLifts : false,
      seed: 7,
      taskMode: "random",
      robot: null,
      // a profile handed over from Navigate; null means use robotPreset
      applyZones: false,
      // safety zones from Navigate are optional here
      doorEvents: [],
      doorInfo: "fleet"
    }));
    const set = (patch) => setSc((s) => ({ ...s, ...patch }));
    const scenarioFrom = (cfg, missionList) => {
      const preset2 = ROBOT_PRESETS.find((p) => p.id === cfg.robotPreset) || ROBOT_PRESETS[0];
      return {
        robots: cfg.robots,
        tasksPerRobot: cfg.tasksPerRobot,
        humans: cfg.humans,
        robot: cfg.robot ? { ...cfg.robot } : { ...preset2 },
        robotSpeed: cfg.robotSpeed,
        liftPolicy: cfg.liftPolicy,
        liftCapacity: cfg.liftCapacity,
        stairsAsLifts: cfg.stairsAsLifts,
        seed: cfg.seed,
        missions: cfg.taskMode === "missions" ? missionList : [],
        blocked: nav ? nav.blocked : /* @__PURE__ */ new Set(),
        obstacles: nav ? nav.obstacles : [],
        zones: nav ? nav.zones : [],
        applyZones: !!cfg.applyZones && !!(nav && nav.zones.length),
        doorEvents: (cfg.doorEvents || []).map(({ doorId, closeAt, openAt }) => ({ doorId, closeAt, openAt })),
        doorInfo: cfg.doorInfo
      };
    };
    useEffect(() => {
      if (!simRequest || !building || !navMap) return;
      const next = {
        ...sc,
        taskMode: "missions",
        tasksPerRobot: 1,
        humans: 0,
        robot: simRequest.robot || null,
        stairsAsLifts: simRequest.stairsAsLifts != null ? simRequest.stairsAsLifts : sc.stairsAsLifts
      };
      setSc(next);
      simApi.setSpeed(1);
      simApi.start(scenarioFrom(next, simRequest.missions));
      onRequestHandled && onRequestHandled();
    }, [simRequest, building, navMap]);
    if (!model) {
      return /* @__PURE__ */ React.createElement("aside", { className: "side left-side nav-side" }, /* @__PURE__ */ React.createElement("div", { className: "side-body" }, /* @__PURE__ */ React.createElement(EmptyState, { icon: Icons.Robot, title: "No model open" }, "Open an IFC model with rooms to simulate robots moving through it.")));
    }
    if (!building || !navMap) {
      return /* @__PURE__ */ React.createElement("aside", { className: "side left-side nav-side" }, /* @__PURE__ */ React.createElement("div", { className: "side-body" }, /* @__PURE__ */ React.createElement(EmptyState, { icon: Icons.Robot, title: "Preparing the simulation" }, "Building the navigation graph and occupancy grids\u2026")));
    }
    const lifts = [...building.verticals.values()].filter((v) => v.kind === "lift").length;
    const stairs = [...building.verticals.values()].filter((v) => v.kind === "stair").length;
    const preset = ROBOT_PRESETS.find((p) => p.id === sc.robotPreset) || ROBOT_PRESETS[0];
    const whatIf = (nav ? nav.blocked.size : 0) + (nav ? nav.obstacles.length : 0);
    const { status, snapshot: snap } = simApi;
    const running = status === "running";
    const run = () => simApi.start(scenarioFrom(sc, missions));
    const exportResults = () => {
      const sim = simApi.sim.current;
      if (!sim) return;
      const { blocked, obstacles, robot, ...scenario } = sim.scenario;
      download(JSON.stringify({ model: model.fileName, scenario: { ...scenario, robot, blockedDoors: [...blocked || []], obstacles }, summary: sim.summary(), events: sim.events }, null, 2), "bim2bot-simulation.json", "application/json");
    };
    const t = snap ? snap.totals : null;
    return /* @__PURE__ */ React.createElement("aside", { className: "side left-side nav-side", "aria-label": "Simulation" }, /* @__PURE__ */ React.createElement("div", { className: "side-body" }, /* @__PURE__ */ React.createElement("div", { className: "side-scroll nav-scroll" }, /* @__PURE__ */ React.createElement("div", { className: "nav-intro" }, /* @__PURE__ */ React.createElement("h2", null, "Simulation"), /* @__PURE__ */ React.createElement("p", null, "Robots run delivery tasks between rooms on the occupancy grid while people move through the building. Lifts are scheduled, congestion is measured per cell, and every close encounter is logged.")), /* @__PURE__ */ React.createElement("div", { className: "nav-section" }, /* @__PURE__ */ React.createElement("h3", null, /* @__PURE__ */ React.createElement(Icons.Robot, { size: 16 }), " Scenario"), /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("span", null, "Tasks"), /* @__PURE__ */ React.createElement("div", { className: "seg seg-wide", role: "group", "aria-label": "Task mode" }, /* @__PURE__ */ React.createElement("button", { type: "button", "aria-pressed": sc.taskMode === "random", onClick: () => set({ taskMode: "random" }) }, "Random deliveries"), /* @__PURE__ */ React.createElement("button", { type: "button", "aria-pressed": sc.taskMode === "missions", onClick: () => set({ taskMode: "missions" }) }, "Custom missions"))), sc.taskMode === "missions" && /* @__PURE__ */ React.createElement("div", { className: "missions" }, missions.length === 0 && !pendingMission && /* @__PURE__ */ React.createElement("p", { className: "pane-note" }, "No missions yet. Add one by clicking a start and then a goal on the floor plan or the 3D floor grid. Each robot shuttles between its mission's points."), missions.map((m, i) => /* @__PURE__ */ React.createElement("div", { key: m.id, className: "list-row" }, /* @__PURE__ */ React.createElement("span", { className: "robot-dot", style: { background: (theme === "dark" ? ROBOT_COLORS_DARK : ROBOT_COLORS)[i % 8] } }), /* @__PURE__ */ React.createElement("div", { className: "list-main" }, "Robot ", i + 1, ": ", levelLabel(building, m.start), " to ", levelLabel(building, m.goal)), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.X, label: `Remove mission ${i + 1}`, size: 13, className: "sm", onClick: () => removeMission(m.id) }))), /* @__PURE__ */ React.createElement("div", { className: "sim-actions" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-sm", "data-active": pickingMission, disabled: missions.length >= 8, onClick: onPickMission }, /* @__PURE__ */ React.createElement(Icons.Plus, { size: 14 }), " ", pickingMission ? pendingMission ? "Click the goal" : "Click the start" : "Add a mission on the map"), missions.length > 0 && /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-ghost btn-sm", onClick: clearMissions }, "Clear missions"))), /* @__PURE__ */ React.createElement("div", { className: "field-grid" }, /* @__PURE__ */ React.createElement("label", { className: "field" }, /* @__PURE__ */ React.createElement("span", null, "Robots"), /* @__PURE__ */ React.createElement("input", { type: "number", min: "1", max: "8", value: sc.taskMode === "missions" ? missions.length : sc.robots, disabled: sc.taskMode === "missions", onChange: (e) => set({ robots: clampInt(e.target.value, 1, 8) }) })), /* @__PURE__ */ React.createElement("label", { className: "field" }, /* @__PURE__ */ React.createElement("span", null, sc.taskMode === "missions" ? "Trips per robot" : "Tasks per robot"), /* @__PURE__ */ React.createElement("input", { type: "number", min: "1", max: "20", value: sc.tasksPerRobot, onChange: (e) => set({ tasksPerRobot: clampInt(e.target.value, 1, 20) }) })), /* @__PURE__ */ React.createElement("label", { className: "field" }, /* @__PURE__ */ React.createElement("span", null, "People"), /* @__PURE__ */ React.createElement("input", { type: "number", min: "0", max: "30", value: sc.humans, onChange: (e) => set({ humans: clampInt(e.target.value, 0, 30) }) })), /* @__PURE__ */ React.createElement("label", { className: "field" }, /* @__PURE__ */ React.createElement("span", null, "Robot speed (m/s)"), /* @__PURE__ */ React.createElement("input", { type: "number", min: "0.2", max: "2", step: "0.1", value: sc.robotSpeed, onChange: (e) => set({ robotSpeed: Math.min(2, Math.max(0.2, Number(e.target.value) || 0.8)) }) }))), /* @__PURE__ */ React.createElement("label", { className: "field" }, /* @__PURE__ */ React.createElement("span", null, "Robot type"), /* @__PURE__ */ React.createElement("select", { value: sc.robot ? "navigate" : sc.robotPreset, onChange: (e) => e.target.value === "navigate" ? null : set({ robotPreset: e.target.value, robot: null }) }, sc.robot && /* @__PURE__ */ React.createElement("option", { value: "navigate" }, sc.robot.name, " (", sc.robot.width, " m), from Navigate"), ROBOT_PRESETS.map((p) => /* @__PURE__ */ React.createElement("option", { key: p.id, value: p.id }, p.name, " (", p.width, " m", p.canUseStairs ? ", stairs" : "", p.canUseLifts ? ", lifts" : "", ")")))), /* @__PURE__ */ React.createElement("div", { className: "field-grid" }, /* @__PURE__ */ React.createElement("label", { className: "field" }, /* @__PURE__ */ React.createElement("span", null, "Lift scheduling"), /* @__PURE__ */ React.createElement("select", { value: sc.liftPolicy, onChange: (e) => set({ liftPolicy: e.target.value }) }, /* @__PURE__ */ React.createElement("option", { value: "fcfs" }, "First come, first served"), /* @__PURE__ */ React.createElement("option", { value: "nearest" }, "Nearest car, collective"))), /* @__PURE__ */ React.createElement("label", { className: "field" }, /* @__PURE__ */ React.createElement("span", null, "Lift capacity"), /* @__PURE__ */ React.createElement("input", { type: "number", min: "1", max: "6", value: sc.liftCapacity, onChange: (e) => set({ liftCapacity: clampInt(e.target.value, 1, 6) }) }))), stairs > 0 && /* @__PURE__ */ React.createElement("label", { className: "check-field whatif" }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: sc.stairsAsLifts, onChange: (e) => set({ stairsAsLifts: e.target.checked }) }), " What-if: put a lift in each stair core"), nav && nav.zones.length > 0 && /* @__PURE__ */ React.createElement("label", { className: "check-field whatif" }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: sc.applyZones, onChange: (e) => set({ applyZones: e.target.checked }) }), " Apply the ", plural(nav.zones.length, "safety zone"), " from Navigate (no-go zones keep robots out, slow zones cap their speed)"), /* @__PURE__ */ React.createElement(DoorScheduleEditor, { building, events: sc.doorEvents, onChange: (doorEvents) => set({ doorEvents }), info: sc.doorInfo, onInfo: (doorInfo) => set({ doorInfo }), onSelectIds }), /* @__PURE__ */ React.createElement("p", { className: "pane-note" }, "The model has ", plural(lifts, "lift"), " and ", plural(stairs, "stair"), ". ", lifts === 0 && !sc.stairsAsLifts && !preset.canUseStairs ? "Without lifts this robot stays on its start level." : "", whatIf > 0 ? ` ${plural(whatIf, "what-if change")} from Navigate (blocked doors and obstacles) apply.` : ""), /* @__PURE__ */ React.createElement("div", { className: "field-grid seed-row" }, /* @__PURE__ */ React.createElement("label", { className: "field" }, /* @__PURE__ */ React.createElement("span", null, "Random seed"), /* @__PURE__ */ React.createElement("input", { type: "number", value: sc.seed, onChange: (e) => set({ seed: clampInt(e.target.value, 0, 1e9) }) })), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-sm", onClick: () => set({ seed: Math.floor(Math.random() * 1e6) }) }, /* @__PURE__ */ React.createElement(Icons.Refresh, { size: 14 }), " New seed")), /* @__PURE__ */ React.createElement("div", { className: "sim-actions" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-primary", onClick: run, disabled: sc.taskMode === "missions" && missions.length === 0 }, /* @__PURE__ */ React.createElement(Icons.Play, { size: 14 }), " ", status === "idle" ? "Start simulation" : "Restart"), status !== "idle" && (running ? /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn", onClick: simApi.pause }, "Pause") : /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn", onClick: simApi.resume, disabled: status === "done" }, "Resume")), status !== "idle" && status !== "done" && /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-ghost", onClick: simApi.runToEnd }, "Run to end"))), /* @__PURE__ */ React.createElement(ExperimentsSection, { model, building, navMap, baseScenario: () => scenarioFrom(sc, missions), missionMode: sc.taskMode === "missions", disabled: sc.taskMode === "missions" && missions.length === 0 }), snap && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "nav-section" }, /* @__PURE__ */ React.createElement("div", { className: "sim-clock" }, /* @__PURE__ */ React.createElement("span", { className: "mono" }, fmtClock(snap.time)), /* @__PURE__ */ React.createElement("span", { className: "sim-status", "data-status": status }, status === "done" ? snap.timedOut ? "Stopped at the time limit" : "Finished" : status === "running" ? "Running" : "Paused"), /* @__PURE__ */ React.createElement("div", { className: "seg", role: "group", "aria-label": "Playback speed" }, SIM_SPEEDS.map((s) => /* @__PURE__ */ React.createElement("button", { key: s, type: "button", "aria-pressed": simApi.speed === s, onClick: () => simApi.setSpeed(s) }, s, "\xD7")))), /* @__PURE__ */ React.createElement("div", { className: "meter" }, /* @__PURE__ */ React.createElement("div", { className: "meter-label" }, /* @__PURE__ */ React.createElement("span", null, "Tasks completed"), /* @__PURE__ */ React.createElement("span", { className: "mono" }, t.tasksDone, " / ", t.tasksPlanned)), /* @__PURE__ */ React.createElement("div", { className: "meter-track" }, /* @__PURE__ */ React.createElement("div", { style: { width: `${t.tasksPlanned ? t.tasksDone / t.tasksPlanned * 100 : 0}%` } }))), /* @__PURE__ */ React.createElement("div", { className: "kpi-grid" }, /* @__PURE__ */ React.createElement(Kpi, { k: "Makespan", v: fmtSec(t.makespan) }), /* @__PURE__ */ React.createElement(Kpi, { k: "Throughput", v: `${t.throughputPerHour.toFixed(0)} /h` }), /* @__PURE__ */ React.createElement(Kpi, { k: "Mean task time", v: fmtSec(t.meanTaskTime) }), /* @__PURE__ */ React.createElement(Kpi, { k: "Distance driven", v: `${t.distance.toFixed(0)} m` }), /* @__PURE__ */ React.createElement(Kpi, { k: "Congestion wait", v: fmtSec(t.congestionWait) }), /* @__PURE__ */ React.createElement(Kpi, { k: "Lift wait", v: fmtSec(t.liftWait) }), /* @__PURE__ */ React.createElement(Kpi, { k: "Encounters with people", v: t.encounters }), /* @__PURE__ */ React.createElement(Kpi, { k: "Near misses", v: t.nearMisses, tone: t.nearMisses ? "warn" : null }), /* @__PURE__ */ React.createElement(Kpi, { k: "Closest approach", v: t.minSeparation != null ? `${t.minSeparation.toFixed(2)} m` : "\u2014" }), /* @__PURE__ */ React.createElement(Kpi, { k: "Deadlocks resolved", v: t.deadlocks, tone: t.deadlocks ? "warn" : null }), (t.doorChanges > 0 || t.replans > 0) && /* @__PURE__ */ React.createElement(Kpi, { k: "Re-plans for doors", v: t.replans }), (t.doorChanges > 0 || t.blockedTime > 0) && /* @__PURE__ */ React.createElement(Kpi, { k: "Waiting at closed doors", v: fmtSec(t.blockedTime), tone: t.blockedTime ? "warn" : null }), t.zonesApplied > 0 && /* @__PURE__ */ React.createElement(Kpi, { k: "Slowed in zones", v: fmtSec(t.zoneSlowTime) })), t.unreachable > 0 && /* @__PURE__ */ React.createElement("p", { className: "pane-note warn-note" }, plural(t.unreachable, "task"), " had no reachable destination and were skipped."), /* @__PURE__ */ React.createElement("div", { className: "toggle-row" }, /* @__PURE__ */ React.createElement("label", { className: "check-field" }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: simApi.showHeat, onChange: (e) => simApi.setShowHeat(e.target.checked) }), " Congestion heatmap"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-ghost btn-sm", onClick: exportResults }, /* @__PURE__ */ React.createElement(Icons.Download, { size: 14 }), " Export results"))), /* @__PURE__ */ React.createElement("div", { className: "nav-section" }, /* @__PURE__ */ React.createElement("h3", null, /* @__PURE__ */ React.createElement(Icons.Robot, { size: 16 }), " Fleet"), /* @__PURE__ */ React.createElement("table", { className: "dtbl compact" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Robot"), /* @__PURE__ */ React.createElement("th", null, "State"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Tasks"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Waited"))), /* @__PURE__ */ React.createElement("tbody", null, snap.robots.map((r) => /* @__PURE__ */ React.createElement("tr", { key: r.id, title: `Driving ${fmtSec(r.moveT)}, congestion ${fmtSec(r.waitT)}, lift wait ${fmtSec(r.liftWaitT)}, riding ${fmtSec(r.rideT)}, stopped for people ${fmtSec(r.stopT)}` }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: "robot-dot", style: { background: (document.documentElement.getAttribute("data-theme") === "dark" ? ROBOT_COLORS_DARK : ROBOT_COLORS)[r.colorIndex] || r.color } }), r.name), /* @__PURE__ */ React.createElement("td", { className: "muted" }, robotStateLabel(r.state)), /* @__PURE__ */ React.createElement("td", { className: "num mono" }, r.tasks), /* @__PURE__ */ React.createElement("td", { className: "num mono" }, fmtSec(r.waitT + r.liftWaitT + r.stopT))))))), snap.lifts.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "nav-section" }, /* @__PURE__ */ React.createElement("h3", null, /* @__PURE__ */ React.createElement(Icons.Stairs, { size: 16 }), " Lifts"), /* @__PURE__ */ React.createElement("table", { className: "dtbl compact" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Lift"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Served"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Mean wait"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Busy"))), /* @__PURE__ */ React.createElement("tbody", null, snap.lifts.map((L) => /* @__PURE__ */ React.createElement("tr", { key: L.id, title: `Max queue ${L.maxQueue}, ${L.trips} trips, now at ${L.level}`, onClick: () => !L.virtual && onSelectIds([L.id]) }, /* @__PURE__ */ React.createElement("td", { className: "ellipsis" }, L.name), /* @__PURE__ */ React.createElement("td", { className: "num mono" }, L.served), /* @__PURE__ */ React.createElement("td", { className: "num mono" }, fmtSec(L.meanWait)), /* @__PURE__ */ React.createElement("td", { className: "num mono" }, Math.round(L.utilisation * 100), "%")))))), /* @__PURE__ */ React.createElement("div", { className: "nav-section" }, /* @__PURE__ */ React.createElement("h3", null, /* @__PURE__ */ React.createElement(Icons.Activity, { size: 16 }), " Congestion hotspots"), snap.hotspots.length === 0 ? /* @__PURE__ */ React.createElement("p", { className: "pane-note" }, "No robot has had to wait for another robot yet.") : /* @__PURE__ */ React.createElement("ol", { className: "hotspots" }, snap.hotspots.map((h, i) => /* @__PURE__ */ React.createElement("li", { key: i }, /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => onFrameAt(h) }, /* @__PURE__ */ React.createElement("span", { className: "hs-bar" }, /* @__PURE__ */ React.createElement("span", { style: { width: `${h.wait / snap.hotspots[0].wait * 100}%` } })), /* @__PURE__ */ React.createElement("span", { className: "hs-text" }, h.room || "Circulation", " ", /* @__PURE__ */ React.createElement("span", { className: "muted" }, "\xB7 ", h.levelName)), /* @__PURE__ */ React.createElement("span", { className: "mono" }, fmtSec(h.wait))))))), /* @__PURE__ */ React.createElement(LidarSection, { simApi, model }), /* @__PURE__ */ React.createElement(SimEvents, { sim: simApi.sim.current, onFrameAt })))));
  }
  function SimEvents({ sim, onFrameAt }) {
    if (!sim) return null;
    const kinds = /* @__PURE__ */ new Set(["near-miss", "deadlock", "unreachable", "door-closed", "door-opened", "replan", "blocked"]);
    const list = sim.events.filter((e) => kinds.has(e.kind)).slice(-14).reverse();
    return /* @__PURE__ */ React.createElement("div", { className: "nav-section" }, /* @__PURE__ */ React.createElement("h3", null, /* @__PURE__ */ React.createElement(Icons.Alert, { size: 16 }), " Safety, conflict and door log"), list.length === 0 ? /* @__PURE__ */ React.createElement("p", { className: "pane-note" }, "No near misses, deadlocks or door changes so far.") : /* @__PURE__ */ React.createElement("ul", { className: "event-list" }, list.map((e, i) => /* @__PURE__ */ React.createElement("li", { key: i, "data-kind": e.kind }, /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => e.pos && onFrameAt({ x: e.pos[0], y: e.pos[1], z: e.pos[2] }) }, /* @__PURE__ */ React.createElement("span", { className: "mono muted" }, fmtClock(e.t)), /* @__PURE__ */ React.createElement("span", null, e.text))))));
  }
  function levelLabel(building, pt) {
    if (!pt) return "\u2014";
    const l = building.levels.find((x) => x.id === pt.levelId);
    return `${l ? l.name : "level"} (${pt.x.toFixed(1)}, ${pt.z.toFixed(1)})`;
  }
  function Kpi({ k, v, tone }) {
    return /* @__PURE__ */ React.createElement("div", { className: "kpi", "data-tone": tone || void 0 }, /* @__PURE__ */ React.createElement("div", { className: "kpi-v mono" }, v), /* @__PURE__ */ React.createElement("div", { className: "kpi-k" }, k));
  }
  function robotStateLabel(s) {
    return { moving: "Driving", "lift-wait": "Waiting for lift", riding: "In lift", stairs: "On stairs", blocked: "Waiting at a closed door", done: "Done", idle: "Idle" }[s] || s;
  }
  function clampInt(v, min, max) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
  }
  Object.assign(window, { useSimulation, SimulatePanel, Kpi, fmtSec, fmtClock, clampInt });
})();
