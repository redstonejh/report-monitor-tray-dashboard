(() => {
  const interactionState = window.dashboardInteractionState;
  const portalState = new WeakMap();

  const ensureLayer = () => {
    let layer = document.querySelector(".workspace-menu-overlay-layer");
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "workspace-menu-overlay-layer";
      layer.setAttribute("aria-hidden", "true");
      document.body.appendChild(layer);
    }
    return layer;
  };

  const clampCoord = (value, min, max) => Math.max(min, Math.min(max, value));

  const position = (menu, trigger, options = {}) => {
    if (!menu || !trigger?.getBoundingClientRect) return false;
    const triggerRect = trigger.getBoundingClientRect();
    const viewportPadding = options.viewportPadding ?? 12;
    const offset = options.offset ?? 8;
    const align = options.align || "left";
    menu.style.position = "fixed";
    menu.style.right = "auto";
    menu.style.bottom = "auto";
    menu.style.left = "0px";
    menu.style.top = "0px";
    const rect = menu.getBoundingClientRect();
    const menuWidth = Math.max(rect.width || 0, menu.offsetWidth || 0, options.minWidth || 0);
    const menuHeight = Math.max(
      rect.height || 0,
      menu.offsetHeight || 0,
      Math.min(menu.scrollHeight || 0, window.innerHeight - viewportPadding * 2)
    );
    const maxLeft = Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding);
    let left = align === "right" ? triggerRect.right - menuWidth : triggerRect.left;
    if (align === "center") left = triggerRect.left + triggerRect.width / 2 - menuWidth / 2;
    left = clampCoord(left, viewportPadding, maxLeft);
    let top = triggerRect.bottom + offset;
    let originY = "top";
    const spaceBelow = window.innerHeight - top - viewportPadding;
    const spaceAbove = triggerRect.top - offset - viewportPadding;
    if (spaceBelow < 150 && spaceAbove > spaceBelow) {
      const aboveHeight = Math.min(menuHeight || spaceAbove, spaceAbove);
      top = Math.max(viewportPadding, triggerRect.top - offset - aboveHeight);
      originY = "bottom";
    }
    const availableHeight = Math.max(
      120,
      Math.floor((originY === "bottom" ? triggerRect.top - offset : window.innerHeight - top) - viewportPadding)
    );
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    menu.style.setProperty("--menu-portal-max-height", `${availableHeight}px`);
    menu.style.transformOrigin = `${align === "right" ? "top right" : "top left"}`;
    if (originY === "bottom") menu.style.transformOrigin = `${align === "right" ? "bottom right" : "bottom left"}`;
    return true;
  };

  const portal = (menu, trigger, options = {}) => {
    if (!menu || !trigger) return false;
    const layer = ensureLayer();
    if (!portalState.has(menu)) {
      portalState.set(menu, {
        parent: menu.parentElement,
        nextSibling: menu.nextSibling,
      });
    }
    menu.__menuPortalTrigger = trigger;
    menu.__menuPortalOptions = options;
    if (menu.parentElement !== layer) layer.appendChild(menu);
    menu.classList.add("menu-portaled");
    menu.dataset.menuPortaled = "true";
    menu.style.position = "fixed";
    menu.style.right = "auto";
    menu.style.bottom = "auto";
    if (!options?.skipPosition) {
      menu.style.left = "0px";
      menu.style.top = "0px";
      position(menu, trigger, options);
    }
    if (interactionState?.state) {
      interactionState.state.activeMenuState = { menu, trigger, options };
    }
    return true;
  };

  const restore = (menu) => {
    const state = menu ? portalState.get(menu) : null;
    if (!menu || !state?.parent) return false;
    if (menu.parentElement !== state.parent) {
      const nextSibling = state.nextSibling?.parentElement === state.parent ? state.nextSibling : null;
      try {
        state.parent.insertBefore(menu, nextSibling);
      } catch {
        try {
          state.parent.appendChild(menu);
        } catch {}
      }
    }
    menu.classList.remove("menu-portaled");
    delete menu.dataset.menuPortaled;
    delete menu.__menuPortalTrigger;
    delete menu.__menuPortalOptions;
    menu.style.removeProperty("position");
    menu.style.removeProperty("left");
    menu.style.removeProperty("top");
    menu.style.removeProperty("right");
    menu.style.removeProperty("bottom");
    menu.style.removeProperty("transform-origin");
    menu.style.removeProperty("--menu-portal-max-height");
    if (interactionState?.state?.activeMenuState?.menu === menu) {
      interactionState.state.activeMenuState = null;
    }
    return true;
  };

  const originalParent = (menu) => portalState.get(menu)?.parent || null;

  const repositionOpen = () => {
    ensureLayer().querySelectorAll(":scope > [data-menu-portaled='true']").forEach((menu) => {
      if (menu.__menuPortalTrigger && !menu.__menuPortalOptions?.skipPosition) {
        position(menu, menu.__menuPortalTrigger, menu.__menuPortalOptions || {});
      }
    });
  };

  window.addEventListener("resize", repositionOpen);
  window.addEventListener("scroll", repositionOpen, true);

  window.dashboardMenuOverlayRuntime = Object.freeze({
    ensureLayer,
    originalParent,
    portal,
    position,
    repositionOpen,
    restore,
  });
})();
