export const seedInitialLayoutHistory = ({
  pushLiveLayoutUndo,
}) => {
  [...new Set([
    ...[...document.querySelectorAll(".panel-layout")].map((layout) => layout.dataset.layoutKey || "default"),
    ...[...document.querySelectorAll(".widget-layout")].map((layout) => layout.dataset.widgetLayoutKey || "default"),
  ])].forEach((layoutKey) => pushLiveLayoutUndo(layoutKey));
};
