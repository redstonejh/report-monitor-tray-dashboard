import { beginInlineTextEdit } from "./inline-text-editing.js";

export const bindPanelActionControls = ({
  panel,
  layout,
  layoutKey,
  header,
  panelTools,
  pinButton,
  titleButton,
  deleteButton,
  capabilities,
  groupPeers,
  groupItemLayout,
  savePanelLayouts,
  requestPanelDelete,
  closePanelTools,
  setSuppressToolOpenUntil,
  setSuppressHeaderToggleUntil,
  getSuppressHeaderToggleUntil,
  getMovedDuringPointer,
  setMovedDuringPointer,
  ensureRenderedGridPosition,
  beginPanelExpansionSession,
  applyPanelHeight,
  panelMinimumRows,
  applyPanelGridPosition,
  animatePanelReflow,
  relaxCollapsedExpansionDisplacement,
  endPanelExpansionSession,
  applyVerticalPanelExpansion,
  emitWorkspaceEvent,
  workspaceObjectType,
  WORKSPACE_OBJECT_TYPES,
  regionIdForWorkspaceItem,
  isInteractivePanelSurfaceTarget,
  canOpenDashboardTools,
  closeInactiveDashboardTools,
  openPanelTools,
}) => {
  const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  const currentScrollY = () => window.scrollY || document.documentElement.scrollTop || 0;
  const maxScrollY = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const scrollViewportTo = (top) => {
    window.scrollTo({
      top: Math.max(0, Math.min(maxScrollY(), Math.round(top))),
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  };
  const preserveScrollBackRunway = (state) => {
    if (!state || state.cleanupRunway) return;
    const originalPadding = document.body.style.paddingBottom || "";
    const currentPadding = Number.parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
    const panelHeight = Math.ceil(panel.getBoundingClientRect().height || 0);
    const runway = Math.max(0, (state.targetScrollY - state.beforeScrollY) + panelHeight + 32);
    if (!runway) return;
    document.body.style.paddingBottom = `${currentPadding + runway}px`;
    state.cleanupRunway = () => {
      if (originalPadding) {
        document.body.style.paddingBottom = originalPadding;
      } else {
        document.body.style.removeProperty("padding-bottom");
      }
      state.cleanupRunway = null;
    };
  };
  const revealOpenPanelInViewport = (wasScrollY) => {
    window.requestAnimationFrame(() => {
      const rect = panel.getBoundingClientRect();
      const viewportBottom = window.innerHeight || document.documentElement.clientHeight || 0;
      if (!viewportBottom || rect.bottom <= viewportBottom) {
        delete panel.__panelRevealScrollState;
        return;
      }
      const targetScrollY = Math.min(maxScrollY(), currentScrollY() + (rect.bottom - viewportBottom) + 16);
      const state = { beforeScrollY: wasScrollY, targetScrollY, userScrolled: false, cleanupManualListeners: null, cleanupRunway: null };
      const markManualScroll = () => {
        state.userScrolled = true;
      };
      const markManualKeyScroll = (event) => {
        if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) markManualScroll();
      };
      state.cleanupManualListeners = () => {
        window.removeEventListener("wheel", markManualScroll, true);
        window.removeEventListener("touchmove", markManualScroll, true);
        window.removeEventListener("keydown", markManualKeyScroll, true);
      };
      window.addEventListener("wheel", markManualScroll, { capture: true, passive: true });
      window.addEventListener("touchmove", markManualScroll, { capture: true, passive: true });
      window.addEventListener("keydown", markManualKeyScroll, true);
      panel.__panelRevealScrollState = state;
      scrollViewportTo(targetScrollY);
    });
  };
  const canRestorePanelRevealScroll = () => {
    const state = panel.__panelRevealScrollState;
    return Boolean(state && !state.userScrolled && Math.abs(currentScrollY() - state.targetScrollY) <= 192);
  };
  const restorePanelRevealScroll = (allowRestore = false) => {
    const state = panel.__panelRevealScrollState;
    delete panel.__panelRevealScrollState;
    if (!state) return;
    state.cleanupManualListeners?.();
    if (state.userScrolled) return;
    if (!allowRestore && Math.abs(currentScrollY() - state.targetScrollY) > 192) return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        scrollViewportTo(state.beforeScrollY);
        const cleanup = () => state.cleanupRunway?.();
        window.addEventListener("scrollend", cleanup, { once: true });
        window.setTimeout(cleanup, prefersReducedMotion() ? 50 : 900);
      });
    });
  };

  pinButton?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setSuppressHeaderToggleUntil(0);
    const pinned = panel.classList.toggle("db-panel-pinned");
    pinButton.setAttribute("aria-pressed", pinned.toString());
    groupPeers(panel, "panel").forEach((peer) => {
      peer.classList.toggle("db-panel-pinned", pinned);
      peer.querySelector(".panel-pin-toggle")?.setAttribute("aria-pressed", pinned.toString());
    });
    savePanelLayouts(layout);
    setSuppressToolOpenUntil(performance.now() + 320);
    if (panelTools?.contains(document.activeElement)) document.activeElement.blur();
    closePanelTools();
  });

  titleButton?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setSuppressHeaderToggleUntil(0);
    const titleEl = panel.querySelector(".db-panel-title");
    if (!titleEl) return;
    const originalTitle = panel.dataset.panelTitle || titleEl.textContent.trim();
    beginInlineTextEdit({
      element: titleEl,
      owner: panel,
      ownerEditingClass: "db-panel-title-editing",
      originalText: originalTitle,
      onCommit: (value) => {
        const cleanTitle = value.trim().replace(/\s+/g, " ").slice(0, 36);
        if (cleanTitle) {
          panel.dataset.panelTitle = cleanTitle;
          titleEl.textContent = cleanTitle;
        } else {
          delete panel.dataset.panelTitle;
          titleEl.textContent = panel.dataset.defaultTitle || originalTitle;
        }
        savePanelLayouts(layout);
      },
    });
    closePanelTools();
  });

  deleteButton?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const title = panel.dataset.panelTitle || panel.querySelector(".db-panel-title")?.textContent?.trim() || "this";
    const targets = [panel, ...groupPeers(panel, "panel").filter((peer) => groupItemLayout(peer) === layout)];
    requestPanelDelete({ panel, panels: targets, layout, layoutKey, title });
  });

  if (capabilities.canExpand) {
    header.setAttribute("role", "button");
    header.setAttribute("tabindex", "0");
    header.setAttribute("aria-expanded", (!panel.classList.contains("db-panel-collapsed")).toString());
  } else {
    header.removeAttribute("role");
    header.removeAttribute("tabindex");
    header.removeAttribute("aria-expanded");
    header.removeAttribute("aria-disabled");
  }

  const togglePanel = () => {
    if (!capabilities.canExpand) return;
    if (panel.classList.contains("db-panel-title-editing")) return;
    if (getMovedDuringPointer()) {
      setMovedDuringPointer(false);
      return;
    }
    const wasCollapsed = panel.classList.contains("db-panel-collapsed");
    const beforeScrollY = currentScrollY();
    const shouldRestoreRevealScroll = !wasCollapsed && canRestorePanelRevealScroll();
    if (shouldRestoreRevealScroll) preserveScrollBackRunway(panel.__panelRevealScrollState);
    if (wasCollapsed) {
      ensureRenderedGridPosition(layout, panel);
      beginPanelExpansionSession(layout, panel);
    }
    const collapsed = panel.classList.toggle("db-panel-collapsed");
    if (collapsed) {
      if (panel.style.height) panel.dataset.savedHeight = String(parseFloat(panel.style.height));
      panel.dataset.gridRowSpan = "1";
      panel.style.height = "";
    } else if (panel.dataset.savedHeight) {
      applyPanelHeight(panel, panel.dataset.savedHeight);
    } else {
      panel.dataset.gridRowSpan = String(panelMinimumRows(panel));
    }
    if (panel.dataset.gridCol && panel.dataset.gridRow) applyPanelGridPosition(panel, panel.dataset.gridCol, panel.dataset.gridRow);
    animatePanelReflow(layout, () => {
      if (collapsed) {
        panel.classList.add("db-panel-collapsed");
        panel.dataset.gridRowSpan = "1";
        panel.style.height = "";
        if (panel.dataset.gridCol && panel.dataset.gridRow) applyPanelGridPosition(panel, panel.dataset.gridCol, panel.dataset.gridRow);
        relaxCollapsedExpansionDisplacement(layout, panel);
        endPanelExpansionSession(layout, panel);
      } else {
        applyVerticalPanelExpansion(layout, panel);
        revealOpenPanelInViewport(beforeScrollY);
      }
    }, panel);
    if (collapsed) restorePanelRevealScroll(shouldRestoreRevealScroll);
    if (capabilities.canExpand) header.setAttribute("aria-expanded", (!collapsed).toString());
    savePanelLayouts(layout);
    emitWorkspaceEvent({
      type: collapsed ? "panel-collapsed" : "panel-opened",
      source: "panel-toggle",
      layoutKey,
      objectId: panel.dataset.panelKey || "",
      objectType: workspaceObjectType(panel) === WORKSPACE_OBJECT_TYPES.divider ? "divider" : "panel",
      regionId: regionIdForWorkspaceItem(panel),
      label: `${panel.dataset.panelTitle || panel.dataset.defaultTitle || "Panel"} ${collapsed ? "collapsed" : "opened"}`,
      payload: {
        collapsed,
        rows: Number(panel.dataset.gridRowSpan) || 0,
      },
    });
  };

  header.addEventListener("click", (event) => {
    if (event.target?.closest?.(".panel-tools")) return;
    if (performance.now() < getSuppressHeaderToggleUntil()) return;
    togglePanel();
  });

  panel.__openCustomization = (event) => {
    if (event.target?.closest?.(".panel-tools") || isInteractivePanelSurfaceTarget(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!canOpenDashboardTools(panel)) return;
    closeInactiveDashboardTools(panel);
    openPanelTools({ clientX: event.clientX, clientY: event.clientY });
  };

  header.addEventListener("keydown", (event) => {
    if (event.target?.closest?.(".panel-tools")) return;
    if (event.target?.isContentEditable) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    togglePanel();
  });
};
