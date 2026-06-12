export const createLayoutSnapshotRuntime = ({
  gridHostForLayout,
  isPanelInternalGridItem,
  applyPanelGridPosition,
  gridItemRowSpan,
  gridItemSpan,
}) => {
  const snapshotGridLayout = (layout) => new Map(
    // Panel-internal grids must match too: without them a drag inside a panel
    // snapshots an empty map, so displaced siblings were never restored when
    // the drag preview moved away (displacement read as permanent).
    [...gridHostForLayout(layout).querySelectorAll(".widget-layout > .widget-card:not([hidden]), .panel-internal-widget-grid > .widget-card:not([hidden]), .panel-layout > .db-panel:not([hidden])")]
      .filter((item) => gridHostForLayout(layout) === layout || !isPanelInternalGridItem(item))
      .map((item) => [item, {
        gridCol: item.dataset.gridCol,
        gridRow: item.dataset.gridRow,
        gridRowSpan: item.dataset.gridRowSpan,
        currentSpan: item.dataset.currentSpan,
        savedHeight: item.dataset.savedHeight,
        gridColumnStyle: item.style.gridColumn,
        gridRowStyle: item.style.gridRow,
        heightStyle: item.style.height,
      }])
  );

  const restoreGridLayoutSnapshot = (snapshot, options = {}) => {
    const excluded = new Set([].concat(options.exclude || []).filter(Boolean));
    snapshot?.forEach((state, item) => {
      if (!item.isConnected) return;
      if (excluded.has(item)) return;
      if (state.gridCol === undefined) {
        delete item.dataset.gridCol;
      } else {
        item.dataset.gridCol = state.gridCol;
      }
      if (state.gridRow === undefined) {
        delete item.dataset.gridRow;
      } else {
        item.dataset.gridRow = state.gridRow;
      }
      if (state.gridRowSpan === undefined) {
        delete item.dataset.gridRowSpan;
      } else {
        item.dataset.gridRowSpan = state.gridRowSpan;
      }
      if (state.currentSpan === undefined) {
        delete item.dataset.currentSpan;
      } else {
        item.dataset.currentSpan = state.currentSpan;
      }
      if (state.savedHeight === undefined) {
        delete item.dataset.savedHeight;
      } else {
        item.dataset.savedHeight = state.savedHeight;
      }
      item.style.gridColumn = state.gridColumnStyle || "";
      item.style.gridRow = state.gridRowStyle || "";
      item.style.height = state.heightStyle || "";
      if (item.classList.contains("db-panel-collapsed") && item.dataset.gridCol && item.dataset.gridRow) {
        item.dataset.gridRowSpan = "1";
        applyPanelGridPosition(item, item.dataset.gridCol, item.dataset.gridRow);
      }
    });
  };

  const serializableExpansionBaselineState = (snapshot, item) => {
    const state = snapshot?.get?.(item);
    if (!state?.gridCol || !state?.gridRow) return null;
    return {
      gridCol: state.gridCol,
      gridRow: state.gridRow,
      gridRowSpan: state.gridRowSpan || String(gridItemRowSpan(item)),
      currentSpan: state.currentSpan || String(gridItemSpan(item)),
      savedHeight: state.savedHeight,
      gridColumnStyle: state.gridColumnStyle,
      gridRowStyle: state.gridRowStyle,
      heightStyle: state.heightStyle,
    };
  };

  const expansionBaselineSnapshotForLayoutKey = (layoutKey) => {
    const panelLayout = document.querySelector(`.panel-layout[data-layout-key="${CSS.escape(layoutKey)}"]`);
    const snapshot = panelLayout?.__expansionBaselineSnapshot || null;
    const hasActiveExpansionSource = [...(panelLayout?.__activeExpansionPanels || [])]
      .some((panel) => {
        if (!panel.__activeExpansionSource || panel.classList.contains("db-panel-collapsed")) return false;
        const baselineState = snapshot?.get(panel);
        if (!baselineState) return false;
        return (Number(baselineState.gridRowSpan) || 1) < gridItemRowSpan(panel);
      });
    return hasActiveExpansionSource ? snapshot : null;
  };

  const markLoadedExpansionBaseline = (item, state) => {
    if (state?.gridCol && state?.gridRow) {
      item.__loadedExpansionBaselineState = state;
    } else {
      delete item.__loadedExpansionBaselineState;
    }
  };

  const restoreLoadedExpansionBaseline = (layoutKey) => {
    const panelLayout = document.querySelector(`.panel-layout[data-layout-key="${CSS.escape(layoutKey)}"]`);
    if (!panelLayout) return;
    const expandedPanels = [...panelLayout.querySelectorAll(":scope > .db-panel:not(.db-panel-collapsed):not([hidden])")]
      .filter((panel) => {
        const baselineState = panel.__loadedExpansionBaselineState;
        if (!baselineState) return false;
        if (panel.__loadedExpansionActive) return true;
        return (Number(baselineState.gridRowSpan) || 1) < gridItemRowSpan(panel);
      });
    if (!expandedPanels.length) return;
    const currentSnapshot = snapshotGridLayout(panelLayout);
    let hasStoredBaseline = false;
    currentSnapshot.forEach((state, item) => {
      const loaded = item.__loadedExpansionBaselineState;
      if (loaded?.gridCol && loaded?.gridRow) {
        hasStoredBaseline = true;
        currentSnapshot.set(item, { ...state, ...loaded });
      }
    });
    if (!hasStoredBaseline) return;
    panelLayout.__expansionBaselineSnapshot = currentSnapshot;
    panelLayout.__activeExpansionPanels = new Set(expandedPanels);
    expandedPanels.forEach((panel) => {
      panel.__activeExpansionSource = true;
    });
  };

  return {
    snapshotGridLayout,
    restoreGridLayoutSnapshot,
    serializableExpansionBaselineState,
    expansionBaselineSnapshotForLayoutKey,
    markLoadedExpansionBaseline,
    restoreLoadedExpansionBaseline,
  };
};
