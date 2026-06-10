const dashboardToolDrawerVars = [
  "--panel-lock-bg",
  "--panel-lock-fg",
  "--panel-lock-border",
  "--panel-lock-glow",
  "--panel-drawer-bg",
  "--panel-drawer-border",
  "--panel-drawer-shadow",
  "--panel-control-rest-shadow",
  "--panel-control-hover-border",
  "--panel-control-hover-shadow",
  "--panel-control-active-shadow",
  "--widget-control-bg",
  "--widget-control-hover-bg",
  "--widget-control-active-bg",
  "--widget-drawer-bg",
];

export const createDashboardToolDrawerRuntime = ({
  portalFloatingMenu,
  restoreFloatingMenu,
}) => {
  const clampCoord = (value, size, gutter) => {
    const max = Math.max(gutter, window.innerWidth - size - gutter);
    return Math.max(gutter, Math.min(value, max));
  };

  const clampTop = (value, size, gutter) => {
    const max = Math.max(gutter, window.innerHeight - size - gutter);
    return Math.max(gutter, Math.min(value, max));
  };

  const drawerDimensions = (drawer) => {
    const rect = drawer.getBoundingClientRect();
    return {
      width: drawer.offsetWidth || rect.width,
      height: drawer.offsetHeight || rect.height,
    };
  };

  const portalDashboardToolDrawer = (item, drawer, point = null) => {
    if (!item || !drawer || !Number.isFinite(point?.clientX) || !Number.isFinite(point?.clientY)) return false;
    const drawerStyles = window.getComputedStyle(drawer);
    dashboardToolDrawerVars.forEach((name) => {
      const value = drawerStyles.getPropertyValue(name);
      if (value) drawer.style.setProperty(name, value);
    });
    if (!portalFloatingMenu(drawer, item, { skipPosition: true })) return false;
    drawer.classList.add("dashboard-tool-drawer-portaled");
    const { width, height } = drawerDimensions(drawer);
    if (width <= 0 || height <= 0) {
      restoreDashboardToolDrawer(drawer);
      return false;
    }
    const gutter = 8;
    const left = clampCoord(point.clientX, width, gutter);
    const top = clampTop(point.clientY, height, gutter);
    drawer.style.setProperty("--dashboard-tool-drawer-fixed-left", `${Math.round(left)}px`);
    drawer.style.setProperty("--dashboard-tool-drawer-fixed-top", `${Math.round(top)}px`);
    drawer.classList.add("dashboard-tool-drawer-open");
    return true;
  };

  const restoreDashboardToolDrawer = (drawer) => {
    if (!drawer) return;
    drawer.classList.remove("dashboard-tool-drawer-portaled", "dashboard-tool-drawer-open");
    drawer.style.removeProperty("--dashboard-tool-drawer-fixed-left");
    drawer.style.removeProperty("--dashboard-tool-drawer-fixed-top");
    dashboardToolDrawerVars.forEach((name) => drawer.style.removeProperty(name));
    restoreFloatingMenu(drawer);
  };

  return {
    portalDashboardToolDrawer,
    restoreDashboardToolDrawer,
  };
};
