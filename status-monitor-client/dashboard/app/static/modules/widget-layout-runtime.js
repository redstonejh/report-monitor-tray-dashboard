import { createWidgetToolSession } from "./interaction-state.js";
import { hydrateWidgetLayout } from "./widget-layout-hydration.js";
import { bindWidgetActionControls } from "./widget-action-controls.js";
import { bindWidgetMoveRuntime } from "./widget-move-runtime.js";
import { bindWidgetResizeRuntime } from "./widget-resize-runtime.js";
import { positionObjectMenuSurface } from "./object-menu-positioning.js";

export const createWidgetLayoutRuntime = (deps) => {
  const {
    isPanelInternalWidgetLayout,
    gridItemLayoutKey,
    getActivePanelProfile,
    readJsonStore,
    customWidgetsKey,
    createCustomWidget,
    parseJsonRecord,
    readRawStore,
    hiddenWidgetsKey,
    writeDraftList,
    widgetStorageKey,
    hydrateWidgetRuntime,
    widgetRuntimeController,
    markLoadedExpansionBaseline,
    ensureWorkspaceObjectMetadata,
    workspaceObjectType,
    applyPanelColor,
    applyPanelTitleColor,
    setWidgetConfig,
    widgetConfigFromElement,
    createWidgetRowBreak,
    createWidgetSpacer,
    cleanupWidgetRowBreaks,
    syncDefaultDashboardGrid,
    normalizeGridLayout,
    syncWorkspaceRegions,
    saveWidgetLayouts,
    bindWidgetRuntimeControls,
    buildPanelColorMenu,
    ensureWidgetWorkbenchPanel,
    isDashboardInteractionActive,
    canOpenDashboardTools,
    portalDashboardToolDrawer,
    setWidgetLinkNavigationSuspended,
    syncLayoutToolsActive,
    restoreFloatingMenu,
    restoreDashboardToolDrawer,
    closeInactiveDashboardTools,
    portalFloatingMenu,
    syncPanelThemeVars,
    applyWidgetSettingsSchemaChange,
    groupPeers,
    groupItemLayout,
    requestWidgetDelete,
    isPanelInternalGridItem,
    isWorkspaceSurfaceDragStart,
    isDashboardToolInteractionTarget,
    runOrderedDrag,
    saveSharedGridLayouts,
    emitWorkspaceEvent,
    regionIdForWorkspaceItem,
    DASHBOARD_GRID_COLUMNS,
    groupTransformItems,
    runGroupResize,
    createGridMetrics,
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
    snapshotGridLayout,
    restoreGridLayoutSnapshot,
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
    syncCommittedWorkspaceScrollFloor,
    beginResizeLifecycle,
    resizeEdgeFromPointer,
    surfaceResponseControlSelector,
  } = deps;

  const initWidgetLayout = (layout) => {
    const { layoutKey, widgets } = hydrateWidgetLayout(layout, {
      isPanelInternalWidgetLayout,
      gridItemLayoutKey,
      getActivePanelProfile,
      readJsonStore,
      customWidgetsKey,
      createCustomWidget,
      parseJsonRecord,
      readRawStore,
      hiddenWidgetsKey,
      writeDraftList,
      widgetStorageKey,
      hydrateWidgetRuntime,
      ensureWidgetTools: widgetRuntimeController.ensureTools,
      markLoadedExpansionBaseline,
      ensureWorkspaceObjectMetadata,
      workspaceObjectType,
      applyWidgetSpan: widgetRuntimeController.applySpan,
      applyWidgetGridPosition: widgetRuntimeController.applyGridPosition,
      applyPanelColor,
      applyPanelTitleColor,
      setWidgetConfig,
      widgetConfigFromElement,
      createWidgetRowBreak,
      createWidgetSpacer,
      cleanupWidgetRowBreaks,
      syncDefaultDashboardGrid,
      normalizeGridLayout,
      syncWorkspaceRegions,
    });

    const initWidget = (widget) => {
      if (widget.dataset.widgetInitialized === "true") return;
      widget.dataset.widgetInitialized = "true";
      widgetRuntimeController.ensureTools(widget);
      widget.__saveWidgetLayout = () => saveWidgetLayouts(layout);
      delete widget.dataset.widgetRuntimeControlsBound;
      bindWidgetRuntimeControls(widget);
      const tools = widget.querySelector(".widget-tools");
      const drawer = widget.querySelector(".widget-tool-drawer");
      widget.__dashboardToolDrawer = drawer;
      const settings = widget.querySelector(".widget-settings-toggle");
      const moveHandle = widget.querySelector(".panel-move-handle");
      const resizeHandle = widget.querySelector(".panel-resize-handle");
      const pinButton = widget.querySelector(".panel-pin-toggle");
      const titleButton = widget.querySelector(".panel-title-handle");
      const colorToggle = widget.querySelector(".panel-color-toggle");
      const deleteButton = widget.querySelector(".panel-delete-handle");
      const colorMenu = buildPanelColorMenu(widget, layout, colorToggle);
      const workbenchPanel = ensureWidgetWorkbenchPanel(widget);
      const widgetToolSession = createWidgetToolSession();
      let dragging = false;
      const openTools = (pointerCoords = null) => {
        if (performance.now() < widgetToolSession.getSuppressToolOpenUntil()) return;
        if (!canOpenDashboardTools(widget)) return;
        widgetToolSession.clearCloseTimer();
        if (!portalDashboardToolDrawer(widget, drawer, pointerCoords)) return;
        setWidgetLinkNavigationSuspended(widget, true);
        widget.classList.add("widget-tools-open");
        settings?.setAttribute("aria-expanded", "true");
        syncLayoutToolsActive();
      };
      const closeTools = () => {
        if (tools?.contains(document.activeElement)) document.activeElement?.blur?.();
        widget.classList.remove("widget-tools-open");
        widget.classList.remove("widget-workbench-open");
        settings?.setAttribute("aria-expanded", "false");
        if (workbenchPanel) restoreFloatingMenu(workbenchPanel);
        workbenchPanel?.setAttribute("hidden", "");
        colorMenu?.__closePanelColorMenu?.();
        restoreDashboardToolDrawer(drawer);
        setWidgetLinkNavigationSuspended(widget, false);
        syncLayoutToolsActive();
      };
      const closeWorkbench = () => {
        if (workbenchPanel) restoreFloatingMenu(workbenchPanel);
        widget.classList.remove("widget-workbench-open");
        workbenchPanel?.setAttribute("hidden", "");
        if (!widget.classList.contains("widget-tools-open")) setWidgetLinkNavigationSuspended(widget, false);
        syncLayoutToolsActive();
      };
      const openWorkbench = (pointerCoords = null) => {
        if (isDashboardInteractionActive()) return;
        closeInactiveDashboardTools(widget);
        widgetToolSession.clearCloseTimer();
        widget.classList.remove("widget-tools-open");
        settings?.setAttribute("aria-expanded", "false");
        colorMenu?.__closePanelColorMenu?.();
        setWidgetLinkNavigationSuspended(widget, true);
        widget.classList.add("widget-workbench-open");
        const panel = ensureWidgetWorkbenchPanel(widget);
        if (panel) {
          const widgetStyle = getComputedStyle(widget);
          [
            "--panel-accent",
            "--panel-accent-rgb",
            "--panel-accent-text",
            "--panel-lock-fg",
            "--panel-drawer-bg",
            "--widget-drawer-bg",
            "--panel-drawer-border",
            "--panel-drawer-shadow",
          ].forEach((name) => {
            const value = widgetStyle.getPropertyValue(name);
            if (value) panel.style.setProperty(name, value);
          });
          panel.dataset.panelColor = widget.dataset.panelColor || "";
          portalFloatingMenu(panel, settings || widget, { skipPosition: true });
          panel.hidden = false;
          if (!positionObjectMenuSurface(widget, panel, { gutter: 8, gap: 46, fallbackWidth: 318, fallbackHeight: 200 })) {
            restoreFloatingMenu(panel);
            widget.classList.remove("widget-workbench-open");
            panel.setAttribute("hidden", "");
            setWidgetLinkNavigationSuspended(widget, false);
            return;
          }
        }
        syncLayoutToolsActive();
      };
      const toggleAppearanceSettings = (pointerCoords = null) => {
        closeWorkbench();
        if (!canOpenDashboardTools(widget)) return;
        widgetToolSession.setSuppressToolOpenUntil(0);
        closeInactiveDashboardTools(widget);
        openTools(pointerCoords);
        colorMenu?.__closePanelColorMenu?.();
      };
      tools?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      const isInteractiveWidgetSurfaceTarget = (event) => {
        const interactiveTarget = event.target?.closest?.(
          `${surfaceResponseControlSelector}, [contenteditable='true']`,
        );
        return interactiveTarget && interactiveTarget !== widget && widget.contains(interactiveTarget);
      };
      widget.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || isInteractiveWidgetSurfaceTarget(event)) return;
        requestAnimationFrame(() => {
          if (document.activeElement === widget) widget.blur?.();
        });
      }, true);
      widget.addEventListener("click", (event) => {
        if (event.target?.closest?.(".widget-tools")) return;
        if (isInteractiveWidgetSurfaceTarget(event)) return;
        if (widget.tagName === "A") event.preventDefault();
        if (event.detail !== 0) {
          if (document.activeElement === widget) widget.blur?.();
          return;
        }
        try {
          widget.focus?.({ preventScroll: true });
        } catch {
          widget.focus?.();
        }
      }, true);
      widget.__openCustomization = (event) => {
        if (event.target?.closest?.(".widget-tools")) return;
        if (event.type !== "contextmenu" && isInteractiveWidgetSurfaceTarget(event)) return;
        event.preventDefault();
        event.stopPropagation();
        toggleAppearanceSettings({ clientX: event.clientX, clientY: event.clientY });
      };
      workbenchPanel?.addEventListener("click", (event) => {
        event.stopPropagation();
      });
      workbenchPanel?.addEventListener("submit", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      workbenchPanel?.addEventListener("input", (event) => {
        event.stopPropagation();
      });
      workbenchPanel?.addEventListener("change", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const input = event.target?.closest?.(".widget-setting-input");
        if (!input || !widget.contains(input)) return;
        applyWidgetSettingsSchemaChange(widget, input, { history: true });
        ensureWidgetWorkbenchPanel(widget);
      });
      workbenchPanel?.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          closeWorkbench();
          widget.focus?.({ preventScroll: true });
        }
      });
      settings?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      settings?.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
      });
      colorToggle?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const nextOpen = !colorMenu?.classList.contains("panel-color-menu-open");
        if (nextOpen) {
          colorMenu?.__openPanelColorMenu?.(colorToggle);
        } else {
          colorMenu?.__closePanelColorMenu?.();
        }
      });
      document.addEventListener("pointerdown", (event) => {
        if (!colorMenu?.classList.contains("panel-color-menu-open")) return;
        if (widget.contains(event.target) || colorMenu.contains(event.target)) return;
        closeTools();
      });
      document.addEventListener("pointerdown", (event) => {
        if (!widget.classList.contains("widget-workbench-open")) return;
        if (widget.contains(event.target) || colorMenu?.contains(event.target)) return;
        closeWorkbench();
      });
      bindWidgetActionControls({
        widget,
        layout,
        layoutKey,
        tools,
        pinButton,
        titleButton,
        deleteButton,
        groupPeers,
        groupItemLayout,
        saveWidgetLayouts,
        requestWidgetDelete,
        closeTools,
        setSuppressToolOpenUntil: widgetToolSession.setSuppressToolOpenUntil,
      });
      bindWidgetMoveRuntime({
        widget,
        layout,
        layoutKey,
        moveHandle,
        isPanelInternalGridItem,
        isWorkspaceSurfaceDragStart,
        setWidgetLinkNavigationSuspended,
        runOrderedDrag,
        cleanupWidgetRowBreaks,
        saveSharedGridLayouts,
        emitWorkspaceEvent,
        regionIdForWorkspaceItem,
        closeTools,
        isInteractiveWidgetSurfaceTarget,
        clearToolCloseTimer: widgetToolSession.clearCloseTimer,
        setDragging: (value) => {
          dragging = value;
          if (value) widgetToolSession.clearCloseTimer();
        },
        setSuppressWidgetClickUntil: widgetToolSession.setSuppressWidgetClickUntil,
      });
      bindWidgetResizeRuntime({
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
        applyWidgetSpan: widgetRuntimeController.applySpan,
        applyWidgetGridPosition: widgetRuntimeController.applyGridPosition,
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
        clearCloseTimer: widgetToolSession.clearCloseTimer,
        setSuppressWidgetClickUntil: widgetToolSession.setSuppressWidgetClickUntil,
      });
    };
    widgets.forEach(initWidget);
    layout.__initWidget = initWidget;
  };

  return { initWidgetLayout };
};
