export const createGridItemSizingRuntime = ({
  DASHBOARD_GRID_ROW_HEIGHT,
  getPanelRuntime,
  gridGapForLayout,
  gridHostForLayout,
  gridRowsFromHeight,
  isPanelInternalWidgetLayout,
  panelForInternalWidgetLayout,
  savePanelLayouts,
  saveWidgetLayouts,
  workspaceObjectCapabilities,
}) => {
  const gridItemMinimumSpan = (item) => {
    const explicit = Number(item?.dataset?.minW || item?.dataset?.minSpan);
    if (Number.isFinite(explicit) && explicit > 0) return Math.max(1, Math.min(6, Math.ceil(explicit)));
    if (item?.dataset?.widgetType === "controls") return 2;
    return 1;
  };

  const gridItemMinimumRows = (item) => {
    const explicit = Number(item?.dataset?.minH || item?.dataset?.minRows);
    if (Number.isFinite(explicit) && explicit > 0) return Math.max(1, Math.ceil(explicit));
    return 1;
  };

  const gridItemLayoutKey = (layout) => {
    if (isPanelInternalWidgetLayout(layout)) {
      return panelForInternalWidgetLayout(layout)?.closest?.(".panel-layout")?.dataset.layoutKey || "default";
    }
    return layout?.dataset.widgetLayoutKey || layout?.dataset.layoutKey || "default";
  };

  const saveSharedGridLayouts = (layout) => {
    const host = gridHostForLayout(layout);
    const key = gridItemLayoutKey(layout);
    if (layout?.classList?.contains("widget-layout")) {
      saveWidgetLayouts(layout);
      const panelLayout = host?.querySelector?.(`.panel-layout[data-layout-key="${CSS.escape(key)}"]`);
      if (panelLayout) savePanelLayouts(panelLayout);
    } else {
      savePanelLayouts(layout);
      const widgetLayout = host?.querySelector?.(`.widget-layout[data-widget-layout-key="${CSS.escape(key)}"]`);
      if (widgetLayout) saveWidgetLayouts(widgetLayout);
    }
  };

  const panelMinimumRows = (panel, metrics = null) => getPanelRuntime().panelMinimumRows(panel, metrics);

  const panelExpandedMinimumRows = (panel, layout = panel.closest(".panel-layout"), metrics = null) => (
    getPanelRuntime().panelExpandedMinimumRows(panel, layout, metrics)
  );

  const gridItemRowSpan = (item, metrics = null) => {
    if (item.classList.contains("widget-card") || item.classList.contains("widget-placeholder")) {
      const minRows = gridItemMinimumRows(item);
      const explicitRows = Number(item.dataset.gridRowSpan);
      if (Number.isFinite(explicitRows) && explicitRows > 0) return Math.max(minRows, Math.round(explicitRows));
      return minRows;
    }
    if (!workspaceObjectCapabilities(item).hasPanelContentArea && !item.classList.contains("db-panel-placeholder")) return 1;
    if (item.classList.contains("db-panel-collapsed")) return 1;
    if (item.classList.contains("db-panel-placeholder") && Number(item.dataset.gridRowSpan) === 1) return 1;
    const layout = item.closest(".panel-layout");
    const gap = metrics?.gap ?? gridGapForLayout(layout);
    const minRows = item.classList.contains("db-panel-placeholder") ? 1 : panelMinimumRows(item, metrics);
    const explicitRows = Number(item.dataset.gridRowSpan);
    if (Number.isFinite(explicitRows) && explicitRows > 0) return Math.max(minRows, Math.round(explicitRows));
    const measuredHeight = Number(item.dataset.savedHeight) || item.getBoundingClientRect().height || DASHBOARD_GRID_ROW_HEIGHT;
    const rows = gridRowsFromHeight(measuredHeight, gap, minRows);
    return Math.max(minRows, Math.round(rows));
  };

  const syncPanelRenderedHeightToFootprint = (panel, rowSpan = null) => (
    getPanelRuntime().syncPanelRenderedHeightToFootprint(panel, rowSpan)
  );

  return {
    gridItemLayoutKey,
    gridItemMinimumRows,
    gridItemMinimumSpan,
    gridItemRowSpan,
    panelExpandedMinimumRows,
    panelMinimumRows,
    saveSharedGridLayouts,
    syncPanelRenderedHeightToFootprint,
  };
};
