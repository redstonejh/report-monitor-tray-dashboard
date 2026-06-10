export const createGroupSelectionRuntime = () => {
  const groupSelection = new Set();
  const groupSelectedIds = new Set();
  const groupItemKind = (item) => item?.classList?.contains("widget-card") ? "widget" : "panel";
  const groupItemLayout = (item) => item?.closest?.(".widget-layout, .panel-layout");
  const groupItemLayoutKey = (item) => {
    const layout = groupItemLayout(item);
    return layout?.dataset.widgetLayoutKey || layout?.dataset.layoutKey || "default";
  };
  const groupItemId = (item) => {
    if (!item) return "";
    const key = groupItemKind(item) === "widget" ? item.dataset.widgetKey : item.dataset.panelKey;
    return key ? `${groupItemKind(item)}:${groupItemLayoutKey(item)}:${key}` : "";
  };
  const selectedGroupItems = (kind, layoutKey) => [...groupSelection].filter((item) => {
    if (!item?.isConnected || item.hidden) return false;
    if (kind && groupItemKind(item) !== kind) return false;
    if (layoutKey && groupItemLayoutKey(item) !== layoutKey) return false;
    return true;
  });
  const setGroupItemSelected = (item, selected) => {
    const id = groupItemId(item);
    if (!id) return;
    item.classList.toggle("group-selected", selected);
    item.setAttribute("aria-selected", selected.toString());
    if (selected) {
      groupSelection.add(item);
      groupSelectedIds.add(id);
    } else {
      groupSelection.delete(item);
      groupSelectedIds.delete(id);
    }
    syncGroupSelectionState();
  };
  const restoreGroupSelection = () => {
    groupSelection.clear();
    document.querySelectorAll(".widget-layout > .widget-card, .panel-layout > .db-panel").forEach((item) => {
      const selected = groupSelectedIds.has(groupItemId(item));
      item.classList.toggle("group-selected", selected);
      if (selected) {
        item.setAttribute("aria-selected", "true");
        groupSelection.add(item);
      } else if (!item.classList.contains("active")) {
        item.removeAttribute("aria-selected");
      }
    });
  };
  const clearGroupSelection = () => {
    groupSelection.forEach((item) => {
      item.classList.remove("group-selected");
      if (!item.classList.contains("active")) item.removeAttribute("aria-selected");
    });
    groupSelection.clear();
    groupSelectedIds.clear();
    syncGroupSelectionState();
  };
  const syncGroupSelectionState = () => {
    document.body.classList.toggle("group-select-active", groupSelectedIds.size > 0);
  };
  const toggleGroupItem = (item) => {
    if (!item) return;
    setGroupItemSelected(item, !groupSelectedIds.has(groupItemId(item)));
  };
  const groupPeers = (source, kind = groupItemKind(source)) => {
    if (!source?.classList?.contains("group-selected")) return [];
    const layoutKey = groupItemLayoutKey(source);
    return selectedGroupItems(kind, layoutKey).filter((item) => item !== source);
  };
  const groupTransformItems = (source, options = {}) => {
    if (!source?.classList?.contains("group-selected")) return [source].filter(Boolean);
    const layoutKey = groupItemLayoutKey(source);
    const includePinned = Boolean(options.includePinned);
    const includeLocked = Boolean(options.includeLocked);
    return selectedGroupItems(null, layoutKey)
      .filter((item) => item?.isConnected && !item.hidden)
      .filter((item) => includePinned || !item.classList.contains("db-panel-pinned"))
      .filter((item) => includeLocked || item.dataset.locked !== "true");
  };

  return {
    clearGroupSelection,
    groupItemId,
    groupItemKind,
    groupItemLayout,
    groupItemLayoutKey,
    groupPeers,
    groupSelectedIds,
    groupSelection,
    groupTransformItems,
    restoreGroupSelection,
    selectedGroupItems,
    setGroupItemSelected,
    toggleGroupItem,
  };
};

export const initializeGroupSelectionControls = ({
  toggleGroupItem,
}) => {
  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !event.ctrlKey) return;
    if (event.target?.closest?.(".app-nav, .workspace-menu-overlay-layer, .panel-tools, .widget-tools, .panel-color-menu, .panel-add-menu, .nav-status-popover")) return;
    if (event.target?.closest?.("button, a, input, select, textarea, [contenteditable='true'], [role='textbox']")) return;
    const item = event.target?.closest?.(".widget-layout > .widget-card, .panel-internal-widget-grid > .widget-card, .panel-layout > .db-panel");
    if (!item) return;
    event.preventDefault();
    event.stopPropagation();
    toggleGroupItem(item);
  }, true);
};
