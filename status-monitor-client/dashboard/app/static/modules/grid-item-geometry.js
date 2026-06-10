export const createGridItemGeometry = ({
  applyPanelGridPosition,
  applyWidgetGridPosition,
  dashboardCollisionReflowRuntime,
  dashboardGeometry,
  DASHBOARD_GRID_COLUMNS,
  getCollisionReflowRuntime,
  gridGapForLayout,
  gridItemMinimumSpan,
  gridItemRowSpan,
  gridRectForLayout,
  isWidgetGridItem,
}) => {
  const gridItemSpan = (item) => {
    const rawSpan = Number(item.dataset.currentSpan) || Number(item.dataset.defaultSpan) || 1;
    return Math.max(gridItemMinimumSpan(item), Math.min(6, Math.round(rawSpan > 6 ? rawSpan / 2 : rawSpan)));
  };

  const applyGridItemPosition = (item, col, row) => {
    if (isWidgetGridItem(item)) {
      applyWidgetGridPosition(item, col, row);
    } else {
      applyPanelGridPosition(item, col, row);
    }
  };

  const gridItemPixelWidthForSpan = (layout, span, metrics = null) => {
    const gap = metrics?.gap ?? gridGapForLayout(layout);
    const layoutWidth = metrics?.width ?? Math.max(1, gridRectForLayout(layout).width);
    const columnWidth = metrics?.columnWidth ?? ((layoutWidth - (gap * (DASHBOARD_GRID_COLUMNS - 1))) / DASHBOARD_GRID_COLUMNS);
    return dashboardGeometry.gridItemPixelWidthForSpan({
      span,
      gap,
      columnWidth,
      columns: DASHBOARD_GRID_COLUMNS,
    });
  };

  const resizeEdgeFromPointer = (event, item, threshold = 10) => {
    if (!event || !item) return null;
    const rect = item.getBoundingClientRect();
    return dashboardGeometry.resizeEdgeFromRect({ clientX: event.clientX, rect, threshold });
  };

  const gridBoundsForItem = (item, metrics = null) => {
    const col = Math.max(1, Math.round(Number(item.dataset.gridCol) || 1));
    const row = Math.max(1, Math.round(Number(item.dataset.gridRow) || 1));
    const span = gridItemSpan(item);
    const rowSpan = gridItemRowSpan(item, metrics);
    return {
      col,
      row,
      span,
      rowSpan,
      right: col + span - 1,
      bottom: row + rowSpan - 1,
    };
  };

  const gridBoundsOverlap = (a, b) => dashboardGeometry.gridBoundsOverlap(a, b);

  const indexedCollisionEntries = (bounds, occupied) => (
    getCollisionReflowRuntime()?.indexedCollisionEntries?.(bounds, occupied) ||
    dashboardCollisionReflowRuntime.indexedCollisionEntries(bounds, occupied)
  );

  const nextGridSlot = (bounds) => {
    if (bounds.col < 7 - bounds.span) {
      return { col: bounds.col + 1, row: bounds.row };
    }
    return { col: 1, row: bounds.row + 1 };
  };

  return {
    applyGridItemPosition,
    gridBoundsForItem,
    gridBoundsOverlap,
    gridItemPixelWidthForSpan,
    gridItemSpan,
    indexedCollisionEntries,
    nextGridSlot,
    resizeEdgeFromPointer,
  };
};
