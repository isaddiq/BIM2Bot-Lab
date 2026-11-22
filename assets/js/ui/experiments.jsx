/**
 * Simulate add-ons: door schedule editor, simulated LiDAR controls and batch experiments.
 * Batch runs use the same deterministic engine (core/simulation.jsx) in short time slices
 * on the main thread, so the page stays responsive without a worker.
 */

const expId = () => Math.random().toString(36).slice(2, 9);

// ---------------------------------------------------------------------------
// Door schedule
// ---------------------------------------------------------------------------
function DoorScheduleEditor({ building, events, onChange, info, onInfo, onSelectIds }) {
  const groups = useMemo(() => building.levels.map(l => ({
    level: l,
    doors: l.doorIds.map(id => building.doors.get(id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name)),
  })).filter(g => g.doors.length), [building]);
  const [doorId, setDoorId] = useState('');
  const [closeAt, setCloseAt] = useState(30);
  const [openAt, setOpenAt] = useState('');
  const [open, setOpen] = useState(events.length > 0);
  if (!groups.length) return null;
  const add = () => {
    const id = Number(doorId);
    if (!building.doors.has(id)) return;
    const c = Math.max(0, Number(closeAt) || 0);
    const o = openAt === '' ? null : Math.max(c + 1, Number(openAt) || 0);
    onChange([...events, { id: expId(), doorId: id, closeAt: c, openAt: o }].sort((a, b) => a.closeAt - b.closeAt));
  };
  if (!open) {
    return <button type="button" className="btn btn-ghost btn-sm door-toggle" onClick={() => setOpen(true)}><Icons.Door size={14} /> Door schedule{events.length ? ` (${events.length})` : ''}</button>;
  }
  return (
    <div className="door-schedule">
      <div className="rc-head"><strong>Door schedule</strong><IconButton icon={Icons.ChevronDown} label="Collapse door schedule" size={13} className="sm" onClick={() => setOpen(false)} /></div>
      <p className="pane-note">Close doors during the run to test re-planning. People can still open them; robots cannot.</p>
      {events.map(ev => {
        const d = building.doors.get(ev.doorId);
        return (
          <div key={ev.id} className="list-row">
            <Icons.Door size={14} />
            <div className="list-main" onClick={() => onSelectIds && onSelectIds([ev.doorId])}>
              {d ? d.name : ev.doorId}: closes at {ev.closeAt} s, {ev.openAt != null ? `reopens at ${ev.openAt} s` : 'stays closed'}
            </div>
            <IconButton icon={Icons.X} label="Remove door event" size={13} className="sm" onClick={() => onChange(events.filter(x => x.id !== ev.id))} />
          </div>
        );
      })}
      <label className="field">
        <span>Door</span>
        <select value={doorId} onChange={e => setDoorId(e.target.value)}>
          <option value="">Choose a door</option>
          {groups.map(g => (
            <optgroup key={g.level.id} label={g.level.name}>
              {g.doors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <div className="field-grid">
        <label className="field"><span>Closes at (s)</span><input type="number" min="0" step="5" value={closeAt} onChange={e => setCloseAt(e.target.value)} /></label>
        <label className="field"><span>Reopens at (s)</span><input type="number" min="0" step="5" placeholder="Stays closed" value={openAt} onChange={e => setOpenAt(e.target.value)} /></label>
      </div>
      <div className="sim-actions">
        <button type="button" className="btn btn-sm" disabled={!doorId} onClick={add}><Icons.Plus size={14} /> Add to schedule</button>
        {events.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([])}>Clear schedule</button>}
      </div>
      <label className="field">
        <span>Robots learn about a closure</span>
        <select value={info} onChange={e => onInfo(e.target.value)}>
          <option value="fleet">At once, from the fleet manager</option>
          <option value="onboard">On arrival, within 3 m (onboard sensing)</option>
        </select>
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Simulated LiDAR
// ---------------------------------------------------------------------------
function LidarSection({ simApi, model }) {
  const sim = simApi.sim.current;
  const cfg = simApi.lidar;
  if (!sim || !sim.robots.length) return null;
  const set = (k, v, min, max) => simApi.setLidar({ [k]: Math.min(max, Math.max(min, Number(v))) });
  const scan = sim.lidar;
  const hitCount = scan ? scan.ranges.reduce((a, r) => a + (r < scan.cfg.range ? 1 : 0), 0) : 0;
  const nearest = scan ? scan.ranges.reduce((a, r) => Math.min(a, r), Infinity) : null;
  const save = () => {
    if (!scan) return;
    const doc = lidarScanJson(scan, { time: sim.time, extra: { robot: scan.robotName, model: model.fileName } });
    download(JSON.stringify(doc, null, 2), `bim2bot-lidar-${scan.robotName.replace(/\s+/g, '-').toLowerCase()}-${Math.round(sim.time)}s.json`, 'application/json');
  };
  return (
    <div className="nav-section">
      <h3><Icons.Focus size={16} /> Simulated LiDAR</h3>
      <label className="check-field"><input type="checkbox" checked={cfg.enabled} onChange={e => simApi.setLidar({ enabled: e.target.checked })} /> Show a 2D scan in the 3D view and on the plan</label>
      {cfg.enabled && (
        <>
          <div className="field-grid">
            <label className="field">
              <span>Robot</span>
              <select value={cfg.robotId} onChange={e => simApi.setLidar({ robotId: Number(e.target.value) })}>
                {sim.robots.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Beams</span>
              <select value={cfg.beams} onChange={e => simApi.setLidar({ beams: Number(e.target.value) })}>
                {[90, 180, 360, 720, 1440].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Field of view</span>
              <select value={cfg.fov} onChange={e => simApi.setLidar({ fov: Number(e.target.value) })}>
                {[360, 270, 180].map(n => <option key={n} value={n}>{n}°</option>)}
              </select>
            </label>
            <label className="field"><span>Range (m)</span><input type="number" min="1" max="40" step="1" value={cfg.range} onChange={e => set('range', e.target.value, 1, 40)} /></label>
            <label className="field"><span>Sensor height (m)</span><input type="number" min="0.05" max="2.1" step="0.05" value={cfg.mountHeight} onChange={e => set('mountHeight', e.target.value, 0.05, 2.1)} /></label>
            <label className="field"><span>Range noise σ (m)</span><input type="number" min="0" max="0.2" step="0.005" value={cfg.noise} onChange={e => set('noise', e.target.value, 0, 0.2)} /></label>
          </div>
          {scan ? (
            <p className="pane-note">{scan.robotName}: {hitCount} of {scan.ranges.length} beams return, nearest {Number.isFinite(nearest) ? `${nearest.toFixed(2)} m` : '—'}.</p>
          ) : <p className="pane-note">No scan while the robot is in a lift or on stairs.</p>}
          <p className="pane-note">Simulated, not live sensor data. Beams stop at the first grid cell ({Math.round(sim.nav.navMap.res * 100)} cm) whose geometry spans the sensor height, at closed doors and placed obstacles, and at people and other robots. Ranges are accurate to about one cell.</p>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!scan} onClick={save}><Icons.Download size={14} /> Download this scan (LaserScan JSON)</button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Batch experiments
// ---------------------------------------------------------------------------
const EXP_PARAMS = [
  { id: 'robots', label: 'Robots', defaults: '1, 2, 4, 6, 8', min: 1, max: 8, int: true, random: true },
  { id: 'humans', label: 'People', defaults: '0, 4, 8, 16', min: 0, max: 30, int: true },
  { id: 'robotSpeed', label: 'Robot speed (m/s)', defaults: '0.5, 0.8, 1.2', min: 0.2, max: 2 },
  { id: 'liftPolicy', label: 'Lift scheduling', fixed: ['fcfs', 'nearest'] },
  { id: 'liftCapacity', label: 'Lift capacity', defaults: '1, 2, 4', min: 1, max: 6, int: true },
  { id: 'tasksPerRobot', label: 'Tasks per robot', defaults: '2, 4, 8', min: 1, max: 20, int: true },
];

const EXP_METRICS = [
  { id: 'makespan', label: 'Makespan', unit: 's', fmt: (v) => fmtSec(v) },
  { id: 'throughputPerHour', label: 'Throughput', unit: '/h', fmt: (v) => `${v.toFixed(1)} /h` },
  { id: 'meanTaskTime', label: 'Mean task time', unit: 's', fmt: (v) => fmtSec(v) },
  { id: 'completion', label: 'Tasks completed', unit: '%', fmt: (v) => `${(v * 100).toFixed(0)}%` },
  { id: 'congestionWait', label: 'Congestion wait', unit: 's', fmt: (v) => fmtSec(v) },
  { id: 'liftWait', label: 'Lift wait', unit: 's', fmt: (v) => fmtSec(v) },
  { id: 'nearMisses', label: 'Near misses', unit: '', fmt: (v) => v.toFixed(1) },
  { id: 'deadlocks', label: 'Deadlocks', unit: '', fmt: (v) => v.toFixed(1) },
  { id: 'distance', label: 'Distance driven', unit: 'm', fmt: (v) => `${v.toFixed(0)} m` },
  { id: 'replans', label: 'Door re-plans', unit: '', fmt: (v) => v.toFixed(1) },
];

const POLICY_LABEL = { fcfs: 'First come', nearest: 'Nearest car' };

function parseValues(text, p) {
  if (p.fixed) return p.fixed.slice();
  const seen = new Set();
  return String(text).split(/[,;\s]+/).map(Number).filter(Number.isFinite)
    .map(v => Math.min(p.max, Math.max(p.min, p.int ? Math.round(v) : v)))
    .filter(v => (seen.has(v) ? false : (seen.add(v), true)))
    .slice(0, 8);
}

function stats(values) {
  const xs = values.filter(v => v != null && Number.isFinite(v));
  if (!xs.length) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = xs.length > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1)) : 0;
  return { mean, sd, min: Math.min(...xs), max: Math.max(...xs), n: xs.length };
}

const metricOf = (t, id) => (id === 'completion' ? (t.tasksPlanned ? t.tasksDone / t.tasksPlanned : null) : t[id]);

function ExperimentsSection({ model, building, navMap, baseScenario, missionMode, disabled }) {
  const params = EXP_PARAMS.filter(p => !(missionMode && p.random));
  const [paramId, setParamId] = useState('humans');
  const param = params.find(p => p.id === paramId) || params[0];
  const [text, setText] = useState(param.defaults || '');
  const [reps, setReps] = useState(5);
  const [metric, setMetric] = useState('makespan');
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [progress, setProgress] = useState(null);
  const [open, setOpen] = useState(false);
  const cancelRef = useRef(false);
  const cacheRef = useRef({ navMap: null, cache: new Map(), closures: new Map() });
  useEffect(() => () => { cancelRef.current = true; }, []);
  useEffect(() => { cancelRef.current = true; setRows([]); setMeta(null); setProgress(null); }, [navMap]);

  const values = parseValues(text, param);
  const total = values.length * reps;

  const run = async () => {
    const base = baseScenario();
    if (cacheRef.current.navMap !== navMap) cacheRef.current = { navMap, cache: new Map(), closures: new Map() };
    const ctx = { model, building, navMap, navCache: cacheRef.current.cache, closureCache: cacheRef.current.closures };
    const configs = [];
    values.forEach(v => { for (let k = 0; k < reps; k++) configs.push({ value: v, seed: (base.seed || 0) + k }); });
    cancelRef.current = false;
    const out = [];
    setRows([]);
    setMeta({ param: param.id, paramLabel: param.label, values, reps, base, started: Date.now() });
    setProgress({ done: 0, total: configs.length });
    const yieldUi = () => new Promise(r => setTimeout(r, 0));
    const t0 = performance.now();
    for (let i = 0; i < configs.length; i++) {
      if (cancelRef.current) break;
      const c = configs[i];
      const sim = createSimulation(ctx, { ...base, [param.id]: c.value, seed: c.seed });
      while (!sim.done && !cancelRef.current) {
        const s0 = performance.now();
        while (!sim.done && performance.now() - s0 < 24) sim.step(2);
        await yieldUi();
      }
      if (cancelRef.current) break;
      out.push({ value: c.value, seed: c.seed, totals: sim.summary().totals, simTime: sim.time });
      setRows(out.slice());
      setProgress({ done: i + 1, total: configs.length });
    }
    setProgress(p => (p ? { ...p, finished: true, cancelled: cancelRef.current, ms: performance.now() - t0 } : p));
  };
  const cancel = () => { cancelRef.current = true; };
  const running = progress && !progress.finished;

  const exportCsv = () => {
    if (!rows.length || !meta) return;
    const cols = ['tasksDone', 'tasksPlanned', 'makespan', 'throughputPerHour', 'meanTaskTime', 'distance', 'congestionWait', 'liftWait', 'stopForPeople', 'slowForPeople', 'encounters', 'nearMisses', 'minSeparation', 'deadlocks', 'replans', 'blockedTime', 'zoneSlowTime'];
    const esc = (v) => (v == null ? '' : typeof v === 'number' ? String(Number(v.toFixed(4))) : `"${String(v).replace(/"/g, '""')}"`);
    const lines = [['model', 'parameter', 'value', 'seed', 'timed_out', ...cols].join(',')];
    rows.forEach(r => lines.push([esc(model.fileName), esc(meta.param), esc(r.value), r.seed, r.totals.timedOut ? 1 : 0, ...cols.map(k => esc(r.totals[k]))].join(',')));
    download(lines.join('\n'), `bim2bot-experiment-${meta.param}.csv`, 'text/csv');
  };

  const m = EXP_METRICS.find(x => x.id === metric) || EXP_METRICS[0];
  const groups = meta ? meta.values.map(v => {
    const rs = rows.filter(r => r.value === v);
    return { value: v, runs: rs.length, timedOut: rs.filter(r => r.totals.timedOut).length, s: stats(rs.map(r => metricOf(r.totals, metric))) };
  }) : [];
  const maxMean = Math.max(1e-9, ...groups.map(g => (g.s ? g.s.mean : 0)));
  const valueLabel = (v) => (meta && meta.param === 'liftPolicy' ? POLICY_LABEL[v] || v : v);

  return (
    <div className="nav-section">
      <h3><Icons.Table size={16} /> Experiments</h3>
      {!open ? (
        <>
          <p className="pane-note">Run the scenario above many times, varying one setting across several seeds, and compare the results.</p>
          <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}><Icons.Columns size={14} /> Set up an experiment</button>
        </>
      ) : (
        <>
          <div className="field-grid">
            <label className="field">
              <span>Vary</span>
              <select value={param.id} disabled={running} onChange={e => { const p = params.find(x => x.id === e.target.value); setParamId(p.id); setText(p.defaults || ''); }}>
                {params.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <label className="field"><span>Seeds per value</span><input type="number" min="1" max="20" value={reps} disabled={running} onChange={e => setReps(clampInt(e.target.value, 1, 20))} /></label>
          </div>
          {!param.fixed && (
            <label className="field"><span>Values (up to 8, comma-separated)</span><input type="text" value={text} disabled={running} onChange={e => setText(e.target.value)} /></label>
          )}
          <p className="pane-note">{values.length ? `${plural(total, 'run')}: ${values.map(valueLabel).join(', ')} × seeds ${(baseScenario().seed || 0)}–${(baseScenario().seed || 0) + reps - 1}.` : 'Enter at least one value.'} Everything else comes from the scenario above, including what-if changes{missionMode ? ' and custom missions' : ''}.</p>
          <div className="sim-actions">
            {!running
              ? <button type="button" className="btn btn-primary btn-sm" disabled={disabled || !values.length} onClick={run}><Icons.Play size={14} /> Run experiment</button>
              : <button type="button" className="btn btn-sm" onClick={cancel}>Cancel</button>}
            {rows.length > 0 && !running && <button type="button" className="btn btn-ghost btn-sm" onClick={exportCsv}><Icons.Download size={14} /> Export runs (CSV)</button>}
          </div>
          {progress && (
            <div className="meter">
              <div className="meter-label">
                <span>{progress.finished ? (progress.cancelled ? 'Cancelled' : `Finished in ${(progress.ms / 1000).toFixed(1)} s`) : 'Running'}</span>
                <span className="mono">{progress.done} / {progress.total}</span>
              </div>
              <div className="meter-track"><div style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} /></div>
            </div>
          )}
          {meta && rows.length > 0 && (
            <>
              <label className="field">
                <span>Show</span>
                <select value={metric} onChange={e => setMetric(e.target.value)}>
                  {EXP_METRICS.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
              </label>
              <table className="dtbl compact exp-table">
                <thead><tr><th>{meta.paramLabel}</th><th className="num">Runs</th><th className="num">Mean</th><th className="num">± SD</th><th aria-label="Mean, relative" /></tr></thead>
                <tbody>
                  {groups.map(g => (
                    <tr key={String(g.value)} title={g.s ? `min ${m.fmt(g.s.min)}, max ${m.fmt(g.s.max)}${g.timedOut ? `, ${g.timedOut} stopped at the time limit` : ''}` : ''}>
                      <td>{valueLabel(g.value)}{g.timedOut ? ' *' : ''}</td>
                      <td className="num mono">{g.runs}</td>
                      <td className="num mono">{g.s ? m.fmt(g.s.mean) : '—'}</td>
                      <td className="num mono">{g.s && g.s.n > 1 ? m.fmt(g.s.sd) : '—'}</td>
                      <td className="exp-bar"><span style={{ width: `${g.s ? (g.s.mean / maxMean) * 100 : 0}%` }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="pane-note">Sample standard deviation across seeds. {groups.some(g => g.timedOut) ? '* Some runs stopped at the 60 min limit, so their makespan is a lower bound. ' : ''}Hover a row for the range.</p>
            </>
          )}
        </>
      )}
    </div>
  );
}

Object.assign(window, { DoorScheduleEditor, LidarSection, ExperimentsSection });
