export const initializePersistedWorkspaceRuntime = ({
  PERSISTED_WORKSPACE_VERSION,
  getActivePanelProfile,
  syncWorkspaceRegions,
  workspaceObjectType,
  WORKSPACE_OBJECT_TYPES,
  widgetDefinitionForElement,
  widgetInstanceFromElement,
  mediaWidgetAssetState,
  isMediaWidgetDefinition,
  setWidgetConfig,
  widgetLayerForElement,
  gridBoundsForItem,
  serializableExpansionBaselineState,
  expansionBaselineSnapshotForLayoutKey,
  activeLayoutKeyForItem,
  workspaceObjectPersistence,
  workspaceObjectKey,
  undoTransientItemClasses,
  panelChildWidgets,
  loadAssets,
  widgetRuntime,
  writeJsonStore,
  readJsonStore,
  persistedWorkspaceKey,
}) => {
  const canonicalWidgetInstanceForPersistence = (widget, parentPanel = null) => {
    const definition = widgetDefinitionForElement(widget);
    const instance = widgetInstanceFromElement(widget, definition);
    const mediaState = mediaWidgetAssetState(widget, instance.config || {}, definition);
    const config = isMediaWidgetDefinition(definition) ? mediaState.persistedConfig : instance.config || {};
    if (mediaState.changed) setWidgetConfig(widget, config);
    const parentPanelId = parentPanel?.dataset?.panelKey || widget.dataset.parentPanelKey || null;
    return {
      id: instance.id || widget.dataset.widgetKey || "",
      type: instance.type || definition.type || "unsupported",
      layer: widgetLayerForElement(widget, definition),
      layoutDomain: parentPanelId ? "panel-internal-grid" : "global-workspace-grid",
      parentPanelId,
      x: instance.x,
      y: instance.y,
      cols: instance.cols,
      rows: instance.rows,
      config,
      color: widget.dataset.panelColor || null,
      colorCleared: widget.dataset.panelColorCleared === "true",
      colorUser: widget.dataset.panelColorUser === "true",
      title: widget.dataset.panelTitle || instance.config?.title || null,
      pinned: widget.classList.contains("db-panel-pinned"),
      locked: widget.dataset.locked === "true",
      resizable: widget.dataset.resizable === "false" ? false : true,
      minSize: {
        cols: Number(widget.dataset.minW) || definition.minSize?.cols || 1,
        rows: Number(widget.dataset.minH) || definition.minSize?.rows || 1,
      },
      workspaceObjectType: WORKSPACE_OBJECT_TYPES.widget,
    };
  };

  const canonicalPanelInstanceForPersistence = (panel) => {
    const isDivider = workspaceObjectType(panel) === WORKSPACE_OBJECT_TYPES.divider;
    const bounds = gridBoundsForItem(panel);
    return {
      id: panel.dataset.panelKey || "",
      type: isDivider ? WORKSPACE_OBJECT_TYPES.divider : WORKSPACE_OBJECT_TYPES.panel,
      layoutDomain: "global-workspace-grid",
      x: bounds.col,
      y: bounds.row,
      cols: bounds.span,
      rows: bounds.rowSpan,
      title: panel.dataset.panelTitle || panel.querySelector(":scope > .db-panel-hd .db-panel-title")?.textContent?.trim() || null,
      color: panel.dataset.panelColor || null,
      colorCleared: panel.dataset.panelColorCleared === "true",
      colorUser: panel.dataset.panelColorUser === "true",
      collapsed: panel.classList.contains("db-panel-collapsed"),
      pinned: panel.classList.contains("db-panel-pinned"),
      locked: panel.dataset.locked === "true",
      resizable: panel.dataset.resizable === "false" ? false : true,
      savedHeight: panel.dataset.savedHeight ? Number(panel.dataset.savedHeight) : null,
      expansionBaseline: serializableExpansionBaselineState(expansionBaselineSnapshotForLayoutKey(activeLayoutKeyForItem(panel)), panel),
      childWidgetIds: panelChildWidgets(panel).map((widget) => widget.dataset.widgetKey).filter(Boolean),
      ...workspaceObjectPersistence(panel),
    };
  };

  const assetReferencesFromWidget = (widgetRecord) => {
    if (!["image", "video", "document"].includes(widgetRecord.type)) return [];
    const assetIdValue = String(widgetRecord.config?.assetId || "").trim();
    if (!assetIdValue) return [];
    return [{
      id: assetIdValue,
      widgetId: widgetRecord.id,
      kind: widgetRecord.type,
      persistence: "registry",
    }];
  };

  const currentTransientPersistenceWarnings = (layoutKey = "builder") => {
    const objectSelector = [
      `.widget-layout[data-widget-layout-key="${CSS.escape(layoutKey)}"] .widget-card`,
      `.panel-layout[data-layout-key="${CSS.escape(layoutKey)}"] .db-panel`,
    ].join(",");
    const warnings = [];
    document.querySelectorAll(objectSelector).forEach((item) => {
      const classes = undoTransientItemClasses.filter((className) => item.classList.contains(className));
      if (!classes.length) return;
      warnings.push({
        severity: "warning",
        code: "transient-object-state",
        objectId: workspaceObjectKey(item),
        objectType: workspaceObjectType(item),
        message: `Transient UI classes are active and will not be persisted: ${classes.join(", ")}`,
      });
    });
    const transientNodes = document.querySelectorAll(
      ".dashboard-live-resize, .dashboard-resize-preview, .dashboard-expanded-footprint-ghost, .dashboard-group-boundary, .dashboard-group-member-preview, .widget-placeholder, .db-panel-placeholder"
    );
    if (transientNodes.length) {
      warnings.push({
        severity: "warning",
        code: "transient-preview-nodes",
        objectId: "",
        objectType: "workspace",
        message: `${transientNodes.length} transient preview node(s) are active and excluded from persistence.`,
      });
    }
    return warnings;
  };

  const currentPersistedWorkspaceSnapshot = (layoutKey = "builder", profile = getActivePanelProfile(layoutKey)) => {
    const panelLayout = document.querySelector(`.panel-layout[data-layout-key="${CSS.escape(layoutKey)}"]`);
    const widgetLayout = document.querySelector(`.widget-layout[data-widget-layout-key="${CSS.escape(layoutKey)}"]`);
    if (panelLayout) syncWorkspaceRegions(panelLayout);
    if (widgetLayout) syncWorkspaceRegions(widgetLayout);

    const panels = panelLayout
      ? [...panelLayout.querySelectorAll(":scope > .db-panel:not([hidden])")]
          .filter((panel) => workspaceObjectType(panel) !== WORKSPACE_OBJECT_TYPES.divider)
          .map(canonicalPanelInstanceForPersistence)
      : [];
    const dividers = panelLayout
      ? [...panelLayout.querySelectorAll(":scope > .db-panel:not([hidden])")]
          .filter((panel) => workspaceObjectType(panel) === WORKSPACE_OBJECT_TYPES.divider)
          .map(canonicalPanelInstanceForPersistence)
      : [];
    const rootWidgets = widgetLayout
      ? [...widgetLayout.querySelectorAll(":scope > .widget-card:not([hidden])")]
          .map((widget) => canonicalWidgetInstanceForPersistence(widget, null))
      : [];
    const childWidgets = panelLayout
      ? [...panelLayout.querySelectorAll(":scope > .db-panel:not([hidden])")]
          .flatMap((panel) => panelChildWidgets(panel).map((widget) => canonicalWidgetInstanceForPersistence(widget, panel)))
      : [];
    const widgets = [...rootWidgets, ...childWidgets];
    const assets = loadAssets(layoutKey, profile);
    const objects = [
      ...widgets.map((widget) => ({ id: widget.id, type: WORKSPACE_OBJECT_TYPES.widget, layoutDomain: widget.layoutDomain, parentId: widget.parentPanelId || null })),
      ...panels.map((panel) => ({ id: panel.id, type: WORKSPACE_OBJECT_TYPES.panel, layoutDomain: panel.layoutDomain, parentId: null })),
      ...dividers.map((divider) => ({ id: divider.id, type: WORKSPACE_OBJECT_TYPES.divider, layoutDomain: divider.layoutDomain, parentId: null })),
    ];
    return {
      version: PERSISTED_WORKSPACE_VERSION,
      layoutKey,
      profile,
      savedAt: new Date().toISOString(),
      objects,
      widgets,
      panels,
      dividers,
      assets,
      assetReferences: widgets.flatMap(assetReferencesFromWidget),
    };
  };

  const knownWidgetRuntimeTypes = () => new Set(
    (widgetRuntime?.listWidgetDefinitions?.() || []).map((definition) => definition.type)
  );

  const validatePersistedWorkspaceSnapshot = (snapshot = currentPersistedWorkspaceSnapshot()) => {
    const diagnostics = [];
    const addDiagnostic = (severity, code, message, objectId = "", objectType = "") => {
      diagnostics.push({ severity, code, message, objectId, objectType });
    };
    const ids = new Map();
    const addId = (type, id) => {
      if (!id) {
        addDiagnostic("error", "missing-object-id", `${type} is missing a stable id.`, "", type);
        return;
      }
      if (ids.has(id)) {
        addDiagnostic("error", "duplicate-object-id", `Duplicate object id "${id}" found for ${type}.`, id, type);
        return;
      }
      ids.set(id, type);
    };
    const panelIds = new Set((snapshot.panels || []).map((panel) => panel.id).filter(Boolean));
    const assetIds = new Set((snapshot.assets || []).map((asset) => asset.id).filter(Boolean));
    const widgetTypes = knownWidgetRuntimeTypes();
    (snapshot.widgets || []).forEach((widget) => {
      addId(WORKSPACE_OBJECT_TYPES.widget, widget.id);
      if (!widget.type) addDiagnostic("error", "missing-widget-type", "Widget is missing a runtime type.", widget.id, WORKSPACE_OBJECT_TYPES.widget);
      if (widget.type && !widgetTypes.has(widget.type)) {
        addDiagnostic("warning", "unknown-widget-type", `Widget type "${widget.type}" will render through the unsupported-widget fallback.`, widget.id, WORKSPACE_OBJECT_TYPES.widget);
      }
      if (widget.parentPanelId && !panelIds.has(widget.parentPanelId)) {
        addDiagnostic("error", "missing-parent-panel", `Panel child widget references missing panel "${widget.parentPanelId}".`, widget.id, WORKSPACE_OBJECT_TYPES.widget);
      }
      if (["image", "video", "document"].includes(widget.type) && widget.config?.assetId && !assetIds.has(widget.config.assetId)) {
        addDiagnostic("warning", "missing-asset", `Media widget references missing asset "${widget.config.assetId}".`, widget.id, WORKSPACE_OBJECT_TYPES.widget);
      }
      if (["image", "video", "document"].includes(widget.type) && widget.config?.src) {
        addDiagnostic("warning", "legacy-media-src", "Media widget config still contains a legacy src field; it should migrate to assetId.", widget.id, WORKSPACE_OBJECT_TYPES.widget);
      }
    });
    (snapshot.panels || []).forEach((panel) => addId(WORKSPACE_OBJECT_TYPES.panel, panel.id));
    (snapshot.dividers || []).forEach((divider) => {
      addId(WORKSPACE_OBJECT_TYPES.divider, divider.id);
      if (divider.workspaceRegionId && !String(divider.workspaceRegionId).includes(":region:")) {
        addDiagnostic("warning", "divider-region-id-format", "Divider region id does not look like a workspace region id.", divider.id, WORKSPACE_OBJECT_TYPES.divider);
      }
    });
    (snapshot.assets || []).forEach((asset) => {
      addId("asset", asset.id);
      if (asset.source?.kind === "blob-url" || String(asset.source?.ref || "").startsWith("blob:")) {
        addDiagnostic("warning", "temporary-asset-reference", "Temporary blob URLs are not durable saved asset references.", asset.id, "asset");
      }
    });
    currentTransientPersistenceWarnings(snapshot.layoutKey).forEach((warning) => diagnostics.push(warning));
    const errors = diagnostics.filter((entry) => entry.severity === "error");
    const warnings = diagnostics.filter((entry) => entry.severity !== "error");
    return {
      ok: errors.length === 0,
      version: snapshot.version || 0,
      layoutKey: snapshot.layoutKey || "builder",
      profile: snapshot.profile || getActivePanelProfile(snapshot.layoutKey || "builder"),
      errors,
      warnings,
      diagnostics,
    };
  };

  const savePersistedWorkspaceSnapshot = (layoutKey = "builder", profile = getActivePanelProfile(layoutKey)) => {
    const snapshot = currentPersistedWorkspaceSnapshot(layoutKey, profile);
    writeJsonStore(persistedWorkspaceKey(layoutKey, profile), snapshot);
    return snapshot;
  };

  const loadPersistedWorkspaceSnapshot = (layoutKey = "builder", profile = getActivePanelProfile(layoutKey)) => {
    const saved = readJsonStore(persistedWorkspaceKey(layoutKey, profile), null);
    if (!saved || Number(saved.version) !== PERSISTED_WORKSPACE_VERSION) return currentPersistedWorkspaceSnapshot(layoutKey, profile);
    return saved;
  };

  const migratePersistedWorkspaceSnapshot = (layoutKey = "builder", profile = getActivePanelProfile(layoutKey)) => {
    const saved = readJsonStore(persistedWorkspaceKey(layoutKey, profile), null);
    if (saved && Number(saved.version) === PERSISTED_WORKSPACE_VERSION) return saved;
    return savePersistedWorkspaceSnapshot(layoutKey, profile);
  };

  window.dashboardPersistenceRuntime = {
    version: PERSISTED_WORKSPACE_VERSION,
    keyForLayout: persistedWorkspaceKey,
    snapshot: currentPersistedWorkspaceSnapshot,
    saveSnapshot: savePersistedWorkspaceSnapshot,
    loadSnapshot: loadPersistedWorkspaceSnapshot,
    migrateLegacyLayout: migratePersistedWorkspaceSnapshot,
    validate: (layoutKey = "builder", profile = getActivePanelProfile(layoutKey)) =>
      validatePersistedWorkspaceSnapshot(currentPersistedWorkspaceSnapshot(layoutKey, profile)),
    validateSnapshot: validatePersistedWorkspaceSnapshot,
  };

  return {
    currentPersistedWorkspaceSnapshot,
    validatePersistedWorkspaceSnapshot,
    savePersistedWorkspaceSnapshot,
    loadPersistedWorkspaceSnapshot,
    migratePersistedWorkspaceSnapshot,
  };
};
