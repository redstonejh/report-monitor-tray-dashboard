export const createPanelPrimitiveFacade = ({
  dashboardPanelContainment,
  getPanelRuntime,
}) => {
  const getPanelMinimumWidth = (panel) => getPanelRuntime().getPanelMinimumWidth(panel);
  const syncPanelMinimumWidth = (panel) => getPanelRuntime().syncPanelMinimumWidth(panel);
  const isPanelInternalWidgetLayout = (layout) => dashboardPanelContainment.isPanelInternalWidgetLayout(layout);
  const panelForInternalWidgetLayout = (layout) => dashboardPanelContainment.panelForInternalWidgetLayout(layout);
  const gridHostForLayout = (layout) => dashboardPanelContainment.gridHostForLayout(layout);
  const isPanelInternalGridItem = (item) => dashboardPanelContainment.isPanelInternalGridItem(item);
  const gridContentRectForHost = (host, rect) => dashboardPanelContainment.gridContentRectForHost(host, rect);

  return {
    getPanelMinimumWidth,
    gridContentRectForHost,
    gridHostForLayout,
    isPanelInternalGridItem,
    isPanelInternalWidgetLayout,
    panelForInternalWidgetLayout,
    syncPanelMinimumWidth,
  };
};
