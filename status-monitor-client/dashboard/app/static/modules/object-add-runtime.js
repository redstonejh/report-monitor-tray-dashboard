export function initializeObjectAddRuntime(deps) {
  const {
    positionPortaledMenu,
    portalFloatingMenu,
    restoreFloatingMenu,
    originalMenuParent,
    widgetDefinitionFor,
    normalizeWorkspaceWidgetLayer,
    getActivePanelProfile,
    savePanelLayouts,
    saveWidgetLayouts,
    syncDefaultDashboardGrid,
    syncPanelMinimumWidth,
    createCustomPanel,
    createCustomWidget,
    panelAddTarget,
    visibleRegionInsertionTarget,
    applyPanelSpan,
    applyWidgetSpan,
    applyPanelColor,
    applyPanelTitleColor,
    applyPanelGridPosition,
    applyWidgetGridPosition,
    animatePanelReflow,
    animateWidgetReflow,
    commitInsertedGridItemWithVerticalPushdown,
    syncWorkspaceRegions,
    ensureWorkspaceObjectMetadata,
    ensureWidgetTools,
    parseJsonRecord,
    bindDashboardKeywordForms,
    refreshWidgetDisplayState,
    showToast,
    regionIdForWorkspaceItem,
    WORKSPACE_OBJECT_TYPES,
    workspaceTabsRuntime,
  } = deps;
  const objectAddCategories = [
    { id: "data", label: "Data" },
    { id: "visualization", label: "Visualization" },
    { id: "controls", label: "Controls" },
    { id: "content", label: "Content" },
    { id: "media", label: "Media" },
    { id: "system", label: "System" },
    { id: "experimental", label: "Experimental" },
    { id: "containers", label: "Containers" },
    { id: "navigation", label: "Navigation" },
    { id: "dividers", label: "Dividers" },
  ];
  const objectAddItems = [
    { category: "data", displayName: "Stat", actionClass: "widget-add-action", dataset: { widgetKind: "stat" } },
    { category: "data", displayName: "Table", actionClass: "widget-add-action", dataset: { widgetKind: "table" } },
    { category: "visualization", subcategory: "Charts", displayName: "Bar", actionClass: "widget-add-action", dataset: { widgetKind: "graph", widgetCreateKind: "graph", objectDisplayName: "Bar Chart", widgetConfig: JSON.stringify({ title: "Bar Chart", chartType: "bar" }), chartType: "bar" } },
    { category: "visualization", subcategory: "Charts", displayName: "Line", actionClass: "widget-add-action", dataset: { widgetKind: "chart-line", widgetCreateKind: "graph", objectDisplayName: "Line Chart", widgetConfig: JSON.stringify({ title: "Line Chart", chartType: "line" }), chartType: "line" } },
    { category: "visualization", subcategory: "Charts", displayName: "Area", actionClass: "widget-add-action", dataset: { widgetKind: "chart-area", widgetCreateKind: "graph", objectDisplayName: "Area Chart", widgetConfig: JSON.stringify({ title: "Area Chart", chartType: "area" }), chartType: "area" } },
    { category: "visualization", subcategory: "Charts", displayName: "Scatter", actionClass: "widget-add-action", dataset: { widgetKind: "chart-scatter", widgetCreateKind: "graph", objectDisplayName: "Scatter Chart", widgetConfig: JSON.stringify({ title: "Scatter Chart", chartType: "scatter" }), chartType: "scatter" } },
    { category: "visualization", subcategory: "Charts", displayName: "Histogram", actionClass: "widget-add-action", dataset: { widgetKind: "chart-histogram", widgetCreateKind: "graph", objectDisplayName: "Histogram", widgetConfig: JSON.stringify({ title: "Histogram", chartType: "histogram" }), chartType: "histogram" } },
    { category: "visualization", subcategory: "Charts", displayName: "Heatmap", actionClass: "widget-add-action", dataset: { widgetKind: "chart-heatmap", widgetCreateKind: "graph", objectDisplayName: "Heatmap", widgetConfig: JSON.stringify({ title: "Heatmap", chartType: "heatmap" }), chartType: "heatmap" } },
    { category: "visualization", subcategory: "Charts", displayName: "Pie / Donut", actionClass: "widget-add-action", dataset: { widgetKind: "chart-donut", widgetCreateKind: "graph", objectDisplayName: "Donut Chart", widgetConfig: JSON.stringify({ title: "Donut Chart", chartType: "donut" }), chartType: "donut" } },
    { category: "visualization", subcategory: "Charts", displayName: "Gauge", actionClass: "widget-add-action", dataset: { widgetKind: "chart-gauge", widgetCreateKind: "graph", objectDisplayName: "Gauge", widgetConfig: JSON.stringify({ title: "Gauge", chartType: "gauge" }), chartType: "gauge" } },
    { category: "visualization", subcategory: "Charts", displayName: "Sparkline", actionClass: "widget-add-action", dataset: { widgetKind: "chart-sparkline", widgetCreateKind: "graph", objectDisplayName: "Sparkline", widgetConfig: JSON.stringify({ title: "Sparkline", chartType: "sparkline" }), chartType: "sparkline" } },
    { category: "visualization", subcategory: "Geospatial", displayName: "Map", actionClass: "widget-add-action", dataset: { widgetKind: "map" } },
    { category: "controls", displayName: "Timeframe", actionClass: "widget-add-action", dataset: { widgetKind: "timeframe" } },
    { category: "controls", displayName: "Calendar", actionClass: "widget-add-action", dataset: { widgetKind: "calendar" } },
    { category: "content", displayName: "Text / Notes", actionClass: "widget-add-action", dataset: { widgetKind: "text" } },
    { category: "content", displayName: "Region Summary", actionClass: "widget-add-action", dataset: { widgetKind: "region-summary" } },
    { category: "media", displayName: "Image", actionClass: "widget-add-action", dataset: { widgetKind: "image" } },
    { category: "media", displayName: "Video", actionClass: "widget-add-action", dataset: { widgetKind: "video" } },
    { category: "media", displayName: "PDF / Document", actionClass: "widget-add-action", dataset: { widgetKind: "document" } },
    { category: "containers", displayName: "Panel", actionClass: "panel-add-action", dataset: { panelKind: "panel" } },
    { category: "navigation", displayName: "Tab", actionClass: "tab-add-action", dataset: { tabKind: "workspace-page" } },
    { category: "dividers", displayName: "Divider", actionClass: "divider-add-action", dataset: { dividerKind: "context-divider" } },
  ];
  const objectAddItemRuntimeDefinition = (item = {}) => {
    if (item.actionClass !== "widget-add-action") return null;
    const kind = item.dataset?.widgetCreateKind || item.dataset?.widgetKind || "";
    if (!kind) return null;
    return widgetDefinitionFor(kind);
  };
  const objectAddItemLayer = (item = {}) => (
    normalizeWorkspaceWidgetLayer(
      item.layer ||
      item.dataset?.widgetLayer ||
      objectAddItemRuntimeDefinition(item)?.layer,
      "presentation"
    )
  );
  const objectAddSetDataset = (element, dataset = {}) => {
    Object.entries(dataset).forEach(([key, value]) => {
      if (value == null) return;
      element.dataset[key] = String(value);
    });
  };
  const suppressObjectAddBrowserTitles = (root) => {
    if (!root) return;
    const nodes = root.matches?.("[title]") ? [root] : [];
    root.querySelectorAll?.("[title]")?.forEach((node) => nodes.push(node));
    nodes.forEach((node) => {
      const title = node.getAttribute("title") || "";
      if (title && !node.getAttribute("aria-label") && !node.textContent?.trim()) {
        node.setAttribute("aria-label", title);
      }
      node.removeAttribute("title");
    });
  };
  const createObjectAddAction = (item, layoutKey) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `object-add-action glass-menu-item ${item.actionClass || ""}`.trim();
    button.textContent = item.displayName;
    if (item.actionClass === "panel-add-action" || item.actionClass === "divider-add-action" || item.actionClass === "tab-add-action") {
      button.dataset.layoutTarget = layoutKey;
    } else {
      button.dataset.widgetTarget = layoutKey;
    }
    button.dataset.objectAddCategory = item.category;
    if (item.subcategory) button.dataset.objectAddSubcategory = item.subcategory;
    const layer = objectAddItemLayer(item);
    if (item.actionClass === "widget-add-action" && layer) button.dataset.widgetLayer = layer;
    objectAddSetDataset(button, item.dataset);
    return button;
  };
  const createObjectAddSubmenu = (items, layoutKey) => {
    const submenu = document.createElement("div");
    submenu.className = "object-add-submenu glass-submenu-panel floating-glass-menu";
    submenu.setAttribute("role", "menu");
    const bySubcategory = new Map();
    items.filter((item) => !item.subcategory).forEach((item) => submenu.appendChild(createObjectAddAction(item, layoutKey)));
    items.filter((item) => item.subcategory).forEach((item) => {
      if (!bySubcategory.has(item.subcategory)) bySubcategory.set(item.subcategory, []);
      bySubcategory.get(item.subcategory).push(item);
    });
    bySubcategory.forEach((subcategoryItems, subcategory) => {
      const group = document.createElement("div");
      group.className = "object-add-subcategory";
      group.dataset.objectAddSubcategory = subcategory;
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "object-add-subcategory-trigger glass-menu-item";
      trigger.textContent = subcategory;
      trigger.setAttribute("aria-haspopup", "true");
      trigger.setAttribute("aria-expanded", "false");
      const nested = document.createElement("div");
      nested.className = "object-add-submenu object-add-chart-submenu glass-submenu-panel floating-glass-menu";
      nested.setAttribute("role", "menu");
      subcategoryItems.forEach((item) => nested.appendChild(createObjectAddAction(item, layoutKey)));
      group.append(trigger, nested);
      submenu.appendChild(group);
    });
    return submenu;
  };
  const setObjectAddSubmenuOpen = (group, open) => {
    if (!group) return;
    group.classList.toggle("is-open", Boolean(open));
    group.closest(".panel-add-menu")?.classList.toggle("submenu-active", Boolean(open || group.closest(".panel-add-menu")?.querySelector(".object-add-category.is-open, .object-add-subcategory.is-open")));
    group.querySelector(":scope > .object-add-category-trigger, :scope > .object-add-subcategory-trigger")
      ?.setAttribute("aria-expanded", String(Boolean(open)));
  };
  const updateObjectAddSubmenuPlacement = (group) => {
    const submenu = group?.querySelector?.(":scope > .object-add-submenu");
    if (!submenu) return;
    submenu.classList.remove("submenu-opens-left", "submenu-pin-bottom");
    submenu.style.removeProperty("--glass-submenu-max-height");
    const rect = submenu.getBoundingClientRect();
    const viewportPadding = 12;
    if (rect.right > window.innerWidth - viewportPadding) {
      submenu.classList.add("submenu-opens-left");
    }
    const nextRect = submenu.getBoundingClientRect();
    if (nextRect.bottom > window.innerHeight - viewportPadding) {
      submenu.classList.add("submenu-pin-bottom");
      submenu.style.setProperty("--glass-submenu-max-height", `${Math.max(120, window.innerHeight - viewportPadding - Math.max(viewportPadding, nextRect.top))}px`);
    }
  };
  const closeObjectAddSubmenus = (menu) => {
    if (!menu) return;
    const activeGroups = menu.querySelectorAll(".object-add-category.is-open, .object-add-subcategory.is-open");
    activeGroups.forEach((group) => setObjectAddSubmenuOpen(group, false));
  };
  const openObjectAddSubmenuBranch = (group) => {
    if (!group) return;
    group.parentElement?.querySelectorAll?.(":scope > .object-add-category.is-open, :scope > .object-add-subcategory.is-open")
      .forEach((openGroup) => {
        if (openGroup !== group) setObjectAddSubmenuOpen(openGroup, false);
      });
    setObjectAddSubmenuOpen(group, true);
    updateObjectAddSubmenuPlacement(group);
    window.requestAnimationFrame(() => updateObjectAddSubmenuPlacement(group));
  };
  const renderObjectAddMenus = () => {
    document.querySelectorAll(".panel-add-menu.menu-portaled").forEach((menu) => restoreFloatingMenu(menu));
    document.querySelectorAll(".panel-add-picker").forEach((picker) => {
      const layoutKey = picker.dataset.layoutTarget || "default";
      const browser = picker.querySelector(".object-add-browser");
      if (!browser) return;
      browser.replaceChildren();
      const availableItems = objectAddItems.filter((item) => (
        !item.backendOnly &&
        !objectAddItemRuntimeDefinition(item)?.backendOnly &&
        objectAddItemLayer(item) !== "backend"
      ));
      objectAddCategories.forEach((category) => {
        const items = availableItems.filter((item) => item.category === category.id);
        if (!items.length) return;
        const group = document.createElement("div");
        group.className = "object-add-category";
        group.dataset.objectMenuCategory = category.id;
        const trigger = document.createElement("button");
        trigger.type = "button";
        trigger.className = "object-add-category-trigger glass-menu-item";
        trigger.textContent = category.label;
        trigger.setAttribute("aria-haspopup", "true");
        trigger.setAttribute("aria-expanded", "false");
        group.append(trigger, createObjectAddSubmenu(items, layoutKey));
        browser.appendChild(group);
      });
      suppressObjectAddBrowserTitles(browser);
    });
  };
  renderObjectAddMenus();
  
  document.querySelectorAll(".panel-add-picker").forEach((picker) => {
    const trigger = picker.querySelector(".panel-add-button");
    const menu = picker.querySelector(".panel-add-menu");
    let closeTimer;
    let clickOpened = false;
    const syncMenuViewportSize = () => {
      if (!menu) return;
      const triggerRect = trigger?.getBoundingClientRect?.();
      const menuTop = triggerRect ? triggerRect.bottom + 8 : menu.getBoundingClientRect().top;
      const availableHeight = Math.max(160, Math.floor(window.innerHeight - menuTop - 12));
      menu.style.setProperty("--panel-add-menu-max-height", `${availableHeight}px`);
      const menuStyles = getComputedStyle(menu);
      const verticalPadding =
        (parseFloat(menuStyles.paddingTop) || 0) +
        (parseFloat(menuStyles.paddingBottom) || 0);
      const browserMaxHeight = Math.max(96, availableHeight - verticalPadding);
      menu.style.setProperty("--object-add-browser-max-height", `${browserMaxHeight}px`);
      const browser = menu.querySelector(".object-add-browser");
      menu.classList.toggle("menu-scroll", Boolean(browser && browser.scrollHeight > browserMaxHeight + 1));
    };
    const openMenu = () => {
      closeObjectAddSubmenus(menu);
      window.clearTimeout(closeTimer);
      syncMenuViewportSize();
      portalFloatingMenu(menu, trigger, { align: "left", offset: 8 });
      if (!menu?.classList.contains("open")) {
        menu?.classList.remove("open");
        void menu?.offsetHeight;
        window.requestAnimationFrame(() => {
          menu?.classList.add("open");
          requestAnimationFrame(() => {
            syncMenuViewportSize();
            positionPortaledMenu(menu, trigger, { align: "left", offset: 8 });
          });
        });
      }
      trigger?.setAttribute("aria-expanded", "true");
    };
    const scheduleClose = () => {
      if (clickOpened) return;
      window.clearTimeout(closeTimer);
      closeTimer = window.setTimeout(() => {
        closeMenu();
      }, 140);
    };
    const closeMenu = () => {
      clickOpened = false;
      window.clearTimeout(closeTimer);
      closeObjectAddSubmenus(menu);
      menu?.classList.remove("open");
      menu?.classList.remove("menu-scroll");
      menu?.classList.remove("submenu-active");
      const restoreAfterAnimation = () => {
        if (menu?.classList?.contains("open")) return;
        restoreFloatingMenu(menu);
      };
      if (menu?.classList.contains("menu-portaled")) {
        const duration = parseFloat(getComputedStyle(menu).transitionDuration || "0");
        if (duration > 0) {
          menu?.addEventListener("transitionend", restoreAfterAnimation, { once: true });
          return;
        }
      }
      restoreFloatingMenu(menu);
      trigger?.setAttribute("aria-expanded", "false");
    };
    window.addEventListener("resize", () => {
      if (menu?.classList.contains("open")) syncMenuViewportSize();
    });
    picker.addEventListener("mouseenter", openMenu);
    picker.addEventListener("mouseleave", scheduleClose);
    menu?.addEventListener("mouseenter", openMenu);
    menu?.addEventListener("mouseleave", scheduleClose);
    trigger?.addEventListener("focus", openMenu);
    trigger?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      clickOpened = true;
      openMenu();
    });
    document.addEventListener("pointerdown", (event) => {
      if (!clickOpened) return;
      if (picker.contains(event.target) || menu?.contains(event.target)) return;
      closeMenu();
    }, true);
    menu?.addEventListener("pointerenter", (event) => {
      suppressObjectAddBrowserTitles(menu);
      const group = event.target?.closest?.(".object-add-category, .object-add-subcategory");
      if (!group || !menu.contains(group)) return;
      openObjectAddSubmenuBranch(group);
    }, true);
    menu?.addEventListener("focusin", (event) => {
      const group = event.target?.closest?.(".object-add-category, .object-add-subcategory");
      if (!group || !menu.contains(group)) return;
      openObjectAddSubmenuBranch(group);
    });
    menu?.addEventListener("click", (event) => {
      const triggerButton = event.target?.closest?.(".object-add-category-trigger, .object-add-subcategory-trigger");
      if (!triggerButton || !menu.contains(triggerButton)) return;
      event.preventDefault();
      event.stopPropagation();
      const group = triggerButton.closest(".object-add-category, .object-add-subcategory");
      const willOpen = !group.classList.contains("is-open");
      if (willOpen) {
        openObjectAddSubmenuBranch(group);
      } else {
        setObjectAddSubmenuOpen(group, false);
      }
    });
    document.addEventListener("pointerdown", (event) => {
      if (picker.contains(event.target) || menu?.contains(event.target)) return;
      closeMenu();
    }, true);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });
  });
  
  const closeObjectAddMenu = (button) => {
    const menu = button?.closest?.(".panel-add-menu");
    const picker = button?.closest?.(".panel-add-picker") || originalMenuParent(menu);
    const trigger = picker?.querySelector?.(".panel-add-button");
    const activeMenu = menu || picker?.querySelector?.(".panel-add-menu");
    closeObjectAddSubmenus(activeMenu);
    activeMenu?.classList.remove("open");
    activeMenu?.classList.remove("menu-scroll", "submenu-active");
    restoreFloatingMenu(activeMenu);
    trigger?.setAttribute("aria-expanded", "false");
  };
  
  const handlePanelAddAction = (button) => {
      closeObjectAddMenu(button);
      const layoutKey = button.dataset.layoutTarget || "default";
      const layout = document.querySelector(`.panel-layout[data-layout-key="${CSS.escape(layoutKey)}"]`);
      if (!layout) return;
      const selected = getActivePanelProfile(layoutKey);
      savePanelLayouts(layout, selected);
      syncDefaultDashboardGrid(layoutKey);
      layout.querySelectorAll(":scope > .db-panel").forEach(syncPanelMinimumWidth);
      const customCount = layout.querySelectorAll(':scope > .db-panel[data-custom-panel="true"]').length;
      const key = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const title = `Panel ${customCount + 1}`;
      const definition = {
        key,
        title,
        color: "",
        span: 1,
        workspaceObjectType: WORKSPACE_OBJECT_TYPES.panel,
        dashboardObjectKind: "panel",
        regionRole: "container",
      };
      const order = [...layout.querySelectorAll(":scope > .db-panel")].length;
      const panel = createCustomPanel(definition);
      panel.dataset.defaultOrder = String(order);
      panel.classList.add("db-panel-collapsed");
      panel.dataset.gridRowSpan = "1";
      applyPanelSpan(panel, 1);
      applyPanelColor(panel, null);
      applyPanelTitleColor(panel, "");
      const target = panelAddTarget(layout, panel);
      applyPanelGridPosition(panel, target.col, target.row);
      animatePanelReflow(layout, () => {
        layout.appendChild(panel);
        commitInsertedGridItemWithVerticalPushdown(layout, panel, target);
        syncWorkspaceRegions(layout);
      });
      layout.__initPanel?.(panel);
      savePanelLayouts(layout, selected);
      showToast(`${title} added.`, "info", {
        type: "object-created",
        source: "object-add",
        layoutKey,
        objectId: key,
        objectType: "panel",
        regionId: regionIdForWorkspaceItem(panel),
        payload: { title, cols: Number(panel.dataset.currentSpan) || 1, rows: Number(panel.dataset.gridRowSpan) || 1 },
      });
  };
  
  const handleDividerAddAction = (button) => {
      closeObjectAddMenu(button);
      const layoutKey = button.dataset.layoutTarget || "default";
      const layout = document.querySelector(`.panel-layout[data-layout-key="${CSS.escape(layoutKey)}"]`);
      if (!layout) return;
      const selected = getActivePanelProfile(layoutKey);
      savePanelLayouts(layout, selected);
      syncDefaultDashboardGrid(layoutKey);
      const key = `divider-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const customCount = layout.querySelectorAll(':scope > .db-panel[data-workspace-object-type="divider"]').length;
      const definition = {
        key,
        title: `Divider ${customCount + 1}`,
        color: "",
        span: 6,
        minW: 2,
        workspaceObjectType: WORKSPACE_OBJECT_TYPES.divider,
        dashboardObjectKind: "divider",
        regionRole: "boundary",
        navigationTargetType: "workspace-region",
      };
      const divider = createCustomPanel(definition);
      ensureWorkspaceObjectMetadata(divider, {
        ...definition,
        dashboardObjectKind: button.dataset.dividerKind || "divider",
      });
      divider.dataset.defaultOrder = String([...layout.querySelectorAll(":scope > .db-panel")].length);
      divider.classList.add("db-panel-collapsed", "dashboard-divider-placeholder");
      divider.dataset.gridRowSpan = "1";
      applyPanelSpan(divider, 6);
      applyPanelColor(divider, null);
      applyPanelTitleColor(divider, "");
      const target = panelAddTarget(layout, divider);
      applyPanelGridPosition(divider, target.col, target.row);
      animatePanelReflow(layout, () => {
        layout.appendChild(divider);
        commitInsertedGridItemWithVerticalPushdown(layout, divider, target);
        syncWorkspaceRegions(layout);
      });
      layout.__initPanel?.(divider);
      savePanelLayouts(layout, selected);
      showToast(`${definition.title} added.`, "info", {
        type: "object-created",
        source: "object-add",
        layoutKey,
        objectId: key,
        objectType: "divider",
        regionId: regionIdForWorkspaceItem(divider),
        payload: { title: definition.title, dividerKind: button.dataset.dividerKind || "divider" },
      });
  };
  
  const handleWidgetAddAction = (button) => {
      closeObjectAddMenu(button);
      const layoutKey = button.dataset.widgetTarget || "default";
      const layout = document.querySelector(`.widget-layout[data-widget-layout-key="${CSS.escape(layoutKey)}"]`);
      const kind = button.dataset.widgetCreateKind || button.dataset.widgetKind || "widget";
      if (!layout) return;
      const selected = getActivePanelProfile(layoutKey);
      saveWidgetLayouts(layout, selected);
      const key = `widget-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const runtimeDefinition = widgetDefinitionFor(kind);
      const customCount = layout.querySelectorAll(':scope > .widget-card[data-custom-widget="true"]').length;
      const runtimeDefaults = typeof runtimeDefinition.getDefaultConfig === "function" ? runtimeDefinition.getDefaultConfig() : {};
      const runtimeConfigOverrides = parseJsonRecord(button.dataset.widgetConfig, {});
      const objectName = button.dataset.objectDisplayName || (kind === "graph" ? "Graph" : (runtimeDefinition.displayName || "Widget"));
      const widgetConfig = { ...runtimeDefaults, ...runtimeConfigOverrides };
      const title = widgetConfig.title || `${objectName} ${customCount + 1}`;
      const definition = {
        key,
        title,
        value: widgetConfig.value,
        color: "",
        span: runtimeDefinition.defaultSize?.cols || 1,
        rowSpan: runtimeDefinition.defaultSize?.rows || 1,
        minW: runtimeDefinition.minSize?.cols || 1,
        minH: runtimeDefinition.minSize?.rows || null,
        type: runtimeDefinition.widgetType || runtimeDefinition.type,
        runtimeType: runtimeDefinition.type,
        widgetLayer: button.dataset.widgetLayer || runtimeDefinition.layer || "presentation",
        workspaceObjectType: WORKSPACE_OBJECT_TYPES.widget,
        dashboardObjectKind: runtimeDefinition.dashboardObjectKind || runtimeDefinition.type,
        regionRole: runtimeDefinition.regionRole || "content",
        config: JSON.stringify(widgetConfig),
      };
      const widget = createCustomWidget(definition);
      ensureWidgetTools(widget, "");
      applyWidgetSpan(widget, definition.span);
      applyPanelColor(widget, null);
      applyPanelTitleColor(widget, "");
      const target = visibleRegionInsertionTarget(layout, widget);
      if (target) applyWidgetGridPosition(widget, target.col, target.row, definition.rowSpan);
      animateWidgetReflow(layout, () => {
        layout.appendChild(widget);
        if (target) commitInsertedGridItemWithVerticalPushdown(layout, widget, target);
        syncWorkspaceRegions(layout);
      });
      layout.__initWidget?.(widget);
      bindDashboardKeywordForms(widget);
      refreshWidgetDisplayState(layoutKey, selected);
      saveWidgetLayouts(layout, selected);
      showToast(`${objectName || title} added.`, "info", {
        type: "object-created",
        source: "object-add",
        layoutKey,
        objectId: key,
        objectType: "widget",
        regionId: regionIdForWorkspaceItem(widget),
        payload: {
          title,
          widgetType: runtimeDefinition.type,
          cols: Number(widget.dataset.currentSpan) || definition.span,
          rows: Number(widget.dataset.gridRowSpan) || definition.rowSpan,
        },
      });
  };

  const handleTabAddAction = (button) => {
      closeObjectAddMenu(button);
      if (!workspaceTabsRuntime?.createTab) return;
      const before = workspaceTabsRuntime.getState?.();
      workspaceTabsRuntime.createTab();
      const after = workspaceTabsRuntime.getState?.();
      const tab = after?.tabs?.[after.activeIndex];
      showToast(`${tab?.label || "Tab"} added.`, "info", {
        type: "object-created",
        source: "object-add",
        layoutKey: button.dataset.layoutTarget || "default",
        objectId: tab?.id || null,
        objectType: "tab",
        payload: {
          previousIndex: before?.activeIndex ?? null,
          activeIndex: after?.activeIndex ?? null,
        },
      });
  };
  
  document.addEventListener("click", (event) => {
    const button = event.target?.closest?.(".panel-add-action, .divider-add-action, .widget-add-action, .tab-add-action");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    if (button.classList.contains("panel-add-action")) {
      handlePanelAddAction(button);
    } else if (button.classList.contains("divider-add-action")) {
      handleDividerAddAction(button);
    } else if (button.classList.contains("tab-add-action")) {
      handleTabAddAction(button);
    } else {
      handleWidgetAddAction(button);
    }
  });
  
  return {
    renderObjectAddMenus,
    closeObjectAddMenu,
    handlePanelAddAction,
    handleDividerAddAction,
    handleWidgetAddAction,
    handleTabAddAction,
  };
}
