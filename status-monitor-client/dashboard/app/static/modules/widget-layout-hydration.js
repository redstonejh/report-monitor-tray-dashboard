export const hydrateWidgetLayout = (layout, {
  isPanelInternalWidgetLayout,
  gridItemLayoutKey,
  getActivePanelProfile,
  readJsonStore,
  customWidgetsKey,
  createCustomWidget,
  parseJsonRecord,
  readRawStore,
  hiddenWidgetsKey,
  writeDraftList,
  widgetStorageKey,
  hydrateWidgetRuntime,
  ensureWidgetTools,
  markLoadedExpansionBaseline,
  ensureWorkspaceObjectMetadata,
  workspaceObjectType,
  applyWidgetSpan,
  applyWidgetGridPosition,
  applyPanelColor,
  applyPanelTitleColor,
  setWidgetConfig,
  widgetConfigFromElement,
  createWidgetRowBreak,
  createWidgetSpacer,
  cleanupWidgetRowBreaks,
  syncDefaultDashboardGrid,
  normalizeGridLayout,
  syncWorkspaceRegions,
}) => {
  const internalLayout = isPanelInternalWidgetLayout(layout);
  const layoutKey = internalLayout ? gridItemLayoutKey(layout) : (layout.dataset.widgetLayoutKey || "default");
  const profile = getActivePanelProfile(layoutKey);
  const snapshotHydration = layout.closest(".dashboard-layout-grid")?.dataset.workspacePageSnapshotHydrating === "true";
  const reconcilePanelContainedWidgets = () => {
    if (internalLayout) return;
    const host = layout.closest(".dashboard-layout-grid");
    if (!host) return;
    const containedByKey = new Map();
    host.querySelectorAll(".panel-internal-widget-grid > .widget-card[data-widget-key]").forEach((widget) => {
      const key = widget.dataset.widgetKey;
      if (!key) return;
      if (containedByKey.has(key)) {
        widget.remove();
        return;
      }
      containedByKey.set(key, widget);
    });
    containedByKey.forEach((widget, key) => {
      layout.querySelectorAll(`:scope > .widget-card[data-widget-key="${CSS.escape(key)}"]`)
        .forEach((duplicate) => {
          if (duplicate !== widget) duplicate.remove();
        });
    });
  };
  let customDefinitions = [];
  if (!internalLayout && !snapshotHydration) {
    try {
      customDefinitions = readJsonStore(customWidgetsKey(layoutKey, profile), []);
    } catch {
      customDefinitions = [];
    }
  }
  customDefinitions
    .filter((definition) => definition?.key && !layout.querySelector(`:scope > .widget-card[data-widget-key="${CSS.escape(definition.key)}"]`))
    .forEach((definition) => layout.appendChild(createCustomWidget(definition)));
  let hiddenWidgets = [];
  if (!internalLayout && !snapshotHydration) {
    try {
      hiddenWidgets = parseJsonRecord(readRawStore(hiddenWidgetsKey(layoutKey, profile), "[]"), []);
    } catch {
      hiddenWidgets = [];
    }
  }
  writeDraftList(layout, "hiddenWidgetsDraft", hiddenWidgets);
  hiddenWidgets.forEach((key) => {
    const widget = layout.querySelector(`:scope > .widget-card[data-widget-key="${CSS.escape(key)}"]`);
    if (widget) widget.hidden = true;
  });
  reconcilePanelContainedWidgets();
  const widgets = [...layout.querySelectorAll(":scope > .widget-card")];
  const savedByWidget = new Map();
  widgets.forEach((widget, index) => {
    const key = widget.dataset.widgetKey || `widget-${index}`;
    const snapshotColor = widget.dataset.panelColor || null;
    const snapshotColorCleared = widget.dataset.panelColorCleared === "true";
    widget.dataset.defaultOrder = String(index);
    widget.dataset.defaultTitle = widget.querySelector(".stat-lbl")?.textContent?.trim() || "Widget";
    let saved = null;
    if (!internalLayout && !snapshotHydration) {
      try {
        saved = readJsonStore(widgetStorageKey(layoutKey, key, profile), null);
      } catch {}
    }
    if (saved?.runtimeType) widget.dataset.widgetRuntimeType = saved.runtimeType;
    if (saved?.type && !widget.dataset.widgetRuntimeType) widget.dataset.widgetRuntimeType = saved.type;
    if (saved?.config) widget.dataset.widgetConfig = saved.config;
    const runtimeDefinition = hydrateWidgetRuntime(widget, saved);
    ensureWidgetTools(widget);
    savedByWidget.set(widget, saved);
    markLoadedExpansionBaseline(widget, saved?.expansionBaseline);
    ensureWorkspaceObjectMetadata(widget, {
      workspaceObjectType: saved?.workspaceObjectType || widget.dataset.workspaceObjectType || workspaceObjectType(widget),
      dashboardObjectKind: saved?.dashboardObjectKind || widget.dataset.dashboardObjectKind || runtimeDefinition?.dashboardObjectKind,
      workspaceRegionId: saved?.workspaceRegionId,
      regionRole: saved?.regionRole || runtimeDefinition?.regionRole,
      navigationTargetType: saved?.navigationTargetType,
      navigationTargetId: saved?.navigationTargetId,
    });
    const defaultWidgetSpan = widget.dataset.widgetType === "controls" ? 6 : 1;
    applyWidgetSpan(widget, saved?.span ?? widget.dataset.currentSpan ?? widget.dataset.defaultSpan ?? defaultWidgetSpan);
    if (saved?.gridCol && saved?.gridRow) applyWidgetGridPosition(widget, saved.gridCol, saved.gridRow, saved?.rowSpan);
    widget.classList.toggle("db-panel-pinned", Boolean(saved?.pinned));
    widget.querySelector(".panel-pin-toggle")?.setAttribute("aria-pressed", Boolean(saved?.pinned).toString());
    if (saved?.minW) widget.dataset.minW = String(saved.minW);
    if (saved?.minH) widget.dataset.minH = String(saved.minH);
    if (saved?.locked) widget.dataset.locked = "true";
    if (saved?.resizable === false) widget.dataset.resizable = "false";
    if (saved?.colorCleared || (!saved && snapshotColorCleared)) {
      applyPanelColor(widget, null);
    } else {
      applyPanelColor(widget, saved?.color || snapshotColor || widget.querySelector(".panel-color-toggle")?.dataset.defaultTheme);
      if (saved?.colorUser) {
        widget.dataset.panelColorUser = "true";
      }
    }
    applyPanelTitleColor(widget, "");
    if (saved?.title) {
      widget.dataset.panelTitle = saved.title;
      setWidgetConfig(widget, { ...widgetConfigFromElement(widget), title: saved.title });
      const label = widget.querySelector(".stat-lbl");
      if (label) label.textContent = saved.title;
    }
  });
  widgets
    .sort((a, b) => Number(savedByWidget.get(a)?.order ?? a.dataset.defaultOrder ?? 0) - Number(savedByWidget.get(b)?.order ?? b.dataset.defaultOrder ?? 0))
    .forEach((widget) => {
      if (savedByWidget.get(widget)?.breakBefore) layout.appendChild(createWidgetRowBreak());
      const spacerCount = Math.max(0, Math.min(11, Number(savedByWidget.get(widget)?.spacerBefore) || 0));
      for (let index = 0; index < spacerCount; index += 1) {
        layout.appendChild(createWidgetSpacer(savedByWidget.get(widget)?.span || widget.dataset.defaultSpan || 3));
      }
      layout.appendChild(widget);
    });
  cleanupWidgetRowBreaks(layout);
  let defaultCol = 1;
  let defaultRow = 1;
  [...layout.querySelectorAll(":scope > .widget-card")].forEach((widget) => {
    if (widget.dataset.gridCol && widget.dataset.gridRow) return;
    if (!internalLayout && layout.closest(".dashboard-layout-grid")) return;
    const span = Number(widget.dataset.currentSpan) || Number(widget.dataset.defaultSpan) || 1;
    if (defaultCol + span - 1 > 6) {
      defaultRow += 1;
      defaultCol = 1;
    }
    applyWidgetGridPosition(widget, defaultCol, defaultRow);
    defaultCol += span;
  });
  if (!internalLayout && layout.closest(".dashboard-layout-grid")) {
    syncDefaultDashboardGrid(layoutKey);
  } else {
    normalizeGridLayout(layout);
  }
  syncWorkspaceRegions(layout);

  return {
    internalLayout,
    layoutKey,
    widgets,
  };
};
