export const createMenuOverlayFacade = ({ dashboardMenuOverlayRuntime }) => {
  const positionPortaledMenu = (menu, trigger, options = {}) => dashboardMenuOverlayRuntime?.position?.(menu, trigger, options);
  const portalFloatingMenu = (menu, trigger, options = {}) => dashboardMenuOverlayRuntime?.portal?.(menu, trigger, options);
  const restoreFloatingMenu = (menu) => dashboardMenuOverlayRuntime?.restore?.(menu);
  const originalMenuParent = (menu) => dashboardMenuOverlayRuntime?.originalParent?.(menu);
  const menuOverlayLayer = () => dashboardMenuOverlayRuntime?.ensureLayer?.() || document.body;

  return {
    menuOverlayLayer,
    originalMenuParent,
    portalFloatingMenu,
    positionPortaledMenu,
    restoreFloatingMenu,
  };
};
