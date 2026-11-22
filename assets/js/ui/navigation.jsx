/**
 * Navigate workspace (Version 2 preview) and the Building Intelligence dashboard.
 * Both read the building semantic graph from core/building.jsx.
 */

const ROBOT_PRESETS = [
  { id: 'wheeled', name: 'Wheeled indoor robot', width: 0.6, height: 1.4, clearance: 0.05, canUseStairs: false, canUseLifts: true },
  { id: 'compact', name: 'Compact inspection robot', width: 0.45, height: 0.6, clearance: 0.05, canUseStairs: false, canUseLifts: true },
  { id: 'legged', name: 'Legged robot', width: 0.5, height: 0.7, clearance: 0.05, canUseStairs: true, canUseLifts: false },
  { id: 'wide', name: 'Hospital logistics cart', width: 0.9, height: 1.6, clearance: 0.05, canUseStairs: false, canUseLifts: true },
];

const STATUS_LABEL = { pass: 'Pass', warn: 'Warning', fail: 'Blocking', info: 'Note' };

function StatusIcon({ status, size = 13 }) {
  if (status === 'pass') return <Icons.Check size={size} />;
  if (status === 'info') return <Icons.Info size={size} />;
  return <Icons.Alert size={size} />;
}

function stepLabel(step) {
  if (step.kind === 'space') return step.label;
  if (step.kind === 'door') return 'Door';
  if (step.kind === 'opening') return 'Open connection';
  return step.label;
}

function NavigatePanel({ model, building, readiness, nav, route, gridRoute, navState, gridInfo, onSelectIds, onZoomTo, onFrameRoute }) {
  if (!model) {
    return <aside className="side left-side nav-side"><div className="side-body"><EmptyState icon={Icons.Route} title="No model open">Open an IFC model with rooms and doors to build its navigation graph.</EmptyState></div></aside>;
  }
  if (!building || !readiness) {
    return <aside className="side left-side nav-side"><div className="side-body"><EmptyState icon={Icons.Graph} title="Building the navigation graph">Reading space boundaries, doors and stairs…</EmptyState></div></aside>;
  }
  const spacesByLevel = building.levels.map(l => ({ level: l, spaces: l.spaceIds.map(id => building.spaces.get(id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name)) })).filter(g => g.spaces.length);
  const robot = nav.robot;
  const presetId = (ROBOT_PRESETS.find(p => p.name === robot.name) || {}).id || 'custom';
  const s = readiness.summary;
  const grid = nav.planner === 'grid';
  const hasStairs = [...building.verticals.values()].some(v => v.kind === 'stair');

  return (
    <aside className="side left-side nav-side" aria-label="Navigation">
      <div className="side-body">
        <div className="side-scroll nav-scroll">
          <div className="nav-intro">
            <h2>Navigation</h2>
            <p>Plan robot routes on a room graph or on occupancy grids derived from the IFC geometry. Every map cell and graph node traces back to the element that produced it.</p>
          </div>

          <div className="nav-section">
            <h3><Icons.Robot size={16} /> Robot</h3>
            <label className="field">
              <span>Profile</span>
              <select value={presetId} onChange={e => { const p = ROBOT_PRESETS.find(x => x.id === e.target.value); if (p) nav.setRobot({ ...p }); }}>
                {ROBOT_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                {presetId === 'custom' && <option value="custom">Custom</option>}
              </select>
            </label>
            <div className="field-grid three">
              <label className="field"><span>Width (m)</span><input type="number" min="0.2" max="2" step="0.05" value={robot.width} onChange={e => nav.setRobot({ ...robot, name: 'Custom robot', width: Math.max(0.2, Number(e.target.value) || 0.2) })} /></label>
              <label className="field"><span>Height (m)</span><input type="number" min="0.2" max="2.2" step="0.1" value={robot.height} onChange={e => nav.setRobot({ ...robot, name: 'Custom robot', height: Math.min(2.2, Math.max(0.2, Number(e.target.value) || 0.2)) })} /></label>
              <label className="field"><span>Clearance (m)</span><input type="number" min="0" max="0.5" step="0.01" value={robot.clearance} onChange={e => nav.setRobot({ ...robot, name: 'Custom robot', clearance: Math.max(0, Number(e.target.value) || 0) })} /></label>
            </div>
            <div className="toggle-row">
              <label className="check-field"><input type="checkbox" checked={robot.canUseStairs} onChange={e => nav.setRobot({ ...robot, name: 'Custom robot', canUseStairs: e.target.checked })} /> Climbs stairs</label>
              <label className="check-field"><input type="checkbox" checked={robot.canUseLifts} onChange={e => nav.setRobot({ ...robot, name: 'Custom robot', canUseLifts: e.target.checked })} /> Rides lifts</label>
            </div>
            {hasStairs && (
              <label className="check-field whatif"><input type="checkbox" checked={nav.stairsAsLifts} onChange={e => nav.setStairsAsLifts(e.target.checked)} /> What-if: put a lift in each stair core (grid planner and simulation)</label>
            )}
            <p className="pane-note">Doors need {(robot.width + 2 * robot.clearance).toFixed(2)} m clear width. The robot needs {robot.height.toFixed(1)} m headroom.</p>
          </div>

          <div className="nav-section">
            <h3><Icons.Route size={16} /> Route</h3>
            <div className="seg seg-wide" role="group" aria-label="Planner">
              <button type="button" aria-pressed={!grid} onClick={() => nav.setPlanner('graph')}>Room graph</button>
              <button type="button" aria-pressed={grid} onClick={() => nav.setPlanner('grid')}>Occupancy grid</button>
            </div>
            {spacesByLevel.length > 0 ? (
              <div className="route-fields">
                <RoomSelect label="From" value={nav.startId} groups={spacesByLevel} onChange={id => nav.setEndpoint('start', id)} />
                <IconButton icon={Icons.Swap} label="Swap start and destination" size={15} onClick={nav.swap} disabled={!nav.hasStart && !nav.hasGoal} />
                <RoomSelect label="To" value={nav.goalId} groups={spacesByLevel} onChange={id => nav.setEndpoint('goal', id)} />
              </div>
            ) : (
              <p className="pane-note">This model has no rooms (IfcSpace). Pick the start and goal directly on the floor.</p>
            )}
            <div className="pick-row">
              <button type="button" className="btn btn-sm" data-active={nav.clickMode === 'start'} onClick={() => nav.setClickMode(nav.clickMode === 'start' ? 'select' : 'start')}><Icons.Route size={14} /> Pick start on map</button>
              <button type="button" className="btn btn-sm" data-active={nav.clickMode === 'goal'} onClick={() => nav.setClickMode(nav.clickMode === 'goal' ? 'select' : 'goal')}><Icons.Pin size={14} /> Pick goal on map</button>
            </div>
            {nav.hasStart && nav.hasGoal && (
              <button type="button" className="btn btn-primary simulate-route" onClick={nav.simulateRoute} disabled={grid && !gridRoute}>
                <Icons.Play size={14} /> Simulate this route
              </button>
            )}
            {(nav.startPoint || nav.goalPoint) && (
              <p className="pane-note">
                {nav.startPoint && <>Start: point at {nav.startPoint.x.toFixed(1)}, {nav.startPoint.z.toFixed(1)} m. </>}
                {nav.goalPoint && <>Goal: point at {nav.goalPoint.x.toFixed(1)}, {nav.goalPoint.z.toFixed(1)} m. </>}
                {!grid && 'The room graph uses the rooms that contain these points.'}
              </p>
            )}
            {nav.hasStart && nav.hasGoal && !grid && (nav.startId && nav.goalId
              ? <GraphRouteCard route={route} nav={nav} onSelectIds={onSelectIds} onFrameRoute={onFrameRoute} />
              : <p className="pane-note">A picked point is outside every room, so the room graph cannot use it. Switch to the occupancy grid.</p>)}
            {nav.hasStart && nav.hasGoal && grid && <GridRouteCard route={gridRoute} navState={navState} building={building} nav={nav} onFrameRoute={onFrameRoute} />}
          </div>

          <div className="nav-section">
            <h3><Icons.Table size={16} /> Occupancy map</h3>
            {!navState ? (
              <p className="pane-note"><span className="spinner" /> Rasterising the model into occupancy grids…</p>
            ) : (
              <OccupancyMapSection navState={navState} gridInfo={gridInfo} nav={nav} model={model} onSelectIds={onSelectIds} />
            )}
          </div>

          <div className="nav-section">
            <h3><Icons.Download size={16} /> Export for ROS 2</h3>
            {!navState ? <p className="pane-note"><span className="spinner" /> Waiting for the occupancy grids…</p>
              : <RosExportSection navState={navState} model={model} gridRoute={grid ? gridRoute : null} />}
          </div>

          <div className="nav-section">
            <h3><Icons.Alert size={16} /> Safety zones</h3>
            <SafetyZonesSection nav={nav} navState={navState} />
          </div>

          <div className="nav-section">
            <h3><Icons.Ban size={16} /> What-if blocking</h3>
            {nav.blocked.size === 0 ? (
              <p className="pane-note">Block a door from the inspector or from a route step to see how the robot reroutes. Place obstacles on the occupancy map with the tools above.</p>
            ) : (
              <>
                {[...nav.blocked].map(id => {
                  const el = model.byId.get(id);
                  return (
                    <div key={id} className="list-row">
                      <Icons.Ban size={14} />
                      <div className="list-main" onClick={() => onSelectIds([id])}>{el ? elementLabel(el) : id}</div>
                      <IconButton icon={Icons.X} label="Unblock" size={13} className="sm" onClick={() => nav.toggleBlocked(id)} />
                    </div>
                  );
                })}
                <button type="button" className="btn btn-ghost btn-sm" onClick={nav.clearBlocked}>Unblock all</button>
              </>
            )}
          </div>

          <div className="nav-section">
            <h3><Icons.Graph size={16} /> Room graph</h3>
            <label className="check-field"><input type="checkbox" checked={nav.showGraph} onChange={e => nav.setShowGraph(e.target.checked)} /> Show room graph in the view</label>
            <div className="legend">
              <span><i className="lg lg-space" /> Room</span>
              <span><i className="lg lg-door" /> Door</span>
              <span><i className="lg lg-opening" /> Open connection</span>
              <span><i className="lg lg-landing" /> Stair or lift</span>
              <span><i className="lg lg-blocked" /> Blocked or too narrow</span>
            </div>
            <p className="pane-note">{plural(building.nodes.size, 'node')} and {plural(building.edges.length, 'link')} from {plural(s.rooms, 'room')}, {plural(s.doors, 'door')}, {plural(s.openings, 'open connection')} and {plural(s.verticals, 'vertical connector')}. Click a node to inspect the IFC element it came from.</p>
          </div>

          <div className="nav-section">
            <h3><Icons.Activity size={16} /> Readiness</h3>
            {s.accessibleShare != null && (
              <div className="meter" title={`${s.accessibleRooms} of ${s.rooms} rooms reachable from each other`}>
                <div className="meter-label"><span>Rooms connected on the room graph</span><span className="mono">{s.accessibleRooms} / {s.rooms}</span></div>
                <div className="meter-track"><div style={{ width: `${Math.round(s.accessibleShare * 100)}%` }} /></div>
              </div>
            )}
            {gridInfo && gridInfo.reach.share != null && (
              <div className="meter" title="Rooms the robot can drive between on the occupancy grid">
                <div className="meter-label"><span>Rooms connected on the occupancy grid</span><span className="mono">{gridInfo.reach.largest} / {building.spaces.size}</span></div>
                <div className="meter-track"><div style={{ width: `${Math.round(gridInfo.reach.share * 100)}%` }} /></div>
              </div>
            )}
            <ReadinessList checks={readiness.checks} onSelectIds={onSelectIds} onZoomTo={onZoomTo} />
          </div>
        </div>
      </div>
    </aside>
  );
}

function GraphRouteCard({ route, nav, onSelectIds, onFrameRoute }) {
  if (!route) {
    return (
      <div className="route-card is-empty">
        <strong>No route for this robot.</strong>
        <span>Doors may be too narrow or blocked, or a level change needs stairs the robot cannot climb. Check the readiness list below.</span>
      </div>
    );
  }
  return (
    <div className="route-card">
      <div className="route-stats">
        <div><span className="v mono">{route.length.toFixed(1)} m</span><span className="k">Graph length</span></div>
        <div><span className="v mono">{route.doorCount}</span><span className="k">Doors</span></div>
        <div><span className="v mono">{route.levelChanges}</span><span className="k">Level changes</span></div>
      </div>
      <ol className="route-steps">
        {route.steps.map((st, i) => (
          <li key={st.key} data-kind={st.kind}>
            <button type="button" onClick={() => onSelectIds(st.kind === 'opening' ? st.elementIds : [st.elementId])}>
              <span className="step-mark" />
              <span className="step-text">{stepLabel(st)}</span>
              {i > 0 && st.kind === 'door' && <span className="step-action" role="button" tabIndex={0} title="Block this door and reroute" onClick={(e) => { e.stopPropagation(); nav.toggleBlocked(st.elementId); }}><Icons.Ban size={13} /></span>}
            </button>
          </li>
        ))}
      </ol>
      <div className="route-foot">
        <button type="button" className="btn btn-sm" onClick={onFrameRoute}><Icons.Focus size={14} /> Frame route</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={nav.clearRoute}>Clear</button>
      </div>
    </div>
  );
}

function GridRouteCard({ route, navState, building, nav, onFrameRoute }) {
  if (!navState) return <p className="pane-note"><span className="spinner" /> Building occupancy grids…</p>;
  if (!route) {
    return (
      <div className="route-card is-empty">
        <strong>No grid path for this robot.</strong>
        <span>The rooms are not connected through free cells. Narrow doors, furniture, what-if obstacles or a missing stair or lift can cut them off. Inspect cells on the map to see why.</span>
      </div>
    );
  }
  const levelName = (id) => (navState.levels.get(id) ? navState.levels.get(id).grid.levelName : '—');
  const legLength = (l) => l.points.reduce((a, p, k) => (k ? a + Math.hypot(p[0] - l.points[k - 1][0], p[2] - l.points[k - 1][2]) : 0), 0);
  const changes = route.legs.filter(l => l.type !== 'walk').length;
  return (
    <div className="route-card">
      <div className="route-stats">
        <div><span className="v mono">{route.length.toFixed(1)} m</span><span className="k">Path length</span></div>
        <div><span className="v mono">{changes}</span><span className="k">Level changes</span></div>
        <div><span className="v mono">{route.ms.toFixed(0)} ms</span><span className="k">{route.expanded.toLocaleString()} cells searched</span></div>
      </div>
      <ol className="route-steps">
        {route.legs.map((l, i) => (
          <li key={i} data-kind={l.type === 'walk' ? 'space' : 'landing'}>
            <button type="button" tabIndex={-1}>
              <span className="step-mark" />
              <span className="step-text">{l.type === 'walk' ? `Drive ${legLength(l).toFixed(1)} m on ${levelName(l.levelId)}` : `${l.type === 'lift' ? (l.transition.virtualLift ? 'What-if lift' : 'Lift') : l.type[0].toUpperCase() + l.type.slice(1)} to ${levelName(l.toLevelId)}`}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="pane-note pad-x">8-connected A* without corner cutting, smoothed by line of sight. Cost rises within 0.4 m of the inflation limit to keep the robot mid-corridor{nav.zones.some(z => z.kind === 'slow') ? ', and inside slow zones in proportion to the lower speed' : ''}.</p>
      <div className="route-foot">
        <button type="button" className="btn btn-sm" onClick={onFrameRoute}><Icons.Focus size={14} /> Frame route</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={nav.clearRoute}>Clear</button>
      </div>
      <RouteCompare navState={navState} route={route} from={nav.startPt} to={nav.goalPt} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Route comparison: alternatives for the same start and goal, computed on demand.
// ---------------------------------------------------------------------------
function RouteCompare({ navState, route, from, to }) {
  const [open, setOpen] = useState(false);
  const [params, setParams] = useState(() => ({ ...TIME_DEFAULTS, ...ENERGY_DEFAULTS }));
  const [showModel, setShowModel] = useState(false);
  const result = useMemo(() => (open && navState && from && to ? compareRoutes(navState, from, to, params) : null), [open, navState, from, to, params]);
  const setP = (k, v, min, max) => setParams(p => ({ ...p, [k]: Math.min(max, Math.max(min, Number(v) || 0)) }));
  if (!route) return null;
  if (!open) {
    return <div className="route-foot"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}><Icons.Columns size={14} /> Compare alternative routes</button></div>;
  }
  const fmtT = (t) => (t >= 90 ? `${(t / 60).toFixed(1)} min` : `${t.toFixed(0)} s`);
  return (
    <div className="route-compare">
      <div className="rc-head">
        <strong>Alternative routes</strong>
        <IconButton icon={Icons.X} label="Close comparison" size={13} className="sm" onClick={() => setOpen(false)} />
      </div>
      <div className="rc-table">
        <table className="dtbl compact">
          <thead><tr><th>Route</th><th className="num">Drive</th><th className="num">Time</th><th className="num">Changes</th><th className="num">Energy</th></tr></thead>
          <tbody>
            {result && result.variants.map(v => (
              <tr key={v.id} title={v.note} data-muted={!!v.sameAs || !v.route}>
                <td>{v.label}</td>
                {!v.route ? <td colSpan={4} className="muted">No route</td>
                  : v.sameAs ? <td colSpan={4} className="muted">Same path as {v.sameAs}</td>
                  : (<>
                    <td className="num mono">{v.metrics.drive.toFixed(1)} m</td>
                    <td className="num mono">{fmtT(v.metrics.time)}</td>
                    <td className="num mono" title={`${v.metrics.lifts} lift, ${v.metrics.stairs} stair`}>{v.metrics.changes}</td>
                    <td className="num mono">{v.metrics.energyWh.toFixed(2)} Wh</td>
                  </>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="field-grid">
        <label className="field"><span>Robot speed (m/s)</span><input type="number" min="0.1" max="3" step="0.1" value={params.speed} onChange={e => setP('speed', e.target.value, 0.1, 3)} /></label>
        <label className="field"><span>Lift speed (m/s)</span><input type="number" min="0.2" max="5" step="0.1" value={params.liftSpeed} onChange={e => setP('liftSpeed', e.target.value, 0.2, 5)} /></label>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" aria-expanded={showModel} onClick={() => setShowModel(s => !s)}>{showModel ? 'Hide' : 'Edit'} energy model</button>
      {showModel && (
        <div className="field-grid three">
          <label className="field"><span>Driving (Wh/m)</span><input type="number" min="0" step="0.01" value={params.driveWhPerM} onChange={e => setP('driveWhPerM', e.target.value, 0, 100)} /></label>
          <label className="field"><span>Climbing (Wh/m)</span><input type="number" min="0" step="0.1" value={params.climbWhPerM} onChange={e => setP('climbWhPerM', e.target.value, 0, 1000)} /></label>
          <label className="field"><span>Idle (W)</span><input type="number" min="0" step="1" value={params.idleW} onChange={e => setP('idleW', e.target.value, 0, 5000)} /></label>
        </div>
      )}
      <p className="pane-note">Distance is measured on the planned path. Time adds lift rides (travel plus {params.liftDoorTime} s of doors at each end, no queueing) and stairs at {Math.round(params.stairSpeedFactor * 100)}% speed, as in Simulate. Energy is an estimate from the coefficients above, not a measurement: set them for your robot.{result ? ` Planned in ${result.ms.toFixed(0)} ms.` : ''}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ROS 2 export: map_server PGM + YAML per level, optional route goals, in one zip.
// ---------------------------------------------------------------------------
function RosExportSection({ navState, model, gridRoute }) {
  const [includeZones, setIncludeZones] = useState(true);
  const [voidAs, setVoidAs] = useState('occupied');
  const [withRoute, setWithRoute] = useState(true);
  const hasNogo = (navState.zones || []).some(z => z.kind === 'nogo');
  const go = () => {
    const out = exportRosMaps(navState, { includeZones, voidAs, route: withRoute ? gridRoute : null });
    const zip = makeZip(out.files);
    const stem = model.fileName.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_') || 'model';
    download(new Blob([zip], { type: 'application/zip' }), `${stem}-ros2-maps.zip`, 'application/zip');
  };
  return (
    <>
      <p className="pane-note">Standard Nav2 map_server files, one map per level: a binary PGM and its YAML, the same format as map_saver, so they load without conversion. Cells use this robot’s height. They are not inflated, because Nav2 inflates its own costmap.</p>
      <label className="field">
        <span>Cells without a floor</span>
        <select value={voidAs} onChange={e => setVoidAs(e.target.value)}>
          <option value="occupied">Occupied (safer: edges and shafts are walls)</option>
          <option value="unknown">Unknown</option>
        </select>
      </label>
      <div className="toggle-row">
        <label className="check-field"><input type="checkbox" checked={includeZones} disabled={!hasNogo} onChange={e => setIncludeZones(e.target.checked)} /> No-go zones as occupied</label>
        <label className="check-field"><input type="checkbox" checked={withRoute && !!gridRoute} disabled={!gridRoute} onChange={e => setWithRoute(e.target.checked)} /> Route as Nav2 waypoint goals</label>
      </div>
      {!gridRoute && <p className="pane-note">Plan a route on the occupancy grid to include it as FollowWaypoints goals.</p>}
      <button type="button" className="btn btn-sm" onClick={go}><Icons.Download size={14} /> Download ROS 2 maps (.zip)</button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Safety zones: rectangles drawn on the grid or plan with two clicks.
// ---------------------------------------------------------------------------
function SafetyZonesSection({ nav, navState }) {
  const mode = nav.clickMode;
  const levelName = (id) => (navState && navState.levels.get(id) ? navState.levels.get(id).grid.levelName : 'level');
  return (
    <>
      <p className="pane-note">No-go zones keep robots out, like a wall. Slow zones cap the robot’s speed, and routes prefer to avoid them. Zones always apply to routes here. In Simulate they are off unless you switch them on.</p>
      <div className="pick-row">
        <button type="button" className="btn btn-sm" data-active={mode === 'zone-nogo'} onClick={() => nav.setClickMode(mode === 'zone-nogo' ? 'select' : 'zone-nogo')}><Icons.Ban size={14} /> Draw no-go zone</button>
        <button type="button" className="btn btn-sm" data-active={mode === 'zone-slow'} onClick={() => nav.setClickMode(mode === 'zone-slow' ? 'select' : 'zone-slow')}><Icons.Speed size={14} /> Draw slow zone</button>
      </div>
      {mode === 'zone-slow' && (
        <label className="field">
          <span>Speed in the slow zone</span>
          <select value={nav.zoneFactor} onChange={e => nav.setZoneFactor(Number(e.target.value))}>
            <option value={0.25}>25% of normal speed</option>
            <option value={0.5}>50% of normal speed</option>
            <option value={0.75}>75% of normal speed</option>
          </select>
        </label>
      )}
      {/^zone-/.test(mode) && <p className="pane-note">{nav.pendingZone ? 'Click the opposite corner.' : 'Click one corner of the zone on the coloured grid or the floor plan.'}</p>}
      {nav.zones.length > 0 && (
        <div className="obstacle-list">
          {nav.zones.map(z => (
            <div key={z.id} className="list-row">
              <span className={`gl ${z.kind === 'nogo' ? 'gl-zone' : 'gl-slow'}`} />
              <div className="list-main">{z.kind === 'nogo' ? 'No-go' : `Slow (${Math.round(z.factor * 100)}%)`}, {Math.abs(z.x1 - z.x0).toFixed(1)} × {Math.abs(z.z1 - z.z0).toFixed(1)} m on {levelName(z.levelId)}</div>
              <IconButton icon={Icons.X} label="Remove zone" size={13} className="sm" onClick={() => nav.removeZone(z.id)} />
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={nav.clearZones}>Remove all zones</button>
        </div>
      )}
    </>
  );
}

function OccupancyMapSection({ navState, gridInfo, nav, model, onSelectIds }) {
  const sum = gridInfo.summary;
  const counts = new Array(CELL_STATES).fill(0);
  sum.levels.forEach(l => l.counts.forEach((c, i) => { counts[i] += c; }));
  const area = (n) => `${(n * navState.navMap.res * navState.navMap.res).toFixed(0)} m²`;
  const legend = [
    [CELL.FREE, 'Free floor', 'free'],
    [CELL.DOOR, 'Door opening', 'door'],
    [CELL.INFLATED, 'Too close to obstacle', 'inflated'],
    [CELL.OBSTACLE, 'Obstacle', 'obstacle'],
    [CELL.USER, 'What-if obstacle', 'user'],
    [CELL.BLOCKED, 'Blocked door', 'blocked'],
    ...(counts[CELL.ZONE] ? [[CELL.ZONE, 'No-go zone', 'zone']] : []),
  ];
  const cell = nav.cellInfo;
  return (
    <>
      <label className="check-field"><input type="checkbox" checked={nav.showGrid} onChange={e => nav.setShowGrid(e.target.checked)} /> Show occupancy grid in the view</label>
      <div className="grid-legend">
        {legend.map(([st, label, cls]) => (
          <div key={st}><i className={`gl gl-${cls}`} /><span>{label}</span><span className="mono muted">{area(counts[st])}</span></div>
        ))}
      </div>
      <p className="pane-note">{plural(sum.levels.length, 'level')} at {Math.round(navState.navMap.res * 100)} cm cells, rasterised in {navState.navMap.buildMs.toFixed(0)} ms and inflated for this robot in {navState.buildMs.toFixed(0)} ms. Obstacles are geometry between {BAND_INFO} above each floor.</p>
      {navState.navMap.warnings.map((w, i) => <p key={i} className="pane-note warn-note">{w}</p>)}

      <div className="field">
        <span>Click in the view to</span>
        <div className="seg seg-wide" role="group" aria-label="Click action">
          <button type="button" aria-pressed={nav.clickMode === 'select'} onClick={() => nav.setClickMode('select')}>Select</button>
          <button type="button" aria-pressed={nav.clickMode === 'inspect'} onClick={() => nav.setClickMode('inspect')}>Inspect cell</button>
          <button type="button" aria-pressed={nav.clickMode === 'obstacle'} onClick={() => nav.setClickMode('obstacle')}>Place obstacle</button>
        </div>
      </div>
      {nav.clickMode === 'obstacle' && (
        <label className="field">
          <span>Obstacle size</span>
          <select value={nav.obstacleSize} onChange={e => nav.setObstacleSize(Number(e.target.value))}>
            <option value={0.5}>0.5 m (bin, small cart)</option>
            <option value={1}>1 m (pallet, trolley)</option>
            <option value={2}>2 m (blocked area)</option>
          </select>
        </label>
      )}
      {nav.clickMode !== 'select' && <p className="pane-note">Click on the coloured grid. {nav.clickMode === 'obstacle' ? 'Click an existing obstacle to remove it.' : 'The cell’s state is traced back to the step and IFC element that caused it.'}</p>}

      {cell && (
        <div className="cell-card" data-state={cell.state}>
          <div className="cell-head">
            <span className="mono">{cell.levelName} · cell {cell.cell[0]}, {cell.cell[1]}</span>
            <IconButton icon={Icons.X} label="Close cell details" size={13} className="sm" onClick={() => nav.setCellInfo(null)} />
          </div>
          <div className="cell-state">{cell.label}</div>
          <p>{cell.detail}</p>
          {cell.elementId != null && cell.elementId >= 0 && model.byId.get(cell.elementId) && (
            <KV k="Caused by"><LinkButton onClick={() => onSelectIds([cell.elementId])}>{elementLabel(model.byId.get(cell.elementId))}</LinkButton> <span className="mono muted">{model.byId.get(cell.elementId).ifcClass}</span></KV>
          )}
          {cell.clearance != null && <KV k="Clearance"><span className="mono">{cell.clearance.toFixed(2)} m</span></KV>}
          <div className="provenance"><span className="mono">{GRID_STEPS[cell.step]}</span> Position {cell.center[0].toFixed(2)}, {cell.center[2].toFixed(2)} m in model coordinates.</div>
        </div>
      )}

      {nav.obstacles.length > 0 && (
        <div className="obstacle-list">
          {nav.obstacles.map(o => (
            <div key={o.id} className="list-row">
              <span className="gl gl-user" />
              <div className="list-main">{o.size} m obstacle on {navState.levels.get(o.levelId)?.grid.levelName}</div>
              <IconButton icon={Icons.X} label="Remove obstacle" size={13} className="sm" onClick={() => nav.removeObstacle(o.id)} />
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={nav.clearObstacles}>Remove all obstacles</button>
        </div>
      )}
    </>
  );
}

const BAND_INFO = '0.1 m and the robot height';

function RoomSelect({ label, value, groups, onChange }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value || ''} onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">Choose a room</option>
        {groups.map(g => (
          <optgroup key={g.level.id} label={g.level.name}>
            {g.spaces.map(sp => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

function ReadinessList({ checks, onSelectIds, onZoomTo }) {
  return (
    <ul className="readiness">
      {checks.map(c => (
        <li key={c.id} data-status={c.status}>
          <span className="check-badge"><StatusIcon status={c.status} /><span className="sr-only">{STATUS_LABEL[c.status]}</span></span>
          <div className="check-main">
            <div className="check-title">{c.title}</div>
            <div className="sub">{c.detail}</div>
            <div className="check-step mono">{PIPELINE_STEPS[c.step]}</div>
          </div>
          {c.elementIds.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { onSelectIds(c.elementIds); onZoomTo && onZoomTo(c.elementIds); }}>Show {c.elementIds.length}</button>
          )}
        </li>
      ))}
    </ul>
  );
}

// ===========================================================================
// Building Intelligence dashboard
// ===========================================================================
function IntelligenceDashboard({ model, building, readiness, onClose, onSelectIds, onOpenNavigate }) {
  const classCounts = useMemo(() => [...model.byClass.entries()].filter(([c]) => !SPATIAL_CLASSES.includes(c) || c === 'IfcSpace').map(([c, ids]) => [c, ids.length]).sort((a, b) => b[1] - a[1]), [model]);
  const top = classCounts.slice(0, 12);
  const rest = classCounts.slice(12).reduce((a, [, n]) => a + n, 0);
  const max = top.length ? top[0][1] : 1;
  const checks = useMemo(() => runModelChecks(model), [model, model.secondaryReady]);
  const s = readiness ? readiness.summary : null;
  const stepStatus = (step) => {
    if (!readiness) return 'pending';
    const cs = readiness.checks.filter(c => c.step === step);
    if (cs.some(c => c.status === 'fail')) return 'fail';
    if (cs.some(c => c.status === 'warn')) return 'warn';
    return 'pass';
  };

  return (
    <Modal title="Building intelligence" subtitle={`${model.fileName} · ${model.schemaVersion}`} onClose={onClose} wide className="intel">
      <div className="intel-grid">
        <section className="intel-facts" aria-label="Key figures">
          <Fact k="Levels" v={building ? building.levels.length : model.storeys.length} />
          <Fact k="Rooms" v={s ? s.rooms : (model.byClass.get('IfcSpace') || []).length} />
          <Fact k="Doors" v={s ? s.doors : '—'} />
          <Fact k="Stairs, ramps and lifts" v={s ? s.verticals : '—'} />
          <Fact k="Reachable rooms" v={s && s.accessibleShare != null ? `${Math.round(s.accessibleShare * 100)}%` : '—'} sub={s && s.rooms ? `${s.accessibleRooms} of ${s.rooms}, default robot` : 'needs rooms'} />
          <Fact k="Elements" v={model.elements.filter(e => !e.isType).length.toLocaleString()} sub={`${model.totalGeometryItems.toLocaleString()} with geometry`} />
        </section>

        <section className="intel-card intel-pipeline" aria-label="Navigation pipeline">
          <h3>BIM → navigation pipeline</h3>
          <ol className="pipeline">
            {Object.entries(PIPELINE_STEPS).map(([k, label]) => (
              <li key={k} data-status={stepStatus(k)}>
                <span className="check-badge">{stepStatus(k) === 'pending' ? <span className="spinner" /> : <StatusIcon status={stepStatus(k)} />}</span>
                <span>{label.replace(/^S\d · /, '')}</span>
                <span className="mono muted">{k}</span>
              </li>
            ))}
          </ol>
          <button type="button" className="btn btn-primary btn-sm" onClick={onOpenNavigate}><Icons.Route size={14} /> Open Navigate</button>
        </section>

        <section className="intel-card intel-levels" aria-label="Levels">
          <h3>Levels</h3>
          {building ? (
            <table className="dtbl compact">
              <thead><tr><th>Level</th><th className="num">Floor elevation (m)</th><th className="num">Elements</th><th className="num">Rooms</th><th className="num">Doors</th><th className="num">Connectors</th></tr></thead>
              <tbody>
                {[...building.levels].reverse().map(l => (
                  <tr key={l.id} onClick={() => onSelectIds([l.storeyId])}>
                    <td>{l.name}</td>
                    <td className="num mono">{l.elevation != null ? l.elevation.toFixed(2) : '—'}</td>
                    <td className="num mono">{l.elementIds.length}</td>
                    <td className="num mono">{l.spaceIds.length}</td>
                    <td className="num mono">{l.doorIds.length}</td>
                    <td className="num mono">{l.verticalIds.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="pane-note">Analysing levels…</p>}
          {building && <p className="pane-note">Floor elevations are measured from slab geometry and aligned to {building.elevationReference}.</p>}
        </section>

        <section className="intel-card intel-classes" aria-label="Elements by class">
          <h3>Elements by class</h3>
          <ul className="bars">
            {top.map(([c, n]) => (
              <li key={c} title={`${c}: ${n.toLocaleString()}`} onClick={() => onSelectIds(model.byClass.get(c))}>
                <span className="bar-label"><span className="swatch" style={{ background: CLASS_COLOR(c) }} /><span className="mono">{c.replace(/^Ifc/, '')}</span></span>
                <span className="bar-track"><span className="bar-fill" style={{ width: `${Math.max(1.5, (n / max) * 100)}%` }} /></span>
                <span className="bar-value mono">{n.toLocaleString()}</span>
              </li>
            ))}
          </ul>
          {rest > 0 && <p className="pane-note">{plural(classCounts.length - 12, 'other class', 'other classes')} hold {rest.toLocaleString()} more elements.</p>}
        </section>

        <section className="intel-card intel-checks" aria-label="Data quality">
          <h3>Data quality</h3>
          <ul className="readiness">
            {checks.map((c, i) => (
              <li key={i} data-status={c.severity === 'error' ? 'fail' : c.severity}>
                <span className="check-badge"><StatusIcon status={c.severity === 'error' ? 'fail' : c.severity} /></span>
                <div className="check-main"><div className="check-title">{c.message}</div>{c.detail && <div className="sub">{c.detail}</div>}</div>
                {c.ids.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSelectIds(c.ids)}>Select {c.ids.length.toLocaleString()}</button>}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Modal>
  );
}

function Fact({ k, v, sub }) {
  return (
    <div className="fact">
      <div className="fact-v mono">{v}</div>
      <div className="fact-k">{k}</div>
      {sub && <div className="fact-sub">{sub}</div>}
    </div>
  );
}

Object.assign(window, { ROBOT_PRESETS, NavigatePanel, IntelligenceDashboard, ReadinessList, StatusIcon, Fact });
