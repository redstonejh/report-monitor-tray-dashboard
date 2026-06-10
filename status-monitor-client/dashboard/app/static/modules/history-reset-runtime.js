export const initializeHistoryResetRuntime = ({
  restoreLayoutUndo,
  restoreLayoutRedo,
  showToast,
  emitWorkspaceEvent,
  getActivePanelProfile,
  copySelectedWorkspaceObjects,
  pasteWorkspaceClipboardObjects,
  panelDeleteDialog,
  selectedGroupItems,
  requestWorkspaceObjectDelete,
  captureLayoutUndo,
  removeStore,
  persistedWorkspaceKey,
  writeDraftList,
  applyWidgetSpan,
  applyPanelColor,
  applyPanelTitleColor,
  applyPanelSpan,
  updatePanelChildEmptyState,
  syncDefaultDashboardGrid,
  normalizeGridLayout,
  pushLiveLayoutUndo,
}) => {
  const undoDashboardLayoutChange = (layoutKey, profile, options = {}) => {
    if (!restoreLayoutUndo(layoutKey, profile)) {
      if (options.toast !== false) showToast("No layout change to undo.", "warn");
      return false;
    }
    if (options.toast !== false) {
      showToast("Layout change undone.", "info", {
        type: "history-undo",
        source: "history",
        layoutKey,
        payload: { profile },
      });
    } else {
      emitWorkspaceEvent({ type: "history-undo", source: "history", layoutKey, label: "Layout change undone", payload: { profile } });
    }
    return true;
  };

  const redoDashboardLayoutChange = (layoutKey, profile, options = {}) => {
    if (!restoreLayoutRedo(layoutKey, profile)) {
      if (options.toast !== false) showToast("No layout change to redo.", "warn");
      return false;
    }
    if (options.toast !== false) {
      showToast("Layout change redone.", "info", {
        type: "history-redo",
        source: "history",
        layoutKey,
        payload: { profile },
      });
    } else {
      emitWorkspaceEvent({ type: "history-redo", source: "history", layoutKey, label: "Layout change redone", payload: { profile } });
    }
    return true;
  };

  const isEditableUndoTarget = (target) => {
    if (!target) return false;
    if (target.isContentEditable) return true;
    return Boolean(target.closest?.("input, textarea, select, [contenteditable='true'], [role='textbox']"));
  };

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (key !== "c" && key !== "v") return;
    if (isEditableUndoTarget(event.target)) return;
    const layoutKey = document.querySelector(".panel-layout")?.dataset.layoutKey || "builder";
    const handled = key === "c"
      ? copySelectedWorkspaceObjects()
      : pasteWorkspaceClipboardObjects(layoutKey);
    if (!handled) return;
    event.preventDefault();
    event.stopPropagation();
  }, true);

  document.querySelectorAll(".panel-undo-button").forEach((button) => {
    button.addEventListener("click", () => {
      const layoutKey = button.dataset.layoutTarget || "default";
      const profile = getActivePanelProfile(layoutKey);
      undoDashboardLayoutChange(layoutKey, profile);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    const redoShortcut = key === "y" || (key === "z" && event.shiftKey);
    const undoShortcut = key === "z" && !event.shiftKey;
    if (!undoShortcut && !redoShortcut) return;
    if (isEditableUndoTarget(event.target)) return;
    const layoutKey = document.querySelector(".panel-layout")?.dataset.layoutKey || "default";
    const profile = getActivePanelProfile(layoutKey);
    const handled = redoShortcut
      ? redoDashboardLayoutChange(layoutKey, profile)
      : undoDashboardLayoutChange(layoutKey, profile);
    if (!handled) return;
    event.preventDefault();
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.key !== "Delete") return;
    if (isEditableUndoTarget(event.target)) return;
    if (panelDeleteDialog?.open) return;
    const focusedObject = event.target?.closest?.(".widget-layout > .widget-card, .panel-layout > .db-panel");
    const selectedTargets = selectedGroupItems(null);
    const targets = focusedObject && !focusedObject.classList.contains("group-selected")
      ? [focusedObject]
      : selectedTargets.length ? selectedTargets : [focusedObject].filter(Boolean);
    if (!targets.length) return;
    if (!requestWorkspaceObjectDelete({ targets })) return;
    event.preventDefault();
    event.stopPropagation();
  }, true);

  document.querySelectorAll(".panel-reset-button").forEach((button) => {
    button.addEventListener("click", () => {
      const layoutKey = button.dataset.layoutTarget || document.querySelector(".panel-layout")?.dataset.layoutKey || "default";
      const profile = getActivePanelProfile(layoutKey);
      const layouts = [...document.querySelectorAll(`.panel-layout[data-layout-key="${CSS.escape(layoutKey)}"]`)];
      const widgetLayouts = [...document.querySelectorAll(`.widget-layout[data-widget-layout-key="${CSS.escape(layoutKey)}"]`)];
      captureLayoutUndo(layoutKey, profile);
      removeStore(persistedWorkspaceKey(layoutKey, profile));
      widgetLayouts.forEach((layout) => {
        writeDraftList(layout, "hiddenWidgetsDraft", []);
        layout.querySelectorAll(":scope > .widget-row-break").forEach((rowBreak) => rowBreak.remove());
        layout.querySelectorAll(":scope > .widget-spacer").forEach((spacer) => spacer.remove());
        layout.querySelectorAll(':scope > .widget-card[data-custom-widget="true"]').forEach((widget) => widget.remove());
        [...layout.querySelectorAll(":scope > .widget-card")]
          .sort((a, b) => Number(a.dataset.defaultOrder || 0) - Number(b.dataset.defaultOrder || 0))
          .forEach((widget) => {
            widget.hidden = false;
            widget.classList.remove("db-panel-pinned", "widget-tools-open", "db-panel-custom-color", "db-panel-custom-title");
            widget.style.gridColumn = "";
            delete widget.dataset.currentSpan;
            delete widget.dataset.panelColor;
            delete widget.dataset.panelTitleColor;
            delete widget.dataset.panelTitle;
            delete widget.dataset.timeframePreset;
            delete widget.dataset.timeframeLabel;
            widget.style.removeProperty("--panel-accent");
            widget.style.removeProperty("--panel-accent-rgb");
            widget.style.removeProperty("--panel-accent-text");
            applyWidgetSpan(widget, widget.dataset.defaultSpan || 3);
            const label = widget.querySelector(".stat-lbl");
            if (label && widget.dataset.defaultTitle) label.textContent = widget.dataset.defaultTitle;
            const defaultTheme = widget.querySelector(".panel-color-toggle")?.dataset.defaultTheme;
            applyPanelColor(widget, defaultTheme);
            applyPanelTitleColor(widget, "");
            layout.appendChild(widget);
          });
      });
      layouts.forEach((layout) => {
        writeDraftList(layout, "hiddenPanelsDraft", []);
        layout.querySelectorAll(":scope > .db-panel-row-break").forEach((rowBreak) => rowBreak.remove());
        layout.querySelectorAll(':scope > .db-panel[data-custom-panel="true"]').forEach((panel) => panel.remove());
        [...layout.querySelectorAll(":scope > .db-panel")]
          .sort((a, b) => Number(a.dataset.defaultOrder || 0) - Number(b.dataset.defaultOrder || 0))
          .forEach((panel) => {
            panel.hidden = false;
            panel.classList.remove("db-panel-unlocked", "db-panel-dragging");
            panel.classList.remove("db-panel-pinned");
            panel.classList.remove("db-panel-tools-open", "db-panel-custom-color", "db-panel-custom-title");
            panel.style.gridColumn = "";
            panel.style.height = "";
            delete panel.dataset.savedHeight;
            delete panel.dataset.panelColor;
            delete panel.dataset.panelTitleColor;
            delete panel.dataset.panelTitle;
            panel.querySelector(":scope > .db-panel-body > .panel-internal-widget-grid")?.remove();
            updatePanelChildEmptyState(panel);
            panel.style.left = "";
            panel.style.top = "";
            panel.style.width = "";
            panel.style.removeProperty("--panel-accent");
            panel.style.removeProperty("--panel-accent-rgb");
            panel.style.removeProperty("--panel-accent-text");
            applyPanelSpan(panel, panel.dataset.defaultSpan || 6);
            const defaultTheme = panel.querySelector(".panel-color-toggle")?.dataset.defaultTheme;
            applyPanelColor(panel, defaultTheme);
            applyPanelTitleColor(panel, "#ffffff");
            const titleEl = panel.querySelector(".db-panel-title");
            if (titleEl && panel.dataset.defaultTitle) titleEl.textContent = panel.dataset.defaultTitle;
            layout.appendChild(panel);
            const settingsButton = panel.querySelector(".panel-settings-toggle");
            settingsButton?.setAttribute("aria-expanded", "false");
            const pinButton = panel.querySelector(".panel-pin-toggle");
            pinButton?.setAttribute("aria-pressed", "false");
          });
      });
      syncDefaultDashboardGrid(layoutKey, { force: true });
      widgetLayouts.filter((layout) => !layout.closest(".dashboard-layout-grid")).forEach((layout) => normalizeGridLayout(layout));
      layouts.filter((layout) => !layout.closest(".dashboard-layout-grid")).forEach((layout) => normalizeGridLayout(layout));
      showToast("Layout reset to default.");
      pushLiveLayoutUndo(layoutKey, profile);
    });
  });

  return {
    undoDashboardLayoutChange,
    redoDashboardLayoutChange,
  };
};
