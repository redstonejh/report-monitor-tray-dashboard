export const bindPanelResizeRuntime = ({
  panel,
  layout,
  layoutKey,
  resizeHandle,
  DASHBOARD_GRID_COLUMNS,
  DASHBOARD_GRID_ROW_HEIGHT,
  groupTransformItems,
  runGroupResize,
  saveSharedGridLayouts,
  closePanelTools,
  closeInactiveDashboardTools,
  createGridMetrics,
  gridItemRowSpan,
  gridHeightForRows,
  gridItemPixelWidthForSpan,
  gridItemMinimumSpan,
  getPanelMinimumHeight,
  createResizePreview,
  reflowItemsForLayout,
  beginLiveResizeSurface,
  beginResizeAutoZoomCamera,
  updateResizeAutoZoomCamera,
  createExpandedFootprintGhost,
  groupPeers,
  groupItemLayout,
  snapshotGridLayout,
  restoreGridLayoutSnapshot,
  applyPanelSpan,
  applyPanelGridPosition,
  applyPanelHeight,
  resolveSparseGridLayout,
  resizeAutoZoomPointerToScenePoint,
  updateLiveResizeSurface,
  panelMinimumRows,
  expandedPanelFootprintHeight,
  updateExpandedFootprintGhost,
  animateOrderedGridReflow,
  endResizeAutoZoomCamera,
  groupedPanelReleaseSpan,
  alignedResizeSpan,
  refreshGridMetricsRect,
  alignedResizeHeight,
  clearLiveResizeSurface,
  emitWorkspaceEvent,
  workspaceObjectType,
  WORKSPACE_OBJECT_TYPES,
  regionIdForWorkspaceItem,
  syncCommittedWorkspaceScrollFloor,
  beginResizeLifecycle,
  resizeEdgeFromPointer,
  clearToolsCloseTimer,
  setToolPointerCapture,
}) => {
  const beginPanelResize = (event, resizeEdge = "right") => {
    // Manual panel resizing disabled for ALL accounts (see widget-resize-runtime.js).
    // Implementation preserved; window.DASHBOARD_MANUAL_RESIZE_ENABLED = true restores it.
    if (window.DASHBOARD_MANUAL_RESIZE_ENABLED !== true) return;
    if (panel.classList.contains("db-panel-pinned") || panel.dataset.locked === "true" || panel.dataset.resizable === "false") return;
    clearToolsCloseTimer();
    if (panel.classList.contains("group-selected") && groupTransformItems(panel).length > 1) {
      setToolPointerCapture(true);
      closePanelTools();
      const handled = runGroupResize({
        layout,
        source: panel,
        event,
        onCommit: () => saveSharedGridLayouts(layout),
        onEnd: () => {
          setToolPointerCapture(false);
          closePanelTools();
        },
      });
      if (handled) return;
      setToolPointerCapture(false);
    }
    event.preventDefault();
    event.stopPropagation();
    setToolPointerCapture(true);
    closePanelTools();
    document.body.classList.add("panel-interaction-active");
    document.body.classList.add("panel-resize-active");
    panel.classList.add("dashboard-active-resize");
    closeInactiveDashboardTools(panel);
    window.getSelection?.()?.removeAllRanges();
    const startX = event.clientX;
    const startY = event.clientY;
    const startRect = panel.getBoundingClientRect();
    const layoutMetrics = createGridMetrics(layout);
    const gap = layoutMetrics.gap;
    const startRows = gridItemRowSpan(panel, layoutMetrics);
    const rowStep = DASHBOARD_GRID_ROW_HEIGHT + gap;
    const startFootprintHeight = gridHeightForRows(gridItemRowSpan(panel, layoutMetrics), gap);
    const layoutWidth = layoutMetrics.width;
    const startSpan = Number(panel.dataset.currentSpan) || Number(panel.dataset.defaultSpan) || 6;
    const startCol = Number(panel.dataset.gridCol) || 1;
    const startRow = Number(panel.dataset.gridRow) || 1;
    const startRightCol = startCol + startSpan - 1;
    const collapsedPanelResize = panel.classList.contains("db-panel-collapsed");
    const minLiveWidth = gridItemPixelWidthForSpan(layout, gridItemMinimumSpan(panel), layoutMetrics);
    const maxLiveWidth = gridItemPixelWidthForSpan(layout, resizeEdge === "left" ? startRightCol : DASHBOARD_GRID_COLUMNS, layoutMetrics);
    const minLiveHeight = collapsedPanelResize ? startRect.height : getPanelMinimumHeight(panel);
    const resizePreview = createResizePreview(layout, panel, "db-panel-placeholder", startRect, layoutMetrics);
    const reflowItems = reflowItemsForLayout(layout, panel);
    const previewStartCell = {
      col: Number(resizePreview.dataset.gridCol) || Number(panel.dataset.gridCol) || 1,
      row: Number(resizePreview.dataset.gridRow) || Number(panel.dataset.gridRow) || 1,
    };
    const liveResizePreview = beginLiveResizeSurface(panel, startRect);
    beginResizeAutoZoomCamera();
    updateResizeAutoZoomCamera({
      top: startRect.top,
      bottom: startRect.bottom,
      height: startRect.height,
    });
    const expandedFootprintGhost = createExpandedFootprintGhost(panel, layout, startRect, null, layoutMetrics);
    const resizePeers = groupPeers(panel, "panel")
      .filter((peer) => !peer.classList.contains("db-panel-pinned") && groupItemLayout(peer) === layout)
      .map((peer) => ({ peer, startSpan: Number(peer.dataset.currentSpan) || Number(peer.dataset.defaultSpan) || 6 }));
    const groupResizeItems = [{ peer: panel, startSpan }, ...resizePeers];
    const resizeStartSnapshot = snapshotGridLayout(layout);
    let previewSpan = startSpan;
    let previewHeight = startFootprintHeight;
    let previewRows = startRows;
    const applyResize = (nextSpan, nextHeight, nextRows) => {
      const requestedDelta = nextSpan - startSpan;
      const minDelta = Math.max(...groupResizeItems.map(({ peer, startSpan: peerStartSpan }) => gridItemMinimumSpan(peer) - peerStartSpan));
      const edgeMaxDelta = resizeEdge === "left" ? startCol - 1 : 6 - startSpan;
      const maxDelta = Math.min(edgeMaxDelta, ...groupResizeItems.map(({ startSpan: peerStartSpan }) => 6 - peerStartSpan));
      const delta = Math.max(minDelta, Math.min(maxDelta, requestedDelta));
      const snappedSpan = startSpan + delta;
      const snappedCol = resizeEdge === "left" ? startRightCol - snappedSpan + 1 : previewStartCell.col;
      restoreGridLayoutSnapshot(resizeStartSnapshot, { exclude: [panel] });
      applyPanelSpan(resizePreview, snappedSpan);
      if (resizeEdge === "left") applyPanelGridPosition(resizePreview, snappedCol, startRow);
      if (collapsedPanelResize) {
        resizePreview.dataset.gridRowSpan = "1";
        resizePreview.style.height = `${Math.max(DASHBOARD_GRID_ROW_HEIGHT, startRect.height)}px`;
        if (resizePreview.dataset.gridCol && resizePreview.dataset.gridRow) {
          applyPanelGridPosition(resizePreview, resizePreview.dataset.gridCol, resizePreview.dataset.gridRow);
        }
      } else {
        applyPanelHeight(resizePreview, nextHeight);
      }
      resizePeers.forEach(({ peer, startSpan: peerStartSpan }) => {
        applyPanelSpan(peer, peerStartSpan + delta);
        applyPanelHeight(peer, Math.max(getPanelMinimumHeight(peer), nextHeight));
      });
      resolveSparseGridLayout(layout, resizePreview, { col: snappedCol, row: previewStartCell.row }, {
        metrics: layoutMetrics,
        items: reflowItems,
        enforceViewportFloor: false,
      });
      previewSpan = snappedSpan;
      previewHeight = nextHeight;
      previewRows = nextRows;
    };

    const onResizeMove = (moveEvent) => {
      moveEvent.preventDefault();
      const scenePoint = resizeAutoZoomPointerToScenePoint(moveEvent.clientX, moveEvent.clientY);
      const deltaX = moveEvent.clientX - startX;
      const liveWidth = Math.max(minLiveWidth, Math.min(maxLiveWidth, startRect.width + (resizeEdge === "left" ? -deltaX : deltaX)));
      const liveLeft = resizeEdge === "left" ? startRect.right - liveWidth : startRect.left;
      const liveHeight = collapsedPanelResize ? startRect.height : Math.max(minLiveHeight, startRect.height + (scenePoint.y - startY));
      const liveTop = startRect.top;
      updateLiveResizeSurface(liveResizePreview, liveWidth, liveHeight, liveLeft, liveTop);
      const rawSpan = startSpan + ((((resizeEdge === "left" ? -deltaX : deltaX)) / layoutWidth) * 6);
      const nextSpan = Math.max(gridItemMinimumSpan(panel), Math.min(6, Math.round(rawSpan)));
      const nextRows = Math.max(panelMinimumRows(panel, layoutMetrics), startRows + Math.round((scenePoint.y - startY) / rowStep));
      const nextHeight = gridHeightForRows(nextRows, gap);
      const cameraHeight = collapsedPanelResize
        ? expandedPanelFootprintHeight(panel, layout, nextRows, layoutMetrics)
        : liveHeight;
      updateResizeAutoZoomCamera({
        top: liveTop,
        bottom: liveTop + cameraHeight,
        height: cameraHeight,
      });
      if (collapsedPanelResize) {
        const liveRect = liveResizePreview.getBoundingClientRect();
        updateExpandedFootprintGhost(expandedFootprintGhost, panel, layout, {
          left: liveRect.left,
          top: liveRect.top,
          width: liveRect.width,
          rows: nextRows,
        }, layoutMetrics);
      }
      if (nextSpan === previewSpan && nextHeight === previewHeight) return;
      animateOrderedGridReflow(layout, () => applyResize(nextSpan, nextHeight, nextRows), panel, { items: reflowItems, metrics: layoutMetrics });
    };

    const finishPanelResize = (upEvent, canceled) => {
      endResizeAutoZoomCamera({ immediate: true });
      if (canceled) {
        restoreGridLayoutSnapshot(resizeStartSnapshot);
      } else {
        animateOrderedGridReflow(layout, () => {
          const currentSpan = previewSpan || Number(panel.dataset.currentSpan) || startSpan;
          const groupedSpan = groupedPanelReleaseSpan(currentSpan, resizePeers.length + 1);
          const releaseSpan = alignedResizeSpan({
              layout,
              item: resizePreview,
              currentSpan,
              gap: 16,
              minSpan: gridItemMinimumSpan(panel),
              metrics: refreshGridMetricsRect(layoutMetrics),
            });
          const snappedSpan = groupedSpan ?? (resizeEdge === "left" ? Math.round(currentSpan) : releaseSpan);
          const snappedHeight = collapsedPanelResize
            ? expandedPanelFootprintHeight(panel, layout, previewRows)
            : alignedResizeHeight({
              layout,
              item: resizePreview,
              currentHeight: previewHeight || Number(panel.dataset.savedHeight) || panel.getBoundingClientRect().height,
              metrics: refreshGridMetricsRect(layoutMetrics),
            });
          const requestedDelta = snappedSpan - startSpan;
          const minDelta = Math.max(...groupResizeItems.map(({ peer, startSpan: peerStartSpan }) => gridItemMinimumSpan(peer) - peerStartSpan));
          const edgeMaxDelta = resizeEdge === "left" ? startCol - 1 : 6 - startSpan;
          const maxDelta = Math.min(edgeMaxDelta, ...groupResizeItems.map(({ startSpan: peerStartSpan }) => 6 - peerStartSpan));
          const delta = Math.max(minDelta, Math.min(maxDelta, requestedDelta));
          const finalSpan = startSpan + delta;
          const finalCol = resizeEdge === "left" ? startRightCol - finalSpan + 1 : startCol;
          clearLiveResizeSurface(panel, liveResizePreview);
          restoreGridLayoutSnapshot(resizeStartSnapshot);
          resizePreview.remove();
          expandedFootprintGhost?.remove();
          applyPanelSpan(panel, finalSpan);
          applyPanelHeight(panel, snappedHeight);
          if (resizeEdge === "left") applyPanelGridPosition(panel, finalCol, startRow);
          resizePeers.forEach(({ peer, startSpan: peerStartSpan }) => {
            applyPanelSpan(peer, peerStartSpan + delta);
            applyPanelHeight(peer, Math.max(getPanelMinimumHeight(peer), snappedHeight));
          });
          resolveSparseGridLayout(layout, panel, { col: finalCol, row: startRow }, {
            metrics: layoutMetrics,
            items: reflowItems,
            enforceViewportFloor: false,
          });
        }, panel, { items: reflowItems, metrics: layoutMetrics });
        saveSharedGridLayouts(layout);
        emitWorkspaceEvent({
          type: workspaceObjectType(panel) === WORKSPACE_OBJECT_TYPES.divider ? "divider-resized" : "object-resized",
          source: "resize",
          layoutKey,
          objectId: panel.dataset.panelKey || "",
          objectType: workspaceObjectType(panel) === WORKSPACE_OBJECT_TYPES.divider ? "divider" : "panel",
          regionId: regionIdForWorkspaceItem(panel),
          label: `${panel.dataset.panelTitle || panel.dataset.defaultTitle || "Panel"} resized`,
          payload: {
            cols: Number(panel.dataset.currentSpan) || 0,
            rows: Number(panel.dataset.gridRowSpan) || 0,
          },
        });
        syncCommittedWorkspaceScrollFloor(layout, {
          preserveViewport: false,
        });
      }
    };

    beginResizeLifecycle({
      event,
      source: panel,
      layout,
      onMove: onResizeMove,
      onEnd: finishPanelResize,
      onCleanup: () => {
        endResizeAutoZoomCamera({ immediate: true });
        setToolPointerCapture(false);
        resizePreview.remove();
        expandedFootprintGhost?.remove();
        clearLiveResizeSurface(panel, liveResizePreview);
        closePanelTools();
      },
    });
  };

  resizeHandle?.addEventListener("pointerdown", (event) => beginPanelResize(event, "right"));
  panel.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target?.closest?.(".panel-tools, .widget-tools, .panel-color-menu")) return;
    if (event.target?.closest?.(".panel-internal-widget-grid > .widget-card")) return;
    const resizeEdge = resizeEdgeFromPointer(event, panel);
    if (!resizeEdge) return;
    beginPanelResize(event, resizeEdge);
  }, { capture: true });

  return { beginPanelResize };
};
