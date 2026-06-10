export const initializeWorkspacePostInit = ({
  restoreLoadedExpansionBaseline,
  surfaceResponseSelector,
  initWorkspaceMinimapLayer,
  refreshWorkspaceMiniMaps,
  workspaceRegionSummaryForItem,
}) => {
  [...new Set([
    ...[...document.querySelectorAll(".panel-layout")].map((layout) => layout.dataset.layoutKey || "default"),
  ])].forEach(restoreLoadedExpansionBaseline);

  document.addEventListener("contextmenu", (event) => {
    const target = event.target?.closest?.(surfaceResponseSelector) ||
      event.target?.closest?.(".panel-layout > .workspace-divider");
    target?.__openCustomization?.(event);
  }, true);

  document.querySelectorAll(".workspace-minimap-layer").forEach(initWorkspaceMinimapLayer);
  window.addEventListener("scroll", () => refreshWorkspaceMiniMaps(), { passive: true });
  window.addEventListener("resize", () => refreshWorkspaceMiniMaps(), { passive: true });
  window.dashboardSpatialRuntime = {
    refreshMiniMaps: refreshWorkspaceMiniMaps,
    regionSummaryForWidget: (widgetKey) => workspaceRegionSummaryForItem(widgetKey),
  };
};
