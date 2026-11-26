/** Simulate workspace (Version 3): scenario set-up, playback and results. */

const SIM_SPEEDS = [1, 2, 5, 10, 30];

function fmtClock(t) {
  const s = Math.floor(t);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function fmtSec(t) {
  if (t == null) return '—';
  return t >= 90 ? `${(t / 60).toFixed(1)} min` : `${t.toFixed(1)} s`;
}

/**
 * Owns the running simulation, its 3D agents and heatmap overlays.
 * The engine advances on the viewer's frame callback while running.
 */
function useSimulation({ viewerRef, model, building, navMap, theme, levelId, active }) {
  const simRef = useRef(null);
  const agentsRef = useRef(null);
  const unsubRef = useRef(null);
  const statusRef = useRef('idle');
  const speedRef = useRef(5);
  const heatRef = useRef(true);
  const lastUi = useRef(0);
  const lastHeat = useRef(0);
  const [status, setStatusState] = useState('idle');
  const [snapshot, setSnapshot] = useState(null);
  const [speed, setSpeedState] = useState(5);
  const [showHeat, setShowHeatState] = useState(true);
  // On by default for every robot; robotId 'all' scans the whole fleet.
  const lidarRef = useRef({ enabled: true, robotId: 'all', ...LIDAR_DEFAULTS });
  // With one level shown, only agents and scans on that level are drawn.
  const levelRef = useRef(levelId);
  levelRef.current = levelId;
  const onShownLevel = (lid) => levelRef.current == null || levelRef.current === 'all' || String(lid) === String(levelRef.current);
  const lidarOverlayRef = useRef(null);
  const [lidar, setLidarState] = useState(lidarRef.current);

  // Simulated LiDAR per robot, on the current map (closed doors included) with people and robots.
  // sim.lidarScans holds every scan this frame; sim.lidar is the first, kept for older readers.
  const computeLidar = () => {
    const sim = simRef.current;
    if (!sim) return;
    const cfg = lidarRef.current;
    let targets = [];
    if (cfg.enabled) {
      targets = cfg.robotId === 'all' ? sim.robots : sim.robots.filter(r => r.id === cfg.robotId);
      if (!targets.length && sim.robots.length) targets = [sim.robots[0]];
    }
    const body = (sim.scenario.robot ? sim.scenario.robot.width : 0.6) / 2;
    const scans = [];
    targets.forEach(rb => {
      if (rb.state === 'riding' || rb.state === 'stairs') return;
      const lv = sim.nav.levels.get(rb.levelId);
      if (!lv) return;
      const dynamic = [];
      sim.humans.forEach(h => { if (h.levelId === rb.levelId) dynamic.push({ x: h.pos[0], z: h.pos[2], r: 0.22 }); });
      sim.robots.forEach(o => { if (o !== rb && o.levelId === rb.levelId && o.state !== 'riding' && o.state !== 'stairs') dynamic.push({ x: o.pos[0], z: o.pos[2], r: body }); });
      const pose = { levelId: rb.levelId, x: rb.pos[0], z: rb.pos[2], heading: rb.heading };
      const scan = lidarScan(sim.nav, pose, cfg, dynamic, Math.round(sim.time * 10) + 1 + rb.id * 7919);
      scan.robotName = rb.name;
      scan.robotId = rb.id;
      scan.colorIndex = rb.colorIndex;
      scan.y = lv.grid.floorY + cfg.mountHeight;
      scans.push(scan);
    });
    sim.lidarScans = scans;
    sim.lidar = scans[0] || null;
    if (lidarOverlayRef.current) lidarOverlayRef.current.update(scans.filter(sc => onShownLevel(sc.pose.levelId)), sim.robots.length);
  };
  const attachLidar = () => {
    const v = viewerRef.current;
    if (!v) return;
    if (lidarRef.current.enabled && simRef.current) {
      lidarOverlayRef.current = buildLidarOverlay({ theme });
      v.setOverlay('sim-lidar', lidarOverlayRef.current.group);
      computeLidar();
    } else {
      v.removeOverlay('sim-lidar');
      lidarOverlayRef.current = null;
      if (simRef.current) { simRef.current.lidar = null; simRef.current.lidarScans = []; }
    }
  };
  const setLidar = (patch) => {
    lidarRef.current = { ...lidarRef.current, ...patch };
    setLidarState(lidarRef.current);
    attachLidar();
    if (simRef.current) setSnapshot(simRef.current.summary());
    viewerRef.current?.invalidate();
  };

  const setStatus = (s) => { statusRef.current = s; setStatusState(s); };
  const setSpeed = (s) => { speedRef.current = s; setSpeedState(s); };

  const drawHeat = () => {
    const v = viewerRef.current;
    if (!v) return;
    if (simRef.current && heatRef.current) v.setOverlay('sim-heat', buildHeatOverlay(simRef.current, { levelId }));
    else v.removeOverlay('sim-heat');
  };
  const setShowHeat = (on) => { heatRef.current = on; setShowHeatState(on); drawHeat(); };

  const stopLoop = () => { if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; } };
  const startLoop = () => {
    stopLoop();
    const v = viewerRef.current;
    if (!v || !simRef.current) return;
    unsubRef.current = v.onFrame((dt) => {
      const sim = simRef.current;
      if (!sim) return;
      if (statusRef.current === 'running') sim.step(dt * speedRef.current);
      agentsRef.current && agentsRef.current.update();
      if (lidarRef.current.enabled && statusRef.current === 'running') computeLidar();
      const now = performance.now();
      if (now - lastUi.current > 250) { lastUi.current = now; setSnapshot(sim.summary()); }
      if (heatRef.current && now - lastHeat.current > 1500) { lastHeat.current = now; drawHeat(); }
      if (sim.done && statusRef.current === 'running') {
        setStatus('done');
        setSnapshot(sim.summary());
        drawHeat();
        stopLoop();
      }
    });
  };

  const detachOverlays = () => {
    const v = viewerRef.current;
    if (!v) return;
    v.removeOverlay('sim-agents');
    v.removeOverlay('sim-heat');
    v.removeOverlay('sim-lidar');
    lidarOverlayRef.current = null;
  };
  const attachOverlays = () => {
    const v = viewerRef.current;
    if (!v || !simRef.current) return;
    agentsRef.current = buildAgentsOverlay(simRef.current, { theme, isShown: onShownLevel });
    v.setOverlay('sim-agents', agentsRef.current.group);
    drawHeat();
    attachLidar();
  };

  const start = (scenario) => {
    stopLoop();
    detachOverlays();
    simRef.current = createSimulation({ model, building, navMap }, scenario);
    attachOverlays();
    setSnapshot(simRef.current.summary());
    setStatus(simRef.current.done ? 'done' : 'running');
    startLoop();
    // Frame the rooms the fleet works in.
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    simRef.current.rooms.forEach(rm => {
      const s = building.spaces.get(rm.id);
      if (!s) return;
      for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], s.bbox.min[a]); max[a] = Math.max(max[a], s.bbox.max[a]); }
    });
    if (Number.isFinite(min[0])) viewerRef.current?.frameModelBox({ min, max });
    return simRef.current;
  };
  const pause = () => { setStatus('paused'); stopLoop(); };
  const resume = () => { if (!simRef.current || simRef.current.done) return; setStatus('running'); startLoop(); };
  const runToEnd = () => {
    const sim = simRef.current;
    if (!sim) return;
    stopLoop();
    sim.runToEnd();
    agentsRef.current && agentsRef.current.update();
    computeLidar();
    setSnapshot(sim.summary());
    setStatus('done');
    drawHeat();
    viewerRef.current?.invalidate();
  };
  const reset = () => {
    stopLoop();
    detachOverlays();
    simRef.current = null;
    agentsRef.current = null;
    setSnapshot(null);
    setStatus('idle');
  };

  // Leaving the workspace pauses and hides the agents; coming back shows them again.
  useEffect(() => {
    if (!simRef.current) return;
    if (active) {
      attachOverlays();
      if (statusRef.current === 'running') startLoop();
    } else {
      stopLoop();
      if (statusRef.current === 'running') setStatus('paused');
      detachOverlays();
    }
  }, [active]);
  useEffect(() => { if (simRef.current && active) attachOverlays(); }, [theme]);
  useEffect(() => {
    if (!simRef.current || !active) return;
    drawHeat();
    agentsRef.current && agentsRef.current.update();
    if (lidarRef.current.enabled) computeLidar();
    viewerRef.current?.invalidate();
  }, [levelId]);
  useEffect(() => () => { stopLoop(); }, []);
  // Frame-exact capture for recordings (only with ?capture=1): step the paused simulation by a
  // fixed time so screen captures play back smoothly at true 1x speed.
  useEffect(() => {
    if (typeof location === 'undefined' || !/[?&]capture=1\b/.test(location.search)) return undefined;
    window.__bim2botCapture = {
      step: (dt) => {
        const sim = simRef.current;
        if (!sim) return null;
        sim.step(dt);
        agentsRef.current && agentsRef.current.update();
        if (lidarRef.current.enabled) computeLidar();
        setSnapshot(sim.summary());
        viewerRef.current?.invalidate();
        return { time: sim.time, done: sim.done };
      },
      start: (scenario) => { start(scenario); return true; },
      // Point the camera at a spot (model coordinates), r metres around it.
      frame: (x, y, z, r = 3) => { viewerRef.current?.frameModelBox({ min: [x - r, y, z - r], max: [x + r, y + 2, z + r] }); return true; },
      // Body-to-obstacle gap (m) of every robot on the floor at its current pose, for checks.
      probe: () => {
        const sim = simRef.current;
        if (!sim) return null;
        const nav = sim.nav;
        return sim.robots.filter(r => r.state !== 'riding' && r.state !== 'stairs' && r.state !== 'done').map(r => {
          const lv = nav.levels.get(r.levelId);
          const q = lv ? footprintGap(lv, r.pos[0], r.pos[2], r.heading, nav.footprint) : null;
          return { id: r.id, levelId: r.levelId, x: r.pos[0], z: r.pos[2], heading: r.heading, state: r.state, ghost: r.ghost > 0, gap: q ? q.gap : null };
        });
      },
      // Geometry of one storey (model coordinates), merged per element colour.
      exportLevel: (levelName) => {
        const lv = building && building.levels.find(l => l.name === levelName);
        if (!lv || !model) return null;
        const groups = new Map();
        model.elements.forEach(el => {
          if (el.isType || !el.geometry || !el.geometry.positions || !el.storey || el.storey.expressId !== lv.storeyId) return;
          if (/^Ifc(Space|OpeningElement)/.test(el.ifcClass)) return;
          const g = el.geometry;
          const c = g.color || { r: 0.8, g: 0.8, b: 0.8, a: 1 };
          const key = [c.r, c.g, c.b, c.a].map(v => Math.round(v * 255)).join(',');
          let list = groups.get(key);
          if (!list) groups.set(key, list = [{ c: [c.r, c.g, c.b, c.a], p: [], i: [] }]);
          let grp = list[list.length - 1];
          if (grp.p.length / 3 + g.positions.length / 3 > 65000) list.push(grp = { c: grp.c, p: [], i: [] });
          const base = grp.p.length / 3;
          for (let k = 0; k < g.positions.length; k++) grp.p.push(g.positions[k]);
          for (let k = 0; k < g.indices.length; k++) grp.i.push(g.indices[k] + base);
        });
        return { levelId: lv.id, floorY: lv.floorY, groups: [...groups.values()].flat() };
      },
      // Poses of every agent and the current LiDAR hits, for recorded previews.
      poses: () => {
        const sim = simRef.current;
        if (!sim) return null;
        return {
          t: sim.time,
          kind: robotKindOf(sim.scenario.robot),
          width: sim.scenario.robot ? sim.scenario.robot.width : 0.6,
          safety: sim.scenario.safetyRadius,
          robots: sim.robots.map(r => ({ x: r.pos[0], y: r.pos[1], z: r.pos[2], h: r.heading, l: r.levelId, s: r.state, c: r.colorIndex })),
          humans: sim.humans.map(h => ({ x: h.pos[0], y: h.pos[1], z: h.pos[2], l: h.levelId })),
          scans: (sim.lidarScans || []).map(sc => ({ id: sc.robotId, y: sc.y, x: sc.pose.x, z: sc.pose.z, l: sc.pose.levelId, range: sc.cfg.range, hits: Array.from(sc.hits), ranges: Array.from(sc.ranges) })),
        };
      },
      look: (background) => {
        const v = viewerRef.current;
        if (!v) return false;
        v.setShowGrid(false);
        v.setShowAxes && v.setShowAxes(false);
        v.scene.background = new THREE.Color(background);
        v.scene.fog = null;
        v.invalidate();
        return true;
      },
      cut: (levelName, height) => {
        const lv = building && building.levels.find(l => l.name === levelName);
        if (!lv || lv.floorY == null) return false;
        viewerRef.current?.setPlanCut({ enabled: true, y: lv.floorY + height });
        return true;
      },
      rooms: () => (building ? [...building.spaces.values()].map(sp => ({ id: sp.id, name: sp.name, levelId: sp.levelId, x: sp.position[0], z: sp.position[2] })) : []),
    };
    return () => { delete window.__bim2botCapture; };
  });
  useEffect(() => { reset(); }, [model, navMap]);

  return { sim: simRef, status, snapshot, speed, setSpeed, showHeat, setShowHeat, start, pause, resume, runToEnd, reset, lidar, setLidar };
}

function SimulatePanel({ model, building, navMap, nav, simApi, onSelectIds, onFrameAt, missions = [], removeMission, clearMissions, pendingMission, pickingMission, onPickMission, theme, simRequest, onRequestHandled }) {
  const [sc, setSc] = useState(() => ({
    robots: 4,
    tasksPerRobot: 4,
    humans: 4,
    robotPreset: 'wheeled',
    robotSpeed: 0.8,
    liftPolicy: 'fcfs',
    liftCapacity: 1,
    stairsAsLifts: nav ? nav.stairsAsLifts : false,
    seed: 7,
    taskMode: 'random',
    robot: null, // a profile handed over from Navigate; null means use robotPreset
    applyZones: false, // safety zones from Navigate are optional here
    doorEvents: [],
    doorInfo: 'fleet',
  }));
  const set = (patch) => setSc(s => ({ ...s, ...patch }));

  const scenarioFrom = (cfg, missionList) => {
    const preset = ROBOT_PRESETS.find(p => p.id === cfg.robotPreset) || ROBOT_PRESETS[0];
    return {
      robots: cfg.robots,
      tasksPerRobot: cfg.tasksPerRobot,
      humans: cfg.humans,
      robot: cfg.robot ? { ...cfg.robot } : { ...preset },
      robotSpeed: cfg.robotSpeed,
      liftPolicy: cfg.liftPolicy,
      liftCapacity: cfg.liftCapacity,
      stairsAsLifts: cfg.stairsAsLifts,
      seed: cfg.seed,
      missions: cfg.taskMode === 'missions' ? missionList : [],
      blocked: nav ? nav.blocked : new Set(),
      obstacles: nav ? nav.obstacles : [],
      zones: nav ? nav.zones : [],
      applyZones: !!cfg.applyZones && !!(nav && nav.zones.length),
      doorEvents: (cfg.doorEvents || []).map(({ doorId, closeAt, openAt }) => ({ doorId, closeAt, openAt })),
      doorInfo: cfg.doorInfo,
    };
  };

  // "Simulate this route" from Navigate: one robot, one trip along the chosen route, no people.
  // Runs once the occupancy grids exist; afterwards the scenario stays editable.
  useEffect(() => {
    if (!simRequest || !building || !navMap) return;
    const next = {
      ...sc,
      taskMode: 'missions',
      tasksPerRobot: 1,
      humans: 0,
      robot: simRequest.robot || null,
      stairsAsLifts: simRequest.stairsAsLifts != null ? simRequest.stairsAsLifts : sc.stairsAsLifts,
    };
    setSc(next);
    simApi.setSpeed(1); // one route: play it in real time so the trip is visible
    simApi.start(scenarioFrom(next, simRequest.missions));
    onRequestHandled && onRequestHandled();
  }, [simRequest, building, navMap]);

  if (!model) {
    return <aside className="side left-side nav-side"><div className="side-body"><EmptyState icon={Icons.Robot} title="No model open">Open an IFC model with rooms to simulate robots moving through it.</EmptyState></div></aside>;
  }
  if (!building || !navMap) {
    return <aside className="side left-side nav-side"><div className="side-body"><EmptyState icon={Icons.Robot} title="Preparing the simulation">Building the navigation graph and occupancy grids…</EmptyState></div></aside>;
  }

  const lifts = [...building.verticals.values()].filter(v => v.kind === 'lift').length;
  const stairs = [...building.verticals.values()].filter(v => v.kind === 'stair').length;
  const preset = ROBOT_PRESETS.find(p => p.id === sc.robotPreset) || ROBOT_PRESETS[0];
  const whatIf = (nav ? nav.blocked.size : 0) + (nav ? nav.obstacles.length : 0);
  const { status, snapshot: snap } = simApi;
  const running = status === 'running';

  const run = () => simApi.start(scenarioFrom(sc, missions));

  const exportResults = () => {
    const sim = simApi.sim.current;
    if (!sim) return;
    const { blocked, obstacles, robot, ...scenario } = sim.scenario;
    download(JSON.stringify({ model: model.fileName, scenario: { ...scenario, robot, blockedDoors: [...(blocked || [])], obstacles }, summary: sim.summary(), events: sim.events }, null, 2), 'bim2bot-simulation.json', 'application/json');
  };

  const t = snap ? snap.totals : null;

  return (
    <aside className="side left-side nav-side" aria-label="Simulation">
      <div className="side-body">
        <div className="side-scroll nav-scroll">
          <div className="nav-intro">
            <SectionTitle as="h2" title="Simulation" info={<>
              <p>Robots run delivery tasks between rooms on the occupancy grid while people move through the building.</p>
              <p>Lifts are scheduled, congestion is measured per cell, and every close encounter is logged.</p>
            </>} />
          </div>

          <div className="nav-section">
            <SectionTitle icon={Icons.Robot} title="Scenario" info={<>
              <p><strong>Random deliveries</strong>: each robot gets tasks between random rooms. <strong>Custom missions</strong>: click a start and a goal on the plan or 3D floor grid; each robot shuttles between its mission’s points.</p>
              <p>The model has {plural(lifts, 'lift')} and {plural(stairs, 'stair')}.{lifts === 0 && !sc.stairsAsLifts && !preset.canUseStairs ? ' Without lifts this robot stays on its start level.' : ''}{whatIf > 0 ? ` ${plural(whatIf, 'what-if change')} from Navigate (blocked doors and obstacles) apply.` : ''}</p>
              <p>The same seed always gives the same run, so results can be compared.</p>
            </>} />
            <div className="field">
              <span>Tasks</span>
              <div className="seg seg-wide" role="group" aria-label="Task mode">
                <button type="button" aria-pressed={sc.taskMode === 'random'} onClick={() => set({ taskMode: 'random' })}>Random deliveries</button>
                <button type="button" aria-pressed={sc.taskMode === 'missions'} onClick={() => set({ taskMode: 'missions' })}>Custom missions</button>
              </div>
            </div>
            {sc.taskMode === 'missions' && (
              <div className="missions">
                {missions.length === 0 && !pendingMission && <p className="pane-note">No missions yet. Click a start, then a goal, on the map.</p>}
                {missions.map((m, i) => (
                  <div key={m.id} className="list-row">
                    <span className="robot-dot" style={{ background: (theme === 'dark' ? ROBOT_COLORS_DARK : ROBOT_COLORS)[i % 8] }} />
                    <div className="list-main">Robot {i + 1}: {levelLabel(building, m.start)} to {levelLabel(building, m.goal)}</div>
                    <IconButton icon={Icons.X} label={`Remove mission ${i + 1}`} size={13} className="sm" onClick={() => removeMission(m.id)} />
                  </div>
                ))}
                <div className="sim-actions">
                  <button type="button" className="btn btn-sm" data-active={pickingMission} disabled={missions.length >= 8} onClick={onPickMission}>
                    <Icons.Plus size={14} /> {pickingMission ? (pendingMission ? 'Click the goal' : 'Click the start') : 'Add a mission on the map'}
                  </button>
                  {missions.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={clearMissions}>Clear missions</button>}
                </div>
              </div>
            )}
            <div className="field-grid">
              <label className="field"><span>Robots</span><input type="number" min="1" max="8" value={sc.taskMode === 'missions' ? missions.length : sc.robots} disabled={sc.taskMode === 'missions'} onChange={e => set({ robots: clampInt(e.target.value, 1, 8) })} /></label>
              <label className="field"><span>{sc.taskMode === 'missions' ? 'Trips per robot' : 'Tasks per robot'}</span><input type="number" min="1" max="20" value={sc.tasksPerRobot} onChange={e => set({ tasksPerRobot: clampInt(e.target.value, 1, 20) })} /></label>
              <label className="field"><span>People</span><input type="number" min="0" max="30" value={sc.humans} onChange={e => set({ humans: clampInt(e.target.value, 0, 30) })} /></label>
              <label className="field"><span>Robot speed (m/s)</span><input type="number" min="0.2" max="2" step="0.1" value={sc.robotSpeed} onChange={e => set({ robotSpeed: Math.min(2, Math.max(0.2, Number(e.target.value) || 0.8)) })} /></label>
            </div>
            <label className="field">
              <span>Robot type</span>
              <select value={sc.robot ? 'navigate' : sc.robotPreset} onChange={e => (e.target.value === 'navigate' ? null : set({ robotPreset: e.target.value, robot: null }))}>
                {sc.robot && <option value="navigate">{sc.robot.name} ({sc.robot.width} m), from Navigate</option>}
                <RobotPresetOptions detail={p => `${p.name} (${p.shape === 'rect' ? `${p.length} × ` : ''}${p.width} m${p.canUseStairs ? ', stairs' : ''}${p.canUseLifts ? ', lifts' : ''})`} />              </select>
            </label>
            <div className="field-grid">
              <label className="field">
                <span>Lift scheduling</span>
                <select value={sc.liftPolicy} onChange={e => set({ liftPolicy: e.target.value })}>
                  <option value="fcfs">First come, first served</option>
                  <option value="nearest">Nearest car, collective</option>
                </select>
              </label>
              <label className="field"><span>Lift capacity</span><input type="number" min="1" max="6" value={sc.liftCapacity} onChange={e => set({ liftCapacity: clampInt(e.target.value, 1, 6) })} /></label>
            </div>
            {stairs > 0 && (
              <div className="check-row">
                <label className="check-field whatif"><input type="checkbox" checked={sc.stairsAsLifts} onChange={e => set({ stairsAsLifts: e.target.checked })} /> What-if: lift in each stair core</label>
                <InfoTip title="Lift in each stair core">Pretends every stair core also holds a lift, so wheeled robots can change level in models without lifts.</InfoTip>
              </div>
            )}
            {nav && nav.zones.length > 0 && (
              <div className="check-row">
                <label className="check-field whatif"><input type="checkbox" checked={sc.applyZones} onChange={e => set({ applyZones: e.target.checked })} /> Apply {plural(nav.zones.length, 'safety zone')} from Navigate</label>
                <InfoTip title="Safety zones">No-go zones keep robots out like a wall; slow zones cap their speed. Draw them in Navigate.</InfoTip>
              </div>
            )}
            <DoorScheduleEditor building={building} events={sc.doorEvents} onChange={(doorEvents) => set({ doorEvents })} info={sc.doorInfo} onInfo={(doorInfo) => set({ doorInfo })} onSelectIds={onSelectIds} />
            {lifts === 0 && !sc.stairsAsLifts && !preset.canUseStairs && <p className="pane-note">No lifts: this robot stays on its start level.</p>}
            <div className="field-grid seed-row">
              <label className="field"><span>Random seed</span><input type="number" value={sc.seed} onChange={e => set({ seed: clampInt(e.target.value, 0, 1e9) })} /></label>
              <button type="button" className="btn btn-sm" onClick={() => set({ seed: Math.floor(Math.random() * 1e6) })}><Icons.Refresh size={14} /> New seed</button>
            </div>
            <div className="sim-actions">
              <button type="button" className="btn btn-primary" onClick={run} disabled={sc.taskMode === 'missions' && missions.length === 0}><Icons.Play size={14} /> {status === 'idle' ? 'Start simulation' : 'Restart'}</button>
              {status !== 'idle' && (running
                ? <button type="button" className="btn" onClick={simApi.pause}>Pause</button>
                : <button type="button" className="btn" onClick={simApi.resume} disabled={status === 'done'}>Resume</button>)}
              {status !== 'idle' && status !== 'done' && <button type="button" className="btn btn-ghost" onClick={simApi.runToEnd}>Run to end</button>}
            </div>
          </div>

          <ExperimentsSection model={model} building={building} navMap={navMap} baseScenario={() => scenarioFrom(sc, missions)} missionMode={sc.taskMode === 'missions'} disabled={sc.taskMode === 'missions' && missions.length === 0} />

          {snap && (
            <>
              <div className="nav-section">
                <div className="sim-clock">
                  <span className="mono">{fmtClock(snap.time)}</span>
                  <span className="sim-status" data-status={status}>{status === 'done' ? (snap.timedOut ? 'Stopped at the time limit' : 'Finished') : status === 'running' ? 'Running' : 'Paused'}</span>
                  <div className="seg" role="group" aria-label="Playback speed">
                    {SIM_SPEEDS.map(s => <button key={s} type="button" aria-pressed={simApi.speed === s} onClick={() => simApi.setSpeed(s)}>{s}×</button>)}
                  </div>
                </div>
                <div className="meter">
                  <div className="meter-label"><span>Tasks completed</span><span className="mono">{t.tasksDone} / {t.tasksPlanned}</span></div>
                  <div className="meter-track"><div style={{ width: `${t.tasksPlanned ? (t.tasksDone / t.tasksPlanned) * 100 : 0}%` }} /></div>
                </div>
                <div className="kpi-grid">
                  <Kpi k="Makespan" v={fmtSec(t.makespan)} />
                  <Kpi k="Throughput" v={`${t.throughputPerHour.toFixed(0)} /h`} />
                  <Kpi k="Mean task time" v={fmtSec(t.meanTaskTime)} />
                  <Kpi k="Distance driven" v={`${t.distance.toFixed(0)} m`} />
                  <Kpi k="Congestion wait" v={fmtSec(t.congestionWait)} />
                  <Kpi k="Lift wait" v={fmtSec(t.liftWait)} />
                  <Kpi k="Encounters with people" v={t.encounters} />
                  <Kpi k="Near misses" v={t.nearMisses} tone={t.nearMisses ? 'warn' : null} />
                  <Kpi k="Closest approach" v={t.minSeparation != null ? `${t.minSeparation.toFixed(2)} m` : '—'} />
                  <Kpi k="Deadlocks resolved" v={t.deadlocks} tone={t.deadlocks ? 'warn' : null} />
                  <Kpi k="Body overlaps" v={t.contacts || 0} tone={t.contacts ? 'warn' : null} />
                  {(t.doorChanges > 0 || t.replans > 0) && <Kpi k="Re-plans for doors" v={t.replans} />}
                  {(t.doorChanges > 0 || t.blockedTime > 0) && <Kpi k="Waiting at closed doors" v={fmtSec(t.blockedTime)} tone={t.blockedTime ? 'warn' : null} />}
                  {t.zonesApplied > 0 && <Kpi k="Slowed in zones" v={fmtSec(t.zoneSlowTime)} />}
                </div>
                {t.unreachable > 0 && <p className="pane-note warn-note">{plural(t.unreachable, 'task')} had no reachable destination and were skipped.</p>}
                <div className="toggle-row">
                  <label className="check-field"><input type="checkbox" checked={simApi.showHeat} onChange={e => simApi.setShowHeat(e.target.checked)} /> Congestion heatmap</label>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={exportResults}><Icons.Download size={14} /> Export results</button>
                </div>
              </div>

              <div className="nav-section">
                <SectionTitle icon={Icons.Robot} title="Fleet" info="Hover a robot for its time split: driving, congestion, lift wait, riding and stops for people. Waited is the sum of all waiting." />
                <table className="dtbl compact">
                  <thead><tr><th>Robot</th><th>State</th><th className="num">Tasks</th><th className="num">Waited</th></tr></thead>
                  <tbody>
                    {snap.robots.map(r => (
                      <tr key={r.id} title={`Driving ${fmtSec(r.moveT)}, congestion ${fmtSec(r.waitT)}, lift wait ${fmtSec(r.liftWaitT)}, riding ${fmtSec(r.rideT)}, stopped for people ${fmtSec(r.stopT)}`}>
                        <td><span className="robot-dot" style={{ background: (document.documentElement.getAttribute('data-theme') === 'dark' ? ROBOT_COLORS_DARK : ROBOT_COLORS)[r.colorIndex] || r.color }} />{r.name}</td>
                        <td className="muted">{robotStateLabel(r.state)}</td>
                        <td className="num mono">{r.tasks}</td>
                        <td className="num mono">{fmtSec(r.waitT + r.liftWaitT + r.stopT)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {snap.lifts.length > 0 && (
                <div className="nav-section">
                  <h3><Icons.Stairs size={16} /> Lifts</h3>
                  <table className="dtbl compact">
                    <thead><tr><th>Lift</th><th className="num">Served</th><th className="num">Mean wait</th><th className="num">Busy</th></tr></thead>
                    <tbody>
                      {snap.lifts.map(L => (
                        <tr key={L.id} title={`Max queue ${L.maxQueue}, ${L.trips} trips, now at ${L.level}`} onClick={() => !L.virtual && onSelectIds([L.id])}>
                          <td className="ellipsis">{L.name}</td>
                          <td className="num mono">{L.served}</td>
                          <td className="num mono">{fmtSec(L.meanWait)}</td>
                          <td className="num mono">{Math.round(L.utilisation * 100)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="nav-section">
                <SectionTitle icon={Icons.Activity} title="Congestion hotspots" info="Places where robots waited for each other the longest. Click one to frame it in the view." />
                {snap.hotspots.length === 0 ? <p className="pane-note">No robot has had to wait for another robot yet.</p> : (
                  <ol className="hotspots">
                    {snap.hotspots.map((h, i) => (
                      <li key={i}>
                        <button type="button" onClick={() => onFrameAt(h)}>
                          <span className="hs-bar"><span style={{ width: `${(h.wait / snap.hotspots[0].wait) * 100}%` }} /></span>
                          <span className="hs-text">{h.room || 'Circulation'} <span className="muted">· {h.levelName}</span></span>
                          <span className="mono">{fmtSec(h.wait)}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <LidarSection simApi={simApi} model={model} theme={theme} />

              <SimEvents sim={simApi.sim.current} onFrameAt={onFrameAt} />
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

function SimEvents({ sim, onFrameAt }) {
  if (!sim) return null;
  const kinds = new Set(['near-miss', 'deadlock', 'yield', 'unreachable', 'door-closed', 'door-opened', 'replan', 'blocked']);
  const list = sim.events.filter(e => kinds.has(e.kind)).slice(-14).reverse();
  return (
    <div className="nav-section">
      <h3><Icons.Alert size={16} /> Safety, conflict and door log</h3>
      {list.length === 0 ? <p className="pane-note">No near misses, deadlocks or door changes so far.</p> : (
        <ul className="event-list">
          {list.map((e, i) => (
            <li key={i} data-kind={e.kind}>
              <button type="button" onClick={() => e.pos && onFrameAt({ x: e.pos[0], y: e.pos[1], z: e.pos[2] })}>
                <span className="mono muted">{fmtClock(e.t)}</span>
                <span>{e.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function levelLabel(building, pt) {
  if (!pt) return '—';
  const l = building.levels.find(x => x.id === pt.levelId);
  return `${l ? l.name : 'level'} (${pt.x.toFixed(1)}, ${pt.z.toFixed(1)})`;
}

function Kpi({ k, v, tone }) {
  return <div className="kpi" data-tone={tone || undefined}><div className="kpi-v mono">{v}</div><div className="kpi-k">{k}</div></div>;
}

function robotStateLabel(s) {
  return { moving: 'Driving', 'lift-wait': 'Waiting for lift', riding: 'In lift', stairs: 'On stairs', blocked: 'Waiting at a closed door', done: 'Done', idle: 'Idle' }[s] || s;
}

function clampInt(v, min, max) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

Object.assign(window, { useSimulation, SimulatePanel, Kpi, fmtSec, fmtClock, clampInt });
