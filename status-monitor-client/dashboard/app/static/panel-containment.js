(() => {
  const DEFAULT_COLUMNS = 6;
  const DEFAULT_ROW_HEIGHT = 81;
  const geometry = window.dashboardGeometry;

  const isPanelInternalWidgetLayout = (layout) => layout?.classList?.contains("panel-internal-widget-grid");
  const panelForInternalWidgetLayout = (layout) => layout?.closest?.(".db-panel");
  const gridHostForLayout = (layout) => isPanelInternalWidgetLayout(layout) ? layout : (layout?.closest?.(".dashboard-layout-grid") || layout);
  const isPanelInternalGridItem = (item) => Boolean(item?.closest?.(".panel-internal-widget-grid"));

  const gridContentRectForHost = (host, rect) => {
    if (!host?.classList?.contains("panel-internal-widget-grid")) return rect;
    const computed = window.getComputedStyle(host);
    return geometry.rectFromPadding(rect, {
      paddingLeft: parseFloat(computed.paddingLeft) || 0,
      paddingRight: parseFloat(computed.paddingRight) || 0,
      paddingTop: parseFloat(computed.paddingTop) || 0,
      paddingBottom: parseFloat(computed.paddingBottom) || 0,
    });
  };

  const panelChildWidgets = (panel) => [
    ...panel.querySelectorAll(":scope > .db-panel-body .panel-internal-widget-grid > .widget-card:not([hidden])")
  ];

  const panelInternalGridBlockInsets = (grid) => {
    const styles = window.getComputedStyle(grid);
    return {
      top: parseFloat(styles.paddingTop) || 0,
      bottom: parseFloat(styles.paddingBottom) || 0,
      gap: parseFloat(styles.rowGap || styles.gap) || 0,
    };
  };

  const createRuntime = (deps = {}) => {
    const columns = deps.columns || DEFAULT_COLUMNS;
    const rowHeight = deps.rowHeight || DEFAULT_ROW_HEIGHT;

    const requiredPanelHeightForInternalGrid = (panel, options = {}) => {
      const grid = panel?.querySelector?.(":scope > .db-panel-body > .panel-internal-widget-grid");
      if (!grid || panel.classList.contains("db-panel-collapsed")) return 0;
      const metrics = deps.createGridMetrics(grid);
      const selector = options.includePlaceholders === false
        ? ":scope > .widget-card:not([hidden])"
        : ":scope > .widget-card:not([hidden]), :scope > .widget-placeholder";
      const maxBottom = [...grid.querySelectorAll(selector)]
        .filter((item) => !item.classList.contains("widget-dragging"))
        .reduce((bottom, item) => Math.max(bottom, deps.gridBoundsForItem(item, metrics).bottom), 0);
      if (!maxBottom) return 0;
      const headerHeight = Math.ceil(panel.querySelector(":scope > .db-panel-hd")?.getBoundingClientRect().height || 0);
      const bodyBorder = 1;
      const insets = panelInternalGridBlockInsets(grid);
      // padding-bottom only — there is no extra row-gap below the last
      // widget. Adding insets.gap inflated the required height by one
      // gap, which tipped gridRowsFromHeight() over a row boundary and
      // caused the panel to report rowSpan one row too tall during
      // collision/reflow previews.
      const contentHeight = insets.top + deps.gridHeightForRows(maxBottom, metrics.gap, metrics.rowHeight) + insets.bottom;
      return Math.ceil(headerHeight + bodyBorder + contentHeight);
    };

    const syncOpenPanelHeightToInternalGrid = (panel, options = {}) => {
      if (!panel?.isConnected || panel.classList.contains("db-panel-collapsed")) return false;
      if (!deps.workspaceObjectCapabilities(panel).hasPanelContentArea) return false;
      const requiredHeight = requiredPanelHeightForInternalGrid(panel, options);
      if (!requiredHeight) return false;
      const currentHeight = Number(panel.dataset.savedHeight) || panel.getBoundingClientRect().height || 0;
      const fitContent = options.allowShrink !== false;
      const targetHeight = fitContent
        ? Math.max(deps.getPanelMinimumHeight(panel), requiredHeight)
        : Math.max(currentHeight, requiredHeight);
      const layout = panel.closest(".panel-layout");
      const gap = deps.gridGapForLayout(layout);
      const targetRows = deps.gridRowsFromHeight(targetHeight, gap, deps.panelMinimumRows(panel));
      const currentRows = deps.gridItemRowSpan(panel);
      if (targetRows <= currentRows && Math.abs(targetHeight - currentHeight) < 1) return false;
      deps.applyPanelHeight(panel, deps.gridHeightForRows(targetRows, gap));
      if (options.reflow !== false && layout) deps.applyVerticalPanelExpansion(layout, panel);
      return true;
    };

    const panelRequiredSpanForInternalItem = (panel, item = null) => {
      const currentSpan = Number(panel?.dataset?.currentSpan) || Number(panel?.dataset?.defaultSpan) || 1;
      if (!item) return Math.max(deps.gridItemMinimumSpan(panel), Math.min(columns, Math.round(currentSpan)));
      const itemSpan = Number(item.dataset.currentSpan) || Number(item.dataset.defaultSpan) || 1;
      return Math.max(
        deps.gridItemMinimumSpan(panel),
        Math.min(columns, Math.round(Math.max(currentSpan, itemSpan)))
      );
    };

    const syncPanelFootprintToInternalItem = (panel, item = null, options = {}) => {
      if (!panel?.isConnected || !deps.workspaceObjectCapabilities(panel).hasPanelContentArea) return false;
      const wasOpened = options.openCollapsed ? deps.openPanelForInternalDrop(panel) : false;
      if (panel.classList.contains("db-panel-collapsed")) return wasOpened;
      const layout = panel.closest(".panel-layout");
      const currentSpan = Number(panel.dataset.currentSpan) || Number(panel.dataset.defaultSpan) || 1;
      const requiredSpan = panelRequiredSpanForInternalItem(panel, item);
      let spanChanged = false;
      if (requiredSpan > currentSpan) {
        deps.applyPanelSpan(panel, requiredSpan);
        spanChanged = true;
      }
      const heightChanged = options.syncHeight === false
        ? false
        : syncOpenPanelHeightToInternalGrid(panel, { ...options, reflow: false });
      if ((wasOpened || spanChanged || heightChanged) && options.reflow !== false && layout) {
        const metrics = options.metrics || deps.createGridMetrics(layout);
        deps.resolveSparseGridLayout(
          layout,
          panel,
          {
            col: Number(panel.dataset.gridCol) || 1,
            row: Number(panel.dataset.gridRow) || 1,
          },
          {
            metrics,
            items: options.items || deps.reflowItemsForLayout(layout, panel),
            verticalDisplacement: true,
          }
        );
        deps.applyVerticalPanelExpansion(layout, panel);
      }
      return wasOpened || spanChanged || heightChanged;
    };

    const sanitizePanelChildWidgetClone = (widget) => {
      const clone = widget.cloneNode(true);
      delete clone.dataset.widgetInitialized;
      clone.classList.remove(...deps.undoTransientItemClasses);
      clone.classList.remove(
        "widget-tools-open",
        "widget-dragging",
        "dashboard-active-resize",
        "dashboard-live-resize",
        "dashboard-resize-source",
        "group-selected",
        "group-transform-member"
      );
      clone.removeAttribute("hidden");
      clone.style.removeProperty("left");
      clone.style.removeProperty("top");
      clone.style.removeProperty("width");
      clone.style.removeProperty("position");
      clone.querySelector(".panel-settings-toggle")?.setAttribute("aria-expanded", "false");
      clone.querySelector(".panel-color-toggle")?.setAttribute("aria-expanded", "false");
      clone.querySelectorAll(".panel-color-menu-open").forEach((menu) => menu.classList.remove("panel-color-menu-open"));
      if (typeof deps.applyPanelColor === "function") {
        if (widget.dataset.panelColorCleared === "true") {
          deps.applyPanelColor(clone, null);
        } else if (widget.dataset.panelColor) {
          deps.applyPanelColor(clone, widget.dataset.panelColor);
          if (widget.dataset.panelColorUser === "true") clone.dataset.panelColorUser = "true";
        }
      }
      return clone;
    };

    const serializePanelChildWidgets = (panel) => panelChildWidgets(panel).map((widget) => ({
      key: widget.dataset.widgetKey || "",
      html: sanitizePanelChildWidgetClone(widget).outerHTML,
      gridCol: Number(widget.dataset.gridCol) || null,
      gridRow: Number(widget.dataset.gridRow) || null,
      span: Number(widget.dataset.currentSpan) || Number(widget.dataset.defaultSpan) || null,
      rowSpan: Number(widget.dataset.gridRowSpan) || null,
    }));

    const updatePanelChildEmptyState = (panel) => {
      const body = panel?.querySelector(":scope > .db-panel-body");
      if (!body) return;
      const hasChildren = Boolean(body.querySelector(".panel-internal-widget-grid > .widget-card, .panel-internal-widget-grid > .widget-placeholder"));
      body.querySelector(":scope > .panel-empty-state")?.toggleAttribute("hidden", hasChildren);
      const count = panel.querySelector(":scope > .db-panel-hd .db-panel-count");
      if (count) count.textContent = String(panelChildWidgets(panel).length);
    };

    const ensurePanelInternalWidgetGrid = (panel) => {
      const body = panel?.querySelector(":scope > .db-panel-body");
      if (!body) return null;
      let grid = body.querySelector(":scope > .panel-internal-widget-grid");
      if (!grid) {
        grid = document.createElement("div");
        grid.className = "panel-internal-widget-grid widget-layout";
        grid.dataset.widgetLayoutKey = `${deps.groupItemLayoutKey(panel)}:panel:${panel.dataset.panelKey || "panel"}`;
        grid.dataset.panelContainerKey = panel.dataset.panelKey || "";
        body.appendChild(grid);
      }
      updatePanelChildEmptyState(panel);
      return grid;
    };

    const restorePanelChildWidgets = (panel, definitions = []) => {
      if (!deps.workspaceObjectCapabilities(panel).hasPanelContentArea) return;
      const grid = ensurePanelInternalWidgetGrid(panel);
      if (!grid) return;
      grid.replaceChildren();
      definitions.forEach((definition) => {
        const template = document.createElement("template");
        template.innerHTML = definition?.html || "";
        const widget = template.content.firstElementChild;
        if (!widget?.classList?.contains("widget-card")) return;
        const key = widget.dataset.widgetKey || definition.key || "";
        if (key) {
          document.querySelectorAll(`.widget-layout:not(.panel-internal-widget-grid) > .widget-card[data-widget-key="${CSS.escape(key)}"]`)
            .forEach((duplicate) => duplicate.remove());
        }
        widget.dataset.panelChildWidget = "true";
        widget.dataset.parentPanelKey = panel.dataset.panelKey || "";
        delete widget.dataset.widgetInitialized;
        widget.classList.remove(...deps.undoTransientItemClasses);
        grid.appendChild(widget);
        if (definition?.rowSpan) {
          widget.dataset.gridRowSpan = String(Math.max(1, Math.round(Number(definition.rowSpan) || 1)));
        }
        if (definition?.span) deps.applyWidgetSpan(widget, definition.span);
        if (definition?.gridCol && definition?.gridRow) {
          deps.applyWidgetGridPosition(widget, definition.gridCol, definition.gridRow, definition.rowSpan);
        }
      });
      updatePanelChildEmptyState(panel);
      syncOpenPanelHeightToInternalGrid(panel, { reflow: false });
    };

    const panelBodyRectFromSnapshot = (panel, snapshot) => {
      const state = snapshot?.get?.(panel);
      const body = panel?.querySelector?.(":scope > .db-panel-body");
      const layout = panel?.closest?.(".panel-layout");
      if (!state || !body || !layout) return null;
      const metrics = deps.createGridMetrics(layout);
      const col = Number(state.gridCol) || Number(panel.dataset.gridCol) || 1;
      const row = Number(state.gridRow) || Number(panel.dataset.gridRow) || 1;
      const span = Math.max(1, Math.min(columns, Number(state.currentSpan) || Number(panel.dataset.currentSpan) || columns));
      const rowSpan = Math.max(1, Number(state.gridRowSpan) || deps.gridItemRowSpan(panel, metrics));
      const headerHeight = panel.querySelector(":scope > .db-panel-hd")?.getBoundingClientRect?.().height || 0;
      const left = metrics.rect.left + ((col - 1) * metrics.columnStep);
      const top = metrics.rect.top + ((row - 1) * metrics.rowStep);
      const width = (span * metrics.columnWidth) + (Math.max(0, span - 1) * metrics.gap);
      const height = Number(state.savedHeight) || deps.gridHeightForRows(rowSpan, metrics.gap);
      return {
        left,
        right: left + width,
        top: top + headerHeight,
        bottom: top + Math.max(headerHeight + 1, height),
      };
    };

    const panelHeaderRectFromSnapshot = (panel, snapshot) => {
      const bodyRect = panelBodyRectFromSnapshot(panel, snapshot);
      const state = snapshot?.get?.(panel);
      const layout = panel?.closest?.(".panel-layout");
      const header = panel?.querySelector?.(":scope > .db-panel-hd");
      if (!bodyRect || !state || !layout || !header) return null;
      const metrics = deps.createGridMetrics(layout);
      const row = Number(state.gridRow) || Number(panel.dataset.gridRow) || 1;
      const top = metrics.rect.top + ((row - 1) * metrics.rowStep);
      return {
        left: bodyRect.left,
        right: bodyRect.right,
        top,
        bottom: bodyRect.top,
      };
    };

    const clampPointToPanelBodyRect = (panel, clientX, clientY, snapshot = null) => {
      const body = panel?.querySelector?.(":scope > .db-panel-body");
      const rect = body?.getBoundingClientRect?.() || panelBodyRectFromSnapshot(panel, snapshot);
      if (!rect) return { clientX, clientY };
      return {
        clientX: Math.max(rect.left, Math.min(rect.right, clientX)),
        clientY: Math.max(rect.top, Math.min(rect.bottom, clientY)),
      };
    };

    const panelEntryCandidateAt = (clientX, clientY, draggedWidget, options = {}) => {
      const panels = [...document.querySelectorAll(".panel-layout > .db-panel:not([hidden])")]
        .filter((panel) => panel.isConnected)
        .filter((panel) => panel !== draggedWidget)
        .filter((panel) => !panel.classList.contains("db-panel-dragging"))
        .filter((panel) => !panel.classList.contains("db-panel-collapsed"))
        .filter((panel) => deps.workspaceObjectCapabilities(panel).hasPanelContentArea);
      for (const panel of panels) {
        const body = panel.querySelector(":scope > .db-panel-body");
        const header = panel.querySelector(":scope > .db-panel-hd");
        const collapsed = panel.classList.contains("db-panel-collapsed");
        if (!body || !header) continue;
        if (!collapsed && body.offsetParent === null) continue;
        const rect = collapsed ? null : body.getBoundingClientRect();
        const snapshotBodyRect = panelBodyRectFromSnapshot(panel, options.snapshot);
        const headerRect = header.getBoundingClientRect();
        const snapshotHeaderRect = panelHeaderRectFromSnapshot(panel, options.snapshot);
        if (geometry.pointInRect(clientX, clientY, headerRect) || geometry.pointInRect(clientX, clientY, snapshotHeaderRect)) {
          return { panel, zone: "header" };
        }
        if (geometry.pointInRect(clientX, clientY, rect) || geometry.pointInRect(clientX, clientY, snapshotBodyRect)) {
          return { panel, zone: "body" };
        }
        if (geometry.pointInRect(clientX, clientY, geometry.expandRect(headerRect, deps.panelHeaderEntryTolerancePx || 18)) ||
          geometry.pointInRect(clientX, clientY, geometry.expandRect(snapshotHeaderRect, deps.panelHeaderEntryTolerancePx || 18))) {
          return { panel, zone: "header-tolerance" };
        }
        if (geometry.pointInRect(clientX, clientY, geometry.expandRect(rect, deps.panelEntryTolerancePx || 42)) ||
          geometry.pointInRect(clientX, clientY, geometry.expandRect(snapshotBodyRect, deps.panelEntryTolerancePx || 42))) {
          return { panel, zone: "body-tolerance" };
        }
      }
      return null;
    };

    const animateAbsorbedWidgetIntoPanel = (widget, fromRect) => {
      if (!widget || !fromRect) return;
      const toRect = widget.getBoundingClientRect();
      const dx = fromRect.left - toRect.left;
      const dy = fromRect.top - toRect.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      widget.animate(
        [
          { transform: `translate(${Math.round(dx)}px, ${Math.round(dy)}px) scale(1.006)`, opacity: .94 },
          { transform: "translate(0, 0) scale(1)", opacity: 1 },
        ],
        { duration: 280, easing: "cubic-bezier(.2, .8, .2, 1)" }
      );
    };

    const workspaceWidgetLayoutForPanel = (panel) => {
      const host = panel?.closest?.(".dashboard-layout-grid");
      const layoutKey = panel?.closest?.(".panel-layout")?.dataset?.layoutKey || deps.groupItemLayoutKey(panel);
      if (!host || !layoutKey) return null;
      return host.querySelector(`:scope > .widget-layout[data-widget-layout-key="${CSS.escape(layoutKey)}"]:not(.panel-internal-widget-grid)`);
    };

    const absorbWidgetIntoPanel = ({ widget, sourceLayout, panel, clientX, clientY, fromRect, targetCell = null }) => {
      const internalGrid = ensurePanelInternalWidgetGrid(panel);
      if (!internalGrid) return null;
      const widgetKey = widget.dataset.widgetKey || "";
      if (widgetKey && !widget.dataset.customWidget) {
        const hidden = deps.readDraftList(sourceLayout, "hiddenWidgetsDraft");
        if (!hidden.includes(widgetKey)) hidden.push(widgetKey);
        deps.writeDraftList(sourceLayout, "hiddenWidgetsDraft", hidden);
      }
      const clone = sanitizePanelChildWidgetClone(widget);
      clone.dataset.panelChildWidget = "true";
      clone.dataset.parentPanelKey = panel.dataset.panelKey || "";
      delete clone.dataset.widgetInitialized;
      if (!clone.dataset.gridRowSpan) clone.dataset.gridRowSpan = "1";
      deps.applyWidgetSpan(clone, Math.max(deps.gridItemMinimumSpan(clone), Math.min(columns, Number(widget.dataset.currentSpan) || Number(widget.dataset.defaultSpan) || 1)));
      widget.remove();
      internalGrid.appendChild(clone);
      syncPanelFootprintToInternalItem(panel, clone, { openCollapsed: true, reflow: false, syncHeight: false });
      const metrics = deps.createGridMetrics(internalGrid);
      const target = targetCell || deps.gridCellFromPoint(internalGrid, clone, clientX, clientY, metrics);
      deps.applyWidgetGridPosition(clone, target.col, target.row);
      deps.resolveSparseGridLayout(internalGrid, clone, target, { metrics });
      syncPanelFootprintToInternalItem(panel, clone);
      const panelLayout = panel.closest(".panel-layout");
      if (panelLayout) deps.applyVerticalPanelExpansion(panelLayout, panel);
      deps.initWidgetLayout(internalGrid);
      updatePanelChildEmptyState(panel);
      animateAbsorbedWidgetIntoPanel(clone, fromRect);
      deps.emitWorkspaceEvent({
        type: "widget-moved-into-panel",
        source: "panel-containment",
        layoutKey: deps.gridItemLayoutKey(sourceLayout || internalGrid),
        objectId: clone.dataset.widgetKey || "",
        objectType: "widget",
        panelId: panel.dataset.panelKey || "",
        regionId: deps.regionIdForWorkspaceItem(panel),
        label: `${clone.dataset.widgetDisplayName || "Widget"} moved into panel`,
        payload: {
          parentPanelId: panel.dataset.panelKey || "",
          col: Number(clone.dataset.gridCol) || 0,
          row: Number(clone.dataset.gridRow) || 0,
        },
      });
      return clone;
    };

    const extractPanelChildWidgetToWorkspace = ({ widget, sourceLayout, targetLayout, panel, targetCell, fromRect }) => {
      if (!widget || !sourceLayout || !targetLayout || !panel) return null;
      const widgetKey = widget.dataset.widgetKey || "";
      const clone = sanitizePanelChildWidgetClone(widget);
      delete clone.dataset.panelChildWidget;
      delete clone.dataset.parentPanelKey;
      delete clone.dataset.widgetInitialized;
      targetLayout.appendChild(clone);
      deps.applyWidgetGridPosition(clone, targetCell?.col || 1, targetCell?.row || 1);
      const metrics = deps.createGridMetrics(targetLayout);
      const result = deps.commitActiveDropSlot(targetLayout, clone, targetCell || deps.gridBoundsForItem(clone, metrics), {
        fallbackToNearestOpenSlot: true,
        metrics,
      });
      if (!result?.bounds) {
        clone.remove();
        return null;
      }
      if (widgetKey) {
        const hidden = deps.readDraftList(targetLayout, "hiddenWidgetsDraft")
          .filter((hiddenKey) => hiddenKey !== widgetKey);
        deps.writeDraftList(targetLayout, "hiddenWidgetsDraft", hidden);
      }
      widget.remove();
      targetLayout.__initWidget?.(clone);
      updatePanelChildEmptyState(panel);
      animateAbsorbedWidgetIntoPanel(clone, fromRect);
      deps.cleanupWidgetRowBreaks(targetLayout);
      deps.emitWorkspaceEvent({
        type: "widget-moved-out-of-panel",
        source: "panel-containment",
        layoutKey: deps.gridItemLayoutKey(targetLayout),
        objectId: clone.dataset.widgetKey || "",
        objectType: "widget",
        panelId: panel.dataset.panelKey || "",
        regionId: deps.regionIdForWorkspaceItem(clone),
        label: `${clone.dataset.widgetDisplayName || "Widget"} moved out of panel`,
        payload: {
          fromPanelId: panel.dataset.panelKey || "",
          col: Number(clone.dataset.gridCol) || 0,
          row: Number(clone.dataset.gridRow) || 0,
        },
      });
      return { widget: clone, ...result };
    };

    return Object.freeze({
      requiredPanelHeightForInternalGrid,
      syncOpenPanelHeightToInternalGrid,
      panelRequiredSpanForInternalItem,
      syncPanelFootprintToInternalItem,
      sanitizePanelChildWidgetClone,
      serializePanelChildWidgets,
      updatePanelChildEmptyState,
      ensurePanelInternalWidgetGrid,
      restorePanelChildWidgets,
      panelBodyRectFromSnapshot,
      panelHeaderRectFromSnapshot,
      clampPointToPanelBodyRect,
      panelEntryCandidateAt,
      animateAbsorbedWidgetIntoPanel,
      workspaceWidgetLayoutForPanel,
      absorbWidgetIntoPanel,
      extractPanelChildWidgetToWorkspace,
    });
  };

  window.dashboardPanelContainment = Object.freeze({
    createRuntime,
    isPanelInternalWidgetLayout,
    panelForInternalWidgetLayout,
    gridHostForLayout,
    isPanelInternalGridItem,
    gridContentRectForHost,
    panelChildWidgets,
    panelInternalGridBlockInsets,
  });
})();
