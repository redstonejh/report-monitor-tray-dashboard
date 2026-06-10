export const createClipboardRuntime = ({
  layoutPersistence,
  selectedGroupItems,
  isPanelInternalGridItem,
  groupItemLayoutKey,
  workspaceObjectKey,
  workspaceObjectType,
  getActivePanelProfile,
  visualGridOrder,
  workspaceDeleteKind,
  gridBoundsForItem,
  sanitizeLayoutElementForUndo,
  showToast,
  undoTransientItemClasses,
  WORKSPACE_OBJECT_TYPES,
  pushLiveLayoutUndo,
  visibleRegionInsertionTarget,
  orderedLayoutStartRow,
  commitInsertedGridItemWithVerticalPushdown,
  clearGroupSelection,
  applyWidgetGridPosition,
  bindDashboardKeywordForms,
  applyPanelGridPosition,
  ensureWorkspaceObjectMetadata,
  setGroupItemSelected,
  syncWorkspaceRegions,
  animatePanelReflow,
  animateWidgetReflow,
  cleanupPanelRowBreaks,
  savePanelLayouts,
  cleanupWidgetRowBreaks,
  saveWidgetLayouts,
}) => {
  const nextPastedObjectId = layoutPersistence.nextObjectId;

  const selectedClipboardRoots = () => {
    const selected = selectedGroupItems(null);
    const selectedSet = new Set(selected);
    return selected
      .filter((item) => item?.isConnected && !item.hidden)
      .filter((item) => {
        if (!isPanelInternalGridItem(item)) return true;
        const parentPanel = item.closest(".db-panel");
        return !selectedSet.has(parentPanel);
      });
  };

  const copySelectedWorkspaceObjects = () => {
    const roots = selectedClipboardRoots();
    if (!roots.length) return false;
    const layoutKey = groupItemLayoutKey(roots[0]);
    const selectedIds = new Set(roots.flatMap((item) => {
      const ids = [workspaceObjectKey(item)].filter(Boolean);
      item.querySelectorAll?.("[data-widget-key], [data-panel-key]").forEach((node) => {
        const id = workspaceObjectKey(node);
        if (id) ids.push(id);
      });
      return ids;
    }));
    layoutPersistence.clipboard.set({
      layoutKey,
      copiedAt: Date.now(),
      items: visualGridOrder(roots).map((item) => ({
        kind: workspaceDeleteKind(item),
        layoutKey: groupItemLayoutKey(item),
        parentPanelKey: isPanelInternalGridItem(item) ? item.closest(".db-panel")?.dataset.panelKey || null : null,
        bounds: gridBoundsForItem(item),
        html: sanitizeLayoutElementForUndo(item),
      })),
    });
    showToast(roots.length > 1 ? `${roots.length} selected objects copied.` : "Selected object copied.");
    return true;
  };

  const remapDataReference = (element, property, idMap, { clearUnsafe = false } = {}) => {
    const current = element?.dataset?.[property];
    if (!current) return;
    if (idMap.has(current)) {
      element.dataset[property] = idMap.get(current);
    } else if (clearUnsafe) {
      delete element.dataset[property];
    }
  };

  const preparePastedWorkspaceElement = (element, idMap, layoutKey, rootKind) => {
    element.classList.remove(...undoTransientItemClasses);
    element.removeAttribute("aria-selected");
    element.removeAttribute("hidden");
    delete element.dataset.panelInitialized;
    delete element.dataset.widgetInitialized;
    element.querySelectorAll(".group-selected").forEach((node) => {
      node.classList.remove("group-selected");
      node.removeAttribute("aria-selected");
    });
    element.querySelectorAll(".panel-settings-toggle, .panel-color-toggle").forEach((button) => {
      button.setAttribute("aria-expanded", "false");
    });
    element.querySelectorAll(".panel-color-menu-open").forEach((menu) => {
      menu.classList.remove("panel-color-menu-open");
    });

    const panelNodes = [
      ...(element.dataset.panelKey ? [element] : []),
      ...element.querySelectorAll("[data-panel-key]"),
    ];
    panelNodes.forEach((panel) => {
      const oldKey = panel.dataset.panelKey;
      if (!oldKey) return;
      if (!idMap.has(oldKey)) idMap.set(oldKey, nextPastedObjectId("panel"));
      panel.dataset.panelKey = idMap.get(oldKey);
      panel.dataset.customPanel = "true";
      delete panel.dataset.panelInitialized;
      if (workspaceObjectType(panel) === WORKSPACE_OBJECT_TYPES.divider) {
        delete panel.dataset.workspaceRegionId;
        delete panel.dataset.navigationTargetId;
      }
    });

    const widgetNodes = [
      ...(element.dataset.widgetKey ? [element] : []),
      ...element.querySelectorAll("[data-widget-key]"),
    ];
    widgetNodes.forEach((widget) => {
      const oldKey = widget.dataset.widgetKey;
      if (!oldKey) return;
      if (!idMap.has(oldKey)) idMap.set(oldKey, nextPastedObjectId("widget"));
      widget.dataset.widgetKey = idMap.get(oldKey);
      widget.dataset.customWidget = "true";
      delete widget.dataset.widgetInitialized;
      delete widget.dataset.contextInheritedFrom;
      delete widget.dataset.workspaceRegionId;
      if (rootKind === "widget" && widget === element) {
        delete widget.dataset.panelChildWidget;
        delete widget.dataset.parentPanelKey;
      }
    });

    element.querySelectorAll(".panel-internal-widget-grid").forEach((grid) => {
      const panel = grid.closest(".db-panel");
      const panelKey = panel?.dataset.panelKey || "";
      grid.dataset.panelContainerKey = panelKey;
      grid.dataset.widgetLayoutKey = `${layoutKey}:panel:${panelKey || "panel"}`;
    });

    element.querySelectorAll("[data-parent-panel-key]").forEach((child) => {
      remapDataReference(child, "parentPanelKey", idMap, { clearUnsafe: true });
    });
    [element, ...element.querySelectorAll("[data-navigation-target-id], [data-linked-divider-id]")].forEach((node) => {
      remapDataReference(node, "navigationTargetId", idMap);
      remapDataReference(node, "linkedDividerId", idMap, { clearUnsafe: true });
    });
  };

  const createGroupPasteFootprint = (boundsList) => {
    const minCol = Math.min(...boundsList.map((bounds) => bounds.col));
    const minRow = Math.min(...boundsList.map((bounds) => bounds.row));
    const maxRight = Math.max(...boundsList.map((bounds) => bounds.right));
    const maxBottom = Math.max(...boundsList.map((bounds) => bounds.bottom));
    const footprint = document.createElement("div");
    footprint.className = "db-panel-placeholder dashboard-group-paste-footprint";
    footprint.dataset.defaultSpan = String(Math.max(1, maxRight - minCol + 1));
    footprint.dataset.currentSpan = footprint.dataset.defaultSpan;
    footprint.dataset.gridRowSpan = String(Math.max(1, maxBottom - minRow + 1));
    return {
      footprint,
      origin: { col: minCol, row: minRow },
    };
  };

  const pasteWorkspaceClipboardObjects = (layoutKey = "builder") => {
    const clipboard = layoutPersistence.clipboard.get();
    if (!clipboard?.items?.length) return false;
    const widgetLayout = document.querySelector(`.widget-layout[data-widget-layout-key="${CSS.escape(layoutKey)}"]`);
    const panelLayout = document.querySelector(`.panel-layout[data-layout-key="${CSS.escape(layoutKey)}"]`);
    const targetLayout = panelLayout || widgetLayout;
    if (!targetLayout) return false;

    const idMap = new Map();
    const pasted = clipboard.items.map((entry) => {
      const template = document.createElement("template");
      template.innerHTML = entry.html || "";
      const element = template.content.firstElementChild;
      if (!element) return null;
      preparePastedWorkspaceElement(element, idMap, layoutKey, entry.kind);
      return {
        ...entry,
        element,
        bounds: entry.bounds,
        kind: entry.kind === "divider" ? "panel" : entry.kind,
      };
    }).filter((entry) => entry?.element && entry.bounds);
    if (!pasted.length) return false;

    const profile = getActivePanelProfile(layoutKey);
    pushLiveLayoutUndo(layoutKey, profile);
    const { footprint, origin } = createGroupPasteFootprint(pasted.map((entry) => entry.bounds));
    const target = visibleRegionInsertionTarget(targetLayout, footprint) || { col: 1, row: orderedLayoutStartRow(targetLayout) };

    const appendPastedObjects = () => {
      commitInsertedGridItemWithVerticalPushdown(targetLayout, footprint, target);
      clearGroupSelection();
      pasted.forEach((entry) => {
        const nextCol = target.col + (entry.bounds.col - origin.col);
        const nextRow = target.row + (entry.bounds.row - origin.row);
        if (entry.element.classList.contains("widget-card")) {
          if (!widgetLayout) return;
          widgetLayout.appendChild(entry.element);
          applyWidgetGridPosition(entry.element, nextCol, nextRow);
          widgetLayout.__initWidget?.(entry.element);
          bindDashboardKeywordForms(entry.element);
        } else {
          if (!panelLayout) return;
          panelLayout.appendChild(entry.element);
          applyPanelGridPosition(entry.element, nextCol, nextRow);
          ensureWorkspaceObjectMetadata(entry.element);
          panelLayout.__initPanel?.(entry.element);
        }
        setGroupItemSelected(entry.element, true);
      });
      syncWorkspaceRegions(targetLayout);
    };

    const animationLayout = panelLayout || widgetLayout;
    if (animationLayout?.classList?.contains("panel-layout")) {
      animatePanelReflow(animationLayout, appendPastedObjects);
    } else if (animationLayout) {
      animateWidgetReflow(animationLayout, appendPastedObjects);
    } else {
      appendPastedObjects();
    }

    if (panelLayout) {
      cleanupPanelRowBreaks(panelLayout);
      savePanelLayouts(panelLayout, profile, { history: false });
    }
    if (widgetLayout) {
      cleanupWidgetRowBreaks(widgetLayout);
      saveWidgetLayouts(widgetLayout, profile, { history: false });
    }
    pushLiveLayoutUndo(layoutKey, profile);
    showToast(pasted.length > 1 ? `${pasted.length} objects pasted.` : "Object pasted.");
    return true;
  };

  return {
    copySelectedWorkspaceObjects,
    pasteWorkspaceClipboardObjects,
  };
};
