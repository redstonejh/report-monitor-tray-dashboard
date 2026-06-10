(() => {
  const state = {
    activeDragState: null,
    activeResizeState: null,
    activeHoverSuppression: null,
    activeMenuState: null,
    activePointerState: null,
    currentInteractionMode: "idle",
    activeWorkspaceDrag: null,
    activeResizeLifecycle: null,
  };
  const activeModes = new Set();

  const setCurrentMode = () => {
    state.currentInteractionMode = activeModes.size ? [...activeModes][activeModes.size - 1] : "idle";
  };

  const beginInteraction = (mode, details = {}) => {
    const safeMode = String(mode || "interaction");
    activeModes.add(safeMode);
    setCurrentMode();
    if (details.pointerId != null || details.pointerType || details.target) {
      state.activePointerState = {
        pointerId: details.pointerId ?? null,
        pointerType: details.pointerType || "",
        target: details.target || null,
        clientX: details.clientX ?? null,
        clientY: details.clientY ?? null,
      };
    }
    return {
      mode: safeMode,
      end() {
        activeModes.delete(safeMode);
        if (!activeModes.size) state.activePointerState = null;
        setCurrentMode();
      },
    };
  };

  const isInteractionActive = (body = document.body) => (
    activeModes.size > 0 ||
    body?.classList?.contains("panel-interaction-active") ||
    body?.classList?.contains("panel-resize-active") ||
    body?.classList?.contains("workspace-drag-active")
  );

  const createSurfaceResponseState = (viewport = window) => ({
    target: null,
    rect: null,
    frame: 0,
    clientX: 0,
    clientY: 0,
    scrollX: viewport.scrollX || 0,
    scrollY: viewport.scrollY || 0,
  });

  const setHoverSuppression = (reason, target = null) => {
    state.activeHoverSuppression = reason ? { reason, target } : null;
  };

  const clearHoverSuppression = (reason = "") => {
    if (!reason || state.activeHoverSuppression?.reason === reason) {
      state.activeHoverSuppression = null;
    }
  };

  const slot = (name) => ({
    get: () => state[name],
    set: (value) => {
      state[name] = value || null;
      return state[name];
    },
    clear: (value = undefined) => {
      if (value === undefined || state[name] === value) state[name] = null;
      return state[name];
    },
  });

  window.dashboardInteractionState = Object.freeze({
    state,
    beginInteraction,
    clearHoverSuppression,
    createSurfaceResponseState,
    isInteractionActive,
    setHoverSuppression,
    slot,
  });
})();
