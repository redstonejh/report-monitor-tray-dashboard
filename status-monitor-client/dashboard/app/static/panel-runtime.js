(() => {
  const DEFAULT_COLUMNS = 6;

  const createRuntime = (deps = {}) => {
    const columns = deps.columns || DEFAULT_COLUMNS;

    const getPanelMinimumWidth = (panel) => {
      const drawer = panel.querySelector(".panel-tool-drawer");
      const drawerWidth = Math.ceil(drawer?.scrollWidth || 0);
      const buttonCount = drawer?.querySelectorAll(".panel-tool-button").length || 6;
      const fallbackDrawerWidth = (buttonCount * 34) + (Math.max(0, buttonCount - 1) * 6) + 8;
      const measuredDrawerWidth = Math.max(fallbackDrawerWidth, drawerWidth);
      const drawerRightOffset = 42;
      const safeInset = 28;
      return Math.ceil(measuredDrawerWidth + drawerRightOffset + safeInset);
    };

    const syncPanelMinimumWidth = (panel) => {
      panel.style.setProperty("--panel-min-width", `${getPanelMinimumWidth(panel)}px`);
    };

    const getPanelMinimumHeight = (panel) => {
      const headerHeight = Math.ceil(panel.querySelector(".db-panel-hd")?.getBoundingClientRect().height || 58);
      return headerHeight + 168;
    };

    const panelMinimumRows = (panel, metrics = null) => {
      if (!deps.workspaceObjectCapabilities(panel).hasPanelContentArea) return 1;
      if (panel.classList.contains("db-panel-collapsed")) return 1;
      if (metrics?.panelMinimumRows?.has(panel)) return metrics.panelMinimumRows.get(panel);
      const layout = panel.closest(".panel-layout");
      const rows = deps.gridRowsFromHeight(getPanelMinimumHeight(panel), metrics?.gap ?? deps.gridGapForLayout(layout), 1);
      metrics?.panelMinimumRows?.set(panel, rows);
      return rows;
    };

    const panelExpandedMinimumRows = (panel, layout = panel.closest(".panel-layout"), metrics = null) => (
      !deps.workspaceObjectCapabilities(panel).hasExpandedFootprint ? 1 :
      deps.gridRowsFromHeight(getPanelMinimumHeight(panel), metrics?.gap ?? deps.gridGapForLayout(layout), 1)
    );

    const syncPanelRenderedHeightToFootprint = (panel, rowSpan = null) => {
      if (!panel?.classList?.contains("db-panel") || panel.classList.contains("db-panel-placeholder")) return;
      if (!deps.workspaceObjectCapabilities(panel).hasPanelContentArea) {
        panel.dataset.gridRowSpan = "1";
        panel.style.height = "";
        return;
      }
      if (panel.classList.contains("db-panel-collapsed")) {
        panel.style.height = "";
        return;
      }
      const layout = panel.closest(".panel-layout");
      const rows = Math.max(panelMinimumRows(panel), Math.round(Number(rowSpan) || deps.gridItemRowSpan(panel)));
      const height = deps.gridHeightForRows(rows, deps.gridGapForLayout(layout));
      panel.dataset.gridRowSpan = String(rows);
      panel.dataset.savedHeight = String(height);
      panel.style.height = `${height}px`;
    };

    const applyPanelSpan = (panel, span) => {
      const rawSpan = Number(span) || Number(panel.dataset.defaultSpan) || columns;
      const minSpan = deps.gridItemMinimumSpan(panel);
      const safeSpan = Math.max(minSpan, Math.min(columns, rawSpan > columns ? rawSpan / 2 : rawSpan));
      const displaySpan = Math.round(safeSpan);
      panel.dataset.currentSpan = String(displaySpan);
      if (panel.dataset.gridCol && panel.dataset.gridRow) {
        const currentCol = Number(panel.dataset.gridCol) || 1;
        const currentRow = Number(panel.dataset.gridRow) || 1;
        const safeCol = Math.max(1, Math.min(columns + 1 - displaySpan, currentCol));
        panel.dataset.gridCol = String(safeCol);
        panel.dataset.gridRow = String(Math.max(1, currentRow));
        panel.style.gridColumn = `${safeCol} / span ${displaySpan}`;
        panel.style.gridRow = `${panel.dataset.gridRow} / span ${deps.gridItemRowSpan(panel)}`;
      } else {
        panel.style.gridColumn = `span ${displaySpan}`;
        panel.style.removeProperty("grid-row");
      }
      panel.style.removeProperty("width");
      panel.style.removeProperty("--panel-basis");
    };

    const applyPanelGridPosition = (panel, col, row) => {
      const span = Number(panel.dataset.currentSpan) || Number(panel.dataset.defaultSpan) || columns;
      const safeSpan = Math.max(1, Math.min(columns, Math.round(span > columns ? span / 2 : span)));
      const safeCol = Math.max(1, Math.min(columns + 1 - safeSpan, Math.round(Number(col) || 1)));
      const safeRow = Math.max(1, Math.round(Number(row) || 1));
      const rowSpan = deps.gridItemRowSpan(panel);
      panel.dataset.gridCol = String(safeCol);
      panel.dataset.gridRow = String(safeRow);
      panel.dataset.gridRowSpan = String(rowSpan);
      panel.style.gridColumn = `${safeCol} / span ${safeSpan}`;
      panel.style.gridRow = `${safeRow} / span ${rowSpan}`;
      syncPanelRenderedHeightToFootprint(panel, rowSpan);
    };

    const applyPanelHeight = (panel, height) => {
      if (!height) {
        panel.style.height = "";
        delete panel.dataset.savedHeight;
        panel.dataset.gridRowSpan = String(panel.classList.contains("db-panel-collapsed") ? 1 : panelMinimumRows(panel));
        if (panel.dataset.gridCol && panel.dataset.gridRow) applyPanelGridPosition(panel, panel.dataset.gridCol, panel.dataset.gridRow);
        return;
      }
      const layout = panel.closest(".panel-layout");
      const gap = deps.gridGapForLayout(layout);
      const rows = deps.gridRowsFromHeight(Number(height), gap, panelMinimumRows(panel));
      const safeHeight = deps.gridHeightForRows(rows, gap);
      panel.dataset.gridRowSpan = String(rows);
      panel.dataset.savedHeight = String(safeHeight);
      if (panel.dataset.gridCol && panel.dataset.gridRow) applyPanelGridPosition(panel, panel.dataset.gridCol, panel.dataset.gridRow);
      if (!panel.classList.contains("db-panel-collapsed")) {
        panel.style.height = `${safeHeight}px`;
      }
    };

    const openPanelForInternalDrop = (panel) => {
      if (!panel?.classList?.contains("db-panel-collapsed")) return false;
      panel.classList.remove("db-panel-collapsed");
      panel.querySelector(":scope > .db-panel-hd")?.setAttribute("aria-expanded", "true");
      if (panel.dataset.savedHeight) {
        applyPanelHeight(panel, panel.dataset.savedHeight);
      } else {
        panel.dataset.gridRowSpan = String(panelMinimumRows(panel));
      }
      if (panel.dataset.gridCol && panel.dataset.gridRow) {
        applyPanelGridPosition(panel, panel.dataset.gridCol, panel.dataset.gridRow);
      }
      return true;
    };

    const expandedPanelFootprintRows = (panel, layout, proposedRows = null, metrics = null) => {
      if (!deps.workspaceObjectCapabilities(panel).hasExpandedFootprint) return 1;
      const gap = metrics?.gap ?? deps.gridGapForLayout(layout);
      const minRows = panelExpandedMinimumRows(panel, layout, metrics);
      const candidateRows = Number(proposedRows);
      if (Number.isFinite(candidateRows) && candidateRows > 0) {
        return Math.max(minRows, Math.round(candidateRows));
      }
      const savedHeight = Number(panel.dataset.savedHeight);
      if (Number.isFinite(savedHeight) && savedHeight > 0) {
        return deps.gridRowsFromHeight(savedHeight, gap, minRows);
      }
      if (!panel.classList.contains("db-panel-collapsed")) {
        return Math.max(minRows, deps.gridItemRowSpan(panel, metrics));
      }
      return minRows;
    };

    const expandedPanelFootprintHeight = (panel, layout, proposedRows = null, metrics = null) => {
      const rows = expandedPanelFootprintRows(panel, layout, proposedRows, metrics);
      return deps.gridHeightForRows(rows, metrics?.gap ?? deps.gridGapForLayout(layout));
    };

    return Object.freeze({
      getPanelMinimumWidth,
      syncPanelMinimumWidth,
      getPanelMinimumHeight,
      panelMinimumRows,
      panelExpandedMinimumRows,
      syncPanelRenderedHeightToFootprint,
      applyPanelSpan,
      applyPanelGridPosition,
      applyPanelHeight,
      openPanelForInternalDrop,
      expandedPanelFootprintRows,
      expandedPanelFootprintHeight,
    });
  };

  window.dashboardPanelRuntime = Object.freeze({ createRuntime });
})();
