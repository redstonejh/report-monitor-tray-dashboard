export const createPanelFootprintFacade = ({ getPanelRuntime }) => {
  const expandedPanelFootprintRows = (panel, layout, proposedRows = null, metrics = null) => (
    getPanelRuntime().expandedPanelFootprintRows(panel, layout, proposedRows, metrics)
  );

  const expandedPanelFootprintHeight = (panel, layout, proposedRows = null, metrics = null) => (
    getPanelRuntime().expandedPanelFootprintHeight(panel, layout, proposedRows, metrics)
  );

  return {
    expandedPanelFootprintHeight,
    expandedPanelFootprintRows,
  };
};
