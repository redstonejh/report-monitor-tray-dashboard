(() => {
  const PERSISTED_WORKSPACE_VERSION = 1;
  const prefixes = Object.freeze({
    panelStorage: "dashboard-panel-six-grid-layout:",
    panelProfile: "dashboard-panel-profile:",
    customPanels: "dashboard-custom-panels:",
    hiddenPanels: "dashboard-hidden-panels:",
    widgetStorage: "dashboard-widget-six-grid-layout:",
    customWidgets: "dashboard-custom-six-grid-widgets:",
    hiddenWidgets: "dashboard-hidden-six-grid-widgets:",
    workspaceAssets: "dashboard-assets:",
    persistedWorkspace: "dashboard-persisted-workspace:",
    layoutUndo: "dashboard-layout-undo:",
    layoutSource: "dashboard-layout-source:",
    generatedLayoutRegistry: "dashboard-generated-layout-sources:",
  });
  const transientClasses = Object.freeze([
    "active",
    "db-panel-dragging",
    "widget-dragging",
    "dashboard-active-resize",
    "dashboard-resize-source",
    "group-selected",
    "group-transform-member",
    "db-panel-tools-open",
    "widget-tools-open",
    "panel-header-entry-accept",
    "panel-boundary-exit-release",
    "panel-entry-ghost-transition",
    "panel-exit-ghost-transition",
    "widget-runtime-meaning",
  ]);
  const runtimeMeaningDatasetKeys = Object.freeze([
    "runtimeActivity",
    "runtimeCondition",
    "runtimeConfidence",
    "runtimeFreshness",
    "runtimeMeaningSummary",
    "runtimeUrgency",
  ]);
  let workspaceClipboard = null;
  const bridgeStorage = window.dashboardPersistence;
  const storage = {
    getItem(key) {
      if (bridgeStorage?.getItem) return bridgeStorage.getItem(key);
      return localStorage.getItem(key);
    },
    setItem(key, value) {
      if (bridgeStorage?.setItem) return bridgeStorage.setItem(key, value);
      return localStorage.setItem(key, value);
    },
    removeItem(key) {
      if (bridgeStorage?.removeItem) return bridgeStorage.removeItem(key);
      return localStorage.removeItem(key);
    },
    keys() {
      if (bridgeStorage?.keys) return bridgeStorage.keys();
      return Object.keys(localStorage);
    },
  };

  const WORKING_PROFILE = "0";
  const profileKey = (layoutKey = "builder") => `${prefixes.panelProfile}${layoutKey}`;
  const getActiveProfile = (layoutKey = "builder") => {
    return WORKING_PROFILE;
  };
  const setActiveProfile = (layoutKey = "builder", profile = "1") => {
    try {
      storage.setItem(profileKey(layoutKey), WORKING_PROFILE);
    } catch {}
  };
  const key = {
    panelStorage: (layoutKey, itemKey, profile = getActiveProfile(layoutKey)) => `${prefixes.panelStorage}${profile}:${layoutKey}:${itemKey}`,
    customPanels: (layoutKey, profile = getActiveProfile(layoutKey)) => `${prefixes.customPanels}${profile}:${layoutKey}`,
    hiddenPanels: (layoutKey, profile = getActiveProfile(layoutKey)) => `${prefixes.hiddenPanels}${profile}:${layoutKey}`,
    widgetStorage: (layoutKey, itemKey, profile = getActiveProfile(layoutKey)) => `${prefixes.widgetStorage}${profile}:${layoutKey}:${itemKey}`,
    customWidgets: (layoutKey, profile = getActiveProfile(layoutKey)) => `${prefixes.customWidgets}${profile}:${layoutKey}`,
    hiddenWidgets: (layoutKey, profile = getActiveProfile(layoutKey)) => `${prefixes.hiddenWidgets}${profile}:${layoutKey}`,
    workspaceAssets: (layoutKey, profile = getActiveProfile(layoutKey)) => `${prefixes.workspaceAssets}${profile}:${layoutKey}`,
    persistedWorkspace: (layoutKey, profile = getActiveProfile(layoutKey)) => `${prefixes.persistedWorkspace}${profile}:${layoutKey}`,
    layoutUndo: (layoutKey, profile = getActiveProfile(layoutKey)) => `${prefixes.layoutUndo}${profile}:${layoutKey}`,
    layoutSource: (layoutKey = "builder") => `${prefixes.layoutSource}${layoutKey}`,
    generatedLayoutRegistry: (layoutKey = "builder") => `${prefixes.generatedLayoutRegistry}${layoutKey}`,
  };
  const scopedPrefixes = (layoutKey, profile = getActiveProfile(layoutKey)) => [
    `${prefixes.panelStorage}${profile}:${layoutKey}:`,
    `${prefixes.customPanels}${profile}:${layoutKey}`,
    `${prefixes.hiddenPanels}${profile}:${layoutKey}`,
    `${prefixes.widgetStorage}${profile}:${layoutKey}:`,
    `${prefixes.customWidgets}${profile}:${layoutKey}`,
    `${prefixes.hiddenWidgets}${profile}:${layoutKey}`,
    `${prefixes.workspaceAssets}${profile}:${layoutKey}`,
    `${prefixes.persistedWorkspace}${profile}:${layoutKey}`,
  ];
  const storageKeys = (layoutKey, profile = getActiveProfile(layoutKey)) => {
    const matchers = scopedPrefixes(layoutKey, profile);
    try {
      return storage.keys().filter((candidate) => matchers.some((prefix) => candidate.startsWith(prefix)));
    } catch {
      return [];
    }
  };
  const clearScopedStorage = (layoutKey, profile = getActiveProfile(layoutKey)) => {
    storageKeys(layoutKey, profile).forEach((storageKey) => {
      try {
        storage.removeItem(storageKey);
      } catch {}
    });
  };
  const parseJsonRecord = (value, fallback = null) => {
    if (value == null || value === "") return fallback;
    if (typeof value === "object") return value;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  };
  const readJson = (storageKey, fallback) => {
    try {
      return JSON.parse(storage.getItem(storageKey) || JSON.stringify(fallback));
    } catch {
      return fallback;
    }
  };
  const writeJson = (storageKey, value) => {
    try {
      storage.setItem(storageKey, JSON.stringify(value));
    } catch {}
  };
  const readRaw = (storageKey, fallback = "") => {
    try {
      return storage.getItem(storageKey) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const writeRaw = (storageKey, value = "") => {
    try {
      storage.setItem(storageKey, String(value));
    } catch {}
  };
  const remove = (storageKey) => {
    try {
      storage.removeItem(storageKey);
    } catch {}
  };
  const readDraftList = (element, draftKey) => {
    try {
      return JSON.parse(element?.dataset?.[draftKey] || "[]");
    } catch {
      return [];
    }
  };
  const writeDraftList = (element, draftKey, values) => {
    if (!element) return;
    element.dataset[draftKey] = JSON.stringify([...new Set([].concat(values || []).filter(Boolean))]);
  };
  const sanitizeElementForPersistence = (element) => {
    const clone = element.cloneNode(true);
    clone.classList.remove(...transientClasses);
    runtimeMeaningDatasetKeys.forEach((datasetKey) => delete clone.dataset[datasetKey]);
    clone.removeAttribute("aria-selected");
    clone.style.removeProperty("left");
    clone.style.removeProperty("top");
    clone.style.removeProperty("width");
    clone.querySelectorAll(".panel-settings-toggle, .panel-color-toggle").forEach((button) => {
      button.setAttribute("aria-expanded", "false");
    });
    clone.querySelectorAll(".panel-color-menu-open").forEach((menu) => menu.classList.remove("panel-color-menu-open"));
    return clone;
  };
  const sanitizeHtml = (element) => sanitizeElementForPersistence(element).outerHTML;
  const serializeElement = (element, keyName) => ({
    key: element.dataset[keyName],
    html: sanitizeHtml(element),
    hidden: element.hidden,
  });
  const nextObjectId = (prefix = "object") => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  const SCOPABLE_PREFIXES = [
    "panelStorage", "customPanels", "hiddenPanels", "widgetStorage", "customWidgets",
    "hiddenWidgets", "workspaceAssets", "persistedWorkspace",
  ];
  const copyProfile = (layoutKey, fromProfile, toProfile) => {
    if (!fromProfile || !toProfile || fromProfile === toProfile) return;
    clearScopedStorage(layoutKey, toProfile);
    storageKeys(layoutKey, fromProfile).forEach((fromKey) => {
      for (const name of SCOPABLE_PREFIXES) {
        const globalPrefix = prefixes[name];
        const scopedFrom = `${globalPrefix}${fromProfile}:`;
        if (fromKey.startsWith(scopedFrom)) {
          const toKey = `${globalPrefix}${toProfile}:${fromKey.slice(scopedFrom.length)}`;
          try {
            const value = storage.getItem(fromKey);
            if (value !== null) storage.setItem(toKey, value);
          } catch {}
          break;
        }
      }
    });
  };

  const migrateActiveProfileToSingleState = (layoutKey = "builder") => {
    let previousProfile = WORKING_PROFILE;
    let usedLegacyLayoutSource = false;
    try {
      previousProfile = storage.getItem(profileKey(layoutKey)) || WORKING_PROFILE;
    } catch {}
    if (previousProfile === WORKING_PROFILE) {
      try {
        const source = parseJsonRecord(storage.getItem(key.layoutSource(layoutKey)), null);
        const sourceSlot = source?.kind === "saved" ? (source.slot || source.id || "") : "";
        if (/^[1-9][0-9]*$/.test(sourceSlot)) {
          previousProfile = sourceSlot;
          usedLegacyLayoutSource = true;
        }
      } catch {}
    }
    if (previousProfile !== WORKING_PROFILE && /^[1-9][0-9]*$/.test(previousProfile)) {
      copyProfile(layoutKey, previousProfile, WORKING_PROFILE);
    }
    if (usedLegacyLayoutSource) remove(key.layoutSource(layoutKey));
    setActiveProfile(layoutKey, WORKING_PROFILE);
    return WORKING_PROFILE;
  };

  window.dashboardLayoutPersistence = Object.freeze({
    version: PERSISTED_WORKSPACE_VERSION,
    WORKING_PROFILE,
    prefixes,
    transientClasses,
    runtimeMeaningDatasetKeys,
    getActiveProfile,
    setActiveProfile,
    copyProfile,
    migrateActiveProfileToSingleState,
    key,
    scopedPrefixes,
    storageKeys,
    clearScopedStorage,
    parseJsonRecord,
    readJson,
    writeJson,
    readRaw,
    writeRaw,
    remove,
    readDraftList,
    writeDraftList,
    sanitizeElementForPersistence,
    sanitizeHtml,
    serializeElement,
    nextObjectId,
    clipboard: {
      get: () => workspaceClipboard,
      set: (value) => {
        workspaceClipboard = value || null;
        return workspaceClipboard;
      },
      clear: () => {
        workspaceClipboard = null;
      },
    },
  });
})();
