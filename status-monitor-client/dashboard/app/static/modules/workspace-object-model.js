export const createWorkspaceObjectModel = ({
  groupItemLayoutKey,
}) => {
  const WORKSPACE_OBJECT_TYPES = Object.freeze({
    widget: "widget",
    panel: "panel",
    divider: "divider",
  });

  const WORKSPACE_OBJECT_CAPABILITIES = Object.freeze({
    [WORKSPACE_OBJECT_TYPES.widget]: Object.freeze({
      canExpand: false,
      isOpenable: false,
      hasExpandedFootprint: false,
      participatesInGridCollision: true,
      hasPanelContentArea: false,
      usesPanelHeader: false,
      usesDividerSurface: false,
    }),
    [WORKSPACE_OBJECT_TYPES.panel]: Object.freeze({
      canExpand: true,
      isOpenable: true,
      hasExpandedFootprint: true,
      participatesInGridCollision: true,
      hasPanelContentArea: true,
      usesPanelHeader: true,
      usesDividerSurface: false,
    }),
    [WORKSPACE_OBJECT_TYPES.divider]: Object.freeze({
      canExpand: false,
      isOpenable: false,
      hasExpandedFootprint: false,
      participatesInGridCollision: true,
      hasPanelContentArea: false,
      usesPanelHeader: true,
      usesDividerSurface: true,
    }),
  });

  const WORKSPACE_REGION_MODEL_VERSION = "workspace-region-v1";

  const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));

  const workspaceObjectTypeFromDefinition = (definition, fallback) => {
    const rawType = definition?.workspaceObjectType || definition?.objectType || definition?.type || definition?.dashboardObjectKind || fallback;
    if (rawType === "divider" || rawType === "region-divider") return WORKSPACE_OBJECT_TYPES.divider;
    if (rawType === "panel") return WORKSPACE_OBJECT_TYPES.panel;
    return fallback || WORKSPACE_OBJECT_TYPES.widget;
  };

  const workspaceObjectType = (item) => {
    const rawType = item?.dataset?.workspaceObjectType || item?.dataset?.dashboardObjectKind || item?.dataset?.widgetType;
    if (rawType === WORKSPACE_OBJECT_TYPES.divider || rawType === "region-divider") return WORKSPACE_OBJECT_TYPES.divider;
    if (item?.classList?.contains("db-panel")) return WORKSPACE_OBJECT_TYPES.panel;
    return WORKSPACE_OBJECT_TYPES.widget;
  };

  const workspaceObjectCapabilities = (item) => (
    WORKSPACE_OBJECT_CAPABILITIES[workspaceObjectType(item)] ||
    WORKSPACE_OBJECT_CAPABILITIES[WORKSPACE_OBJECT_TYPES.widget]
  );

  const syncWorkspaceCapabilityMetadata = (item) => {
    if (!item) return;
    Object.entries(workspaceObjectCapabilities(item)).forEach(([key, value]) => {
      item.dataset[key] = String(Boolean(value));
    });
  };

  const workspaceObjectKey = (item) => item?.dataset?.widgetKey || item?.dataset?.panelKey || "";

  const workspaceRootRegionId = (layoutKey) => `${layoutKey}:region:root`;

  const workspaceRegionIdForDivider = (divider, layoutKey) => {
    const key = workspaceObjectKey(divider) || "divider";
    const existing = divider.dataset.workspaceRegionId || "";
    if (existing && (layoutKey === "default" || !existing.startsWith("default:region:"))) return existing;
    return `${layoutKey}:region:${key}`;
  };

  const workspaceElementById = (id, layoutKey = "builder") => {
    const key = String(id || "");
    if (!key) return null;
    const escaped = CSS.escape(key);
    return document.querySelector(`.widget-layout[data-widget-layout-key="${CSS.escape(layoutKey)}"] .widget-card[data-widget-key="${escaped}"]`) ||
      document.querySelector(`.panel-layout[data-layout-key="${CSS.escape(layoutKey)}"] .panel-internal-widget-grid .widget-card[data-widget-key="${escaped}"]`) ||
      document.querySelector(`.panel-layout[data-layout-key="${CSS.escape(layoutKey)}"] .db-panel[data-panel-key="${escaped}"]`) ||
      document.querySelector(`.panel-layout[data-layout-key="${CSS.escape(layoutKey)}"] .db-panel[data-workspace-region-id="${escaped}"]`) ||
      null;
  };

  const ensureWorkspaceObjectMetadata = (item, metadata = {}) => {
    if (!item) return;
    const inferredType = metadata.workspaceObjectType || metadata.objectType || workspaceObjectType(item);
    item.dataset.workspaceObjectType = inferredType;
    item.dataset.workspaceRegionModel = WORKSPACE_REGION_MODEL_VERSION;
    if (metadata.dashboardObjectKind) item.dataset.dashboardObjectKind = metadata.dashboardObjectKind;
    if (metadata.workspaceRegionId) item.dataset.workspaceRegionId = metadata.workspaceRegionId;
    if (metadata.regionRole) item.dataset.regionRole = metadata.regionRole;
    if (metadata.navigationTargetType) item.dataset.navigationTargetType = metadata.navigationTargetType;
    if (metadata.navigationTargetId) item.dataset.navigationTargetId = metadata.navigationTargetId;
    if (inferredType === WORKSPACE_OBJECT_TYPES.divider) {
      item.dataset.dashboardObjectKind = metadata.dashboardObjectKind || "divider";
      item.dataset.regionRole = metadata.regionRole || "boundary";
      item.dataset.workspaceRegionId = metadata.workspaceRegionId || workspaceRegionIdForDivider(item, groupItemLayoutKey(item));
    } else if (inferredType === WORKSPACE_OBJECT_TYPES.panel) {
      item.dataset.dashboardObjectKind = metadata.dashboardObjectKind || item.dataset.dashboardObjectKind || "panel";
      item.dataset.regionRole = metadata.regionRole || item.dataset.regionRole || "container";
    } else {
      item.dataset.dashboardObjectKind = metadata.dashboardObjectKind || item.dataset.dashboardObjectKind || "widget";
      item.dataset.regionRole = metadata.regionRole || item.dataset.regionRole || "content";
    }
    syncWorkspaceCapabilityMetadata(item);
  };

  const workspaceObjectPersistence = (item) => ({
    workspaceObjectType: workspaceObjectType(item),
    dashboardObjectKind: item.dataset.dashboardObjectKind || null,
    workspaceRegionId: item.dataset.workspaceRegionId || null,
    regionRole: item.dataset.regionRole || null,
    navigationTargetType: item.dataset.navigationTargetType || null,
    navigationTargetId: item.dataset.navigationTargetId || null,
  });

  return {
    WORKSPACE_OBJECT_TYPES,
    WORKSPACE_OBJECT_CAPABILITIES,
    WORKSPACE_REGION_MODEL_VERSION,
    escapeHtml,
    workspaceObjectTypeFromDefinition,
    workspaceObjectType,
    workspaceObjectCapabilities,
    syncWorkspaceCapabilityMetadata,
    workspaceObjectKey,
    workspaceRootRegionId,
    workspaceRegionIdForDivider,
    workspaceElementById,
    ensureWorkspaceObjectMetadata,
    workspaceObjectPersistence,
  };
};
