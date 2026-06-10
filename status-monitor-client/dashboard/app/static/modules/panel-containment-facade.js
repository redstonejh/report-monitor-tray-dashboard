export const createPanelContainmentFacade = ({
  dashboardPanelContainment,
  getPanelContainmentRuntime,
  getPanelRuntime,
}) => {
  const panelChildWidgets = (panel) => dashboardPanelContainment.panelChildWidgets(panel);
  const panelInternalGridBlockInsets = (grid) => dashboardPanelContainment.panelInternalGridBlockInsets(grid);
  const requiredPanelHeightForInternalGrid = (panel, options = {}) => (
    getPanelContainmentRuntime().requiredPanelHeightForInternalGrid(panel, options)
  );
  const syncOpenPanelHeightToInternalGrid = (panel, options = {}) => (
    getPanelContainmentRuntime().syncOpenPanelHeightToInternalGrid(panel, options)
  );
  const panelRequiredSpanForInternalItem = (panel, item = null) => (
    getPanelContainmentRuntime().panelRequiredSpanForInternalItem(panel, item)
  );
  const openPanelForInternalDrop = (panel) => getPanelRuntime().openPanelForInternalDrop(panel);
  const syncPanelFootprintToInternalItem = (panel, item = null, options = {}) => (
    getPanelContainmentRuntime().syncPanelFootprintToInternalItem(panel, item, options)
  );
  const sanitizePanelChildWidgetClone = (widget) => getPanelContainmentRuntime().sanitizePanelChildWidgetClone(widget);
  const serializePanelChildWidgets = (panel) => getPanelContainmentRuntime().serializePanelChildWidgets(panel);
  const updatePanelChildEmptyState = (panel) => getPanelContainmentRuntime().updatePanelChildEmptyState(panel);
  const ensurePanelInternalWidgetGrid = (panel) => getPanelContainmentRuntime().ensurePanelInternalWidgetGrid(panel);
  const restorePanelChildWidgets = (panel, definitions = []) => (
    getPanelContainmentRuntime().restorePanelChildWidgets(panel, definitions)
  );

  return {
    ensurePanelInternalWidgetGrid,
    openPanelForInternalDrop,
    panelChildWidgets,
    panelInternalGridBlockInsets,
    panelRequiredSpanForInternalItem,
    requiredPanelHeightForInternalGrid,
    restorePanelChildWidgets,
    sanitizePanelChildWidgetClone,
    serializePanelChildWidgets,
    syncOpenPanelHeightToInternalGrid,
    syncPanelFootprintToInternalItem,
    updatePanelChildEmptyState,
  };
};
