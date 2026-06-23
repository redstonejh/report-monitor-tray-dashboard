export const initializeWorkspacePostInit = ({
  restoreLoadedExpansionBaseline,
  surfaceResponseSelector,
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

  window.dashboardSpatialRuntime = {
    regionSummaryForWidget: (widgetKey) => workspaceRegionSummaryForItem(widgetKey),
  };
};
