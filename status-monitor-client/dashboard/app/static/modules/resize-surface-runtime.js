export const createResizeSurfaceRuntime = ({
  DASHBOARD_GRID_ROW_HEIGHT,
  expandedPanelFootprintHeight,
  gridGapForLayout,
  gridHeightForRows,
  gridItemRowSpan,
  workspaceObjectCapabilities,
}) => {
  const createResizePreview = (layout, item, placeholderClass, rect, metrics = null) => {
    const placeholder = document.createElement("div");
    placeholder.className = `${placeholderClass} dashboard-resize-preview`;
    placeholder.dataset.currentSpan = item.dataset.currentSpan || item.dataset.defaultSpan || "1";
    placeholder.dataset.defaultSpan = item.dataset.defaultSpan || placeholder.dataset.currentSpan;
    placeholder.dataset.gridRowSpan = String(gridItemRowSpan(item, metrics));
    if (item.dataset.minW) placeholder.dataset.minW = item.dataset.minW;
    if (item.dataset.minSpan) placeholder.dataset.minSpan = item.dataset.minSpan;
    if (item.dataset.minH) placeholder.dataset.minH = item.dataset.minH;
    if (item.dataset.minRows) placeholder.dataset.minRows = item.dataset.minRows;
    if (item.dataset.widgetType) placeholder.dataset.widgetType = item.dataset.widgetType;
    if (item.dataset.gridCol) placeholder.dataset.gridCol = item.dataset.gridCol;
    if (item.dataset.gridRow) placeholder.dataset.gridRow = item.dataset.gridRow;
    placeholder.style.gridColumn = item.style.gridColumn || `span ${placeholder.dataset.currentSpan}`;
    placeholder.style.gridRow = item.style.gridRow || "";
    const footprintHeight = placeholderClass === "db-panel-placeholder"
      ? gridHeightForRows(gridItemRowSpan(item, metrics), metrics?.gap ?? gridGapForLayout(layout))
      : Math.max(DASHBOARD_GRID_ROW_HEIGHT, rect.height);
    placeholder.style.height = `${footprintHeight}px`;
    layout.insertBefore(placeholder, item);
    return placeholder;
  };

  const updateExpandedFootprintGhost = (ghost, panel, layout, rect, metrics = null) => {
    if (!ghost) return;
    const height = expandedPanelFootprintHeight(panel, layout, rect.rows, metrics);
    ghost.style.left = `${Math.round(rect.left)}px`;
    ghost.style.top = `${Math.round(rect.top)}px`;
    ghost.style.width = `${Math.round(rect.width)}px`;
    ghost.style.height = `${Math.round(height)}px`;
  };

  const createExpandedFootprintGhost = (panel, layout, rect, proposedRows = null, metrics = null) => {
    if (!workspaceObjectCapabilities(panel).hasExpandedFootprint) return null;
    if (!panel?.classList?.contains("db-panel-collapsed")) return null;
    const ghost = document.createElement("div");
    ghost.className = "dashboard-expanded-footprint-ghost";
    ghost.setAttribute("aria-hidden", "true");
    document.body.appendChild(ghost);
    updateExpandedFootprintGhost(ghost, panel, layout, {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      rows: proposedRows,
    }, metrics);
    return ghost;
  };

  const beginLiveResizeSurface = (item, rect) => {
    const preview = item.cloneNode(true);
    preview.classList.add("dashboard-live-resize");
    preview.classList.remove("dashboard-active-resize", "db-panel-dragging", "widget-dragging");
    preview.setAttribute("aria-hidden", "true");
    preview.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
    item.classList.add("dashboard-resize-source");
    document.body.appendChild(preview);
    updateLiveResizeSurface(preview, rect.width, rect.height, rect.left, rect.top);
    return preview;
  };

  const updateLiveResizeSurface = (preview, width, height, left = null, top = null) => {
    if (!preview) return;
    if (Number.isFinite(left)) preview.style.left = `${Math.round(left)}px`;
    if (Number.isFinite(top)) preview.style.top = `${Math.round(top)}px`;
    preview.style.width = `${Math.round(width)}px`;
    preview.style.height = `${Math.round(height)}px`;
  };

  const GROUP_BOUNDARY_OUTSET = 5;

  const createGroupBoundarySurface = (className = "") => {
    const boundary = document.createElement("div");
    boundary.className = `dashboard-group-boundary ${className}`.trim();
    boundary.setAttribute("aria-hidden", "true");
    document.body.appendChild(boundary);
    return boundary;
  };

  const updateGroupBoundarySurface = (boundary, rect) => {
    if (!boundary || !rect) return;
    updateLiveResizeSurface(
      boundary,
      Math.max(1, rect.width + (GROUP_BOUNDARY_OUTSET * 2)),
      Math.max(1, rect.height + (GROUP_BOUNDARY_OUTSET * 2)),
      rect.left - GROUP_BOUNDARY_OUTSET,
      rect.top - GROUP_BOUNDARY_OUTSET
    );
  };

  const clearLiveResizeSurface = (item, preview = null) => {
    preview?.remove();
    item.classList.remove("dashboard-resize-source");
  };

  return {
    beginLiveResizeSurface,
    clearLiveResizeSurface,
    createExpandedFootprintGhost,
    createGroupBoundarySurface,
    createResizePreview,
    updateExpandedFootprintGhost,
    updateGroupBoundarySurface,
    updateLiveResizeSurface,
  };
};
