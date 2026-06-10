export const hydratePanelLayout = (layout, {
  getActivePanelProfile,
  readJsonStore,
  customPanelsKey,
  createCustomPanel,
  parseJsonRecord,
  readRawStore,
  hiddenPanelsKey,
  writeDraftList,
  panelStorageKey,
  markLoadedExpansionBaseline,
  ensureWorkspaceObjectMetadata,
  workspaceObjectType,
  WORKSPACE_OBJECT_TYPES,
  applyPanelSpan,
  applyPanelGridPosition,
  applyPanelHeight,
  applyPanelColor,
  applyPanelTitleColor,
  restorePanelChildWidgets,
  createPanelRowBreak,
  cleanupPanelRowBreaks,
  syncDefaultDashboardGrid,
  normalizeGridLayout,
  syncWorkspaceRegions,
}) => {
  const layoutKey = layout.dataset.layoutKey || "default";
  const layoutProfile = getActivePanelProfile(layoutKey);
  const snapshotHydration = layout.closest(".dashboard-layout-grid")?.dataset.workspacePageSnapshotHydrating === "true";
  let customPanelDefinitions = [];
  if (!snapshotHydration) {
    try {
      customPanelDefinitions = readJsonStore(customPanelsKey(layoutKey, layoutProfile), []);
    } catch {
      customPanelDefinitions = [];
    }
  }
  customPanelDefinitions
    .filter((definition) => definition?.key && !layout.querySelector(`:scope > .db-panel[data-panel-key="${CSS.escape(definition.key)}"]`))
    .forEach((definition) => layout.appendChild(createCustomPanel(definition)));
  let hiddenPanels = [];
  if (!snapshotHydration) {
    try {
      hiddenPanels = parseJsonRecord(readRawStore(hiddenPanelsKey(layoutKey, layoutProfile), "[]"), []);
    } catch {
      hiddenPanels = [];
    }
  }
  writeDraftList(layout, "hiddenPanelsDraft", hiddenPanels);
  hiddenPanels.forEach((key) => {
    const panel = layout.querySelector(`:scope > .db-panel[data-panel-key="${CSS.escape(key)}"]`);
    if (panel) panel.hidden = true;
  });
  const panels = [...layout.querySelectorAll(":scope > .db-panel")];
  const savedByPanel = new Map();
  panels.forEach((panel, index) => {
    const key = panel.dataset.panelKey || `panel-${index}`;
    const titleEl = panel.querySelector(".db-panel-title");
    const defaultTheme = panel.querySelector(".panel-color-toggle")?.dataset.defaultTheme;
    const snapshotColor = panel.dataset.panelColor || null;
    const snapshotColorCleared = panel.dataset.panelColorCleared === "true";
    panel.dataset.defaultOrder = String(index);
    if (titleEl) panel.dataset.defaultTitle = titleEl.textContent.trim();
    let saved = null;
    if (!snapshotHydration) {
      try {
        saved = readJsonStore(panelStorageKey(layoutKey, key, layoutProfile), null);
      } catch {}
    }
    savedByPanel.set(panel, saved);
    markLoadedExpansionBaseline(panel, saved?.expansionBaseline);
    panel.__loadedExpansionActive = Boolean(saved?.expansionActive);
    ensureWorkspaceObjectMetadata(panel, {
      workspaceObjectType: saved?.workspaceObjectType || panel.dataset.workspaceObjectType || workspaceObjectType(panel),
      dashboardObjectKind: saved?.dashboardObjectKind || panel.dataset.dashboardObjectKind,
      workspaceRegionId: saved?.workspaceRegionId,
      regionRole: saved?.regionRole,
      navigationTargetType: saved?.navigationTargetType,
      navigationTargetId: saved?.navigationTargetId,
    });
    panel.classList.remove("db-panel-unlocked", "db-panel-pinned");
    if (saved?.pinned) panel.classList.add("db-panel-pinned");
    panel.classList.toggle("db-panel-collapsed", saved?.collapsed ?? panel.classList.contains("db-panel-collapsed"));
    if (workspaceObjectType(panel) === WORKSPACE_OBJECT_TYPES.divider) {
      panel.classList.add("db-panel-collapsed");
      panel.dataset.gridRowSpan = "1";
    }
    if (saved?.minW) panel.dataset.minW = String(saved.minW);
    if (saved?.locked) panel.dataset.locked = "true";
    if (saved?.resizable === false) panel.dataset.resizable = "false";
    applyPanelSpan(panel, saved?.span ?? panel.dataset.currentSpan ?? panel.dataset.defaultSpan ?? 6);
    if (saved?.gridCol && saved?.gridRow) applyPanelGridPosition(panel, saved.gridCol, saved.gridRow);
    if (saved?.height) applyPanelHeight(panel, saved.height);
    if (saved?.colorCleared || (!saved && snapshotColorCleared)) {
      applyPanelColor(panel, null);
    } else {
      applyPanelColor(panel, saved?.color || snapshotColor || defaultTheme);
      if (saved?.colorUser) panel.dataset.panelColorUser = "true";
    }
    applyPanelTitleColor(panel, "");
    if (saved?.title && titleEl) {
      panel.dataset.panelTitle = saved.title;
      titleEl.textContent = saved.title;
    }
    const savedChildWidgets = Array.isArray(saved?.childWidgets) ? saved.childWidgets : null;
    const hasInlineChildWidgets = Boolean(panel.querySelector(":scope > .db-panel-body .panel-internal-widget-grid > .widget-card"));
    if (savedChildWidgets?.length || !hasInlineChildWidgets) {
      restorePanelChildWidgets(panel, savedChildWidgets || []);
    }
  });

  panels
    .sort((a, b) => {
      const aSaved = savedByPanel.get(a);
      const bSaved = savedByPanel.get(b);
      return Number(aSaved?.order ?? a.dataset.defaultOrder ?? 0) - Number(bSaved?.order ?? b.dataset.defaultOrder ?? 0);
    })
    .forEach((panel) => {
      if (savedByPanel.get(panel)?.breakBefore) layout.appendChild(createPanelRowBreak());
      layout.appendChild(panel);
    });
  cleanupPanelRowBreaks(layout);
  let defaultPanelCol = 1;
  let defaultPanelRow = 1;
  [...layout.querySelectorAll(":scope > .db-panel")].forEach((panel) => {
    if (panel.hidden) return;
    if (panel.dataset.gridCol && panel.dataset.gridRow) return;
    if (layout.closest(".dashboard-layout-grid")) return;
    const span = Number(panel.dataset.currentSpan) || Number(panel.dataset.defaultSpan) || 6;
    if (defaultPanelCol + span - 1 > 6) {
      defaultPanelRow += 1;
      defaultPanelCol = 1;
    }
    applyPanelGridPosition(panel, defaultPanelCol, defaultPanelRow);
    defaultPanelCol += span;
  });
  if (layout.closest(".dashboard-layout-grid")) {
    syncDefaultDashboardGrid(layoutKey);
  } else {
    normalizeGridLayout(layout);
  }
  syncWorkspaceRegions(layout);

  return {
    layoutKey,
    panels,
  };
};
