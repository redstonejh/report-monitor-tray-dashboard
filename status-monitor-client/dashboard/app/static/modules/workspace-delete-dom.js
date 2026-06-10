export const getWorkspaceDeleteDialogElements = () => {
  const panelDeleteDialog = document.getElementById("panel-delete-dialog");
  return {
    panelDeleteCancel: panelDeleteDialog?.querySelector(".confirm-dialog-cancel"),
    panelDeleteClose: panelDeleteDialog?.querySelector(".confirm-dialog-close"),
    panelDeleteConfirm: panelDeleteDialog?.querySelector(".confirm-dialog-danger"),
    panelDeleteDialog,
    panelDeleteMessage: document.getElementById("panel-delete-message"),
  };
};

export const workspaceDeleteKind = (item) => {
  if (item?.dataset?.workspaceObjectType === "divider" || item?.classList?.contains("workspace-divider")) return "divider";
  if (item?.classList?.contains("widget-card")) return "widget";
  if (item?.classList?.contains("db-panel")) return "panel";
  return "";
};
