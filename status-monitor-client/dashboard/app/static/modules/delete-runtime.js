export const initializeDeleteRuntime = ({
  panelDeleteDialog,
  panelDeleteMessage,
  panelDeleteConfirm,
  panelDeleteCancel,
  panelDeleteClose,
  workspaceDeleteKind,
  isPanelInternalWidgetLayout,
  gridItemLayoutKey,
  parseJsonRecord,
  widgetDefinitionForElement,
  cleanupWidgetRowBreaks,
  saveWidgetLayouts,
  cleanupPanelRowBreaks,
  savePanelLayouts,
  getActivePanelProfile,
  pushLiveLayoutUndo,
  restoreDashboardToolDrawer,
  dashboardSettingsToggleForItem,
  dashboardColorToggleForItem,
  groupSelection,
  groupSelectedIds,
  groupItemId,
  closeInactiveDashboardTools,
  syncLayoutToolsActive,
  panelChildWidgets,
  gridBoundsForItem,
  readDraftList,
  undoTransientItemClasses,
  DASHBOARD_GRID_COLUMNS,
  commitInsertedGridItemWithVerticalPushdown,
  writeDraftList,
  updatePanelChildEmptyState,
  panelForInternalWidgetLayout,
  relaxCollapsedExpansionDisplacement,
  endPanelExpansionSession,
  emitWorkspaceEvent,
  regionIdForWorkspaceItem,
  showToast,
}) => {
  let pendingPanelDelete = null;

  const closePanelDeleteDialog = () => {
    pendingPanelDelete = null;
    panelDeleteDialog?.close();
  };

  const workspaceDeleteLayout = (item) => item?.closest?.(".widget-layout, .panel-layout");

  const workspaceDeleteLayoutKey = (item) => {
    const layout = workspaceDeleteLayout(item);
    if (isPanelInternalWidgetLayout(layout)) return gridItemLayoutKey(layout);
    return layout?.dataset.widgetLayoutKey || layout?.dataset.layoutKey || "default";
  };

  const workspaceDeleteTitle = (item) => {
    const kind = workspaceDeleteKind(item);
    if (kind === "widget") return item.dataset.panelTitle || item.querySelector(".stat-lbl")?.textContent?.trim() || "Widget";
    return item.dataset.panelTitle || item.querySelector(".db-panel-title")?.textContent?.trim() || (kind === "divider" ? "Divider" : "Panel");
  };

  const workspaceDeleteId = (item) => {
    const kind = workspaceDeleteKind(item);
    const key = kind === "widget" ? item?.dataset?.widgetKey : item?.dataset?.panelKey;
    return key ? `${workspaceDeleteLayoutKey(item)}:${kind}:${key}` : "";
  };

  const defaultColorForWorkspaceObject = (item) =>
    item?.querySelector?.(".panel-color-toggle")?.dataset.defaultTheme || "";

  const normalizedColor = (color) => String(color || "").trim().toLowerCase();

  const hasCustomWorkspaceColor = (item) => {
    const current = normalizedColor(item?.dataset?.panelColor);
    const fallback = normalizedColor(defaultColorForWorkspaceObject(item));
    return Boolean(current && fallback && current !== fallback);
  };

  const hasRenamedWorkspaceObject = (item) => {
    const kind = workspaceDeleteKind(item);
    const title = item?.dataset?.panelTitle;
    if (!title) return false;
    const defaultTitle = item?.dataset?.defaultTitle || "";
    return !defaultTitle || title.trim() !== defaultTitle.trim();
  };

  const panelHasConfiguredContent = (panel) => {
    if (!panel || workspaceDeleteKind(panel) === "divider") return false;
    const body = panel.querySelector(":scope > .db-panel-body");
    if (!body || body.hidden) return false;
    return [...body.children].some((child) => {
      if (child.classList.contains("empty-state") || child.dataset.panelPlaceholder === "empty") return false;
      if (child.classList.contains("panel-internal-widget-grid")) return Boolean(child.querySelector(":scope > .widget-card"));
      return !child.hidden && child.textContent.trim();
    });
  };

  const widgetHasConfiguredContent = (widget) => {
    if (!widget) return false;
    const config = parseJsonRecord(widget.dataset.widgetConfig, {}) || {};
    let defaultConfig = {};
    try {
      const definition = widgetDefinitionForElement(widget);
      defaultConfig = typeof definition.getDefaultConfig === "function" ? definition.getDefaultConfig() : {};
    } catch {}
    const meaningfulConfig = Object.entries(config).some(([key, value]) => {
      if (value == null || value === "" || value === false) return false;
      if (key === "value" && String(value).trim() === "0") return false;
      const defaultValue = defaultConfig[key];
      if (JSON.stringify(value) === JSON.stringify(defaultValue)) return false;
      if ((key === "title" || key === "label") && value === (widget.dataset.defaultTitle || widget.querySelector(".stat-lbl")?.textContent?.trim())) return false;
      if (key === "title" && /^widget\s+\d+$/i.test(String(value).trim())) return false;
      return true;
    });
    if (meaningfulConfig) return true;
    if (widget.dataset.filterConfig || widget.dataset.searchConfig) return true;
    const searchValue = widget.querySelector(".search-widget-input")?.value?.trim();
    if (searchValue) return true;
    if (widget.dataset.widgetDefinition) return false;
    const value = widget.querySelector(".stat-val")?.textContent?.trim();
    if (value && value !== "0" && widget.dataset.widgetType !== "controls") return true;
    return false;
  };

  const dividerHasConfiguredContext = (divider) => {
    if (!divider) return false;
    return Boolean(
      divider.dataset.regionConfig ||
      divider.dataset.contextConfig ||
      divider.dataset.contextLabel ||
      divider.dataset.contextDescription
    );
  };

  const workspaceObjectHasMeaningfulChanges = (item) => {
    const kind = workspaceDeleteKind(item);
    if (!kind) return true;
    if (hasRenamedWorkspaceObject(item) || hasCustomWorkspaceColor(item)) return true;
    if (kind === "divider") return dividerHasConfiguredContext(item);
    if (kind === "panel") return panelHasConfiguredContent(item);
    if (kind === "widget") return widgetHasConfiguredContent(item);
    return true;
  };

  const workspaceDeleteEntries = (targets) => {
    const seen = new Set();
    return [].concat(targets || [])
      .filter((item) => item?.isConnected && !item.hidden)
      .map((item) => ({ item, id: workspaceDeleteId(item), kind: workspaceDeleteKind(item), layout: workspaceDeleteLayout(item), layoutKey: workspaceDeleteLayoutKey(item), title: workspaceDeleteTitle(item) }))
      .filter((entry) => entry.id && entry.kind && entry.layout && !seen.has(entry.id) && seen.add(entry.id));
  };

  const describeWorkspaceDeleteTargets = (entries) => {
    if (entries.length > 1) return `${entries.length} selected objects`;
    const entry = entries[0];
    return `"${entry?.title || "this"}" ${entry?.kind || "object"}`;
  };

  const saveWorkspaceDeleteLayouts = (entries) => {
    const touched = new Map();
    entries.forEach((entry) => {
      if (entry.kind === "widget") {
        cleanupWidgetRowBreaks(entry.layout);
        saveWidgetLayouts(entry.layout, getActivePanelProfile(entry.layoutKey), { persist: true, history: false });
        touched.set(`${entry.layoutKey}:grid`, { layoutKey: entry.layoutKey, profile: getActivePanelProfile(entry.layoutKey) });
      } else {
        cleanupPanelRowBreaks(entry.layout);
        savePanelLayouts(entry.layout, getActivePanelProfile(entry.layoutKey), { persist: true, history: false });
        touched.set(`${entry.layoutKey}:grid`, { layoutKey: entry.layoutKey, profile: getActivePanelProfile(entry.layoutKey) });
      }
    });
    [...new Map([...touched.values()].map((value) => [`${value.profile}:${value.layoutKey}`, value])).values()]
      .forEach(({ layoutKey, profile }) => pushLiveLayoutUndo(layoutKey, profile));
  };

  const clearWorkspaceDeleteInteractionState = (entries) => {
    entries.forEach((entry) => {
      restoreDashboardToolDrawer(entry.item.__dashboardToolDrawer);
      entry.item.classList.remove("widget-tools-open", "db-panel-tools-open", "group-selected");
      dashboardSettingsToggleForItem(entry.item)?.setAttribute("aria-expanded", "false");
      dashboardColorToggleForItem(entry.item)?.setAttribute("aria-expanded", "false");
      entry.item.querySelectorAll?.(".panel-color-menu-open").forEach((menu) => {
        menu.classList.remove("panel-color-menu-open");
      });
      groupSelection.delete(entry.item);
      groupSelectedIds.delete(groupItemId(entry.item));
    });
    closeInactiveDashboardTools();
    syncLayoutToolsActive();
  };

  const performWorkspaceObjectDelete = (entries) => {
    clearWorkspaceDeleteInteractionState(entries);
    const hiddenByLayout = new Map();
    const extractedByLayout = new Map();
    const extractPanelChildrenBeforeDelete = (entry) => {
      if (entry.kind !== "panel") return;
      const panel = entry.item;
      const children = panelChildWidgets(panel);
      if (!children.length) return;
      const targetLayout = entry.layout?.closest?.(".dashboard-layout-grid")
        ?.querySelector?.(`.widget-layout[data-widget-layout-key="${CSS.escape(entry.layoutKey || "default")}"]`);
      if (!targetLayout) return;
      const panelBounds = gridBoundsForItem(panel);
      let hidden = readDraftList(targetLayout, "hiddenWidgetsDraft");
      children.forEach((child, index) => {
        const key = child.dataset.widgetKey || "";
        const localBounds = gridBoundsForItem(child);
        if (key) hidden = hidden.filter((hiddenKey) => hiddenKey !== key);
        child.classList.remove(...undoTransientItemClasses);
        delete child.dataset.panelChildWidget;
        delete child.dataset.parentPanelKey;
        delete child.dataset.widgetInitialized;
        child.removeAttribute("hidden");
        child.style.removeProperty("left");
        child.style.removeProperty("top");
        child.style.removeProperty("width");
        child.style.removeProperty("position");
        targetLayout.appendChild(child);
        const target = {
          col: Math.max(1, Math.min(DASHBOARD_GRID_COLUMNS, panelBounds.col + localBounds.col - 1)),
          row: Math.max(1, panelBounds.row + localBounds.row + index),
        };
        commitInsertedGridItemWithVerticalPushdown(targetLayout, child, target);
        targetLayout.__initWidget?.(child);
      });
      writeDraftList(targetLayout, "hiddenWidgetsDraft", hidden);
      updatePanelChildEmptyState(panel);
      cleanupWidgetRowBreaks(targetLayout);
      extractedByLayout.set(targetLayout, entry.layoutKey || gridItemLayoutKey(targetLayout));
    };
    entries.forEach(extractPanelChildrenBeforeDelete);
    entries.forEach((entry) => {
      const hiddenKey = entry.kind === "widget" ? "hiddenWidgetsDraft" : "hiddenPanelsDraft";
      const customKey = entry.kind === "widget" ? "customWidget" : "customPanel";
      const itemKey = entry.kind === "widget" ? "widgetKey" : "panelKey";
      const key = entry.item.dataset[itemKey];
      if (entry.kind === "widget" && isPanelInternalWidgetLayout(entry.layout)) {
        entry.item.remove();
        updatePanelChildEmptyState(panelForInternalWidgetLayout(entry.layout));
        return;
      }
      if (!entry.item.dataset[customKey]) {
        const cacheKey = `${entry.layoutKey}:${hiddenKey}`;
        const hidden = hiddenByLayout.get(cacheKey) || readDraftList(entry.layout, hiddenKey);
        if (key && !hidden.includes(key)) hidden.push(key);
        hiddenByLayout.set(cacheKey, hidden);
        entry.item.hidden = true;
        if (entry.kind === "panel" && entry.layout && entry.item.__activeExpansionSource) {
          relaxCollapsedExpansionDisplacement(entry.layout, null);
          endPanelExpansionSession(entry.layout, entry.item);
        }
      } else {
        if (entry.kind === "panel" && entry.layout && entry.item.__activeExpansionSource) {
          entry.item.hidden = true;
          relaxCollapsedExpansionDisplacement(entry.layout, null);
          endPanelExpansionSession(entry.layout, entry.item);
        }
        entry.item.remove();
      }
    });
    hiddenByLayout.forEach((hidden, cacheKey) => {
      const [layoutKey, hiddenKey] = cacheKey.split(":");
      const entry = entries.find((candidate) => candidate.layoutKey === layoutKey && (candidate.kind === "widget" ? "hiddenWidgetsDraft" : "hiddenPanelsDraft") === hiddenKey);
      writeDraftList(entry?.layout, hiddenKey, hidden);
    });
    extractedByLayout.forEach((layoutKey, widgetLayout) => {
      saveWidgetLayouts(widgetLayout, getActivePanelProfile(layoutKey), { history: false });
    });
    saveWorkspaceDeleteLayouts(entries);
    syncLayoutToolsActive();
    entries.forEach((entry) => {
      emitWorkspaceEvent({
        type: "object-deleted",
        source: "object-delete",
        layoutKey: entry.layoutKey,
        objectId: entry.item.dataset.widgetKey || entry.item.dataset.panelKey || "",
        objectType: entry.kind,
        regionId: regionIdForWorkspaceItem(entry.item),
        panelId: entry.item.dataset.parentPanelKey || entry.item.closest?.(".db-panel")?.dataset?.panelKey || "",
        label: `${entry.title} ${entry.kind} deleted`,
        payload: { title: entry.title, extractedPanelChildren: entry.kind === "panel" ? panelChildWidgets(entry.item).length : 0 },
      });
    });
    showToast(entries.length > 1 ? `${entries.length} objects deleted.` : `${entries[0].title} ${entries[0].kind} deleted.`, "info");
  };

  const requestWorkspaceObjectDelete = ({ targets }) => {
    const entries = workspaceDeleteEntries(targets);
    if (!entries.length) return false;
    const needsConfirmation = entries.some((entry) => workspaceObjectHasMeaningfulChanges(entry.item));
    if (!needsConfirmation) {
      performWorkspaceObjectDelete(entries);
      return true;
    }
    pendingPanelDelete = { entries };
    if (panelDeleteMessage) {
      panelDeleteMessage.textContent = `Are you sure you want to delete ${describeWorkspaceDeleteTargets(entries)}?`;
    }
    if (typeof panelDeleteDialog?.showModal === "function") {
      panelDeleteDialog.showModal();
    } else {
      performWorkspaceObjectDelete(entries);
    }
    return true;
  };

  const requestPanelDelete = ({ panel, panels = null }) => requestWorkspaceObjectDelete({ targets: panels?.length ? panels : [panel] });

  const requestWidgetDelete = ({ widget, widgets = null }) => requestWorkspaceObjectDelete({ targets: widgets?.length ? widgets : [widget] });

  panelDeleteCancel?.addEventListener("click", closePanelDeleteDialog);
  panelDeleteClose?.addEventListener("click", closePanelDeleteDialog);
  panelDeleteDialog?.addEventListener("cancel", (event) => {
    event.preventDefault();
    closePanelDeleteDialog();
  });
  panelDeleteConfirm?.addEventListener("click", () => {
    if (!pendingPanelDelete) return;
    performWorkspaceObjectDelete(pendingPanelDelete.entries || []);
    closePanelDeleteDialog();
  });

  return {
    requestWorkspaceObjectDelete,
    requestPanelDelete,
    requestWidgetDelete,
  };
};
