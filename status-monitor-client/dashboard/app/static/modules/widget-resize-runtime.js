export const bindWidgetResizeRuntime = ({
  widget,
  layout,
  layoutKey,
  resizeHandle,
  DASHBOARD_GRID_COLUMNS,
  groupTransformItems,
  runGroupResize,
  saveSharedGridLayouts,
  closeTools,
  closeInactiveDashboardTools,
  createGridMetrics,
  isPanelInternalWidgetLayout,
  panelForInternalWidgetLayout,
  gridItemRowSpan,
  gridItemPixelWidthForSpan,
  gridItemMinimumSpan,
  gridItemMinimumRows,
  gridHeightForRows,
  createResizePreview,
  reflowItemsForLayout,
  beginLiveResizeSurface,
  beginResizeAutoZoomCamera,
  updateResizeAutoZoomCamera,
  groupPeers,
  groupItemLayout,
  snapshotGridLayout,
  restoreGridLayoutSnapshot,
  applyWidgetSpan,
  applyWidgetGridPosition,
  resolveSparseGridLayout,
  syncOpenPanelHeightToInternalGrid,
  resizeAutoZoomPointerToScenePoint,
  updateLiveResizeSurface,
  animateOrderedGridReflow,
  endResizeAutoZoomCamera,
  groupedWidgetReleaseSpan,
  alignedResizeSpan,
  refreshGridMetricsRect,
  clearLiveResizeSurface,
  emitWorkspaceEvent,
  regionIdForWorkspaceItem,
  syncCommittedWorkspaceScrollFloor,
  beginResizeLifecycle,
  resizeEdgeFromPointer,
  clearCloseTimer,
  setSuppressWidgetClickUntil,
}) => {
  const beginWidgetResize = (event, resizeEdge = "right") => {
    if (widget.classList.contains("db-panel-pinned") || widget.dataset.locked === "true" || widget.dataset.resizable === "false") return;
    clearCloseTimer();
    if (widget.classList.contains("group-selected") && groupTransformItems(widget).length > 1) {
      closeTools();
      const handled = runGroupResize({
        layout,
        source: widget,
        event,
        onCommit: () => saveSharedGridLayouts(layout),
        onEnd: () => {
          closeTools();
        },
      });
      if (handled) return;
    }
    event.preventDefault();
    event.stopPropagation();
    closeTools();
    setSuppressWidgetClickUntil(Number.POSITIVE_INFINITY);
    document.body.classList.add("panel-interaction-active");
    document.body.classList.add("panel-resize-active");
    widget.classList.add("dashboard-active-resize");
    closeInactiveDashboardTools(widget);
    window.getSelection?.()?.removeAllRanges();
    const layoutMetrics = createGridMetrics(layout);
    const resizeParentPanel = isPanelInternalWidgetLayout(layout) ? panelForInternalWidgetLayout(layout) : null;
    const resizeParentPanelLayout = resizeParentPanel?.closest?.(".panel-layout") || null;
    const layoutWidth = layoutMetrics.width;
    const startSpan = Number(widget.dataset.currentSpan) || 1;
    const startRows = gridItemRowSpan(widget, layoutMetrics);
    const startRect = widget.getBoundingClientRect();
    const startCol = Number(widget.dataset.gridCol) || 1;
    const startRow = Number(widget.dataset.gridRow) || 1;
    const startRightCol = startCol + startSpan - 1;
    const minLiveWidth = gridItemPixelWidthForSpan(layout, gridItemMinimumSpan(widget), layoutMetrics);
    const maxLiveWidth = gridItemPixelWidthForSpan(layout, resizeEdge === "left" ? startRightCol : DASHBOARD_GRID_COLUMNS, layoutMetrics);
    const minRows = gridItemMinimumRows(widget);
    const minLiveHeight = gridHeightForRows(minRows, layoutMetrics.gap, layoutMetrics.rowHeight);
    const resizePreview = createResizePreview(layout, widget, "widget-placeholder", startRect, layoutMetrics);
    const reflowItems = reflowItemsForLayout(layout, widget);
    const previewStartCell = {
      col: Number(resizePreview.dataset.gridCol) || Number(widget.dataset.gridCol) || 1,
      row: Number(resizePreview.dataset.gridRow) || Number(widget.dataset.gridRow) || 1,
    };
    const liveResizePreview = beginLiveResizeSurface(widget, startRect);
    beginResizeAutoZoomCamera();
    updateResizeAutoZoomCamera({
      top: startRect.top,
      bottom: startRect.bottom,
      height: startRect.height,
    });
    const resizePeers = groupPeers(widget, "widget")
      .filter((peer) => !peer.classList.contains("db-panel-pinned") && groupItemLayout(peer) === layout)
      .map((peer) => ({
        peer,
        startSpan: Number(peer.dataset.currentSpan) || Number(peer.dataset.defaultSpan) || 1,
        startRows: gridItemRowSpan(peer, layoutMetrics),
      }));
    const groupResizeItems = [{ peer: widget, startSpan, startRows }, ...resizePeers];
    const startX = event.clientX;
    const startY = event.clientY;
    const resizeStartSnapshot = snapshotGridLayout(layout);
    const resizeParentPanelLayoutSnapshot = resizeParentPanelLayout ? snapshotGridLayout(resizeParentPanelLayout) : null;
    let previewSpan = startSpan;
    let previewRows = startRows;
    const applyResize = (nextSpan, nextRows) => {
      const requestedDelta = nextSpan - startSpan;
      const minDelta = Math.max(...groupResizeItems.map(({ peer, startSpan: peerStartSpan }) => gridItemMinimumSpan(peer) - peerStartSpan));
      const edgeMaxDelta = resizeEdge === "left" ? startCol - 1 : 6 - startSpan;
      const maxDelta = Math.min(edgeMaxDelta, ...groupResizeItems.map(({ startSpan: peerStartSpan }) => 6 - peerStartSpan));
      const delta = Math.max(minDelta, Math.min(maxDelta, requestedDelta));
      const snappedSpan = startSpan + delta;
      const snappedCol = resizeEdge === "left" ? startRightCol - snappedSpan + 1 : previewStartCell.col;
      const requestedRowDelta = nextRows - startRows;
      const minRowDelta = Math.max(...groupResizeItems.map(({ peer, startRows: peerStartRows }) => gridItemMinimumRows(peer) - peerStartRows));
      const rowDelta = Math.max(minRowDelta, requestedRowDelta);
      const snappedRows = startRows + rowDelta;
      restoreGridLayoutSnapshot(resizeStartSnapshot, { exclude: [widget] });
      applyWidgetSpan(resizePreview, snappedSpan);
      applyWidgetGridPosition(resizePreview, snappedCol, startRow, snappedRows);
      resizePeers.forEach(({ peer, startSpan: peerStartSpan, startRows: peerStartRows }) => {
        applyWidgetSpan(peer, peerStartSpan + delta);
        applyWidgetGridPosition(peer, peer.dataset.gridCol, peer.dataset.gridRow, peerStartRows + rowDelta);
      });
      resolveSparseGridLayout(layout, resizePreview, { col: snappedCol, row: previewStartCell.row }, {
        metrics: layoutMetrics,
        items: reflowItems,
        enforceViewportFloor: false,
      });
      if (resizeParentPanel) syncOpenPanelHeightToInternalGrid(resizeParentPanel, { includePlaceholders: true });
      previewSpan = snappedSpan;
      previewRows = snappedRows;
    };
    const onMove = (moveEvent) => {
      moveEvent.preventDefault();
      const scenePoint = resizeAutoZoomPointerToScenePoint(moveEvent.clientX, moveEvent.clientY);
      const deltaX = moveEvent.clientX - startX;
      const deltaY = scenePoint.y - startY;
      const liveWidth = Math.max(minLiveWidth, Math.min(maxLiveWidth, startRect.width + (resizeEdge === "left" ? -deltaX : deltaX)));
      const liveHeight = Math.max(minLiveHeight, startRect.height + deltaY);
      const liveLeft = resizeEdge === "left" ? startRect.right - liveWidth : startRect.left;
      const liveTop = startRect.top;
      updateLiveResizeSurface(liveResizePreview, liveWidth, liveHeight, liveLeft, liveTop);
      updateResizeAutoZoomCamera({
        top: liveTop,
        bottom: liveTop + liveHeight,
        height: liveHeight,
      });
      const rawSpan = startSpan + ((((resizeEdge === "left" ? -deltaX : deltaX)) / layoutWidth) * 6);
      const nextSpan = Math.max(gridItemMinimumSpan(widget), Math.min(6, Math.round(rawSpan)));
      const rawRows = startRows + (deltaY / layoutMetrics.rowStep);
      const nextRows = Math.max(minRows, Math.round(rawRows));
      if (nextSpan === previewSpan && nextRows === previewRows) return;
      animateOrderedGridReflow(layout, () => applyResize(nextSpan, nextRows), widget, { items: reflowItems, metrics: layoutMetrics });
    };
    const finishWidgetResize = (upEvent, canceled) => {
      endResizeAutoZoomCamera({ immediate: true });
      if (canceled) {
        restoreGridLayoutSnapshot(resizeStartSnapshot);
        if (resizeParentPanelLayoutSnapshot) restoreGridLayoutSnapshot(resizeParentPanelLayoutSnapshot);
      } else {
        animateOrderedGridReflow(layout, () => {
          const currentSpan = previewSpan || Number(widget.dataset.currentSpan) || startSpan;
          const groupedSpan = groupedWidgetReleaseSpan(currentSpan, resizePeers.length + 1);
          const releaseSpan = alignedResizeSpan({
              layout,
              item: resizePreview,
              currentSpan,
              gap: 12,
              minSpan: gridItemMinimumSpan(widget),
              metrics: refreshGridMetricsRect(layoutMetrics),
            });
          const snappedSpan = groupedSpan ?? (resizeEdge === "left" ? Math.round(currentSpan) : releaseSpan);
          const requestedDelta = snappedSpan - startSpan;
          const minDelta = Math.max(...groupResizeItems.map(({ peer, startSpan: peerStartSpan }) => gridItemMinimumSpan(peer) - peerStartSpan));
          const edgeMaxDelta = resizeEdge === "left" ? startCol - 1 : 6 - startSpan;
          const maxDelta = Math.min(edgeMaxDelta, ...groupResizeItems.map(({ startSpan: peerStartSpan }) => 6 - peerStartSpan));
          const delta = Math.max(minDelta, Math.min(maxDelta, requestedDelta));
          const finalSpan = startSpan + delta;
          const finalCol = resizeEdge === "left" ? startRightCol - finalSpan + 1 : startCol;
          const currentRows = Math.max(minRows, Math.round(previewRows || gridItemRowSpan(resizePreview, layoutMetrics) || startRows));
          const requestedRowDelta = currentRows - startRows;
          const minRowDelta = Math.max(...groupResizeItems.map(({ peer, startRows: peerStartRows }) => gridItemMinimumRows(peer) - peerStartRows));
          const rowDelta = Math.max(minRowDelta, requestedRowDelta);
          const finalRows = startRows + rowDelta;
          clearLiveResizeSurface(widget, liveResizePreview);
          restoreGridLayoutSnapshot(resizeStartSnapshot);
          resizePreview.remove();
          applyWidgetSpan(widget, finalSpan);
          applyWidgetGridPosition(widget, finalCol, startRow, finalRows);
          resizePeers.forEach(({ peer, startSpan: peerStartSpan, startRows: peerStartRows }) => {
            applyWidgetSpan(peer, peerStartSpan + delta);
            applyWidgetGridPosition(peer, peer.dataset.gridCol, peer.dataset.gridRow, peerStartRows + rowDelta);
          });
          resolveSparseGridLayout(layout, widget, { col: finalCol, row: startRow }, {
            metrics: layoutMetrics,
            items: reflowItems,
            enforceViewportFloor: false,
          });
          if (resizeParentPanel) syncOpenPanelHeightToInternalGrid(resizeParentPanel);
        }, widget, { items: reflowItems, metrics: layoutMetrics });
        saveSharedGridLayouts(layout);
        emitWorkspaceEvent({
          type: "object-resized",
          source: "resize",
          layoutKey,
          objectId: widget.dataset.widgetKey || "",
          objectType: "widget",
          regionId: regionIdForWorkspaceItem(widget),
          panelId: widget.dataset.parentPanelKey || "",
          label: `${widget.dataset.widgetDisplayName || "Widget"} resized`,
          payload: {
            cols: Number(widget.dataset.currentSpan) || 0,
            rows: Number(widget.dataset.gridRowSpan) || 0,
          },
        });
        syncCommittedWorkspaceScrollFloor(layout, {
          preserveViewport: false,
        });
      }
    };
    beginResizeLifecycle({
      event,
      source: widget,
      layout,
      onMove,
      onEnd: finishWidgetResize,
      onCleanup: () => {
        endResizeAutoZoomCamera({ immediate: true });
        resizePreview.remove();
        clearLiveResizeSurface(widget, liveResizePreview);
        setSuppressWidgetClickUntil(performance.now() + 360);
        closeTools();
      },
    });
  };

  resizeHandle?.addEventListener("pointerdown", (event) => beginWidgetResize(event, "right"));
  widget.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target?.closest?.(".widget-tools, .panel-tools, .panel-color-menu")) return;
    const resizeEdge = resizeEdgeFromPointer(event, widget);
    if (!resizeEdge) return;
    beginWidgetResize(event, resizeEdge);
  }, { capture: true });

  return { beginWidgetResize };
};
