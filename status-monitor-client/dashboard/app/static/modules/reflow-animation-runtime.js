const animateGridReflow = ({
  layout,
  update,
  excludeItem = null,
  gridHostForLayout,
  isPanelInternalGridItem,
  selectorForLayout,
  draggingClasses,
}) => {
  const host = gridHostForLayout(layout);
  const selector = selectorForLayout(host, layout);
  const items = [...host.querySelectorAll(selector)]
    .filter((item) => (
      item !== excludeItem &&
      (host === layout || !isPanelInternalGridItem(item)) &&
      !draggingClasses.some((className) => item.classList.contains(className))
    ));
  const before = new Map(items.map((item) => [item, item.getBoundingClientRect()]));
  update();
  const afterItems = [...host.querySelectorAll(selector)]
    .filter((item) => (
      item !== excludeItem &&
      (host === layout || !isPanelInternalGridItem(item)) &&
      !draggingClasses.some((className) => item.classList.contains(className))
    ));
  afterItems.forEach((item) => {
    const first = before.get(item);
    if (!first) return;
    const last = item.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    item.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: "translate(0, 0)" },
      ],
      {
        duration: 180,
        easing: "cubic-bezier(.2, .8, .2, 1)",
      }
    );
  });
};

export const createReflowAnimationRuntime = ({
  gridHostForLayout,
  isPanelInternalGridItem,
}) => {
  const animatePanelReflow = (layout, update, excludeItem = null) => {
    animateGridReflow({
      layout,
      update,
      excludeItem,
      gridHostForLayout,
      isPanelInternalGridItem,
      draggingClasses: ["db-panel-dragging", "widget-dragging"],
      selectorForLayout: (host, sourceLayout) => host !== sourceLayout
        ? ".panel-layout > .db-panel, .panel-layout > .db-panel-placeholder, .widget-layout > .widget-card, .widget-layout > .widget-placeholder"
        : ":scope > .db-panel, :scope > .db-panel-placeholder",
    });
  };

  const animateWidgetReflow = (layout, update, excludeItem = null) => {
    animateGridReflow({
      layout,
      update,
      excludeItem,
      gridHostForLayout,
      isPanelInternalGridItem,
      draggingClasses: ["widget-dragging", "db-panel-dragging"],
      selectorForLayout: (host, sourceLayout) => host !== sourceLayout
        ? ".widget-layout > .widget-card, .widget-layout > .widget-placeholder, .widget-layout > .widget-spacer, .panel-layout > .db-panel, .panel-layout > .db-panel-placeholder"
        : ":scope > .widget-card, :scope > .widget-placeholder, :scope > .widget-spacer",
    });
  };

  return {
    animatePanelReflow,
    animateWidgetReflow,
  };
};
