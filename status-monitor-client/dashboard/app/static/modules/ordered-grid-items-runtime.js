export const createOrderedGridItemsRuntime = ({
  gridHostForLayout,
  isPanelInternalGridItem,
}) => {
  const orderedGridSelectorForLayout = (layout, includePlaceholders = false) => {
    if (layout.classList.contains("widget-layout") || layout.classList.contains("panel-internal-widget-grid")) {
      return includePlaceholders
        ? ":scope > .widget-card:not([hidden]), :scope > .widget-placeholder"
        : ":scope > .widget-card:not([hidden])";
    }
    return includePlaceholders
      ? ":scope > .db-panel:not([hidden]), :scope > .db-panel-placeholder"
      : ":scope > .db-panel:not([hidden])";
  };

  const orderedGridItems = (layout, { includePlaceholders = false, exclude = [] } = {}) => {
    const excluded = new Set([].concat(exclude || []).filter(Boolean));
    return [...layout.querySelectorAll(orderedGridSelectorForLayout(layout, includePlaceholders))]
      .filter((item) => !excluded.has(item));
  };

  const globalGridItems = (layout, { includePlaceholders = false, exclude = [] } = {}) => {
    const host = gridHostForLayout(layout);
    const excluded = new Set([].concat(exclude || []).filter(Boolean));
    // Panel-internal grids must match too — without them, collision commits
    // inside a panel saw an empty grid and dropped widgets on top of each
    // other (the filter below still keeps internal items out of workspace
    // queries, where host !== layout).
    const selector = includePlaceholders
      ? ".widget-layout > .widget-card:not([hidden]), .widget-layout > .widget-placeholder, .panel-internal-widget-grid > .widget-card:not([hidden]), .panel-internal-widget-grid > .widget-placeholder, .panel-layout > .db-panel:not([hidden]), .panel-layout > .db-panel-placeholder"
      : ".widget-layout > .widget-card:not([hidden]), .panel-internal-widget-grid > .widget-card:not([hidden]), .panel-layout > .db-panel:not([hidden])";
    return [...host.querySelectorAll(selector)]
      .filter((item) => !excluded.has(item) && (host === layout || !isPanelInternalGridItem(item)) && !item.classList.contains("widget-dragging") && !item.classList.contains("db-panel-dragging") && !item.classList.contains("dashboard-live-resize") && !item.classList.contains("dashboard-resize-source") && !item.classList.contains("dashboard-group-source") && !item.classList.contains("dashboard-group-member-preview"));
  };

  return Object.freeze({
    globalGridItems,
    orderedGridItems,
    orderedGridSelectorForLayout,
  });
};
