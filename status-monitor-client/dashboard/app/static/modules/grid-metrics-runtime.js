export const createGridMetricsRuntime = ({
  dashboardGeometry,
  gridContentRectForHost,
  gridHostForLayout,
}) => {
  const DASHBOARD_GRID_COLUMNS = 6;
  const DASHBOARD_GRID_ROW_HEIGHT = 81;

  const gridRectForLayout = (layout) => {
    const host = gridHostForLayout(layout);
    const rect = (host || layout).getBoundingClientRect();
    return gridContentRectForHost(host || layout, rect);
  };

  const gridGapForLayout = (layout) => {
    if (!layout) return 16;
    const host = gridHostForLayout(layout);
    const computed = window.getComputedStyle(host || layout);
    const rawGap = computed.rowGap || computed.gap || (layout.classList.contains("widget-layout") ? "12px" : "16px");
    const gap = parseFloat(rawGap);
    return Number.isFinite(gap) ? gap : (layout.classList.contains("widget-layout") ? 12 : 16);
  };

  const gridRowHeightForLayout = (layout) => {
    if (!layout) return DASHBOARD_GRID_ROW_HEIGHT;
    const host = gridHostForLayout(layout);
    const computed = window.getComputedStyle(host || layout);
    const rowHeight = parseFloat(computed.getPropertyValue("--dashboard-grid-row-height"));
    return Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : DASHBOARD_GRID_ROW_HEIGHT;
  };

  const createGridMetrics = (layout) => {
    const rect = gridRectForLayout(layout);
    const gap = gridGapForLayout(layout);
    const rowHeight = gridRowHeightForLayout(layout);
    const width = Math.max(1, rect.width);
    const columnWidth = (width - (gap * (DASHBOARD_GRID_COLUMNS - 1))) / DASHBOARD_GRID_COLUMNS;
    return {
      layout,
      rect,
      gap,
      width,
      columnWidth,
      columnStep: Math.max(1, columnWidth + gap),
      rowHeight,
      rowStep: rowHeight + gap,
      panelMinimumRows: new WeakMap(),
    };
  };

  const refreshGridMetricsRect = (metrics) => {
    if (!metrics?.layout) return metrics;
    metrics.rect = gridRectForLayout(metrics.layout);
    return metrics;
  };

  const gridHeightForRows = (rows, gap, rowHeight = DASHBOARD_GRID_ROW_HEIGHT) => (
    dashboardGeometry.gridHeightForRows(rows, gap, rowHeight)
  );

  const gridRowsFromHeight = (height, gap, minRows = 1, rowHeight = DASHBOARD_GRID_ROW_HEIGHT) => (
    dashboardGeometry.gridRowsFromHeight(height, gap, minRows, rowHeight)
  );

  const isWidgetGridItem = (item) => (
    item?.classList?.contains("widget-card") ||
    item?.classList?.contains("widget-placeholder")
  );

  return {
    DASHBOARD_GRID_COLUMNS,
    DASHBOARD_GRID_ROW_HEIGHT,
    createGridMetrics,
    gridGapForLayout,
    gridHeightForRows,
    gridRectForLayout,
    gridRowHeightForLayout,
    gridRowsFromHeight,
    isWidgetGridItem,
    refreshGridMetricsRect,
  };
};
