export const createWorkspaceVisualLodRuntime = ({
  createGridMetrics,
  globalGridItems,
  gridBoundsForItem,
  gridHeightForRows,
  isPanelInternalWidgetLayout,
}) => {
  const WORKSPACE_VISUAL_LOD_TIERS = Object.freeze({
    active: "active",
    visible: "visible",
    near: "near",
    far: "far",
  });

  const WORKSPACE_VISUAL_LOD_OVERSCAN = Object.freeze({
    visibleMin: 180,
    visibleViewportRatio: .35,
    nearMin: 900,
    nearViewportRatio: 1.5,
  });

  const workspaceVisualViewport = () => {
    const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
    const height = window.innerHeight || document.documentElement.clientHeight || 800;
    return {
      top: scrollY,
      bottom: scrollY + height,
      height,
      visibleOverscan: Math.max(WORKSPACE_VISUAL_LOD_OVERSCAN.visibleMin, height * WORKSPACE_VISUAL_LOD_OVERSCAN.visibleViewportRatio),
      nearOverscan: Math.max(WORKSPACE_VISUAL_LOD_OVERSCAN.nearMin, height * WORKSPACE_VISUAL_LOD_OVERSCAN.nearViewportRatio),
    };
  };

  const gridItemDocumentBounds = (item, metrics = null) => {
    const resolvedMetrics = metrics || createGridMetrics(item.closest(".widget-layout, .panel-layout, .panel-internal-widget-grid"));
    const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
    const bounds = gridBoundsForItem(item, resolvedMetrics);
    const top = resolvedMetrics.rect.top + scrollY + ((bounds.row - 1) * resolvedMetrics.rowStep);
    const height = gridHeightForRows(bounds.rowSpan, resolvedMetrics.gap, resolvedMetrics.rowHeight);
    return { top, bottom: top + height, bounds };
  };

  const workspaceVisualLodForItem = (item, metrics = null, viewport = workspaceVisualViewport()) => {
    if (
      item.matches?.(":focus-within") ||
      item.classList.contains("active") ||
      item.classList.contains("group-selected") ||
      item.classList.contains("widget-dragging") ||
      item.classList.contains("db-panel-dragging") ||
      item.classList.contains("dashboard-active-resize") ||
      item.classList.contains("dashboard-live-resize") ||
      item.classList.contains("dashboard-resize-source") ||
      item.classList.contains("dashboard-group-member-preview") ||
      item.classList.contains("dashboard-group-source") ||
      item.classList.contains("widget-tools-open") ||
      item.classList.contains("db-panel-tools-open")
    ) {
      return WORKSPACE_VISUAL_LOD_TIERS.active;
    }
    const { top, bottom } = gridItemDocumentBounds(item, metrics);
    if (bottom >= viewport.top - viewport.visibleOverscan && top <= viewport.bottom + viewport.visibleOverscan) return WORKSPACE_VISUAL_LOD_TIERS.visible;
    if (bottom >= viewport.top - viewport.nearOverscan && top <= viewport.bottom + viewport.nearOverscan) return WORKSPACE_VISUAL_LOD_TIERS.near;
    return WORKSPACE_VISUAL_LOD_TIERS.far;
  };

  const syncWorkspaceVisualLod = (scope = document) => {
    const viewport = workspaceVisualViewport();
    const layouts = [...scope.querySelectorAll?.(".widget-layout, .panel-layout, .panel-internal-widget-grid") || []]
      .filter((layout) => layout.isConnected);
    const processedItems = new Set();
    layouts.forEach((layout) => {
      const metrics = createGridMetrics(layout);
      const items = isPanelInternalWidgetLayout(layout)
        ? [...layout.querySelectorAll(":scope > .widget-card:not([hidden])")]
        : globalGridItems(layout, { includePlaceholders: false });
      items.forEach((item) => {
        if (processedItems.has(item)) return;
        processedItems.add(item);
        const lod = workspaceVisualLodForItem(item, metrics, viewport);
        item.dataset.visualLod = lod;
        item.dataset.lod = lod;
      });
    });
  };

  let visualLodRefreshFrame = null;
  const scheduleWorkspaceVisualLodRefresh = (scope = document) => {
    if (visualLodRefreshFrame) return;
    visualLodRefreshFrame = window.requestAnimationFrame(() => {
      visualLodRefreshFrame = null;
      syncWorkspaceVisualLod(scope);
    });
  };

  return {
    gridItemDocumentBounds,
    scheduleWorkspaceVisualLodRefresh,
    syncWorkspaceVisualLod,
    workspaceVisualLodForItem,
    workspaceVisualViewport,
  };
};
