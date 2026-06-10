const STORAGE_KEY = "dashboard-floating-control-bar";
const DEFAULT_POSITION = Object.freeze({ left: 14, top: 58 });

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const readPosition = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (Number.isFinite(parsed?.left) && Number.isFinite(parsed?.top)) {
      return { left: parsed.left, top: parsed.top };
    }
  } catch {}
  return { ...DEFAULT_POSITION };
};

const writePosition = (position) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      left: Math.round(position.left),
      top: Math.round(position.top),
    }));
  } catch {}
};

const interactiveSelector = [
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "summary",
  "details",
  "[role='button']",
  "[role='menu']",
].join(",");

export const initializeFloatingControlBarRuntime = async () => {
  const bar = document.querySelector("[data-floating-control-bar]");
  const gear = document.querySelector(".control-bar-gear");
  const minimizeControl = document.querySelector(".window-minimize-control");
  const refreshControl = document.querySelector(".window-refresh-control");
  const closeControl = document.querySelector(".window-close-control");
  if (!bar || !gear) return null;

  let position = readPosition();
  let isOpen = false;
  let dragging = null;

  const constrainPosition = (next = position) => {
    const rect = bar.getBoundingClientRect();
    const width = rect.width || 420;
    const height = rect.height || 58;
    const controlsRect = document.querySelector(".window-control-cluster")?.getBoundingClientRect();
    const minTop = Math.max(8, Math.round((controlsRect?.bottom || 44) + 10));
    return {
      left: clamp(next.left, 8, Math.max(8, window.innerWidth - width - 8)),
      top: clamp(Math.max(next.top, minTop), minTop, Math.max(minTop, window.innerHeight - height - 8)),
    };
  };

  const applyPosition = () => {
    position = constrainPosition(position);
    const gearRect = gear.getBoundingClientRect();
    const gearCenterX = gearRect.left + (gearRect.width / 2);
    const gearCenterY = gearRect.top + (gearRect.height / 2);
    bar.style.setProperty("--control-bar-left", `${position.left}px`);
    bar.style.setProperty("--control-bar-top", `${position.top}px`);
    bar.style.setProperty("--control-bar-collapsed-x", `${Math.round(gearCenterX - position.left - 18)}px`);
    bar.style.setProperty("--control-bar-collapsed-y", `${Math.round(gearCenterY - position.top - 18)}px`);
    window.LiquidGlassWebGL?.markDirty?.();
  };

  const setOpen = (nextOpen) => {
    isOpen = Boolean(nextOpen);
    applyPosition();
    bar.classList.toggle("is-open", isOpen);
    bar.setAttribute("aria-hidden", String(!isOpen));
    gear.setAttribute("aria-expanded", String(isOpen));
    document.body.classList.toggle("control-bar-open", isOpen);
    window.LiquidGlassWebGL?.markDirty?.();
  };

  applyPosition();
  setOpen(false);

  gear.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setOpen(!isOpen);
  });

  minimizeControl?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    window.dashboardWindowControls?.minimize?.();
  });

  const reloadSavedWorkspace = () => {
    if (typeof window.dashboardLayoutSourceRuntime?.load === "function") {
      window.dashboardLayoutSourceRuntime.load("builder");
      return;
    }
    window.dashboardWorkspacePagesRuntime?.skipNextBeforeUnloadPersist?.();
    if (typeof window.dashboardWindowControls?.reload === "function") {
      window.dashboardWindowControls.reload();
      return;
    }
    window.location.reload();
  };

  refreshControl?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    reloadSavedWorkspace();
  });

  closeControl?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    window.dashboardWindowControls?.close?.();
  });

  bar.addEventListener("pointerdown", (event) => {
    if (!isOpen) return;
    if (event.button !== 0) return;
    if (event.target?.closest?.(interactiveSelector) && !event.target?.closest?.(".control-bar-drag-handle")) return;
    const pointerId = event.pointerId;
    const rect = bar.getBoundingClientRect();
    dragging = {
      pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    bar.classList.add("is-dragging");
    bar.setPointerCapture?.(pointerId);
    event.preventDefault();
  });

  bar.addEventListener("pointermove", (event) => {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    position = constrainPosition({
      left: event.clientX - dragging.offsetX,
      top: event.clientY - dragging.offsetY,
    });
    applyPosition();
  });

  const endDrag = (event) => {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    dragging = null;
    bar.classList.remove("is-dragging");
    writePosition(position);
    window.LiquidGlassWebGL?.markDirty?.();
  };
  bar.addEventListener("pointerup", endDrag);
  bar.addEventListener("pointercancel", endDrag);

  document.addEventListener("pointerdown", (event) => {
    if (!isOpen) return;
    if (bar.contains(event.target) || gear.contains(event.target)) return;
    if (event.target?.closest?.(".workspace-menu-overlay-layer, .panel-color-menu, .background-tone-popover")) return;
    setOpen(false);
  }, true);

  window.addEventListener("resize", () => {
    applyPosition();
    writePosition(position);
  });

  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!isOpen),
    position: () => ({ ...position }),
  };
};
