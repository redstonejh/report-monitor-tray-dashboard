const rectSnapshot = (rect) => ({
  left: rect.left,
  right: rect.right,
  top: rect.top,
  bottom: rect.bottom,
  width: rect.width,
  height: rect.height,
});

export const stableElementRect = (element) => {
  if (!element?.isConnected || typeof element.getBoundingClientRect !== "function") return null;
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) <= 0.01) return null;
  const rect = element.getBoundingClientRect();
  if (
    !Number.isFinite(rect.left) ||
    !Number.isFinite(rect.top) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) return null;
  return rectSnapshot(rect);
};

export const objectMenuAnchorRect = (owner) => {
  const rect = stableElementRect(owner);
  if (!rect) return null;
  return {
    ...rect,
    left: rect.right,
    top: rect.top,
    bottom: rect.top,
    width: 0,
    height: 0,
  };
};

export const clampViewportCoord = (value, size, gutter) => {
  const max = Math.max(gutter, window.innerWidth - size - gutter);
  return Math.max(gutter, Math.min(value, max));
};

export const clampViewportTop = (value, size, gutter) => {
  const max = Math.max(gutter, window.innerHeight - size - gutter);
  return Math.max(gutter, Math.min(value, max));
};

export const positionObjectMenuSurface = (owner, surface, options = {}) => {
  if (!surface) return false;
  const anchor = objectMenuAnchorRect(owner);
  if (!anchor) return false;
  const width = surface.offsetWidth || surface.getBoundingClientRect().width || options.fallbackWidth || 0;
  const height = surface.offsetHeight || surface.getBoundingClientRect().height || options.fallbackHeight || 0;
  if (width <= 0 || height <= 0) return false;

  const gutter = options.gutter ?? 12;
  const gap = options.gap ?? gutter;
  const left = clampViewportCoord(anchor.right - width - gap, width, gutter);
  const top = clampViewportTop(anchor.top + gap, height, gutter);

  if (options.cssVars) {
    surface.style.setProperty(options.cssVars.left, `${Math.round(left)}px`);
    surface.style.setProperty(options.cssVars.top, `${Math.round(top)}px`);
  } else {
    surface.style.left = `${Math.round(left)}px`;
    surface.style.top = `${Math.round(top)}px`;
  }
  return true;
};
