(() => {
  const SAMPLES = [
    {
      id: "large-building",
      name: "Office blocks",
      file: "LargeBuilding.ifc",
      url: "assets/ifc/LargeBuilding.ifc",
      size: "1.3 MB",
      facts: "2 storeys, 8 rooms, 18 doors, furniture",
      credit: "BIM Whale samples by Andr\xE9 Wis\xE9n, MIT licence",
      creditUrl: "https://github.com/andrewisen/bim-whale-ifc-samples",
      bundled: true
    },
    {
      id: "duplex",
      name: "Duplex apartment",
      file: "Duplex_Architecture.ifc",
      url: "https://raw.githubusercontent.com/youshengCode/IfcSampleFiles/main/Ifc2x3_Duplex_Architecture.ifc",
      size: "2.3 MB",
      facts: "2 units over 2 storeys, 21 rooms, stairs, space boundaries",
      credit: "Common BIM Files (NIBS, US Army ERDC), loaded from a public GitHub mirror",
      creditUrl: "https://github.com/youshengCode/IfcSampleFiles",
      bundled: false
    },
    {
      id: "research-centre",
      name: "Research centre with lift",
      file: "ResearchCentre.ifc",
      url: "assets/ifc/ResearchCentre.ifc",
      size: "0.8 MB",
      facts: "4 storeys, 56 rooms, 53 doors, a lift to every floor and a stair core",
      credit: "Made for BIM2Bot Lab (IFC4), MIT licence",
      creditUrl: "https://github.com/isaddiq/BIM2Bot-Lab/blob/main/LICENSE",
      bundled: true,
      downloadable: true
    }
  ];
  const SOURCE_REPO_URL = "https://github.com/isaddiq/BIM2Bot-Lab";
  const AUTHOR_URL = "https://isaddiq.github.io/";
  const SLAB_CLASSES = ["IfcSlab", "IfcSlabStandardCase", "IfcSlabElementedCase", "IfcCovering", "IfcRoof"];
  const uid = () => Math.random().toString(36).slice(2, 9);
  function viewerStateReducer(state, action) {
    switch (action.type) {
      case "select": {
        const ids = action.ids || [];
        if (action.multi) {
          const ns = new Set(state.selectedIds);
          ids.forEach((id) => {
            ns.has(id) ? ns.delete(id) : ns.add(id);
          });
          return { ...state, selectedIds: ns };
        }
        return { ...state, selectedIds: new Set(ids) };
      }
      case "clear-selection":
        return state.selectedIds.size ? { ...state, selectedIds: /* @__PURE__ */ new Set() } : state;
      case "toggle-hide": {
        const ns = new Set(state.hiddenIds);
        const allHidden = action.ids.length > 0 && action.ids.every((id) => ns.has(id));
        action.ids.forEach((id) => {
          allHidden ? ns.delete(id) : ns.add(id);
        });
        return { ...state, hiddenIds: ns };
      }
      case "show-all":
        return { ...state, hiddenIds: /* @__PURE__ */ new Set(), isolatedIds: /* @__PURE__ */ new Set() };
      case "isolate": {
        const ns = new Set(action.ids);
        if (!action.force && state.isolatedIds.size === ns.size && [...ns].every((i) => state.isolatedIds.has(i))) {
          return { ...state, isolatedIds: /* @__PURE__ */ new Set() };
        }
        return { ...state, isolatedIds: ns };
      }
      case "set-color": {
        const m = new Map(state.colorOverrides);
        if (action.color) m.set(action.id, action.color);
        else m.delete(action.id);
        return { ...state, colorOverrides: m };
      }
      case "set-opacity-many": {
        const m = new Map(state.opacityOverrides);
        (action.ids || []).forEach((id) => {
          if (action.opacity != null) m.set(id, action.opacity);
          else m.delete(id);
        });
        return { ...state, opacityOverrides: m };
      }
      case "set-query":
        return { ...state, queryResults: action.ids, queryMatchText: action.match || {} };
      case "clear-query":
        return { ...state, queryResults: [], queryMatchText: {} };
      case "save-view": {
        const view = {
          id: uid(),
          name: action.name || `View ${state.savedViews.length + 1}`,
          timestamp: (/* @__PURE__ */ new Date()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          camera: action.camera,
          hiddenIds: [...state.hiddenIds],
          isolatedIds: [...state.isolatedIds]
        };
        return { ...state, savedViews: [...state.savedViews, view] };
      }
      case "restore-view":
        return { ...state, hiddenIds: new Set(action.view.hiddenIds), isolatedIds: new Set(action.view.isolatedIds) };
      case "delete-view":
        return { ...state, savedViews: state.savedViews.filter((v) => v.id !== action.id) };
      case "save-set":
        return { ...state, selectionSets: [...state.selectionSets, { id: uid(), name: action.name || `Set ${state.selectionSets.length + 1}`, ids: [...state.selectedIds] }] };
      case "restore-set": {
        const s = state.selectionSets.find((x) => x.id === action.id);
        return s ? { ...state, selectedIds: new Set(s.ids) } : state;
      }
      case "delete-set":
        return { ...state, selectionSets: state.selectionSets.filter((s) => s.id !== action.id) };
      case "add-anno":
        return { ...state, annotations: [...state.annotations, action.anno] };
      case "delete-anno":
        return { ...state, annotations: state.annotations.filter((a) => a.id !== action.id) };
      case "update-anno":
        return { ...state, annotations: state.annotations.map((a) => a.id === action.id ? { ...a, ...action.patch } : a) };
      case "add-measure":
        return { ...state, measurements: [...state.measurements, action.measure] };
      case "delete-measure":
        return { ...state, measurements: state.measurements.filter((m) => m.id !== action.id) };
      case "clear-measures":
        return { ...state, measurements: [] };
      case "reset":
        return initialViewerState();
      default:
        return state;
    }
  }
  function initialViewerState() {
    return {
      selectedIds: /* @__PURE__ */ new Set(),
      hiddenIds: /* @__PURE__ */ new Set(),
      isolatedIds: /* @__PURE__ */ new Set(),
      colorOverrides: /* @__PURE__ */ new Map(),
      opacityOverrides: /* @__PURE__ */ new Map(),
      queryResults: [],
      queryMatchText: {},
      savedViews: [],
      selectionSets: [],
      annotations: [],
      measurements: []
    };
  }
  const STORAGE = { layout: "bim2bot-layout-v2", theme: "bim2bot-theme", layoutMode: "bim2bot-view-layout" };
  const EMPTY_ROUTE = { startId: null, goalId: null, startPoint: null, goalPoint: null };
  const DEFAULT_LAYOUT = { left: 344, right: 360, bottom: 220, bottomCollapsed: false };
  function clamp(v, min, max) {
    return Math.min(Math.max(v, min), max);
  }
  function readStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
    }
  }
  function initialLayout() {
    try {
      const p = JSON.parse(readStorage(STORAGE.layout) || "null");
      if (!p) return DEFAULT_LAYOUT;
      return {
        left: clamp(Number(p.left) || DEFAULT_LAYOUT.left, 240, 520),
        right: clamp(Number(p.right) || DEFAULT_LAYOUT.right, 280, 620),
        bottom: clamp(Number(p.bottom) || DEFAULT_LAYOUT.bottom, 120, 480),
        bottomCollapsed: !!p.bottomCollapsed
      };
    } catch (e) {
      return DEFAULT_LAYOUT;
    }
  }
  function initialTheme() {
    const saved = readStorage(STORAGE.theme);
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  function runQuery(model, q) {
    const query = q.trim();
    if (!query) return { ids: [], match: {} };
    const lower = query.toLowerCase();
    const ids = [];
    const matchText = {};
    const colon = query.indexOf(":");
    const key = colon > 0 && colon < query.length - 1 ? query.slice(0, colon).trim().toLowerCase() : null;
    const val = key ? query.slice(colon + 1).trim().toLowerCase() : null;
    const exprMatch = /^[#@](\d+)$/.exec(query);
    const findProp = (sets, suffix) => {
      for (const ps of sets) for (const p of ps.properties) {
        if (p.name.toLowerCase() === key && String(p.value).toLowerCase().includes(val)) return `${ps.name}.${p.name} = ${p.value}${suffix}`;
      }
      return null;
    };
    model.elements.forEach((el) => {
      if (el.isType) return;
      let m = null;
      if (exprMatch) {
        if (String(el.expressId) === exprMatch[1]) m = `Express ID #${el.expressId}`;
      } else if (key) {
        m = findProp(el.propertySets, "") || findProp(el.quantitySets, "");
        const t = !m && el.typeExpressId ? model.byId.get(el.typeExpressId) : null;
        if (t) m = findProp(t.propertySets, " (type)");
      } else if (el.ifcClass.toLowerCase().includes(lower)) m = `Class ${el.ifcClass}`;
      else if ((el.name || "").toLowerCase().includes(lower)) m = `Name ${el.name}`;
      else if ((el.longName || "").toLowerCase().includes(lower)) m = `Long name ${el.longName}`;
      else if ((el.globalId || "").toLowerCase().includes(lower)) m = `GlobalId ${el.globalId}`;
      else if ((el.objectType || "").toLowerCase().includes(lower)) m = `Object type ${el.objectType}`;
      else if ((el.tag || "").toLowerCase().includes(lower)) m = `Tag ${el.tag}`;
      else if (el.storey && (el.storey.name || "").toLowerCase().includes(lower)) m = `Storey ${el.storey.name}`;
      else if (el.materials.some((x) => x.name.toLowerCase().includes(lower))) m = `Material ${el.materials.find((x) => x.name.toLowerCase().includes(lower)).name}`;
      else if (el.classifications.some((c) => (c.code + " " + c.name).toLowerCase().includes(lower))) m = "Classification";
      if (m) {
        ids.push(el.expressId);
        matchText[el.expressId] = m;
      }
    });
    return { ids, match: matchText };
  }
  const SEARCH_EXAMPLES = [
    ["IfcDoor", "every element of a class"],
    ["Bedroom", "names, long names, tags"],
    ["#1234", "an express ID"],
    ["IsExternal:true", "a property value (inspected elements)"]
  ];
  function BrandMark({ size = 28 }) {
    return /* @__PURE__ */ React.createElement("svg", { className: "brand-mark", width: size, height: size, viewBox: "0 0 32 32", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("path", { d: "M16 3.5 27.5 10v12L16 28.5 4.5 22V10Z", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinejoin: "round" }), /* @__PURE__ */ React.createElement("path", { d: "M4.5 10 16 16.5 27.5 10M16 16.5v12", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinejoin: "round", opacity: "0.55" }), /* @__PURE__ */ React.createElement("path", { className: "brand-route", d: "M9 18.5 16 22l6.5-3.6V13", fill: "none", strokeWidth: "2.2", strokeLinecap: "round", strokeLinejoin: "round" }), /* @__PURE__ */ React.createElement("circle", { className: "brand-node", cx: "9", cy: "18.5", r: "2.1" }), /* @__PURE__ */ React.createElement("circle", { className: "brand-node", cx: "22.5", cy: "13", r: "2.1" }));
  }
  const WORKSPACES = [
    { id: "explore", label: "Explore", sub: "IFC model", icon: "Cube" },
    { id: "navigate", label: "Navigate", sub: "Grids and routes", icon: "Route" },
    { id: "simulate", label: "Simulate", sub: "Robot fleets", icon: "Robot" }
  ];
  function WorkspaceSwitch({ value, onChange, disabled }) {
    return /* @__PURE__ */ React.createElement("nav", { className: "ws-switch", "aria-label": "Workspace" }, WORKSPACES.map((w, i) => {
      const Icon = Icons[w.icon];
      return /* @__PURE__ */ React.createElement(React.Fragment, { key: w.id }, i > 0 && /* @__PURE__ */ React.createElement("span", { className: "ws-link", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement(Icons.ChevronRight, { size: 14 })), /* @__PURE__ */ React.createElement(
        "button",
        {
          type: "button",
          className: "ws-btn",
          "aria-current": value === w.id ? "page" : void 0,
          disabled: w.disabled || disabled && w.id !== "explore",
          title: `${w.label}: ${w.sub}`,
          onClick: () => onChange(w.id)
        },
        /* @__PURE__ */ React.createElement("span", { className: "ws-icon" }, /* @__PURE__ */ React.createElement(Icon, { size: 15 })),
        /* @__PURE__ */ React.createElement("span", { className: "ws-text" }, /* @__PURE__ */ React.createElement("span", { className: "ws-label" }, w.label), /* @__PURE__ */ React.createElement("span", { className: "ws-sub" }, w.sub))
      ));
    }));
  }
  function TopBar({ model, workspace, onWorkspace, onUpload, onLoadSample, onClose, onSearch, onOpenIntel, onOpenHelp, theme, onToggleTheme, searchRef, onHome }) {
    const [q, setQ] = useState("");
    const [focused, setFocused] = useState(false);
    const [menu, setMenu] = useState(false);
    const menuRef = useRef(null);
    useEffect(() => {
      if (!menu) return;
      const close = (e) => {
        var _a;
        if (!((_a = menuRef.current) == null ? void 0 : _a.contains(e.target))) setMenu(false);
      };
      const esc = (e) => {
        if (e.key === "Escape") setMenu(false);
      };
      window.addEventListener("pointerdown", close);
      window.addEventListener("keydown", esc);
      return () => {
        window.removeEventListener("pointerdown", close);
        window.removeEventListener("keydown", esc);
      };
    }, [menu]);
    const submit = (value) => {
      setQ(value);
      onSearch(value);
    };
    return /* @__PURE__ */ React.createElement("header", { className: "topbar" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "brand", onClick: onHome, "aria-label": "BIM2Bot Lab start page", title: "Start page" }, /* @__PURE__ */ React.createElement(BrandMark, null), /* @__PURE__ */ React.createElement("span", { className: "brand-name" }, "BIM", /* @__PURE__ */ React.createElement("span", { className: "brand-two" }, "2"), "Bot ", /* @__PURE__ */ React.createElement("span", { className: "brand-lab" }, "Lab"))), /* @__PURE__ */ React.createElement(WorkspaceSwitch, { value: workspace, onChange: onWorkspace, disabled: !model }), model && /* @__PURE__ */ React.createElement("div", { className: "file-chip", title: `${model.fileName} \xB7 ${formatSize(model.fileSize)}` }, /* @__PURE__ */ React.createElement(Icons.Building, { size: 15 }), /* @__PURE__ */ React.createElement("span", { className: "file-name" }, model.fileName), /* @__PURE__ */ React.createElement("span", { className: "file-meta mono" }, model.schemaVersion), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.X, label: "Close model", size: 13, className: "sm", onClick: onClose })), /* @__PURE__ */ React.createElement("div", { className: "topbar-spacer" }), /* @__PURE__ */ React.createElement("div", { className: "search", "data-disabled": !model }, /* @__PURE__ */ React.createElement(Icons.Search, { size: 15 }), /* @__PURE__ */ React.createElement(
      "input",
      {
        ref: searchRef,
        type: "search",
        "aria-label": "Search the model",
        placeholder: "Search classes, names, GlobalIds\u2026",
        value: q,
        disabled: !model,
        onFocus: () => setFocused(true),
        onBlur: () => setTimeout(() => setFocused(false), 150),
        onChange: (e) => setQ(e.target.value),
        onKeyDown: (e) => {
          if (e.key === "Enter") onSearch(q);
          if (e.key === "Escape") {
            setQ("");
            onSearch("");
            e.currentTarget.blur();
          }
        }
      }
    ), q ? /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.X, label: "Clear search", size: 13, className: "sm", onClick: () => submit("") }) : /* @__PURE__ */ React.createElement("kbd", null, "Ctrl K"), focused && !q && model && /* @__PURE__ */ React.createElement("div", { className: "search-hints", role: "listbox", "aria-label": "Search examples" }, SEARCH_EXAMPLES.map(([ex, what]) => /* @__PURE__ */ React.createElement("button", { key: ex, type: "button", role: "option", onMouseDown: (e) => {
      e.preventDefault();
      submit(ex);
    } }, /* @__PURE__ */ React.createElement("code", null, ex), /* @__PURE__ */ React.createElement("span", null, what))))), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-primary", onClick: onUpload }, /* @__PURE__ */ React.createElement(Icons.Upload, { size: 15 }), " Open IFC"), /* @__PURE__ */ React.createElement("div", { className: "topbar-tools" }, /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Dashboard, label: "Building intelligence", disabled: !model, onClick: onOpenIntel }), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Activity, label: "Visitor statistics", "aria-controls": "vc-popover", onClick: () => {
      var _a;
      return (_a = document.getElementById("vc-popover")) == null ? void 0 : _a.classList.toggle("vc-open");
    } }), /* @__PURE__ */ React.createElement(IconButton, { icon: theme === "dark" ? Icons.Sun : Icons.Moon, label: theme === "dark" ? "Use light theme" : "Use dark theme", onClick: onToggleTheme }), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Help, label: "Shortcuts and help", shortcut: "?", onClick: onOpenHelp }), /* @__PURE__ */ React.createElement("div", { className: "menu-anchor", ref: menuRef }, /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.More, label: "More", "aria-haspopup": "menu", "aria-expanded": menu, onClick: () => setMenu((v) => !v) }), menu && /* @__PURE__ */ React.createElement("div", { className: "menu", role: "menu" }, SAMPLES.map((smp) => /* @__PURE__ */ React.createElement("button", { key: smp.id, type: "button", role: "menuitem", onClick: () => {
      setMenu(false);
      onLoadSample(smp);
    } }, /* @__PURE__ */ React.createElement(Icons.Cube, { size: 15 }), " Open sample: ", smp.name)), /* @__PURE__ */ React.createElement("div", { className: "menu-sep" }), /* @__PURE__ */ React.createElement("a", { role: "menuitem", href: SOURCE_REPO_URL, target: "_blank", rel: "noopener noreferrer" }, /* @__PURE__ */ React.createElement(Icons.Github, { size: 15 }), " Source code ", /* @__PURE__ */ React.createElement(Icons.External, { size: 12, className: "trail" })), /* @__PURE__ */ React.createElement("a", { role: "menuitem", href: AUTHOR_URL, target: "_blank", rel: "noopener noreferrer" }, /* @__PURE__ */ React.createElement(Icons.Globe, { size: 15 }), " Author ", /* @__PURE__ */ React.createElement(Icons.External, { size: 12, className: "trail" }))))));
  }
  function NavCubeHost({ viewerRef, ready, theme }) {
    const hostRef = useRef(null);
    const cubeRef = useRef(null);
    useEffect(() => {
      if (!ready || !viewerRef.current || !hostRef.current) return;
      cubeRef.current = new NavCube(hostRef.current, viewerRef.current, { theme });
      return () => {
        cubeRef.current && cubeRef.current.dispose();
        cubeRef.current = null;
      };
    }, [ready]);
    useEffect(() => {
      cubeRef.current && cubeRef.current.setTheme(theme);
    }, [theme]);
    const v = viewerRef.current;
    return /* @__PURE__ */ React.createElement("div", { className: "navcube" }, /* @__PURE__ */ React.createElement("div", { className: "navcube-host", ref: hostRef }), /* @__PURE__ */ React.createElement("div", { className: "navcube-actions" }, /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Home, label: "Fit model, isometric view", size: 15, onClick: () => v == null ? void 0 : v.frameAll({ resetView: true }) }), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.PlanCut, label: "Top view", size: 15, onClick: () => v == null ? void 0 : v.setCameraPreset("top") }), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Plus, label: "Zoom in", size: 15, onClick: () => v == null ? void 0 : v.zoomIn() }), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Minus, label: "Zoom out", size: 15, onClick: () => v == null ? void 0 : v.zoomOut() })));
  }
  function SectionBoxControls({ box, bounds, onChange, onReset, onClose }) {
    const size = { x: Math.max(bounds.xMax - bounds.xMin, 1e-3), y: Math.max(bounds.yMax - bounds.yMin, 1e-3), z: Math.max(bounds.zMax - bounds.zMin, 1e-3) };
    const sides = [
      { k: "left", label: "Left", axis: "x", edge: "min", opp: "right" },
      { k: "right", label: "Right", axis: "x", edge: "max", opp: "left" },
      { k: "bottom", label: "Bottom", axis: "y", edge: "min", opp: "top" },
      { k: "top", label: "Top", axis: "y", edge: "max", opp: "bottom" },
      { k: "back", label: "Back", axis: "z", edge: "min", opp: "front" },
      { k: "front", label: "Front", axis: "z", edge: "max", opp: "back" }
    ];
    const cut = (s) => (s.edge === "min" ? box[`${s.axis}Min`] - bounds[`${s.axis}Min`] : bounds[`${s.axis}Max`] - box[`${s.axis}Max`]) / size[s.axis];
    const update = (s, raw) => {
      const opp = sides.find((o) => o.k === s.opp);
      const c = clamp((parseFloat(raw) || 0) / 100, 0, Math.max(0, 0.96 - cut(opp)));
      const next = { ...box };
      if (s.edge === "min") next[`${s.axis}Min`] = bounds[`${s.axis}Min`] + size[s.axis] * c;
      else next[`${s.axis}Max`] = bounds[`${s.axis}Max`] - size[s.axis] * c;
      onChange(next);
    };
    return /* @__PURE__ */ React.createElement("div", { className: "hud-card section-card" }, /* @__PURE__ */ React.createElement("div", { className: "hud-card-head" }, /* @__PURE__ */ React.createElement("span", null, "Section box"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-ghost btn-sm", onClick: onReset }, "Reset"), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.X, label: "Close section box", size: 13, className: "sm", onClick: onClose })), /* @__PURE__ */ React.createElement("p", { className: "hud-hint" }, "Drag a face of the box in the view, or trim each side here."), sides.map((s) => {
      const pct = Math.round(cut(s) * 100);
      return /* @__PURE__ */ React.createElement("label", { className: "slider-row", key: s.k }, /* @__PURE__ */ React.createElement("span", null, s.label), /* @__PURE__ */ React.createElement("input", { type: "range", min: "0", max: "95", step: "1", value: pct, onChange: (e) => update(s, e.target.value) }), /* @__PURE__ */ React.createElement("span", { className: "mono" }, pct, "%"));
    }));
  }
  function ViewerCanvas(props) {
    var _a;
    const {
      model,
      viewerRef,
      viewerState,
      dispatch,
      toast,
      theme,
      viewMode,
      setViewMode,
      showEdges,
      setShowEdges,
      showAxes,
      setShowAxes,
      showSpaces,
      setShowSpaces,
      explode,
      setExplode,
      sectionEnabled,
      toggleSection,
      sectionBox,
      setSectionBox,
      measureMode,
      toggleMeasure,
      annoMode,
      toggleAnno,
      levelId,
      onLevelChange,
      planCut,
      togglePlanCut,
      slabsTransparent,
      onToggleSlabs,
      onFocusGroup,
      onResetFilters,
      onPickEvent,
      onContextEvent,
      workspace,
      building,
      hint,
      layout,
      layoutSwitch,
      planElement
    } = props;
    const hostRef = useRef(null);
    const [ready, setReady] = useState(false);
    const [modelBounds, setModelBounds] = useState(null);
    const [hover, setHover] = useState(null);
    const [, setFrame] = useState(0);
    const handlers = useRef({});
    handlers.current = { onPickEvent, onContextEvent, dispatch, toast };
    const hasLabels = useRef(false);
    hasLabels.current = viewerState.annotations.length + viewerState.measurements.length > 0;
    useEffect(() => {
      const v2 = new ThreeViewer(hostRef.current);
      viewerRef.current = v2;
      window.__viewer = v2;
      const offs = [
        v2.on("pick", (e) => handlers.current.onPickEvent(e)),
        v2.on("context", (e) => handlers.current.onContextEvent(e)),
        v2.on("hover", (e) => setHover(e.expressId != null && e.x != null ? e : null)),
        v2.on("measure", (m) => {
          handlers.current.dispatch({ type: "add-measure", measure: { id: m.id, a: m.a.toArray(), b: m.b.toArray(), distance: m.distance, dx: m.dx, dy: m.dy, dz: m.dz } });
          handlers.current.toast({ kind: "ok", msg: `Measured ${m.distance.toFixed(3)} m`, sub: "Listed under Markup" });
        }),
        v2.on("sectionBox", ({ box }) => setSectionBox(box)),
        v2.on("anno", (e) => {
          handlers.current.dispatch({ type: "add-anno", anno: { id: uid(), position: e.position.toArray(), elementId: e.elementId, title: "New issue", description: "", status: "open", priority: "medium", timestamp: (/* @__PURE__ */ new Date()).toLocaleString() } });
          handlers.current.toast({ kind: "info", msg: "Issue pinned", sub: "Edit it under Markup" });
        }),
        v2.on("camera", () => {
          if (hasLabels.current) setFrame((f) => (f + 1) % 1e6);
        })
      ];
      setReady(true);
      return () => {
        offs.forEach((off) => off());
        v2.dispose();
        viewerRef.current = null;
        window.__viewer = null;
      };
    }, []);
    useEffect(() => {
      const v2 = viewerRef.current;
      if (!v2) return;
      if (!model) {
        v2.clearModel();
        setModelBounds(null);
        return;
      }
      let cancelled = false;
      setModelBounds(null);
      v2.loadModel(model).then(() => {
        if (!cancelled) setModelBounds(v2.getModelBounds());
      });
      return () => {
        cancelled = true;
      };
    }, [model]);
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setSelection(viewerState.selectedIds);
    }, [viewerState.selectedIds, modelBounds]);
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setHidden(viewerState.hiddenIds);
    }, [viewerState.hiddenIds, modelBounds]);
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setIsolated(viewerState.isolatedIds);
    }, [viewerState.isolatedIds, modelBounds]);
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setColorOverrides(viewerState.colorOverrides);
    }, [viewerState.colorOverrides, modelBounds]);
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setOpacityOverrides(viewerState.opacityOverrides);
    }, [viewerState.opacityOverrides, modelBounds]);
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setViewMode(viewMode);
    }, [viewMode, modelBounds]);
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setShowEdges(showEdges);
    }, [showEdges, modelBounds]);
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setShowAxes(showAxes);
    }, [showAxes]);
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setSpacesVisible(showSpaces);
    }, [showSpaces, modelBounds]);
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setExplode(explode);
    }, [explode, modelBounds]);
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setSectionBox(sectionEnabled, sectionBox, modelBounds);
    }, [sectionEnabled, sectionBox, modelBounds]);
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setPlanCut(planCut);
    }, [planCut, modelBounds]);
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setMeasureMode(measureMode);
    }, [measureMode]);
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setAnnotationMode(annoMode);
    }, [annoMode]);
    useEffect(() => {
      var _a2;
      (_a2 = viewerRef.current) == null ? void 0 : _a2.setTheme(theme);
    }, [theme]);
    const v = viewerRef.current;
    const project = (arr) => v ? v.worldToScreen(new THREE.Vector3().fromArray(arr)) : { behind: true };
    const hoverEl = hover && model ? model.byId.get(hover.expressId) : null;
    const hostRect = (_a = hostRef.current) == null ? void 0 : _a.getBoundingClientRect();
    const toolHint = measureMode ? "Click two points to measure. Esc to stop." : annoMode ? "Click an element to pin an issue. Esc to stop." : planCut.enabled ? "Plan cut: geometry above the level is hidden." : null;
    const sel = viewerState.selectedIds.size > 0;
    return /* @__PURE__ */ React.createElement("div", { className: "viewer-region", "data-layout": model ? layout : "3d" }, /* @__PURE__ */ React.createElement("div", { className: "viewer-wrap", ref: hostRef, "data-workspace": workspace }, model && /* @__PURE__ */ React.createElement("div", { className: "hud" }, /* @__PURE__ */ React.createElement("div", { className: "viewbar", role: "toolbar", "aria-label": "View" }, /* @__PURE__ */ React.createElement("label", { className: "quick-select" }, /* @__PURE__ */ React.createElement(Icons.Layers, { size: 15 }), /* @__PURE__ */ React.createElement("select", { "aria-label": "Level", value: levelId, onChange: (e) => onLevelChange(e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "all" }, "All levels"), model.storeys.map((s) => /* @__PURE__ */ React.createElement("option", { key: s.expressId, value: s.expressId }, s.name || s.longName || `Storey #${s.expressId}`)))), /* @__PURE__ */ React.createElement("button", { type: "button", className: "chip-btn", "aria-pressed": planCut.enabled, disabled: levelId === "all", title: levelId === "all" ? "Choose a level to cut a floor plan" : "Cut the model 1.2 m above the floor", onClick: togglePlanCut }, /* @__PURE__ */ React.createElement(Icons.PlanCut, { size: 15 }), /* @__PURE__ */ React.createElement("span", null, "Cut")), /* @__PURE__ */ React.createElement("span", { className: "quick-sep" }), layoutSwitch), /* @__PURE__ */ React.createElement(NavCubeHost, { viewerRef, ready, theme }), (toolHint || hint) && /* @__PURE__ */ React.createElement("div", { className: "status-chip", role: "status" }, /* @__PURE__ */ React.createElement("span", { className: "dot", "data-tone": workspace === "explore" ? "accent" : "signal" }), toolHint || hint), sectionEnabled && modelBounds && sectionBox && /* @__PURE__ */ React.createElement(SectionBoxControls, { box: sectionBox, bounds: modelBounds, onChange: setSectionBox, onReset: () => setSectionBox({ ...modelBounds }), onClose: toggleSection }), viewerState.measurements.map((m) => {
      const mid = m.a.map((x, i) => (x + m.b[i]) / 2);
      const s = project(mid);
      return s.behind ? null : /* @__PURE__ */ React.createElement("div", { key: m.id, className: "measure-label mono", style: { left: s.x, top: s.y } }, m.distance.toFixed(2), " m");
    }), viewerState.annotations.map((a, i) => {
      const s = project(a.position);
      return s.behind ? null : /* @__PURE__ */ React.createElement("button", { key: a.id, type: "button", className: "anno-pin", "data-status": a.status, style: { left: s.x, top: s.y }, title: a.title, onClick: () => a.elementId != null && dispatch({ type: "select", ids: [a.elementId] }) }, /* @__PURE__ */ React.createElement("span", null, i + 1));
    }), hoverEl && hostRect && !measureMode && !annoMode && /* @__PURE__ */ React.createElement("div", { className: "hover-tip", style: { left: hover.x - hostRect.left + 14, top: hover.y - hostRect.top + 16 } }, hover.overlay ? /* @__PURE__ */ React.createElement("span", { className: "tip-kind" }, "Graph node from") : null, /* @__PURE__ */ React.createElement("span", { className: "mono tip-class" }, hoverEl.ifcClass), /* @__PURE__ */ React.createElement("span", { className: "tip-name" }, elementLabel(hoverEl))), /* @__PURE__ */ React.createElement("div", { className: "dock", role: "toolbar", "aria-label": "View tools" }, /* @__PURE__ */ React.createElement("div", { className: "dock-group" }, /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Home, label: "Fit model", onClick: () => v == null ? void 0 : v.frameAll() }), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Focus, label: "Zoom to selection", shortcut: "F", disabled: !sel, onClick: () => v == null ? void 0 : v.frameElements([...viewerState.selectedIds]) })), /* @__PURE__ */ React.createElement("div", { className: "dock-group" }, /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Eye, label: "Show everything", shortcut: "A", onClick: () => dispatch({ type: "show-all" }) }), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.EyeOff, label: "Hide selection", shortcut: "H", disabled: !sel, onClick: () => dispatch({ type: "toggle-hide", ids: [...viewerState.selectedIds] }) }), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Isolate, label: "Isolate selection", shortcut: "I", disabled: !sel, onClick: () => dispatch({ type: "isolate", ids: [...viewerState.selectedIds] }) })), /* @__PURE__ */ React.createElement("div", { className: "dock-group" }, /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Section, label: "Section box", shortcut: "S", active: sectionEnabled, onClick: toggleSection }), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Ruler, label: "Measure distance", shortcut: "M", active: measureMode, onClick: toggleMeasure }), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Pin, label: "Pin an issue", shortcut: "P", active: annoMode, onClick: toggleAnno })), /* @__PURE__ */ React.createElement("div", { className: "dock-group" }, /* @__PURE__ */ React.createElement("div", { className: "seg", role: "group", "aria-label": "Display mode" }, /* @__PURE__ */ React.createElement("button", { type: "button", "aria-pressed": viewMode === "shaded", title: "Shaded", onClick: () => setViewMode("shaded") }, /* @__PURE__ */ React.createElement(Icons.Shaded, { size: 16 }), /* @__PURE__ */ React.createElement("span", { className: "sr-only" }, "Shaded")), /* @__PURE__ */ React.createElement("button", { type: "button", "aria-pressed": viewMode === "xray", title: "X-ray (X)", onClick: () => setViewMode("xray") }, /* @__PURE__ */ React.createElement(Icons.Xray, { size: 16 }), /* @__PURE__ */ React.createElement("span", { className: "sr-only" }, "X-ray")), /* @__PURE__ */ React.createElement("button", { type: "button", "aria-pressed": viewMode === "wireframe", title: "Wireframe (W)", onClick: () => setViewMode("wireframe") }, /* @__PURE__ */ React.createElement(Icons.Wireframe, { size: 16 }), /* @__PURE__ */ React.createElement("span", { className: "sr-only" }, "Wireframe"))), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Edges, label: "Edge lines", shortcut: "E", active: showEdges, onClick: () => setShowEdges((x) => !x) })), /* @__PURE__ */ React.createElement("div", { className: "dock-group" }, /* @__PURE__ */ React.createElement(
      LayersPopover,
      {
        model,
        viewerState,
        dispatch,
        showSpaces,
        setShowSpaces,
        slabsTransparent,
        onToggleSlabs,
        onFocusGroup,
        onResetFilters,
        explode,
        setExplode,
        showAxes,
        setShowAxes
      }
    ), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.Camera, label: "Save a screenshot", onClick: () => {
      const url = v.screenshot();
      const a = document.createElement("a");
      a.href = url;
      a.download = `${model.fileName.replace(/\.[^.]+$/, "")}-view.png`;
      a.click();
      toast({ kind: "ok", msg: "Screenshot saved" });
    } }))))), model && layout !== "3d" && planElement);
  }
  function LayersPopover({ model, viewerState, dispatch, showSpaces, setShowSpaces, slabsTransparent, onToggleSlabs, onFocusGroup, onResetFilters, explode, setExplode, showAxes, setShowAxes }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    const close = useCallback(() => setOpen(false), []);
    const groups = useMemo(() => {
      const byGroup = /* @__PURE__ */ new Map();
      model.byClass.forEach((ids, cls) => {
        if (cls === "IfcSpace") return;
        const g = classGroupOf(cls);
        const withGeo = ids.filter((id) => {
          const el = model.byId.get(id);
          return el && !el.isType && el.geometry;
        });
        if (!withGeo.length) return;
        if (!byGroup.has(g)) byGroup.set(g, []);
        byGroup.get(g).push(...withGeo);
      });
      return CLASS_GROUPS.filter((g) => byGroup.has(g.id)).map((g) => ({ id: g.id, name: g.name, ids: byGroup.get(g.id) }));
    }, [model]);
    const hidden = viewerState.hiddenIds;
    const groupHidden = (g) => g.ids.length > 0 && g.ids.every((id) => hidden.has(id));
    const anyGroupHidden = groups.some(groupHidden);
    const active = showSpaces || slabsTransparent || explode > 0 || anyGroupHidden;
    return /* @__PURE__ */ React.createElement("div", { className: "menu-anchor" }, /* @__PURE__ */ React.createElement("button", { ref, type: "button", className: "icon-btn dock-layers", "data-active": active ? "true" : void 0, "aria-expanded": open, "aria-label": "Layers and filters", title: "Layers and filters", onClick: () => setOpen((o) => !o) }, /* @__PURE__ */ React.createElement(Icons.Layers, { size: 16 })), /* @__PURE__ */ React.createElement(FloatingPanel, { anchorRef: ref, open, onClose: close, placement: "corner", className: "menu layers-pop", label: "Layers and filters" }, /* @__PURE__ */ React.createElement("div", { className: "menu-title" }, "Show"), /* @__PURE__ */ React.createElement("label", { className: "check-field menu-check" }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: showSpaces, onChange: () => setShowSpaces((x) => !x) }), " Room volumes"), /* @__PURE__ */ React.createElement("label", { className: "check-field menu-check" }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: slabsTransparent, onChange: onToggleSlabs }), " See-through slabs and roofs"), /* @__PURE__ */ React.createElement("label", { className: "check-field menu-check" }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: showAxes, onChange: () => setShowAxes((x) => !x) }), " Axes"), groups.length > 0 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "menu-sep" }), /* @__PURE__ */ React.createElement("div", { className: "menu-title" }, "Filter by category"), groups.map((g) => /* @__PURE__ */ React.createElement("label", { key: g.id, className: "check-field menu-check" }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: !groupHidden(g), onChange: () => dispatch({ type: "toggle-hide", ids: g.ids }) }), /* @__PURE__ */ React.createElement("span", { className: "menu-check-label" }, g.name), /* @__PURE__ */ React.createElement("span", { className: "mono muted trail" }, g.ids.length.toLocaleString())))), /* @__PURE__ */ React.createElement("div", { className: "menu-sep" }), /* @__PURE__ */ React.createElement("div", { className: "menu-title" }, "Isolate"), /* @__PURE__ */ React.createElement("button", { type: "button", role: "menuitem", onClick: () => {
      onFocusGroup("structure");
      setOpen(false);
    } }, /* @__PURE__ */ React.createElement(Icons.Building, { size: 15 }), " Structure"), /* @__PURE__ */ React.createElement("button", { type: "button", role: "menuitem", onClick: () => {
      onFocusGroup("mep");
      setOpen(false);
    } }, /* @__PURE__ */ React.createElement(Icons.Activity, { size: 15 }), " MEP"), model.storeys.length > 1 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "menu-sep" }), /* @__PURE__ */ React.createElement("label", { className: "slider-row menu-slider" }, /* @__PURE__ */ React.createElement("span", null, "Explode levels"), /* @__PURE__ */ React.createElement("input", { type: "range", min: "0", max: "1", step: "0.01", value: explode, onChange: (e) => setExplode(parseFloat(e.target.value)) }), /* @__PURE__ */ React.createElement("span", { className: "mono" }, Math.round(explode * 100), "%"))), /* @__PURE__ */ React.createElement("div", { className: "menu-sep" }), /* @__PURE__ */ React.createElement("button", { type: "button", role: "menuitem", onClick: () => {
      onResetFilters();
      setOpen(false);
    } }, /* @__PURE__ */ React.createElement(Icons.Reset, { size: 15 }), " Reset view filters")));
  }
  function LayoutSwitch({ layout, setLayout }) {
    return /* @__PURE__ */ React.createElement("div", { className: "seg layout-seg", role: "group", "aria-label": "Layout" }, /* @__PURE__ */ React.createElement("button", { type: "button", "aria-pressed": layout === "3d", title: "3D model only", onClick: () => setLayout("3d") }, /* @__PURE__ */ React.createElement(Icons.Cube, { size: 15 }), /* @__PURE__ */ React.createElement("span", null, "3D")), /* @__PURE__ */ React.createElement("button", { type: "button", "aria-pressed": layout === "split", title: "3D model and 2D floor plan side by side", onClick: () => setLayout("split") }, /* @__PURE__ */ React.createElement(Icons.Columns, { size: 15 }), /* @__PURE__ */ React.createElement("span", null, "3D + 2D")), /* @__PURE__ */ React.createElement("button", { type: "button", "aria-pressed": layout === "plan", title: "2D floor plan only", onClick: () => setLayout("plan") }, /* @__PURE__ */ React.createElement(Icons.Plan, { size: 15 }), /* @__PURE__ */ React.createElement("span", null, "2D")));
  }
  function StartScreen({ onUpload, onLoadFile, onLoadSample, currentModel, onResume }) {
    const [over, setOver] = useState(false);
    return /* @__PURE__ */ React.createElement("div", { className: "start", onDragOver: (e) => {
      e.preventDefault();
      setOver(true);
    }, onDragLeave: (e) => {
      if (e.currentTarget === e.target) setOver(false);
    }, onDrop: (e) => {
      var _a, _b;
      e.preventDefault();
      setOver(false);
      const file = (_b = (_a = e.dataTransfer) == null ? void 0 : _a.files) == null ? void 0 : _b[0];
      if (file) onLoadFile(file, "Dropped");
    } }, /* @__PURE__ */ React.createElement("div", { className: "start-inner" }, currentModel && /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn resume-btn", onClick: onResume }, /* @__PURE__ */ React.createElement(Icons.ChevronRight, { size: 15, style: { transform: "rotate(180deg)" } }), " Back to ", currentModel.fileName), /* @__PURE__ */ React.createElement("div", { className: "start-top" }, /* @__PURE__ */ React.createElement("section", { className: "start-hero" }, /* @__PURE__ */ React.createElement("h1", null, "From IFC model to robot route."), /* @__PURE__ */ React.createElement("p", null, "BIM2Bot Lab reads a building model in your browser, explains its semantics, turns it into maps a robot can plan on, and simulates robot fleets moving through it. Files never leave your machine."), /* @__PURE__ */ React.createElement("div", { className: "start-actions" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-primary btn-lg", onClick: onUpload }, /* @__PURE__ */ React.createElement(Icons.Upload, { size: 16 }), " Open an IFC file"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-lg", onClick: () => onLoadSample(SAMPLES[0]) }, /* @__PURE__ */ React.createElement(Icons.Cube, { size: 16 }), " Try a sample model")), /* @__PURE__ */ React.createElement("button", { type: "button", className: "dropzone", "data-over": over, onClick: onUpload }, /* @__PURE__ */ React.createElement(Icons.Upload, { size: 18 }), /* @__PURE__ */ React.createElement("span", null, "Drop a ", /* @__PURE__ */ React.createElement("code", null, ".ifc"), " file anywhere on this page"), /* @__PURE__ */ React.createElement("span", { className: "muted" }, "IFC2x3, IFC4 and IFC4.3, parsed locally with web-ifc"))), /* @__PURE__ */ React.createElement("aside", { className: "start-media", "aria-label": "Simulation previews" }, /* @__PURE__ */ React.createElement("figure", null, /* @__PURE__ */ React.createElement("img", { className: "only-light", src: "assets/images/home/sim-single.gif", width: "560", height: "350", loading: "lazy", alt: "A delivery robot crossing an office floor of the research centre at real speed, with its red LiDAR scan" }), /* @__PURE__ */ React.createElement("img", { className: "only-dark", src: "assets/images/home/sim-single-dark.gif", width: "560", height: "350", loading: "lazy", alt: "A delivery robot crossing an office floor of the research centre at real speed, with its red LiDAR scan" }), /* @__PURE__ */ React.createElement("figcaption", null, /* @__PURE__ */ React.createElement(Icons.Robot, { size: 14 }), " Single robot: a planned route with live LiDAR")), /* @__PURE__ */ React.createElement("figure", null, /* @__PURE__ */ React.createElement("img", { className: "only-light", src: "assets/images/home/sim-fleet.gif", width: "560", height: "350", loading: "lazy", alt: "Five delivery robots and people sharing one floor, each robot's LiDAR in its own colour" }), /* @__PURE__ */ React.createElement("img", { className: "only-dark", src: "assets/images/home/sim-fleet-dark.gif", width: "560", height: "350", loading: "lazy", alt: "Five delivery robots and people sharing one floor, each robot's LiDAR in its own colour" }), /* @__PURE__ */ React.createElement("figcaption", null, /* @__PURE__ */ React.createElement(Icons.Robot, { size: 14 }), " Fleet: shared corridors, people and per-robot LiDAR")))), /* @__PURE__ */ React.createElement("section", { className: "start-samples", "aria-label": "Sample models" }, /* @__PURE__ */ React.createElement("h2", null, "Sample models"), /* @__PURE__ */ React.createElement("div", { className: "sample-grid" }, SAMPLES.map((smp) => /* @__PURE__ */ React.createElement("article", { key: smp.id, className: "sample-card" }, /* @__PURE__ */ React.createElement("div", { className: "sample-head" }, /* @__PURE__ */ React.createElement(Icons.Building, { size: 18 }), /* @__PURE__ */ React.createElement("h3", null, smp.name), /* @__PURE__ */ React.createElement("span", { className: "mono muted" }, smp.size)), /* @__PURE__ */ React.createElement("p", null, smp.facts), /* @__PURE__ */ React.createElement("p", { className: "sample-credit" }, /* @__PURE__ */ React.createElement("a", { href: smp.creditUrl, target: "_blank", rel: "noopener noreferrer" }, smp.credit)), /* @__PURE__ */ React.createElement("div", { className: "sample-actions" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-sm", onClick: () => onLoadSample(smp) }, smp.bundled ? "Open" : "Download and open"), smp.downloadable && /* @__PURE__ */ React.createElement("a", { className: "btn btn-sm btn-ghost", href: smp.url, download: smp.file }, /* @__PURE__ */ React.createElement(Icons.Download, { size: 14 }), " Download .ifc")))))), /* @__PURE__ */ React.createElement("ol", { className: "start-roadmap", "aria-label": "Features" }, /* @__PURE__ */ React.createElement("li", { "data-state": "live" }, /* @__PURE__ */ React.createElement("div", { className: "rm-head" }, /* @__PURE__ */ React.createElement(Icons.Cube, { size: 18 }), /* @__PURE__ */ React.createElement("span", null, "Explore")), /* @__PURE__ */ React.createElement("ul", { className: "rm-list" }, /* @__PURE__ */ React.createElement("li", null, "3D model and 2D floor plans side by side"), /* @__PURE__ */ React.createElement("li", null, "Spatial tree, property sets, materials and relationships"), /* @__PURE__ */ React.createElement("li", null, "Layer and category filters, section box, plan cut"), /* @__PURE__ */ React.createElement("li", null, "Measure distances and pin issues"))), /* @__PURE__ */ React.createElement("li", { "data-state": "live" }, /* @__PURE__ */ React.createElement("div", { className: "rm-head" }, /* @__PURE__ */ React.createElement(Icons.Route, { size: 18 }), /* @__PURE__ */ React.createElement("span", null, "Navigate")), /* @__PURE__ */ React.createElement("ul", { className: "rm-list" }, /* @__PURE__ */ React.createElement("li", null, "Room graph and occupancy grids from IFC, traceable to every cell"), /* @__PURE__ */ React.createElement("li", null, "Multi-level A* routes through stairs and lifts"), /* @__PURE__ */ React.createElement("li", null, /* @__PURE__ */ React.createElement("span", { className: "rm-new" }, "New"), " Route comparison with time and energy estimates"), /* @__PURE__ */ React.createElement("li", null, /* @__PURE__ */ React.createElement("span", { className: "rm-new" }, "New"), " Safety zones: no-go and slow areas"), /* @__PURE__ */ React.createElement("li", null, /* @__PURE__ */ React.createElement("span", { className: "rm-new" }, "New"), " ROS 2 export: Nav2 map_server PGM + YAML and waypoints"), /* @__PURE__ */ React.createElement("li", null, "What-if obstacles and blocked doors"))), /* @__PURE__ */ React.createElement("li", { "data-state": "live" }, /* @__PURE__ */ React.createElement("div", { className: "rm-head" }, /* @__PURE__ */ React.createElement(Icons.Robot, { size: 18 }), /* @__PURE__ */ React.createElement("span", null, "Simulate")), /* @__PURE__ */ React.createElement("ul", { className: "rm-list" }, /* @__PURE__ */ React.createElement("li", null, "Robot fleets or custom missions, with people moving through"), /* @__PURE__ */ React.createElement("li", null, "Lift scheduling, congestion heatmaps, near-miss log"), /* @__PURE__ */ React.createElement("li", null, /* @__PURE__ */ React.createElement("span", { className: "rm-new" }, "New"), " Simulated 2D LiDAR on every robot (LaserScan JSON)"), /* @__PURE__ */ React.createElement("li", null, /* @__PURE__ */ React.createElement("span", { className: "rm-new" }, "New"), " Door schedules with fleet or onboard re-planning"), /* @__PURE__ */ React.createElement("li", null, /* @__PURE__ */ React.createElement("span", { className: "rm-new" }, "New"), " Batch experiments across seeds"))))));
  }
  function LoadingOverlay({ fileName, progress, phase, log }) {
    const recent = log.slice(-5);
    return /* @__PURE__ */ React.createElement("div", { className: "load-overlay", role: "status", "aria-live": "polite" }, /* @__PURE__ */ React.createElement("div", { className: "load-card" }, /* @__PURE__ */ React.createElement("div", { className: "load-head" }, /* @__PURE__ */ React.createElement("span", { className: "spinner" }), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", null, "Opening ", fileName), /* @__PURE__ */ React.createElement("div", { className: "sub" }, phase || "Starting")), /* @__PURE__ */ React.createElement("span", { className: "mono load-pct" }, Math.round(progress * 100), "%")), /* @__PURE__ */ React.createElement("div", { className: "load-bar" }, /* @__PURE__ */ React.createElement("div", { style: { width: `${Math.max(2, progress * 100)}%` } })), /* @__PURE__ */ React.createElement("ul", { className: "load-log" }, recent.map((l, i) => /* @__PURE__ */ React.createElement("li", { key: i, className: l.level, dangerouslySetInnerHTML: { __html: l.msg } })))));
  }
  function HelpPanel({ onClose }) {
    const groups = [
      ["Camera", [["Left drag", "Orbit"], ["Right drag, Shift + drag", "Pan"], ["Wheel", "Zoom toward the cursor"], ["Double-click", "Zoom to element"], ["1 to 6", "Iso, top, front, back, left, right"], ["F", "Zoom to selection"]]],
      ["Selection", [["Click", "Select"], ["Ctrl + click", "Add to selection"], ["H / I / A", "Hide, isolate, show all"], ["Esc", "Stop the tool, then clear selection"], ["Right-click", "Context menu"]]],
      ["Tools", [["S", "Section box"], ["M", "Measure"], ["P", "Pin an issue"], ["E", "Edge lines"], ["X / W", "X-ray, wireframe"], ["Ctrl + K", "Search"], ["O", "Open a file"]]]
    ];
    return /* @__PURE__ */ React.createElement(Modal, { title: "Shortcuts and controls", onClose }, /* @__PURE__ */ React.createElement("div", { className: "help-grid" }, groups.map(([title, rows]) => /* @__PURE__ */ React.createElement("div", { key: title }, /* @__PURE__ */ React.createElement("h4", null, title), rows.map(([k, l]) => /* @__PURE__ */ React.createElement("div", { key: k, className: "help-row" }, /* @__PURE__ */ React.createElement("span", null, l), /* @__PURE__ */ React.createElement("kbd", null, k)))))), /* @__PURE__ */ React.createElement("p", { className: "pane-note" }, "On touch screens, drag with one finger to orbit and pinch with two to zoom and pan."));
  }
  function ToastContainer({ toasts, onDismiss }) {
    return /* @__PURE__ */ React.createElement("div", { className: "toasts", "aria-live": "polite" }, toasts.map((t) => /* @__PURE__ */ React.createElement("div", { key: t.id, className: "toast", "data-kind": t.kind || "info" }, /* @__PURE__ */ React.createElement("span", { className: "toast-ic" }, t.kind === "ok" ? /* @__PURE__ */ React.createElement(Icons.Check, { size: 14 }) : t.kind === "info" ? /* @__PURE__ */ React.createElement(Icons.Info, { size: 14 }) : /* @__PURE__ */ React.createElement(Icons.Alert, { size: 14 })), /* @__PURE__ */ React.createElement("div", { className: "toast-msg" }, /* @__PURE__ */ React.createElement("div", null, t.msg), t.sub && /* @__PURE__ */ React.createElement("div", { className: "sub" }, t.sub)), /* @__PURE__ */ React.createElement(IconButton, { icon: Icons.X, label: "Dismiss", size: 12, className: "sm", onClick: () => onDismiss(t.id) }))));
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
      const close = (e) => {
        var _a;
        if (!((_a = ref.current) == null ? void 0 : _a.contains(e.target))) onClose();
      };
      const esc = (e) => {
        if (e.key === "Escape") onClose();
      };
      window.addEventListener("pointerdown", close);
      window.addEventListener("keydown", esc);
      return () => {
        window.removeEventListener("pointerdown", close);
        window.removeEventListener("keydown", esc);
      };
    }, [menu]);
    if (!menu) return null;
    const ids = menu.ids;
    const first = model.byId.get(ids[0]);
    const run = (fn) => () => {
      fn();
      onClose();
    };
    const isDoor = first && navRoleOf(first) === "portal";
    return /* @__PURE__ */ React.createElement("div", { className: "menu ctx-menu", role: "menu", ref, style: { left: (pos || menu).x, top: (pos || menu).y } }, /* @__PURE__ */ React.createElement("div", { className: "menu-title" }, ids.length > 1 ? plural(ids.length, "element") : elementLabel(first)), /* @__PURE__ */ React.createElement("button", { type: "button", role: "menuitem", onClick: run(() => onZoomTo(ids)) }, /* @__PURE__ */ React.createElement(Icons.Focus, { size: 15 }), " Zoom to ", /* @__PURE__ */ React.createElement("kbd", null, "F")), /* @__PURE__ */ React.createElement("button", { type: "button", role: "menuitem", onClick: run(() => dispatch({ type: "isolate", ids })) }, /* @__PURE__ */ React.createElement(Icons.Isolate, { size: 15 }), " Isolate ", /* @__PURE__ */ React.createElement("kbd", null, "I")), /* @__PURE__ */ React.createElement("button", { type: "button", role: "menuitem", onClick: run(() => dispatch({ type: "toggle-hide", ids })) }, /* @__PURE__ */ React.createElement(Icons.EyeOff, { size: 15 }), " Hide ", /* @__PURE__ */ React.createElement("kbd", null, "H")), /* @__PURE__ */ React.createElement("button", { type: "button", role: "menuitem", onClick: run(() => dispatch({ type: "show-all" })) }, /* @__PURE__ */ React.createElement(Icons.Eye, { size: 15 }), " Show everything ", /* @__PURE__ */ React.createElement("kbd", null, "A")), first && /* @__PURE__ */ React.createElement("button", { type: "button", role: "menuitem", onClick: run(() => dispatch({ type: "select", ids: model.byClass.get(first.ifcClass) || [] })) }, /* @__PURE__ */ React.createElement(Icons.Classes, { size: 15 }), " Select all ", first.ifcClass.replace(/^Ifc/, "")), isDoor && nav && /* @__PURE__ */ React.createElement("button", { type: "button", role: "menuitem", onClick: run(() => nav.toggleBlocked(first.expressId)) }, /* @__PURE__ */ React.createElement(Icons.Ban, { size: 15 }), " ", nav.blocked.has(first.expressId) ? "Unblock door" : "Block door for routing"), /* @__PURE__ */ React.createElement("div", { className: "menu-sep" }), first && first.globalId && /* @__PURE__ */ React.createElement("button", { type: "button", role: "menuitem", onClick: run(() => {
      var _a;
      (_a = navigator.clipboard) == null ? void 0 : _a.writeText(first.globalId);
      toast({ kind: "ok", msg: "GlobalId copied" });
    }) }, /* @__PURE__ */ React.createElement(Icons.Copy, { size: 15 }), " Copy GlobalId"), /* @__PURE__ */ React.createElement("button", { type: "button", role: "menuitem", onClick: run(() => exportJSON(ids.map((id) => model.byId.get(id)).filter(Boolean), toast)) }, /* @__PURE__ */ React.createElement(Icons.Download, { size: 15 }), " Export as JSON"));
  }
  const useLayoutEffectSafe = React.useLayoutEffect;
  function App() {
    const [theme, setTheme] = useState(initialTheme);
    const [model, setModel] = useState(null);
    const [secondaryReady, setSecondaryReady] = useState(false);
    const [loading, setLoading] = useState(null);
    const [workspace, setWorkspace] = useState("explore");
    const [modal, setModal] = useState(null);
    const [viewMode, setViewMode] = useState("shaded");
    const [showEdges, setShowEdges] = useState(false);
    const [showAxes, setShowAxes] = useState(true);
    const [showSpaces, setShowSpaces] = useState(false);
    const [explode, setExplode] = useState(0);
    const [sectionEnabled, setSectionEnabled] = useState(false);
    const [sectionBox, setSectionBox] = useState(null);
    const [measureMode, setMeasureMode] = useState(false);
    const [annoMode, setAnnoMode] = useState(false);
    const [levelId, setLevelId] = useState("all");
    const [planCut, setPlanCut] = useState({ enabled: false, y: 0 });
    const [slabsTransparent, setSlabsTransparent] = useState(false);
    const [log, setLog] = useState([]);
    const [toasts, setToasts] = useState([]);
    const [contextMenu, setContextMenu] = useState(null);
    const [layout, setLayout] = useState(initialLayout);
    const [robot, setRobot] = useState(() => ({ ...DEFAULT_ROBOT_PROFILE }));
    const [route, setRouteEnds] = useState(EMPTY_ROUTE);
    const [viewLayout, setViewLayoutState] = useState(() => ["3d", "split", "plan"].includes(readStorage(STORAGE.layoutMode)) ? readStorage(STORAGE.layoutMode) : "3d");
    const [planLevel, setPlanLevel] = useState(null);
    const [missions, setMissions] = useState([]);
    const [pendingMission, setPendingMission] = useState(null);
    const [simRequest, setSimRequest] = useState(null);
    const [leftTab, setLeftTab] = useState("spatial");
    const [showHome, setShowHome] = useState(false);
    const [blocked, setBlocked] = useState(() => /* @__PURE__ */ new Set());
    const [showGraph, setShowGraph] = useState(true);
    const [planner, setPlanner] = useState("grid");
    const [showGrid, setShowGrid] = useState(true);
    const [clickMode, setClickMode] = useState("select");
    const [obstacleSize, setObstacleSize] = useState(1);
    const [obstacles, setObstacles] = useState([]);
    const [zones, setZones] = useState([]);
    const [pendingZone, setPendingZone] = useState(null);
    const [zoneFactor, setZoneFactor] = useState(0.5);
    const [cellQuery, setCellQuery] = useState(null);
    const [stairsAsLifts, setStairsAsLifts] = useState(false);
    const [gridWanted, setGridWanted] = useState(false);
    const [navMap, setNavMap] = useState(null);
    const [viewerState, dispatch] = useReducer(viewerStateReducer, void 0, initialViewerState);
    const fileInputRef = useRef(null);
    const viewerRef = useRef(null);
    const bodyRef = useRef(null);
    const searchRef = useRef(null);
    const modelRef = useRef(null);
    modelRef.current = model;
    useEffect(() => {
      document.documentElement.setAttribute("data-theme", theme);
      writeStorage(STORAGE.theme, theme);
    }, [theme]);
    useEffect(() => {
      writeStorage(STORAGE.layout, JSON.stringify(layout));
    }, [layout]);
    useEffect(() => {
      const warm = () => {
        var _a;
        (_a = window.ensureWebIfc) == null ? void 0 : _a.call(window).catch(() => {
        });
      };
      if (typeof requestIdleCallback !== "undefined") {
        const h2 = requestIdleCallback(warm, { timeout: 2500 });
        return () => cancelIdleCallback(h2);
      }
      const h = setTimeout(warm, 300);
      return () => clearTimeout(h);
    }, []);
    const dismissToast = useCallback((id) => setToasts((ts) => ts.filter((x) => x.id !== id)), []);
    const toast = useCallback((t) => {
      const id = uid();
      setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
      setTimeout(() => dismissToast(id), t.kind === "error" ? 7e3 : 3200);
    }, [dismissToast]);
    const addLog = useCallback((level, msg) => {
      setLog((l) => [...l, { time: (/* @__PURE__ */ new Date()).toLocaleTimeString([], { hour12: false }), level, msg }]);
    }, []);
    const building = useMemo(() => {
      if (!model || !secondaryReady) return null;
      try {
        return buildBuildingGraph(model);
      } catch (err) {
        console.error(err);
        return null;
      }
    }, [model, secondaryReady]);
    const readiness = useMemo(() => building ? analyzeReadiness(building, model, { robot, blocked }) : null, [building, robot, blocked]);
    const routeResult = useMemo(() => {
      if (!building || !route.startId || !route.goalId) return null;
      return findRoute(building, route.startId, route.goalId, { robot, blocked });
    }, [building, route, robot, blocked]);
    useEffect(() => {
      if (workspace !== "explore" || viewLayout !== "3d") setGridWanted(true);
    }, [workspace, viewLayout]);
    useEffect(() => {
      if (!building || !gridWanted) {
        setNavMap(null);
        return;
      }
      const h = setTimeout(() => {
        try {
          const nm = buildNavMap(model, building);
          setNavMap(nm);
          addLog("ok", `Occupancy grids: <span class="hl">${nm.grids.length}</span> levels, <span class="hl">${nm.cells.toLocaleString()}</span> cells at ${Math.round(nm.res * 100)} cm in ${nm.buildMs.toFixed(0)} ms`);
        } catch (err) {
          console.error(err);
          addLog("error", `Occupancy grid failed: ${err.message || err}`);
        }
      }, 30);
      return () => clearTimeout(h);
    }, [building, gridWanted]);
    const navState = useMemo(() => navMap && building ? applyRobot(navMap, building, robot, { blocked, obstacles, zones, stairsAsLifts }) : null, [navMap, building, robot, blocked, obstacles, zones, stairsAsLifts]);
    const gridInfo = useMemo(() => navState ? { summary: navMapSummary(navState), reach: gridReachability(navState, building) } : null, [navState]);
    const endpoint = (id, pt) => {
      if (pt) return pt;
      const sp = id != null && building ? building.spaces.get(id) : null;
      return sp ? { levelId: sp.levelId, x: sp.position[0], z: sp.position[2] } : null;
    };
    const startPt = useMemo(() => endpoint(route.startId, route.startPoint), [route, building]);
    const goalPt = useMemo(() => endpoint(route.goalId, route.goalPoint), [route, building]);
    const gridRoute = useMemo(() => {
      if (!navState || planner !== "grid" || !startPt || !goalPt) return null;
      return planGridRoute(navState, startPt, goalPt);
    }, [navState, planner, startPt, goalPt]);
    const roomAt = useCallback((lid, x, z) => {
      if (!building) return null;
      let best = null;
      building.spaces.forEach((sp) => {
        if (sp.levelId !== lid) return;
        const b = sp.bbox;
        if (x < b.min[0] || x > b.max[0] || z < b.min[2] || z > b.max[2]) return;
        if (!best || sp.area < best.area) best = sp;
      });
      return best ? best.id : null;
    }, [building]);
    const missionPaths = useMemo(() => navState ? missions.map((m) => {
      const r = planGridRoute(navState, m.start, m.goal);
      return r ? r.legs.filter((l) => l.type === "walk").map((l) => ({ levelId: l.levelId, points: l.points })) : null;
    }) : [], [navState, missions]);
    const cellInfo = useMemo(() => navState && cellQuery ? explainCell(navState, cellQuery.levelId, cellQuery.x, cellQuery.z) : null, [navState, cellQuery]);
    const simApi = useSimulation({ viewerRef, model, building, navMap, theme, levelId, active: workspace === "simulate" });
    useEffect(() => {
      if (building) addLog("ok", `Navigation graph: <span class="hl">${building.spaces.size}</span> rooms, <span class="hl">${building.doors.size}</span> doors, <span class="hl">${building.edges.length}</span> links in ${building.buildMs.toFixed(0)} ms`);
    }, [building]);
    const resetSession = useCallback(() => {
      var _a;
      dispatch({ type: "reset" });
      setSecondaryReady(false);
      setLevelId("all");
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
      setBlocked(/* @__PURE__ */ new Set());
      setObstacles([]);
      setZones([]);
      setPendingZone(null);
      setMissions([]);
      setPendingMission(null);
      setPlanLevel(null);
      setCellQuery(null);
      setClickMode("select");
      setGridWanted(false);
      (_a = viewerRef.current) == null ? void 0 : _a.clearMeasurements();
    }, []);
    const loadIfcFile = useCallback(async (file, source = "Opened") => {
      var _a, _b;
      if (!file) return;
      if (!/\.ifc$/i.test(file.name)) {
        toast({ kind: "error", msg: `${file.name} is not an .ifc file`, sub: "Choose a STEP-encoded .ifc file (IFC2x3, IFC4 or IFC4.3)." });
        return;
      }
      (_b = (_a = modelRef.current) == null ? void 0 : _a.close) == null ? void 0 : _b.call(_a);
      setModel(null);
      resetSession();
      setLog([]);
      setLoading({ fileName: file.name, progress: 0.01, phase: "Starting" });
      addLog("info", `${source} <span class="hl">${file.name}</span> (${formatSize(file.size)})`);
      try {
        const schema = await window.readIfcSchema(file);
        if (schema && !window.isSupportedIfcSchema(schema)) throw new Error(`Schema ${schema} is not supported. Use IFC2X3, IFC4 or IFC4X3.`);
        const m = await window.loadRealIfc(file, {
          onProgress: (p, phase) => setLoading((l) => l ? { ...l, progress: p, phase: phase || l.phase } : l),
          onLog: addLog
        });
        setModel(m);
        setShowHome(false);
        setLoading(null);
        setWorkspace((w) => w === "simulate" ? "explore" : w);
        toast({ kind: "ok", msg: `Opened ${file.name}`, sub: `${plural(m.elements.length, "element")}, ${m.schemaVersion}` });
        m._ensureSecondaryData().then(() => {
          if (modelRef.current === m) setSecondaryReady(true);
        });
      } catch (err) {
        console.error(err);
        addLog("error", `Could not open the file: ${err.message || err}`);
        setLoading(null);
        toast({ kind: "error", msg: `Could not open ${file.name}`, sub: String(err.message || err).slice(0, 140) });
      }
    }, [addLog, toast, resetSession]);
    const loadSample = useCallback(async (sample = SAMPLES[0]) => {
      try {
        if (!sample.bundled) setLoading({ fileName: sample.file, progress: 0.01, phase: "Downloading from the source" });
        const res = await fetch(sample.url);
        if (!res.ok) throw new Error(`The sample returned HTTP ${res.status}`);
        const blob = await res.blob();
        await loadIfcFile(new File([blob], sample.file, { type: "application/octet-stream" }), `Opened sample \u201C${sample.name}\u201D`);
      } catch (err) {
        setLoading(null);
        toast({ kind: "error", msg: `Could not open \u201C${sample.name}\u201D`, sub: sample.bundled ? "Serve the site over HTTP (not file://) and try again." : "The source could not be reached. Check your connection and try again." });
      }
    }, [loadIfcFile, toast]);
    const onUpload = useCallback(() => {
      var _a;
      return (_a = fileInputRef.current) == null ? void 0 : _a.click();
    }, []);
    const onCloseModel = useCallback(() => {
      var _a, _b;
      (_b = (_a = modelRef.current) == null ? void 0 : _a.close) == null ? void 0 : _b.call(_a);
      setModel(null);
      resetSession();
      setLog([]);
      setWorkspace("explore");
    }, [resetSession]);
    useEffect(() => {
      const over = (e) => {
        var _a, _b;
        if ((_b = (_a = e.dataTransfer) == null ? void 0 : _a.types) == null ? void 0 : _b.includes("Files")) e.preventDefault();
      };
      const drop = (e) => {
        var _a, _b;
        if (!((_b = (_a = e.dataTransfer) == null ? void 0 : _a.files) == null ? void 0 : _b.length)) return;
        e.preventDefault();
        loadIfcFile(e.dataTransfer.files[0], "Dropped");
      };
      window.addEventListener("dragover", over);
      window.addEventListener("drop", drop);
      return () => {
        window.removeEventListener("dragover", over);
        window.removeEventListener("drop", drop);
      };
    }, [loadIfcFile]);
    const onPick = useCallback((id, e) => dispatch({ type: "select", ids: [id], multi: !!(e && (e.ctrlKey || e.metaKey || e.shiftKey)) }), []);
    const onZoomTo = useCallback((ids) => {
      var _a;
      return (_a = viewerRef.current) == null ? void 0 : _a.frameElements(ids);
    }, []);
    const selectAndShow = useCallback((ids) => {
      var _a;
      dispatch({ type: "select", ids });
      const geo = ids.filter((id) => {
        var _a2, _b;
        return (_b = (_a2 = modelRef.current) == null ? void 0 : _a2.byId.get(id)) == null ? void 0 : _b.geometry;
      });
      if (geo.length) (_a = viewerRef.current) == null ? void 0 : _a.frameElements(geo);
    }, []);
    const onMapPick = useCallback(({ levelId: lid, x, z }) => {
      const pt = { levelId: lid, x, z };
      if (clickMode === "inspect") {
        setCellQuery(pt);
        return;
      }
      if (clickMode === "obstacle") {
        setObstacles((list) => {
          const hit = list.find((o) => o.levelId === lid && Math.abs(o.x - x) <= o.size / 2 && Math.abs(o.z - z) <= o.size / 2);
          if (hit) return list.filter((o) => o !== hit);
          return [...list, { id: uid(), levelId: lid, x, z, size: obstacleSize }];
        });
        return;
      }
      if (clickMode === "zone-nogo" || clickMode === "zone-slow") {
        if (!pendingZone || pendingZone.levelId !== lid) {
          setPendingZone(pt);
          return;
        }
        if (Math.abs(x - pendingZone.x) < 0.2 || Math.abs(z - pendingZone.z) < 0.2) {
          toast({ kind: "info", msg: "Zone too small", sub: "Click the opposite corner at least 0.2 m away in both directions." });
          return;
        }
        const kind = clickMode === "zone-nogo" ? "nogo" : "slow";
        setZones((list) => [...list, { id: uid(), kind, levelId: lid, x0: pendingZone.x, z0: pendingZone.z, x1: x, z1: z, ...kind === "slow" ? { factor: zoneFactor } : {} }]);
        setPendingZone(null);
        return;
      }
      if (clickMode === "start" || clickMode === "goal") {
        const room = roomAt(lid, x, z);
        setRouteEnds((r) => clickMode === "start" ? { ...r, startPoint: pt, startId: room } : { ...r, goalPoint: pt, goalId: room });
        if (workspace === "explore") setWorkspace("navigate");
        setClickMode(clickMode === "start" && !route.goalPoint && !route.goalId ? "goal" : "select");
        return;
      }
      if (clickMode === "mission") {
        if (!pendingMission) {
          setPendingMission(pt);
          return;
        }
        setMissions((list) => [...list, { id: uid(), start: pendingMission, goal: pt }].slice(0, 8));
        setPendingMission(null);
      }
    }, [clickMode, obstacleSize, roomAt, workspace, route, pendingMission, pendingZone, zoneFactor, toast]);
    const onPickEvent = useCallback((e) => {
      if (clickMode !== "select") {
        if (e.overlay !== "grid" || !e.point) {
          toast({ kind: "info", msg: "Click on the coloured floor grid", sub: "Or use the 2D floor plan (3D + 2D or 2D layout)." });
          return;
        }
        onMapPick({ levelId: e.gridLevel, x: e.point[0], z: e.point[2] });
        return;
      }
      if (e.expressId == null) {
        if (!e.multi) dispatch({ type: "clear-selection" });
        return;
      }
      dispatch({ type: "select", ids: [e.expressId], multi: e.multi });
    }, [clickMode, onMapPick, toast]);
    const onContext = useCallback((e, id) => {
      if (e.preventDefault) e.preventDefault();
      if (!modelRef.current) return;
      let ids = [...viewerState.selectedIds];
      if (id != null && !viewerState.selectedIds.has(id)) {
        ids = [id];
        dispatch({ type: "select", ids });
      }
      if (!ids.length) return;
      setContextMenu({ x: e.clientX, y: e.clientY, ids });
    }, [viewerState.selectedIds]);
    const onContextEvent = useCallback((e) => {
      if (e.expressId == null) return;
      onContext({ clientX: e.x, clientY: e.y }, e.expressId);
    }, [onContext]);
    const toggleSection = useCallback(() => {
      setSectionEnabled((on) => {
        var _a;
        if (!on) {
          const b = (_a = viewerRef.current) == null ? void 0 : _a.getModelBounds();
          if (b) setSectionBox({ ...b });
        }
        return !on;
      });
    }, []);
    const toggleMeasure = useCallback(() => setMeasureMode((on) => {
      if (!on) setAnnoMode(false);
      return !on;
    }), []);
    const toggleAnno = useCallback(() => setAnnoMode((on) => {
      if (!on) setMeasureMode(false);
      return !on;
    }), []);
    const levelFloorY = useCallback((id) => {
      const lv = building == null ? void 0 : building.levels.find((l) => l.id === Number(id));
      if (lv && lv.floorY != null) return lv.floorY;
      const els = model ? model.elements.filter((e) => e.storey && e.storey.expressId === Number(id) && e.bbox) : [];
      return els.length ? Math.min(...els.map((e) => e.bbox.min[1])) : 0;
    }, [building, model]);
    const onLevelChange = useCallback((id, { frame = true } = {}) => {
      var _a, _b;
      setLevelId(id);
      if (!model) return;
      if (id === "all") {
        dispatch({ type: "isolate", ids: [], force: true });
        setPlanCut((p) => ({ ...p, enabled: false }));
        (_a = viewerRef.current) == null ? void 0 : _a.frameAll();
        return;
      }
      const sid = Number(id);
      const ids = model.elements.filter((el) => el.storey && el.storey.expressId === sid).map((el) => el.expressId);
      if (!ids.length) {
        toast({ kind: "warn", msg: "This level contains no elements" });
        return;
      }
      dispatch({ type: "isolate", ids, force: true });
      setPlanCut((p) => p.enabled ? { enabled: true, y: levelFloorY(sid) + 1.2 } : p);
      if (frame) (_b = viewerRef.current) == null ? void 0 : _b.frameElements(ids.filter((i) => model.byId.get(i).geometry));
    }, [model, toast, levelFloorY]);
    const togglePlanCut = useCallback(() => {
      if (levelId === "all") return;
      setPlanCut((p) => {
        var _a;
        const next = { enabled: !p.enabled, y: levelFloorY(levelId) + 1.2 };
        if (next.enabled) (_a = viewerRef.current) == null ? void 0 : _a.setCameraPreset("top");
        return next;
      });
    }, [levelId, levelFloorY]);
    const onToggleSlabs = useCallback(() => {
      if (!model) return;
      const ids = SLAB_CLASSES.flatMap((c) => model.byClass.get(c) || []);
      setSlabsTransparent((on) => {
        dispatch({ type: "set-opacity-many", ids, opacity: on ? null : 0.15 });
        return !on;
      });
    }, [model]);
    const onFocusGroup = useCallback((group) => {
      var _a;
      if (!model) return;
      const ids = [];
      model.byClass.forEach((list, cls) => {
        if (classGroupOf(cls) === group) ids.push(...list.filter((id) => model.byId.get(id).geometry));
      });
      const label = group === "mep" ? "MEP" : "Structure";
      if (!ids.length) {
        toast({ kind: "warn", msg: `No ${label} elements in this model` });
        return;
      }
      dispatch({ type: "isolate", ids, force: true });
      (_a = viewerRef.current) == null ? void 0 : _a.frameElements(ids);
      toast({ kind: "info", msg: `Isolated ${label}`, sub: plural(ids.length, "element") });
    }, [model, toast]);
    const onResetFilters = useCallback(() => {
      var _a;
      if (!model) return;
      setLevelId("all");
      setPlanCut({ enabled: false, y: 0 });
      if (slabsTransparent) {
        dispatch({ type: "set-opacity-many", ids: SLAB_CLASSES.flatMap((c) => model.byClass.get(c) || []), opacity: null });
        setSlabsTransparent(false);
      }
      dispatch({ type: "show-all" });
      setExplode(0);
      (_a = viewerRef.current) == null ? void 0 : _a.frameAll();
    }, [model, slabsTransparent]);
    const onSaveView = useCallback(() => {
      var _a;
      dispatch({ type: "save-view", camera: (_a = viewerRef.current) == null ? void 0 : _a.getCameraState() });
      toast({ kind: "ok", msg: "View saved" });
    }, [toast]);
    const onRestoreView = useCallback((view) => {
      var _a;
      dispatch({ type: "restore-view", view });
      (_a = viewerRef.current) == null ? void 0 : _a.setCameraState(view.camera);
    }, []);
    const simulateRoute = useCallback(() => {
      if (!startPt || !goalPt) return;
      const mission = { id: uid(), start: startPt, goal: goalPt };
      setMissions([mission]);
      setPendingMission(null);
      setClickMode("select");
      setSimRequest({ id: mission.id, missions: [mission], robot: { ...robot }, stairsAsLifts });
      setWorkspace("simulate");
      toast({ kind: "info", msg: "Simulating the route", sub: "One robot, one trip. Add robots, people or missions in the scenario." });
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
        if (m === "select") return;
        setShowGrid(true);
        if (levelId === "all" && building) {
          const startLevel = route.startId && building.spaces.get(route.startId) ? building.spaces.get(route.startId).levelId : null;
          const first = navMap && navMap.grids[0] ? navMap.grids[0].levelId : null;
          const target = startLevel || first;
          if (target != null) onLevelChange(String(target), { frame: false });
        }
      },
      obstacleSize,
      setObstacleSize,
      obstacles,
      removeObstacle: (id) => setObstacles((list) => list.filter((o) => o.id !== id)),
      clearObstacles: () => setObstacles([]),
      zones,
      pendingZone,
      zoneFactor,
      setZoneFactor,
      removeZone: (id) => setZones((list) => list.filter((z) => z.id !== id)),
      clearZones: () => {
        setZones([]);
        setPendingZone(null);
      },
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
        setRouteEnds((r) => ({ ...r, [kind === "start" ? "startId" : "goalId"]: id, [kind === "start" ? "startPoint" : "goalPoint"]: null }));
        if (workspace !== "navigate") setWorkspace("navigate");
      },
      onSetEndpoint: (kind, id) => {
        setRouteEnds((r) => ({ ...r, [kind === "start" ? "startId" : "goalId"]: id, [kind === "start" ? "startPoint" : "goalPoint"]: null }));
        if (workspace !== "navigate") setWorkspace("navigate");
      },
      swap: () => setRouteEnds((r) => ({ startId: r.goalId, goalId: r.startId, startPoint: r.goalPoint, goalPoint: r.startPoint })),
      clearRoute: () => setRouteEnds(EMPTY_ROUTE),
      toggleBlocked: (id) => setBlocked((b) => {
        const n = new Set(b);
        n.has(id) ? n.delete(id) : n.add(id);
        return n;
      }),
      onToggleBlocked: (id) => setBlocked((b) => {
        const n = new Set(b);
        n.has(id) ? n.delete(id) : n.add(id);
        return n;
      }),
      clearBlocked: () => setBlocked(/* @__PURE__ */ new Set())
    }), [robot, route, blocked, showGraph, workspace, planner, showGrid, clickMode, obstacleSize, obstacles, zones, pendingZone, zoneFactor, cellInfo, stairsAsLifts, levelId, building, navMap, onLevelChange, simulateRoute, startPt, goalPt]);
    useEffect(() => {
      const v = viewerRef.current;
      if (!v) return;
      const navigating = workspace === "navigate";
      if (navigating && building && showGraph && planner === "graph") {
        v.setOverlay("nav-graph", buildTopologyOverlay(building, { theme, blocked, robot, levelId }), { pickable: clickMode === "select" });
      } else {
        v.removeOverlay("nav-graph");
      }
      const picking = clickMode !== "select" && workspace !== "explore";
      if (navState && (navigating && showGrid || picking)) v.setOverlay("nav-grid", buildGridOverlay(navState, { theme, levelId }), { pickable: clickMode !== "select" });
      else v.removeOverlay("nav-grid");
      if (building && workspace !== "explore" && (startPt || goalPt || missions.length || pendingMission)) {
        v.setOverlay("nav-marks", buildMarkersOverlay({ building, theme, start: navigating ? startPt : null, goal: navigating ? goalPt : null, missions: workspace === "simulate" ? missions : [], missionPaths: workspace === "simulate" ? missionPaths : [], pending: workspace === "simulate" ? pendingMission : null }));
      } else v.removeOverlay("nav-marks");
      const shown = planner === "grid" ? gridRoute ? buildGridRouteOverlay(gridRoute, { theme }) : null : routeResult ? buildRouteOverlay(routeResult, { theme }) : null;
      if (navigating && shown) v.setOverlay("nav-route", shown);
      else v.removeOverlay("nav-route");
    }, [workspace, building, showGraph, theme, blocked, robot, levelId, routeResult, gridRoute, planner, navState, showGrid, clickMode, startPt, goalPt, missions, missionPaths, pendingMission]);
    const onFrameRoute = useCallback(() => {
      var _a;
      const pts = planner === "grid" ? gridRoute ? gridRoute.legs.flatMap((l) => l.points || []) : [] : routeResult ? routeResult.points : [];
      if (!pts.length) return;
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      pts.forEach((p) => p.forEach((c, i) => {
        min[i] = Math.min(min[i], c);
        max[i] = Math.max(max[i], c);
      }));
      (_a = viewerRef.current) == null ? void 0 : _a.frameModelBox({ min, max: max.map((c, i) => Math.max(c, min[i] + 1)) });
    }, [routeResult, gridRoute, planner]);
    const onFrameAt = useCallback((p) => {
      var _a;
      const y = p.y != null ? p.y : 0;
      (_a = viewerRef.current) == null ? void 0 : _a.frameModelBox({ min: [p.x - 3, y, p.z - 3], max: [p.x + 3, y + 2, p.z + 3] });
    }, []);
    const modeBeforeNavigate = useRef(null);
    useEffect(() => {
      if (workspace !== "explore") {
        setMeasureMode(false);
        setAnnoMode(false);
        setViewMode((m) => {
          if (modeBeforeNavigate.current == null) modeBeforeNavigate.current = m;
          return "xray";
        });
      } else if (modeBeforeNavigate.current) {
        setViewMode(modeBeforeNavigate.current);
        modeBeforeNavigate.current = null;
      }
    }, [workspace]);
    const onWorkspace = useCallback((w) => {
      setShowHome(false);
      setWorkspace(w);
    }, []);
    const onSearch = useCallback((q) => {
      if (!model) return;
      if (!q || !q.trim()) {
        dispatch({ type: "clear-query" });
        return;
      }
      const { ids, match } = runQuery(model, q);
      dispatch({ type: "set-query", ids, match });
      if (layout.bottomCollapsed) setLayout((l) => ({ ...l, bottomCollapsed: false }));
      if (!ids.length) toast({ kind: "warn", msg: `No matches for \u201C${q}\u201D` });
    }, [model, toast, layout.bottomCollapsed]);
    useEffect(() => {
      const handler = (e) => {
        var _a, _b, _c;
        const tag = (_a = document.activeElement) == null ? void 0 : _a.tagName;
        const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || ((_b = document.activeElement) == null ? void 0 : _b.isContentEditable);
        if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "f")) {
          if (model) {
            e.preventDefault();
            (_c = searchRef.current) == null ? void 0 : _c.focus();
          }
          return;
        }
        if (typing || e.ctrlKey || e.metaKey || e.altKey || modal) return;
        const sel = [...viewerState.selectedIds];
        const v = viewerRef.current;
        switch (e.key) {
          case "Escape":
            if (contextMenu) setContextMenu(null);
            else if (measureMode || annoMode) {
              setMeasureMode(false);
              setAnnoMode(false);
            } else if (clickMode !== "select") {
              setClickMode("select");
              setPendingMission(null);
              setPendingZone(null);
            } else dispatch({ type: "clear-selection" });
            return;
          case "?":
            setModal("help");
            return;
          case "o":
          case "O":
            onUpload();
            return;
          default:
            break;
        }
        if (!model) return;
        switch (e.key.toLowerCase()) {
          case "f":
            if (sel.length) onZoomTo(sel);
            break;
          case "h":
            if (sel.length) dispatch({ type: "toggle-hide", ids: sel });
            break;
          case "i":
            if (sel.length) dispatch({ type: "isolate", ids: sel });
            break;
          case "a":
            dispatch({ type: "show-all" });
            break;
          case "m":
            toggleMeasure();
            break;
          case "p":
            toggleAnno();
            break;
          case "s":
            toggleSection();
            break;
          case "e":
            setShowEdges((x) => !x);
            break;
          case "x":
            setViewMode((m) => m === "xray" ? "shaded" : "xray");
            break;
          case "w":
            setViewMode((m) => m === "wireframe" ? "shaded" : "wireframe");
            break;
          case "1":
            v == null ? void 0 : v.setCameraPreset("iso");
            break;
          case "2":
            v == null ? void 0 : v.setCameraPreset("top");
            break;
          case "3":
            v == null ? void 0 : v.setCameraPreset("front");
            break;
          case "4":
            v == null ? void 0 : v.setCameraPreset("back");
            break;
          case "5":
            v == null ? void 0 : v.setCameraPreset("left");
            break;
          case "6":
            v == null ? void 0 : v.setCameraPreset("right");
            break;
          default:
            break;
        }
      };
      window.addEventListener("keydown", handler);
      return () => window.removeEventListener("keydown", handler);
    }, [model, modal, contextMenu, measureMode, annoMode, clickMode, viewerState.selectedIds, onZoomTo, onUpload, toggleMeasure, toggleAnno, toggleSection]);
    const startResize = useCallback((edge, e) => {
      if (!model) return;
      e.preventDefault();
      const body = bodyRef.current;
      const rect = body.getBoundingClientRect();
      const start = { ...layout };
      const sx = e.clientX, sy = e.clientY;
      let latest = start;
      document.body.classList.add("is-resizing");
      const move = (ev) => {
        var _a;
        const next = { ...start };
        if (edge === "left") next.left = clamp(start.left + ev.clientX - sx, 240, Math.max(240, rect.width - start.right - 420));
        if (edge === "right") next.right = clamp(start.right - (ev.clientX - sx), 280, Math.max(280, rect.width - start.left - 420));
        if (edge === "bottom") next.bottom = clamp(start.bottom - (ev.clientY - sy), 120, Math.min(480, rect.height - 240));
        latest = next;
        body.style.setProperty("--left-w", `${next.left}px`);
        body.style.setProperty("--right-w", `${next.right}px`);
        body.style.setProperty("--bottom-h", `${next.bottom}px`);
        (_a = viewerRef.current) == null ? void 0 : _a.scheduleResize();
      };
      const up = () => {
        document.body.classList.remove("is-resizing");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        setLayout(latest);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    }, [model, layout]);
    const toggleBottom = useCallback(() => {
      setLayout((l) => ({ ...l, bottomCollapsed: !l.bottomCollapsed }));
      setTimeout(() => {
        var _a;
        return (_a = viewerRef.current) == null ? void 0 : _a.scheduleResize();
      }, 0);
    }, []);
    const setViewLayout = useCallback((l) => {
      setViewLayoutState(l);
      writeStorage(STORAGE.layoutMode, l);
      setTimeout(() => {
        var _a;
        return (_a = viewerRef.current) == null ? void 0 : _a.scheduleResize();
      }, 0);
    }, []);
    const layoutSwitch = /* @__PURE__ */ React.createElement(LayoutSwitch, { layout: viewLayout, setLayout: setViewLayout });
    const planLevelId = levelId !== "all" ? Number(levelId) : planLevel != null ? planLevel : navMap && navMap.grids[0] ? navMap.grids[0].levelId : building ? (building.levels.find((l) => l.spaceIds.length) || building.levels[0] || {}).id : null;
    const planLegs = planner === "grid" ? gridRoute ? gridRoute.legs.filter((l) => l.type === "walk") : [] : routeResult ? routeResult.steps.reduce((legs, st) => {
      const last = legs[legs.length - 1];
      if (last && last.levelId === st.levelId) last.points.push(st.position);
      else legs.push({ levelId: st.levelId, points: [st.position] });
      return legs;
    }, []) : [];
    const planTransitions = [];
    if (planner === "grid" && gridRoute) {
      gridRoute.legs.forEach((l, i) => {
        var _a, _b;
        if (l.type === "walk") return;
        const prev = gridRoute.legs[i - 1], next = gridRoute.legs[i + 1];
        const up = building && ((_a = building.levels.find((x) => x.id === l.toLevelId)) == null ? void 0 : _a.floorY) > ((_b = building.levels.find((x) => x.id === l.fromLevelId)) == null ? void 0 : _b.floorY);
        if (prev && prev.points) {
          const q = prev.points[prev.points.length - 1];
          planTransitions.push({ levelId: prev.levelId, x: q[0], z: q[2], up });
        }
        if (next && next.points) {
          const q = next.points[0];
          planTransitions.push({ levelId: next.levelId, x: q[0], z: q[2], up: !up });
        }
      });
    }
    const planTools = workspace === "simulate" ? [PLAN_TOOLS[0], { id: "mission", label: "Mission", icon: "Robot", title: "Click a start and then a goal to add a robot mission" }, PLAN_TOOLS[3], PLAN_TOOLS[4]] : PLAN_TOOLS;
    const planElement = model ? /* @__PURE__ */ React.createElement(
      PlanView,
      {
        model,
        building,
        navState,
        levelId: planLevelId,
        onLevelChange: (id) => {
          setPlanLevel(Number(id));
          if (levelId !== "all") onLevelChange(String(id), { frame: false });
        },
        theme,
        tool: clickMode,
        setTool: (t) => {
          nav.setClickMode(t);
          if (t !== "mission") setPendingMission(null);
        },
        tools: planTools,
        onMapPick,
        onSelectElement: (id, e) => id == null ? dispatch({ type: "clear-selection" }) : dispatch({ type: "select", ids: [id], multi: !!(e && (e.ctrlKey || e.metaKey || e.shiftKey)) }),
        layoutSwitch: viewLayout === "plan" ? layoutSwitch : null,
        workspace,
        selectedIds: viewerState.selectedIds,
        blocked,
        obstacles,
        zones: workspace === "navigate" || workspace === "simulate" && simApi.sim.current && simApi.sim.current.scenario.applyZones ? zones : [],
        pendingZone: workspace === "navigate" ? pendingZone : null,
        routeLegs: workspace === "navigate" ? planLegs : [],
        routeTransitions: workspace === "navigate" ? planTransitions : [],
        start: workspace === "navigate" ? startPt : null,
        goal: workspace === "navigate" ? goalPt : null,
        missions: workspace === "simulate" ? missions : [],
        missionPaths: workspace === "simulate" ? missionPaths : [],
        pendingMission: workspace === "simulate" ? pendingMission : null,
        cellInfo,
        sim: workspace === "simulate" ? simApi.sim.current : null,
        simRunning: workspace === "simulate" && simApi.status === "running",
        simStatus: simApi.status
      }
    ) : null;
    const bodyStyle = {
      "--left-w": `${layout.left}px`,
      "--right-w": `${layout.right}px`,
      "--bottom-h": layout.bottomCollapsed ? "40px" : `${layout.bottom}px`
    };
    return /* @__PURE__ */ React.createElement("div", { className: "app", "data-has-model": !!model }, /* @__PURE__ */ React.createElement(
      TopBar,
      {
        model,
        workspace,
        onWorkspace,
        onUpload,
        onLoadSample: loadSample,
        onClose: onCloseModel,
        onSearch,
        onOpenIntel: () => setModal("intel"),
        onHome: () => setShowHome(true),
        onOpenHelp: () => setModal("help"),
        theme,
        onToggleTheme: () => setTheme((t) => t === "dark" ? "light" : "dark"),
        searchRef
      }
    ), /* @__PURE__ */ React.createElement("input", { ref: fileInputRef, type: "file", accept: ".ifc", hidden: true, onChange: async (e) => {
      var _a;
      const f = (_a = e.target.files) == null ? void 0 : _a[0];
      e.target.value = "";
      await loadIfcFile(f);
    } }), /* @__PURE__ */ React.createElement("div", { className: "app-body", ref: bodyRef, style: bodyStyle, "data-collapsed": layout.bottomCollapsed }, model && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "resize-handle rh-left", role: "separator", "aria-orientation": "vertical", "aria-label": "Resize left panel", onPointerDown: (e) => startResize("left", e) }), /* @__PURE__ */ React.createElement("div", { className: "resize-handle rh-right", role: "separator", "aria-orientation": "vertical", "aria-label": "Resize inspector", onPointerDown: (e) => startResize("right", e) }), !layout.bottomCollapsed && /* @__PURE__ */ React.createElement("div", { className: "resize-handle rh-bottom", role: "separator", "aria-orientation": "horizontal", "aria-label": "Resize bottom panel", onPointerDown: (e) => startResize("bottom", e), onDoubleClick: () => setLayout((l) => ({ ...l, bottom: DEFAULT_LAYOUT.bottom })) })), workspace === "navigate" ? /* @__PURE__ */ React.createElement(NavigatePanel, { model, building, readiness, nav, route: routeResult, gridRoute, navState, gridInfo, onSelectIds: selectAndShow, onZoomTo, onFrameRoute }) : workspace === "simulate" ? /* @__PURE__ */ React.createElement(
      SimulatePanel,
      {
        model,
        building,
        navMap,
        nav,
        simApi,
        onSelectIds: selectAndShow,
        onFrameAt,
        missions,
        removeMission: (id) => setMissions((list) => list.filter((m) => m.id !== id)),
        clearMissions: () => {
          setMissions([]);
          setPendingMission(null);
        },
        pendingMission,
        pickingMission: clickMode === "mission",
        simRequest,
        onRequestHandled: () => setSimRequest(null),
        onPickMission: () => {
          if (clickMode === "mission") {
            setClickMode("select");
            setPendingMission(null);
            return;
          }
          setClickMode("mission");
          if (viewLayout === "3d") setViewLayout("split");
        },
        theme
      }
    ) : /* @__PURE__ */ React.createElement(LeftSidebar, { model, viewerState, dispatch, onPick, onZoomTo, onContext, onSaveView, onRestoreView, tab: leftTab, setTab: setLeftTab }), /* @__PURE__ */ React.createElement(
      ViewerCanvas,
      {
        model,
        viewerRef,
        viewerState,
        dispatch,
        toast,
        theme,
        viewMode,
        setViewMode,
        showEdges,
        setShowEdges,
        showAxes,
        setShowAxes,
        showSpaces,
        setShowSpaces,
        explode,
        setExplode,
        sectionEnabled,
        toggleSection,
        sectionBox,
        setSectionBox,
        measureMode,
        toggleMeasure,
        annoMode,
        toggleAnno,
        levelId,
        onLevelChange,
        planCut,
        togglePlanCut,
        slabsTransparent,
        onToggleSlabs,
        onFocusGroup,
        onResetFilters,
        onPickEvent,
        onContextEvent,
        workspace,
        building,
        layout: viewLayout,
        layoutSwitch,
        planElement,
        hint: clickMode === "start" ? "Click the floor grid or the plan to place the route start. Esc to stop." : clickMode === "goal" ? "Click the floor grid or the plan to place the route goal. Esc to stop." : clickMode === "mission" ? pendingMission ? "Now click the mission goal." : "Click a mission start on the floor grid or the plan." : workspace === "navigate" ? clickMode === "inspect" ? "Click a grid cell to see which IFC element and step decided it. Esc to stop." : clickMode === "obstacle" ? "Click the grid to place or remove a what-if obstacle. Esc to stop." : /^zone-/.test(clickMode) ? pendingZone ? "Now click the opposite corner of the zone." : `Click one corner of the ${clickMode === "zone-nogo" ? "no-go" : "slow"} zone. Esc to stop.` : planner === "graph" ? "Click a graph node to inspect the IFC element it came from." : null : workspace === "simulate" && simApi.status === "running" ? `Simulating at ${simApi.speed}\xD7 speed` : null
      }
    ), /* @__PURE__ */ React.createElement(Inspector, { model, building, nav, viewerState, dispatch, onZoomTo, toast, onSelect: (id) => dispatch({ type: "select", ids: [id] }) }), /* @__PURE__ */ React.createElement(
      BottomPanel,
      {
        model,
        viewerState,
        dispatch,
        log,
        onPick,
        onZoomTo,
        toast,
        collapsed: layout.bottomCollapsed,
        onToggleCollapsed: toggleBottom,
        viewerRef,
        secondaryReady
      }
    ), (!model || showHome) && !loading && /* @__PURE__ */ React.createElement(StartScreen, { onUpload, onLoadFile: loadIfcFile, onLoadSample: loadSample, currentModel: model, onResume: () => setShowHome(false) }), loading && /* @__PURE__ */ React.createElement(LoadingOverlay, { fileName: loading.fileName, progress: loading.progress, phase: loading.phase, log })), modal === "intel" && model && /* @__PURE__ */ React.createElement(IntelligenceDashboard, { model, building, readiness, onClose: () => setModal(null), onSelectIds: (ids) => {
      selectAndShow(ids);
      setModal(null);
    }, onOpenNavigate: () => {
      setModal(null);
      onWorkspace("navigate");
    } }), modal === "help" && /* @__PURE__ */ React.createElement(HelpPanel, { onClose: () => setModal(null) }), model && /* @__PURE__ */ React.createElement(ContextMenu, { menu: contextMenu, onClose: () => setContextMenu(null), dispatch, onZoomTo, model, toast, nav }), /* @__PURE__ */ React.createElement(ToastContainer, { toasts, onDismiss: dismissToast }));
  }
  const root = ReactDOM.createRoot(document.getElementById("root"));
  root.render(/* @__PURE__ */ React.createElement(App, null));
})();
