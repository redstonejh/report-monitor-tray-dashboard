export function initializeLayoutSourceRuntime(deps) {
  const {
    layoutPersistence,
    showToast,
    refreshWidgetDisplayState,
    scheduleWorkspaceVisualLodRefresh,
    savePanelLayouts,
    saveWidgetLayouts,
    savePersistedWorkspaceSnapshot,
    syncWorkspaceVisualLod,
    workspaceVisualLodForItem,
    indexedCollisionEntries,
  } = deps;

  const singleProfile = layoutPersistence?.WORKING_PROFILE || "0";

  document.querySelectorAll(".panel-layout").forEach((layout) => {
    const layoutKey = layout.dataset.layoutKey || "default";
    refreshWidgetDisplayState(layoutKey, singleProfile);
  });
  window.addEventListener("scroll", () => scheduleWorkspaceVisualLodRefresh(), { passive: true });
  window.addEventListener("resize", () => scheduleWorkspaceVisualLodRefresh(), { passive: true });
  document.addEventListener("focusin", () => scheduleWorkspaceVisualLodRefresh(), true);
  document.addEventListener("focusout", () => scheduleWorkspaceVisualLodRefresh(), true);
  window.dashboardPerformanceEngine = {
    refreshVisualLod: () => syncWorkspaceVisualLod(),
    visualLodForElement: (item) => {
      const node = typeof item === "string" ? document.querySelector(item) : item;
      return node ? workspaceVisualLodForItem(node) : null;
    },
    collisionCandidatesForBounds: (bounds, occupied = []) => indexedCollisionEntries(bounds, occupied).length,
  };
  scheduleWorkspaceVisualLodRefresh();

  const saveSingleWorkspaceState = (layoutKey = "builder") => {
    window.dashboardWorkspacePagesRuntime?.persistAllPages?.();
    if (window.dashboardWorkspacePagesRuntime) {
      showToast("Workspace saved.", "info", {
        type: "layout-save-completed",
        source: "layout-save",
        layoutKey,
        payload: { profile: singleProfile, pages: window.dashboardWorkspacePagesRuntime.pageIds?.() || [] },
      });
      return;
    }
    layoutPersistence?.setActiveProfile?.(layoutKey, singleProfile);
    layoutPersistence?.remove?.(layoutPersistence.key.layoutSource(layoutKey));
    const layout = document.querySelector(`.panel-layout[data-layout-key="${CSS.escape(layoutKey)}"]`);
    if (layout) savePanelLayouts(layout, singleProfile, { persist: true });
    const widgetLayout = document.querySelector(`.widget-layout[data-widget-layout-key="${CSS.escape(layoutKey)}"]`);
    if (widgetLayout) saveWidgetLayouts(widgetLayout, singleProfile, { persist: true });
    savePersistedWorkspaceSnapshot(layoutKey, singleProfile);
    showToast("Workspace saved.", "info", {
      type: "layout-save-completed",
      source: "layout-save",
      layoutKey,
      payload: { profile: singleProfile },
    });
  };

  const loadSingleWorkspaceState = (layoutKey = "builder") => {
    window.dashboardWorkspacePagesRuntime?.skipNextBeforeUnloadPersist?.();
    layoutPersistence?.setActiveProfile?.(layoutKey, singleProfile);
    layoutPersistence?.remove?.(layoutPersistence.key.layoutSource(layoutKey));
    showToast("Workspace loaded.", "info", {
      type: "layout-load-completed",
      source: "layout-load",
      layoutKey,
      payload: { profile: singleProfile },
    });
    window.location.reload();
  };

  document.querySelectorAll(".layout-load-button").forEach((button) => {
    button.addEventListener("click", () => loadSingleWorkspaceState(button.dataset.layoutTarget || "default"));
  });

  document.querySelectorAll(".layout-save-button").forEach((button) => {
    button.addEventListener("click", () => saveSingleWorkspaceState(button.dataset.layoutTarget || "default"));
  });

  window.dashboardLayoutSourceRuntime = {
    groups: () => [],
    active: () => ({ kind: "single", id: singleProfile, slot: singleProfile, label: "Workspace" }),
    activate: () => Promise.resolve({ ok: true, source: { kind: "single", id: singleProfile, slot: singleProfile, label: "Workspace" } }),
    render: () => {},
    save: saveSingleWorkspaceState,
    load: loadSingleWorkspaceState,
  };

  return {
    activeLayoutSlot: () => singleProfile,
    saveSingleWorkspaceState,
    loadSingleWorkspaceState,
  };
}
