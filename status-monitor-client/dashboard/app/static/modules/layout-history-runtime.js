export const createLayoutHistoryRuntime = ({
  getActivePanelProfile,
  serializeLayoutElement,
  readRawStore,
  writeRawStore,
  writeJsonStore,
  layoutStorageKeys,
  layoutUndoKey,
  undoTransientItemClasses,
  endResizeAutoZoomCamera,
  cleanupWidgetRowBreaks,
  cleanupPanelRowBreaks,
  restoreGroupSelection,
  refreshWidgetDisplayState,
  syncLayoutToolsActive,
}) => {
  const liveLayoutUndo = new Map();
  const liveLayoutRedo = new Map();
  let layoutUndoCaptureLock = false;

  const liveLayoutUndoKey = (layoutKey, profile = getActivePanelProfile(layoutKey)) => `${profile}:${layoutKey}`;

  const captureLiveLayoutState = (layoutKey, profile = getActivePanelProfile(layoutKey)) => ({
    panels: [...document.querySelectorAll(`.panel-layout[data-layout-key="${CSS.escape(layoutKey)}"]`)].map((layout) => ({
      selector: `.panel-layout[data-layout-key="${CSS.escape(layout.dataset.layoutKey || layoutKey)}"]`,
      hiddenDraft: layout.dataset.hiddenPanelsDraft || "[]",
      items: [...layout.querySelectorAll(":scope > .db-panel, :scope > .db-panel-row-break")].map((item) => (
        item.classList.contains("db-panel-row-break")
          ? { rowBreak: true, html: item.outerHTML }
          : serializeLayoutElement(item, "panelKey")
      )),
    })),
    widgets: [...document.querySelectorAll(`.widget-layout[data-widget-layout-key="${CSS.escape(layoutKey)}"]`)].map((layout) => ({
      selector: `.widget-layout[data-widget-layout-key="${CSS.escape(layout.dataset.widgetLayoutKey || layoutKey)}"]`,
      hiddenDraft: layout.dataset.hiddenWidgetsDraft || "[]",
      items: [...layout.querySelectorAll(":scope > .widget-card, :scope > .widget-row-break, :scope > .widget-spacer")].map((item) => (
        item.classList.contains("widget-row-break")
          ? { rowBreak: true, html: item.outerHTML }
          : item.classList.contains("widget-spacer")
            ? { spacer: true, html: item.outerHTML }
          : serializeLayoutElement(item, "widgetKey")
      )),
    })),
    profile,
  });

  const liveLayoutUndoSignature = (snapshot) => JSON.stringify({
    panels: snapshot.panels,
    widgets: snapshot.widgets,
    profile: snapshot.profile,
  });

  const pushLiveLayoutUndo = (layoutKey, profile = getActivePanelProfile(layoutKey)) => {
    const key = liveLayoutUndoKey(layoutKey, profile);
    const stack = liveLayoutUndo.get(key) || [];
    const snapshot = captureLiveLayoutState(layoutKey, profile);
    const signature = liveLayoutUndoSignature(snapshot);
    if (stack[stack.length - 1]?.signature === signature) return false;
    stack.push({ ...snapshot, signature });
    if (stack.length > 12) stack.shift();
    liveLayoutUndo.set(key, stack);
    liveLayoutRedo.delete(key);
    return true;
  };

  const cleanupDashboardUndoArtifacts = () => {
    endResizeAutoZoomCamera({ immediate: true });
    document.querySelectorAll(
      ".dashboard-live-resize, .dashboard-resize-preview, .dashboard-expanded-footprint-ghost, .dashboard-group-boundary, .dashboard-group-member-preview, .widget-placeholder, .db-panel-placeholder"
    ).forEach((node) => {
      if (!node.isConnected) return;
      try {
        node.remove();
      } catch {
        try {
          node.parentNode?.removeChild?.(node);
        } catch {
          // Interaction cleanup is best-effort; stale preview nodes may already be gone.
        }
      }
    });
    document.body.classList.remove(
      "panel-interaction-active",
      "panel-resize-active",
      "group-transform-active",
    );
    document.querySelectorAll(".dashboard-active-resize, .dashboard-resize-source, .group-transform-member").forEach((item) => {
      item.classList.remove("dashboard-active-resize", "dashboard-resize-source", "group-transform-member");
    });
  };

  const restoreLayoutItems = (layout, items, initItem) => {
    layout.replaceChildren();
    items.forEach((item) => {
      const template = document.createElement("template");
      template.innerHTML = item.html;
      const element = template.content.firstElementChild;
      if (!element) return;
      if (!item.rowBreak && !item.spacer) element.hidden = Boolean(item.hidden);
      delete element.dataset.panelInitialized;
      delete element.dataset.widgetInitialized;
      element.classList.remove(...undoTransientItemClasses);
      layout.appendChild(element);
      if (!item.rowBreak && !item.spacer) initItem?.(element);
    });
  };

  const restoreLiveLayoutSnapshot = (snapshot) => {
    cleanupDashboardUndoArtifacts();
    const layoutKeyForSnapshot = snapshot.panels?.[0]?.selector?.match(/data-layout-key="([^"]+)"/)?.[1] ||
      snapshot.widgets?.[0]?.selector?.match(/data-widget-layout-key="([^"]+)"/)?.[1] ||
      "builder";
    snapshot.widgets?.forEach((widgetSnapshot) => {
      const layout = document.querySelector(widgetSnapshot.selector);
      if (!layout) return;
      layout.dataset.hiddenWidgetsDraft = widgetSnapshot.hiddenDraft;
      restoreLayoutItems(layout, widgetSnapshot.items, layout.__initWidget);
      cleanupWidgetRowBreaks(layout);
    });
    snapshot.panels?.forEach((panelSnapshot) => {
      const layout = document.querySelector(panelSnapshot.selector);
      if (!layout) return;
      layout.dataset.hiddenPanelsDraft = panelSnapshot.hiddenDraft;
      restoreLayoutItems(layout, panelSnapshot.items, layout.__initPanel);
      cleanupPanelRowBreaks(layout);
    });
    restoreGroupSelection();
    refreshWidgetDisplayState(layoutKeyForSnapshot, snapshot.profile);
    syncLayoutToolsActive();
    cleanupDashboardUndoArtifacts();
  };

  const captureLayoutUndo = (layoutKey, profile = getActivePanelProfile(layoutKey)) => {
    if (layoutUndoCaptureLock) return;
    layoutUndoCaptureLock = true;
    window.setTimeout(() => {
      layoutUndoCaptureLock = false;
    }, 250);
    try {
      const snapshot = {};
      layoutStorageKeys(layoutKey, profile).forEach((key) => {
        snapshot[key] = readRawStore(key, null);
      });
      writeJsonStore(layoutUndoKey(layoutKey, profile), { layoutKey, profile, snapshot });
    } catch {}
  };

  const restoreLayoutUndo = (layoutKey, profile = getActivePanelProfile(layoutKey)) => {
    const liveKey = liveLayoutUndoKey(layoutKey, profile);
    const stack = liveLayoutUndo.get(liveKey) || [];
    if (stack.length > 1) {
      const current = stack.pop();
      const redoStack = liveLayoutRedo.get(liveKey) || [];
      redoStack.push(current);
      liveLayoutRedo.set(liveKey, redoStack);
      restoreLiveLayoutSnapshot(stack[stack.length - 1]);
      liveLayoutUndo.set(liveKey, stack);
      return true;
    }
    return false;
  };

  const restoreLayoutRedo = (layoutKey, profile = getActivePanelProfile(layoutKey)) => {
    const liveKey = liveLayoutUndoKey(layoutKey, profile);
    const redoStack = liveLayoutRedo.get(liveKey) || [];
    const redo = redoStack.pop();
    if (!redo) return false;
    const stack = liveLayoutUndo.get(liveKey) || [];
    stack.push(redo);
    if (stack.length > 12) stack.shift();
    liveLayoutUndo.set(liveKey, stack);
    liveLayoutRedo.set(liveKey, redoStack);
    restoreLiveLayoutSnapshot(redo);
    return true;
  };

  return {
    pushLiveLayoutUndo,
    captureLayoutUndo,
    restoreLayoutUndo,
    restoreLayoutRedo,
  };
};
