/** BIM2Bot Lab — application shell. */

const APP_NAME = 'BIM2Bot Lab';
// Sample models. Bundled files ship with the site; remote ones are fetched from their
// public source only when a visitor opens them.
const SAMPLES = [
  {
    id: 'large-building',
    name: 'Office blocks',
    file: 'LargeBuilding.ifc',
    url: 'assets/ifc/LargeBuilding.ifc',
    size: '1.3 MB',
    facts: '2 storeys, 8 rooms, 18 doors, furniture',
    credit: 'BIM Whale samples by André Wisén, MIT licence',
    creditUrl: 'https://github.com/andrewisen/bim-whale-ifc-samples',
    bundled: true,
  },
  {
    id: 'duplex',
    name: 'Duplex apartment',
    file: 'Duplex_Architecture.ifc',
    url: 'https://raw.githubusercontent.com/youshengCode/IfcSampleFiles/main/Ifc2x3_Duplex_Architecture.ifc',
    size: '2.3 MB',
    facts: '2 units over 2 storeys, 21 rooms, stairs, space boundaries',
    credit: 'Common BIM Files (NIBS, US Army ERDC), loaded from a public GitHub mirror',
    creditUrl: 'https://github.com/youshengCode/IfcSampleFiles',
    bundled: false,
  },
];
const SOURCE_REPO_URL = 'https://github.com/isaddiq/BIM2Bot-Lab';
const AUTHOR_URL = 'https://isaddiq.github.io/';
const VISITOR_STATS_URL = 'https://info.flagcounter.com/UsaK';

const SLAB_CLASSES = ['IfcSlab', 'IfcSlabStandardCase', 'IfcSlabElementedCase', 'IfcCovering', 'IfcRoof'];
const uid = () => Math.random().toString(36).slice(2, 9);

// ---------------------------------------------------------------------------
// Viewer state reducer
// ---------------------------------------------------------------------------
function viewerStateReducer(state, action) {
  switch (action.type) {
    case 'select': {
      const ids = action.ids || [];
      if (action.multi) {
        const ns = new Set(state.selectedIds);
        ids.forEach(id => { ns.has(id) ? ns.delete(id) : ns.add(id); });
        return { ...state, selectedIds: ns };
      }
      return { ...state, selectedIds: new Set(ids) };
    }
    case 'clear-selection':
      return state.selectedIds.size ? { ...state, selectedIds: new Set() } : state;
    case 'toggle-hide': {
      const ns = new Set(state.hiddenIds);
      const allHidden = action.ids.length > 0 && action.ids.every(id => ns.has(id));
      action.ids.forEach(id => { allHidden ? ns.delete(id) : ns.add(id); });
      return { ...state, hiddenIds: ns };
    }
    case 'show-all':
      return { ...state, hiddenIds: new Set(), isolatedIds: new Set() };
    case 'isolate': {
      const ns = new Set(action.ids);
      if (!action.force && state.isolatedIds.size === ns.size && [...ns].every(i => state.isolatedIds.has(i))) {
        return { ...state, isolatedIds: new Set() };
      }
      return { ...state, isolatedIds: ns };
    }
    case 'set-color': {
      const m = new Map(state.colorOverrides);
      if (action.color) m.set(action.id, action.color); else m.delete(action.id);
      return { ...state, colorOverrides: m };
    }
    case 'set-opacity-many': {
      const m = new Map(state.opacityOverrides);
      (action.ids || []).forEach(id => { if (action.opacity != null) m.set(id, action.opacity); else m.delete(id); });
      return { ...state, opacityOverrides: m };
    }
    case 'set-query':
      return { ...state, queryResults: action.ids, queryMatchText: action.match || {} };
    case 'clear-query':
      return { ...state, queryResults: [], queryMatchText: {} };
    case 'save-view': {
      const view = {
        id: uid(),
        name: action.name || `View ${state.savedViews.length + 1}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        camera: action.camera,
        hiddenIds: [...state.hiddenIds],
        isolatedIds: [...state.isolatedIds],
      };
      return { ...state, savedViews: [...state.savedViews, view] };
    }
    case 'restore-view':
      return { ...state, hiddenIds: new Set(action.view.hiddenIds), isolatedIds: new Set(action.view.isolatedIds) };
    case 'delete-view':
      return { ...state, savedViews: state.savedViews.filter(v => v.id !== action.id) };
    case 'save-set':
      return { ...state, selectionSets: [...state.selectionSets, { id: uid(), name: action.name || `Set ${state.selectionSets.length + 1}`, ids: [...state.selectedIds] }] };
    case 'restore-set': {
      const s = state.selectionSets.find(x => x.id === action.id);
      return s ? { ...state, selectedIds: new Set(s.ids) } : state;
    }
    case 'delete-set':
      return { ...state, selectionSets: state.selectionSets.filter(s => s.id !== action.id) };
    case 'add-anno':
      return { ...state, annotations: [...state.annotations, action.anno] };
    case 'delete-anno':
      return { ...state, annotations: state.annotations.filter(a => a.id !== action.id) };
    case 'update-anno':
      return { ...state, annotations: state.annotations.map(a => (a.id === action.id ? { ...a, ...action.patch } : a)) };
    case 'add-measure':
      return { ...state, measurements: [...state.measurements, action.measure] };
    case 'delete-measure':
      return { ...state, measurements: state.measurements.filter(m => m.id !== action.id) };
    case 'clear-measures':
      return { ...state, measurements: [] };
    case 'reset':
      return initialViewerState();
    default:
      return state;
  }
}

function initialViewerState() {
  return {
    selectedIds: new Set(),
    hiddenIds: new Set(),
    isolatedIds: new Set(),
    colorOverrides: new Map(),
    opacityOverrides: new Map(),
    queryResults: [],
    queryMatchText: {},
    savedViews: [],
    selectionSets: [],
    annotations: [],
    measurements: [],
  };
}

// ---------------------------------------------------------------------------
// Persistence helpers (per-viewer conveniences only)
// ---------------------------------------------------------------------------
const STORAGE = { layout: 'bim2bot-layout-v2', theme: 'bim2bot-theme', layoutMode: 'bim2bot-view-layout' };
const EMPTY_ROUTE = { startId: null, goalId: null, startPoint: null, goalPoint: null };
const DEFAULT_LAYOUT = { left: 344, right: 360, bottom: 220, bottomCollapsed: false };

function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

function initialLayout() {
  try {
    const p = JSON.parse(readStorage(STORAGE.layout) || 'null');
    if (!p) return DEFAULT_LAYOUT;
    return {
      left: clamp(Number(p.left) || DEFAULT_LAYOUT.left, 240, 520),
      right: clamp(Number(p.right) || DEFAULT_LAYOUT.right, 280, 620),
      bottom: clamp(Number(p.bottom) || DEFAULT_LAYOUT.bottom, 120, 480),
      bottomCollapsed: !!p.bottomCollapsed,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function initialTheme() {
  const saved = readStorage(STORAGE.theme);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
function runQuery(model, q) {
  const query = q.trim();
  if (!query) return { ids: [], match: {} };
  const lower = query.toLowerCase();
  const ids = [];
  const matchText = {};
  const colon = query.indexOf(':');
  const key = colon > 0 && colon < query.length - 1 ? query.slice(0, colon).trim().toLowerCase() : null;
  const val = key ? query.slice(colon + 1).trim().toLowerCase() : null;
  const exprMatch = /^[#@](\d+)$/.exec(query);
  const findProp = (sets, suffix) => {
    for (const ps of sets) for (const p of ps.properties) {
      if (p.name.toLowerCase() === key && String(p.value).toLowerCase().includes(val)) return `${ps.name}.${p.name} = ${p.value}${suffix}`;
    }
    return null;
  };
  model.elements.forEach(el => {
    if (el.isType) return;
    let m = null;
    if (exprMatch) {
      if (String(el.expressId) === exprMatch[1]) m = `Express ID #${el.expressId}`;
    } else if (key) {
      m = findProp(el.propertySets, '') || findProp(el.quantitySets, '');
      const t = !m && el.typeExpressId ? model.byId.get(el.typeExpressId) : null;
      if (t) m = findProp(t.propertySets, ' (type)');
    } else if (el.ifcClass.toLowerCase().includes(lower)) m = `Class ${el.ifcClass}`;
    else if ((el.name || '').toLowerCase().includes(lower)) m = `Name ${el.name}`;
    else if ((el.longName || '').toLowerCase().includes(lower)) m = `Long name ${el.longName}`;
    else if ((el.globalId || '').toLowerCase().includes(lower)) m = `GlobalId ${el.globalId}`;
    else if ((el.objectType || '').toLowerCase().includes(lower)) m = `Object type ${el.objectType}`;
    else if ((el.tag || '').toLowerCase().includes(lower)) m = `Tag ${el.tag}`;
    else if (el.storey && (el.storey.name || '').toLowerCase().includes(lower)) m = `Storey ${el.storey.name}`;
    else if (el.materials.some(x => x.name.toLowerCase().includes(lower))) m = `Material ${el.materials.find(x => x.name.toLowerCase().includes(lower)).name}`;
    else if (el.classifications.some(c => (c.code + ' ' + c.name).toLowerCase().includes(lower))) m = 'Classification';
    if (m) { ids.push(el.expressId); matchText[el.expressId] = m; }
  });
  return { ids, match: matchText };
}

const SEARCH_EXAMPLES = [
  ['IfcDoor', 'every element of a class'],
  ['Bedroom', 'names, long names, tags'],
  ['#1234', 'an express ID'],
  ['IsExternal:true', 'a property value (inspected elements)'],
];

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------
function BrandMark({ size = 28 }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 3.5 27.5 10v12L16 28.5 4.5 22V10Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M4.5 10 16 16.5 27.5 10M16 16.5v12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" opacity="0.55" />
      <path className="brand-route" d="M9 18.5 16 22l6.5-3.6V13" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle className="brand-node" cx="9" cy="18.5" r="2.1" />
      <circle className="brand-node" cx="22.5" cy="13" r="2.1" />
    </svg>
  );
}

const WORKSPACES = [
  { id: 'explore', label: 'Explore', sub: 'IFC model', icon: 'Cube' },
  { id: 'navigate', label: 'Navigate', sub: 'Grids and routes', icon: 'Route' },
  { id: 'simulate', label: 'Simulate', sub: 'Robot fleets', icon: 'Robot' },
];

function WorkspaceSwitch({ value, onChange, disabled }) {
  return (
    <nav className="ws-switch" aria-label="Workspace">
      {WORKSPACES.map((w, i) => {
        const Icon = Icons[w.icon];
        return (
          <React.Fragment key={w.id}>
            {i > 0 && <span className="ws-link" aria-hidden="true"><Icons.ChevronRight size={14} /></span>}
            <button
              type="button"
              className="ws-btn"
              aria-current={value === w.id ? 'page' : undefined}
              disabled={w.disabled || (disabled && w.id !== 'explore')}
              title={`${w.label}: ${w.sub}`}
              onClick={() => onChange(w.id)}
            >
              <span className="ws-icon"><Icon size={15} /></span>
              <span className="ws-text"><span className="ws-label">{w.label}</span><span className="ws-sub">{w.sub}</span></span>
            </button>
          </React.Fragment>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------
function TopBar({ model, workspace, onWorkspace, onUpload, onLoadSample, onClose, onSearch, onOpenIntel, onOpenSchema, onOpenHelp, theme, onToggleTheme, searchRef, onHome }) {
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e) => { if (!menuRef.current?.contains(e.target)) setMenu(false); };
    const esc = (e) => { if (e.key === 'Escape') setMenu(false); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc); };
  }, [menu]);

  const submit = (value) => { setQ(value); onSearch(value); };

  return (
    <header className="topbar">
      <button type="button" className="brand" onClick={onHome} aria-label="BIM2Bot Lab start page" title="Start page">
        <BrandMark />
        <span className="brand-name">BIM<span className="brand-two">2</span>Bot <span className="brand-lab">Lab</span></span>
      </button>

      <WorkspaceSwitch value={workspace} onChange={onWorkspace} disabled={!model} />

      {model && (
        <div className="file-chip" title={`${model.fileName} · ${formatSize(model.fileSize)}`}>
          <Icons.Building size={15} />
          <span className="file-name">{model.fileName}</span>
          <span className="file-meta mono">{model.schemaVersion}</span>
          <IconButton icon={Icons.X} label="Close model" size={13} className="sm" onClick={onClose} />
        </div>
      )}

      <div className="topbar-spacer" />

      <div className="search" data-disabled={!model}>
        <Icons.Search size={15} />
        <input
          ref={searchRef}
          type="search"
          aria-label="Search the model"
          placeholder="Search classes, names, GlobalIds…"
          value={q}
          disabled={!model}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') onSearch(q);
            if (e.key === 'Escape') { setQ(''); onSearch(''); e.currentTarget.blur(); }
          }}
        />
        {q ? <IconButton icon={Icons.X} label="Clear search" size={13} className="sm" onClick={() => submit('')} /> : <kbd>Ctrl K</kbd>}
        {focused && !q && model && (
          <div className="search-hints" role="listbox" aria-label="Search examples">
            {SEARCH_EXAMPLES.map(([ex, what]) => (
              <button key={ex} type="button" role="option" onMouseDown={e => { e.preventDefault(); submit(ex); }}>
                <code>{ex}</code><span>{what}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <button type="button" className="btn btn-primary" onClick={onUpload}><Icons.Upload size={15} /> Open IFC</button>
      <div className="topbar-tools">
        <IconButton icon={Icons.Dashboard} label="Building intelligence" disabled={!model} onClick={onOpenIntel} />
        <IconButton icon={Icons.Schema} label="Schema explorer" disabled={!model} onClick={onOpenSchema} />
        <IconButton icon={Icons.Activity} label="Visitor statistics" aria-controls="vc-popover" onClick={() => document.getElementById('vc-popover')?.classList.toggle('vc-open')} />
        <IconButton icon={theme === 'dark' ? Icons.Sun : Icons.Moon} label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} onClick={onToggleTheme} />
        <IconButton icon={Icons.Help} label="Shortcuts and help" shortcut="?" onClick={onOpenHelp} />
        <div className="menu-anchor" ref={menuRef}>
          <IconButton icon={Icons.More} label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(v => !v)} />
          {menu && (
            <div className="menu" role="menu">
              {SAMPLES.map(smp => (
                <button key={smp.id} type="button" role="menuitem" onClick={() => { setMenu(false); onLoadSample(smp); }}><Icons.Cube size={15} /> Open sample: {smp.name}</button>
              ))}
              <div className="menu-sep" />
              <a role="menuitem" href={SOURCE_REPO_URL} target="_blank" rel="noopener noreferrer"><Icons.Github size={15} /> Source code <Icons.External size={12} className="trail" /></a>
              <a role="menuitem" href={AUTHOR_URL} target="_blank" rel="noopener noreferrer"><Icons.Globe size={15} /> Author <Icons.External size={12} className="trail" /></a>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Navigation cube (viewer/viewcube.jsx) with quick camera actions.
// ---------------------------------------------------------------------------
function NavCubeHost({ viewerRef, ready, theme }) {
  const hostRef = useRef(null);
  const cubeRef = useRef(null);
  useEffect(() => {
    if (!ready || !viewerRef.current || !hostRef.current) return;
    cubeRef.current = new NavCube(hostRef.current, viewerRef.current, { theme });
    return () => { cubeRef.current && cubeRef.current.dispose(); cubeRef.current = null; };
  }, [ready]);
  useEffect(() => { cubeRef.current && cubeRef.current.setTheme(theme); }, [theme]);
  const v = viewerRef.current;
  return (
    <div className="navcube">
      <div className="navcube-host" ref={hostRef} />
      <div className="navcube-actions">
        <IconButton icon={Icons.Home} label="Fit model, isometric view" size={15} onClick={() => v?.frameAll({ resetView: true })} />
        <IconButton icon={Icons.PlanCut} label="Top view" size={15} onClick={() => v?.setCameraPreset('top')} />
        <IconButton icon={Icons.Plus} label="Zoom in" size={15} onClick={() => v?.zoomIn()} />
        <IconButton icon={Icons.Minus} label="Zoom out" size={15} onClick={() => v?.zoomOut()} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section box controls
// ---------------------------------------------------------------------------
function SectionBoxControls({ box, bounds, onChange, onReset, onClose }) {
  const size = { x: Math.max(bounds.xMax - bounds.xMin, 0.001), y: Math.max(bounds.yMax - bounds.yMin, 0.001), z: Math.max(bounds.zMax - bounds.zMin, 0.001) };
  const sides = [
    { k: 'left', label: 'Left', axis: 'x', edge: 'min', opp: 'right' },
    { k: 'right', label: 'Right', axis: 'x', edge: 'max', opp: 'left' },
    { k: 'bottom', label: 'Bottom', axis: 'y', edge: 'min', opp: 'top' },
    { k: 'top', label: 'Top', axis: 'y', edge: 'max', opp: 'bottom' },
    { k: 'back', label: 'Back', axis: 'z', edge: 'min', opp: 'front' },
    { k: 'front', label: 'Front', axis: 'z', edge: 'max', opp: 'back' },
  ];
  const cut = (s) => (s.edge === 'min' ? (box[`${s.axis}Min`] - bounds[`${s.axis}Min`]) : (bounds[`${s.axis}Max`] - box[`${s.axis}Max`])) / size[s.axis];
  const update = (s, raw) => {
    const opp = sides.find(o => o.k === s.opp);
    const c = clamp((parseFloat(raw) || 0) / 100, 0, Math.max(0, 0.96 - cut(opp)));
    const next = { ...box };
    if (s.edge === 'min') next[`${s.axis}Min`] = bounds[`${s.axis}Min`] + size[s.axis] * c;
    else next[`${s.axis}Max`] = bounds[`${s.axis}Max`] - size[s.axis] * c;
    onChange(next);
  };
  return (
    <div className="hud-card section-card">
      <div className="hud-card-head">
        <span>Section box</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onReset}>Reset</button>
        <IconButton icon={Icons.X} label="Close section box" size={13} className="sm" onClick={onClose} />
      </div>
      <p className="hud-hint">Drag a face of the box in the view, or trim each side here.</p>
      {sides.map(s => {
        const pct = Math.round(cut(s) * 100);
        return (
          <label className="slider-row" key={s.k}>
            <span>{s.label}</span>
            <input type="range" min="0" max="95" step="1" value={pct} onChange={e => update(s, e.target.value)} />
            <span className="mono">{pct}%</span>
          </label>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Viewer canvas + HUD
// ---------------------------------------------------------------------------
function ViewerCanvas(props) {
  const {
    model, viewerRef, viewerState, dispatch, toast, theme,
    viewMode, setViewMode, showEdges, setShowEdges, showAxes, setShowAxes, showSpaces, setShowSpaces,
    explode, setExplode, sectionEnabled, toggleSection, sectionBox, setSectionBox,
    measureMode, toggleMeasure, annoMode, toggleAnno,
    levelId, onLevelChange, planCut, togglePlanCut, slabsTransparent, onToggleSlabs, onFocusGroup, onResetFilters,
    onPickEvent, onContextEvent, workspace, building, hint, layout, layoutSwitch, planElement,
  } = props;
  const hostRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [modelBounds, setModelBounds] = useState(null);
  const [hover, setHover] = useState(null);
  const [, setFrame] = useState(0);
  const handlers = useRef({});
  handlers.current = { onPickEvent, onContextEvent, dispatch, toast };
  // Re-project HUD labels on camera moves only while there are labels to place.
  const hasLabels = useRef(false);
  hasLabels.current = viewerState.annotations.length + viewerState.measurements.length > 0;

  useEffect(() => {
    const v = new ThreeViewer(hostRef.current);
    viewerRef.current = v;
    window.__viewer = v;
    const offs = [
      v.on('pick', e => handlers.current.onPickEvent(e)),
      v.on('context', e => handlers.current.onContextEvent(e)),
      v.on('hover', e => setHover(e.expressId != null && e.x != null ? e : null)),
      v.on('measure', m => {
        handlers.current.dispatch({ type: 'add-measure', measure: { id: m.id, a: m.a.toArray(), b: m.b.toArray(), distance: m.distance, dx: m.dx, dy: m.dy, dz: m.dz } });
        handlers.current.toast({ kind: 'ok', msg: `Measured ${m.distance.toFixed(3)} m`, sub: 'Listed under Markup' });
      }),
      v.on('sectionBox', ({ box }) => setSectionBox(box)),
      v.on('anno', e => {
        handlers.current.dispatch({ type: 'add-anno', anno: { id: uid(), position: e.position.toArray(), elementId: e.elementId, title: 'New issue', description: '', status: 'open', priority: 'medium', timestamp: new Date().toLocaleString() } });
        handlers.current.toast({ kind: 'info', msg: 'Issue pinned', sub: 'Edit it under Markup' });
      }),
      v.on('camera', () => { if (hasLabels.current) setFrame(f => (f + 1) % 1e6); }),
    ];
    setReady(true);
    return () => { offs.forEach(off => off()); v.dispose(); viewerRef.current = null; window.__viewer = null; };
  }, []);

  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    if (!model) { v.clearModel(); setModelBounds(null); return; }
    let cancelled = false;
    setModelBounds(null);
    v.loadModel(model).then(() => { if (!cancelled) setModelBounds(v.getModelBounds()); });
    return () => { cancelled = true; };
  }, [model]);

  useEffect(() => { viewerRef.current?.setSelection(viewerState.selectedIds); }, [viewerState.selectedIds, modelBounds]);
  useEffect(() => { viewerRef.current?.setHidden(viewerState.hiddenIds); }, [viewerState.hiddenIds, modelBounds]);
  useEffect(() => { viewerRef.current?.setIsolated(viewerState.isolatedIds); }, [viewerState.isolatedIds, modelBounds]);
  useEffect(() => { viewerRef.current?.setColorOverrides(viewerState.colorOverrides); }, [viewerState.colorOverrides, modelBounds]);
  useEffect(() => { viewerRef.current?.setOpacityOverrides(viewerState.opacityOverrides); }, [viewerState.opacityOverrides, modelBounds]);
  useEffect(() => { viewerRef.current?.setViewMode(viewMode); }, [viewMode, modelBounds]);
  useEffect(() => { viewerRef.current?.setShowEdges(showEdges); }, [showEdges, modelBounds]);
  useEffect(() => { viewerRef.current?.setShowAxes(showAxes); }, [showAxes]);
  useEffect(() => { viewerRef.current?.setSpacesVisible(showSpaces); }, [showSpaces, modelBounds]);
  useEffect(() => { viewerRef.current?.setExplode(explode); }, [explode, modelBounds]);
  useEffect(() => { viewerRef.current?.setSectionBox(sectionEnabled, sectionBox, modelBounds); }, [sectionEnabled, sectionBox, modelBounds]);
  useEffect(() => { viewerRef.current?.setPlanCut(planCut); }, [planCut, modelBounds]);
  useEffect(() => { viewerRef.current?.setMeasureMode(measureMode); }, [measureMode]);
  useEffect(() => { viewerRef.current?.setAnnotationMode(annoMode); }, [annoMode]);
  useEffect(() => { viewerRef.current?.setTheme(theme); }, [theme]);

  const v = viewerRef.current;
  const project = (arr) => (v ? v.worldToScreen(new THREE.Vector3().fromArray(arr)) : { behind: true });
  const hoverEl = hover && model ? model.byId.get(hover.expressId) : null;
  const hostRect = hostRef.current?.getBoundingClientRect();
  const toolHint = measureMode ? 'Click two points to measure. Esc to stop.' : annoMode ? 'Click an element to pin an issue. Esc to stop.' : planCut.enabled ? 'Plan cut: geometry above the level is hidden.' : null;
  const sel = viewerState.selectedIds.size > 0;

  return (
    <div className="viewer-region" data-layout={model ? layout : '3d'}>
      <div className="viewer-wrap" ref={hostRef} data-workspace={workspace}>
        {model && (
          <div className="hud">
            <div className="viewbar" role="toolbar" aria-label="View">
              <label className="quick-select">
                <Icons.Layers size={15} />
                <select aria-label="Level" value={levelId} onChange={e => onLevelChange(e.target.value)}>
                  <option value="all">All levels</option>
                  {model.storeys.map(s => <option key={s.expressId} value={s.expressId}>{s.name || s.longName || `Storey #${s.expressId}`}</option>)}
                </select>
              </label>
              <button type="button" className="chip-btn" aria-pressed={planCut.enabled} disabled={levelId === 'all'} title={levelId === 'all' ? 'Choose a level to cut a floor plan' : 'Cut the model 1.2 m above the floor'} onClick={togglePlanCut}><Icons.PlanCut size={15} /><span>Cut</span></button>
              <span className="quick-sep" />
              {layoutSwitch}
            </div>

            <NavCubeHost viewerRef={viewerRef} ready={ready} theme={theme} />

            {(toolHint || hint) && (
              <div className="status-chip" role="status">
                <span className="dot" data-tone={workspace === 'explore' ? 'accent' : 'signal'} />
                {toolHint || hint}
              </div>
            )}

            {sectionEnabled && modelBounds && sectionBox && (
              <SectionBoxControls box={sectionBox} bounds={modelBounds} onChange={setSectionBox} onReset={() => setSectionBox({ ...modelBounds })} onClose={toggleSection} />
            )}

            {viewerState.measurements.map(m => {
              const mid = m.a.map((x, i) => (x + m.b[i]) / 2);
              const s = project(mid);
              return s.behind ? null : <div key={m.id} className="measure-label mono" style={{ left: s.x, top: s.y }}>{m.distance.toFixed(2)} m</div>;
            })}

            {viewerState.annotations.map((a, i) => {
              const s = project(a.position);
              return s.behind ? null : (
                <button key={a.id} type="button" className="anno-pin" data-status={a.status} style={{ left: s.x, top: s.y }} title={a.title} onClick={() => a.elementId != null && dispatch({ type: 'select', ids: [a.elementId] })}>
                  <span>{i + 1}</span>
                </button>
              );
            })}

            {hoverEl && hostRect && !measureMode && !annoMode && (
              <div className="hover-tip" style={{ left: hover.x - hostRect.left + 14, top: hover.y - hostRect.top + 16 }}>
                {hover.overlay ? <span className="tip-kind">Graph node from</span> : null}
                <span className="mono tip-class">{hoverEl.ifcClass}</span>
                <span className="tip-name">{elementLabel(hoverEl)}</span>
              </div>
            )}

            <div className="dock" role="toolbar" aria-label="View tools">
              <div className="dock-group">
                <IconButton icon={Icons.Home} label="Fit model" onClick={() => v?.frameAll()} />
                <IconButton icon={Icons.Focus} label="Zoom to selection" shortcut="F" disabled={!sel} onClick={() => v?.frameElements([...viewerState.selectedIds])} />
              </div>
              <div className="dock-group">
                <IconButton icon={Icons.Eye} label="Show everything" shortcut="A" onClick={() => dispatch({ type: 'show-all' })} />
                <IconButton icon={Icons.EyeOff} label="Hide selection" shortcut="H" disabled={!sel} onClick={() => dispatch({ type: 'toggle-hide', ids: [...viewerState.selectedIds] })} />
                <IconButton icon={Icons.Isolate} label="Isolate selection" shortcut="I" disabled={!sel} onClick={() => dispatch({ type: 'isolate', ids: [...viewerState.selectedIds] })} />
              </div>
              <div className="dock-group">
                <IconButton icon={Icons.Section} label="Section box" shortcut="S" active={sectionEnabled} onClick={toggleSection} />
                <IconButton icon={Icons.Ruler} label="Measure distance" shortcut="M" active={measureMode} onClick={toggleMeasure} />
                <IconButton icon={Icons.Pin} label="Pin an issue" shortcut="P" active={annoMode} onClick={toggleAnno} />
              </div>
              <div className="dock-group">
                <div className="seg" role="group" aria-label="Display mode">
                  <button type="button" aria-pressed={viewMode === 'shaded'} title="Shaded" onClick={() => setViewMode('shaded')}><Icons.Shaded size={16} /><span className="sr-only">Shaded</span></button>
                  <button type="button" aria-pressed={viewMode === 'xray'} title="X-ray (X)" onClick={() => setViewMode('xray')}><Icons.Xray size={16} /><span className="sr-only">X-ray</span></button>
                  <button type="button" aria-pressed={viewMode === 'wireframe'} title="Wireframe (W)" onClick={() => setViewMode('wireframe')}><Icons.Wireframe size={16} /><span className="sr-only">Wireframe</span></button>
                </div>
                <IconButton icon={Icons.Edges} label="Edge lines" shortcut="E" active={showEdges} onClick={() => setShowEdges(x => !x)} />
              </div>
              <div className="dock-group">
                <LayersPopover
                  model={model} showSpaces={showSpaces} setShowSpaces={setShowSpaces} slabsTransparent={slabsTransparent} onToggleSlabs={onToggleSlabs}
                  onFocusGroup={onFocusGroup} onResetFilters={onResetFilters} explode={explode} setExplode={setExplode} showAxes={showAxes} setShowAxes={setShowAxes}
                />
                <IconButton icon={Icons.Camera} label="Save a screenshot" onClick={() => {
                  const url = v.screenshot();
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${model.fileName.replace(/\.[^.]+$/, '')}-view.png`;
                  a.click();
                  toast({ kind: 'ok', msg: 'Screenshot saved' });
                }} />
              </div>
            </div>
          </div>
        )}
      </div>
      {model && layout !== '3d' && planElement}
    </div>
  );
}

// Filters and scene options that do not need to be on screen all the time.
function LayersPopover({ model, showSpaces, setShowSpaces, slabsTransparent, onToggleSlabs, onFocusGroup, onResetFilters, explode, setExplode, showAxes, setShowAxes }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc); };
  }, [open]);
  const active = showSpaces || slabsTransparent || explode > 0;
  return (
    <div className="menu-anchor" ref={ref}>
      <button type="button" className="icon-btn dock-layers" data-active={active ? 'true' : undefined} aria-expanded={open} aria-label="Layers and filters" title="Layers and filters" onClick={() => setOpen(o => !o)}>
        <Icons.Layers size={16} />
      </button>
      {open && (
        <div className="menu dock-menu" role="dialog" aria-label="Layers and filters">
          <div className="menu-title">Show</div>
          <label className="check-field menu-check"><input type="checkbox" checked={showSpaces} onChange={() => setShowSpaces(x => !x)} /> Room volumes</label>
          <label className="check-field menu-check"><input type="checkbox" checked={slabsTransparent} onChange={onToggleSlabs} /> See-through slabs and roofs</label>
          <label className="check-field menu-check"><input type="checkbox" checked={showAxes} onChange={() => setShowAxes(x => !x)} /> Axes</label>
          <div className="menu-sep" />
          <div className="menu-title">Isolate</div>
          <button type="button" role="menuitem" onClick={() => { onFocusGroup('structure'); setOpen(false); }}><Icons.Building size={15} /> Structure</button>
          <button type="button" role="menuitem" onClick={() => { onFocusGroup('mep'); setOpen(false); }}><Icons.Activity size={15} /> MEP</button>
          {model.storeys.length > 1 && (
            <>
              <div className="menu-sep" />
              <label className="slider-row menu-slider">
                <span>Explode levels</span>
                <input type="range" min="0" max="1" step="0.01" value={explode} onChange={e => setExplode(parseFloat(e.target.value))} />
                <span className="mono">{Math.round(explode * 100)}%</span>
              </label>
            </>
          )}
          <div className="menu-sep" />
          <button type="button" role="menuitem" onClick={() => { onResetFilters(); setOpen(false); }}><Icons.Reset size={15} /> Reset view filters</button>
        </div>
      )}
    </div>
  );
}

// 3D / 3D + 2D / 2D layout switch, shared by the 3D view bar and the plan toolbar.
function LayoutSwitch({ layout, setLayout }) {
  return (
    <div className="seg layout-seg" role="group" aria-label="Layout">
      <button type="button" aria-pressed={layout === '3d'} title="3D model only" onClick={() => setLayout('3d')}><Icons.Cube size={15} /><span>3D</span></button>
      <button type="button" aria-pressed={layout === 'split'} title="3D model and 2D floor plan side by side" onClick={() => setLayout('split')}><Icons.Columns size={15} /><span>3D + 2D</span></button>
      <button type="button" aria-pressed={layout === 'plan'} title="2D floor plan only" onClick={() => setLayout('plan')}><Icons.Plan size={15} /><span>2D</span></button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Start screen
// ---------------------------------------------------------------------------
function StartScreen({ onUpload, onLoadFile, onLoadSample, currentModel, onResume }) {
  const [over, setOver] = useState(false);
  return (
    <div className="start" onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={e => { if (e.currentTarget === e.target) setOver(false); }} onDrop={e => {
      e.preventDefault();
      setOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) onLoadFile(file, 'Dropped');
    }}>
      <div className="start-inner">
        {currentModel && (
          <button type="button" className="btn resume-btn" onClick={onResume}>
            <Icons.ChevronRight size={15} style={{ transform: 'rotate(180deg)' }} /> Back to {currentModel.fileName}
          </button>
        )}
        <section className="start-hero">
          <h1>From IFC model to robot route.</h1>
          <p>BIM2Bot Lab reads a building model in your browser, explains its semantics, turns it into maps a robot can plan on, and simulates robot fleets moving through it. Files never leave your machine.</p>
          <div className="start-actions">
            <button type="button" className="btn btn-primary btn-lg" onClick={onUpload}><Icons.Upload size={16} /> Open an IFC file</button>
            <button type="button" className="btn btn-lg" onClick={() => onLoadSample(SAMPLES[0])}><Icons.Cube size={16} /> Try a sample model</button>
          </div>
          <button type="button" className="dropzone" data-over={over} onClick={onUpload}>
            <Icons.Upload size={18} />
            <span>Drop a <code>.ifc</code> file anywhere on this page</span>
            <span className="muted">IFC2x3, IFC4 and IFC4.3, parsed locally with web-ifc</span>
          </button>
        </section>

        <section className="start-samples" aria-label="Sample models">
          <h2>Sample models</h2>
          <div className="sample-grid">
            {SAMPLES.map(smp => (
              <article key={smp.id} className="sample-card">
                <div className="sample-head">
                  <Icons.Building size={18} />
                  <h3>{smp.name}</h3>
                  <span className="mono muted">{smp.size}</span>
                </div>
                <p>{smp.facts}</p>
                <p className="sample-credit"><a href={smp.creditUrl} target="_blank" rel="noopener noreferrer">{smp.credit}</a></p>
                <button type="button" className="btn btn-sm" onClick={() => onLoadSample(smp)}>{smp.bundled ? 'Open' : 'Download and open'}</button>
              </article>
            ))}
          </div>
        </section>

        <ol className="start-roadmap" aria-label="Features">
          <li data-state="live">
            <div className="rm-head"><Icons.Cube size={18} /><span>Explore</span></div>
            <p>Inspect geometry, the spatial tree, property sets, materials and relationships. Section, measure and mark up.</p>
          </li>
          <li data-state="live">
            <div className="rm-head"><Icons.Route size={18} /><span>Navigate</span></div>
            <p>Occupancy grids and a room graph from IFC, A* routes across levels, what-if obstacles and blocked doors, and cell-level traceability.</p>
          </li>
          <li data-state="live">
            <div className="rm-head"><Icons.Robot size={18} /><span>Simulate</span></div>
            <p>Robot fleets with lift scheduling, corridor congestion heatmaps and human–robot encounter analysis.</p>
          </li>
        </ol>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading overlay
// ---------------------------------------------------------------------------
function LoadingOverlay({ fileName, progress, phase, log }) {
  const recent = log.slice(-5);
  return (
    <div className="load-overlay" role="status" aria-live="polite">
      <div className="load-card">
        <div className="load-head">
          <span className="spinner" />
          <div>
            <h3>Opening {fileName}</h3>
            <div className="sub">{phase || 'Starting'}</div>
          </div>
          <span className="mono load-pct">{Math.round(progress * 100)}%</span>
        </div>
        <div className="load-bar"><div style={{ width: `${Math.max(2, progress * 100)}%` }} /></div>
        <ul className="load-log">
          {recent.map((l, i) => <li key={i} className={l.level} dangerouslySetInnerHTML={{ __html: l.msg }} />)}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------
function HelpPanel({ onClose }) {
  const groups = [
    ['Camera', [['Left drag', 'Orbit'], ['Right drag, Shift + drag', 'Pan'], ['Wheel', 'Zoom toward the cursor'], ['Double-click', 'Zoom to element'], ['1 to 6', 'Iso, top, front, back, left, right'], ['F', 'Zoom to selection']]],
    ['Selection', [['Click', 'Select'], ['Ctrl + click', 'Add to selection'], ['H / I / A', 'Hide, isolate, show all'], ['Esc', 'Stop the tool, then clear selection'], ['Right-click', 'Context menu']]],
    ['Tools', [['S', 'Section box'], ['M', 'Measure'], ['P', 'Pin an issue'], ['E', 'Edge lines'], ['X / W', 'X-ray, wireframe'], ['Ctrl + K', 'Search'], ['O', 'Open a file']]],
  ];
  return (
    <Modal title="Shortcuts and controls" onClose={onClose}>
      <div className="help-grid">
        {groups.map(([title, rows]) => (
          <div key={title}>
            <h4>{title}</h4>
            {rows.map(([k, l]) => <div key={k} className="help-row"><span>{l}</span><kbd>{k}</kbd></div>)}
          </div>
        ))}
      </div>
      <p className="pane-note">On touch screens, drag with one finger to orbit and pinch with two to zoom and pan.</p>
    </Modal>
  );
}

function ToastContainer({ toasts, onDismiss }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className="toast" data-kind={t.kind || 'info'}>
          <span className="toast-ic">{t.kind === 'ok' ? <Icons.Check size={14} /> : t.kind === 'info' ? <Icons.Info size={14} /> : <Icons.Alert size={14} />}</span>
          <div className="toast-msg"><div>{t.msg}</div>{t.sub && <div className="sub">{t.sub}</div>}</div>
          <IconButton icon={Icons.X} label="Dismiss" size={12} className="sm" onClick={() => onDismiss(t.id)} />
        </div>
      ))}
    </div>
  );
}

function ContextMenu({ menu, onClose, dispatch, onZoomTo, model, toast, nav }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffectSafe(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ x: Math.min(menu.x, window.innerWidth - r.width - 8), y: Math.min(menu.y, window.innerHeight - r.height - 8) });
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc); };
  }, [menu]);
  if (!menu) return null;
  const ids = menu.ids;
  const first = model.byId.get(ids[0]);
  const run = (fn) => () => { fn(); onClose(); };
  const isDoor = first && navRoleOf(first) === 'portal';
  return (
    <div className="menu ctx-menu" role="menu" ref={ref} style={{ left: (pos || menu).x, top: (pos || menu).y }}>
      <div className="menu-title">{ids.length > 1 ? plural(ids.length, 'element') : elementLabel(first)}</div>
      <button type="button" role="menuitem" onClick={run(() => onZoomTo(ids))}><Icons.Focus size={15} /> Zoom to <kbd>F</kbd></button>
      <button type="button" role="menuitem" onClick={run(() => dispatch({ type: 'isolate', ids }))}><Icons.Isolate size={15} /> Isolate <kbd>I</kbd></button>
      <button type="button" role="menuitem" onClick={run(() => dispatch({ type: 'toggle-hide', ids }))}><Icons.EyeOff size={15} /> Hide <kbd>H</kbd></button>
      <button type="button" role="menuitem" onClick={run(() => dispatch({ type: 'show-all' }))}><Icons.Eye size={15} /> Show everything <kbd>A</kbd></button>
      {first && <button type="button" role="menuitem" onClick={run(() => dispatch({ type: 'select', ids: model.byClass.get(first.ifcClass) || [] }))}><Icons.Classes size={15} /> Select all {first.ifcClass.replace(/^Ifc/, '')}</button>}
      {isDoor && nav && <button type="button" role="menuitem" onClick={run(() => nav.toggleBlocked(first.expressId))}><Icons.Ban size={15} /> {nav.blocked.has(first.expressId) ? 'Unblock door' : 'Block door for routing'}</button>}
      <div className="menu-sep" />
      {first && first.globalId && <button type="button" role="menuitem" onClick={run(() => { navigator.clipboard?.writeText(first.globalId); toast({ kind: 'ok', msg: 'GlobalId copied' }); })}><Icons.Copy size={15} /> Copy GlobalId</button>}
      <button type="button" role="menuitem" onClick={run(() => exportJSON(ids.map(id => model.byId.get(id)).filter(Boolean), toast))}><Icons.Download size={15} /> Export as JSON</button>
    </div>
  );
}

// useLayoutEffect without the SSR warning concerns (always client-side here).
const useLayoutEffectSafe = React.useLayoutEffect;

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
function App() {
  const [theme, setTheme] = useState(initialTheme);
  const [model, setModel] = useState(null);
  const [secondaryReady, setSecondaryReady] = useState(false);
  const [loading, setLoading] = useState(null);
  const [workspace, setWorkspace] = useState('explore');
  const [modal, setModal] = useState(null);
  const [viewMode, setViewMode] = useState('shaded');
  const [showEdges, setShowEdges] = useState(false);
  const [showAxes, setShowAxes] = useState(true);
  const [showSpaces, setShowSpaces] = useState(false);
  const [explode, setExplode] = useState(0);
  const [sectionEnabled, setSectionEnabled] = useState(false);
  const [sectionBox, setSectionBox] = useState(null);
  const [measureMode, setMeasureMode] = useState(false);
  const [annoMode, setAnnoMode] = useState(false);
  const [levelId, setLevelId] = useState('all');
  const [planCut, setPlanCut] = useState({ enabled: false, y: 0 });
  const [slabsTransparent, setSlabsTransparent] = useState(false);
  const [log, setLog] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [contextMenu, setContextMenu] = useState(null);
  const [layout, setLayout] = useState(initialLayout);
  const [robot, setRobot] = useState(() => ({ ...DEFAULT_ROBOT_PROFILE }));
  const [route, setRouteEnds] = useState(EMPTY_ROUTE);
  const [viewLayout, setViewLayoutState] = useState(() => (['3d', 'split', 'plan'].includes(readStorage(STORAGE.layoutMode)) ? readStorage(STORAGE.layoutMode) : '3d'));
  const [planLevel, setPlanLevel] = useState(null);
  const [missions, setMissions] = useState([]);
  const [pendingMission, setPendingMission] = useState(null);
  const [simRequest, setSimRequest] = useState(null);
  const [leftTab, setLeftTab] = useState('spatial');
  const [showHome, setShowHome] = useState(false);
  const [blocked, setBlocked] = useState(() => new Set());
  const [showGraph, setShowGraph] = useState(true);
  const [planner, setPlanner] = useState('grid');
  const [showGrid, setShowGrid] = useState(true);
  const [clickMode, setClickMode] = useState('select');
  const [obstacleSize, setObstacleSize] = useState(1);
  const [obstacles, setObstacles] = useState([]);
  const [zones, setZones] = useState([]);
  const [pendingZone, setPendingZone] = useState(null);
  const [zoneFactor, setZoneFactor] = useState(0.5);
  const [cellQuery, setCellQuery] = useState(null);
  const [stairsAsLifts, setStairsAsLifts] = useState(false);
  const [gridWanted, setGridWanted] = useState(false);
  const [navMap, setNavMap] = useState(null);
  const [viewerState, dispatch] = useReducer(viewerStateReducer, undefined, initialViewerState);
  const fileInputRef = useRef(null);
  const viewerRef = useRef(null);
  const bodyRef = useRef(null);
  const searchRef = useRef(null);
  const modelRef = useRef(null);
  modelRef.current = model;

  // ---- Theme + layout persistence ------------------------------------------------
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    writeStorage(STORAGE.theme, theme);
  }, [theme]);
  useEffect(() => { writeStorage(STORAGE.layout, JSON.stringify(layout)); }, [layout]);

  // Warm up the WASM runtime while the start screen is idle.
  useEffect(() => {
    const warm = () => { window.ensureWebIfc?.().catch(() => {}); };
    if (typeof requestIdleCallback !== 'undefined') {
      const h = requestIdleCallback(warm, { timeout: 2500 });
      return () => cancelIdleCallback(h);
    }
    const h = setTimeout(warm, 300);
    return () => clearTimeout(h);
  }, []);

  // ---- Toasts + log -------------------------------------------------------------------
  const dismissToast = useCallback((id) => setToasts(ts => ts.filter(x => x.id !== id)), []);
  const toast = useCallback((t) => {
    const id = uid();
    setToasts(ts => [...ts.slice(-3), { ...t, id }]);
    setTimeout(() => dismissToast(id), t.kind === 'error' ? 7000 : 3200);
  }, [dismissToast]);
  const addLog = useCallback((level, msg) => {
    setLog(l => [...l, { time: new Date().toLocaleTimeString([], { hour12: false }), level, msg }]);
  }, []);

  // ---- Building semantics (V2 foundation) -------------------------------------------------
  const building = useMemo(() => {
    if (!model || !secondaryReady) return null;
    try { return buildBuildingGraph(model); } catch (err) { console.error(err); return null; }
  }, [model, secondaryReady]);
  const readiness = useMemo(() => (building ? analyzeReadiness(building, model, { robot, blocked }) : null), [building, robot, blocked]);
  const routeResult = useMemo(() => {
    if (!building || !route.startId || !route.goalId) return null;
    return findRoute(building, route.startId, route.goalId, { robot, blocked });
  }, [building, route, robot, blocked]);
  // ---- Occupancy grids (Version 2), built once on first use ----------------------------
  useEffect(() => { if (workspace !== 'explore' || viewLayout !== '3d') setGridWanted(true); }, [workspace, viewLayout]);
  useEffect(() => {
    if (!building || !gridWanted) { setNavMap(null); return; }
    const h = setTimeout(() => {
      try {
        const nm = buildNavMap(model, building);
        setNavMap(nm);
        addLog('ok', `Occupancy grids: <span class="hl">${nm.grids.length}</span> levels, <span class="hl">${nm.cells.toLocaleString()}</span> cells at ${Math.round(nm.res * 100)} cm in ${nm.buildMs.toFixed(0)} ms`);
      } catch (err) {
        console.error(err);
        addLog('error', `Occupancy grid failed: ${err.message || err}`);
      }
    }, 30);
    return () => clearTimeout(h);
  }, [building, gridWanted]);
  const navState = useMemo(() => (navMap && building ? applyRobot(navMap, building, robot, { blocked, obstacles, zones, stairsAsLifts }) : null), [navMap, building, robot, blocked, obstacles, zones, stairsAsLifts]);
  const gridInfo = useMemo(() => (navState ? { summary: navMapSummary(navState), reach: gridReachability(navState, building) } : null), [navState]);
  const endpoint = (id, pt) => {
    if (pt) return pt;
    const sp = id != null && building ? building.spaces.get(id) : null;
    return sp ? { levelId: sp.levelId, x: sp.position[0], z: sp.position[2] } : null;
  };
  const startPt = useMemo(() => endpoint(route.startId, route.startPoint), [route, building]);
  const goalPt = useMemo(() => endpoint(route.goalId, route.goalPoint), [route, building]);
  const gridRoute = useMemo(() => {
    if (!navState || planner !== 'grid' || !startPt || !goalPt) return null;
    return planGridRoute(navState, startPt, goalPt);
  }, [navState, planner, startPt, goalPt]);
  // Room containing a picked point (smallest room whose floor footprint holds it).
  const roomAt = useCallback((lid, x, z) => {
    if (!building) return null;
    let best = null;
    building.spaces.forEach(sp => {
      if (sp.levelId !== lid) return;
      const b = sp.bbox;
      if (x < b.min[0] || x > b.max[0] || z < b.min[2] || z > b.max[2]) return;
      if (!best || sp.area < best.area) best = sp;
    });
    return best ? best.id : null;
  }, [building]);
  // Mission paths: the same grid A* the robots use, so links follow doors and corridors.
  const missionPaths = useMemo(() => (navState ? missions.map(m => {
    const r = planGridRoute(navState, m.start, m.goal);
    return r ? r.legs.filter(l => l.type === 'walk').map(l => ({ levelId: l.levelId, points: l.points })) : null;
  }) : []), [navState, missions]);
  const cellInfo = useMemo(() => (navState && cellQuery ? explainCell(navState, cellQuery.levelId, cellQuery.x, cellQuery.z) : null), [navState, cellQuery]);
  const simApi = useSimulation({ viewerRef, model, building, navMap, theme, levelId, active: workspace === 'simulate' });

  useEffect(() => {
    if (building) addLog('ok', `Navigation graph: <span class="hl">${building.spaces.size}</span> rooms, <span class="hl">${building.doors.size}</span> doors, <span class="hl">${building.edges.length}</span> links in ${building.buildMs.toFixed(0)} ms`);
  }, [building]);

  // ---- Reset everything tied to a model ------------------------------------------------------
  const resetSession = useCallback(() => {
    dispatch({ type: 'reset' });
    setSecondaryReady(false);
    setLevelId('all');
    setPlanCut({ enabled: false, y: 0 });
    setSlabsTransparent(false);
    setShowSpaces(false);
    setExplode(0);
    setSectionEnabled(false);
    setSectionBox(null);
    setMeasureMode(false);
    setAnnoMode(false);
    setModal(null);
    setContextMenu(null);
    setRouteEnds(EMPTY_ROUTE);
    setBlocked(new Set());
    setObstacles([]);
    setZones([]);
    setPendingZone(null);
    setMissions([]);
    setPendingMission(null);
    setPlanLevel(null);
    setCellQuery(null);
    setClickMode('select');
    setGridWanted(false);
    viewerRef.current?.clearMeasurements();
  }, []);

  const loadIfcFile = useCallback(async (file, source = 'Opened') => {
    if (!file) return;
    if (!/\.ifc$/i.test(file.name)) {
      toast({ kind: 'error', msg: `${file.name} is not an .ifc file`, sub: 'Choose a STEP-encoded .ifc file (IFC2x3, IFC4 or IFC4.3).' });
      return;
    }
    modelRef.current?.close?.();
    setModel(null);
    resetSession();
    setLog([]);
    setLoading({ fileName: file.name, progress: 0.01, phase: 'Starting' });
    addLog('info', `${source} <span class="hl">${file.name}</span> (${formatSize(file.size)})`);
    try {
      const schema = await window.readIfcSchema(file);
      if (schema && !window.isSupportedIfcSchema(schema)) throw new Error(`Schema ${schema} is not supported. Use IFC2X3, IFC4 or IFC4X3.`);
      const m = await window.loadRealIfc(file, {
        onProgress: (p, phase) => setLoading(l => (l ? { ...l, progress: p, phase: phase || l.phase } : l)),
        onLog: addLog,
      });
      setModel(m);
      setShowHome(false);
      setLoading(null);
      setWorkspace(w => (w === 'simulate' ? 'explore' : w));
      toast({ kind: 'ok', msg: `Opened ${file.name}`, sub: `${plural(m.elements.length, 'element')}, ${m.schemaVersion}` });
      m._ensureSecondaryData().then(() => { if (modelRef.current === m) setSecondaryReady(true); });
    } catch (err) {
      console.error(err);
      addLog('error', `Could not open the file: ${err.message || err}`);
      setLoading(null);
      toast({ kind: 'error', msg: `Could not open ${file.name}`, sub: String(err.message || err).slice(0, 140) });
    }
  }, [addLog, toast, resetSession]);

  const loadSample = useCallback(async (sample = SAMPLES[0]) => {
    try {
      if (!sample.bundled) setLoading({ fileName: sample.file, progress: 0.01, phase: 'Downloading from the source' });
      const res = await fetch(sample.url);
      if (!res.ok) throw new Error(`The sample returned HTTP ${res.status}`);
      const blob = await res.blob();
      await loadIfcFile(new File([blob], sample.file, { type: 'application/octet-stream' }), `Opened sample “${sample.name}”`);
    } catch (err) {
      setLoading(null);
      toast({ kind: 'error', msg: `Could not open “${sample.name}”`, sub: sample.bundled ? 'Serve the site over HTTP (not file://) and try again.' : 'The source could not be reached. Check your connection and try again.' });
    }
  }, [loadIfcFile, toast]);

  const onUpload = useCallback(() => fileInputRef.current?.click(), []);

  const onCloseModel = useCallback(() => {
    modelRef.current?.close?.();
    setModel(null);
    resetSession();
    setLog([]);
    setWorkspace('explore');
  }, [resetSession]);

  // Drag a file onto the page at any time.
  useEffect(() => {
    const over = (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); };
    const drop = (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      loadIfcFile(e.dataTransfer.files[0], 'Dropped');
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); };
  }, [loadIfcFile]);

  // ---- Selection helpers -----------------------------------------------------------------------
  const onPick = useCallback((id, e) => dispatch({ type: 'select', ids: [id], multi: !!(e && (e.ctrlKey || e.metaKey || e.shiftKey)) }), []);
  const onZoomTo = useCallback((ids) => viewerRef.current?.frameElements(ids), []);
  const selectAndShow = useCallback((ids) => {
    dispatch({ type: 'select', ids });
    const geo = ids.filter(id => modelRef.current?.byId.get(id)?.geometry);
    if (geo.length) viewerRef.current?.frameElements(geo);
  }, []);

  const onMapPick = useCallback(({ levelId: lid, x, z }) => {
    const pt = { levelId: lid, x, z };
    if (clickMode === 'inspect') { setCellQuery(pt); return; }
    if (clickMode === 'obstacle') {
      setObstacles(list => {
        const hit = list.find(o => o.levelId === lid && Math.abs(o.x - x) <= o.size / 2 && Math.abs(o.z - z) <= o.size / 2);
        if (hit) return list.filter(o => o !== hit);
        return [...list, { id: uid(), levelId: lid, x, z, size: obstacleSize }];
      });
      return;
    }
    if (clickMode === 'zone-nogo' || clickMode === 'zone-slow') {
      // Two clicks: opposite corners of the zone, on one level.
      if (!pendingZone || pendingZone.levelId !== lid) { setPendingZone(pt); return; }
      if (Math.abs(x - pendingZone.x) < 0.2 || Math.abs(z - pendingZone.z) < 0.2) {
        toast({ kind: 'info', msg: 'Zone too small', sub: 'Click the opposite corner at least 0.2 m away in both directions.' });
        return;
      }
      const kind = clickMode === 'zone-nogo' ? 'nogo' : 'slow';
      setZones(list => [...list, { id: uid(), kind, levelId: lid, x0: pendingZone.x, z0: pendingZone.z, x1: x, z1: z, ...(kind === 'slow' ? { factor: zoneFactor } : {}) }]);
      setPendingZone(null);
      return;
    }
    if (clickMode === 'start' || clickMode === 'goal') {
      const room = roomAt(lid, x, z);
      setRouteEnds(r => (clickMode === 'start' ? { ...r, startPoint: pt, startId: room } : { ...r, goalPoint: pt, goalId: room }));
      if (workspace === 'explore') setWorkspace('navigate');
      setClickMode(clickMode === 'start' && !route.goalPoint && !route.goalId ? 'goal' : 'select');
      return;
    }
    if (clickMode === 'mission') {
      if (!pendingMission) { setPendingMission(pt); return; }
      setMissions(list => [...list, { id: uid(), start: pendingMission, goal: pt }].slice(0, 8));
      setPendingMission(null);
    }
  }, [clickMode, obstacleSize, roomAt, workspace, route, pendingMission, pendingZone, zoneFactor, toast]);

  const onPickEvent = useCallback((e) => {
    if (clickMode !== 'select') {
      if (e.overlay !== 'grid' || !e.point) {
        toast({ kind: 'info', msg: 'Click on the coloured floor grid', sub: 'Or use the 2D floor plan (3D + 2D or 2D layout).' });
        return;
      }
      onMapPick({ levelId: e.gridLevel, x: e.point[0], z: e.point[2] });
      return;
    }
    if (e.expressId == null) { if (!e.multi) dispatch({ type: 'clear-selection' }); return; }
    dispatch({ type: 'select', ids: [e.expressId], multi: e.multi });
  }, [clickMode, onMapPick, toast]);

  const onContext = useCallback((e, id) => {
    if (e.preventDefault) e.preventDefault();
    if (!modelRef.current) return;
    let ids = [...viewerState.selectedIds];
    if (id != null && !viewerState.selectedIds.has(id)) { ids = [id]; dispatch({ type: 'select', ids }); }
    if (!ids.length) return;
    setContextMenu({ x: e.clientX, y: e.clientY, ids });
  }, [viewerState.selectedIds]);
  const onContextEvent = useCallback((e) => {
    if (e.expressId == null) return;
    onContext({ clientX: e.x, clientY: e.y }, e.expressId);
  }, [onContext]);

  // ---- Tools ------------------------------------------------------------------------------------
  const toggleSection = useCallback(() => {
    setSectionEnabled(on => {
      if (!on) {
        const b = viewerRef.current?.getModelBounds();
        if (b) setSectionBox({ ...b });
      }
      return !on;
    });
  }, []);
  const toggleMeasure = useCallback(() => setMeasureMode(on => { if (!on) setAnnoMode(false); return !on; }), []);
  const toggleAnno = useCallback(() => setAnnoMode(on => { if (!on) setMeasureMode(false); return !on; }), []);

  const levelFloorY = useCallback((id) => {
    const lv = building?.levels.find(l => l.id === Number(id));
    if (lv && lv.floorY != null) return lv.floorY;
    const els = model ? model.elements.filter(e => e.storey && e.storey.expressId === Number(id) && e.bbox) : [];
    return els.length ? Math.min(...els.map(e => e.bbox.min[1])) : 0;
  }, [building, model]);

  const onLevelChange = useCallback((id, { frame = true } = {}) => {
    setLevelId(id);
    if (!model) return;
    if (id === 'all') {
      dispatch({ type: 'isolate', ids: [], force: true });
      setPlanCut(p => ({ ...p, enabled: false }));
      viewerRef.current?.frameAll();
      return;
    }
    const sid = Number(id);
    const ids = model.elements.filter(el => el.storey && el.storey.expressId === sid).map(el => el.expressId);
    if (!ids.length) { toast({ kind: 'warn', msg: 'This level contains no elements' }); return; }
    dispatch({ type: 'isolate', ids, force: true });
    setPlanCut(p => (p.enabled ? { enabled: true, y: levelFloorY(sid) + 1.2 } : p));
    if (frame) viewerRef.current?.frameElements(ids.filter(i => model.byId.get(i).geometry));
  }, [model, toast, levelFloorY]);

  const togglePlanCut = useCallback(() => {
    if (levelId === 'all') return;
    setPlanCut(p => {
      const next = { enabled: !p.enabled, y: levelFloorY(levelId) + 1.2 };
      if (next.enabled) viewerRef.current?.setCameraPreset('top');
      return next;
    });
  }, [levelId, levelFloorY]);

  const onToggleSlabs = useCallback(() => {
    if (!model) return;
    const ids = SLAB_CLASSES.flatMap(c => model.byClass.get(c) || []);
    setSlabsTransparent(on => {
      dispatch({ type: 'set-opacity-many', ids, opacity: on ? null : 0.15 });
      return !on;
    });
  }, [model]);

  const onFocusGroup = useCallback((group) => {
    if (!model) return;
    const ids = [];
    model.byClass.forEach((list, cls) => { if (classGroupOf(cls) === group) ids.push(...list.filter(id => model.byId.get(id).geometry)); });
    const label = group === 'mep' ? 'MEP' : 'Structure';
    if (!ids.length) { toast({ kind: 'warn', msg: `No ${label} elements in this model` }); return; }
    dispatch({ type: 'isolate', ids, force: true });
    viewerRef.current?.frameElements(ids);
    toast({ kind: 'info', msg: `Isolated ${label}`, sub: plural(ids.length, 'element') });
  }, [model, toast]);

  const onResetFilters = useCallback(() => {
    if (!model) return;
    setLevelId('all');
    setPlanCut({ enabled: false, y: 0 });
    if (slabsTransparent) {
      dispatch({ type: 'set-opacity-many', ids: SLAB_CLASSES.flatMap(c => model.byClass.get(c) || []), opacity: null });
      setSlabsTransparent(false);
    }
    dispatch({ type: 'show-all' });
    setExplode(0);
    viewerRef.current?.frameAll();
  }, [model, slabsTransparent]);

  // ---- Saved views ----------------------------------------------------------------------------
  const onSaveView = useCallback(() => {
    dispatch({ type: 'save-view', camera: viewerRef.current?.getCameraState() });
    toast({ kind: 'ok', msg: 'View saved' });
  }, [toast]);
  const onRestoreView = useCallback((view) => {
    dispatch({ type: 'restore-view', view });
    viewerRef.current?.setCameraState(view.camera);
  }, []);

  // ---- Navigation controls ----------------------------------------------------------------------
  // Turn the Navigate route into a one-robot mission and run it in Simulate.
  const simulateRoute = useCallback(() => {
    if (!startPt || !goalPt) return;
    const mission = { id: uid(), start: startPt, goal: goalPt };
    setMissions([mission]);
    setPendingMission(null);
    setClickMode('select');
    setSimRequest({ id: mission.id, missions: [mission], robot: { ...robot }, stairsAsLifts });
    setWorkspace('simulate');
    toast({ kind: 'info', msg: 'Simulating the route', sub: 'One robot, one trip. Add robots, people or missions in the scenario.' });
  }, [startPt, goalPt, robot, stairsAsLifts, toast]);

  const nav = useMemo(() => ({
    simulateRoute,
    startPoint: route.startPoint,
    goalPoint: route.goalPoint,
    hasStart: !!startPt,
    hasGoal: !!goalPt,
    planner,
    setPlanner,
    showGrid,
    setShowGrid,
    clickMode,
    setClickMode: (m) => {
      setClickMode(m);
      if (!/^zone-/.test(m)) setPendingZone(null);
      if (m === 'select') return;
      setShowGrid(true);
      // Map editing works one level at a time: focus the route's start level or the first mapped level.
      if (levelId === 'all' && building) {
        const startLevel = route.startId && building.spaces.get(route.startId) ? building.spaces.get(route.startId).levelId : null;
        const first = navMap && navMap.grids[0] ? navMap.grids[0].levelId : null;
        const target = startLevel || first;
        if (target != null) onLevelChange(String(target), { frame: false });
      }
    },
    obstacleSize,
    setObstacleSize,
    obstacles,
    removeObstacle: (id) => setObstacles(list => list.filter(o => o.id !== id)),
    clearObstacles: () => setObstacles([]),
    zones,
    pendingZone,
    zoneFactor,
    setZoneFactor,
    removeZone: (id) => setZones(list => list.filter(z => z.id !== id)),
    clearZones: () => { setZones([]); setPendingZone(null); },
    startPt,
    goalPt,
    cellInfo,
    setCellInfo: (v) => setCellQuery(v),
    stairsAsLifts,
    setStairsAsLifts,
    robot,
    setRobot,
    startId: route.startId,
    goalId: route.goalId,
    blocked,
    showGraph,
    setShowGraph,
    setEndpoint: (kind, id) => {
      setRouteEnds(r => ({ ...r, [kind === 'start' ? 'startId' : 'goalId']: id, [kind === 'start' ? 'startPoint' : 'goalPoint']: null }));
      if (workspace !== 'navigate') setWorkspace('navigate');
    },
    onSetEndpoint: (kind, id) => {
      setRouteEnds(r => ({ ...r, [kind === 'start' ? 'startId' : 'goalId']: id, [kind === 'start' ? 'startPoint' : 'goalPoint']: null }));
      if (workspace !== 'navigate') setWorkspace('navigate');
    },
    swap: () => setRouteEnds(r => ({ startId: r.goalId, goalId: r.startId, startPoint: r.goalPoint, goalPoint: r.startPoint })),
    clearRoute: () => setRouteEnds(EMPTY_ROUTE),
    toggleBlocked: (id) => setBlocked(b => { const n = new Set(b); n.has(id) ? n.delete(id) : n.add(id); return n; }),
    onToggleBlocked: (id) => setBlocked(b => { const n = new Set(b); n.has(id) ? n.delete(id) : n.add(id); return n; }),
    clearBlocked: () => setBlocked(new Set()),
  }), [robot, route, blocked, showGraph, workspace, planner, showGrid, clickMode, obstacleSize, obstacles, zones, pendingZone, zoneFactor, cellInfo, stairsAsLifts, levelId, building, navMap, onLevelChange, simulateRoute, startPt, goalPt]);

  // Draw the navigation overlays.
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    const navigating = workspace === 'navigate';
    if (navigating && building && showGraph && planner === 'graph') {
      v.setOverlay('nav-graph', buildTopologyOverlay(building, { theme, blocked, robot, levelId }), { pickable: clickMode === 'select' });
    } else {
      v.removeOverlay('nav-graph');
    }
    const picking = clickMode !== 'select' && workspace !== 'explore';
    if (navState && ((navigating && showGrid) || picking)) v.setOverlay('nav-grid', buildGridOverlay(navState, { theme, levelId }), { pickable: clickMode !== 'select' });
    else v.removeOverlay('nav-grid');
    if (building && workspace !== 'explore' && (startPt || goalPt || missions.length || pendingMission)) {
      v.setOverlay('nav-marks', buildMarkersOverlay({ building, theme, start: navigating ? startPt : null, goal: navigating ? goalPt : null, missions: workspace === 'simulate' ? missions : [], missionPaths: workspace === 'simulate' ? missionPaths : [], pending: workspace === 'simulate' ? pendingMission : null }));
    } else v.removeOverlay('nav-marks');
    const shown = planner === 'grid' ? (gridRoute ? buildGridRouteOverlay(gridRoute, { theme }) : null) : (routeResult ? buildRouteOverlay(routeResult, { theme }) : null);
    if (navigating && shown) v.setOverlay('nav-route', shown);
    else v.removeOverlay('nav-route');
  }, [workspace, building, showGraph, theme, blocked, robot, levelId, routeResult, gridRoute, planner, navState, showGrid, clickMode, startPt, goalPt, missions, missionPaths, pendingMission]);

  const onFrameRoute = useCallback(() => {
    const pts = planner === 'grid' ? (gridRoute ? gridRoute.legs.flatMap(l => l.points || []) : []) : (routeResult ? routeResult.points : []);
    if (!pts.length) return;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    pts.forEach(p => p.forEach((c, i) => { min[i] = Math.min(min[i], c); max[i] = Math.max(max[i], c); }));
    viewerRef.current?.frameModelBox({ min, max: max.map((c, i) => Math.max(c, min[i] + 1)) });
  }, [routeResult, gridRoute, planner]);
  const onFrameAt = useCallback((p) => {
    const y = p.y != null ? p.y : 0;
    viewerRef.current?.frameModelBox({ min: [p.x - 3, y, p.z - 3], max: [p.x + 3, y + 2, p.z + 3] });
  }, []);

  // Navigate and Simulate read best in X-ray; restore the previous display mode on the way out.
  const modeBeforeNavigate = useRef(null);
  useEffect(() => {
    if (workspace !== 'explore') {
      setMeasureMode(false);
      setAnnoMode(false);
      setViewMode(m => { if (modeBeforeNavigate.current == null) modeBeforeNavigate.current = m; return 'xray'; });
    } else if (modeBeforeNavigate.current) {
      setViewMode(modeBeforeNavigate.current);
      modeBeforeNavigate.current = null;
    }
  }, [workspace]);
  const onWorkspace = useCallback((w) => { setShowHome(false); setWorkspace(w); }, []);

  // ---- Search -----------------------------------------------------------------------------------------
  const onSearch = useCallback((q) => {
    if (!model) return;
    if (!q || !q.trim()) { dispatch({ type: 'clear-query' }); return; }
    const { ids, match } = runQuery(model, q);
    dispatch({ type: 'set-query', ids, match });
    if (layout.bottomCollapsed) setLayout(l => ({ ...l, bottomCollapsed: false }));
    if (!ids.length) toast({ kind: 'warn', msg: `No matches for “${q}”` });
  }, [model, toast, layout.bottomCollapsed]);

  // ---- Keyboard ---------------------------------------------------------------------------------------
  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'f')) {
        if (model) { e.preventDefault(); searchRef.current?.focus(); }
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey || modal) return;
      const sel = [...viewerState.selectedIds];
      const v = viewerRef.current;
      switch (e.key) {
        case 'Escape':
          if (contextMenu) setContextMenu(null);
          else if (measureMode || annoMode) { setMeasureMode(false); setAnnoMode(false); }
          else if (clickMode !== 'select') { setClickMode('select'); setPendingMission(null); setPendingZone(null); }
          else dispatch({ type: 'clear-selection' });
          return;
        case '?': setModal('help'); return;
        case 'o': case 'O': onUpload(); return;
        default: break;
      }
      if (!model) return;
      switch (e.key.toLowerCase()) {
        case 'f': if (sel.length) onZoomTo(sel); break;
        case 'h': if (sel.length) dispatch({ type: 'toggle-hide', ids: sel }); break;
        case 'i': if (sel.length) dispatch({ type: 'isolate', ids: sel }); break;
        case 'a': dispatch({ type: 'show-all' }); break;
        case 'm': toggleMeasure(); break;
        case 'p': toggleAnno(); break;
        case 's': toggleSection(); break;
        case 'e': setShowEdges(x => !x); break;
        case 'x': setViewMode(m => (m === 'xray' ? 'shaded' : 'xray')); break;
        case 'w': setViewMode(m => (m === 'wireframe' ? 'shaded' : 'wireframe')); break;
        case '1': v?.setCameraPreset('iso'); break;
        case '2': v?.setCameraPreset('top'); break;
        case '3': v?.setCameraPreset('front'); break;
        case '4': v?.setCameraPreset('back'); break;
        case '5': v?.setCameraPreset('left'); break;
        case '6': v?.setCameraPreset('right'); break;
        default: break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [model, modal, contextMenu, measureMode, annoMode, clickMode, viewerState.selectedIds, onZoomTo, onUpload, toggleMeasure, toggleAnno, toggleSection]);

  // ---- Panel resizing -----------------------------------------------------------------------------------
  const startResize = useCallback((edge, e) => {
    if (!model) return;
    e.preventDefault();
    const body = bodyRef.current;
    const rect = body.getBoundingClientRect();
    const start = { ...layout };
    const sx = e.clientX, sy = e.clientY;
    let latest = start;
    document.body.classList.add('is-resizing');
    const move = (ev) => {
      const next = { ...start };
      if (edge === 'left') next.left = clamp(start.left + ev.clientX - sx, 240, Math.max(240, rect.width - start.right - 420));
      if (edge === 'right') next.right = clamp(start.right - (ev.clientX - sx), 280, Math.max(280, rect.width - start.left - 420));
      if (edge === 'bottom') next.bottom = clamp(start.bottom - (ev.clientY - sy), 120, Math.min(480, rect.height - 240));
      latest = next;
      body.style.setProperty('--left-w', `${next.left}px`);
      body.style.setProperty('--right-w', `${next.right}px`);
      body.style.setProperty('--bottom-h', `${next.bottom}px`);
      viewerRef.current?.scheduleResize();
    };
    const up = () => {
      document.body.classList.remove('is-resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setLayout(latest);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [model, layout]);

  const toggleBottom = useCallback(() => {
    setLayout(l => ({ ...l, bottomCollapsed: !l.bottomCollapsed }));
    setTimeout(() => viewerRef.current?.scheduleResize(), 0);
  }, []);

  const setViewLayout = useCallback((l) => {
    setViewLayoutState(l);
    writeStorage(STORAGE.layoutMode, l);
    setTimeout(() => viewerRef.current?.scheduleResize(), 0);
  }, []);
  const layoutSwitch = <LayoutSwitch layout={viewLayout} setLayout={setViewLayout} />;

  // Floor plan: follows the 3D level filter, otherwise its own level choice.
  const planLevelId = levelId !== 'all' ? Number(levelId)
    : (planLevel != null ? planLevel
      : (navMap && navMap.grids[0] ? navMap.grids[0].levelId
        : (building ? ((building.levels.find(l => l.spaceIds.length) || building.levels[0] || {}).id) : null)));
  const planLegs = planner === 'grid'
    ? (gridRoute ? gridRoute.legs.filter(l => l.type === 'walk') : [])
    : (routeResult ? routeResult.steps.reduce((legs, st) => {
      const last = legs[legs.length - 1];
      if (last && last.levelId === st.levelId) last.points.push(st.position);
      else legs.push({ levelId: st.levelId, points: [st.position] });
      return legs;
    }, []) : []);
  const planTransitions = [];
  if (planner === 'grid' && gridRoute) {
    gridRoute.legs.forEach((l, i) => {
      if (l.type === 'walk') return;
      const prev = gridRoute.legs[i - 1], next = gridRoute.legs[i + 1];
      const up = building && building.levels.find(x => x.id === l.toLevelId)?.floorY > building.levels.find(x => x.id === l.fromLevelId)?.floorY;
      if (prev && prev.points) { const q = prev.points[prev.points.length - 1]; planTransitions.push({ levelId: prev.levelId, x: q[0], z: q[2], up }); }
      if (next && next.points) { const q = next.points[0]; planTransitions.push({ levelId: next.levelId, x: q[0], z: q[2], up: !up }); }
    });
  }
  const planTools = workspace === 'simulate'
    ? [PLAN_TOOLS[0], { id: 'mission', label: 'Mission', icon: 'Robot', title: 'Click a start and then a goal to add a robot mission' }, PLAN_TOOLS[3], PLAN_TOOLS[4]]
    : PLAN_TOOLS;
  const planElement = model ? (
    <PlanView
      model={model}
      building={building}
      navState={navState}
      levelId={planLevelId}
      onLevelChange={(id) => { setPlanLevel(Number(id)); if (levelId !== 'all') onLevelChange(String(id), { frame: false }); }}
      theme={theme}
      tool={clickMode}
      setTool={(t) => { nav.setClickMode(t); if (t !== 'mission') setPendingMission(null); }}
      tools={planTools}
      onMapPick={onMapPick}
      onSelectElement={(id, e) => (id == null ? dispatch({ type: 'clear-selection' }) : dispatch({ type: 'select', ids: [id], multi: !!(e && (e.ctrlKey || e.metaKey || e.shiftKey)) }))}
      layoutSwitch={viewLayout === 'plan' ? layoutSwitch : null}
      workspace={workspace}
      selectedIds={viewerState.selectedIds}
      blocked={blocked}
      obstacles={obstacles}
      zones={workspace === 'navigate' || (workspace === 'simulate' && simApi.sim.current && simApi.sim.current.scenario.applyZones) ? zones : []}
      pendingZone={workspace === 'navigate' ? pendingZone : null}
      routeLegs={workspace === 'navigate' ? planLegs : []}
      routeTransitions={workspace === 'navigate' ? planTransitions : []}
      start={workspace === 'navigate' ? startPt : null}
      goal={workspace === 'navigate' ? goalPt : null}
      missions={workspace === 'simulate' ? missions : []}
      missionPaths={workspace === 'simulate' ? missionPaths : []}
      pendingMission={workspace === 'simulate' ? pendingMission : null}
      cellInfo={cellInfo}
      sim={workspace === 'simulate' ? simApi.sim.current : null}
      simRunning={workspace === 'simulate' && simApi.status === 'running'}
      simStatus={simApi.status}
    />
  ) : null;

  const bodyStyle = {
    '--left-w': `${layout.left}px`,
    '--right-w': `${layout.right}px`,
    '--bottom-h': layout.bottomCollapsed ? '40px' : `${layout.bottom}px`,
  };

  return (
    <div className="app" data-has-model={!!model}>
      <TopBar
        model={model}
        workspace={workspace}
        onWorkspace={onWorkspace}
        onUpload={onUpload}
        onLoadSample={loadSample}
        onClose={onCloseModel}
        onSearch={onSearch}
        onOpenIntel={() => setModal('intel')}
        onOpenSchema={() => { setShowHome(false); setWorkspace('explore'); setLeftTab('schema'); }}
        onHome={() => setShowHome(true)}
        onOpenHelp={() => setModal('help')}
        theme={theme}
        onToggleTheme={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
        searchRef={searchRef}
      />
      <input ref={fileInputRef} type="file" accept=".ifc" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; await loadIfcFile(f); }} />

      <div className="app-body" ref={bodyRef} style={bodyStyle} data-collapsed={layout.bottomCollapsed}>
        {model && (
          <>
            <div className="resize-handle rh-left" role="separator" aria-orientation="vertical" aria-label="Resize left panel" onPointerDown={e => startResize('left', e)} />
            <div className="resize-handle rh-right" role="separator" aria-orientation="vertical" aria-label="Resize inspector" onPointerDown={e => startResize('right', e)} />
            {!layout.bottomCollapsed && <div className="resize-handle rh-bottom" role="separator" aria-orientation="horizontal" aria-label="Resize bottom panel" onPointerDown={e => startResize('bottom', e)} onDoubleClick={() => setLayout(l => ({ ...l, bottom: DEFAULT_LAYOUT.bottom }))} />}
          </>
        )}

        {workspace === 'navigate' ? (
          <NavigatePanel model={model} building={building} readiness={readiness} nav={nav} route={routeResult} gridRoute={gridRoute} navState={navState} gridInfo={gridInfo} onSelectIds={selectAndShow} onZoomTo={onZoomTo} onFrameRoute={onFrameRoute} />
        ) : workspace === 'simulate' ? (
          <SimulatePanel model={model} building={building} navMap={navMap} nav={nav} simApi={simApi} onSelectIds={selectAndShow} onFrameAt={onFrameAt}
            missions={missions} removeMission={(id) => setMissions(list => list.filter(m => m.id !== id))} clearMissions={() => { setMissions([]); setPendingMission(null); }}
            pendingMission={pendingMission} pickingMission={clickMode === 'mission'}
            simRequest={simRequest} onRequestHandled={() => setSimRequest(null)}
            onPickMission={() => { if (clickMode === 'mission') { setClickMode('select'); setPendingMission(null); return; } setClickMode('mission'); if (viewLayout === '3d') setViewLayout('split'); }} theme={theme} />
        ) : (
          <LeftSidebar model={model} viewerState={viewerState} dispatch={dispatch} onPick={onPick} onZoomTo={onZoomTo} onContext={onContext} onSaveView={onSaveView} onRestoreView={onRestoreView} tab={leftTab} setTab={setLeftTab} />
        )}

        <ViewerCanvas
          model={model} viewerRef={viewerRef} viewerState={viewerState} dispatch={dispatch} toast={toast} theme={theme}
          viewMode={viewMode} setViewMode={setViewMode} showEdges={showEdges} setShowEdges={setShowEdges}
          showAxes={showAxes} setShowAxes={setShowAxes} showSpaces={showSpaces} setShowSpaces={setShowSpaces}
          explode={explode} setExplode={setExplode}
          sectionEnabled={sectionEnabled} toggleSection={toggleSection} sectionBox={sectionBox} setSectionBox={setSectionBox}
          measureMode={measureMode} toggleMeasure={toggleMeasure} annoMode={annoMode} toggleAnno={toggleAnno}
          levelId={levelId} onLevelChange={onLevelChange} planCut={planCut} togglePlanCut={togglePlanCut}
          slabsTransparent={slabsTransparent} onToggleSlabs={onToggleSlabs} onFocusGroup={onFocusGroup} onResetFilters={onResetFilters}
          onPickEvent={onPickEvent} onContextEvent={onContextEvent} workspace={workspace} building={building}
          layout={viewLayout} layoutSwitch={layoutSwitch} planElement={planElement}
          hint={clickMode === 'start' ? 'Click the floor grid or the plan to place the route start. Esc to stop.'
            : clickMode === 'goal' ? 'Click the floor grid or the plan to place the route goal. Esc to stop.'
            : clickMode === 'mission' ? (pendingMission ? 'Now click the mission goal.' : 'Click a mission start on the floor grid or the plan.')
            : workspace === 'navigate'
            ? (clickMode === 'inspect' ? 'Click a grid cell to see which IFC element and step decided it. Esc to stop.'
              : clickMode === 'obstacle' ? 'Click the grid to place or remove a what-if obstacle. Esc to stop.'
              : /^zone-/.test(clickMode) ? (pendingZone ? 'Now click the opposite corner of the zone.' : `Click one corner of the ${clickMode === 'zone-nogo' ? 'no-go' : 'slow'} zone. Esc to stop.`)
              : planner === 'graph' ? 'Click a graph node to inspect the IFC element it came from.' : null)
            : workspace === 'simulate' && simApi.status === 'running' ? `Simulating at ${simApi.speed}× speed` : null}
        />

        <Inspector model={model} building={building} nav={nav} viewerState={viewerState} dispatch={dispatch} onZoomTo={onZoomTo} toast={toast} onSelect={(id) => dispatch({ type: 'select', ids: [id] })} />

        <BottomPanel
          model={model} viewerState={viewerState} dispatch={dispatch} log={log} onPick={onPick} onZoomTo={onZoomTo} toast={toast}
          collapsed={layout.bottomCollapsed} onToggleCollapsed={toggleBottom} viewerRef={viewerRef} secondaryReady={secondaryReady}
        />

        {(!model || showHome) && !loading && <StartScreen onUpload={onUpload} onLoadFile={loadIfcFile} onLoadSample={loadSample} currentModel={model} onResume={() => setShowHome(false)} />}
        {loading && <LoadingOverlay fileName={loading.fileName} progress={loading.progress} phase={loading.phase} log={log} />}
      </div>

      {modal === 'intel' && model && (
        <IntelligenceDashboard model={model} building={building} readiness={readiness} onClose={() => setModal(null)} onSelectIds={(ids) => { selectAndShow(ids); setModal(null); }} onOpenNavigate={() => { setModal(null); onWorkspace('navigate'); }} />
      )}
      {modal === 'help' && <HelpPanel onClose={() => setModal(null)} />}
      {model && <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} dispatch={dispatch} onZoomTo={onZoomTo} model={model} toast={toast} nav={nav} />}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
