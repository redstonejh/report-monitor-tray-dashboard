(() => {
  const DEFAULT_DENSITY_TIERS = ["tiny", "compact", "standard", "expanded", "rich"];
  const WORKSPACE_WIDGET_LAYERS = new Set(["presentation", "backend", "both"]);

  const createUnsupportedDefinition = (type, escapeHtml) => ({
    type: String(type || "unsupported"),
    displayName: "Unsupported Widget",
    widgetType: String(type || "unsupported"),
    dashboardObjectKind: "unsupported-widget",
    regionRole: "content",
    htmlTag: "div",
    className: "stat-card widget-card widget-card-custom unsupported-widget-card",
    layer: "presentation",
    defaultSize: { cols: 1, rows: 1 },
    minSize: { cols: 1, rows: 1 },
    capabilities: { supportsResize: true },
    supportedSettings: ["title", "color", "pin", "delete"],
    getDefaultConfig: () => ({ title: `Unsupported: ${type || "unknown"}` }),
    render: ({ instance }) => `
      <div class="unsupported-widget-state widget-inline-state" role="status">
        <span class="stat-val">Unsupported widget</span>
        <span class="stat-lbl">${escapeHtml(instance.type || type || "unknown")}</span>
      </div>`,
  });

  const uniqueValues = (values = []) => [...new Set(values.filter((value) => value != null && String(value).trim()))];

  const createRuntime = (deps = {}) => {
    const registry = window.dashboardWidgetRuntime || null;
    const bodyRendererCleanups = new WeakMap();
    const widgetDataStore = new Map();
    const escapeHtml = deps.escapeHtml || ((value) => String(value ?? ""));
    const parseJsonRecord = deps.parseJsonRecord || ((value, fallback = {}) => {
      if (!value) return fallback;
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
      } catch {
        return fallback;
      }
    });
    const densityTiers = registry?.densityTiers?.() || DEFAULT_DENSITY_TIERS;

    const definitionFor = (type) => registry?.getWidgetDefinition?.(type) || createUnsupportedDefinition(type, escapeHtml);
    const runtimeTypeFromElement = (widget) => (
      widget?.dataset?.widgetRuntimeType ||
      widget?.dataset?.widgetDefinition ||
      widget?.dataset?.dashboardObjectKind ||
      widget?.dataset?.widgetType ||
      "stat"
    );
    const definitionForElement = (widget) => definitionFor(runtimeTypeFromElement(widget));
    const normalizeWorkspaceWidgetLayer = (value, fallback = "presentation") => (
      WORKSPACE_WIDGET_LAYERS.has(value) ? value : fallback
    );
    const layerForElement = (widget, definition = definitionForElement(widget)) => (
      normalizeWorkspaceWidgetLayer(widget?.dataset?.widgetLayer || definition?.layer, "presentation")
    );
    const applyLayerMetadata = (widget, definition = definitionForElement(widget), explicitLayer = "") => {
      if (!widget) return "presentation";
      const layer = normalizeWorkspaceWidgetLayer(explicitLayer || widget.dataset.widgetLayer || definition?.layer, "presentation");
      widget.dataset.widgetLayer = layer;
      widget.dataset.workspaceLayer = layer === "backend" ? "backend" : "presentation";
      widget.classList.toggle("workspace-backend-widget", layer === "backend");
      widget.classList.toggle("workspace-presentation-widget", layer !== "backend");
      return layer;
    };
    const parseConfig = (value) => parseJsonRecord(value, {}) || {};
    const setConfig = (widget, config) => {
      if (!widget) return;
      widget.dataset.widgetConfig = JSON.stringify(config || {});
    };
    const setLinkNavigationSuspended = (widget, suspended) => {
      if (!widget || widget.tagName !== "A") return;
      if (suspended) {
        if (widget.hasAttribute("href") && !widget.dataset.widgetSuspendedHref) {
          widget.dataset.widgetSuspendedHref = widget.getAttribute("href") || "";
          widget.removeAttribute("href");
        }
        return;
      }
      if (widget.dataset.widgetSuspendedHref !== undefined) {
        if (widget.dataset.widgetSuspendedHref) widget.setAttribute("href", widget.dataset.widgetSuspendedHref);
        delete widget.dataset.widgetSuspendedHref;
      }
    };
    const configFromElement = (widget, definition = definitionForElement(widget)) => {
      const defaults = typeof definition.getDefaultConfig === "function" ? definition.getDefaultConfig() : {};
      const current = parseConfig(widget?.dataset?.widgetConfig);
      const label = widget?.querySelector?.(".stat-lbl, .range-search-label")?.textContent?.trim();
      const value = widget?.querySelector?.(".stat-val")?.textContent?.trim();
      return {
        ...defaults,
        ...(label && !current.title ? { title: label } : {}),
        ...(value && !current.value ? { value } : {}),
        ...current,
      };
    };
    const normalizeWidgetData = (data) => {
      if (Array.isArray(data)) return { rows: data };
      if (data && typeof data === "object") {
        return {
          ...data,
          rows: Array.isArray(data.rows) ? data.rows : [],
        };
      }
      return { rows: [] };
    };
    const normalizeIngestEntry = (entry) => {
      if (Array.isArray(entry)) return { data: normalizeWidgetData(entry), config: null };
      if (!entry || typeof entry !== "object") return { data: normalizeWidgetData(entry), config: null };
      const hasConfig = entry.config && typeof entry.config === "object" && !Array.isArray(entry.config);
      const { config, ...data } = entry;
      const hasData = Object.keys(data).some((key) => data[key] !== undefined);
      return {
        data: hasData ? normalizeWidgetData(data) : null,
        config: hasConfig ? { ...config } : null,
      };
    };
    const widgetDataKeys = (widget, definition = definitionForElement(widget)) => uniqueValues([
      widget?.dataset?.widgetKey,
      widget?.dataset?.contextOverrideId,
      definition?.type ? `type:${definition.type}` : "",
      "*",
    ]);
    const dataForWidget = (widget, definition = definitionForElement(widget), instance = null, explicitData = null) => {
      if (explicitData != null) return normalizeWidgetData(explicitData);
      const stored = widgetDataKeys(widget, definition)
        .map((key) => widgetDataStore.get(key))
        .find((entry) => entry?.data != null);
      if (stored?.data != null) return normalizeWidgetData(stored.data);
      return normalizeWidgetData(instance?.data || { rows: [] });
    };
    const configPatchForWidget = (widget, definition = definitionForElement(widget), explicitConfig = null) => {
      const patches = widgetDataKeys(widget, definition)
        .slice()
        .reverse()
        .map((key) => widgetDataStore.get(key)?.config)
        .filter((config) => config && typeof config === "object" && !Array.isArray(config));
      if (explicitConfig && typeof explicitConfig === "object" && !Array.isArray(explicitConfig)) {
        patches.push(explicitConfig);
      }
      return patches.length ? Object.assign({}, ...patches) : null;
    };
    const applyConfigPatchForWidget = (widget, definition = definitionForElement(widget), explicitConfig = null) => {
      const patch = configPatchForWidget(widget, definition, explicitConfig);
      if (!patch) return null;
      const nextConfig = {
        ...configFromElement(widget, definition),
        ...patch,
      };
      setConfig(widget, nextConfig);
      return nextConfig;
    };
    const setConfigValue = (widget, key, value) => {
      if (!widget || !key) return;
      setConfig(widget, {
        ...configFromElement(widget),
        [key]: value,
      });
    };
    const availableSizeForDensity = (widget) => {
      if (!widget?.getBoundingClientRect) return { width: 0, height: 0, panelContained: false };
      const rect = widget.getBoundingClientRect();
      const tools = widget.querySelector(":scope > .widget-tools");
      const controlReserve = tools ? Math.min(44, Math.max(0, rect.width * 0.24)) : 0;
      return {
        width: Math.max(0, rect.width - controlReserve),
        height: Math.max(0, rect.height),
        panelContained: Boolean(deps.isPanelInternalGridItem?.(widget)),
      };
    };
    const applyDensityMetadata = (widget, density) => {
      if (!widget || !density) return;
      densityTiers.forEach((tier) => widget.classList.remove(`widget-density-${tier}`));
      widget.classList.add(`widget-density-${density}`);
      widget.dataset.density = density;
      widget.dataset.widgetDensity = density;
    };
    const resolveDensityForElement = (widget, definition = definitionForElement(widget), availableSize = availableSizeForDensity(widget)) => (
      registry?.resolveWidgetDensity?.({
        cols: Number(widget?.dataset?.currentSpan || widget?.dataset?.defaultSpan) || definition.defaultSize?.cols || 1,
        rows: Number(widget?.dataset?.gridRowSpan) || definition.defaultSize?.rows || 1,
        parentPanelId: widget?.dataset?.parentPanelKey || null,
      }, availableSize, definition) || "standard"
    );
    const rowDateValue = (row, field = "") => {
      const fields = field
        ? [field]
        : ["date", "time", "timestamp", "createdAt", "created_at", "updatedAt", "updated_at"];
      for (const key of fields) {
        const raw = row?.[key];
        if (raw == null || raw === "") continue;
        const timestamp = raw instanceof Date ? raw.getTime() : Date.parse(String(raw));
        if (Number.isFinite(timestamp)) return timestamp;
      }
      return null;
    };
    const scopedDataForTimeRange = (data, timeRange, definition) => {
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      if (!definition?.capabilities?.supportsTimeRange || (!timeRange?.start && !timeRange?.end) || !rows.length) {
        return data && typeof data === "object" ? data : { rows };
      }
      // A bare date ("YYYY-MM-DD") is widened to the whole local day; a full ISO
      // datetime (sub-day presets like the last hour) is honoured as-is.
      const parseBound = (v, dayEnd) => {
        if (!v) return dayEnd ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
        return String(v).includes("T") ? Date.parse(v) : Date.parse(`${v}T${dayEnd ? "23:59:59.999" : "00:00:00"}`);
      };
      const start = parseBound(timeRange.start, false);
      const end = parseBound(timeRange.end, true);
      if (!Number.isFinite(start) && !Number.isFinite(end)) return data;
      const field = String(timeRange.field || "").trim();
      return {
        ...(data && typeof data === "object" ? data : {}),
        rows: rows.filter((row) => {
          const timestamp = rowDateValue(row, field);
          return timestamp == null || (timestamp >= start && timestamp <= end);
        }),
        timeRange,
      };
    };
    const instanceFromElement = (widget, definition = definitionForElement(widget)) => registry?.createWidgetInstance?.(definition, {
      availableSize: availableSizeForDensity(widget),
      density: resolveDensityForElement(widget, definition),
      parentPanelId: widget?.dataset?.parentPanelKey || null,
      id: widget?.dataset?.widgetKey || "",
      type: definition.type,
      x: Number(widget?.dataset?.gridCol) || 1,
      y: Number(widget?.dataset?.gridRow) || 1,
      cols: Number(widget?.dataset?.currentSpan || widget?.dataset?.defaultSpan) || definition.defaultSize?.cols || 1,
      rows: Number(widget?.dataset?.gridRowSpan) || definition.defaultSize?.rows || 1,
      layer: layerForElement(widget, definition),
      config: configFromElement(widget, definition),
      displayState: deps.resolveWidgetDisplayState?.(widget),
      contextOverrideId: widget?.dataset?.contextOverrideId || null,
    }) || {
      id: widget?.dataset?.widgetKey || "",
      type: definition.type,
      x: Number(widget?.dataset?.gridCol) || 1,
      y: Number(widget?.dataset?.gridRow) || 1,
      cols: Number(widget?.dataset?.currentSpan || widget?.dataset?.defaultSpan) || definition.defaultSize?.cols || 1,
      rows: Number(widget?.dataset?.gridRowSpan) || definition.defaultSize?.rows || 1,
      config: configFromElement(widget, definition),
      displayState: deps.resolveWidgetDisplayState?.(widget),
      density: resolveDensityForElement(widget, definition),
      availableSize: availableSizeForDensity(widget),
      parentPanelId: widget?.dataset?.parentPanelKey || null,
      contextOverrideId: widget?.dataset?.contextOverrideId || null,
    };
    const setRuntimeContent = (widget, html) => {
      if (!widget) return;
      cleanupWidgetBodyRenderer(widget, { reason: "content-replace" });
      const widgetKey = widget.dataset.widgetKey || "";
      if (widgetKey) {
        document.querySelectorAll(`.workspace-menu-overlay-layer > [data-timeframe-widget-key="${CSS.escape(widgetKey)}"]`)
          .forEach((menu) => menu.remove());
      }
      const preserved = [...widget.children].filter((child) => (
        child.classList.contains("widget-tools") ||
        child.classList.contains("workspace-context-badge") ||
        child.classList.contains("dashboard-pinned-indicator")
      ));
      [...widget.children].forEach((child) => {
        if (!preserved.includes(child) && child.parentElement === widget) {
          try {
            child.remove();
          } catch {
            // A focused native control can move during blur while the runtime surface rerenders.
          }
        }
      });
      const template = document.createElement("template");
      template.innerHTML = html || "";
      const firstPreserved = preserved[0] || null;
      [...template.content.childNodes].forEach((node) => widget.insertBefore(node, firstPreserved));
    };
    const cleanupWidgetBodyRenderer = (widget, details = {}) => {
      if (!widget) return;
      const cleanup = bodyRendererCleanups.get(widget);
      if (typeof cleanup === "function") {
        try {
          cleanup({ widget, ...details });
        } catch (error) {
          console.warn("Widget body renderer cleanup failed", error);
        }
      }
      bodyRendererCleanups.delete(widget);
      const definition = details.definition || definitionForElement(widget);
      if (typeof definition?.unmountBodyRenderer === "function") {
        try {
          definition.unmountBodyRenderer({
            widget,
            contentRoot: widget.querySelector(":scope [data-widget-shell-content='true']") ||
              widget.querySelector(":scope .widget-shell-content") ||
              widget,
            definition,
            type: definition.type || runtimeTypeFromElement(widget),
            config: details.instance?.config || configFromElement(widget, definition),
            instance: details.instance || null,
            reason: details.reason || "cleanup",
          });
        } catch (error) {
          console.warn("Widget body renderer unmount failed", error);
        }
      }
    };
    const mountWidgetBodyRenderer = (widget, context = {}) => {
      if (!widget) return null;
      const definition = context.definition || definitionForElement(widget);
      const contentRoot = widget.querySelector(":scope [data-widget-shell-content='true']") ||
        widget.querySelector(":scope .widget-shell-content") ||
        widget;
      const mountContext = {
        widget,
        contentRoot,
        definition,
        type: definition?.type || context.instance?.type || runtimeTypeFromElement(widget),
        instance: context.instance || null,
        config: context.instance?.config || configFromElement(widget, definition),
      };
      const mount = typeof definition?.mountBodyRenderer === "function"
        ? definition.mountBodyRenderer
        : typeof deps.mountWidgetBodyRenderer === "function"
          ? deps.mountWidgetBodyRenderer
          : window.dashboardWidgetBodyRendererRuntime?.mount;
      if (typeof mount !== "function") return null;
      try {
        const cleanup = mount(mountContext);
        if (typeof cleanup === "function") {
          bodyRendererCleanups.set(widget, cleanup);
        } else if (cleanup && typeof cleanup.cleanup === "function") {
          bodyRendererCleanups.set(widget, cleanup.cleanup);
        }
        return cleanup || null;
      } catch (error) {
        console.warn("Widget body renderer mount failed", error);
        return null;
      }
    };
    const renderRuntimeContent = (widget, options = {}) => {
      if (!widget?.classList?.contains("widget-card")) return;
      const definition = definitionForElement(widget);
      applyConfigPatchForWidget(widget, definition, options.config);
      const instance = instanceFromElement(widget, definition);
      const displayState = deps.resolveWidgetDisplayState?.(widget) || instance.displayState || null;
      applyDensityMetadata(widget, instance.density || "standard");
      const mediaState = deps.mediaWidgetAssetState?.(widget, instance.config, definition) || { persistedConfig: instance.config, renderConfig: instance.config };
      const persistedConfig = deps.isMediaWidgetDefinition?.(definition) ? mediaState.persistedConfig : instance.config;
      setConfig(widget, persistedConfig);
      let renderInstance = deps.isMediaWidgetDefinition?.(definition)
        ? { ...instance, config: mediaState.renderConfig }
        : instance;
      renderInstance = {
        ...renderInstance,
        displayState,
        timeRange: displayState?.timeRange || null,
        data: scopedDataForTimeRange(dataForWidget(widget, definition, renderInstance, options.data), displayState?.timeRange, definition),
      };
      if (deps.isSignalConsumerWidget?.(widget, definition)) {
        const signalState = deps.signalStateForWidget?.(widget) || {};
        renderInstance = {
          ...renderInstance,
          config: {
            ...renderInstance.config,
            _signalActive: signalState.active,
            _signalConnected: signalState.connected,
            _signalIncomingCount: signalState.incomingCount,
            _signalSourceIds: signalState.sourceIds || [],
            _signalSourceLabels: signalState.sourceLabels || [],
            _signalLinkIds: signalState.linkIds || [],
            _signalActiveLinkId: signalState.activeLinkId || "",
            _timeRange: renderInstance.timeRange || null,
          },
        };
        deps.applySignalConsumerState?.(widget, signalState, renderInstance.config);
      } else {
        deps.clearSignalConsumerState?.(widget);
      }
      const html = registry?.renderWidget?.(definition, {
        instance: renderInstance,
        definition,
        data: renderInstance.data,
      }) || definition.render({ instance: renderInstance, definition });
      widget.dataset.widgetShell = definition.shell === false ? "legacy" : "shared";
      setRuntimeContent(widget, html);
      mountWidgetBodyRenderer(widget, {
        definition,
        instance: renderInstance,
      });
      deps.applyStyleRulesForWidget?.(widget, {
        definition,
        instance: renderInstance,
      });
    };
    const refreshWidgetData = (widget) => {
      if (!widget?.classList?.contains("widget-card")) return;
      renderRuntimeContent(widget);
    };
    // Re-rendering every widget on each ingest (every ~250ms) is the dashboard's
    // dominant cost. Two guards make it cheap: (1) when the dashboard window is
    // hidden (it's a tray app — usually backgrounded) skip entirely and just mark
    // a pending refresh, flushed when it becomes visible again; (2) coalesce a
    // burst of ingests into a single requestAnimationFrame so N pings in one frame
    // cause one render, not N.
    const doRefreshAllWidgetData = () => {
      document.querySelectorAll(".widget-card").forEach(refreshWidgetData);
    };
    let refreshScheduled = false;
    let refreshPendingWhileHidden = false;
    const refreshAllWidgetData = () => {
      if (typeof document !== "undefined" && document.hidden) {
        refreshPendingWhileHidden = true;
        return;
      }
      if (refreshScheduled) return;
      refreshScheduled = true;
      const run = () => {
        refreshScheduled = false;
        if (typeof document !== "undefined" && document.hidden) {
          refreshPendingWhileHidden = true;
          return;
        }
        doRefreshAllWidgetData();
      };
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
      else run();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden && refreshPendingWhileHidden) {
          refreshPendingWhileHidden = false;
          refreshAllWidgetData();
        }
      });
    }
    const setWidgetData = (key, data, options = {}) => {
      const normalizedKey = String(key || "").trim();
      if (!normalizedKey) return false;
      widgetDataStore.set(normalizedKey, normalizeIngestEntry(data));
      if (options.refresh !== false) refreshAllWidgetData();
      return true;
    };
    const clearWidgetData = (key = "", options = {}) => {
      const normalizedKey = String(key || "").trim();
      if (normalizedKey) {
        widgetDataStore.delete(normalizedKey);
      } else {
        widgetDataStore.clear();
      }
      if (options.refresh !== false) refreshAllWidgetData();
    };
    const ingestWidgetData = (payload = {}, options = {}) => {
      if (!payload || typeof payload !== "object") return false;
      const entries = [];
      if (payload.default !== undefined) entries.push(["*", payload.default]);
      Object.entries(payload.types || {}).forEach(([type, data]) => entries.push([`type:${type}`, data]));
      Object.entries(payload.contexts || payload.contextData || {}).forEach(([key, data]) => entries.push([key, data]));
      Object.entries(payload.widgets || payload.widgetData || {}).forEach(([key, data]) => entries.push([key, data]));
      entries.forEach(([key, data]) => widgetDataStore.set(String(key), normalizeIngestEntry(data)));
      if (options.refresh !== false) refreshAllWidgetData();
      return true;
    };
    const queryForWidget = (widget) => {
      if (!widget?.classList?.contains("widget-card")) return null;
      const definition = definitionForElement(widget);
      const instance = instanceFromElement(widget, definition);
      return registry?.dataRequestForWidget?.(definition, instance) ||
        registry?.dataRequestForInstance?.(definition, instance) ||
        null;
    };
    const queryAllWidgets = () => [...document.querySelectorAll(".widget-card")]
      .map(queryForWidget)
      .filter(Boolean);
    const hydrateRuntime = (widget, saved = null) => {
      if (!widget?.classList?.contains("widget-card")) return null;
      if (saved?.runtimeType) widget.dataset.widgetRuntimeType = saved.runtimeType;
      if (saved?.type && !widget.dataset.widgetRuntimeType) widget.dataset.widgetRuntimeType = saved.type;
      const definition = definitionForElement(widget);
      applyLayerMetadata(widget, definition, saved?.widgetLayer || saved?.layer || "");
      widget.dataset.widgetRuntimeType = definition.type;
      widget.dataset.widgetDefinition = definition.type;
      widget.dataset.widgetDisplayName = definition.displayName || definition.type;
      widget.dataset.widgetType = definition.widgetType || widget.dataset.widgetType || definition.type;
      widget.dataset.dashboardObjectKind = definition.dashboardObjectKind || widget.dataset.dashboardObjectKind || definition.type;
      widget.dataset.regionRole = definition.regionRole || widget.dataset.regionRole || "content";
      widget.dataset.widgetCapabilities = JSON.stringify(definition.capabilities || {});
      widget.dataset.widgetSupportedSettings = JSON.stringify(definition.supportedSettings || []);
      widget.dataset.widgetSettingsSchema = JSON.stringify(definition.settingsSchema || { sections: [] });
      if (!widget.dataset.defaultSpan) widget.dataset.defaultSpan = String(definition.defaultSize?.cols || 1);
      if (!widget.dataset.minW && definition.minSize?.cols) widget.dataset.minW = String(definition.minSize.cols);
      if (!widget.dataset.minH && definition.minSize?.rows > 1) widget.dataset.minH = String(definition.minSize.rows);
      if (definition.capabilities?.supportsResize === false) widget.dataset.resizable = "false";
      if (!widget.dataset.widgetConfig) setConfig(widget, configFromElement(widget, definition));
      renderRuntimeContent(widget);
      deps.syncWidgetContextOutputs?.(widget);
      return definition;
    };
    const ensureTools = (widget, theme = "") => {
      if (widget.querySelector(".widget-tools")) return;
      widget.insertAdjacentHTML("beforeend", `
        <div class="widget-tools" aria-label="Widget tools">
          <div class="panel-tool-drawer widget-tool-drawer">
            ${deps.panelToolButtonsMarkup?.(theme, true) || ""}
          </div>
          <div class="widget-workbench-panel" role="dialog" aria-label="Widget workbench" hidden></div>
        </div>`);
    };
    const syncRenderedHeightToFootprint = (widget, rowSpan = null, metrics = null) => {
      if (!deps.isWidgetGridItem?.(widget)) return;
      // Panel-internal grids carry their own (smaller) row height and gap;
      // resolving only ".widget-layout" here made panel children compute their
      // pixel height from the workspace metrics (81px rows + 16px gap) instead
      // of the panel's (66px + 10px), so vertical sizing drifted off the grid.
      const layout = widget.closest(".widget-layout, .panel-internal-widget-grid");
      const gap = metrics?.gap ?? deps.gridGapForLayout?.(layout);
      const rowHeight = metrics?.rowHeight ?? deps.gridRowHeightForLayout?.(layout);
      const rows = Math.max(deps.gridItemMinimumRows?.(widget) || 1, Math.round(Number(rowSpan) || deps.gridItemRowSpan?.(widget, metrics) || 1));
      widget.dataset.gridRowSpan = String(rows);
      if (rows > 1 || widget.classList.contains("widget-placeholder")) {
        widget.style.height = `${deps.gridHeightForRows?.(rows, gap, rowHeight)}px`;
      } else {
        widget.style.removeProperty("height");
      }
    };
    const applySpan = (widget, span) => {
      const rawSpan = Number(span) || Number(widget.dataset.defaultSpan) || 1;
      const minSpan = deps.gridItemMinimumSpan?.(widget) || 1;
      const safeSpan = Math.max(minSpan, Math.min(6, rawSpan > 6 ? rawSpan / 2 : rawSpan));
      const displaySpan = Math.round(safeSpan);
      const rowSpan = deps.gridItemRowSpan?.(widget) || 1;
      widget.dataset.currentSpan = String(displaySpan);
      if (widget.dataset.gridCol && widget.dataset.gridRow) {
        const currentCol = Number(widget.dataset.gridCol) || 1;
        const currentRow = Number(widget.dataset.gridRow) || 1;
        const safeCol = Math.max(1, Math.min(7 - displaySpan, currentCol));
        widget.dataset.gridCol = String(safeCol);
        widget.dataset.gridRow = String(Math.max(1, currentRow));
        widget.dataset.gridRowSpan = String(rowSpan);
        widget.style.gridColumn = `${safeCol} / span ${displaySpan}`;
        widget.style.gridRow = `${widget.dataset.gridRow} / span ${rowSpan}`;
      } else {
        widget.style.gridColumn = `span ${displaySpan}`;
        widget.style.removeProperty("grid-row");
      }
      widget.style.removeProperty("width");
      widget.style.removeProperty("flex-basis");
      syncRenderedHeightToFootprint(widget, rowSpan);
    };
    const applyGridPosition = (widget, col, row, rowSpan = null) => {
      const span = Number(widget.dataset.currentSpan) || Number(widget.dataset.defaultSpan) || 1;
      const safeSpan = Math.max(1, Math.min(6, span > 6 ? span / 2 : span));
      const safeCol = Math.max(1, Math.min(7 - safeSpan, Math.round(Number(col) || 1)));
      const safeRow = Math.max(1, Math.round(Number(row) || 1));
      const safeRows = Math.max(deps.gridItemMinimumRows?.(widget) || 1, Math.round(Number(rowSpan) || deps.gridItemRowSpan?.(widget) || 1));
      widget.dataset.gridCol = String(safeCol);
      widget.dataset.gridRow = String(safeRow);
      widget.dataset.gridRowSpan = String(safeRows);
      widget.style.gridColumn = `${safeCol} / span ${Math.round(safeSpan)}`;
      widget.style.gridRow = `${safeRow} / span ${safeRows}`;
      syncRenderedHeightToFootprint(widget, safeRows);
      if (widget.classList.contains("widget-card")) {
        applyDensityMetadata(widget, resolveDensityForElement(widget));
      }
    };
    const createCustomWidget = (definition) => {
      const runtimeDefinition = definitionFor(definition.runtimeType || definition.widgetRuntimeType || definition.dashboardObjectKind || definition.type || "stat");
      const defaultConfig = typeof runtimeDefinition.getDefaultConfig === "function" ? runtimeDefinition.getDefaultConfig() : {};
      const config = {
        ...defaultConfig,
        ...parseConfig(definition.config),
        ...(definition.title ? { title: definition.title } : {}),
        ...(definition.value != null ? { value: definition.value } : {}),
      };
      const safeTitle = escapeHtml(config.title || runtimeDefinition.displayName || "Widget");
      const tagName = runtimeDefinition.htmlTag || "div";
      const widget = document.createElement(tagName);
      widget.className = runtimeDefinition.className || "stat-card widget-card widget-card-custom";
      if (tagName === "nav") {
        widget.setAttribute("aria-label", definition.ariaLabel || runtimeDefinition.ariaLabel || safeTitle);
      } else if (tagName !== "a") {
        widget.setAttribute("role", definition.role || "group");
        widget.setAttribute("aria-label", definition.ariaLabel || runtimeDefinition.ariaLabel || safeTitle);
      } else {
        widget.href = definition.href || window.location.pathname + window.location.search;
      }
      widget.dataset.widgetKey = definition.key;
      widget.dataset.widgetRuntimeType = runtimeDefinition.type;
      widget.dataset.widgetDefinition = runtimeDefinition.type;
      widget.dataset.widgetType = definition.type || runtimeDefinition.widgetType || runtimeDefinition.type;
      applyLayerMetadata(widget, runtimeDefinition, definition.widgetLayer || definition.layer || "");
      widget.dataset.defaultSpan = String(definition.span || runtimeDefinition.defaultSize?.cols || 1);
      widget.dataset.gridRowSpan = String(definition.rowSpan || definition.rows || runtimeDefinition.defaultSize?.rows || 1);
      if (definition.gridCol) widget.dataset.gridCol = String(definition.gridCol);
      if (definition.gridRow) widget.dataset.gridRow = String(definition.gridRow);
      if (definition.minW || runtimeDefinition.minSize?.cols) widget.dataset.minW = String(definition.minW || runtimeDefinition.minSize.cols);
      if (definition.minH || runtimeDefinition.minSize?.rows > 1) widget.dataset.minH = String(definition.minH || runtimeDefinition.minSize.rows);
      if (definition.locked) widget.dataset.locked = "true";
      if (definition.resizable === false || runtimeDefinition.capabilities?.supportsResize === false) widget.dataset.resizable = "false";
      setConfig(widget, config);
      widget.dataset.customWidget = "true";
      deps.ensureWorkspaceObjectMetadata?.(widget, {
        ...definition,
        workspaceObjectType: deps.WORKSPACE_OBJECT_TYPES?.widget,
        dashboardObjectKind: definition.dashboardObjectKind || runtimeDefinition.dashboardObjectKind || runtimeDefinition.type,
        regionRole: definition.regionRole || runtimeDefinition.regionRole || "content",
        navigationTargetType: definition.navigationTargetType,
        navigationTargetId: definition.navigationTargetId,
      });
      hydrateRuntime(widget);
      return widget;
    };

    window.dashboardWidgetDataRuntime = Object.freeze({
      ingest: ingestWidgetData,
      setWidgetData,
      clearWidgetData,
      refreshWidget: refreshWidgetData,
      refreshAll: refreshAllWidgetData,
      dataForWidget,
      configPatchForWidget,
      queryForWidget,
      queryAllWidgets,
    });

    return Object.freeze({
      registry,
      definitionFor,
      runtimeTypeFromElement,
      definitionForElement,
      normalizeWorkspaceWidgetLayer,
      layerForElement,
      applyLayerMetadata,
      parseConfig,
      setConfig,
      setConfigValue,
      setLinkNavigationSuspended,
      configFromElement,
      availableSizeForDensity,
      applyDensityMetadata,
      resolveDensityForElement,
      instanceFromElement,
      setRuntimeContent,
      mountWidgetBodyRenderer,
      cleanupWidgetBodyRenderer,
      renderRuntimeContent,
      hydrateRuntime,
      dataForWidget,
      configPatchForWidget,
      setWidgetData,
      clearWidgetData,
      ingestWidgetData,
      refreshWidgetData,
      refreshAllWidgetData,
      queryForWidget,
      queryAllWidgets,
      ensureTools,
      syncRenderedHeightToFootprint,
      applySpan,
      applyGridPosition,
      createCustomWidget,
    });
  };

  window.dashboardWidgetRuntimeController = Object.freeze({ createRuntime });
})();
