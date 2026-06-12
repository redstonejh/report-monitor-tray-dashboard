export const createOrderedDragRuntime = (deps = {}) => {
  const {
    DASHBOARD_GRID_COLUMNS,
    DASHBOARD_GRID_ROW_HEIGHT,
    dashboardDragRuntime,
    workspaceObjectCapabilities,
    gridHostForLayout,
    clearSurfaceResponse,
    groupTransformItems,
    gridBoundsForItem,
    gridItemRowSpan,
    createGroupFootprint,
    beginGroupLiveSurfaces,
    createExpandedFootprintGhost,
    closeInactiveDashboardTools,
    createGridMetrics,
    refreshGridMetricsRect,
    reflowItemsForLayout,
    isPanelInternalWidgetLayout,
    panelForInternalWidgetLayout,
    workspaceWidgetLayoutForPanel,
    snapshotGridLayout,
    restoreGridLayoutSnapshot,
    createPanelDropPlaceholder,
    syncPanelFootprintToInternalItem,
    triggerPanelHeaderEntryFeedback,
    triggerPanelBoundaryExitFeedback,
    updatePanelChildEmptyState,
    createWorkspaceExitPlaceholder,
    widgetRuntimeController,
    panelRuntime,
    animateOrderedGridReflow,
    panelEntryCandidateAt,
    ensurePanelInternalWidgetGrid,
    clampPointToPanelBodyRect,
    absorbWidgetIntoPanel,
    extractPanelChildWidgetToWorkspace,
    gridCellFromPoint,
    gridCellFromDragPointer,
    updateExpandedFootprintGhost,
    gridRectForLayout,
    pointInRect,
    boundsAtGridSlot,
    resolveSparseGridLayout,
    commitExpandedPanelDropSlot,
    commitActiveDropSlot,
    syncCommittedWorkspaceScrollFloor,
    scheduleWorkspaceVisualLodRefresh,
    applyGroupDelta,
  } = deps;

  const runOrderedDrag = ({
    layout,
    item,
    event,
    draggingClass,
    placeholderClass,
    threshold = 6,
    onCommit,
    onCancel,
    onStart,
    onEnd,
    deferStartEventHandling = false,
  }) => {
    let interactionStarted = false;
    const markInteractionStarted = (sourceEvent = null) => {
      if (interactionStarted) return;
      interactionStarted = true;
      sourceEvent?.preventDefault?.();
      sourceEvent?.stopPropagation?.();
      document.body.classList.add("panel-interaction-active");
      window.getSelection?.()?.removeAllRanges();
    };
    if (!deferStartEventHandling) {
      markInteractionStarted(event);
    }
    const startX = event.clientX;
    const startY = event.clientY;
    const dragController = dashboardDragRuntime.createPointerDragController({ event, item, mode: "drag" });
    const pointerId = dragController.pointerId;
    const pointerTarget = dragController.pointerTarget;
    const capturePointer = () => dragController.capturePointer();
    let ended = false;
    let rect = null;
    let offsetX = 0;
    let offsetY = 0;
    let dragging = false;
    let placeholder = null;
    let startSnapshot = null;
    let targetCell = null;
    let groupDrag = null;
    let groupLive = null;
    let expandedFootprintGhost = null;
    let dragMetrics = null;
    let reflowItems = null;
    let dragVisualOrigin = { left: 0, top: 0 };
    const panelEntryIntent = {
      lastX: startX,
      lastY: startY,
      lastTime: event.timeStamp || performance.now(),
      headerPanel: null,
      headerSince: 0,
    };
    const canAbsorbIntoPanel = (
      item.classList.contains("widget-card") &&
      layout.classList.contains("widget-layout") &&
      !isPanelInternalWidgetLayout(layout)
    );
    let panelDrag = null;
    const sourcePanelForPanelLocalDrag = isPanelInternalWidgetLayout(layout)
      ? panelForInternalWidgetLayout(layout)
      : null;
    const workspaceExitLayout = sourcePanelForPanelLocalDrag
      ? workspaceWidgetLayoutForPanel(sourcePanelForPanelLocalDrag)
      : null;
    const isPanelLocalDrag = Boolean(sourcePanelForPanelLocalDrag);
    const canExitPanelToWorkspace = (
      item.classList.contains("widget-card") &&
      !groupDrag &&
      Boolean(sourcePanelForPanelLocalDrag) &&
      Boolean(workspaceExitLayout)
    );
    let panelExitDrag = null;
    const originalCell = {
      col: Number(item.dataset.gridCol) || 1,
      row: Number(item.dataset.gridRow) || 1,
    };
    let lastMoveEvent = event;
    // Drag targets used to be clamped to the rows visible in the viewport
    // ("committed page bottom"). That lock blocked dragging objects below the
    // fold and caused interaction bugs, so drags are unbounded now.
    const committedPageBottomRow = Infinity;

    const clampCellToCommittedRows = (cell, rowSpan = null, maxBottom = committedPageBottomRow) => {
      if (!cell || !Number.isFinite(maxBottom)) return cell;
      const safeRowSpan = Math.max(1, Math.round(Number(rowSpan) || gridItemRowSpan(placeholder || item) || 1));
      const maxRow = Math.max(1, Math.round(maxBottom) - safeRowSpan + 1);
      return {
        ...cell,
        row: Math.max(1, Math.min(maxRow, Math.round(Number(cell.row) || 1))),
      };
    };

    const setDragVisualPosition = (left, top) => {
      item.style.left = `${Math.round(left - dragVisualOrigin.left)}px`;
      item.style.top = `${Math.round(top - dragVisualOrigin.top)}px`;
    };

    const calibrateDragVisualOrigin = (expectedRect) => {
      const actualRect = item.getBoundingClientRect();
      const offsetLeft = actualRect.left - expectedRect.left;
      const offsetTop = actualRect.top - expectedRect.top;
      dragVisualOrigin = {
        left: Math.abs(offsetLeft) > 12 ? offsetLeft : 0,
        top: Math.abs(offsetTop) > 12 ? offsetTop : 0,
      };
      if (dragVisualOrigin.left || dragVisualOrigin.top) {
        setDragVisualPosition(expectedRect.left, expectedRect.top);
      }
    };

    const startDrag = (sourceEvent = null) => {
      if (dragging) return;
      markInteractionStarted(sourceEvent);
      clearSurfaceResponse();
      dragController.beginInteraction({
        layout,
        item,
        clientX: sourceEvent?.clientX ?? startX,
        clientY: sourceEvent?.clientY ?? startY,
      });
      if (deferStartEventHandling) capturePointer();
      dragging = true;
      item.dataset.visualLod = "active";
      item.dataset.lod = "active";
      rect = item.getBoundingClientRect();
      startSnapshot = snapshotGridLayout(layout);
      const groupItems = groupTransformItems(item)
        .filter((groupItem) => groupItem === item || !groupItem.classList.contains("db-panel-pinned"));
      if (item.classList.contains("group-selected") && groupItems.length > 1) {
        const startBounds = new Map(groupItems.map((groupItem) => [groupItem, gridBoundsForItem(groupItem)]));
        const groupBox = groupGridBox([...startBounds.values()]);
        const footprint = createGroupFootprint(layout, groupBox, "dashboard-group-drag-footprint");
        placeholder = footprint.footprint;
        groupLive = beginGroupLiveSurfaces(groupItems);
        groupDrag = { items: groupItems, startBounds, groupBox, footprintLayout: footprint.footprintLayout };
        offsetX = startX - groupLive.groupRect.left;
        offsetY = startY - groupLive.groupRect.top;
        targetCell = { col: groupBox.col, row: groupBox.row };
        document.body.classList.add("group-transform-active");
        groupItems.forEach((groupItem) => groupItem.classList.add("group-transform-member"));
      } else {
        placeholder = document.createElement("div");
        placeholder.className = placeholderClass;
        placeholder.dataset.currentSpan = item.dataset.currentSpan || item.dataset.defaultSpan || "1";
        placeholder.dataset.defaultSpan = item.dataset.defaultSpan || placeholder.dataset.currentSpan;
        placeholder.dataset.gridRowSpan = String(gridItemRowSpan(item));
        placeholder.style.gridColumn = item.style.gridColumn || `span ${placeholder.dataset.currentSpan}`;
        placeholder.style.gridRow = item.style.gridRow || "";
        const placeholderMinHeight = isPanelInternalWidgetLayout(layout)
          ? Math.max(1, rect.height)
          : DASHBOARD_GRID_ROW_HEIGHT;
        placeholder.style.height = `${Math.max(placeholderMinHeight, rect.height)}px`;
        layout.insertBefore(placeholder, item);
        item.classList.add(draggingClass);
        item.style.width = `${rect.width}px`;
        if (item.classList.contains("db-panel")) item.style.height = `${rect.height}px`;
        dragVisualOrigin = { left: 0, top: 0 };
        setDragVisualPosition(rect.left, rect.top);
        calibrateDragVisualOrigin(rect);
        expandedFootprintGhost = createExpandedFootprintGhost(item, layout, rect);
        offsetX = startX - rect.left;
        offsetY = startY - rect.top;
        targetCell = originalCell;
      }
      dragMetrics = createGridMetrics(layout);
      reflowItems = reflowItemsForLayout(layout, item);
      closeInactiveDashboardTools(item);
      onStart?.();
    };

    const createPanelDropPlaceholder = () => {
      const panelPlaceholder = document.createElement("div");
      panelPlaceholder.className = "widget-placeholder panel-local-drop-placeholder";
      panelPlaceholder.dataset.currentSpan = item.dataset.currentSpan || item.dataset.defaultSpan || "1";
      panelPlaceholder.dataset.defaultSpan = item.dataset.defaultSpan || panelPlaceholder.dataset.currentSpan;
      panelPlaceholder.dataset.gridRowSpan = String(gridItemRowSpan(item));
      panelPlaceholder.style.gridColumn = item.style.gridColumn || `span ${panelPlaceholder.dataset.currentSpan}`;
      panelPlaceholder.style.gridRow = item.style.gridRow || "";
      panelPlaceholder.style.height = `${Math.max(DASHBOARD_GRID_ROW_HEIGHT, rect?.height || DASHBOARD_GRID_ROW_HEIGHT)}px`;
      return panelPlaceholder;
    };

    const createWorkspaceExitPlaceholder = () => {
      const workspacePlaceholder = document.createElement("div");
      workspacePlaceholder.className = "widget-placeholder panel-workspace-exit-placeholder";
      workspacePlaceholder.dataset.currentSpan = item.dataset.currentSpan || item.dataset.defaultSpan || "1";
      workspacePlaceholder.dataset.defaultSpan = item.dataset.defaultSpan || workspacePlaceholder.dataset.currentSpan;
      workspacePlaceholder.dataset.gridRowSpan = String(gridItemRowSpan(item));
      workspacePlaceholder.style.gridColumn = item.style.gridColumn || `span ${workspacePlaceholder.dataset.currentSpan}`;
      workspacePlaceholder.style.gridRow = item.style.gridRow || "";
      workspacePlaceholder.style.height = `${Math.max(DASHBOARD_GRID_ROW_HEIGHT, rect?.height || DASHBOARD_GRID_ROW_HEIGHT)}px`;
      return workspacePlaceholder;
    };

    const panelEntryMotionFor = (moveEvent) => {
      const now = moveEvent.timeStamp || performance.now();
      const elapsed = Math.max(1, now - panelEntryIntent.lastTime);
      const stepDx = moveEvent.clientX - panelEntryIntent.lastX;
      const stepDy = moveEvent.clientY - panelEntryIntent.lastY;
      panelEntryIntent.lastX = moveEvent.clientX;
      panelEntryIntent.lastY = moveEvent.clientY;
      panelEntryIntent.lastTime = now;
      return {
        now,
        stepDx,
        stepDy,
        totalDx: moveEvent.clientX - startX,
        totalDy: moveEvent.clientY - startY,
        speed: Math.hypot(stepDx, stepDy) / elapsed,
      };
    };

    const triggerPanelHeaderEntryFeedback = (panel) => {
      if (!panel) return;
      panel.classList.remove("panel-header-entry-accept");
      void panel.offsetWidth;
      panel.classList.add("panel-header-entry-accept");
      const feedbackToken = String(performance.now());
      const minVisibleUntil = performance.now() + 260;
      panel.dataset.panelHeaderEntryFeedbackToken = feedbackToken;
      const clearFeedback = () => {
        if (panel.dataset.panelHeaderEntryFeedbackToken !== feedbackToken) return;
        const remaining = minVisibleUntil - performance.now();
        if (remaining > 0) {
          window.setTimeout(clearFeedback, remaining);
          return;
        }
        panel.classList.remove("panel-header-entry-accept");
        delete panel.dataset.panelHeaderEntryFeedbackToken;
      };
      panel.addEventListener("animationend", clearFeedback, { once: true });
      window.setTimeout(clearFeedback, 320);
    };

    const triggerPanelBoundaryExitFeedback = (panel) => {
      if (!panel) return;
      panel.dataset.panelBoundaryExitFeedback = "true";
      panel.classList.remove("panel-boundary-exit-release");
      void panel.offsetWidth;
      panel.classList.add("panel-boundary-exit-release");
      panel.addEventListener("animationend", () => {
        panel.classList.remove("panel-boundary-exit-release");
      }, { once: true });
    };

    const clampPanelEntryDelta = (value, limit = 28) => Math.max(-limit, Math.min(limit, value));

    const restartPanelEntryAnimation = (element, className) => {
      if (!element) return;
      element.classList.remove(className);
      void element.offsetWidth;
      element.classList.add(className);
    };

    const animatePanelEntryTransition = (state) => {
      if (!state?.placeholder || !state.placeholder.isConnected) return;
      const placeholderRect = state.placeholder.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();
      const previewDx = Math.round(itemRect.left - placeholderRect.left);
      const previewDy = Math.round(itemRect.top - placeholderRect.top);
      state.placeholder.style.setProperty("--panel-entry-preview-x", `${previewDx}px`);
      state.placeholder.style.setProperty("--panel-entry-preview-y", `${previewDy}px`);
      state.placeholder.style.setProperty("--panel-entry-preview-overshoot-x", `${clampPanelEntryDelta(previewDx * -.08, 8)}px`);
      state.placeholder.style.setProperty("--panel-entry-preview-overshoot-y", `${clampPanelEntryDelta(previewDy * -.08, 8)}px`);
      restartPanelEntryAnimation(state.placeholder, "panel-entry-preview-transition");

      const ghostDx = clampPanelEntryDelta((placeholderRect.left - itemRect.left) * .12);
      const ghostDy = clampPanelEntryDelta((placeholderRect.top - itemRect.top) * .12);
      item.style.setProperty("--panel-entry-ghost-x", `${Math.round(ghostDx)}px`);
      item.style.setProperty("--panel-entry-ghost-y", `${Math.round(ghostDy)}px`);
      item.style.setProperty("--panel-entry-ghost-return-x", `${Math.round(ghostDx * -.28)}px`);
      item.style.setProperty("--panel-entry-ghost-return-y", `${Math.round(ghostDy * -.28)}px`);
      restartPanelEntryAnimation(item, "panel-entry-ghost-transition");
    };

    const animatePanelExitTransition = (state) => {
      if (!state?.placeholder || !state.placeholder.isConnected) return;
      const placeholderRect = state.placeholder.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();
      const previewDx = Math.round(itemRect.left - placeholderRect.left);
      const previewDy = Math.round(itemRect.top - placeholderRect.top);
      state.placeholder.style.setProperty("--panel-entry-preview-x", `${previewDx}px`);
      state.placeholder.style.setProperty("--panel-entry-preview-y", `${previewDy}px`);
      state.placeholder.style.setProperty("--panel-entry-preview-overshoot-x", `${clampPanelEntryDelta(previewDx * -.08, 8)}px`);
      state.placeholder.style.setProperty("--panel-entry-preview-overshoot-y", `${clampPanelEntryDelta(previewDy * -.08, 8)}px`);
      restartPanelEntryAnimation(state.placeholder, "panel-exit-preview-transition");

      const ghostDx = clampPanelEntryDelta((placeholderRect.left - itemRect.left) * .12);
      const ghostDy = clampPanelEntryDelta((placeholderRect.top - itemRect.top) * .12);
      item.style.setProperty("--panel-entry-ghost-x", `${Math.round(ghostDx)}px`);
      item.style.setProperty("--panel-entry-ghost-y", `${Math.round(ghostDy)}px`);
      item.style.setProperty("--panel-entry-ghost-return-x", `${Math.round(ghostDx * -.28)}px`);
      item.style.setProperty("--panel-entry-ghost-return-y", `${Math.round(ghostDy * -.28)}px`);
      restartPanelEntryAnimation(item, "panel-exit-ghost-transition");
      triggerPanelBoundaryExitFeedback(state.panel);
    };

    const acceptsHeaderPanelEntry = (panel, motion, options = {}) => {
      if (!motion) return false;
      if (panelEntryIntent.headerPanel !== panel) {
        panelEntryIntent.headerPanel = panel;
        panelEntryIntent.headerSince = motion.now;
      }
      const dwell = motion.now - panelEntryIntent.headerSince;
      const clearlyDownward = motion.totalDy > 20 &&
        motion.stepDy >= -1 &&
        motion.totalDy >= Math.abs(motion.totalDx) * .7;
      const slowIntentionalHeaderEntry = dwell >= 120 && motion.speed <= .42;
      const slowEnough = motion.speed <= .36;
      const directionalHeaderEntry = !options.requiresSlowIntent &&
        dwell >= 40 &&
        clearlyDownward &&
        (slowEnough || dwell >= 120);
      return slowIntentionalHeaderEntry || directionalHeaderEntry;
    };

    const clearPanelDragPreview = ({ restore = true } = {}) => {
      if (!panelDrag) return;
      const state = panelDrag;
      panelDrag = null;
      state.panel.classList.remove("panel-container-drag-active", "panel-header-entry-accept");
      item.classList.remove("panel-entry-ghost-transition", "panel-exit-ghost-transition");
      if (restore) restoreGridLayoutSnapshot(state.snapshot, { exclude: [state.placeholder] });
      if (restore && state.panelLayout && state.panelLayoutSnapshot) {
        restoreGridLayoutSnapshot(state.panelLayoutSnapshot);
        if (state.wasCollapsed) {
          state.panel.classList.add("db-panel-collapsed");
          state.panel.querySelector(":scope > .db-panel-hd")?.setAttribute("aria-expanded", "false");
          state.panel.dataset.gridRowSpan = "1";
          state.panel.style.height = "";
          if (state.panel.dataset.gridCol && state.panel.dataset.gridRow) {
            panelRuntime.applyPanelGridPosition(state.panel, state.panel.dataset.gridCol, state.panel.dataset.gridRow);
          }
        }
      }
      state.placeholder.remove();
      updatePanelChildEmptyState(state.panel);
      if (placeholder) placeholder.style.visibility = "";
      targetCell = null;
    };

    const clearPanelExitPreview = ({ restore = true } = {}) => {
      if (!panelExitDrag) return;
      const state = panelExitDrag;
      panelExitDrag = null;
      state.panel.classList.remove("panel-container-drag-active", "panel-boundary-exit-release");
      delete state.panel.dataset.panelBoundaryExitFeedback;
      item.classList.remove("panel-exit-ghost-transition");
      if (restore) restoreGridLayoutSnapshot(state.snapshot, { exclude: [state.placeholder] });
      state.placeholder.remove();
      updatePanelChildEmptyState(state.panel);
      if (placeholder) placeholder.style.visibility = "";
      targetCell = null;
    };

    const enterPanelDragPreview = (panel, options = {}) => {
      if (panelDrag?.panel === panel) return panelDrag;
      clearPanelDragPreview();
      if (!panel || groupDrag) return null;
      const internalGrid = ensurePanelInternalWidgetGrid(panel);
      if (!internalGrid) return null;
      restoreGridLayoutSnapshot(startSnapshot, { exclude: [item] });
      if (placeholder) {
        widgetRuntimeController.applyGridPosition(placeholder, originalCell.col, originalCell.row);
        placeholder.style.visibility = "hidden";
      }
      const snapshot = snapshotGridLayout(internalGrid);
      const panelLayout = panel.closest(".panel-layout");
      const panelLayoutSnapshot = panelLayout ? snapshotGridLayout(panelLayout) : null;
      const panelPlaceholder = createPanelDropPlaceholder();
      internalGrid.appendChild(panelPlaceholder);
      panel.classList.add("panel-container-drag-active");
      const wasCollapsed = panel.classList.contains("db-panel-collapsed");
      syncPanelFootprintToInternalItem(panel, panelPlaceholder, {
        includePlaceholders: true,
        openCollapsed: true,
        metrics: panelLayout ? createGridMetrics(panelLayout) : null,
      });
      if (options.zone === "header" || options.zone === "header-tolerance") triggerPanelHeaderEntryFeedback(panel);
      panelDrag = {
        panel,
        panelLayout,
        panelLayoutSnapshot,
        layout: internalGrid,
        placeholder: panelPlaceholder,
        snapshot,
        metrics: createGridMetrics(internalGrid),
        reflowItems: reflowItemsForLayout(internalGrid, panelPlaceholder),
        committedPageBottomRow: Infinity,
        targetCell: null,
        entryZone: options.zone || "body",
        entryTransitionPlayed: false,
        wasCollapsed,
      };
      updatePanelChildEmptyState(panel);
      return panelDrag;
    };

    const updatePanelDragPreview = (moveEvent, motion = null) => {
      if (!canAbsorbIntoPanel || groupDrag || !dragging || !placeholder) {
        clearPanelDragPreview();
        return false;
      }
      const candidate = panelEntryCandidateAt(moveEvent.clientX, moveEvent.clientY, item, { snapshot: startSnapshot });
      if (!candidate) {
        panelEntryIntent.headerPanel = null;
        panelEntryIntent.headerSince = 0;
        clearPanelDragPreview();
        return false;
      }
      if (!panelDrag) {
        if (candidate.zone === "header" || candidate.zone === "header-tolerance") {
          if (!acceptsHeaderPanelEntry(candidate.panel, motion, { requiresSlowIntent: candidate.zone === "header-tolerance" })) return false;
        }
      }
      const state = enterPanelDragPreview(candidate.panel, { zone: candidate.zone });
      if (!state) return false;
      const candidateIsHeaderEntry = candidate.zone === "header" || candidate.zone === "header-tolerance";
      if (candidateIsHeaderEntry && state.entryZone !== candidate.zone && state.entryZone !== "header") {
        state.entryZone = candidate.zone;
        state.entryTransitionPlayed = false;
        triggerPanelHeaderEntryFeedback(candidate.panel);
      }
      const metrics = refreshGridMetricsRect(state.metrics);
      const previewPoint = candidate.zone === "body-tolerance" || candidate.zone === "header" || candidate.zone === "header-tolerance"
        ? clampPointToPanelBodyRect(candidate.panel, moveEvent.clientX, moveEvent.clientY, startSnapshot)
        : { clientX: moveEvent.clientX, clientY: moveEvent.clientY };
      const nextCell = clampCellToCommittedRows(
        gridCellFromDragPointer(state.layout, state.placeholder, previewPoint.clientX, previewPoint.clientY, offsetX, offsetY, metrics, rect),
        gridItemRowSpan(state.placeholder),
        state.committedPageBottomRow
      );
      const shouldPlayEntryTransition = (state.entryZone === "header" || state.entryZone === "header-tolerance") && !state.entryTransitionPlayed;
      if (state.targetCell && state.targetCell.col === nextCell.col && state.targetCell.row === nextCell.row && !shouldPlayEntryTransition) return true;
      state.targetCell = nextCell;
      animateOrderedGridReflow(state.layout, () => {
        restoreGridLayoutSnapshot(state.snapshot, { exclude: [state.placeholder] });
        resolveSparseGridLayout(state.layout, state.placeholder, nextCell, {
          afterOnly: true,
          metrics,
          items: state.reflowItems,
          rowLimit: state.committedPageBottomRow,
        });
      }, state.placeholder, { items: state.reflowItems, metrics });
      syncPanelFootprintToInternalItem(state.panel, state.placeholder, {
        includePlaceholders: true,
        metrics: state.panelLayout ? createGridMetrics(state.panelLayout) : null,
      });
      state.metrics = createGridMetrics(state.layout);
      if (shouldPlayEntryTransition) {
        state.entryTransitionPlayed = true;
        animatePanelEntryTransition(state);
      }
      updatePanelChildEmptyState(state.panel);
      return true;
    };

    const pointerInsidePanelShell = (panel, clientX, clientY) => {
      if (!panel || panel.classList.contains("db-panel-collapsed")) return false;
      return pointInRect(clientX, clientY, panel.getBoundingClientRect());
    };

    const enterWorkspaceExitPreview = () => {
      if (panelExitDrag) return panelExitDrag;
      if (!sourcePanelForPanelLocalDrag || !workspaceExitLayout || groupDrag) return null;
      restoreGridLayoutSnapshot(startSnapshot, { exclude: [item] });
      if (placeholder) {
        widgetRuntimeController.applyGridPosition(placeholder, originalCell.col, originalCell.row);
        placeholder.style.visibility = "hidden";
      }
      const snapshot = snapshotGridLayout(workspaceExitLayout);
      const workspacePlaceholder = createWorkspaceExitPlaceholder();
      workspaceExitLayout.appendChild(workspacePlaceholder);
      sourcePanelForPanelLocalDrag.classList.add("panel-container-drag-active");
      panelExitDrag = {
        panel: sourcePanelForPanelLocalDrag,
        layout: workspaceExitLayout,
        placeholder: workspacePlaceholder,
        snapshot,
        metrics: createGridMetrics(workspaceExitLayout),
        reflowItems: reflowItemsForLayout(workspaceExitLayout, workspacePlaceholder),
        committedPageBottomRow: Infinity,
        targetCell: null,
        exitTransitionPlayed: false,
      };
      updatePanelChildEmptyState(sourcePanelForPanelLocalDrag);
      return panelExitDrag;
    };

    const updatePanelExitPreview = (moveEvent) => {
      if (!canExitPanelToWorkspace || !dragging || !placeholder) {
        clearPanelExitPreview();
        return false;
      }
      if (pointerInsidePanelShell(sourcePanelForPanelLocalDrag, moveEvent.clientX, moveEvent.clientY)) {
        clearPanelExitPreview();
        return false;
      }
      const state = enterWorkspaceExitPreview();
      if (!state) return false;
      const metrics = refreshGridMetricsRect(state.metrics);
      const nextCell = clampCellToCommittedRows(
        gridCellFromDragPointer(state.layout, state.placeholder, moveEvent.clientX, moveEvent.clientY, offsetX, offsetY, metrics, rect),
        gridItemRowSpan(state.placeholder),
        state.committedPageBottomRow
      );
      const shouldPlayExitTransition = !state.exitTransitionPlayed;
      if (state.targetCell && state.targetCell.col === nextCell.col && state.targetCell.row === nextCell.row) return true;
      state.targetCell = nextCell;
      animateOrderedGridReflow(state.layout, () => {
        restoreGridLayoutSnapshot(state.snapshot, { exclude: [state.placeholder] });
        resolveSparseGridLayout(state.layout, state.placeholder, nextCell, {
          afterOnly: true,
          metrics,
          items: state.reflowItems,
          rowLimit: state.committedPageBottomRow,
        });
      }, state.placeholder, { items: state.reflowItems, metrics });
      if (shouldPlayExitTransition) {
        state.exitTransitionPlayed = true;
        animatePanelExitTransition(state);
      }
      updatePanelChildEmptyState(state.panel);
      return true;
    };

    const movePreview = (clientX, clientY, metrics = null, options = {}) => {
      if (!placeholder) return;
      const previewItem = groupDrag ? placeholder : item;
      const rawCell = options.preservePointerOffset
        ? gridCellFromDragPointer(layout, previewItem, clientX, clientY, offsetX, offsetY, metrics, rect)
        : gridCellFromPoint(layout, previewItem, clientX, clientY, metrics);
      const nextCell = clampCellToCommittedRows(rawCell, groupDrag ? groupDrag.groupBox.bottom - groupDrag.groupBox.row + 1 : gridItemRowSpan(previewItem));
      if (targetCell && targetCell.col === nextCell.col && targetCell.row === nextCell.row) return;
      targetCell = nextCell;
      const expandedPanelDrag = !groupDrag && workspaceObjectCapabilities(item).hasExpandedFootprint && !item.classList.contains("db-panel-collapsed");
      const localVacancy = groupDrag
        ? groupBoxBounds(groupDrag.groupBox)
        : expandedPanelDrag
          ? null
          : boundsAtGridSlot(placeholder, originalCell.col, originalCell.row, metrics);
      animateOrderedGridReflow(layout, () => {
        restoreGridLayoutSnapshot(startSnapshot, { exclude: [item] });
        if (groupDrag) {
          applyGroupFootprintBounds(placeholder, groupDrag.footprintLayout, {
            ...groupBoxBounds(groupDrag.groupBox),
            col: nextCell.col,
            row: nextCell.row,
          });
          resolveSparseGridLayout(layout, placeholder, nextCell, {
            afterOnly: true,
            metrics,
            localVacancy,
            items: reflowItems,
            rowLimit: committedPageBottomRow,
          });
        } else {
          resolveSparseGridLayout(layout, placeholder, nextCell, {
            afterOnly: true,
            metrics,
            localVacancy,
            verticalDisplacement: expandedPanelDrag,
            items: reflowItems,
            rowLimit: committedPageBottomRow,
          });
        }
      }, item, { items: reflowItems, metrics });
      // Keep the host panel's footprint tracking the displaced internal rows
      // while the preview reflows widgets inside it.
      if (isPanelLocalDrag && !groupDrag) {
        syncPanelFootprintToInternalItem(sourcePanelForPanelLocalDrag, placeholder, {
          includePlaceholders: true,
          reflow: false,
        });
      }
    };

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) < threshold) return;
      startDrag(moveEvent);
      moveEvent.preventDefault();
      moveEvent.stopPropagation();
      lastMoveEvent = moveEvent;
      const panelEntryMotion = panelEntryMotionFor(moveEvent);
      const currentMetrics = refreshGridMetricsRect(dragMetrics);
      const gridRect = currentMetrics?.rect || gridRectForLayout(layout);
      const dragRect = groupLive?.groupRect || rect;
      const minLeft = gridRect.left;
      const maxLeft = Math.max(minLeft, gridRect.right - dragRect.width);
      const rawLeft = moveEvent.clientX - offsetX;
      const rawTop = moveEvent.clientY - offsetY;
      const minTop = Math.max(0, gridRect.top);
      const visibleBottom = Math.max(gridRect.bottom, window.innerHeight - 16);
      const maxTop = Math.max(minTop, visibleBottom - Math.min(dragRect.height, window.innerHeight - 32));
      const isPanelLocalDirectDrag = isPanelInternalWidgetLayout(layout) && !groupDrag;
      const nextLeft = isPanelLocalDirectDrag ? rawLeft : Math.max(minLeft, Math.min(maxLeft, rawLeft));
      const nextTop = isPanelLocalDirectDrag ? rawTop : Math.max(minTop, Math.min(maxTop, rawTop));
      if (groupDrag && groupLive) {
        groupLive.update(nextLeft, nextTop);
      } else {
        setDragVisualPosition(nextLeft, nextTop);
      }
      if (!groupDrag && expandedFootprintGhost) {
        updateExpandedFootprintGhost(expandedFootprintGhost, item, layout, {
          left: nextLeft,
          top: nextTop,
          width: rect.width,
        });
      }
      if (updatePanelDragPreview(moveEvent, panelEntryMotion)) {
        return;
      }
      if (updatePanelExitPreview(moveEvent)) {
        return;
      }
      const previewRect = groupDrag && groupLive
        ? { left: nextLeft, top: nextTop, width: dragRect.width, height: dragRect.height }
        : item.getBoundingClientRect();
      if (isPanelLocalDirectDrag) {
        movePreview(moveEvent.clientX, moveEvent.clientY, currentMetrics, { preservePointerOffset: true });
      } else {
        movePreview(previewRect.left + (previewRect.width / 2), previewRect.top + (previewRect.height / 2), currentMetrics);
      }
    };

    const removeListeners = () => {
      dragController.removeListeners();
    };

    const releasePointer = () => {
      dragController.releasePointer();
    };

    const onUp = (upEvent) => {
      if (ended) return;
      ended = true;
      const canceled = upEvent?.type === "pointercancel";
      removeListeners();
      releasePointer();
      document.body.classList.remove("panel-interaction-active");
      document.body.classList.remove("panel-resize-active");
      if (dragging && placeholder) {
          const releaseItemRect = item.getBoundingClientRect();
          if (!groupDrag) {
            item.classList.remove(draggingClass);
            item.style.left = "";
            item.style.top = "";
            item.style.width = "";
            if (item.classList.contains("db-panel")) item.style.height = "";
          }
          expandedFootprintGhost?.remove();
          expandedFootprintGhost = null;
          if (canceled) {
            clearPanelDragPreview();
            clearPanelExitPreview();
            restoreGridLayoutSnapshot(startSnapshot);
            placeholder.remove();
            groupLive?.clear();
            onCancel?.();
          } else {
            const releasePanel = panelDrag
              ? panelEntryCandidateAt(upEvent?.clientX ?? lastMoveEvent?.clientX ?? startX, upEvent?.clientY ?? lastMoveEvent?.clientY ?? startY, item, { snapshot: startSnapshot })?.panel
              : null;
            const activePanelDrag = panelDrag && releasePanel === panelDrag.panel ? panelDrag : null;
            if (panelDrag && !activePanelDrag) clearPanelDragPreview();
            const activePanelExitDrag = panelExitDrag;
            const finalCell = activePanelDrag
              ? {
                col: Number(activePanelDrag.placeholder.dataset.gridCol) || Number(activePanelDrag.targetCell?.col) || 1,
                row: Number(activePanelDrag.placeholder.dataset.gridRow) || Number(activePanelDrag.targetCell?.row) || 1,
              }
              : activePanelExitDrag
                ? {
                  col: Number(activePanelExitDrag.placeholder.dataset.gridCol) || Number(activePanelExitDrag.targetCell?.col) || 1,
                  row: Number(activePanelExitDrag.placeholder.dataset.gridRow) || Number(activePanelExitDrag.targetCell?.row) || 1,
                }
              : {
                col: Number(placeholder.dataset.gridCol) || originalCell.col,
                row: Number(placeholder.dataset.gridRow) || originalCell.row,
              };
            let result;
            if (activePanelDrag) {
              clearPanelExitPreview();
              clearPanelDragPreview({ restore: false });
              restoreGridLayoutSnapshot(startSnapshot, { exclude: [item] });
              placeholder.remove();
              const absorbed = absorbWidgetIntoPanel({
                widget: item,
                sourceLayout: layout,
                panel: activePanelDrag.panel,
                clientX: upEvent?.clientX ?? lastMoveEvent?.clientX ?? startX,
                clientY: upEvent?.clientY ?? lastMoveEvent?.clientY ?? startY,
                fromRect: releaseItemRect,
                targetCell: finalCell,
              });
              result = absorbed
                ? { bounds: gridBoundsForItem(absorbed), movedItems: 1, absorbed: true }
                : { bounds: boundsAtGridSlot(item, originalCell.col, originalCell.row), movedItems: 0, absorbed: false };
              if (!absorbed) onCancel?.();
            } else if (activePanelExitDrag) {
              const exitTarget = activePanelExitDrag.placeholder?.isConnected
                ? gridBoundsForItem(activePanelExitDrag.placeholder, activePanelExitDrag.metrics)
                : finalCell;
              clearPanelExitPreview({ restore: false });
              restoreGridLayoutSnapshot(startSnapshot, { exclude: [item] });
              placeholder.remove();
              restoreGridLayoutSnapshot(activePanelExitDrag.snapshot, { exclude: [activePanelExitDrag.placeholder] });
              const extracted = extractPanelChildWidgetToWorkspace({
                widget: item,
                sourceLayout: layout,
                targetLayout: activePanelExitDrag.layout,
                panel: activePanelExitDrag.panel,
                fromRect: releaseItemRect,
                targetCell: exitTarget,
              });
              result = extracted
                ? { bounds: extracted.bounds, movedItems: extracted.movedItems + 1, extracted: true }
                : { bounds: boundsAtGridSlot(item, originalCell.col, originalCell.row), movedItems: 0, extracted: false };
              if (!extracted) onCancel?.();
            } else if (isPanelLocalDrag) {
              clearPanelExitPreview();
              restoreGridLayoutSnapshot(startSnapshot, { exclude: [item] });
              placeholder.remove();
              // Dropping onto an occupied internal cell uses the same
              // collision/displacement commit as the base dashboard instead of
              // bouncing the drag back to its original cell.
              const localVacancy = boundsAtGridSlot(item, originalCell.col, originalCell.row, dragMetrics);
              result = commitActiveDropSlot(layout, item, finalCell, {
                localVacancy,
                metrics: dragMetrics,
              });
              syncPanelFootprintToInternalItem(sourcePanelForPanelLocalDrag, item, { reflow: false });
            } else if (groupDrag) {
              clearPanelExitPreview();
              restoreGridLayoutSnapshot(startSnapshot);
              const localVacancy = groupBoxBounds(groupDrag.groupBox);
              applyGroupFootprintBounds(placeholder, groupDrag.footprintLayout, {
                ...groupBoxBounds(groupDrag.groupBox),
                col: finalCell.col,
                row: finalCell.row,
              });
              resolveSparseGridLayout(layout, placeholder, finalCell, {
                afterOnly: true,
                metrics: dragMetrics,
                localVacancy,
                items: reflowItems,
                rowLimit: committedPageBottomRow,
              });
              const resolvedCell = {
                col: Number(placeholder.dataset.gridCol) || finalCell.col,
                row: Number(placeholder.dataset.gridRow) || finalCell.row,
              };
              const delta = {
                deltaCol: resolvedCell.col - groupDrag.groupBox.col,
                deltaRow: resolvedCell.row - groupDrag.groupBox.row,
              };
              applyGroupDelta(
                groupDrag.items.map((groupItem) => ({
                  item: groupItem,
                  sourceItem: groupItem,
                  startBounds: groupDrag.startBounds.get(groupItem),
                })).filter((entry) => entry.startBounds),
                delta
              );
              placeholder.remove();
              groupLive?.clear();
              result = {
                bounds: boundsAtGridSlot(item, (groupDrag.startBounds.get(item)?.col || originalCell.col) + delta.deltaCol, (groupDrag.startBounds.get(item)?.row || originalCell.row) + delta.deltaRow),
                movedItems: groupDrag.items.length - 1,
              };
            } else {
              clearPanelExitPreview();
              restoreGridLayoutSnapshot(startSnapshot, { exclude: [item] });
              placeholder.remove();
              const expandedPanelDrag = workspaceObjectCapabilities(item).hasExpandedFootprint && !item.classList.contains("db-panel-collapsed");
              const localVacancy = expandedPanelDrag ? null : boundsAtGridSlot(item, originalCell.col, originalCell.row, dragMetrics);
              result = expandedPanelDrag
                ? commitExpandedPanelDropSlot(layout, item, finalCell, { localVacancy, rowLimit: committedPageBottomRow })
                : commitActiveDropSlot(layout, item, finalCell, { localVacancy, rowLimit: committedPageBottomRow });
            }
            const finalBounds = result.bounds;
            if (!isPanelLocalDrag) {
              syncCommittedWorkspaceScrollFloor(layout, {
                preserveViewport: false,
              });
            }
            if (result.absorbed === false) {
              // The attempted panel commit failed and onCancel has already restored callers.
            } else if (result.extracted === false) {
              // The attempted panel exit commit failed and onCancel has already restored callers.
            } else {
              onCommit?.({ moved: result.absorbed || result.extracted || finalBounds.col !== originalCell.col || finalBounds.row !== originalCell.row || result.movedItems > 0 });
            }
        }
      }
      if (groupDrag) {
        groupDrag.items.forEach((groupItem) => groupItem.classList.remove("group-transform-member"));
        document.body.classList.remove("group-transform-active");
      }
      scheduleWorkspaceVisualLodRefresh(gridHostForLayout(layout));
      dragController.endInteraction();
      onEnd?.(dragging);
    };

    const onKeydown = (keyEvent) => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      onUp({ type: "pointercancel" });
    };

    const onWindowBlur = () => {
      onUp({ type: "pointercancel" });
    };

    const onLostPointerCapture = (captureEvent) => {
      if (captureEvent.pointerId !== pointerId) return;
      onUp({ type: "pointercancel" });
    };

    if (!deferStartEventHandling) capturePointer();
    dragController.install({
      onMove,
      onPointerEnd: onUp,
      onKeydown,
      onBlur: onWindowBlur,
      onLostPointerCapture,
    });
  };

  return Object.freeze({ runOrderedDrag });
};
