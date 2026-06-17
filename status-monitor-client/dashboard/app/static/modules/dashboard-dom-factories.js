export const createDashboardDomFactories = ({
  workspaceObjectTypeFromDefinition,
  WORKSPACE_OBJECT_TYPES,
  escapeHtml,
  ensureWorkspaceObjectMetadata,
  panelToolButtonsMarkup,
}) => {
  const createCustomPanel = (definition) => {
    const objectType = workspaceObjectTypeFromDefinition(definition, WORKSPACE_OBJECT_TYPES.panel);
    const isDivider = objectType === WORKSPACE_OBJECT_TYPES.divider;
    const safeTitle = escapeHtml(definition.title || (isDivider ? "Divider" : "Panel"));
    const panel = document.createElement("section");
    panel.className = isDivider
      ? "db-panel db-panel-empty-custom db-panel-collapsed workspace-divider"
      : "db-panel db-panel-empty-custom";
    panel.dataset.panelKey = definition.key;
    panel.dataset.defaultSpan = String(definition.span || 4);
    if (definition.gridCol) panel.dataset.gridCol = String(definition.gridCol);
    if (definition.gridRow) panel.dataset.gridRow = String(definition.gridRow);
    if (definition.minW) panel.dataset.minW = String(definition.minW);
    if (definition.locked) panel.dataset.locked = "true";
    if (definition.resizable === false) panel.dataset.resizable = "false";
    panel.dataset.customPanel = "true";
    panel.dataset.defaultTitle = definition.title || (isDivider ? "Divider" : "Panel");
    ensureWorkspaceObjectMetadata(panel, {
      ...definition,
      workspaceObjectType: objectType,
      dashboardObjectKind: definition.dashboardObjectKind || (isDivider ? "divider" : "panel"),
      regionRole: definition.regionRole || (isDivider ? "boundary" : "container"),
    });
    const headerMarkup = isDivider ? `
      <div class="db-panel-hd db-panel-hd-items workspace-divider-surface">
        <span class="db-panel-title">${safeTitle}</span>
        <span class="db-panel-count">Region</span>
        <div class="panel-tools">
          <div class="panel-tool-drawer" aria-label="Panel tools">
            ${panelToolButtonsMarkup(definition.color || "", true)}
          </div>
        </div>
      </div>
      <div class="db-panel-body workspace-divider-body" hidden></div>` : `
      <div class="db-panel-hd db-panel-hd-items">
        <span class="db-panel-title">${safeTitle}</span>
        <span class="db-panel-count">0</span>
        <div class="panel-tools">
          <div class="panel-tool-drawer" aria-label="Panel tools">
            ${panelToolButtonsMarkup(definition.color || "#ffffff", true)}
          </div>
        </div>
      </div>
      <div class="db-panel-body">
        <div class="empty-state panel-empty-state" data-panel-placeholder="empty">
          <strong>Empty panel</strong>
          <small>Drop widgets here</small>
          <span class="panel-empty-action" aria-hidden="true">Add widgets</span>
        </div>
      </div>`;
    panel.innerHTML = headerMarkup;
    return panel;
  };

  const createPanelRowBreak = () => {
    const rowBreak = document.createElement("div");
    rowBreak.className = "db-panel-row-break";
    rowBreak.setAttribute("aria-hidden", "true");
    return rowBreak;
  };

  const createWidgetRowBreak = () => {
    const rowBreak = document.createElement("div");
    rowBreak.className = "widget-row-break";
    rowBreak.setAttribute("aria-hidden", "true");
    return rowBreak;
  };

  const applyWidgetSpacerSpan = (spacer, span) => {
    const safeSpan = Math.max(1, Math.min(6, Number(span) || 1));
    const displaySpan = Math.round(safeSpan);
    spacer.dataset.widgetSpacerSpan = String(displaySpan);
    spacer.style.gridColumn = `span ${displaySpan}`;
  };

  const createWidgetSpacer = (span = 3) => {
    const spacer = document.createElement("div");
    spacer.className = "widget-spacer";
    spacer.setAttribute("aria-hidden", "true");
    applyWidgetSpacerSpan(spacer, span);
    return spacer;
  };

  const cleanupPanelRowBreaks = (layout) => {
    [...layout.querySelectorAll(":scope > .db-panel-row-break")].forEach((rowBreak) => {
      const prev = rowBreak.previousElementSibling;
      const next = rowBreak.nextElementSibling;
      if (!prev || !next || next.classList.contains("db-panel-row-break")) rowBreak.remove();
    });
  };

  const cleanupWidgetRowBreaks = (layout) => {
    [...layout.querySelectorAll(":scope > .widget-row-break")].forEach((rowBreak) => {
      const prev = rowBreak.previousElementSibling;
      const next = rowBreak.nextElementSibling;
      if (!prev || !next || next.classList.contains("widget-row-break")) rowBreak.remove();
    });
    [...layout.querySelectorAll(":scope > .widget-spacer")].forEach((spacer) => {
      const next = spacer.nextElementSibling;
      const prev = spacer.previousElementSibling;
      if (!next || next.classList.contains("widget-row-break") || !prev?.classList.contains("widget-row-break") && !prev?.classList.contains("widget-spacer")) {
        spacer.remove();
      }
    });
    [...layout.querySelectorAll(":scope > .widget-row-break")].forEach((rowBreak) => {
      const prev = rowBreak.previousElementSibling;
      const next = rowBreak.nextElementSibling;
      if (!prev || !next || next.classList.contains("widget-row-break")) rowBreak.remove();
    });
  };

  return {
    createCustomPanel,
    createPanelRowBreak,
    createWidgetRowBreak,
    createWidgetSpacer,
    cleanupPanelRowBreaks,
    cleanupWidgetRowBreaks,
  };
};
