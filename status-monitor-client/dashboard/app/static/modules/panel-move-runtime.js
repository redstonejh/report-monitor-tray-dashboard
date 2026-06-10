export const bindPanelMoveRuntime = ({
  panel,
  layout,
  layoutKey,
  moveHandle,
  isWorkspaceSurfaceDragStart,
  runOrderedDrag,
  cleanupPanelRowBreaks,
  saveSharedGridLayouts,
  emitWorkspaceEvent,
  workspaceObjectType,
  WORKSPACE_OBJECT_TYPES,
  regionIdForWorkspaceItem,
  isInteractivePanelSurfaceTarget,
  closePanelTools,
  clearToolsCloseTimer,
  setToolPointerCapture,
  setMovedDuringPointer,
}) => {
  const beginPanelMove = (event, options = {}) => {
    if (event.button !== 0) return;
    if (panel.classList.contains("db-panel-pinned")) return;
    const surfaceShortcut = Boolean(options.surfaceShortcut);
    if (surfaceShortcut && !isWorkspaceSurfaceDragStart(event, panel)) return;
    clearToolsCloseTimer();
    setToolPointerCapture(true);
    if (!surfaceShortcut) closePanelTools();
    runOrderedDrag({
      layout,
      item: panel,
      event,
      draggingClass: "db-panel-dragging",
      placeholderClass: "db-panel-placeholder",
      threshold: 6,
      deferStartEventHandling: surfaceShortcut,
      onCommit: () => {
        cleanupPanelRowBreaks(layout);
        saveSharedGridLayouts(layout);
        emitWorkspaceEvent({
          type: workspaceObjectType(panel) === WORKSPACE_OBJECT_TYPES.divider ? "divider-moved" : "object-moved",
          source: "drag",
          layoutKey,
          objectId: panel.dataset.panelKey || "",
          objectType: workspaceObjectType(panel) === WORKSPACE_OBJECT_TYPES.divider ? "divider" : "panel",
          regionId: regionIdForWorkspaceItem(panel),
          label: `${panel.dataset.panelTitle || panel.dataset.defaultTitle || "Panel"} moved`,
          payload: {
            col: Number(panel.dataset.gridCol) || 0,
            row: Number(panel.dataset.gridRow) || 0,
          },
        });
      },
      onEnd: (didDrag) => {
        setToolPointerCapture(false);
        closePanelTools();
        setMovedDuringPointer(didDrag);
        requestAnimationFrame(() => {
          setMovedDuringPointer(false);
        });
      },
    });
  };

  moveHandle?.addEventListener("pointerdown", beginPanelMove);
  panel.addEventListener("pointerdown", (event) => {
    if (!isInteractivePanelSurfaceTarget(event)) event.preventDefault();
    beginPanelMove(event, { surfaceShortcut: true });
  });

  return { beginPanelMove };
};
